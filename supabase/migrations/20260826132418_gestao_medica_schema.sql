-- Gestão Médica renasce como schema deste projeto Supabase.
--
-- POR QUE AQUI, E NÃO NUM PROJETO PRÓPRIO
-- O sistema vivia no projeto Supabase Cloud `xhwwmqgpmmdfinyfxiry`, que foi
-- EXCLUÍDO — o host não resolve nem no DNS público, e projeto pausado mantém DNS.
-- Reconstruindo dentro do projeto do Central Whats, a integração futura vira o
-- caso "mesmo projeto" (transporta a sessão, como o Relatórios) em vez do caso
-- "outro projeto" (ponte com OTP, como o Licitações). Isso elimina de uma vez a
-- edge function de ponte, a conta espelhada e a allowlist do sistema antigo —
-- que, aliás, não cobria NENHUM e-mail do setor Administrativo.
-- Precedente: os schemas `relatorios`, `financeiro` e `laudos` já convivem aqui.
--
-- DE ONDE VEIO ESTE SCHEMA
-- Do CÓDIGO do app, não de `docs/03-database-model.md`. O doc está desatualizado:
-- fala em `categoria`/`status` onde o app usa `categoria_medico`/`status_cadastro`,
-- não tem `municipio`/`uf`/`data_nascimento`/`grupo_origem`, e ignora cinco
-- tabelas que o app usa (`certidoes_medicas`, `dados_bancarios_medicos`,
-- `dados_pj`, `formacoes_medicas`, `importacao_arquivos`). As colunas abaixo saem
-- de `src/services/api.ts`, `pages/medicos/Form.tsx`, `AiUpload.tsx`, `List.tsx`,
-- `hooks/use-auth.tsx` e do `docs/importacao/seed.sql`.

create schema if not exists gestao_medica;

grant usage on schema gestao_medica to anon, authenticated, service_role;

-- =========================================================================
-- Quem pode usar o sistema
-- =========================================================================
--
-- SECURITY DEFINER porque as policies abaixo consultam `public.profiles`, que tem
-- RLS própria — sem isso, cada checagem dispararia a policy de profiles e a de
-- profiles não enxerga a linha de terceiros, o que faria toda policy daqui dar
-- falso para todo mundo.
create or replace function gestao_medica._pode_usar()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (coalesce(is_admin, false) or department = 'Administrativo')
  );
$$;

comment on function gestao_medica._pode_usar() is
  'Quem enxerga e opera o Gestão Médica: setor Administrativo ou admin do Central
   Whats. É a regra pedida no item do Hub ("para o setor adm"), num lugar só.';

/**
 * `profiles` do Gestão Médica é uma VIEW, não uma tabela.
 *
 * O app lê `profiles(id, name, role, active)` e BARRA O LOGIN quando `active` é
 * falso (`use-auth.tsx:67,110,149`). Apontando a view para `public.profiles`, a
 * permissão por setor sai de graça: quem é do Administrativo entra, o resto é
 * barrado pelo próprio app, e não existe cadastro paralelo para manter em dia.
 *
 * `security_invoker = true` (PG 15+) é o que preserva a RLS de `public.profiles`:
 * sem ele a view rodaria com os direitos do dono e exporia a equipe inteira. Com
 * ele, cada um continua enxergando só a própria linha — que é exatamente o que o
 * app consulta.
 */
create or replace view gestao_medica.profiles
with (security_invoker = true)
as
select
  p.id,
  p.name,
  case when coalesce(p.is_admin, false) then 'admin' else 'operacional' end as role,
  -- O `coalesce` de fora nao e redundante: quem tem `department` NULO cairia em
  -- `false or null` = NULL, e nao em false. O app trata null como falso por
  -- acaso (`if (!profile.active)` em JS), mas um filtro `.eq('active', false)`
  -- perderia essas pessoas e uma policy `using (active)` negaria por sorte.
  coalesce(coalesce(p.is_admin, false) or p.department = 'Administrativo', false) as active
from public.profiles p;

grant select on gestao_medica.profiles to authenticated;

-- =========================================================================
-- Tabelas
-- =========================================================================
--
-- SOBRE OS DOMÍNIOS DE VALOR: `categoria_medico` e `tipo_contratacao` ganham
-- CHECK porque o próprio app declara a lista fechada no Zod (`Form.tsx:47-53`).
-- `status_cadastro` fica texto livre DE PROPÓSITO: o código usa
-- 'Pendente de Revisão' e 'Pendente de revisão' em lugares diferentes, e um CHECK
-- rejeitaria uma das duas — a divergência é evidência de que o original também
-- não tinha constraint ali.

