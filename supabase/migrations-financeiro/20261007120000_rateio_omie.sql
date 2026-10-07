-- =====================================================================================
-- Rateio -> Omie: tabelas de apoio ao lançamento da conta a pagar no Omie
-- BANCO: Supabase FINANCEIRO (cloud). NÃO aplicar no Supabase do Central-Whats
-- (a pasta supabase/migrations/ deste repo é de outro banco).
-- Contrato: docs/rateio-omie/CONTRATO.md
--
-- Idempotente: pode rodar mais de uma vez sem erro.
-- Segurança: RLS ligada em tudo. Só há policy de SELECT para `authenticated`
-- (exceto rateio_omie_autorizados, sem policy nenhuma). Ninguém escreve pelo cliente:
-- só a service role (Edge Function `rateio-omie`) grava, e ela ignora a RLS.
-- Conferido no banco em 2026-10-07: dash_rateio_execucoes.id é uuid.
-- =====================================================================================

-- 1) Linhas por unidade, gravadas pelo front a partir de resposta.linhas do webhook
--    rateio-upload. Execuções antigas ficam com NULL (não são lançáveis).
alter table public.dash_rateio_execucoes
  add column if not exists linhas jsonb;
comment on column public.dash_rateio_execucoes.linhas is
  'Valor por unidade (unidade, soma, PORTAL, INTEGRACAO, SERVIDOR, ROBO, STORAGE, ADICIONAL, total). NULL em execuções antigas.';

-- 1b) Autor da execução (revisão de risco, regra 5). O `lancar` só aceita execução do próprio
--     usuário; execuções antigas ficam sem autor (NULL) e não são lançáveis.
alter table public.dash_rateio_execucoes
  add column if not exists criado_por uuid default auth.uid();
comment on column public.dash_rateio_execucoes.criado_por is
  'Usuário que gravou a execução (auth.uid() no INSERT). NULL em execuções antigas.';

-- A policy de INSERT atual (conferida em pg_policies em 2026-10-07) era
--   dash_rateio_execucoes_insert: FOR INSERT TO authenticated WITH CHECK (true)
-- e passa a exigir que o autor seja o próprio usuário logado. A policy de SELECT não muda.
drop policy if exists dash_rateio_execucoes_insert on public.dash_rateio_execucoes;
create policy dash_rateio_execucoes_insert on public.dash_rateio_execucoes
  for insert to authenticated with check (criado_por = auth.uid());

-- 2) Mapa unidade -> departamento do Omie, por empresa.
--    A chave de busca é unidade_chave (mesma regra da função chave() do rateio:
--    sem acento, MAIÚSCULAS, espaços colapsados, travessões unicode -> '-').
create table if not exists public.rateio_omie_mapa (
  empresa           text        not null
                    check (empresa in ('PRN','PRN_APICE','MEDIMAGEM','MEDIMAGEM_APICE')),
  unidade           text        not null,   -- nome como aparece no Excel/CSV (para exibir)
  unidade_chave     text        not null,   -- chave() normalizada (para casar)
  cod_departamento  bigint      not null,   -- cCodDep do Omie
  departamento_nome text,
  confianca         text        not null default 'ALTA'
                    check (confianca in ('ALTA','MEDIA','BAIXA')),
  origem            text        not null default 'csv'
                    check (origem in ('csv','tela')),  -- 'tela' = vinculado por um humano
  observacao        text,
  atualizado_por    uuid,
  atualizado_em     timestamptz not null default now(),
  primary key (empresa, unidade_chave)
);
comment on table public.rateio_omie_mapa is
  'Vínculo unidade -> departamento Omie. Escrita só pela service role (seed CSV e ação vincular).';

