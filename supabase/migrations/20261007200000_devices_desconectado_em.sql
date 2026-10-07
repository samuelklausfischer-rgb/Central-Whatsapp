-- ============================================================================
-- devices.desconectado_em: identidade de cada QUEDA de um aparelho
-- ============================================================================
--
-- A faixa vermelha "WhatsApp desconectado" ganhou um X. Fechada, ela não pode
-- voltar ao reabrir o app enquanto for a MESMA queda — só numa queda nova, isto
-- é, depois de o aparelho ter conectado e caído de novo.
--
-- O app sozinho não consegue saber isso: se o aparelho conectar e cair de novo
-- com o app fechado, o navegador só vê "desconectado" antes e depois. E
-- `updated_at` não serve de identidade: muda a cada mensagem (unread_count).
--
-- Regra: `desconectado_em` = início da queda atual; NULL enquanto conectado.
-- Só a passagem de conectado -> não conectado abre uma queda nova. Ir de
-- 'disconnected' para 'connecting' (alguém clicou em Reconectar e não escaneou)
-- continua sendo a mesma queda.
-- ============================================================================

alter table public.devices add column if not exists desconectado_em timestamptz;

create or replace function private.devices_marca_queda()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  -- 'open' é o valor legado de conectado (ver estaConectado no app).
  if new.status in ('connected', 'open') then
    new.desconectado_em := null;
  elsif tg_op = 'INSERT' then
    new.desconectado_em := coalesce(new.desconectado_em, now());
  elsif old.status in ('connected', 'open') or new.desconectado_em is null then
    new.desconectado_em := now();
  end if;
  return new;
end;
$function$;

revoke all on function private.devices_marca_queda() from public;

create trigger devices_marca_queda
  before insert or update of status on public.devices
  for each row execute function private.devices_marca_queda();

-- Quem já está fora do ar: a queda começou na última escrita de status que se
-- tem notícia. Não toca `status`, então o gatilho acima não dispara aqui.
update public.devices
   set desconectado_em = updated_at
 where status not in ('connected', 'open')
   and desconectado_em is null;
