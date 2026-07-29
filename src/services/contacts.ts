import supabase from '@/lib/supabase/client'
import { buscarTodasAsPaginas } from '@/lib/supabase/paginate'
import type { Contact } from '@/lib/supabase/types'

// Cache write-through da lista de contatos, em escopo de módulo (mesmo padrão
// dos caches de avatar logo abaixo). Existe pra pintar a sidebar na hora — o
// mount seguinte lê este array de forma síncrona em vez de esperar ~1.300
// linhas virem da rede de novo — enquanto `getContacts()` sempre refaz a
// busca em paralelo e substitui o cache pelo resultado fresco.
//
// Só as colunas realmente lidas pela UI (SmartAvatar, buildContactIndex,
// resolveContactDisplayName, o handleSaveTask do ChatWindow) entram no
// select: id, remote_jid, name, nickname, avatar_url, avatar_updated_at.
// `name_locked` fica de fora — nenhum componente cliente o lê hoje, só a
// escrita em `updateContactByJid` usa esse campo.
let contactsCache: Contact[] | null = null

// Lido pelo mount do ChatHub para pintar a sidebar antes do fetch de rede
// terminar. Retorna `null` (não `[]`) quando ainda não há nada em cache, pra
// o chamador distinguir "sem contatos" de "ainda não carregou".
export const getCachedContacts = (): Contact[] | null => contactsCache

const COLUNAS_CONTATO = 'id, remote_jid, name, nickname, avatar_url, avatar_updated_at'

// Coalescing: o boot dispara DUAS cargas completas (o mount do ChatHub e o
// SUBSCRIBED do canal de `contacts`, que também reincide em reconexão, `online`,
// `focus` e `visibilitychange`). Sem isto, paginar transformaria 2 idas à rede
// em ~6. Quem chegar enquanto uma busca está em voo recebe a mesma promise.
let buscaEmVoo: Promise<Contact[]> | null = null

export const getContacts = async (): Promise<Contact[]> => {
  if (buscaEmVoo) return buscaEmVoo

  buscaEmVoo = (async () => {
    // Paginado porque o PostgREST corta em 1.000 linhas sem erro nenhum (ver
    // lib/supabase/paginate.ts). São 1.486 contatos hoje: sem isto, 486 nunca
    // chegavam ao app — as conversas deles apareciam com o telefone no lugar do
    // nome salvo e a foto nunca fixava.
    const contatos = await buscarTodasAsPaginas<Contact>(
      (tamanho, cursor) => {
        let q = supabase
          .from('contacts')
          .select(COLUNAS_CONTATO)
          .order('id', { ascending: true })
          .limit(tamanho)
        if (cursor) q = q.gt('id', cursor)
        return q as any
      },
      (linha) => linha.id,
    )
    // O cache só é substituído DEPOIS que todas as páginas voltaram. Antes esta
    // função nem olhava `error`: uma falha virava `data` null, `contacts` virava
    // `[]` e o cache bom era apagado. Com N páginas seriam N chances de gravar
    // uma lista truncada como se fosse completa — os dois call sites têm
    // `.catch(() => {})`, então lançar preserva o que já estava na tela.
    contactsCache = contatos
    return contatos
  })()

  try {
    return await buscaEmVoo
  } finally {
    buscaEmVoo = null
  }
}

// Chamadas pelo handler de Realtime de `contacts` (ChatHub.tsx) — mantêm o
// cache do módulo em sincronia com o que o usuário já vê na tela. Sem isso, o
// cache e o estado do React divergem e a PRÓXIMA montagem pintaria, por um
// instante, um contato apagado ou com o nome antigo antes do refetch chegar.
export const upsertCachedContact = (contact: Contact) => {
  if (!contactsCache) return
  const idx = contactsCache.findIndex((c) => c.id === contact.id)
  if (idx < 0) {
    contactsCache = [contact, ...contactsCache]
  } else {
    const next = [...contactsCache]
    next[idx] = contact
    contactsCache = next
  }
}

