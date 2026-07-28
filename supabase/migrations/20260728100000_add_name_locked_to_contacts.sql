-- Trava de nome de contato: quando o usuário define/edita o nome pela app,
-- o webhook do Evolution nunca deve sobrescrever com o pushName bruto do WhatsApp.
-- name_locked = true impede a sobrescrita; contatos não travados continuam
-- sendo atualizados normalmente pelo webhook.
-- Default false para todas as linhas existentes: não há como saber
-- retroativamente quais nomes já em `contacts` foram definidos manualmente
-- pelo usuário vs. herdados do pushName do WhatsApp, então não travamos
-- nada por padrão (evita travar em massa nomes que na verdade deveriam
-- continuar sincronizando com o WhatsApp).
alter table public.contacts
  add column if not exists name_locked boolean not null default false;
