import supabase from '@/lib/supabase/client'
import type { MessageTrigger } from '@/lib/supabase/types'

export const getTriggers = async () => {
  const { data } = await supabase
    .from('message_triggers')
    .select('*')
    .order('created_at', { ascending: false })
  return (data as MessageTrigger[]) || []
}

export const createTrigger = async (data: { title: string; content: string; user_id: string }) => {
  const { data: trigger } = await supabase.from('message_triggers').insert(data).select().single()
  return trigger as MessageTrigger
}

export const updateTrigger = async (id: string, data: Partial<{ title: string; content: string }>) => {
  const { data: trigger } = await supabase.from('message_triggers').update(data).eq('id', id).select().single()
  return trigger as MessageTrigger
}

export const deleteTrigger = async (id: string) => {
  await supabase.from('message_triggers').delete().eq('id', id)
}
