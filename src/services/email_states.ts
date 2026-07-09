import { supabase } from '@/lib/supabase/client'
import type { EmailState } from '@/lib/supabase/email-types'

export async function getEmailState(email_id: string): Promise<EmailState | null> {
  const { data, error } = await supabase
    .from('email_states')
    .select('*')
    .eq('email_id', email_id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getEmailStates(email_ids: string[]): Promise<EmailState[]> {
  if (!email_ids.length) return []
  const { data, error } = await supabase
    .from('email_states')
    .select('*')
    .in('email_id', email_ids)
  if (error) throw error
  return data ?? []
}

export async function createEmailState(email_id: string, sla_hours = 24): Promise<EmailState> {
  const sla_deadline = new Date(Date.now() + sla_hours * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('email_states')
    .insert({ email_id, status: 'open', sla_hours, sla_deadline })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateEmailState(
  email_id: string,
  data: Partial<EmailState>
): Promise<EmailState> {
  const { data: updated, error } = await supabase
    .from('email_states')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('email_id', email_id)
    .select()
    .single()
  if (error) throw error
  return updated
}

export async function assignEmail(email_id: string, user_id: string | null): Promise<void> {
  const { error } = await supabase
    .from('email_states')
    .update({ assigned_to: user_id, updated_at: new Date().toISOString() })
    .eq('email_id', email_id)
  if (error) throw error
}

export async function setEmailStatus(
  email_id: string,
  status: EmailState['status']
): Promise<void> {
  const update: Partial<EmailState> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (status === 'replied') {
    update.responded_at = new Date().toISOString()
  }
  const { error } = await supabase
    .from('email_states')
    .update(update)
    .eq('email_id', email_id)
  if (error) throw error
}

export async function closeEmail(email_id: string): Promise<void> {
  return setEmailStatus(email_id, 'closed')
}

// Emails aguardando resposta (para pasta inteligente "Aguardando")
export async function getWaitingEmails(account_id: string) {
  const { data, error } = await supabase
    .from('email_states')
    .select('*, emails!inner(id, subject, from_email, from_name, received_at, account_id)')
    .eq('status', 'waiting')
    .eq('emails.account_id', account_id)
    .order('sla_deadline', { ascending: true })
  if (error) throw error
  return data ?? []
}

// Emails atribuídos ao usuário atual
export async function getMyAssignedEmails(account_id: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('email_states')
    .select('*, emails!inner(id, subject, from_email, from_name, received_at, account_id, is_read)')
    .eq('assigned_to', user.id)
    .eq('emails.account_id', account_id)
    .neq('status', 'closed')
  if (error) throw error
  return data ?? []
}