create table if not exists gestao_medica.medicos (
  id                 uuid primary key default gen_random_uuid(),
  nome_completo      text not null,
  cpf                text unique,
  data_nascimento    date,
  -- NULOS PERMITIDOS, ao contrario do que o doc dizia. 41 dos 148 medicos
  -- importados do SharePoint nao tem CRM e 48 nao tem UF: sao as pastas cujo
  -- nome nao trazia o registro ("CRM nao consta no nome da pasta - preencher via
  -- extracao dos documentos (N4)"). `not null` aqui impediria a carga do proprio
  -- acervo que existe.
  crm                text,
  uf_crm             text,
  rqe                text,
  especialidade      text,
  email              text,
  telefone           text,
  municipio          text,
  uf                 text,
  cnes               text,
  categoria_medico   text not null
    check (categoria_medico in ('MEDICO PRN','MEDICO PALHOÇA','MEDICO APICE TELE','MEDICO TELEIMAGEM')),
  tipo_contratacao   text not null check (tipo_contratacao in ('SCP','PJ')),
  contrato_assinado  boolean not null default false,
  origem_cadastro    text not null default 'manual',
  status_cadastro    text not null default 'Rascunho',
  ativo              boolean not null default true,
  grupo_origem       text,
  observacoes        text,
  created_by         uuid references auth.users(id) on delete set null,
  updated_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  -- 128 dos 148 registros do seed não têm CPF, então a unicidade real do
  -- cadastro é o registro no conselho, não o CPF.
  constraint medicos_crm_uf_unico unique (crm, uf_crm)
);

create index if not exists medicos_status_idx    on gestao_medica.medicos (status_cadastro);
create index if not exists medicos_ativo_idx     on gestao_medica.medicos (ativo);
create index if not exists medicos_nome_idx      on gestao_medica.medicos (nome_completo);
create index if not exists medicos_municipio_idx on gestao_medica.medicos (municipio);

create table if not exists gestao_medica.dados_pj (
  id                 uuid primary key default gen_random_uuid(),
  medico_id          uuid not null references gestao_medica.medicos(id) on delete cascade,
  cnpj               text,
  razao_social       text,
  nome_fantasia      text,
  responsavel_legal  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists dados_pj_medico_idx on gestao_medica.dados_pj (medico_id);

-- Um médico pode ter mais de um contrato ativo ao mesmo tempo (ex.: um com a PRN
-- e outro com a Medimagem) — não há unicidade por `medico_id`.
create table if not exists gestao_medica.contratos_medicos (
  id                       uuid primary key default gen_random_uuid(),
  medico_id                uuid not null references gestao_medica.medicos(id) on delete cascade,
  contratante              text,
  data_assinatura          date,
  vigencia_inicio          date,
  vigencia_fim             date,
  modelo_remuneracao       text,
  valor_acordado           numeric(12,2),
  descricao_modelo_outro   text,
  ativo                    boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists contratos_medico_idx   on gestao_medica.contratos_medicos (medico_id);
-- `listExpiring` filtra por ativo + faixa de vigencia_fim (api.ts:166).
create index if not exists contratos_vigencia_idx on gestao_medica.contratos_medicos (ativo, vigencia_fim);

create table if not exists gestao_medica.documentos_medicos (
  id                   uuid primary key default gen_random_uuid(),
  medico_id            uuid not null references gestao_medica.medicos(id) on delete cascade,
  storage_bucket       text not null default 'medico-documentos',
  storage_path         text not null,
  nome_arquivo         text not null,
  mime_type            text,
  tamanho_bytes        bigint,
  categoria_documento  text not null default 'Outro',
  status_validacao     text not null default 'Pendente',
  ativo                boolean not null default true,
  uploaded_by          uuid references auth.users(id) on delete set null,
  validated_by         uuid references auth.users(id) on delete set null,
  validated_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists documentos_medico_idx on gestao_medica.documentos_medicos (medico_id);

create table if not exists gestao_medica.formacoes_medicas (
  id           uuid primary key default gen_random_uuid(),
  medico_id    uuid not null references gestao_medica.medicos(id) on delete cascade,
  tipo         text,
  titulo       text,
  instituicao  text,
  ano_inicio   text,
  ano_fim      text,
  observacoes  text,
  metadata     jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists formacoes_medico_idx on gestao_medica.formacoes_medicas (medico_id);

create table if not exists gestao_medica.certidoes_medicas (
  id             uuid primary key default gen_random_uuid(),
  medico_id      uuid not null references gestao_medica.medicos(id) on delete cascade,
  tipo           text,
  numero         text,
  orgao_emissor  text,
  data_emissao   date,
  validade       date,
  status         text,
  metadata       jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists certidoes_medico_idx on gestao_medica.certidoes_medicas (medico_id);

create table if not exists gestao_medica.dados_bancarios_medicos (
  id          uuid primary key default gen_random_uuid(),
  medico_id   uuid not null references gestao_medica.medicos(id) on delete cascade,
  banco       text,
  agencia     text,
  conta       text,
  chave_pix   text,
  titular     text,
  metadata    jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bancarios_medico_idx on gestao_medica.dados_bancarios_medicos (medico_id);

create table if not exists gestao_medica.importacoes_ia_medicos (
  id                  uuid primary key default gen_random_uuid(),
  status_revisao      text not null default 'Pendente de Revisão',
  json_extraido       jsonb,
  json_aprovado       jsonb,
  confianca_extracao  jsonb,
  approved_at         timestamptz,
  medico_id           uuid references gestao_medica.medicos(id) on delete set null,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists importacoes_status_idx on gestao_medica.importacoes_ia_medicos (status_revisao);

create table if not exists gestao_medica.importacao_arquivos (
  id                      uuid primary key default gen_random_uuid(),
  importacao_id           uuid not null references gestao_medica.importacoes_ia_medicos(id) on delete cascade,
  storage_bucket          text not null default 'medico-documentos',
  storage_path            text not null,
  preview_storage_path    text,
  nome_arquivo            text,
  nome_original           text,
  mime_type               text,
  tamanho_bytes           bigint,
  file_hash               text,
  status_processamento    text not null default 'enviado',
  signed_url_expires_at   timestamptz,
  metadata                jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists importacao_arquivos_importacao_idx on gestao_medica.importacao_arquivos (importacao_id);

create table if not exists gestao_medica.auditoria_medicos (
  id              uuid primary key default gen_random_uuid(),
  medico_id       uuid references gestao_medica.medicos(id) on delete set null,
  usuario_id      uuid references auth.users(id) on delete set null,
  acao            text not null,
  campo_alterado  text,
  valor_anterior  text,
  valor_novo      text,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists auditoria_medico_idx on gestao_medica.auditoria_medicos (medico_id);
create index if not exists auditoria_data_idx   on gestao_medica.auditoria_medicos (created_at desc);

create table if not exists gestao_medica.notificacoes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  titulo      text not null,
  mensagem    text not null,
  lida        boolean not null default false,
  prioridade  text not null default 'media',
  tipo        text not null default 'sistema',
  link        text,
  metadata    jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists gm_notificacoes_user_idx on gestao_medica.notificacoes (user_id, lida);

create table if not exists gestao_medica.filtros_salvos (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  nome               text not null,
  configuracao_json  jsonb not null,
  favorito           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists filtros_user_idx on gestao_medica.filtros_salvos (user_id);

-- `singleton_key` não está no doc, mas o app busca por
-- `.eq('singleton_key', 'default')` (api.ts:504) — sem essa coluna a tela de
-- configurações não acha nada e o app abre sem parâmetros.
create table if not exists gestao_medica.configuracoes_sistema (
  id                       uuid primary key default gen_random_uuid(),
  singleton_key            text not null unique default 'default',
  dias_alerta_contrato     integer not null default 30,
  documentos_obrigatorios  jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

insert into gestao_medica.configuracoes_sistema (singleton_key)
values ('default')
on conflict (singleton_key) do nothing;

-- =========================================================================
-- updated_at
-- =========================================================================
-- Reusa `public.trigger_set_updated_at()`, que já existe neste banco.
do $$
declare t text;
begin
  foreach t in array array[
    'medicos','dados_pj','contratos_medicos','documentos_medicos','formacoes_medicas',
    'certidoes_medicas','dados_bancarios_medicos','importacoes_ia_medicos',
    'importacao_arquivos','notificacoes','filtros_salvos','configuracoes_sistema'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on gestao_medica.%I;
       create trigger set_updated_at before update on gestao_medica.%I
       for each row execute function public.trigger_set_updated_at();', t, t);
  end loop;
end $$;

-- =========================================================================
-- RLS
-- =========================================================================
-- Duas famílias:
--   operacionais  -> quem `_pode_usar()` lê e escreve (é um sistema de equipe,
--                    não um app com dado por pessoa);
--   pessoais      -> `notificacoes` e `filtros_salvos` são de cada um.
do $$
declare t text;
begin
  foreach t in array array[
    'medicos','dados_pj','contratos_medicos','documentos_medicos','formacoes_medicas',
    'certidoes_medicas','dados_bancarios_medicos','importacoes_ia_medicos',
    'importacao_arquivos','auditoria_medicos','configuracoes_sistema'
  ] loop
    execute format('alter table gestao_medica.%I enable row level security;', t);
    execute format('drop policy if exists gm_equipe on gestao_medica.%I;', t);
    execute format(
      'create policy gm_equipe on gestao_medica.%I
       for all to authenticated
       using (gestao_medica._pode_usar())
       with check (gestao_medica._pode_usar());', t);
  end loop;

  foreach t in array array['notificacoes','filtros_salvos'] loop
    execute format('alter table gestao_medica.%I enable row level security;', t);
    execute format('drop policy if exists gm_proprio on gestao_medica.%I;', t);
    execute format(
      'create policy gm_proprio on gestao_medica.%I
       for all to authenticated
       using (user_id = auth.uid())
       with check (user_id = auth.uid());', t);
  end loop;
end $$;

-- Privilégio de tabela é separado de RLS: sem o grant, o PostgREST devolve 42501
-- antes mesmo de a policy ser avaliada.
grant select, insert, update, delete on all tables in schema gestao_medica to authenticated;
grant all on all tables in schema gestao_medica to service_role;
alter default privileges in schema gestao_medica
  grant select, insert, update, delete on tables to authenticated;

-- =========================================================================
-- Storage
-- =========================================================================
--
-- O app referencia o bucket por CONSTANTE (`const BUCKET = 'medico-documentos'`,
-- services/api.ts:3) — foi por isso que a primeira varredura por
-- `.storage.from('...')` deu vazio e cheguei a concluir que Storage nao era
-- usado. E usado: upload de documento, `getPublicUrl` e `createSignedUrl`.
--
-- PRIVADO. Sao documentos pessoais de medico (CPF, diploma, contrato, dados
-- bancarios). O caminho certo de leitura e o `createSignedUrl`, que o app ja
-- implementa; `getFileUrl` vai devolver URL que nao abre — preferivel a deixar
-- documento de terceiro acessivel a quem descobrir o caminho.
insert into storage.buckets (id, name, public, file_size_limit)
values ('medico-documentos', 'medico-documentos', false, 52428800)
on conflict (id) do nothing;

drop policy if exists gm_documentos_ler on storage.objects;
create policy gm_documentos_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'medico-documentos' and gestao_medica._pode_usar());

drop policy if exists gm_documentos_gravar on storage.objects;
create policy gm_documentos_gravar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'medico-documentos' and gestao_medica._pode_usar());

drop policy if exists gm_documentos_atualizar on storage.objects;
create policy gm_documentos_atualizar on storage.objects
  for update to authenticated
  using (bucket_id = 'medico-documentos' and gestao_medica._pode_usar());

drop policy if exists gm_documentos_apagar on storage.objects;
create policy gm_documentos_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'medico-documentos' and gestao_medica._pode_usar());

-- =========================================================================
-- Expor o schema no PostgREST
-- =========================================================================
--
-- ATENÇÃO: este ALTER ROLE **substitui a lista inteira**. A lista atual é
-- 'public, storage, graphql_public, relatorios, laudos' — omitir `relatorios` ou
-- `laudos` derruba as ferramentas de Relatórios e de Laudos.
--
-- Vai por SQL, e não pelo `.env` do EasyPanel, porque é assim que este stack
-- funciona: o PostgREST lê `pgrst.db_schemas` do BANCO (config de role), não do
-- container — foi como `relatorios` e `laudos` entraram, e é por isso que o
-- `.env` de lá lista só os três primeiros. A vantagem é não recriar container
-- nenhum, o que neste stack é operação de risco (os segredos do `.env` estão em
-- placeholder).
alter role authenticator
  set pgrst.db_schemas = 'public, storage, graphql_public, relatorios, laudos, gestao_medica';

notify pgrst, 'reload config';
