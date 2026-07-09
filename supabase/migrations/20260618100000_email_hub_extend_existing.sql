-- Email Hub: Estender tabelas existentes (ADD COLUMN aditivo, sem remover nada)

-- 1. Adicionar email em contacts para linkagem cross-canal
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email text;
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(lower(email));

-- 2. Estender scheduled_messages para suportar canal email
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS channel text DEFAULT 'whatsapp';
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS email_account_id uuid;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS email_to text[];
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS email_subject text;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS email_body_html text;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS email_body_text text;
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_channel
  ON scheduled_messages(channel, status, scheduled_at);

-- 3. Estender ai_assistant_prompts para distinguir canal whatsapp vs email
ALTER TABLE ai_assistant_prompts ADD COLUMN IF NOT EXISTS channel text DEFAULT 'whatsapp';
