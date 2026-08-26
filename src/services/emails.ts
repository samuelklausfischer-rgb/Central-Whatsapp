import { supabase } from '@/lib/supabase/client'
import type { Email, EmailFilters } from '@/lib/supabase/email-types'

/**
 * Colunas da LISTA — de propósito sem `body_html` e `body_text`.
 *
 * NÃO trocar por `select('*')`. Duas razões:
 *
 * 1. **Peso.** O corpo médio é 6,7 KB; cem mensagens são ~670 KB baixados a cada
 *    troca de pasta, para montar uma lista que só mostra `body_preview` (28 KB
 *    no total das cem). Era 24× mais dado do que o necessário.
 *
 * 2. **O corpo sumia depois do primeiro clique.** Corpo grande fica no TOAST, e
 *    o Postgres NÃO reenvia coluna grande que não mudou num UPDATE. Marcar como
 *    lido disparava um evento de Realtime com `body_html: null`, que substituía
 *    o objeto bom por um sem corpo e a tela escrevia "(sem conteúdo)". Com o
 *    corpo fora da lista, quem manda nele é sempre `getEmail(id)`.
 */
const COLUNAS_DA_LISTA = [
  'id', 'account_id', 'folder_id', 'message_id', 'imap_uid', 'thread_id',
  'in_reply_to', 'references_ids', 'direction', 'from_email', 'from_name',
  'to_emails', 'cc_emails', 'bcc_emails', 'reply_to_email', 'subject',
  'attachments', 'is_read', 'is_starred', 'is_archived',
  'ai_category', 'ai_sentiment', 'ai_summary', 'ai_processed',
  'contact_id', 'received_at', 'created_at',
  'graph_id', 'internet_message_id', 'conversation_id', 'has_attachments',
  'importance', 'is_draft', 'web_link', 'body_preview',
].join(',')

/**
 * Converte o resultado da lista para `Email[]`.
 *
 * A conversão é necessária porque `COLUNAS_DA_LISTA` é montada em tempo de
 * execução, e o cliente do Supabase só infere tipo a partir de um texto
 * literal — sem isso ele devolve `GenericStringError[]`.
 *
 * O que a conversão NÃO faz é mentir sobre o conteúdo: estas linhas realmente
 * chegam com `body_html` e `body_text` nulos, e os dois campos já são
 * `string | null` no tipo. Quem precisa do corpo usa `getEmail(id)`.
 */
function semCorpo(data: unknown): Email[] {
  return (data ?? []) as Email[]
}

export async function getEmails(
  account_id: string,
  filters: EmailFilters = {},
  limit = 100
): Promise<Email[]> {
  let query = supabase
    .from('emails')
    .select(COLUNAS_DA_LISTA)
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
  return semCorpo(data)
}

export async function searchEmails(
  account_id: string,
  search: string,
  limit = 50
): Promise<Email[]> {
  const q = search.replace(/[%_]/g, '\\$&')
  const { data, error } = await supabase
    .from('emails')
    // Mesmas colunas da lista: a busca devolve linhas para a MESMA lista, e
    // trazer o corpo aqui teria o mesmo custo e o mesmo defeito.
    // O `body_text` continua no filtro — procurar dentro do texto é o ponto da
    // busca; o que não volta é o conteúdo em si.
    .select(COLUNAS_DA_LISTA)
    .eq('account_id', account_id)
    .or(`subject.ilike.%${q}%,from_name.ilike.%${q}%,from_email.ilike.%${q}%,body_text.ilike.%${q}%`)
    .order('received_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return semCorpo(data)
}

/**
 * Uma mensagem COMPLETA, com o corpo.
 *
 * Aqui o `select('*')` é obrigatório e não é descuido: esta é a única porta por
 * onde o corpo entra na tela. A lista não o traz mais (ver `COLUNAS_DA_LISTA`).
 */
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

/*
  Etiquetas do e-mail.

  Estas três funções gravavam em `contact_tags` + `labels`, que são do WhatsApp
  — a coluna `contact_tags.email_id` existe justamente para isso. Nunca chegou a
  ser usada (0 vínculos de e-mail em 26/08/2026), e a separação foi feita
  porque as 4 etiquetas de lá são de conversa: `MEDICO`, `TÉCNICO CUIABÁ`,
  `UN. KETLIN`. Elas apareceriam como opção ao etiquetar um boleto, e as de
  e-mail poluiriam a tela de conversas.

  Agora apontam para `email_etiquetas` / `email_etiqueta_itens`. A lógica mais
  rica (definir a lista inteira de uma vez, criar etiqueta) mora em
  `services/email_organizacao.ts`.
*/
export async function applyEmailLabel(email_id: string, etiqueta_id: string): Promise<void> {
  const { error } = await supabase
    .from('email_etiqueta_itens')
    .insert({ email_id, etiqueta_id })
  if (error && error.code !== '23505') throw error // ignora duplicata
}

export async function removeEmailLabel(email_id: string, etiqueta_id: string): Promise<void> {
  const { error } = await supabase
    .from('email_etiqueta_itens')
    .delete()
    .eq('email_id', email_id)
    .eq('etiqueta_id', etiqueta_id)
  if (error) throw error
}

export async function getEmailLabels(email_id: string) {
  const { data, error } = await supabase
    .from('email_etiqueta_itens')
    .select('etiqueta_id, email_etiquetas(id, nome, cor)')
    .eq('email_id', email_id)
  if (error) throw error
  return data ?? []
}
