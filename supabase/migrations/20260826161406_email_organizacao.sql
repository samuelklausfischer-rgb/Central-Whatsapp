-- Guardar informação sobre cada e-mail: quem cuida, o que é, e por quê.
--
-- O Email Hub mostrava a mensagem e não registrava nada sobre ela. Estas
-- tabelas são o registro — e a matéria-prima das automações da fase seguinte
-- (atribuir sozinho, cobrar prazo, avisar no WhatsApp).

begin;

-- ---------------------------------------------------------------------------
-- 1. Classificação: lista controlada, de valor único
-- ---------------------------------------------------------------------------
-- TABELA, e não `CHECK (classificacao in (...))`. A diferença importa: foi
-- pedido "outros tipos de filtro", e com CHECK cada tipo novo viraria uma
-- migration e um deploy. Como tabela, é uma linha — e a CHAVE continua
-- controlada, que é o que uma automação precisa para não depender de alguém ter
-- digitado "Importante" com I maiúsculo.
create table if not exists public.email_classificacoes (
  chave      text primary key,
  rotulo     text not null,
  cor        text not null,
  ordem      int  not null default 0,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.email_classificacoes is
  'Opcoes de triagem do email. Valor UNICO por email (ver email_states.classificacao). Tabela em vez de CHECK para tipo novo ser uma linha, nao um deploy.';

insert into public.email_classificacoes (chave, rotulo, cor, ordem) values
  ('importante', 'Importante', '#dc2626', 1),
  ('normal',     'Normal',     '#6b7280', 2),
  ('aguardando', 'Aguardando', '#d97706', 3),
  ('resolvido',  'Resolvido',  '#059669', 4),
  ('lixo',       'Lixo',       '#78716c', 5)
on conflict (chave) do nothing;

alter table public.email_states
  add column if not exists classificacao text references public.email_classificacoes(chave)
    on delete set null;

-- `internal_note` já existia e passa a ser a descrição livre que a tela mostra.
comment on column public.email_states.internal_note is
  'Descricao livre sobre o email, escrita por quem organizou. Opcional.';

-- ---------------------------------------------------------------------------
-- 2. Responsáveis: várias pessoas, cada uma com papel
-- ---------------------------------------------------------------------------
create table if not exists public.email_responsaveis (
  id           uuid primary key default gen_random_uuid(),
  email_id     uuid not null references public.emails(id)   on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- `responsavel` é quem tem que resolver; `acompanhando` é quem precisa saber.
  -- Sem a distinção, marcar cinco pessoas é o mesmo que não marcar ninguém.
  papel        text not null default 'responsavel' check (papel in ('responsavel','acompanhando')),
  definido_por uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (email_id, user_id)
);

comment on table public.email_responsaveis is
  'Quem cuida de cada email. FONTE UNICA -- email_states.assigned_to nao e mais usado.';

create index if not exists email_responsaveis_email_idx on public.email_responsaveis (email_id);
create index if not exists email_responsaveis_user_idx  on public.email_responsaveis (user_id);

-- Duas colunas respondendo "quem é o responsável" divergem no primeiro bug, e a
-- que aceita várias pessoas com papel é a nova. A coluna fica (nada aponta para
-- ela, e a tabela está vazia), mas o comentário existe para ninguém voltar a
-- usá-la por engano.
comment on column public.email_states.assigned_to is
  'NAO USAR. Substituida por public.email_responsaveis, que aceita varias pessoas com papel. Mantida so para nao quebrar consulta antiga.';

-- ---------------------------------------------------------------------------
-- 3. Etiquetas — só de e-mail
-- ---------------------------------------------------------------------------
-- Separadas de `labels`, que é do WhatsApp. Hoje as 4 de lá são MEDICO,
-- TÉCNICO CUIABÁ, UN. KETLIN e Teste: apareceriam como opção ao etiquetar um
-- boleto, e as de e-mail poluiriam a tela de conversas.
--
-- `contact_tags.email_id` existe e o serviço já gravava nela, mas com ZERO
-- vínculos de e-mail — então não há dado a migrar, só código a repontar.
create table if not exists public.email_etiquetas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  cor        text not null default '#3b82f6',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.email_etiqueta_itens (
  id          uuid primary key default gen_random_uuid(),
  email_id    uuid not null references public.emails(id)          on delete cascade,
  etiqueta_id uuid not null references public.email_etiquetas(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (email_id, etiqueta_id)
);

create index if not exists email_etiqueta_itens_email_idx on public.email_etiqueta_itens (email_id);

comment on column public.contact_tags.email_id is
  'NAO USAR para email. Etiqueta de email vive em public.email_etiqueta_itens desde 26/08/2026. Coluna mantida porque a tabela e de outra area.';

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- Quem enxerga o e-mail enxerga o que está preso a ele. A regra não é reescrita
-- aqui: `_pode_ver_conta_de_email` já é a definição única de acesso a caixa, e
-- repetir a condição em cada tabela foi exatamente o que deixou `emails` e
-- `email_accounts` divergirem antes.
alter table public.email_classificacoes  enable row level security;
alter table public.email_responsaveis    enable row level security;
alter table public.email_etiquetas       enable row level security;
alter table public.email_etiqueta_itens  enable row level security;

-- A lista de opções é pública para quem está logado: é catálogo, não dado.
create policy email_classificacoes_ver on public.email_classificacoes
  for select using (auth.uid() is not null);
create policy email_classificacoes_admin on public.email_classificacoes
  for all using (public._is_admin()) with check (public._is_admin());

create policy email_responsaveis_tudo on public.email_responsaveis
  for all using (
    exists (select 1 from public.emails e
            where e.id = email_responsaveis.email_id
              and public._pode_ver_conta_de_email(e.account_id))
  ) with check (
    exists (select 1 from public.emails e
            where e.id = email_responsaveis.email_id
              and public._pode_ver_conta_de_email(e.account_id))
  );

-- Etiqueta é catálogo compartilhado: qualquer pessoa logada vê e cria. Apagar
-- é só de admin — apagar etiqueta some com ela de todos os e-mails de todo
-- mundo, e isso não pode ser um clique de qualquer um.
create policy email_etiquetas_ver on public.email_etiquetas
  for select using (auth.uid() is not null);
create policy email_etiquetas_criar on public.email_etiquetas
  for insert with check (auth.uid() is not null);
create policy email_etiquetas_admin on public.email_etiquetas
  for all using (public._is_admin()) with check (public._is_admin());

create policy email_etiqueta_itens_tudo on public.email_etiqueta_itens
  for all using (
    exists (select 1 from public.emails e
            where e.id = email_etiqueta_itens.email_id
              and public._pode_ver_conta_de_email(e.account_id))
  ) with check (
    exists (select 1 from public.emails e
            where e.id = email_etiqueta_itens.email_id
              and public._pode_ver_conta_de_email(e.account_id))
  );

commit;
