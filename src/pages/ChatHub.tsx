import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useIsMobile } from '@/hooks/use-mobile'
import { ChatList } from '@/components/chat/ChatList'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { syncDeviceAvatar } from '@/services/devices'
import { getMessages, getConversationSummaries, getConversationMessages, sendMessage, type ConversationSummary } from '@/services/messages'
import {
  getContacts,
  updateContactByJid,
  getCachedContacts,
  upsertCachedContact,
  removeCachedContact,
  clearAvatarQueue,
} from '@/services/contacts'
import {
  getDeviceSnapshot,
  setDeviceSnapshot,
  setDeviceSummaries,
  setDeviceAssignments,
} from '@/stores/conversationSummaries'
import {
  chaveDaConversa,
  obterConversa,
  marcarCarregando,
  definirMensagens,
  definirMensagensSePresente,
  marcarErro,
  aplicarEventoDeMensagem,
  type EstadoDaConversa,
} from '@/stores/conversationMessages'
import { getMyStates, getDeviceAssignments, getConversationAssignment, respondidaEm, cursorDeLeitura, mesclarNomesDaAtribuicao, type ConversationUserState } from '@/services/conversation_states'
import type { ConversationAssignment } from '@/lib/supabase/types'
import { registrarVoltar } from '@/lib/android-back'
import { definirConversaAberta } from '@/stores/mobileChrome'
import { getNotes } from '@/services/notes'
import { useRealtime } from '@/hooks/use-realtime'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

