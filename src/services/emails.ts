import { supabase } from '@/lib/supabase/client'
import type { Email, EmailFilters } from '@/lib/supabase/email-types'

export async function getEmails(
  account_id: string,
  filters: EmailFilters = {},
  limit = 100
): Promise<Email[]> {
  let query = supabase
    .from('emails')
    .select('*')
    .eq('account_id', account_id)
    .eq('is_archived', filters.is_archived ?? false)
    .order('received_at', { ascending: false })
    .limit(limit)

  if (filters.folder_id !== undefined) {
    if (filters.folder_id === null) {
      query = query.is('folder_id', null)
    } else {
      query = query.eq('folder_id', filters.folder_id)
    }
  }

  if (filters.is_read !== undefined) {
    query = query.eq('is_read', filters.is_read)
  }

  if (filters.is_starred) {
    query = query.eq('is_starred', true)
  }

  if (filters.ai_sentiment) {
    query = query.eq('ai_sentiment', filters.ai_sentiment)
  }

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function searchEmails(
  account_id: string,
  search: string,
  limit = 50
): Promise<Email[]> {
  const q = search.replace(/[%_]/g, '\\$&')
  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .eq('account_id', account_id)
    .or(`subject.ilike.%${q}%,from_name.ilike.%${q}%,from_email.ilike.%${q}%,body_text.ilike.%${q}%`)
    .order('received_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function getEmail(id: string): Promise<Email | null> {
  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getThreadEmails(thread_id: string): Promise<Email[]> {
  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .eq('thread_id', thread_id)
    .order('received_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function markEmailRead(id: string, is_read: boolean): Promise<void> {
  const { error } = await supabase
    .from('emails')
    .update({ is_read })
    .eq('id', id)
  if (error) throw error
}

export async function markEmailStarred(id: string, is_starred: boolean): Promise<void> {
  const { error } = await supabase
    .from('emails')
    .update({ is_starred })
    .eq('id', id)
  if (error) throw error
}

export async function archiveEmail(id: string): Promise<void> {
  const { error } = await supabase
    .from('emails')
    .update({ is_archived: true })
    .eq('id', id)
  if (error) throw error
}

export async function moveEmailToFolder(id: string, folder_id: string | null): Promise<void> {
  const { error } = await supabase
    .from('emails')
    .update({ folder_id })
    .eq('id', id)
  if (error) throw error
}

export async function getUnreadCount(account_id: string): Promise<number> {
  const { count, error } = await supabase
    .from('emails')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account_id)
    .eq('is_read', false)
    .eq('is_archived', false)
  if (error) throw error
  return count ?? 0
}

// Envia email via Edge Function email-send
export async function sendEmail(payload: {
  account_id: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body_html: string
  body_text?: string
  reply_to_email_id?: string
  scheduled_message_id?: string
}): Promise<Email> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Usuário não autenticado')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const resp = await fetch(`${supabaseUrl}/functions/v1/email-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  })

  const result = await resp.json()
  if (!resp.ok) {
    throw new Error(result.error || 'Falha ao enviar email')
  }

  return result.email as Email
}

// Aplica ou remove etiqueta de um email
export async function applyEmailLabel(email_id: string, label_id: string): Promise<void> {
  const { error } = await supabase
    .from('contact_tags')
    .insert({ email_id, label_id })
  if (error && error.code !== '23505') throw error // ignora duplicata
}

export async function removeEmailLabel(email_id: string, label_id: string): Promise<void> {
  const { error } = await supabase
    .from('contact_tags')
    .delete()
    .eq('email_id', email_id)
    .eq('label_id', label_id)
  if (error) throw error
}

export async function getEmailLabels(email_id: string) {
  const { data, error } = await supabase
    .from('contact_tags')
    .select('label_id, labels(id, name, color)')
    .eq('email_id', email_id)
  if (error) throw error
  return data ?? []
}
