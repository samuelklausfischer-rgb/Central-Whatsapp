alter table public.messages
  add column if not exists group_participant text;

create index if not exists idx_messages_group_participant
  on public.messages (group_participant)
  where group_participant is not null;

-- Limpa sender_name de grupos que estejam com JID bruto (ex: "12345@s.whatsapp.net")
update public.messages
set sender_name = regexp_replace(
  regexp_replace(sender_name, '@s\.whatsapp\.net|@lid|@g\.us', '', 'g'),
  '\D', '', 'g'
)
where remote_sender like '%@g.us'
  and direction = 'inbound'
  and sender_name is not null
  and sender_name ~ '@';

-- Para grupos antigos ainda com sender_name numérico, marca como null
-- para que o fallback da UI ou re-import do history possa corrigir depois.
update public.messages
set sender_name = null
where remote_sender like '%@g.us'
  and direction = 'inbound'
  and sender_name ~ '^\d{10,}$';