function debounce<A extends any[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

// Identifica uma mensagem enviada para casar o eco do realtime com a mensagem
// otimista (temp) já exibida — evita duplicar o balão.
function messageFingerprint(deviceId: string, remoteSender: string, content: string) {
  return `${deviceId}|${remoteSender}|${(content || '').trim()}`
}


/**
 * Duas URLs de avatar apontam para a mesma foto E têm a MESMA validade?
 *
 * As fotos vêm do CDN do WhatsApp (`pps.whatsapp.net/...?ccb=..&oh=..&oe=..`).
 * O `oh` é um HMAC regerado a cada busca (644 valores distintos para 645
 * contatos), então comparar a URL inteira dava diferente mesmo com imagem
 * idêntica: o array de `contacts` era recriado, o `contactIndex` novo furava o
 * `memo` e a lista inteira re-renderizava. Eram 33.329 PATCHes assim.
 *
 * Mas ignorar a query string INTEIRA foi longe demais: é nela que mora também o
 * `oe`, a EXPIRAÇÃO. Validade média medida: 9,22 dias. Quando a URL vencia, o
 * `<img>` falhava, o retry buscava a URL renovada, o PATCH voltava pelo Realtime
 * — e este guard concluía "mesma foto" e descartava. A URL morta ficava no
 * estado, `SmartAvatar` dá precedência a ela sobre a local, e a foto ficava
 * quebrada até o fim da sessão. Antes disso se curava sozinho.
 *
 * Comparar caminho + `oe` mantém o ganho (renovação de `oh` puro não re-renderiza)
 * sem prender uma URL vencida.
 */
function identidadeDaFoto(url: string): string {
  const [caminho, query = ''] = url.split('?')
  const oe = new URLSearchParams(query).get('oe') ?? ''
  return `${caminho}?oe=${oe}`
}

function mesmaFoto(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return identidadeDaFoto(a) === identidadeDaFoto(b)
}

const SIDEBAR_MIN = 300
const SIDEBAR_MAX = 520
const SIDEBAR_DEFAULT = 384
const CHAT_MIN = 420
const SIDEBAR_STORAGE_KEY = 'central-whats.chatSidebarWidth.v1'

/**
 * O som e a notificação de mensagem nova NÃO moram mais aqui. Foram para
 * `hooks/use-notificacoes-de-mensagem.ts`, montado no `Layout`.
 *
 * Estar nesta tela era o problema: `ChatHub` é rota `lazy()`, então sair para o
 * Painel, o CRM ou uma ferramenta desmontava tudo e a pessoa parava de ser
 * avisada — sem nenhum sinal de que isso tinha acontecido.
 */

export default function ChatHub() {
  const isMobile = useIsMobile()
  const { user, allowedDevices } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlDeviceId = searchParams.get('device')
  const urlJid = searchParams.get('jid')

  const [devices, setDevices] = useState<any[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([])
  // Espelho de render do store `conversationMessages`. O store é o dono do dado;
  // este estado existe só para disparar re-render. Nunca escrever aqui sem passar
  // pelo store — foi essa dupla fonte de verdade que produzia a conversa errada.
  const [conversationMessages, setConversationMessages] = useState<any[]>([])
  const [estadoConversa, setEstadoConversa] = useState<EstadoDaConversa>('ausente')
  // Semeado de forma síncrona a partir do cache write-through de contacts.ts —
  // pinta a sidebar imediatamente no mount, sem esperar a rede. O efeito
  // abaixo sempre refaz o fetch em paralelo e substitui pelo resultado fresco.
  const [contacts, setContacts] = useState<any[]>(() => getCachedContacts() || [])
  const [selectedContact, setSelectedContact] = useState<string | null>(() =>
    sessionStorage.getItem('activeContactJid')
  )
  const [userStates, setUserStates] = useState<ConversationUserState[]>([])
  const [assignments, setAssignments] = useState<Map<string, ConversationAssignment>>(new Map())
  // Só é `true` quando o aparelho NUNCA foi carregado nesta sessão. Voltar para
  // um aparelho já visitado pinta do snapshot e nunca acende o skeleton.
  const [carregandoConversas, setCarregandoConversas] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [noteCountByJid, setNoteCountByJid] = useState<Map<string, number>>(new Map())
  const prevDeviceIdRef = useRef<string | null>(null)
  // Sempre refletem o valor mais recente de seleção — usados para descartar
  // respostas assíncronas que chegam depois de o usuário já ter trocado de
  // dispositivo/conversa (evita a corrida que mostrava dados do WhatsApp errado).
  const selectedDeviceIdRef = useRef<string | null>(selectedDeviceId)
  const selectedContactRef = useRef<string | null>(selectedContact)
  selectedDeviceIdRef.current = selectedDeviceId
  selectedContactRef.current = selectedContact
  const devicesRef = useRef<any[]>(devices)
  // Mensagens otimistas pendentes (temp) aguardando o eco do realtime.
  // `chave` guarda a conversa de ORIGEM do envio. Sem ela, a confirmação usaria a
  // conversa aberta no momento em que a RPC responde — e quem enviasse e trocasse
  // de contato em seguida gravaria o resultado na conversa errada.
  const pendingTempsRef = useRef<{ tempId: string; fp: string; ts: number; chave: string }[]>([])
  // Última vez que a rede de segurança rodou. Precisa viver no nível do
  // componente: dentro do efeito ele seria recriado a cada troca de conversa e
  // não deduplicaria a rajada de focus/online/visibility do Alt-Tab.
  const lastRefetchRef = useRef(0)
  const noteJids = useMemo(() => new Set(noteCountByJid.keys()), [noteCountByJid])
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isRefreshingAll, setIsRefreshingAll] = useState(false)
  const [isNewContactOpen, setIsNewContactOpen] = useState(false)
  const [newContactName, setNewContactName] = useState('')
  const [newContactDdd, setNewContactDdd] = useState('')
  const [newContactNumber, setNewContactNumber] = useState('')
  const [isCreatingContact, setIsCreatingContact] = useState(false)

  const { toast } = useToast()

  useEffect(() => {
    getContacts()
      .then(setContacts)
      .catch(() => {})
  }, [])

  useEffect(() => {
    getMyStates().then(setUserStates)
  }, [])

  useEffect(() => {
    if (selectedContact) sessionStorage.setItem('activeContactJid', selectedContact)
    else sessionStorage.removeItem('activeContactJid')
  }, [selectedContact])

  useEffect(() => {
    devicesRef.current = devices
  }, [devices])

  useEffect(() => {
    getNotes().then((notes) => {
      const countMap = new Map<string, number>()
      notes.forEach((n) => {
        if (n.contact_jid) {
          countMap.set(n.contact_jid, (countMap.get(n.contact_jid) || 0) + 1)
        }
      })
      setNoteCountByJid(countMap)
    }).catch(() => {})
  }, [])

  useRealtime('notes', (e) => {
    const jid = e.record.contact_jid
    if (!jid) return
    setNoteCountByJid((prev) => {
      const next = new Map(prev)
      if (e.action === 'create') {
        next.set(jid, (next.get(jid) || 0) + 1)
      } else if (e.action === 'delete') {
        const remaining = (next.get(jid) || 1) - 1
        if (remaining <= 0) next.delete(jid)
        else next.set(jid, remaining)
      }
      return next
    })
  })

  /**
   * Ref do último `urlDeviceId` que este efeito de fato APLICOU (achou na lista
   * e usou como aparelho selecionado) — mesmo padrão do `jidAplicadoRef` logo
   * abaixo, reaproveitado aqui de propósito.
   *
   * Por que precisa disto: o Supabase renova o token em segundo plano ao
   * recuperar foco/visibilidade (`autoRefreshToken`, `src/lib/supabase/client.ts`).
   * Cada renovação dispara `onAuthStateChange`, que recarrega `allowedDevices`
   * — e ANTES da correção em `use-auth.tsx`, esse array vinha SEMPRE com
   * referência nova, mesmo com o mesmo conteúdo, fazendo este efeito reexecutar
   * a cada renovação. Sem o ref, a prioridade `urlDeviceId || prev || savedId`
   * fazia o `?device=` da URL vencer TODA vez — inclusive numa reexecução
   * espúria muito depois da navegação real.
   *
   * Cenário real que isso causava: atendente abre `/chat?device=<ADM>` por um
   * card do Dashboard, troca para o aparelho RH pela sidebar (a URL ficava
   * presa em ADM porque `onSelectDevice` só gravava estado, nunca
   * `setSearchParams` — corrigido abaixo em `handleSelectDevice`), deixa o app
   * ocioso. Ao voltar o foco, o token renova, este efeito reexecuta, e
   * `urlDeviceId` (ainda ADM) vencia a escolha viva — o app trocava de
   * aparelho sozinho e, como consequência (ver efeito mais abaixo que fecha
   * `selectedContact` quando o aparelho muda), a conversa aberta era fechada
   * junto.
   *
   * A troca: `urlDeviceId` só tem prioridade quando ainda NÃO foi aplicado
   * (navegação nova de verdade — inclusive o clique manual, que agora atualiza
   * a URL). Fora isso, a escolha viva do usuário (`prev`) manda, depois o
   * `sessionStorage`.
   */
  const urlDeviceIdAplicadoRef = useRef<string | null>(null)
  useEffect(() => {
    const uniqueDevicesMap = new Map()

    allowedDevices.forEach((d) => {
      const key = d.instance_key || d.name
      if (!uniqueDevicesMap.has(key)) {
        uniqueDevicesMap.set(key, d)
      } else {
        const existing = uniqueDevicesMap.get(key)
        if (new Date(d.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
          uniqueDevicesMap.set(key, d)
        }
      }
    })

    const filteredDevices = Array.from(uniqueDevicesMap.values())
    setDevices(filteredDevices)

    // "Novo" = ainda não foi aplicado por este ref. Só marca como aplicado se o
    // aparelho realmente existir na lista atual — senão (por exemplo a lista de
    // devices ainda não carregou) o efeito precisa tentar de novo na próxima
    // vez que `allowedDevices` mudar de verdade, e não desistir silenciosamente.
    const urlDeviceIdEhNovo = !!urlDeviceId && urlDeviceIdAplicadoRef.current !== urlDeviceId
    const urlDeviceIdValido = urlDeviceIdEhNovo && filteredDevices.some((d) => d.id === urlDeviceId)
    if (urlDeviceIdValido) {
      urlDeviceIdAplicadoRef.current = urlDeviceId
    }

    // A mutação do ref fica FORA do updater de propósito: `setState((prev) =>
    // ...)` pode rodar 2x no StrictMode, e um ref mexido lá dentro duplicaria o
    // efeito colateral (mesma cautela já usada para `pendingTempsRef` mais
    // abaixo, no handler de realtime de mensagens).
    setSelectedDeviceId((prev) => {
      const savedId = sessionStorage.getItem('activeDeviceId')
      const targetId = urlDeviceIdValido ? urlDeviceId : (prev || savedId)

      if (targetId && filteredDevices.some((d) => d.id === targetId)) {
        return targetId
      }
      return filteredDevices[0]?.id || null
    })
  }, [allowedDevices, urlDeviceId])

  /**
   * Handler de troca manual de aparelho pela sidebar. Além de gravar o estado,
   * sincroniza o `?device=` da URL — sem isto o link ficava para sempre preso
   * no aparelho de origem (ver o comentário grande acima), e qualquer
   * reexecução do efeito de seleção (renovação de token, nova aba com o mesmo
   * link, etc.) tentava "corrigir" a seleção de volta para lá.
   *
   * Não entra em loop: mudar a URL aqui reexecuta o efeito acima com um
   * `urlDeviceId` novo, mas como o aparelho já é o selecionado, `setSearchParams`
   * e a nova chamada de `setSelectedDeviceId` recebem o MESMO valor que já está
   * no estado — o React não re-renderiza por um `setState` com valor idêntico
   * (`Object.is`), e o `urlDeviceIdAplicadoRef` já sobe para o valor novo nessa
   * mesma passada, então não sobra nenhuma reexecução pendente.
   *
   * O `jid` é APAGADO aqui, e isso não é limpeza cosmética. Ele identifica uma
   * conversa DENTRO de um aparelho; carregá-lo para outro não quer dizer nada.
   * Enquanto a URL nunca era reescrita, o efeito do deep link logo abaixo se
   * protegia sozinho (`urlDeviceId` continuava no aparelho antigo e a guarda
   * `selectedDeviceId !== urlDeviceId` barrava tudo). Passando a sincronizar o
   * `device`, essa proteção cai: a guarda passa a valer, a chave
   * `${aparelho}:${jid}` muda junto com o aparelho, e o efeito reabriria o
   * contato da URL no aparelho recém-escolhido — logo depois de a troca de
   * aparelho ter fechado a conversa de propósito.
   */
  const handleSelectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('device', deviceId)
      next.delete('jid')
      return next
    }, { replace: true })
  }, [setSearchParams])

  /**
   * Abre a conversa pedida na URL (`/chat?device=...&jid=...`).
   *
   * O parâmetro `jid` já era ESCRITO em dois lugares (o painel de e-mail, e agora
   * o card de não respondidos do Dashboard), mas nunca era LIDO aqui — só o
   * `device`. Resultado: o botão "abrir conversa" do e-mail levava para o chat e
   * parava na lista, sem nunca abrir ninguém.
   *
   * Espera o aparelho certo estar selecionado antes de escolher o contato: a
   * mesma pessoa pode ter conversa em mais de um aparelho, e aplicar o `jid`
   * antes da troca abriria a conversa no aparelho errado.
   */
  const jidAplicadoRef = useRef<string | null>(null)
  useEffect(() => {
    if (!urlJid) {
      jidAplicadoRef.current = null
      return
    }
    if (urlDeviceId && selectedDeviceId !== urlDeviceId) return

    const chave = `${selectedDeviceId ?? ''}:${urlJid}`
    if (jidAplicadoRef.current === chave) return
    jidAplicadoRef.current = chave
    setSelectedContact(urlJid)
  }, [urlJid, urlDeviceId, selectedDeviceId])

  useRealtime('devices', (e) => {
    if (e.action === 'create') {
      setDevices((prev) => {
        if (!user?.is_admin && !allowedDevices.some((d) => d.id === e.record.id)) return prev
        const exists = prev.find(
          (d) =>
            (d.instance_key === e.record.instance_key && e.record.instance_key) ||
            d.name === e.record.name,
        )
        if (exists) return prev.map((d) => (d.id === exists.id ? e.record : d))
        return [e.record, ...prev]
      })
    } else if (e.action === 'update') {
      setDevices((prev) => prev.map((d) => (d.id === e.record.id ? e.record : d)))
    } else if (e.action === 'delete') {
      setDevices((prev) => prev.filter((d) => d.id !== e.record.id))
    }
  })

  useRealtime(
    'contacts',
    (e) => {
      if (e.action === 'create') {
        upsertCachedContact(e.record)
        setContacts((prev) => [e.record, ...prev])
      } else if (e.action === 'update') {
        // Escreve no cache do módulo SEMPRE, mesmo quando o guard de no-op
        // abaixo pula o re-render — senão o cache fica preso na versão antiga
        // e a PRÓXIMA montagem pintaria por um instante o nome/avatar velho.
        upsertCachedContact(e.record)
        setContacts((prev) => {
          const idx = prev.findIndex((c) => c.id === e.record.id)
          if (idx < 0) return prev
          // Guarda de no-op: a edge function `contact-avatar` faz PATCH mesmo
          // quando não acha foto, mexendo só em `avatar_updated_at`. Sem esta
          // checagem, cada PATCH desses cria um array novo e derruba tudo que
          // depende de `contacts` — buildContactIndex (~6.000 Map.set), as 520
          // linhas da lista e os 500 balões da conversa aberta.
          // Só os campos realmente renderizados entram na comparação.
          const atual = prev[idx]
          if (
            mesmaFoto(atual.avatar_url, e.record.avatar_url) &&
            atual.name === e.record.name &&
            atual.nickname === e.record.nickname &&
            atual.remote_jid === e.record.remote_jid
          ) {
            return prev
          }
          const next = [...prev]
          next[idx] = e.record
          return next
        })
      } else if (e.action === 'delete') {
        removeCachedContact(e.record.id)
        setContacts((prev) => prev.filter((c) => c.id !== e.record.id))
      }
    },
    true,
    undefined,
    // Fecha a janela entre o fetch inicial e o handshake do websocket: uma
    // alteração de contato que chegasse nesse intervalo seria perdida em
    // silêncio (SUBSCRIBED só vira true depois do fetch já ter disparado).
    // Reconciliar a cada SUBSCRIBED (mount e reconexões) também cobre quedas
    // de rede — dispara raro, o `useRealtime` já tem backoff pra isso.
    () => {
      getContacts()
        .then(setContacts)
        .catch(() => {})
    },
  )

  // Busca resumos/mensagens/atribuições de um dispositivo específico. Cada
  // setState só é aplicado se o dispositivo ainda for o selecionado no
  // momento em que a resposta chega — evita que uma resposta atrasada de um
  // WhatsApp já abandonado sobrescreva os dados do WhatsApp atual.
  const loadDeviceData = useCallback((deviceId: string) => {
    const fetchFallbackMessages = () =>
      getMessages(deviceId)
        .then((msgs) => { if (selectedDeviceIdRef.current === deviceId) setMessages(msgs) })
        .catch(() => { if (selectedDeviceIdRef.current === deviceId) setMessages([]) })

    // Um commit só para os dois. Antes eram dois `.then` independentes, e como
    // `conversations` (useMemo) depende de summaries E de assignments, a lista
    // montava com as 668 linhas e remontava logo em seguida. Pior: `pinned`
    // deriva de `assigned_to`, então a ORDEM mudava e a lista saltava na frente
    // do usuário. `allSettled` porque assignments falhando não pode impedir a
    // lista de aparecer.
    return Promise.allSettled([
      getConversationSummaries(deviceId),
      getDeviceAssignments(deviceId),
    ]).then(([resumo, atribuicoes]) => {
      const summaries = resumo.status === 'fulfilled' ? resumo.value : null
      const map = atribuicoes.status === 'fulfilled' ? atribuicoes.value : new Map()

      // Grava no snapshot SEMPRE, mesmo se o usuário já trocou de aparelho: a
      // resposta continua sendo um retrato válido DESTE aparelho, e é o que
      // torna a volta instantânea. Só a escrita no estado do React é descartada.
      if (summaries) setDeviceSnapshot(deviceId, { summaries, assignments: map })

      if (selectedDeviceIdRef.current !== deviceId) return

      setAssignments(map)
      // A RPC falhou: o skeleton só apaga quando o fallback terminar, senão a
      // lista pisca "Nenhuma conversa por aqui" antes de as mensagens chegarem —
      // e, se o fallback também vier vazio, ficaria carregando para sempre.
      if (!summaries) {
        return fetchFallbackMessages().finally(() => {
          if (selectedDeviceIdRef.current === deviceId) setCarregandoConversas(false)
        })
      }

      setConversationSummaries(summaries)
      setCarregandoConversas(false)
      if (summaries.length === 0) return fetchFallbackMessages()
      setMessages([])
    })
  }, [])

  useEffect(() => {
    if (selectedDeviceId) {
      sessionStorage.setItem('activeDeviceId', selectedDeviceId)
      const deviceChanged = prevDeviceIdRef.current !== null && prevDeviceIdRef.current !== selectedDeviceId
      prevDeviceIdRef.current = selectedDeviceId
      if (deviceChanged) {
        // A conversa aberta é ortogonal ao aparelho e pode nem existir no novo —
        // continua sendo fechada sempre.
        setSelectedContact(null)
        setConversationMessages([])
        setEstadoConversa('ausente')
        // O store de mensagens NÃO é limpo aqui: as entradas são indexadas por
        // `deviceId|remetente`, então não há como uma conversa de outro aparelho
        // ser lida por engano — e preservá-las faz voltar ao aparelho anterior
        // reabrir as conversas já vistas instantaneamente.

        // A fila de avatares do aparelho anterior chega a 379 itens e, a 2 por
        // vez, seguiria drenando por minutos disputando a main thread com a
        // lista que o usuário está esperando agora.
        clearAvatarQueue()

        // Nunca esvaziar a lista para depois buscar. Havia um snapshot deste
        // aparelho? Pinta na hora e revalida em background. Nunca houve? Aí sim
        // esvazia, mas acendendo o skeleton — porque lista vazia sem essa flag é
        // renderizada como "Nenhuma conversa por aqui", que é a mensagem de
        // aparelho SEM conversa, não de carregamento. Era exatamente isso que
        // aparecia por segundos a cada troca.
        //
        // O cruzamento perigoso que a limpeza antiga evitava (conversas do
        // aparelho anterior casadas com o selectedDeviceId novo em `:755`) some
        // por construção: o snapshot é indexado por deviceId, então o que se
        // pinta pertence, por definição, ao aparelho que está sendo aberto.
      }

      // Fora do `if (deviceChanged)` de propósito: a PRIMEIRA carga do app
      // também precisa disso. Ali `deviceChanged` é false (não havia aparelho
      // anterior), o estado já nasce vazio, e sem acender o skeleton a tela de
      // abertura mostraria "Nenhuma conversa por aqui" até a rede responder.
      const snapshot = getDeviceSnapshot(selectedDeviceId)
      if (snapshot) {
        setConversationSummaries(snapshot.summaries)
        setAssignments(snapshot.assignments)
        setMessages([])
        setCarregandoConversas(false)
      } else if (deviceChanged) {
        setConversationSummaries([])
        setMessages([])
        setAssignments(new Map())
        setCarregandoConversas(true)
      } else {
        setCarregandoConversas(true)
      }

      loadDeviceData(selectedDeviceId)
    } else {
      setMessages([])
      setConversationSummaries([])
      setConversationMessages([])
      setSelectedContact(null)
      prevDeviceIdRef.current = null
    }
  }, [selectedDeviceId, loadDeviceData])

  useEffect(() => {
    if (selectedDeviceId) {
      const device = devices.find((d) => d.id === selectedDeviceId)
      if (device && (!device.avatar_url || !device.avatar_updated_at)) {
        const syncKey = `synced_device_${device.id}`
        if (!sessionStorage.getItem(syncKey)) {
          sessionStorage.setItem(syncKey, '1')
          syncDeviceAvatar(device.id).catch(() => {})
        }
      }
    }
  }, [selectedDeviceId, devices])

  /**
   * Reconexão dos canais de `messages`, `conversation_user_states` e
   * `conversation_assignments` — chamada pelo `aoReconectar` de cada um deles
   * lá embaixo.
   *
   * `postgres_changes` não tem replay: o que mudou no banco enquanto o
   * WebSocket estava fora do ar (o backoff do `useRealtime` chega a 15s) some
   * sem erro nenhum, e é exatamente esse buraco que fazia "Minhas" demorar
   * 5-15s para mostrar uma conversa recém-designada — só o botão de recarregar
   * (`handleRefreshAll`) ou a rede de 60s cobriam isso.
   *
   * COALESCE de propósito: os três canais são a MESMA conexão TCP, então uma
   * queda de rede costuma derrubá-los juntos, e sem debounce a volta disparava
   * três `loadDeviceData` idênticos em sequência. Reusa o mesmo caminho de
   * leitura do botão "atualizar tudo" — não é uma consulta nova, só um
   * gatilho novo. `selectedDeviceIdRef` (não o estado) porque a função nasce
   * uma vez só (deps vazias no debounce) e o aparelho aberto pode ter mudado
   * entre a queda e a volta.
   */
  const aoReconectarLista = useMemo(
    () =>
      debounce(() => {
        const deviceId = selectedDeviceIdRef.current
        if (deviceId) loadDeviceData(deviceId)
      }, 400),
    [loadDeviceData],
  )

  // Esta assinatura cuida SÓ da tela: lista, store e resumos. O aviso de
  // mensagem nova (som e notificação) tem canal próprio, no `Layout` — ver
  // `hooks/use-notificacoes-de-mensagem.ts`.
  useRealtime('messages', (e) => {
    if (e.record.device_id === selectedDeviceId) {
      if (e.action === 'create') setMessages((prev) => [...prev, e.record])
      else if (e.action === 'update')
        setMessages((prev) => prev.map((m) => (m.id === e.record.id ? e.record : m)))
      else if (e.action === 'delete')
        setMessages((prev) => prev.filter((m) => m.id !== e.record.id))

      // Aplica na conversa DA MENSAGEM, esteja ela aberta ou não. Antes havia um
      // gate `if (e.record.remote_sender === selectedContact)` aqui: a mensagem
      // que chegava com a conversa fechada era usada para tocar o som e atualizar
      // a lista lateral, e depois descartada. Ao reabrir, o atendente via a
      // conversa como estava minutos antes — e chegou a reenviar mensagem por
      // achar que a dele não tinha saído.
      let matchedTempId: string | null = null
      if (e.action === 'create' && e.record.direction === 'outbound') {
        // Reconciliação: se este eco corresponde a uma mensagem otimista (temp)
        // ainda pendente, substitui o temp pelo registro real em vez de adicionar
        // — evita balão duplicado. O lookup acontece fora do updater (que pode
        // rodar 2x em StrictMode).
        const fp = messageFingerprint(e.record.device_id, e.record.remote_sender, e.record.content)
        const idx = pendingTempsRef.current.findIndex((p) => p.fp === fp)
        if (idx >= 0) {
          matchedTempId = pendingTempsRef.current[idx].tempId
          pendingTempsRef.current.splice(idx, 1)
        }

        // RESPONDER TAMBÉM ATRIBUI, e a lista precisa mostrar isso na hora.
        //
        // O gatilho `atribuir_conversa_ao_responder` (migration de 26/08) põe a
        // conversa no nome de quem respondeu quando ela não tem dono. Como quem
        // decide é o banco, o cliente não tem retorno de RPC para aplicar — sem
        // isto aqui, a conversa só entraria em Minhas quando o evento da
        // atribuição desse a volta pela rede.
        //
        // As condições espelham o `WHEN` do gatilho e a guarda da função
        // (`origin = 'app'`, autor = eu, grupo não, e só quem está sem dono), para
        // a consulta sair APENAS quando o gatilho de fato vai agir — e não a cada
        // mensagem enviada. Quem já tem dono não é tocado: a função do banco se
        // recusa a roubar conversa de colega, e o cliente não pode fingir o
        // contrário.
        const atribuicaoAtual = assignments.get(
          chaveDaConversa(e.record.device_id as string, e.record.remote_sender as string),
        )
        const temDono =
          atribuicaoAtual?.status === 'invited' ||
          ((atribuicaoAtual?.status === 'taken' || atribuicaoAtual?.status === 'assigned') &&
            !!atribuicaoAtual?.assigned_to)
        if (
          e.record.origin === 'app' &&
          e.record.sender_id === user?.id &&
          !(e.record.remote_sender as string)?.endsWith('@g.us') &&
          !temDono
        ) {
          const deviceIdDaLinha = e.record.device_id as string
          const remetenteDaLinha = e.record.remote_sender as string
          getConversationAssignment(deviceIdDaLinha, remetenteDaLinha)
            .then((asgn) => aplicarAtribuicao(deviceIdDaLinha, remetenteDaLinha, asgn))
            .catch(() => {})
        }
      }

      // `e.record` chega como Record<string, unknown> do handler de Realtime; o
      // arquivo inteiro já resolve isso com cast no ponto de uso.
      const deviceIdDaMensagem = e.record.device_id as string
      const remetenteDaMensagem = e.record.remote_sender as string
      const chaveDaMensagem = chaveDaConversa(deviceIdDaMensagem, remetenteDaMensagem)
      const mudou = aplicarEventoDeMensagem(chaveDaMensagem, e.action, e.record, matchedTempId)
      if (mudou && remetenteDaMensagem === selectedContact) {
        sincronizarDaLoja(deviceIdDaMensagem, remetenteDaMensagem)
      }

      // Atualizar resumos de conversas quando chega mensagem nova
      if (e.action === 'create') {
        debouncedRefreshSummaries(selectedDeviceId)
      }
    }
  }, true, undefined, undefined, aoReconectarLista)

  const debouncedRefreshSummaries = useMemo(
    () => debounce((deviceId: string) => {
      getConversationSummaries(deviceId)
        .then((summaries) => {
          // O snapshot é atualizado mesmo se o usuário já trocou de aparelho:
          // continua sendo o retrato mais recente DESTE aparelho, e é o que faz
          // a volta pintar já com as mensagens que chegaram enquanto ele estava
          // em outro. Só a escrita no estado do React respeita a seleção atual.
          setDeviceSummaries(deviceId, summaries)
          // Descarta se o usuário já trocou de dispositivo antes desta
          // chamada (debounced) resolver — senão sobrescreve o resumo certo.
          if (selectedDeviceIdRef.current !== deviceId) return
          setConversationSummaries(summaries)
          setCarregandoConversas(false)
        })
        .catch(() => {})
    }, 150),
    [],
  )

  const refreshConversationStates = useCallback(async () => {
    const states = await getMyStates()
    setUserStates(states)
    if (selectedDeviceId) {
      debouncedRefreshSummaries(selectedDeviceId)
    }
  }, [selectedDeviceId, debouncedRefreshSummaries])

  // ── Optimistic send: exibe a mensagem enviada na hora e reconcilia depois ──
  const addOptimisticMessage = useCallback((tempMsg: any) => {
    // Limpa temps antigos que nunca foram reconciliados (segurança).
    const cutoff = Date.now() - 120000
    pendingTempsRef.current = pendingTempsRef.current.filter((p) => p.ts >= cutoff)
    const chave = chaveDaConversa(tempMsg.device_id, tempMsg.remote_sender)
    pendingTempsRef.current.push({
      tempId: tempMsg.id,
      fp: messageFingerprint(tempMsg.device_id, tempMsg.remote_sender, tempMsg.content),
      ts: Date.now(),
      chave,
    })
    // Escreve no store e espelha, para o balão otimista sobreviver a sair e
    // voltar da conversa antes de o eco do realtime chegar.
    setConversationMessages((prev) => {
      const proximas = [...prev, tempMsg]
      definirMensagensSePresente(chave, proximas)
      return proximas
    })
  }, [])

  const confirmOptimisticMessage = useCallback((tempId: string, realMsg?: any) => {
    // Lê a conversa de origem ANTES de remover o pending: a resposta da RPC pode
    // chegar depois de o atendente já ter trocado de contato.
    const chaveDeOrigem =
      pendingTempsRef.current.find((p) => p.tempId === tempId)?.chave ??
      (realMsg?.device_id && realMsg?.remote_sender
        ? chaveDaConversa(realMsg.device_id, realMsg.remote_sender)
        : null)
    // Remove o pending para o eco do realtime não tentar reconciliar de novo.
    pendingTempsRef.current = pendingTempsRef.current.filter((p) => p.tempId !== tempId)
    setConversationMessages((prev) => {
      let proximas: any[]
      if (realMsg && realMsg.id) {
        // Substitui a mensagem otimista pela linha real retornada pela RPC.
        // Determinístico (por tempId) — funciona mesmo se o realtime estiver fora.
        if (prev.some((m) => m.id === realMsg.id)) {
          // O eco do realtime já inseriu a mensagem real → só remove a temp.
          proximas = prev.filter((m) => m.id !== tempId)
        } else {
          proximas = prev.map((m) => (m.id === tempId ? realMsg : m))
        }
      } else {
        // Sem a linha real: ao menos marca como enviada.
        proximas = prev.map((m) => (m.id === tempId ? { ...m, status: 'sent' } : m))
      }
      // `prev` é o array da conversa ABERTA. Gravá-lo numa chave diferente
      // reintroduziria exatamente o defeito que este refactor eliminou, então só
      // espelha quando a origem do envio ainda é o que está na tela.
      const conversaAberta = selectedDeviceIdRef.current && selectedContactRef.current
        ? chaveDaConversa(selectedDeviceIdRef.current, selectedContactRef.current)
        : null
      if (chaveDeOrigem && chaveDeOrigem === conversaAberta) {
        definirMensagensSePresente(chaveDeOrigem, proximas)
      } else if (chaveDeOrigem && realMsg?.id) {
        // Trocou de conversa entre enviar e confirmar. Aplicar na conversa de
        // ORIGEM pela chave dela — sem isto o balão otimista fica órfão lá, o eco
        // do Realtime não casa fingerprint nenhum (o pending já saiu) e anexa a
        // linha real ao lado: a mensagem apareceria duplicada ao voltar.
        aplicarEventoDeMensagem(chaveDeOrigem, 'create', realMsg, tempId)
      }
      return proximas
    })
    if (selectedDeviceId) debouncedRefreshSummaries(selectedDeviceId)
  }, [selectedDeviceId, debouncedRefreshSummaries])

  const markOptimisticFailed = useCallback((tempId: string) => {
    const chaveDeOrigem = pendingTempsRef.current.find((p) => p.tempId === tempId)?.chave ?? null
    pendingTempsRef.current = pendingTempsRef.current.filter((p) => p.tempId !== tempId)
    setConversationMessages((prev) => {
      const proximas = prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m))
      if (chaveDeOrigem && selectedDeviceIdRef.current && selectedContactRef.current
        && chaveDeOrigem === chaveDaConversa(selectedDeviceIdRef.current, selectedContactRef.current)) {
        definirMensagensSePresente(chaveDeOrigem, proximas)
      }
      return proximas
    })
  }, [])

  /**
   * Some com o balão otimista SEM marcá-lo como falho.
   *
   * Usado quando a falha ficou GRAVADA em `tentativas_de_envio` (o erro vem
   * carimbado com o id — ver o `catch` de `sendMessage`). Nesse caso o balão
   * persistido, que sobrevive a recarregar e traz o botão de reenviar, é a
   * representação boa; manter também o de memória mostraria a mesma falha duas
   * vezes, uma delas sem saída.
   *
   * `markOptimisticFailed` continua existindo para o caso em que nem o registro
   * deu certo, e para a rede de 60s.
   */
  const discardOptimisticMessage = useCallback((tempId: string) => {
    const chaveDeOrigem = pendingTempsRef.current.find((p) => p.tempId === tempId)?.chave ?? null
    pendingTempsRef.current = pendingTempsRef.current.filter((p) => p.tempId !== tempId)
    setConversationMessages((prev) => {
      const proximas = prev.filter((m) => m.id !== tempId)
      if (chaveDeOrigem && selectedDeviceIdRef.current && selectedContactRef.current
        && chaveDeOrigem === chaveDaConversa(selectedDeviceIdRef.current, selectedContactRef.current)) {
        definirMensagensSePresente(chaveDeOrigem, proximas)
      }
      return proximas
    })
  }, [])

  useRealtime('conversation_user_states', (e) => {
    if (e.record.user_id !== user?.id) return
    if (e.action === 'create' || e.action === 'update') {
      setUserStates((prev) => {
        const idx = prev.findIndex((s) => s.id === e.record.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = e.record as ConversationUserState
          return next
        }
        return [...prev, e.record as ConversationUserState]
      })
    } else if (e.action === 'delete') {
      setUserStates((prev) => prev.filter((s) => s.id !== e.record.id))
    }
    // Reflete pin/arquivar/lida na ordenação da sidebar sem esperar a próxima mensagem.
    if (selectedDeviceId) debouncedRefreshSummaries(selectedDeviceId)
  }, true, undefined, undefined, aoReconectarLista)

  /**
   * ÚNICO caminho de escrita de uma atribuição no que a tela enxerga.
   *
   * O mapa `assignments` decide a aba Minhas/Geral (`ehMinha` no ChatList), o
   * `pinned` que sobe a conversa, o `pendingReply` e o cursor de leitura. Ele
   * nascia com três donos — a carga do aparelho, o snapshot e o Realtime — e os
   * botões de atendimento não eram nenhum deles: `handleActionTake` e companhia
   * mexiam só no estado interno do ChatWindow, então a lista ficava esperando o
   * evento dar a volta pela rede para descobrir algo que o clique já sabia. Era
   * esse o "demora para aparecer em Minhas".
   *
   * Agora Realtime, botões e o gatilho de responder passam todos por aqui.
   *
   * `linha` nula = a conversa deixou de ter atribuição; a entrada sai do mapa em
   * vez de ficar com um retrato velho.
   *
   * Lê `selectedDeviceIdRef` e não o estado: a função é passada como prop e
   * guardada em closures, e a ref é o que garante que "o aparelho aberto" seja o
   * de agora, não o de quando a closure nasceu.
   */
  const aplicarAtribuicao = useCallback((
    deviceId: string,
    remoteSender: string,
    linha: ConversationAssignment | null,
  ) => {
    const chave = chaveDaConversa(deviceId, remoteSender)

    const aplicar = (mapa: Map<string, ConversationAssignment>) => {
      if (linha) mapa.set(chave, mesclarNomesDaAtribuicao(mapa.get(chave), linha))
      else mapa.delete(chave)
      return mapa
    }

    // Grava no snapshot do aparelho DA LINHA, mesmo que não seja o aberto: a troca
    // de instância pinta na hora com o dado já fresco, em vez de esperar o fetch.
    const snapshot = getDeviceSnapshot(deviceId)
    if (snapshot) setDeviceAssignments(deviceId, aplicar(new Map(snapshot.assignments)))

    // Só o aparelho aberto mexe na tela.
    if (deviceId !== selectedDeviceIdRef.current) return
    setAssignments((prev) => aplicar(new Map(prev)))
  }, [])

  // O canal é a tabela INTEIRA (o `useRealtime` só filtra se receber o 4º
  // parâmetro), então aqui chega atribuição de todos os aparelhos da empresa. Cada
  // evento é ROTEADO para o aparelho dono da linha; antes era aplicado cego num mapa
  // chaveado só pelo contato, e como 494 dos 1.423 contatos existem em mais de uma
  // instância, pegar um contato no Comercial fazia a conversa sumir da Geral de quem
  // estava no RH, marcada como pega por alguém que nunca a pegou ali. O handler de
  // `conversation_user_states`, logo acima, sempre teve a guarda equivalente.
  useRealtime('conversation_assignments', (e) => {
    const row = e.record as ConversationAssignment

    if (e.action === 'delete') {
      // DELETE traz SÓ a chave primária: a tabela está em REPLICA IDENTITY DEFAULT,
      // então `device_id`/`remote_sender` chegam `undefined` e a entrada só dá para
      // localizar pelo `id` — inclusive o snapshot de qual aparelho, daí a varredura.
      // Caminho defensivo: nenhuma RPC apaga atribuição, o estado vira
      // 'finished'/'waiting' e a linha fica.
      const removerPorId = (mapa: Map<string, ConversationAssignment>) => {
        for (const [chave, a] of mapa) {
          if (a.id === row.id) {
            mapa.delete(chave)
            break
          }
        }
      }
      for (const id of devicesRef.current.map((d) => d.id)) {
        const snapshot = getDeviceSnapshot(id)
        if (!snapshot) continue
        const mapa = new Map(snapshot.assignments)
        removerPorId(mapa)
        setDeviceAssignments(id, mapa)
      }
      setAssignments((prev) => {
        const next = new Map(prev)
        removerPorId(next)
        return next
      })
      if (selectedDeviceId) debouncedRefreshSummaries(selectedDeviceId)
      return
    }

    aplicarAtribuicao(row.device_id, row.remote_sender, row)

    // SEM `debouncedRefreshSummaries` aqui, e isso é deliberado.
    //
    // De tudo que `conversation_assignments` guarda, a RPC `get_conversation_summaries`
    // lê UMA coluna só: `global_read_at`, no `GREATEST` que forma o cursor de leitura.
    // Todo o resto que a tela deriva da atribuição — `pinned` (assumida por mim),
    // `pendingReply` (via `global_responded_at`), a aba Minhas/Geral, a ordenação — já
    // é calculado aqui no cliente, e agora o cursor de leitura também é (ver
    // `cursorDeLeitura` no `useMemo` de `conversations`). Então o `setAssignments`
    // acima é suficiente: a lista se corrige no mesmo quadro, sem rede.
    //
    // O refetch que estava aqui custava caro. Abrir uma conversa chama
    // `mark_conversation_read_global`, que faz UPDATE nesta tabela — 6.574 aberturas
    // em 7 dias. Cada uma virava um evento para TODOS os clientes conectados, e cada
    // cliente respondia com um `get_conversation_summaries` inteiro (CTE recursiva
    // sobre `messages` com contagem por remetente). Com 12 atendentes, uma pessoa
    // abrindo uma conversa recalculava os resumos nos 12 — para chegar a um número que
    // o cliente já sabia deduzir.
    //
    // Rede de segurança continua existindo: `refetchOpen` (foco/visibilidade/rede e o
    // tick de 60 s) e o evento de `messages`.
    //
    // `aoReconectar` abaixo NÃO reintroduz o custo descrito acima: ele só roda na
    // reconexão do canal (rara), nunca por evento, e é a única forma de recuperar
    // uma atribuição que mudou justamente durante a queda — sem replay, esse
    // evento nunca chega. É a causa raiz do atraso de 5-15s em "Minhas" descrito
    // no diagnóstico deste ajuste.
  }, true, undefined, undefined, aoReconectarLista)

  // Copia para o estado o que o store tem NESTA chave. É o único caminho de
  // escrita do que aparece na tela: como a leitura é indexada pela mesma chave que
  // identifica a conversa, exibir mensagem de outra pessoa deixa de ser algo que
  // uma guarda evita e passa a ser impossível por construção.
  const sincronizarDaLoja = useCallback((deviceId: string, contact: string) => {
    if (selectedDeviceIdRef.current !== deviceId || selectedContactRef.current !== contact) return
    const entrada = obterConversa(chaveDaConversa(deviceId, contact))
    setConversationMessages(entrada.mensagens)
    setEstadoConversa(entrada.estado)
  }, [])

  // Busca as mensagens de uma conversa específica. O resultado vai SEMPRE para o
  // store (continua sendo um retrato válido daquela conversa mesmo se o usuário já
  // trocou de tela); só o espelho de render respeita a seleção atual.
  const loadConversationMessages = useCallback((deviceId: string, contact: string) => {
    const chave = chaveDaConversa(deviceId, contact)
    marcarCarregando(chave)
    sincronizarDaLoja(deviceId, contact)

    return getConversationMessages(deviceId, contact)
      .then((msgs) => {
        definirMensagens(chave, msgs)
        sincronizarDaLoja(deviceId, contact)
      })
      .catch(() => {
        // Antes era `.catch(() => {})`: uma falha de rede deixava o painel
        // afirmando PARA SEMPRE que a conversa não tinha mensagens. Agora vira
        // estado de erro visível — e se já havia conteúdo carregado, o store
        // preserva o que o atendente está lendo.
        marcarErro(chave)
        sincronizarDaLoja(deviceId, contact)
      })
  }, [sincronizarDaLoja])

  // Botão manual de "atualizar tudo": recarrega resumos, mensagens e
  // atribuições do WhatsApp selecionado (e a conversa aberta, se houver).
  const handleRefreshAll = useCallback(async () => {
    const deviceId = selectedDeviceId
    if (!deviceId) return
    setIsRefreshingAll(true)
    try {
      const contact = selectedContact
      await Promise.all([
        loadDeviceData(deviceId),
        contact ? loadConversationMessages(deviceId, contact) : Promise.resolve(),
      ])
    } finally {
      setIsRefreshingAll(false)
    }
  }, [selectedDeviceId, selectedContact, loadDeviceData, loadConversationMessages])

  /**
   * Encaminha uma mensagem para outra conversa do MESMO aparelho.
   *
   * NÃO usa o caminho otimista de propósito. `addOptimisticMessage` grava o array
   * da conversa ABERTA numa chave de conversa diferente — que é exatamente o
   * defeito de "conversa de outra pessoa sob o nome errado" corrigido na v0.0.196.
   * Aqui o retorno da RPC (a linha real) é aplicado no store pela chave do
   * DESTINO, então a mensagem já está lá quando o atendente abrir aquela conversa,
   * sem nunca tocar no que está na tela.
   */
  const handleForwardMessage = useCallback(
    async (remoteSenderDestino: string, texto: string, anexo?: { url: string; type: string; name: string }) => {
      if (!selectedDeviceId || !user?.id) throw new Error('Sem aparelho selecionado')

      const resultado = await sendMessage({
        content: texto,
        device_id: selectedDeviceId,
        sender_id: user.id,
        is_read: true,
        remote_sender: remoteSenderDestino,
        mediaUrl: anexo?.url,
        mediaType: anexo?.type,
        mediaName: anexo?.name,
        // Sai SEM a assinatura do atendente e nasce marcada. Antes o
        // encaminhamento chegava do outro lado como mensagem escrita na hora,
        // assinada — nada nele dizia que era um encaminhamento.
        forwarded: true,
      })

      const linhaReal = resultado?.message
      if (linhaReal?.id && linhaReal?.remote_sender) {
        // A RPC normaliza o destino (só dígitos no privado, JID completo em
        // grupo) e grava assim. Usar o valor DE VOLTA da linha, e não o que foi
        // digitado, garante que a chave do store bate com a que a conversa usa —
        // caso contrário a mensagem "não apareceria" ao abrir o destino.
        aplicarEventoDeMensagem(
          chaveDaConversa(selectedDeviceId, linhaReal.remote_sender),
          'create',
          linhaReal,
        )
      }
      debouncedRefreshSummaries(selectedDeviceId)
    },
    [selectedDeviceId, user?.id, debouncedRefreshSummaries],
  )

  // Botão "tentar novamente" do painel de erro.
  const handleRetryMessages = useCallback(() => {
    if (selectedDeviceId && selectedContact) {
      loadConversationMessages(selectedDeviceId, selectedContact)
    }
  }, [selectedDeviceId, selectedContact, loadConversationMessages])

  // Troca de conversa. Pinta o que o store já tem DESTA conversa (instantâneo se
  // já foi vista) e revalida em paralelo. A leitura síncrona antes do fetch é o
  // que impede o quadro com a conversa anterior sob o nome novo.
  //
  // Não existe mais o efeito que "mantinha o cache em dia": ele rodava com o
  // contato NOVO e o estado ainda com as mensagens ANTIGAS, e gravava as mensagens
  // de uma pessoa na chave da outra — a cada troca, não em corrida rara. Agora
  // quem escreve no store é o fetch e o handler de Realtime, sempre pela chave da
  // própria conversa.
  useEffect(() => {
    if (selectedDeviceId && selectedContact) {
      sincronizarDaLoja(selectedDeviceId, selectedContact)
      loadConversationMessages(selectedDeviceId, selectedContact)
    } else {
      setConversationMessages([])
      setEstadoConversa('ausente')
    }
  }, [selectedDeviceId, selectedContact, loadConversationMessages, sincronizarDaLoja])

  // Rede de segurança: se o realtime falhar (queda de WebSocket, sleep, troca de
  // rede), re-busca a conversa aberta e os resumos ao voltar o foco/visibilidade/
  // rede e a cada ~25s enquanto visível. Automatiza o "sair e entrar" manual.
  useEffect(() => {
    const refetchOpen = () => {
      if (document.visibilityState !== 'visible') return
      // Um Alt-Tab dispara focus + visibilitychange (e às vezes online) quase no
      // mesmo instante, cada um refazendo a query de 500 mensagens e a RPC de
      // resumos. 10 s de janela colapsa a rajada em uma rodada só.
      const agora = Date.now()
      if (agora - lastRefetchRef.current < 10000) return
      lastRefetchRef.current = agora

      const deviceId = selectedDeviceIdRef.current
      const contact = selectedContactRef.current
      if (deviceId && contact) {
        loadConversationMessages(deviceId, contact)
      }
      if (deviceId) {
        debouncedRefreshSummaries(deviceId)
        // As atribuições ficavam de fora desta rede: quem perdesse um evento de
        // `conversation_assignments` (sleep, queda de WebSocket, troca de rede)
        // seguia com a aba Minhas errada até apertar o botão de recarregar. Só
        // no reencontro com a tela — foco/visibilidade/rede —, que é justamente
        // quando pode ter faltado evento.
        getDeviceAssignments(deviceId)
          .then((mapa) => {
            if (selectedDeviceIdRef.current !== deviceId) return
            // O mapa que chega é a verdade sobre QUAIS conversas têm atribuição —
            // por isso ele é a base, e quem sumiu do servidor some daqui. Mas as
            // linhas dele são cruas, sem os `*_name`, então cada uma herda o nome
            // que já estava em mãos (ver `mesclarNomesDaAtribuicao`). Substituir o
            // mapa inteiro sem isso apagaria o selo "Com: fulano" a cada volta de
            // foco.
            const anterior = getDeviceSnapshot(deviceId)?.assignments
            const mesclado = new Map<string, ConversationAssignment>()
            for (const [chave, linha] of mapa) {
              mesclado.set(chave, mesclarNomesDaAtribuicao(anterior?.get(chave), linha))
            }
            setDeviceAssignments(deviceId, mesclado)
            setAssignments(new Map(mesclado))
          })
          .catch(() => {})
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetchOpen()
    }
    window.addEventListener('focus', refetchOpen)
    window.addEventListener('online', refetchOpen)
    document.addEventListener('visibilitychange', onVisibility)
    const interval = setInterval(refetchOpen, 60000)
    return () => {
      window.removeEventListener('focus', refetchOpen)
      window.removeEventListener('online', refetchOpen)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(interval)
    }
    // `selectedDeviceId`/`selectedContact` de propósito FORA das deps: o corpo lê
    // as refs, que já refletem o valor mais recente. Mantê-los aqui destruía e
    // recriava o setInterval a cada clique em outra conversa, e o poll de 60 s
    // praticamente nunca chegava a disparar para um atendente ativo.
  }, [loadConversationMessages, debouncedRefreshSummaries])

  const handleCloseConversation = useCallback(() => {
    setSelectedContact(null)
    setIsSheetOpen(false)
  }, [])

  /**
   * No Android, o voltar do sistema sai da conversa para a lista — não fecha o
   * app. Registrado só enquanto há conversa aberta: sem conversa, o voltar
   * segue para o próximo nível (trocar de tela, e na raiz minimizar).
   */
  useEffect(() => {
    if (!selectedContact) return
    return registrarVoltar(() => {
      handleCloseConversation()
      return true
    })
  }, [selectedContact, handleCloseConversation])

  /**
   * Avisa o `Layout` que há conversa ocupando a tela, para ele sumir com a barra
   * de cima e as abas de baixo no celular.
   *
   * Vai por store de módulo porque o sinal sobe do filho para o pai. A limpeza
   * zera ao sair do chat — sem ela, ir para o Painel com uma conversa aberta
   * deixaria o app sem navegação nenhuma.
   */
  useEffect(() => {
    definirConversaAberta(!!selectedContact)
    return () => definirConversaAberta(false)
  }, [selectedContact])

  useEffect(() => {
    if (!selectedContact) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.defaultPrevented) return
      e.preventDefault()
      handleCloseConversation()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedContact, handleCloseConversation])

  const handleOpenInfo = useCallback((deviceId: string, remoteSender: string) => {
    setSelectedContact(remoteSender)
    setIsSheetOpen(true)
  }, [])

  const handleCreateContact = useCallback(async () => {
    const ddd = newContactDdd.replace(/\D/g, '')
    const numero = newContactNumber.replace(/\D/g, '')
    if (!ddd || !numero) {
      toast({ title: 'Preencha DDD e número', variant: 'destructive' })
      return
    }
    if (ddd.length < 2) {
      toast({ title: 'DDD inválido', variant: 'destructive' })
      return
    }
    if (numero.length < 8 || numero.length > 9) {
      toast({ title: 'Número inválido (8-9 dígitos)', variant: 'destructive' })
      return
    }

    const jid = `55${ddd}${numero}`

    setIsCreatingContact(true)
    try {
      const created = await updateContactByJid(jid, {
        name: newContactName.trim() || undefined,
      })
      setContacts((prev) => {
        const exists = prev.some((c) => c.remote_jid === jid)
        return exists ? prev : [created, ...prev]
      })
      setIsNewContactOpen(false)
      setNewContactName('')
      setNewContactDdd('')
      setNewContactNumber('')
      setSelectedContact(jid)
      toast({ title: 'Conversa criada com sucesso' })
    } catch {
      toast({ title: 'Erro ao criar conversa', variant: 'destructive' })
    } finally {
      setIsCreatingContact(false)
    }
  }, [newContactName, newContactDdd, newContactNumber, toast])

  const handleOpenNewContact = useCallback(() => {
    setNewContactName('')
    setNewContactDdd('')
    setNewContactNumber('')
    setIsNewContactOpen(true)
  }, [])

  const handleOpenConversationByJid = useCallback((jid: string) => {
    if (!jid) return
    setSelectedContact(jid)
    setIsSheetOpen(false)
  }, [])

  const conversations = useMemo(() => {
    const userStatesMap = new Map<string, ConversationUserState>()
    for (const s of userStates) {
      userStatesMap.set(`${s.device_id}|${s.remote_sender}`, s)
    }

    if (conversationSummaries.length > 0) {
      const mapped = conversationSummaries.map((summary) => {
        const state = userStatesMap.get(`${selectedDeviceId}|${summary.remote_sender}`)
        const assignment = assignments.get(chaveDaConversa(selectedDeviceId ?? '', summary.remote_sender))
        const assignedToMe = !!assignment
          && (assignment.status === 'taken' || assignment.status === 'assigned')
          && assignment.assigned_to === user?.id

        // O cursor cobre as DUAS marcas de leitura, individual e da equipe — a
        // mesma regra que a RPC aplica com `GREATEST` ao montar `unread_count`.
        // Sem a marca global aqui, o badge de quem NÃO abriu a conversa só
        // apagava depois de rebuscar os resumos; agora o evento de Realtime da
        // atribuição já basta, porque `global_read_at` viaja nele.
        const readCursor = cursorDeLeitura(state?.last_read_at, assignment?.global_read_at)

        let unreadCount = summary.unread_count
        if (state?.manual_unread) {
          unreadCount = Math.max(1, unreadCount)
        } else if (readCursor) {
          const lastRead = new Date(readCursor)
          const lastMsgDate = new Date(summary.last_message_created_at)
          if (lastMsgDate <= lastRead) {
            unreadCount = 0
          }
        }

        const respondedAt = respondidaEm(state?.responded_at, assignment?.global_responded_at)

        return {
          remote_sender: summary.remote_sender,
          sender_name: summary.sender_name,
          lastMessage: {
            id: summary.last_message_id,
            content: summary.last_message_content,
            direction: summary.last_message_direction,
            created_at: summary.last_message_created_at,
            is_read: summary.last_message_is_read,
            attachments: summary.last_message_attachments,
            sender_name: summary.sender_name,
          },
          unread_count: unreadCount,
          message_count: summary.message_count,
          pinned: (state?.pinned ?? false) || assignedToMe,
          archived: state?.archived ?? false,
          pendingReply: summary.last_message_direction === 'inbound' && (!respondedAt || new Date(summary.last_message_created_at) > new Date(respondedAt)),
        }
      })

      return mapped.sort((a, b) => {
        if (a.pinned !== b.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        return new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
      })
    }

    // Fallback: montar a partir das mensagens carregadas (compatibilidade)
    const map = new Map<string, any>()
    messages.forEach((m) => {
      const sender = m.remote_sender || 'Unknown Sender'
      if (!map.has(sender)) {
        map.set(sender, {
          remote_sender: sender,
          sender_name: m.sender_name || '',
          lastMessage: m,
          messages: [],
          unread_count: 0,
        })
      }
      const conv = map.get(sender)
      conv.messages.push(m)
      if (m.sender_name && m.direction === 'inbound') {
        conv.sender_name = m.sender_name
      }
      if (new Date(m.created_at) > new Date(conv.lastMessage.created_at)) {
        conv.lastMessage = m
      }
    })
    return Array.from(map.values())
      .map((conv) => {
        const state = userStatesMap.get(`${selectedDeviceId}|${conv.remote_sender}`)
        const assignment = assignments.get(chaveDaConversa(selectedDeviceId ?? '', conv.remote_sender))
        const assignedToMe = !!assignment
          && (assignment.status === 'taken' || assignment.status === 'assigned')
          && assignment.assigned_to === user?.id

        // Mesmo cursor combinado do caminho por resumos, acima.
        const readCursor = cursorDeLeitura(state?.last_read_at, assignment?.global_read_at)

        if (state?.manual_unread) {
          conv.unread_count = Math.max(1, conv.messages.filter(
            (m: any) => m.direction === 'inbound' && (!readCursor || new Date(m.created_at) > new Date(readCursor)),
          ).length)
        } else if (readCursor) {
          const lastRead = new Date(readCursor)
          conv.unread_count = conv.messages.filter(
            (m: any) => m.direction === 'inbound' && new Date(m.created_at) > lastRead,
          ).length
        } else {
          conv.unread_count = 0
        }

        conv.pinned = (state?.pinned ?? false) || assignedToMe
        conv.archived = state?.archived ?? false

        if (conv.lastMessage?.sender_name && conv.lastMessage.direction === 'inbound') {
          conv.sender_name = conv.lastMessage.sender_name
        }
        const respondedAt = respondidaEm(state?.responded_at, assignment?.global_responded_at)
        conv.pendingReply = conv.lastMessage?.direction === 'inbound' && (!respondedAt || new Date(conv.lastMessage.created_at) > new Date(respondedAt))
        return conv
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        return new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
      })
  }, [conversationSummaries, messages, userStates, selectedDeviceId, assignments, user?.id])

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)

  const currentConversation = useMemo(() => {
    const baseConv = conversations.find((c) => c.remote_sender === selectedContact)
    if (!baseConv) return undefined
    return {
      ...baseConv,
      messages: conversationMessages,
    }
  }, [conversations, selectedContact, conversationMessages])

  const currentAssignment = useMemo(() => {
    if (!selectedContact || !selectedDeviceId) return null
    return assignments.get(chaveDaConversa(selectedDeviceId, selectedContact)) ?? null
  }, [assignments, selectedContact, selectedDeviceId])

  const containerRef = useRef<HTMLDivElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth

  const clampSidebarWidth = useCallback((width: number, containerWidth?: number) => {
    let max = SIDEBAR_MAX
    if (containerWidth) {
      max = Math.min(SIDEBAR_MAX, containerWidth - CHAT_MIN)
    }
    return Math.max(SIDEBAR_MIN, Math.min(width, max))
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    const cw = containerRef.current?.clientWidth
    if (stored && cw) {
      const parsed = Number(stored)
      if (Number.isFinite(parsed)) {
        setSidebarWidth(clampSidebarWidth(parsed, cw))
      }
    }
  }, [clampSidebarWidth])

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setSidebarWidth((prev) => clampSidebarWidth(prev, containerRef.current!.clientWidth))
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [clampSidebarWidth])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidthRef.current
    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX
      const newWidth = clampSidebarWidth(startWidth + delta, containerRect.width)
      setSidebarWidth(newWidth)
    }

    const handlePointerUp = () => {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidthRef.current))
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
  }, [clampSidebarWidth])

  return (
    <div ref={containerRef} className="h-full w-full relative bg-chat-app border-chat-border flex rounded-none md:rounded-2xl border overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.4)]">

      {(!isMobile || !selectedContact) && (
        isMobile ? (
          <ChatList
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={handleSelectDevice}
            conversations={conversations}
            contacts={contacts}
            selectedContact={selectedContact}
            onSelectContact={setSelectedContact}
            isMobile={true}
            conversationStates={userStates}
            onOpenInfo={handleOpenInfo}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived(!showArchived)}
            onStateChange={refreshConversationStates}
            noteJids={noteJids}
            assignments={assignments}
            currentUserId={user?.id}
            onRefreshAll={handleRefreshAll}
            isRefreshingAll={isRefreshingAll}
            carregandoConversas={carregandoConversas}
          />
        ) : (
          <div
            className="flex flex-col h-full bg-chat-sidebar border-r border-chat-border relative flex-shrink-0"
            style={{ width: sidebarWidth }}
          >
            <ChatList
              devices={devices}
              selectedDeviceId={selectedDeviceId}
              onSelectDevice={handleSelectDevice}
              conversations={conversations}
              contacts={contacts}
              selectedContact={selectedContact}
              onSelectContact={setSelectedContact}
              isMobile={false}
              conversationStates={userStates}
              onOpenInfo={handleOpenInfo}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived(!showArchived)}
              onStateChange={refreshConversationStates}
              noteJids={noteJids}
              assignments={assignments}
              currentUserId={user?.id}
              onRefreshAll={handleRefreshAll}
              isRefreshingAll={isRefreshingAll}
            carregandoConversas={carregandoConversas}
            />
            <div
              className="absolute -right-[6px] top-0 bottom-0 w-[14px] cursor-col-resize z-10 flex items-center justify-center"
              onPointerDown={handlePointerDown}
            >
              <div className="w-1 h-3/5 mx-auto hover:bg-blue-400/40 active:bg-blue-500/50 transition-colors rounded-full" />
            </div>
          </div>
        )
      )}
      {(!isMobile || selectedContact) && (
        <ChatWindow
          device={selectedDevice}
          contact={selectedContact}
          conversation={currentConversation}
          assignment={currentAssignment}
          onAssignmentChange={aplicarAtribuicao}
          contacts={contacts}
          onBack={handleCloseConversation}
          isMobile={isMobile}
          sheetOpen={isSheetOpen}
          onSheetOpenChange={setIsSheetOpen}
          onStartConversation={handleOpenNewContact}
          onOpenConversationByJid={handleOpenConversationByJid}
          onOptimisticSend={addOptimisticMessage}
          onOptimisticConfirm={confirmOptimisticMessage}
          onOptimisticFail={markOptimisticFailed}
          onOptimisticDiscard={discardOptimisticMessage}
          estadoConversa={estadoConversa}
          onRetryMessages={handleRetryMessages}
          conversas={conversations}
          onForwardMessage={handleForwardMessage}
        />
      )}
      <Dialog open={isNewContactOpen} onOpenChange={setIsNewContactOpen}>
        <DialogContent className="sm:max-w-[440px] bg-chat-panel border-chat-border">
          <DialogHeader>
            <DialogTitle>Adicionar nova conversa</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="new-contact-name">Nome (opcional)</Label>
              <Input
                id="new-contact-name"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder="Nome do contato"
                className="bg-chat-sidebar border-chat-border text-chat-text"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="new-contact-ddd">DDD</Label>
                <Input
                  id="new-contact-ddd"
                  value={newContactDdd}
                  onChange={(e) => setNewContactDdd(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  placeholder="11"
                  inputMode="numeric"
                  maxLength={2}
                  className="bg-chat-sidebar border-chat-border text-chat-text text-center"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="new-contact-number">Número</Label>
                <Input
                  id="new-contact-number"
                  value={newContactNumber}
                  onChange={(e) => setNewContactNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
                  placeholder="99999-9999"
                  inputMode="numeric"
                  maxLength={9}
                  className="bg-chat-sidebar border-chat-border text-chat-text"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewContactOpen(false)} disabled={isCreatingContact}>
              Cancelar
            </Button>
            <Button onClick={handleCreateContact} disabled={isCreatingContact}>
              {isCreatingContact ? 'Criando...' : 'Criar conversa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
