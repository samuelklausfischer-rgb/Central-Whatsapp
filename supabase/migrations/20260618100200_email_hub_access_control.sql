-- Email Hub: Controle de acesso por usuário (equivalente a user_allowed_devices)

CREATE TABLE IF NOT EXISTS user_allowed_email_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, account_id)
);

ALTER TABLE user_allowed_email_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_access_user_see_own"
  ON user_allowed_email_accounts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "email_access_admin_manage"
  ON user_allowed_email_accounts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
