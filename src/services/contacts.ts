import supabase from '@/lib/supabase/client'
import type { Contact } from '@/lib/supabase/types'

export const getContacts = async () => {
  const { data } = await supabase.from('contacts').select('*')
  return (data as Contact[]) || []
}

export const getContact = async (id: string) => {
  const { data } = await supabase.from('contacts').select('*').eq('id', id).single()
  return data as Contact | null
}

export const updateContactByJid = async (
  jid: string,
  data: Partial<{ nickname: string; name: string; resolved_at: string }>,
) => {
  const existing = await supabase.from('contacts').select('*').eq('remote_jid', jid).maybeSingle()

  if (existing.data) {
    const { data: updated } = await supabase
      .from('contacts')
      .update(data)
      .eq('id', existing.data.id)
      .select()
      .single()
    return updated as Contact
  }

  const { data: created } = await supabase
    .from('contacts')
    .insert({ remote_jid: jid, ...data })
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
const requestQueue: (() => void)[] = []

const processQueue = () => {
  if (activeRequests < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
    const next = requestQueue.shift()
    if (next) {
      activeRequests++
      next()
    }
  }
}

const enqueueRequest = <T>(task: () => Promise<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    requestQueue.push(() => {
      task()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeRequests--
          processQueue()
        })
    })
    processQueue()
  })
}

export const fetchAvatar = (jid: string, instanceKey: string, options?: { retry?: boolean }) => {
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

  const promise = enqueueRequest(async () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token || ''

    const res = await fetch(
      `${supabaseUrl}/functions/v1/contact-avatar?jid=${encodeURIComponent(jid)}&instance=${encodeURIComponent(instanceKey)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    return res.json()
  })
    .catch((err) => {
      avatarFailedSet.add(cacheKey)
      setTimeout(() => avatarFailedSet.delete(cacheKey), 120000)
      throw err
    })
    .finally(() => {
      setTimeout(() => avatarFetchPromises.delete(cacheKey), 10000)
    })

  avatarFetchPromises.set(cacheKey, promise)
  return promise
}

export const resolveContact = async (jid: string) => {
  const now = new Date().toISOString()
  return updateContactByJid(jid, { resolved_at: now } as any)
}
