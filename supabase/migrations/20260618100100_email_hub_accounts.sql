-- Email Hub: Tabela de contas de email (equivalente a devices para WhatsApp)

CREATE TABLE IF NOT EXISTS email_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  department          text,
  label               text NOT NULL,
  email               text NOT NULL,
  provider            text NOT NULL CHECK (provider IN ('gmail', 'outlook', 'imap')),
  -- Configuração IMAP
  imap_host           text,
  imap_port           int DEFAULT 993,
  imap_use_ssl        bool DEFAULT true,
  -- Configuração SMTP
  smtp_host           text,
  smtp_port           int DEFAULT 587,
  smtp_use_tls        bool DEFAULT true,
  -- Credenciais (serão criptografadas via Supabase Vault em versão futura)
  imap_password_enc   text,
  -- OAuth tokens (Gmail / Outlook)
  oauth_access_token  text,
  oauth_refresh_token text,
  oauth_expires_at    timestamptz,
  -- Estado de sincronização
  last_sync_at        timestamptz,
  sync_interval       int DEFAULT 60,  -- segundos
  is_active           bool DEFAULT true,
  -- Configurações por conta
  signature           text,
  reply_to            text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;

-- Usuário vê apenas suas próprias contas
CREATE POLICY "email_accounts_user_own"
  ON email_accounts FOR ALL
  USING (user_id = auth.uid());

-- Admin vê todas as contas
CREATE POLICY "email_accounts_admin_all"
  ON email_accounts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
