import { supabase } from '@/lib/supabase/client'
import type { EmailFolder } from '@/lib/supabase/email-types'

export async function getFolders(account_id: string): Promise<EmailFolder[]> {
  const { data, error } = await supabase
    .from('email_folders')
    .select('*')
    .eq('account_id', account_id)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createFolder(
  data: Omit<EmailFolder, 'id' | 'created_at'>
): Promise<EmailFolder> {
  const { data: created, error } = await supabase
    .from('email_folders')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return created
}

export async function updateFolder(
  id: string,
  data: Partial<EmailFolder>
): Promise<EmailFolder> {
  const { data: updated, error } = await supabase
    .from('email_folders')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return updated
}

export async function deleteFolder(id: string): Promise<void> {
  const { error } = await supabase
    .from('email_folders')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// Cria as pastas padrão para uma conta recém-criada
export async function createSystemFolders(account_id: string): Promise<void> {
  const systemFolders: Omit<EmailFolder, 'id' | 'created_at'>[] = [
    { account_id, name: 'INBOX',        display_name: 'Entrada',  imap_path: 'INBOX',        is_smart: false, smart_filter: null, color: null, icon: 'Inbox',  sort_order: 0, is_system: true },
    { account_id, name: 'SENT',         display_name: 'Enviados', imap_path: 'Sent',         is_smart: false, smart_filter: null, color: null, icon: 'Send',   sort_order: 1, is_system: true },
    { account_id, name: 'DRAFTS',       display_name: 'Rascunhos',imap_path: 'Drafts',       is_smart: false, smart_filter: null, color: null, icon: 'FileEdit',sort_order: 2, is_system: true },
    { account_id, name: 'ARCHIVE',      display_name: 'Arquivo',  imap_path: 'Archive',      is_smart: false, smart_filter: null, color: null, icon: 'Archive',sort_order: 3, is_system: true },
    { account_id, name: 'SPAM',         display_name: 'Spam',     imap_path: 'Spam',         is_smart: false, smart_filter: null, color: null, icon: 'ShieldX',sort_order: 4, is_system: true },
    // Pastas inteligentes
    { account_id, name: 'WAITING',      display_name: 'Aguardando',imap_path: null,           is_smart: true,  smart_filter: { status: 'waiting' }, color: '#F59E0B', icon: 'Clock',      sort_order: 10, is_system: true },
    { account_id, name: 'PRIORITY',     display_name: 'Prioritários',imap_path: null,          is_smart: true,  smart_filter: { ai_sentiment: 'urgente' }, color: '#EF4444', icon: 'Zap',       sort_order: 11, is_system: true },
    { account_id, name: 'ASSIGNED_ME',  display_name: 'Atribuídos a mim',imap_path: null,     is_smart: true,  smart_filter: { assigned_to: 'me' }, color: '#8B5CF6', icon: 'UserCheck', sort_order: 12, is_system: true },
    { account_id, name: 'SCHEDULED',    display_name: 'Agendados',imap_path: null,            is_smart: true,  smart_filter: { scheduled: true }, color: '#3B82F6', icon: 'CalendarClock',sort_order: 13, is_system: true },
  ]

  const { error } = await supabase
    .from('email_folders')
    .insert(systemFolders)
  if (error) throw error
}
