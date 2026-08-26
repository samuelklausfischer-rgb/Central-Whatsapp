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

/*
  Aqui existia `createSystemFolders`, que semeava pastas fixas da época do IMAP
  ("Entrada", "Enviados", "Spam"...). Removida em 26/08/2026.

  Nunca foi chamada por lugar nenhum — e, depois que a sincronização com o
  Microsoft Graph passou a espelhar as pastas de verdade, ela virou uma
  armadilha: rodar criaria pastas inventadas ao lado das reais, com nome
  parecido e sem `graph_id`, e ninguém saberia qual das duas vale.

  Quem cria pasta agora é `sincronizarPastas`, na edge function
  `email-microsoft`, a partir do que o Outlook realmente tem.
*/
