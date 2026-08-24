-- Trilha de auditoria de cadastro e permissão.
--
-- Contexto: em 18/08/2026 10:40 (BRT) alguém editou o cadastro da Renata pela
-- tela de Usuários e, no mesmo movimento, apagou todos os aparelhos dela em
-- user_allowed_devices — o que a tirou da lista de "Designar" da instância
-- WhatsApp Adm. Não deu para saber QUEM: a tela passa pela edge function
-- manage-user, que usa a service_role, então tanto auth.audit_log_entries
-- quanto qualquer trigger enxergam apenas 'service_role'.
--
-- Esta migration fecha esse buraco: toda alteração em profiles,
-- user_allowed_devices e tool_access passa a gravar quem fez, em quem, o que
-- mudou e quando.

create table if not exists public.admin_audit_log (
  id             bigserial primary key,
  occurred_at    timestamptz not null default now(),
  -- Sem FK para auth.users de propósito: apagar um usuário não pode apagar o
  -- histórico do que ele fez (nem o histórico do que fizeram com ele). Por isso
  -- os *_label guardam o nome/e-mail congelados no momento do fato.
  actor_id       uuid,
  actor_label    text,
  target_user_id uuid,
  target_label   text,
  entity         text not null,  -- 'profiles' | 'user_allowed_devices' | 'tool_access' | 'auth.users'
  action         text not null,  -- 'insert' | 'update' | 'delete'
  changes        jsonb,          -- {campo: {de: <antes>, para: <depois>}}
  source         text            -- 'manage-user' | 'app' | 'sql'
);

create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_user_id, occurred_at desc);
create index if not exists admin_audit_log_recente_idx
  on public.admin_audit_log (occurred_at desc);


-- Quem está agindo.
--
-- auth.uid() resolve o caso normal (painel de super-admin, RPCs, qualquer coisa
-- com sessão de usuário). Não resolve a edge function, que roda com service_role
-- e não tem sub no JWT — por isso ela declara o autor no header x-actor-id, e é
-- daí que a segunda tentativa lê.
create or replace function public.audit_actor()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v uuid;
begin
  v := auth.uid();
  if v is not null then
    return v;
  end if;

  -- Header ausente, JSON inválido ou uuid malformado nunca podem derrubar a
  -- escrita que está sendo auditada: sem autor é melhor que sem gravar.
  begin
    v := nullif(current_setting('request.headers', true)::json ->> 'x-actor-id', '')::uuid;
  exception when others then
    v := null;
  end;

  return v;
end;
$function$;


-- De onde veio a alteração, para separar "alguém clicou na tela" de "alguém
-- rodou SQL na mão".
create or replace function public.audit_source()
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v text;
begin
  begin
    v := nullif(current_setting('request.headers', true)::json ->> 'x-actor-source', '');
  exception when others then
    v := null;
  end;

  if v is not null then
    return v;
  end if;

  if auth.uid() is not null then
    return 'app';
  end if;

  return 'sql';
end;
$function$;


create or replace function public.log_admin_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old        jsonb;
  v_new        jsonb;
  v_atual      jsonb;
  v_changes    jsonb := '{}'::jsonb;
  v_actor      uuid;
  v_actor_lbl  text;
  v_target     uuid;
  v_target_lbl text;
  v_campo      text;
  -- Campos de profiles que valem histórico. Ficam de fora de propósito:
  -- avatar_url e signature (o refresh periódico de avatar encheria o log de
  -- ruído) e updated_at (é consequência, não decisão de ninguém).
  v_campos_profiles text[] := array[
    'name', 'username', 'email', 'is_admin', 'is_super_admin',
    'department', 'devices_restricted'
  ];
begin
  if TG_OP <> 'INSERT' then v_old := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then v_new := to_jsonb(NEW); end if;
  v_atual := coalesce(v_new, v_old);

  if TG_TABLE_NAME = 'profiles' then
    v_target     := (v_atual ->> 'id')::uuid;
    v_target_lbl := coalesce(v_atual ->> 'name', v_atual ->> 'email');

    if TG_OP = 'UPDATE' then
      foreach v_campo in array v_campos_profiles loop
        if v_old -> v_campo is distinct from v_new -> v_campo then
          v_changes := v_changes || jsonb_build_object(
            v_campo,
            jsonb_build_object('de', v_old -> v_campo, 'para', v_new -> v_campo)
          );
        end if;
      end loop;

      -- Update que não mexeu em nada relevante (ex.: só o avatar) não vira linha.
      if v_changes = '{}'::jsonb then
        return null;
      end if;
    else
      foreach v_campo in array v_campos_profiles loop
        v_changes := v_changes || jsonb_build_object(v_campo, v_atual -> v_campo);
      end loop;
    end if;

  elsif TG_TABLE_NAME = 'user_allowed_devices' then
    v_target := (v_atual ->> 'user_id')::uuid;
    select coalesce(p.name, p.email) into v_target_lbl
      from public.profiles p where p.id = v_target;

    -- Guarda o nome da instância junto: se o aparelho for renomeado ou apagado
    -- depois, a linha do histórico continua legível.
    v_changes := jsonb_build_object(
      'device_id',   v_atual -> 'device_id',
      'device_name', (select d.name from public.devices d
                       where d.id = (v_atual ->> 'device_id')::uuid)
    );

  elsif TG_TABLE_NAME = 'tool_access' then
    v_target := (v_atual ->> 'user_id')::uuid;
    select coalesce(p.name, p.email) into v_target_lbl
      from public.profiles p where p.id = v_target;

    v_changes := jsonb_build_object('tool', v_atual -> 'tool');
  end if;

  v_actor := public.audit_actor();
  select coalesce(p.name, p.email) into v_actor_lbl
    from public.profiles p where p.id = v_actor;

  insert into public.admin_audit_log (
    actor_id, actor_label, target_user_id, target_label,
    entity, action, changes, source
  ) values (
    v_actor, v_actor_lbl, v_target, v_target_lbl,
    TG_TABLE_NAME, lower(TG_OP), v_changes, public.audit_source()
  );

  return null;
end;
$function$;


drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.log_admin_change();

drop trigger if exists audit_user_allowed_devices on public.user_allowed_devices;
create trigger audit_user_allowed_devices
  after insert or update or delete on public.user_allowed_devices
  for each row execute function public.log_admin_change();

drop trigger if exists audit_tool_access on public.tool_access;
create trigger audit_tool_access
  after insert or update or delete on public.tool_access
  for each row execute function public.log_admin_change();


-- Histórico é só de leitura, e só para admin. Não existe policy de
-- insert/update/delete: quem escreve é o trigger (security definer) e a
-- service_role. Pela API ninguém edita o passado.
alter table public.admin_audit_log enable row level security;

drop policy if exists "admin le o historico" on public.admin_audit_log;
create policy "admin le o historico"
  on public.admin_audit_log
  for select
  to authenticated
  using (public._is_admin());

grant select on public.admin_audit_log to authenticated;

-- Os privilégios default do schema public já tinham concedido escrita a
-- authenticated/anon. A RLS sozinha bastaria (sem policy de insert, ninguém
-- insere), mas revogar deixa a garantia em duas camadas em vez de depender só
-- da ausência de uma policy que alguém pode acrescentar sem perceber.
-- A service_role não é afetada — é ela que a edge function usa para gravar a
-- linha de troca de senha, e ela ignora RLS por definição.
revoke insert, update, delete, truncate on public.admin_audit_log from authenticated;
revoke insert, update, delete, truncate on public.admin_audit_log from anon;
revoke select on public.admin_audit_log from anon;
