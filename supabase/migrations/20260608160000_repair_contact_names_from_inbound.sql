-- Repara contacts.name corrompidos por outbound messages que
-- salvaram device name como nome do contato.
-- Seta contacts.name a partir do ultimo sender_name inbound valido
-- para contatos com: name = device_name, name = remote_jid, ou name = null.
-- Preserva nickname (nunca sobrescreve).

update contacts c
set name = fix.new_name,
    updated_at = now()
from (
  select distinct on (m.remote_sender)
    m.remote_sender,
    m.sender_name as new_name
  from messages m
  where m.direction = 'inbound'
    and m.deleted_at is null
    and nullif(trim(coalesce(m.sender_name, '')), '') is not null
    and trim(m.sender_name) not like '%@%'
    and length(trim(m.sender_name)) > 1
  order by m.remote_sender, m.created_at desc
) fix
where c.remote_jid = fix.remote_sender
  and c.remote_jid not like '%@g.us'
  and c.nickname is null
  and (
    c.name is null
    or c.name = c.remote_jid
    or lower(c.name) in ('medimagem financeiro', 'financeiro prn', 'whatsapp adm', 'whatsapp comercial')
  );
