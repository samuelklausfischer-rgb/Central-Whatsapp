-- Relatório App: tempo de uso por usuário, por dia e por plataforma.
--
-- ESCOPO DELIBERADO. Coleta: tempo de app aberto, tempo ativo, plataforma
-- (app/web) e versão. NÃO coleta: telas visitadas, teclas, conteúdo de mensagem,
-- contagem de conversas ou qualquer ranking de produtividade.
--
-- VISIBILIDADE: somente SUPER-ADMIN. Não é `_is_admin()` de propósito — essa
-- função ignora `profiles.devices_restricted`, então admins cujo acesso um
-- super-admin restringiu de propósito passariam a ler a atividade da equipe
-- inteira por esta porta.
--
-- Não entra na publication `supabase_realtime`: nenhuma tela observa estas
-- tabelas, e publicar milhares de batidas por dia para todo cliente conectado
-- seria o oposto da intenção.

-- ─────────────────────────── Cursor de batida ───────────────────────────
-- Uma linha por (usuário, plataforma). Guarda onde a contagem parou.
-- Chave por PLATAFORMA, e não só por usuário, é o que impede o erro clássico:
-- com um cursor único, um atendente usando o app Electron COM uma aba web
-- esquecida aberta teria as batidas intercaladas app/web/app/web, e só metade
-- seria creditada como ativa — o tempo dele apareceria pela metade.
create table if not exists public.user_app_sessions (
  user_id        uuid        not null references auth.users(id) on delete cascade,
  platform       text        not null check (platform in ('app','web')),
  app_version    text,
  started_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  last_active_at timestamptz,
  primary key (user_id, platform)
);

-- ─────────────────────── Agregado diário ───────────────────────
-- `dia` é sempre calculado no SERVIDOR em America/Sao_Paulo (o banco roda em
-- UTC). Deixar isso para o cliente produziria o off-by-one clássico: depois das
-- 21h BRT a data UTC já é a de amanhã.
create table if not exists public.user_app_daily_activity (
  user_id        uuid        not null references auth.users(id) on delete cascade,
  dia            date        not null,
  platform       text        not null check (platform in ('app','web')),
  active_seconds integer     not null default 0,
  open_seconds   integer     not null default 0,
  app_version    text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  primary key (user_id, dia, platform)
);

create index if not exists idx_user_app_daily_activity_dia
  on public.user_app_daily_activity (dia desc, user_id);

-- ─────────────────────────────── RPC ───────────────────────────────
-- Chamada pelo cliente a cada ~2 minutos. Toda a aritmética usa `now()` do
-- SERVIDOR: o cliente nunca declara quanto tempo passou, só que está vivo e se
-- houve interação recente. Assim app fechado à força, queda de energia ou crash
-- simplesmente param de creditar, sem inflar nada.
create or replace function public.app_heartbeat(
  p_platform text,
  p_version  text default null,
  p_active   boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid         uuid := auth.uid();
  v_now         timestamptz := now();
  v_platform    text;
  v_dia         date;
  v_prev_seen   timestamptz;
  v_prev_active timestamptz;
  v_open_gap    integer;
  v_active_gap  integer;
  -- Acima deste intervalo entre batidas, considera-se que o app ficou fechado /
  -- a máquina dormiu: o trecho não é creditado e uma nova contagem começa.
  v_max_gap     interval := interval '5 minutes';
begin
  if v_uid is null then
    return;
  end if;

  v_platform := case when p_platform = 'web' then 'web' else 'app' end;
  v_dia := (v_now at time zone 'America/Sao_Paulo')::date;

  select s.last_seen_at, s.last_active_at
    into v_prev_seen, v_prev_active
    from public.user_app_sessions s
   where s.user_id = v_uid and s.platform = v_platform;

  v_open_gap := case
    when v_prev_seen is null or v_now - v_prev_seen > v_max_gap then 0
    else extract(epoch from v_now - v_prev_seen)::int
  end;

  -- O relógio do "ativo" tem âncora PRÓPRIA (`last_active_at`). Se fosse derivado
  -- de `last_seen_at`, toda batida ociosa reiniciaria a âncora e o tempo ativo
  -- seria sistematicamente subcontado.
  v_active_gap := case
    when not p_active or v_prev_active is null or v_now - v_prev_active > v_max_gap then 0
    else extract(epoch from v_now - v_prev_active)::int
  end;

  insert into public.user_app_sessions as s
    (user_id, platform, app_version, started_at, last_seen_at, last_active_at)
  values
    (v_uid, v_platform, p_version, v_now, v_now, case when p_active then v_now else null end)
  on conflict (user_id, platform) do update set
    app_version    = coalesce(excluded.app_version, s.app_version),
    -- Gap grande = sessão nova: reancora o início.
    started_at     = case when v_open_gap = 0 then v_now else s.started_at end,
    last_seen_at   = v_now,
    -- Só avança quando houve interação de verdade.
    last_active_at = case when p_active then v_now else s.last_active_at end;

  insert into public.user_app_daily_activity as d
    (user_id, dia, platform, active_seconds, open_seconds, app_version, first_seen_at, last_seen_at)
  values
    (v_uid, v_dia, v_platform, v_active_gap, v_open_gap, p_version, v_now, v_now)
  on conflict (user_id, dia, platform) do update set
    active_seconds = d.active_seconds + v_active_gap,
    open_seconds   = d.open_seconds + v_open_gap,
    app_version    = coalesce(excluded.app_version, d.app_version),
    last_seen_at   = v_now;
end;
$function$;

-- ─────────────────────────────── RLS ───────────────────────────────
alter table public.user_app_sessions       enable row level security;
alter table public.user_app_daily_activity enable row level security;

drop policy if exists user_app_sessions_select_super_admin on public.user_app_sessions;
create policy user_app_sessions_select_super_admin
  on public.user_app_sessions for select
  to authenticated
  using (public._is_super_admin());

drop policy if exists user_app_daily_activity_select_super_admin on public.user_app_daily_activity;
create policy user_app_daily_activity_select_super_admin
  on public.user_app_daily_activity for select
  to authenticated
  using (public._is_super_admin());

-- Nenhuma policy de INSERT/UPDATE/DELETE: a escrita passa exclusivamente pela
-- RPC (SECURITY DEFINER). Os REVOKEs abaixo tiram o acesso direto às tabelas —
-- sem eles, um usuário poderia forjar o próprio tempo via PostgREST.
revoke all on public.user_app_sessions       from anon, authenticated;
revoke all on public.user_app_daily_activity from anon, authenticated;
grant select on public.user_app_sessions       to authenticated;
grant select on public.user_app_daily_activity to authenticated;

revoke execute on function public.app_heartbeat(text, text, boolean) from public, anon;
grant  execute on function public.app_heartbeat(text, text, boolean) to authenticated;