export const removeCachedContact = (id: string) => {
  if (!contactsCache) return
  contactsCache = contactsCache.filter((c) => c.id !== id)
}

export const getContact = async (id: string) => {
  const { data } = await supabase.from('contacts').select('*').eq('id', id).single()
  return data as Contact | null
}

export const updateContactByJid = async (
  jid: string,
  data: Partial<{ nickname: string; name: string; resolved_at: string }>,
) => {
  // Toda escrita de `name` feita pela app (usuário definindo/editando o nome
  // manualmente) trava o contato contra sobrescrita pelo pushName do webhook.
  // É automático aqui — e não responsabilidade de cada chamador — pra não
  // depender de todo call site lembrar de setar a flag. Checa o valor (não
  // `'name' in data`) porque um call site pode mandar `name: undefined`
  // quando o usuário deixou o campo em branco — nesse caso não houve nome
  // definido pelo usuário, então não deve travar.
  const payload = typeof data.name === 'string' ? { ...data, name_locked: true } : data

  const existing = await supabase.from('contacts').select('*').eq('remote_jid', jid).maybeSingle()

  if (existing.data) {
    const { data: updated } = await supabase
      .from('contacts')
      .update(payload)
      .eq('id', existing.data.id)
      .select()
      .single()
    return updated as Contact
  }

  const { data: created } = await supabase
    .from('contacts')
    .insert({ remote_jid: jid, ...payload })
    .select()
    .single()
  return created as Contact
}

// Queue and deduplication for avatar fetching to prevent 429 Too Many Requests
const avatarFetchPromises = new Map<string, Promise<any>>()
const avatarFailedSet = new Set<string>()

// Cache negativo de sessão: no máximo UMA tentativa por (instância, jid) por
// sessão, independente do desfecho (achou foto, não achou, deu erro).
//
// Por que existe: 687 dos ~1.300 contatos não têm foto. Como o gatilho do
// SmartAvatar era "não tem avatar_url", esses contatos disparavam fetch em TODA
// montagem — e a edge function `contact-avatar` faz PATCH em `contacts` mesmo
// quando NÃO acha foto. O PATCH volta pelo Realtime, o array de contatos é
// recriado, e a lista inteira (520 linhas + 500 balões) re-renderiza. Eram ~166
// ciclos desses por troca de aparelho, o "engasgo" de dezenas de segundos.
//
// Precisa ser em escopo de módulo, e não derivado de `avatar_updated_at` vindo
// pelo estado do React: a guarda de no-op no handler de Realtime de `contacts`
// (ChatHub) congela esse campo de propósito, então o loop voltaria pelos
// contatos que TÊM foto.
const avatarCheckedSet = new Set<string>()
const avatarRetriedSet = new Set<string>()

const MAX_CONCURRENT_REQUESTS = 2
let activeRequests = 0

interface RequisicaoNaFila {
  executar: () => void
  cancelar: () => void
}
const requestQueue: RequisicaoNaFila[] = []

/** Erro sentinela: fila esvaziada por troca de aparelho, não falha de rede. */
class FilaDeAvatarLimpa extends Error {
  constructor() {
    super('Avatar queue cleared.')
    this.name = 'FilaDeAvatarLimpa'
  }
}

const processQueue = () => {
  if (activeRequests < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
    const next = requestQueue.shift()
    if (next) {
      activeRequests++
      next.executar()
    }
  }
}

const enqueueRequest = <T>(task: () => Promise<T>, cacheKey: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    requestQueue.push({
      executar: () => {
        task()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            activeRequests--
            processQueue()
          })
      },
      // Ao cancelar, LIBERAR a chave dos caches de sessão: a requisição nunca
      // chegou a sair, então o contato continua sem foto e precisa poder ser
      // buscado de novo quando o usuário voltar para este aparelho. Sem isto o
      // `avatarCheckedSet` trataria o cancelamento como "já checado" e a foto
      // ficaria faltando até o app reiniciar.
      cancelar: () => {
        avatarCheckedSet.delete(cacheKey)
        avatarFetchPromises.delete(cacheKey)
        reject(new FilaDeAvatarLimpa())
      },
    })
    processQueue()
  })
}

