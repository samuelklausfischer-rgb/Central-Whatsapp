-- Email Hub: Pastas de email (sistema + customizadas + inteligentes)

CREATE TABLE IF NOT EXISTS email_folders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  name         text NOT NULL,
  display_name text NOT NULL,
  imap_path    text,          -- path real no servidor IMAP (null = pasta inteligente)
  is_smart     bool DEFAULT false,
  smart_filter jsonb,         -- ex: {"status":"waiting"} ou {"assigned_to":"me"}
  color        text,          -- hex (#3B82F6)
  icon         text,          -- nome ícone Lucide (ex: "Inbox", "Send", "Archive")
  sort_order   int DEFAULT 0,
  is_system    bool DEFAULT false,  -- INBOX, Sent, Drafts, Spam, Trash
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE email_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_folders_user_own"
  ON email_folders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM email_accounts ea
      WHERE ea.id = email_folders.account_id
      AND (
        ea.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_allowed_email_accounts
          WHERE account_id = ea.id AND user_id = auth.uid()
        )
      )
    )
  );
