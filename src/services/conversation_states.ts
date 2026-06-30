import supabase from '@/lib/supabase/client'
import type { ConversationAssignment, TeamMember, ConversationRecentViewer } from '@/lib/supabase/types'

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
  responded_at: string | null
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
  const { error } = await supabase.rpc('mark_conversation_read', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error marking conversation as read:', error)
}

export async function markConversationUnread(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_unread', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error marking conversation as unread:', error)
}

export async function togglePin(deviceId: string, remoteSender: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('toggle_conversation_pin', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error toggling pin:', error)
    return null
  }
  return data as boolean
}

export async function toggleArchive(deviceId: string, remoteSender: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('toggle_conversation_archive', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error toggling archive:', error)
    return null
  }
  return data as boolean
}

export interface ConversationViewer {
  user_id: string
  user_name: string
  last_read_at: string | null
  last_opened_at: string | null
}

export async function markAllConversationsReadForDevice(deviceId: string): Promise<void> {
  const { data } = await supabase
    .from('messages')
    .select('remote_sender')
    .eq('device_id', deviceId)
    .eq('direction', 'inbound')
    .is('deleted_at', null)
  const senders = [...new Set((data || []).map((r: { remote_sender: string }) => r.remote_sender))]
  await Promise.all(senders.map((s) => markConversationRead(deviceId, s)))
}

export async function toggleResponded(deviceId: string, remoteSender: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('toggle_conversation_responded', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error toggling responded:', error)
    return null
  }
  return data as string | null
}

export async function getConversationViewers(deviceId: string, remoteSender: string): Promise<ConversationViewer[]> {
  const { data, error } = await supabase.rpc('get_conversation_viewers', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error fetching conversation viewers:', error)
    return []
  }
  return (data as ConversationViewer[]) || []
}

export async function markConversationReadGlobal(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read_global', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error marking conversation as globally read:', error)
}

export async function takeConversation(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('take_conversation', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error taking conversation:', error)
}

export async function assignConversation(deviceId: string, remoteSender: string, targetUserId: string): Promise<void> {
  const { error } = await supabase.rpc('assign_conversation', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
    p_target_user_id: targetUserId,
  })
  if (error) console.error('Error assigning conversation:', error)
}

export async function setConversationWaiting(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('set_conversation_waiting', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error setting conversation to waiting:', error)
}

export async function finishConversation(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('finish_conversation', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error finishing conversation:', error)
}

export async function getConversationAssignment(deviceId: string, remoteSender: string): Promise<ConversationAssignment | null> {
  const { data, error } = await supabase.rpc('get_conversation_assignment', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error fetching conversation assignment:', error)
    return null
  }
  return (data?.[0] as ConversationAssignment) ?? null
}

export async function getDeviceTeamMembers(deviceId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc('get_device_team_members', {
    p_device_id: deviceId,
  })
  if (error) {
    console.error('Error fetching team members:', error)
    return []
  }
  return (data as TeamMember[]) || []
}

export async function getConversationRecentViewers(deviceId: string, remoteSender: string): Promise<ConversationRecentViewer[]> {
  const { data, error } = await supabase.rpc('get_conversation_recent_viewers', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error fetching conversation viewers:', error)
    return []
  }
  return (data as ConversationRecentViewer[]) || []
}
