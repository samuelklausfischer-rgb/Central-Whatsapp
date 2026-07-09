-- Email Hub: Templates de email (separado de message_triggers para não impactar WhatsApp)

CREATE TABLE IF NOT EXISTS email_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title            text NOT NULL,
  subject_template text,
  body_html        text NOT NULL,
  variables        text[] DEFAULT '{}',  -- ex: ['nome', 'empresa', 'data']
  category         text,
  is_global        bool DEFAULT false,
  is_active        bool DEFAULT true,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_templates_read"
  ON email_templates FOR SELECT
  USING (user_id = auth.uid() OR is_global = true);

CREATE POLICY "email_templates_manage"
  ON email_templates FOR INSERT UPDATE DELETE
  USING (user_id = auth.uid());
