import supabase from '@/lib/supabase/client'
import type { Message } from '@/lib/supabase/types'

export interface ConversationSummary {
  remote_sender: string
  sender_name: string
  last_message_id: string
  last_message_content: string
  last_message_direction: string
  last_message_created_at: string
  last_message_is_read: boolean
  last_message_attachments: Record<string, unknown> | null
  unread_count: number
  message_count: number
}

export const getConversationSummaries = async (deviceId: string): Promise<ConversationSummary[]> => {
  const { data, error } = await supabase.rpc('get_conversation_summaries', {
    p_device_id: deviceId,
  })
  if (error) throw new Error(error.message)
  return (data as ConversationSummary[]) || []
}

export const getConversationMessages = async (
  deviceId: string,
  remoteSender: string,
  limit = 500
): Promise<Message[]> => {
  // Postgrest aplica ORDER BY antes do LIMIT: para pegar as mensagens mais
  // RECENTES (e não as mais antigas) é preciso ordenar desc, limitar, e só
  // então reverter para ordem cronológica — mesmo padrão do getMessages().
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('device_id', deviceId)
    .eq('remote_sender', remoteSender)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data as Message[]) || []).reverse()
}

export const getMessages = async (deviceId: string) => {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(2000)
  return ((data as Message[]) || []).reverse()
}

export async function reactToMessage(messageId: string, reaction: string, deviceId: string, senderId: string) {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw new Error('Not authenticated')

  const { data: result, error } = await supabase.rpc('send_whatsapp_reaction', {
    p_message_id: messageId,
    p_reaction: reaction,
    p_device_id: deviceId,
    p_sender_id: senderId || null,
  })

  if (error) throw new Error(error.message)

  const parsed = typeof result === 'string' ? JSON.parse(result) : result
  if (parsed?.error) throw new Error(parsed.error)

  return parsed
}

export const sendMessage = async (data: {
  content: string
  device_id: string
  sender_id: string
  is_read: boolean
  direction?: string
  remote_sender?: string
  attachments?: File[]
  mediaUrl?: string
  mediaType?: string
  mediaName?: string
  reply_to_id?: string
}) => {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw new Error('Not authenticated')

  if (!data.remote_sender) {
    throw new Error('remote_sender is required')
  }

  const { data: result, error } = await supabase.rpc('send_whatsapp_message', {
    p_device_id: data.device_id,
    p_remote_sender: data.remote_sender,
    p_content: data.content,
    p_sender_id: data.sender_id || null,
    p_media_url: data.mediaUrl || null,
    p_media_type: data.mediaType || null,
    p_media_name: data.mediaName || null,
    p_reply_to_id: data.reply_to_id || null,
  })

  if (error) throw new Error(error.message)

  const parsed = typeof result === 'string' ? JSON.parse(result) : result
  if (parsed?.error) {
    const detail = parsed.status ? ` (status ${parsed.status})` : ''
    throw new Error(parsed.error + detail)
  }

  return parsed
}

export async function deleteMessage(messageId: string, deviceId: string, deleteForEveryone: boolean) {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw new Error('Not authenticated')

  const { data: result, error } = await supabase.rpc('delete_whatsapp_message', {
    p_message_id: messageId,
    p_device_id: deviceId,
    p_delete_for_everyone: deleteForEveryone,
  })

  if (error) throw new Error(error.message)

  const parsed = typeof result === 'string' ? JSON.parse(result) : result
  if (parsed?.error) throw new Error(parsed.error)

  return parsed
}

export async function editMessage(messageId: string, deviceId: string, newContent: string) {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw new Error('Not authenticated')

  const { data: result, error } = await supabase.rpc('edit_whatsapp_message', {
    p_message_id: messageId,
    p_device_id: deviceId,
    p_new_content: newContent,
  })

  if (error) throw new Error(error.message)

  const parsed = typeof result === 'string' ? JSON.parse(result) : result
  if (parsed?.error) throw new Error(parsed.error)

  return parsed
}
