-- Email Hub: Estado de cada email (atribuição, status, SLA, presence)

CREATE TABLE IF NOT EXISTS email_states (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id      uuid NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
  assigned_to   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status        text DEFAULT 'open'
    CHECK (status IN ('open', 'replied', 'waiting', 'closed')),
  responded_at  timestamptz,
  sla_deadline  timestamptz,
  sla_hours     int DEFAULT 24,
  sla_alerted   bool DEFAULT false,
  reading_by    uuid[] DEFAULT '{}',  -- IDs dos usuários com o email aberto agora
  internal_note text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_states_assigned
  ON email_states(assigned_to);
CREATE INDEX IF NOT EXISTS idx_email_states_status
  ON email_states(status, sla_deadline);

ALTER TABLE email_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_states_user_own"
  ON email_states FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM emails e
      JOIN email_accounts ea ON ea.id = e.account_id
      WHERE e.id = email_states.email_id
      AND (
        ea.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_allowed_email_accounts
          WHERE account_id = ea.id AND user_id = auth.uid()
        )
      )
    )
  );
