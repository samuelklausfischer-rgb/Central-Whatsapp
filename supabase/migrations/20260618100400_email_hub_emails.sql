-- Email Hub: Tabela principal de emails (recebidos e enviados)

CREATE TABLE IF NOT EXISTS emails (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  folder_id      uuid REFERENCES email_folders(id) ON DELETE SET NULL,
  -- Identificadores de protocolo
  message_id     text,
  imap_uid       bigint,
  thread_id      text,
  in_reply_to    text,
  references_ids text[],
  -- Direção e remetentes
  direction      text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_email     text NOT NULL,
  from_name      text,
  to_emails      text[] NOT NULL DEFAULT '{}',
  cc_emails      text[] DEFAULT '{}',
  bcc_emails     text[] DEFAULT '{}',
  reply_to_email text,
  -- Conteúdo
  subject        text,
  body_html      text,
  body_text      text,
  attachments    jsonb DEFAULT '[]',  -- [{name, size, mime_type, url, inline}]
  -- Flags
  is_read        bool DEFAULT false,
  is_starred     bool DEFAULT false,
  is_archived    bool DEFAULT false,
  -- Classificação por IA (preenchido pelo n8n Classifier)
  ai_category    text,   -- financeiro|comercial|suporte|interno|marketing|outro
  ai_sentiment   text,   -- positivo|neutro|reclamacao|urgente
  ai_summary     text,   -- resumo em até 15 palavras
  ai_processed   bool DEFAULT false,
  -- Linkagem cross-canal
  contact_id     uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- Timestamps
  received_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz DEFAULT now()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_emails_account
  ON emails(account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_folder
  ON emails(folder_id);
CREATE INDEX IF NOT EXISTS idx_emails_thread
  ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_contact
  ON emails(contact_id);
CREATE INDEX IF NOT EXISTS idx_emails_message_id
  ON emails(message_id);
CREATE INDEX IF NOT EXISTS idx_emails_flags
  ON emails(is_archived, is_read, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_ai
  ON emails(ai_processed, ai_sentiment);
CREATE INDEX IF NOT EXISTS idx_emails_fts
  ON emails USING gin(
    to_tsvector('portuguese',
      coalesce(subject,'') || ' ' ||
      coalesce(from_name,'') || ' ' ||
      coalesce(from_email,'') || ' ' ||
      coalesce(body_text,'')
    )
  );

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "emails_user_own"
  ON emails FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM email_accounts ea
      WHERE ea.id = emails.account_id
      AND (
        ea.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_allowed_email_accounts
          WHERE account_id = ea.id AND user_id = auth.uid()
        )
      )
    )
  );
