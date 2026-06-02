import supabase from '@/lib/supabase/client'

export interface ConversationUserState {
  id: string
  device_id: string
  remote_sender: string
  user_id: string
  last_read_message_id: string | null
  last_read_at: string | null
  last_opened_at: string | null
  manual_unread: boolean
  manual_unread_at: string | null
  marked_unread_by_user_id: string | null
  pinned: boolean
  pinned_at: string | null
  archived: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

export async function getMyStates(): Promise<ConversationUserState[]> {
  const { data, error } = await supabase
    .from('conversation_user_states')
    .select('*')
    .eq('user_id', (await supabase.auth.getSession()).data.session?.user?.id || '')
  if (error) {
    console.error('Error fetching conversation states:', error)
    return []
  }
  return (data as ConversationUserState[]) || []
}

export async function markConversationRead(deviceId: string, remoteSender: string): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token || ''

  if (!supabaseUrl || !token) return

  try {
    await fetch(`${supabaseUrl}/rest/v1/rpc/mark_conversation_read`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_device_id: deviceId, p_remote_sender: remoteSender }),
    })
  } catch (err) {
    console.error('Error marking conversation as read:', err)
  }
}

export async function markConversationUnread(deviceId: string, remoteSender: string): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token || ''

  if (!supabaseUrl || !token) return

  try {
    await fetch(`${supabaseUrl}/rest/v1/rpc/mark_conversation_unread`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_device_id: deviceId, p_remote_sender: remoteSender }),
    })
  } catch (err) {
    console.error('Error marking conversation as unread:', err)
  }
}

async function callRpc<T>(rpcName: string, params: Record<string, unknown>): Promise<T | null> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token || ''
  if (!supabaseUrl || !token) return null
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data as T
  } catch (err) {
    console.error(`Error calling ${rpcName}:`, err)
    return null
  }
}

export async function togglePin(deviceId: string, remoteSender: string): Promise<boolean | null> {
  return callRpc<boolean>('toggle_conversation_pin', { p_device_id: deviceId, p_remote_sender: remoteSender })
}

export async function toggleArchive(deviceId: string, remoteSender: string): Promise<boolean | null> {
  return callRpc<boolean>('toggle_conversation_archive', { p_device_id: deviceId, p_remote_sender: remoteSender })
}

export interface ConversationViewer {
  user_id: string
  user_name: string
  last_read_at: string | null
  last_opened_at: string | null
}

export async function getConversationViewers(deviceId: string, remoteSender: string): Promise<ConversationViewer[]> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token || ''

  if (!supabaseUrl || !token) return []

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_conversation_viewers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_device_id: deviceId, p_remote_sender: remoteSender }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data as ConversationViewer[]) || []
  } catch (err) {
    console.error('Error fetching conversation viewers:', err)
    return []
  }
}
