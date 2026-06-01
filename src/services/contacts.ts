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

export const fetchAvatar = (jid: string, instanceKey: string) => {
  const cacheKey = `${instanceKey}:${jid}`

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
