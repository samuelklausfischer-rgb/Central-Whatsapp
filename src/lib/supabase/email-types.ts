export interface EmailAccount {
  id: string
  user_id: string
  department: string | null
  label: string
  email: string
  provider: 'gmail' | 'outlook' | 'imap'
  imap_host: string | null
  imap_port: number
  imap_use_ssl: boolean
  smtp_host: string | null
  smtp_port: number
  smtp_use_tls: boolean
  /*
    Aqui havia `imap_password_enc` e os três campos `oauth_*`. Saíram do banco na
    migration 20260826124852: o serviço lê esta tabela com `select('*')`, então
    qualquer credencial guardada aqui viajaria inteira para o navegador de quem
    tem permissão de ver a conta. Os tokens agora vivem em `email_account_tokens`,
    que tem RLS sem policy nenhuma — só o service_role alcança, e apenas as edge
    functions leem de lá.
  */
  last_sync_at: string | null
  sync_interval: number
  is_active: boolean
  signature: string | null
  reply_to: string | null
  created_at: string
  updated_at: string
}

export interface EmailFolder {
  id: string
  account_id: string
  name: string
  display_name: string
  imap_path: string | null
  is_smart: boolean
  smart_filter: Record<string, unknown> | null
  color: string | null
  icon: string | null
  sort_order: number
  is_system: boolean
  created_at: string
  /* Vindos do Microsoft Graph (migration 20260826140000). */
  graph_id: string | null
  /** Aninhamento: é o que faz a árvore ter nível, como no Outlook. */
  parent_id: string | null
  /** `inbox` | `drafts` | `sentitems` | `deleteditems` | `junkemail` | `archive` | `outbox` */
  well_known_name: string | null
  total_count: number
  /**
   * Não lidas SEGUNDO O OUTLOOK, não segundo o que importamos. Como só trazemos
   * 90 dias, contar as nossas linhas mostraria um número menor que o do Outlook
   * e pareceria erro.
   */
  unread_count: number
  delta_link: string | null
  last_sync_at: string | null
}

export interface EmailAttachment {
  name: string
  size: number
  mime_type: string
  url: string
  inline: boolean
}

export interface Email {
  id: string
  account_id: string
  folder_id: string | null
  message_id: string | null
  imap_uid: number | null
  thread_id: string | null
  in_reply_to: string | null
  references_ids: string[] | null
  direction: 'inbound' | 'outbound'
  from_email: string
  from_name: string | null
  to_emails: string[]
  cc_emails: string[]
  bcc_emails: string[]
  reply_to_email: string | null
  subject: string | null
  body_html: string | null
  body_text: string | null
  attachments: EmailAttachment[]
  is_read: boolean
  is_starred: boolean
  is_archived: boolean
  ai_category: string | null
  ai_sentiment: 'positivo' | 'neutro' | 'reclamacao' | 'urgente' | null
  ai_summary: string | null
  ai_processed: boolean
  contact_id: string | null
  received_at: string
  created_at: string
  /* Vindos do Microsoft Graph (migration 20260826140000). */
  graph_id: string | null
  internet_message_id: string | null
  /** Como o Outlook agrupa a conversa. */
  conversation_id: string | null
  has_attachments: boolean
  /** `low` | `normal` | `high` */
  importance: string | null
  is_draft: boolean
  /** Abre a mensagem no Outlook web. */
  web_link: string | null
  /** Primeira linha do corpo, que a lista mostra em cinza. Vem pronto do Graph. */
  body_preview: string | null
}

/** Uma linha de `email_attachments`: a ficha do anexo, sem o conteúdo. */
export interface EmailAttachmentRow {
  id: string
  email_id: string
  graph_attachment_id: string
  name: string
  mime_type: string | null
  size: number | null
  is_inline: boolean
  content_id: string | null
  /** Nulo = ainda mora na Microsoft; preenchido = guardado no nosso bucket. */
  storage_path: string | null
  guardado_em: string | null
}

export interface EmailState {
  id: string
  email_id: string
  assigned_to: string | null
  status: 'open' | 'replied' | 'waiting' | 'closed'
  responded_at: string | null
  sla_deadline: string | null
  sla_hours: number
  sla_alerted: boolean
  reading_by: string[]
  internal_note: string | null
  created_at: string
  updated_at: string
}

export interface EmailTemplate {
  id: string
  user_id: string
  title: string
  subject_template: string | null
  body_html: string
  variables: string[]
  category: string | null
  is_global: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface UserAllowedEmailAccount {
  id: string
  user_id: string
  account_id: string
  created_at: string
}

// Tipagem enriquecida para a lista de emails (com estado junto)
export interface EmailWithState extends Email {
  state?: EmailState
}

// Filtros usados na EmailList
export interface EmailFilters {
  folder_id?: string | null
  is_read?: boolean
  is_starred?: boolean
  is_archived?: boolean
  ai_sentiment?: string
  assigned_to?: string
  search?: string
  label_id?: string
}