/**
 * Descarta as requisições de avatar ainda NÃO iniciadas. Chamado na troca de
 * aparelho: a fila do aparelho anterior pode ter centenas de itens (379 no maior)
 * e, a 2 por vez, seguiria drenando por minutos, disputando a main thread com a
 * lista que o usuário está esperando ver. As até 2 já em voo terminam normalmente
 * — abortá-las exigiria AbortController na edge function e o ganho é irrelevante.
 */
export const clearAvatarQueue = (): void => {
  const pendentes = requestQueue.splice(0, requestQueue.length)
  for (const req of pendentes) req.cancelar()
}

export const fetchAvatar = (jid: string, instanceKey: string, options?: { retry?: boolean }) => {
  // Chave por (instância, jid), NÃO por jid puro.
  //
  // A v0.0.195 tinha unificado por jid, argumentando que `contacts` é global e o
  // mesmo `remote_jid` é uma linha só. A economia era pequena e o custo, alto:
  // como `avatarCheckedSet` e `avatarRetriedSet` vivem em escopo de módulo e
  // sobrevivem à desmontagem, uma única tentativa malsucedida em QUALQUER
  // aparelho passava a bloquear o contato em TODOS eles pelo resto da sessão —
  // inclusive a única retentativa disponível quando a URL do CDN vence.
  // Voltando a segmentar por instância, cada aparelho tem seu próprio orçamento.
  const cacheKey = `${instanceKey}:${jid}`

  if (options?.retry) {
    // `retry` vem do onError da <img> (URL salva quebrou). Vale no máximo uma vez
    // por chave por sessão — sem esse teto, uma leva de URLs quebradas produz
    // exatamente a mesma tempestade que o cache abaixo existe para evitar.
    if (avatarRetriedSet.has(cacheKey)) {
      return Promise.reject(new Error('Avatar retry already used in this session.'))
    }
    avatarRetriedSet.add(cacheKey)
  } else if (avatarCheckedSet.has(cacheKey)) {
    return Promise.reject(new Error('Avatar already checked in this session.'))
  }
  avatarCheckedSet.add(cacheKey)

  if (avatarFailedSet.has(cacheKey)) {
    return Promise.reject(new Error('Throttled: Previous fetch failed.'))
  }

  if (avatarFetchPromises.has(cacheKey)) {
    return avatarFetchPromises.get(cacheKey)!
  }

  let canceladaPelaFila = false

  const promise = enqueueRequest(async () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token || ''

    const res = await fetch(
      `${supabaseUrl}/functions/v1/contact-avatar?jid=${encodeURIComponent(jid)}&instance=${encodeURIComponent(instanceKey)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    return res.json()
  }, cacheKey)
    .catch((err) => {
      // Cancelamento por troca de aparelho não é falha da origem — marcar como
      // falha aplicaria um throttle de 2 min a um contato que sequer foi tentado.
      if (err instanceof FilaDeAvatarLimpa) {
        canceladaPelaFila = true
        throw err
      }
      avatarFailedSet.add(cacheKey)
      setTimeout(() => avatarFailedSet.delete(cacheKey), 120000)
      throw err
    })
    .finally(() => {
      // Não agendar limpeza quando a fila foi cancelada: `cancelar()` já apagou
      // a chave, e um timer de 10s sobrevivendo ao cancelamento apagaria a
      // entrada de uma busca NOVA disparada nesse intervalo — o dedupe cairia e
      // sairiam duas requisições para o mesmo contato.
      if (canceladaPelaFila) return
      setTimeout(() => avatarFetchPromises.delete(cacheKey), 10000)
    })

  avatarFetchPromises.set(cacheKey, promise)
  return promise
}

export const resolveContact = async (jid: string) => {
  const now = new Date().toISOString()
  return updateContactByJid(jid, { resolved_at: now } as any)
}
