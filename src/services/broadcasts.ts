import supabase from '@/lib/supabase/client'

export interface Broadcast {
  id: string
  title: string | null
  message: string
  created_by: string | null
  created_at: string
}

export interface BroadcastReadStatus {
  broadcast: Broadcast
  total: number
  seen: number
  seenUsers: { id: string; name: string | null; email: string | null; read_at: string }[]
  unseenUsers: { id: string; name: string | null; email: string | null }[]
}

/** Envia um broadcast (só super-admin — a RLS bloqueia os demais). */
export const sendBroadcast = async (message: string, title?: string) => {
  const { data, error } = await supabase
    .from('app_broadcasts')
    .insert({ message, title: title || null })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Broadcast
}

/** Broadcasts ainda não lidos pelo usuário atual (para exibir o popup ao abrir/logar). */
export const getUnreadBroadcasts = async (userId: string): Promise<Broadcast[]> => {
  const { data: reads } = await supabase
    .from('broadcast_reads')
    .select('broadcast_id')
    .eq('user_id', userId)
  const readIds = new Set(((reads as { broadcast_id: string }[]) || []).map((r) => r.broadcast_id))

  const { data } = await supabase
    .from('app_broadcasts')
    .select('*')
    .order('created_at', { ascending: true })
  return ((data as Broadcast[]) || []).filter((b) => !readIds.has(b.id))
}

/** Marca um broadcast como lido pelo usuário atual. */
export const markBroadcastRead = async (broadcastId: string) => {
  const { error } = await supabase.rpc('mark_broadcast_read', { p_broadcast_id: broadcastId })
  if (error) throw new Error(error.message)
}

/** Painel do super-admin: broadcasts com "quem viu / quem não viu". */
export const getBroadcastReadStatus = async (): Promise<BroadcastReadStatus[]> => {
  const [{ data: broadcasts }, { data: profiles }, { data: reads }] = await Promise.all([
    supabase.from('app_broadcasts').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, name, email'),
    supabase.from('broadcast_reads').select('broadcast_id, user_id, read_at'),
  ])

  const users = ((profiles as { id: string; name: string | null; email: string | null }[]) || [])
  const readsList = ((reads as { broadcast_id: string; user_id: string; read_at: string }[]) || [])

  return ((broadcasts as Broadcast[]) || []).map((b) => {
    const readsOfB = readsList.filter((r) => r.broadcast_id === b.id)
    const seenIds = new Map(readsOfB.map((r) => [r.user_id, r.read_at]))
    const seenUsers = users
      .filter((u) => seenIds.has(u.id))
      .map((u) => ({ ...u, read_at: seenIds.get(u.id) as string }))
    const unseenUsers = users.filter((u) => !seenIds.has(u.id))
    return { broadcast: b, total: users.length, seen: seenUsers.length, seenUsers, unseenUsers }
  })
}
