import supabase from '@/lib/supabase/client'
import type { ScheduledMessage } from '@/lib/supabase/types'

export const getScheduledMessages = async () => {
  const { data } = await supabase
    .from('scheduled_messages')
    .select('*')
    .order('scheduled_at', { ascending: false })
  return (data as ScheduledMessage[]) || []
}

export const createScheduledMessage = async (
  data: {
    content: string
    scheduled_at: string
    status: string
    device_id: string
    remote_sender: string
    user_id: string
  },
) => {
  const { data: msg } = await supabase
    .from('scheduled_messages')
    .insert(data)
    .select()
    .single()
  return msg as ScheduledMessage
}

export const updateScheduledMessage = async (id: string, data: Partial<ScheduledMessage>) => {
  const { data: msg } = await supabase
    .from('scheduled_messages')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  return msg as ScheduledMessage
}

export const deleteScheduledMessage = async (id: string) => {
  await supabase.from('scheduled_messages').delete().eq('id', id)
}