-- 3) Configuração por empresa (SEM dados: um humano preenche; ver exemplo no fim).
create table if not exists public.rateio_omie_config (
  empresa               text   primary key
                        check (empresa in ('PRN','PRN_APICE','MEDIMAGEM','MEDIMAGEM_APICE')),
  conta_omie            text   not null check (conta_omie in ('PRN','MEDIMAGEM')), -- qual par de secrets usar
  cnpj_esperado         text   not null,   -- só dígitos; conferido contra ListarEmpresas
  cod_fornecedor        bigint not null,   -- codigo_cliente_fornecedor (Mobilemed no Omie)
  cod_categoria         text   not null,   -- codigo_categoria
  tipo_documento        text   not null default 'BOL',
  conta_corrente_padrao bigint             -- usada quando a tela não informa conta_corrente
);
comment on table public.rateio_omie_config is
  'Parâmetros do lançamento por empresa. Preenchido manualmente por um humano; nunca por seed.';

-- 4) Lançamentos (um por empresa e competência ativa).
create table if not exists public.rateio_omie_lancamentos (
  id                     uuid primary key default gen_random_uuid(),
  execucao_id            uuid not null
                         references public.dash_rateio_execucoes(id) on delete restrict,
  empresa                text not null
                         check (empresa in ('PRN','PRN_APICE','MEDIMAGEM','MEDIMAGEM_APICE')),
  competencia            date not null
                         check (competencia = date_trunc('month', competencia)::date), -- sempre dia 1
  nf                     text not null,
  valor_nf               numeric(14,2) not null,
  emissao                date,
  vencimento             date not null,
  conta_corrente         bigint not null,
  chave_integracao       text not null unique,   -- RATEIO-{P|PA|M|MA}-{AAAAMM}-{NF}
  distribuicao           jsonb not null,         -- [{cCodDep, nValDep, nPerDep}]
  ajuste                 jsonb,                  -- {cod_departamento, centavos} ou null
  hash_analise           text not null,
  status                 text not null
                         check (status in ('enviando','lancado','erro','incerto','excluido')),
  omie_codigo_lancamento bigint,
  criado_por             uuid not null,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz
);
comment on table public.rateio_omie_lancamentos is
  'Conta a pagar enviada ao Omie. O índice parcial barra clique duplo e lançamento concorrente.';

-- Só um lançamento "vivo" por empresa e competência. 'erro' e 'excluido' liberam novo envio;
-- 'incerto' continua bloqueando até alguém consultar o Omie.
create unique index if not exists rateio_omie_lanc_unico_ativo
  on public.rateio_omie_lancamentos (empresa, competencia)
  where status in ('enviando','lancado','incerto');

create index if not exists rateio_omie_lanc_execucao_idx
  on public.rateio_omie_lancamentos (execucao_id);

-- Uma execução nunca vai duas vezes, em nenhuma competência (revisão de risco, regra 2).
create unique index if not exists rateio_omie_lanc_unico_execucao
  on public.rateio_omie_lancamentos (execucao_id)
  where status in ('enviando','lancado','incerto');

-- 5) Tentativas: uma linha por chamada ao Omie (antes e depois). Nunca guardar app_key/app_secret.
create table if not exists public.rateio_omie_tentativas (
  id            bigserial primary key,
  -- set null: se a linha 'enviando' for apagada (ESCRITA_DESLIGADA), o histórico de chamadas fica.
  lancamento_id uuid references public.rateio_omie_lancamentos(id) on delete set null,
  call          text,
  payload       jsonb,
  http_status   int,
  resposta      jsonb,
  erro          text,
  criado_por    uuid,
  criado_em     timestamptz not null default now()
);
create index if not exists rateio_omie_tent_lanc_idx
  on public.rateio_omie_tentativas (lancamento_id);

-- 6) Quem pode lançar. A Edge Function confere aqui; o cliente não lê nem escreve.
create table if not exists public.rateio_omie_autorizados (
  user_id   uuid primary key,
  email     text,
  criado_em timestamptz not null default now()
);

-- 7) RLS
alter table public.rateio_omie_mapa        enable row level security;
alter table public.rateio_omie_config      enable row level security;
alter table public.rateio_omie_lancamentos enable row level security;
alter table public.rateio_omie_tentativas  enable row level security;
alter table public.rateio_omie_autorizados enable row level security;

