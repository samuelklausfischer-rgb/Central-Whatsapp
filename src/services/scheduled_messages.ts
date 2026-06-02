import supabase from '@/lib/supabase/client'
import type { ScheduledAttachment, ScheduledMessage } from '@/lib/supabase/types'

export type CreateScheduledMessageInput = {
  content: string
  scheduled_at: string
  status?: ScheduledMessage['status']
  device_id: string
  remote_sender: string
  user_id: string
  attachments?: ScheduledAttachment[] | null
}

export type ScheduledMessageWithContact = ScheduledMessage & {
  contact_name?: string | null
}

export const getScheduledMessages = async () => {
  const { data, error } = await supabase
    .from('scheduled_messages')
    .select('*')
    .order('scheduled_at', { ascending: false })
  if (error) throw new Error(error.message)
  const messages = (data as ScheduledMessage[]) || []

  if (messages.length === 0) return messages

  const remoteSenders = [...new Set(messages.map((m) => m.remote_sender))]

  const { data: contacts } = await supabase
    .from('contacts')
    .select('remote_jid, name')
    .in('remote_jid', remoteSenders)

  const nameMap: Record<string, string | null> = {}
  if (contacts) {
    for (const c of contacts) {
      nameMap[c.remote_jid] = c.name || null
    }
  }

  return messages.map((msg) => ({
    ...msg,
    contact_name: nameMap[msg.remote_sender] ?? null,
  })) as ScheduledMessageWithContact[]
}

export const createScheduledMessage = async (data: CreateScheduledMessageInput) => {
  const { data: msg, error } = await supabase
    .from('scheduled_messages')
    .insert({ ...data, status: data.status || 'pending' })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return msg as ScheduledMessage
}

export const updateScheduledMessage = async (id: string, data: Partial<ScheduledMessage>) => {
  const { data: msg, error } = await supabase
    .from('scheduled_messages')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return msg as ScheduledMessage
}

export const deleteScheduledMessage = async (id: string) => {
  const { error } = await supabase.from('scheduled_messages').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
