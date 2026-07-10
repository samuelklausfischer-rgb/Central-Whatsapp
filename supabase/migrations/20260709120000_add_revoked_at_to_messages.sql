alter table public.messages
  add column if not exists revoked_at timestamptz;
