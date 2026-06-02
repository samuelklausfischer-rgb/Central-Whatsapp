alter table public.scheduled_messages
  drop constraint if exists scheduled_messages_status_check;

alter table public.scheduled_messages
  add constraint scheduled_messages_status_check
  check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled'));
