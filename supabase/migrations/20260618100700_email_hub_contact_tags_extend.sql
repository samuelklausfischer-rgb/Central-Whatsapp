-- Email Hub: Estender contact_tags para suportar etiquetas em emails
-- (além de WhatsApp — device_id e remote_sender ficam opcionais)

ALTER TABLE contact_tags ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE contact_tags ALTER COLUMN remote_sender DROP NOT NULL;

ALTER TABLE contact_tags ADD COLUMN IF NOT EXISTS
  email_id uuid REFERENCES emails(id) ON DELETE CASCADE;

-- Garante que cada tag pertence a pelo menos um canal (WhatsApp ou Email)
ALTER TABLE contact_tags ADD CONSTRAINT contact_tags_has_source
  CHECK (device_id IS NOT NULL OR email_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contact_tags_email ON contact_tags(email_id);
