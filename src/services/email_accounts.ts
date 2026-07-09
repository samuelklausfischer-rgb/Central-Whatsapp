import { supabase } from '@/lib/supabase/client'
import type { EmailAccount } from '@/lib/supabase/email-types'

export async function getEmailAccounts(): Promise<EmailAccount[]> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function getAllEmailAccounts(): Promise<EmailAccount[]> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function getEmailAccount(id: string): Promise<EmailAccount | null> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createEmailAccount(
  data: Omit<EmailAccount, 'id' | 'created_at' | 'updated_at' | 'last_sync_at'>
): Promise<EmailAccount> {
  const { data: created, error } = await supabase
    .from('email_accounts')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return created
}

export async function updateEmailAccount(
  id: string,
  data: Partial<EmailAccount>
): Promise<EmailAccount> {
  const { data: updated, error } = await supabase
    .from('email_accounts')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return updated
}

export async function deleteEmailAccount(id: string): Promise<void> {
  const { error } = await supabase
    .from('email_accounts')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function setEmailAccountActive(id: string, is_active: boolean): Promise<void> {
  const { error } = await supabase
    .from('email_accounts')
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