-- Somente leitura para usuários logados (a tela mostra mapa, config e histórico).
drop policy if exists rateio_omie_mapa_select on public.rateio_omie_mapa;
create policy rateio_omie_mapa_select on public.rateio_omie_mapa
  for select to authenticated using (true);

drop policy if exists rateio_omie_config_select on public.rateio_omie_config;
create policy rateio_omie_config_select on public.rateio_omie_config
  for select to authenticated using (true);

drop policy if exists rateio_omie_lancamentos_select on public.rateio_omie_lancamentos;
create policy rateio_omie_lancamentos_select on public.rateio_omie_lancamentos
  for select to authenticated using (true);

drop policy if exists rateio_omie_tentativas_select on public.rateio_omie_tentativas;
create policy rateio_omie_tentativas_select on public.rateio_omie_tentativas
  for select to authenticated using (true);

-- rateio_omie_autorizados: NENHUMA policy (nem SELECT). Só a service role acessa.

-- Cinto e suspensório: tira também os privilégios de escrita dos papéis do cliente
-- (sem policy a RLS já bloquearia, mas assim nem depende dela).
revoke insert, update, delete, truncate on
  public.rateio_omie_mapa, public.rateio_omie_config,
  public.rateio_omie_lancamentos, public.rateio_omie_tentativas
  from anon, authenticated;
revoke all on public.rateio_omie_autorizados from anon, authenticated;
revoke select on
  public.rateio_omie_mapa, public.rateio_omie_config,
  public.rateio_omie_lancamentos, public.rateio_omie_tentativas
  from anon;

-- =====================================================================================
-- DEPOIS DE APLICAR (manual, por um humano, com a service role / SQL editor):
--
-- a) Preencher rateio_omie_config (uma linha por empresa). Exemplo com valores FICTÍCIOS:
-- insert into public.rateio_omie_config
--   (empresa, conta_omie, cnpj_esperado, cod_fornecedor, cod_categoria, tipo_documento, conta_corrente_padrao)
-- values
--   ('PRN',             'PRN',       '00000000000000', 1111111111, '2.01.01', 'BOL', 2222222222),
--   ('PRN_APICE',       'PRN',       '00000000000000', 1111111111, '2.01.01', 'BOL', 2222222222),
--   ('MEDIMAGEM',       'MEDIMAGEM', '00000000000000', 3333333333, '2.01.01', 'BOL', 4444444444),
--   ('MEDIMAGEM_APICE', 'MEDIMAGEM', '00000000000000', 3333333333, '2.01.01', 'BOL', 4444444444);
--
-- b) Autorizar quem pode lançar (user_id vem de auth.users):
-- insert into public.rateio_omie_autorizados (user_id, email)
-- values ('00000000-0000-0000-0000-000000000000', 'pessoa@exemplo.com.br');
--
-- c) Rodar em seguida 20261007120100_rateio_omie_mapa_seed.sql (seed do mapa).
-- =====================================================================================

-- ROLLBACK (descomentar e rodar só se for preciso desfazer; apaga os dados dessas tabelas):
-- drop table if exists public.rateio_omie_tentativas;
-- drop table if exists public.rateio_omie_lancamentos;
-- drop table if exists public.rateio_omie_autorizados;
-- drop table if exists public.rateio_omie_config;
-- drop table if exists public.rateio_omie_mapa;
-- -- restaura a policy de INSERT original de dash_rateio_execucoes (era WITH CHECK (true)):
-- drop policy if exists dash_rateio_execucoes_insert on public.dash_rateio_execucoes;
-- create policy dash_rateio_execucoes_insert on public.dash_rateio_execucoes
--   for insert to authenticated with check (true);
-- alter table public.dash_rateio_execucoes drop column if exists criado_por;
-- alter table public.dash_rateio_execucoes drop column if exists linhas;
