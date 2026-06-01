import supabase from '@/lib/supabase/client'
import type { Label } from '@/lib/supabase/types'

export const getLabels = async () => {
  const { data } = await supabase.from('labels').select('*').order('created_at', { ascending: false })
  return (data as Label[]) || []
}

export const createLabel = async (data: { name: string; color: string; user_id: string }) => {
  const { data: label } = await supabase.from('labels').insert(data).select().single()
  return label as Label
}

export const updateLabel = async (id: string, data: Partial<{ name: string; color: string }>) => {
  const { data: label } = await supabase.from('labels').update(data).eq('id', id).select().single()
  return label as Label
}

export const deleteLabel = async (id: string) => {
  await supabase.from('labels').delete().eq('id', id)
}
