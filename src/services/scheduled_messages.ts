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
  device_name?: string | null
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
  const missingSenders: string[] = []
  if (contacts) {
    for (const c of contacts) {
      if (c.name) {
        nameMap[c.remote_jid] = c.name
      } else {
        missingSenders.push(c.remote_jid)
      }
    }
  }

  const sendersWithoutContact = remoteSenders.filter((s) => !(s in nameMap))
  missingSenders.push(...sendersWithoutContact)

  if (missingSenders.length > 0) {
    const { data: msgNames } = await supabase
      .from('messages')
      .select('remote_sender, sender_name')
      .in('remote_sender', missingSenders)
      .not('sender_name', 'is', null)
      .order('created_at', { ascending: false })

    if (msgNames) {
      const seen = new Set<string>()
      for (const m of msgNames) {
        if (m.sender_name && !seen.has(m.remote_sender) && !nameMap[m.remote_sender]) {
          nameMap[m.remote_sender] = m.sender_name
          seen.add(m.remote_sender)
        }
      }
    }
  }

  const deviceIds = [...new Set(messages.map((m) => m.device_id))]
  const { data: devices } = await supabase
    .from('devices')
    .select('id, name')
    .in('id', deviceIds)

  const deviceNameMap: Record<string, string | null> = {}
  if (devices) {
    for (const d of devices) {
      deviceNameMap[d.id] = d.name || null
    }
  }

  return messages.map((msg) => ({
    ...msg,
    contact_name: nameMap[msg.remote_sender] ?? null,
    device_name: deviceNameMap[msg.device_id] ?? null,
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

export const retryScheduledMessage = async (id: string) => {
  const { data, error } = await supabase
    .from('scheduled_messages')
    .update({ status: 'pending', error_message: null, processed_at: null })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as ScheduledMessage
}
