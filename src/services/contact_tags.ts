import supabase from '@/lib/supabase/client'
import type { ContactTag } from '@/lib/supabase/types'

export const getContactTags = async (deviceId: string) => {
  const { data } = await supabase
    .from('contact_tags')
    .select('*, label_id(*)')
    .eq('device_id', deviceId)
  return (data as unknown as ContactTag[]) || []
}

export const toggleContactTag = async (deviceId: string, remoteSender: string, labelId: string) => {
  const { data: existing } = await supabase
    .from('contact_tags')
    .select('id')
    .eq('device_id', deviceId)
    .eq('remote_sender', remoteSender)
    .eq('label_id', labelId)
    .maybeSingle()

  if (existing) {
    await supabase.from('contact_tags').delete().eq('id', existing.id)
    return { action: 'removed' as const, id: existing.id }
  }

  const { data: created } = await supabase
    .from('contact_tags')
    .insert({ device_id: deviceId, remote_sender: remoteSender, label_id: labelId })
    .select()
    .single()
  return { action: 'added' as const, id: created.id }
}
