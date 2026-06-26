import supabase from '@/lib/supabase/client'
import type { Note } from '@/lib/supabase/types'

export const getNotes = async () => {
  const { data } = await supabase.from('notes').select('*').order('created_at', { ascending: false })
  return (data as Note[]) || []
}

export const getNotesByContact = async (contactJid: string) => {
  const { data } = await supabase
    .from('notes')
    .select('*')
    .eq('contact_jid', contactJid)
    .order('created_at', { ascending: false })
  return (data as Note[]) || []
}

export const getNote = async (id: string) => {
  const { data } = await supabase.from('notes').select('*').eq('id', id).single()
  return data as Note | null
}

export const createNote = async (data: {
  title: string
  content: string
  user_id: string
  contact_jid?: string | null
  contact_name?: string | null
  category?: 'geral' | 'financeiro' | 'rh' | 'administrativo'
}) => {
  const { data: note } = await supabase.from('notes').insert(data).select().single()
  return note as Note
}

export const updateNote = async (id: string, data: Partial<{ title: string; content: string }>) => {
  const { data: note } = await supabase.from('notes').update(data).eq('id', id).select().single()
  return note as Note
}

export const deleteNote = async (id: string) => {
  await supabase.from('notes').delete().eq('id', id)
}
