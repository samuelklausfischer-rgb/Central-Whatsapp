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
  imap_password_enc: string | null
  oauth_access_token: string | null
  oauth_refresh_token: string | null
  oauth_expires_at: string | null
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
