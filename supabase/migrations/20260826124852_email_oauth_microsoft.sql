-- Email Hub: base para conectar as caixas do Microsoft 365 por OAuth.
--
-- CONTEXTO. Os e-mails da empresa são Microsoft 365 (Exchange Online): o MX de
-- prndiagnosticos.com.br e de clinicamedimagem.com aponta para
-- mail.protection.outlook.com, e os dois domínios estão no MESMO tenant
-- (ec5a76d5-4773-4c5f-ae34-e667576941ae). O Email Hub foi escrito imaginando IMAP
-- com senha ou Gmail — nada disso serve aqui. A Microsoft desativou Basic Auth
-- para IMAP/POP/SMTP, então o caminho é OAuth2 delegado + Microsoft Graph.
--
-- POR QUE OS SEGREDOS FICAM NO BANCO, E NÃO EM VARIÁVEL DE AMBIENTE. O jeito
-- convencional seria pôr MS_CLIENT_ID/MS_TENANT_ID/MS_CLIENT_SECRET no ambiente
-- do container `functions`. Neste stack isso é perigoso: o .env do Supabase
-- self-hosted está defasado em relação às senhas reais do Postgres, `docker
-- restart` NÃO relê o .env (só a RECRIAÇÃO relê), e recriar container já derrubou
-- a API REST por ~1h em 29/07/2026. Guardar em tabela travada dá a mesma
-- proteção (nada disso sai do service_role) sem exigir recriação de container.

-- ---------------------------------------------------------------------------
-- 1. Credenciais do aplicativo registrado no Entra ID
-- ---------------------------------------------------------------------------
-- Linha única. `id` fixo em 1 com CHECK para tornar impossível existir uma
-- segunda configuração e alguém ficar em dúvida sobre qual vale.
create table if not exists public.email_oauth_config (
  id            int primary key default 1 check (id = 1),
  client_id     text not null,
  tenant_id     text not null,
  client_secret text not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null
);

comment on table public.email_oauth_config is
  'Credenciais do app do Central Whats no Entra ID (Microsoft 365). Linha unica. RLS ligada e SEM POLICY nenhuma de proposito: so o service_role enxerga. O client_secret nunca pode chegar ao navegador.';

-- ---------------------------------------------------------------------------
-- 2. Tokens de cada caixa conectada
-- ---------------------------------------------------------------------------
-- Tabela SEPARADA de email_accounts porque `getEmailAccounts()` faz `select('*')`:
-- token guardado junto da conta viajaria inteiro para o navegador de quem tem
-- permissão de ler a conta. Separando, o `select('*')` não tem como alcançá-lo.
create table if not exists public.email_account_tokens (
  account_id    uuid primary key references public.email_accounts(id) on delete cascade,
  access_token  text,
  refresh_token text not null,
  expires_at    timestamptz,
  scope         text,
  updated_at    timestamptz not null default now()
);

comment on table public.email_account_tokens is
  'Tokens OAuth por caixa conectada. Separada de email_accounts porque o servico do app faz select(*) e levaria o refresh_token para o navegador. RLS ligada e SEM POLICY: so service_role.';

-- ---------------------------------------------------------------------------
-- 3. Estado do fluxo de autorização (proteção contra CSRF)
-- ---------------------------------------------------------------------------
-- O `state` que vai para a Microsoft e volta. Sem ele, um link forjado poderia
-- fazer a vítima conectar a caixa do atacante na conta dela.
create table if not exists public.email_oauth_states (
  state      text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  label      text,
  department text,
  expected_email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

comment on table public.email_oauth_states is
  'Estado temporario do fluxo OAuth (anti-CSRF). Linhas vivem 15 min. RLS ligada e SEM POLICY: so service_role.';

create index if not exists email_oauth_states_expires_idx
  on public.email_oauth_states (expires_at);

-- RLS ligada e nenhuma policy: em Postgres isso significa "ninguem passa".
-- O service_role ignora RLS, entao as edge functions continuam funcionando.
alter table public.email_oauth_config  enable row level security;
alter table public.email_account_tokens enable row level security;
alter table public.email_oauth_states   enable row level security;

-- Cinto e suspensorio: alem da RLS, tirar o privilegio de tabela dos papeis do
-- cliente. RLS sozinha ja bastaria; isto protege contra alguem criar uma policy
-- permissiva no futuro sem perceber o que esta expondo.
revoke all on public.email_oauth_config   from anon, authenticated;
revoke all on public.email_account_tokens from anon, authenticated;
revoke all on public.email_oauth_states   from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Limpeza das colunas de credencial em email_accounts
-- ---------------------------------------------------------------------------
-- A tabela esta com 0 linhas (conferido em 26/08/2026), entao nao ha dado a
-- perder. Sao removidas porque:
--   - imap_password_enc nunca foi cifrado apesar do sufixo `_enc`, e a edge
--     function usava o valor como senha em texto puro. Com OAuth nao existe
--     senha para guardar, entao a coluna deixa de fazer sentido.
--   - os campos oauth_* mudam para email_account_tokens (ver item 2).
-- Deixar colunas de credencial vazias em uma tabela que o cliente le com
-- select(*) e um convite para alguem preenche-las depois.
alter table public.email_accounts
  drop column if exists imap_password_enc,
  drop column if exists oauth_access_token,
  drop column if exists oauth_refresh_token,
  drop column if exists oauth_expires_at;

-- ---------------------------------------------------------------------------
-- 5. Acesso por setor
-- ---------------------------------------------------------------------------
-- A regra do negocio: "quem e do Financeiro ve as caixas do Financeiro". Isso ja
-- existe no banco — `public.user_sectors` (migration 20260825191840) mapeia
-- pessoa -> setor, e `email_accounts.department` marca o setor da caixa. Falta
-- so a RLS ligar os dois; a policy antiga so enxergava `user_id = auth.uid()`.
--
-- A divisao das caixas:
--   department IS NULL  -> conta PESSOAL. So o dono ve, e ele mesmo conecta.
--   department NOT NULL -> caixa de SETOR. Todo o setor ve; so admin conecta.
drop policy if exists "email_accounts_user_own"  on public.email_accounts;
drop policy if exists "email_accounts_admin_all" on public.email_accounts;

create policy email_accounts_select on public.email_accounts
  for select using (
    user_id = auth.uid()
    or public._is_admin()
    or (
      department is not null
      and exists (
        select 1 from public.user_sectors us
        where us.user_id = auth.uid()
          and us.setor   = email_accounts.department
      )
    )
  );

-- Escrita: cada um cuida da propria conta pessoal; caixa de setor e do admin.
-- O `department is null` no WITH CHECK e o que impede alguem publicar a propria
-- caixa para um setor inteiro sem ser admin.
create policy email_accounts_insert on public.email_accounts
  for insert with check (
    public._is_admin()
    or (user_id = auth.uid() and department is null)
  );

create policy email_accounts_update on public.email_accounts
  for update using (
    public._is_admin() or (user_id = auth.uid() and department is null)
  ) with check (
    public._is_admin() or (user_id = auth.uid() and department is null)
  );

create policy email_accounts_delete on public.email_accounts
  for delete using (
    public._is_admin() or (user_id = auth.uid() and department is null)
  );

-- ---------------------------------------------------------------------------
-- 6. Provider
-- ---------------------------------------------------------------------------
-- O CHECK original aceita 'gmail', 'outlook' e 'imap'. 'outlook' ja cobre o que
-- a empresa usa, entao nada muda aqui — anotado so para a proxima pessoa nao
-- procurar: a caixa da PRN entra como provider = 'outlook'.
