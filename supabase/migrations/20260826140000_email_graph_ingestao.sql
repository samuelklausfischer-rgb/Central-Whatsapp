-- Email Hub: schema para receber os e-mails do Microsoft Graph.
--
-- O schema original foi desenhado para IMAP (`imap_uid`, `imap_path`) e não
-- serve para o Graph, que identifica mensagem e pasta por id próprio. Sem esse
-- id não há como evitar importar a mesma mensagem duas vezes nem como buscar o
-- anexo depois.

begin;

-- ---------------------------------------------------------------------------
-- 1. Uma única definição de "quem enxerga esta caixa"
-- ---------------------------------------------------------------------------
-- As policies de `emails`, `email_folders` e `email_states` foram escritas
-- antes do acesso por setor existir: elas só olhavam `ea.user_id = uid()` e a
-- lista `user_allowed_email_accounts`. Resultado — quem é do Financeiro
-- enxergava a CONTA (policy nova de `email_accounts`) e não enxergava NENHUM
-- e-mail dela. A caixa apareceria vazia, sem erro nenhum.
--
-- Em vez de repetir a regra em quatro lugares e deixar as cópias divergirem de
-- novo, ela passa a morar aqui. SECURITY DEFINER de propósito: a função lê
-- `email_accounts` e `user_sectors` por dentro, e sem isso a RLS dessas tabelas
-- seria aplicada outra vez a cada linha — caro e desnecessário, já que a função
-- é justamente a autoridade sobre o assunto.
create or replace function public._pode_ver_conta_de_email(conta uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.email_accounts a
    where a.id = conta
      and (
        -- dono da caixa (conta pessoal, ou o admin que conectou a do setor)
        a.user_id = auth.uid()
        -- administrador enxerga todas
        or public._is_admin()
        -- todo o setor enxerga a caixa do setor
        or (
          a.department is not null
          and exists (
            select 1 from public.user_sectors us
            where us.user_id = auth.uid() and us.setor = a.department
          )
        )
        -- liberação individual, caixa a caixa
        or exists (
          select 1 from public.user_allowed_email_accounts u
          where u.account_id = a.id and u.user_id = auth.uid()
        )
      )
  );
$$;

comment on function public._pode_ver_conta_de_email(uuid) is
  'Unica definicao de quem enxerga uma caixa de email: dono, admin, gente do setor (user_sectors) ou liberacao individual. Usada pelas policies de emails, pastas, estados e anexos para a regra nao divergir entre elas.';

-- `user_allowed_email_accounts` existia desde 06/2026 e NUNCA teve efeito:
-- nenhuma policy consultava a tabela. A partir daqui ela passa a valer.

drop policy if exists emails_user_own        on public.emails;
drop policy if exists email_folders_user_own on public.email_folders;
drop policy if exists email_states_user_own  on public.email_states;

create policy emails_visiveis on public.emails
  for all using (public._pode_ver_conta_de_email(account_id));

create policy email_folders_visiveis on public.email_folders
  for all using (public._pode_ver_conta_de_email(account_id));

create policy email_states_visiveis on public.email_states
  for all using (
    exists (
      select 1 from public.emails e
      where e.id = email_states.email_id
        and public._pode_ver_conta_de_email(e.account_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Pastas, agora em árvore
-- ---------------------------------------------------------------------------
alter table public.email_folders
  add column if not exists graph_id         text,
  -- O que permite a árvore do Outlook. `FolderTree` hoje só separa sistema de
  -- personalizada, tudo plano; com isto passa a ter nível.
  add column if not exists parent_id        uuid references public.email_folders(id) on delete cascade,
  -- inbox | drafts | sentitems | deleteditems | junkemail | archive
  add column if not exists well_known_name  text,
  add column if not exists total_count      int  not null default 0,
  add column if not exists unread_count     int  not null default 0,
  -- Ponteiro do Graph para "o que mudou desde a última vez". É o que faz a
  -- varredura ser barata: sem ele, cada passada releria a pasta inteira.
  add column if not exists delta_link       text,
  add column if not exists last_sync_at     timestamptz;

create unique index if not exists email_folders_conta_graph_idx
  on public.email_folders (account_id, graph_id) where graph_id is not null;

create index if not exists email_folders_parent_idx
  on public.email_folders (parent_id);

-- ---------------------------------------------------------------------------
-- 3. Mensagens
-- ---------------------------------------------------------------------------
alter table public.emails
  add column if not exists graph_id            text,
  -- O Message-ID do cabeçalho, que sobrevive entre sistemas. Serve para casar
  -- resposta com original quando os dois lados usam servidores diferentes.
  add column if not exists internet_message_id text,
  -- Como o Outlook agrupa a conversa. `thread_id` continua existindo, mas quem
  -- manda no Graph é este.
  add column if not exists conversation_id     text,
  add column if not exists has_attachments     boolean not null default false,
  add column if not exists importance          text,
  add column if not exists is_draft            boolean not null default false,
  add column if not exists web_link            text,
  -- Primeira linha do corpo, que a lista mostra em cinza. Vem pronto do Graph;
  -- calcular no cliente obrigaria a baixar o corpo inteiro de cada mensagem só
  -- para montar a lista.
  add column if not exists body_preview        text;

-- O índice que impede duplicata. O aviso em tempo real e a varredura de
-- segurança PODEM tratar a mesma mensagem ao mesmo tempo — é esperado, não é
-- defeito. Com este índice a segunda gravação vira um upsert silencioso em vez
-- de uma linha repetida na tela.
create unique index if not exists emails_conta_graph_idx
  on public.emails (account_id, graph_id) where graph_id is not null;

-- Como a lista realmente consulta: uma pasta, mais recentes primeiro.
create index if not exists emails_listagem_idx
  on public.emails (account_id, folder_id, received_at desc);

create index if not exists emails_conversa_idx
  on public.emails (account_id, conversation_id) where conversation_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Anexos
-- ---------------------------------------------------------------------------
-- Tabela própria, e não o campo `emails.attachments` (jsonb) que já existe:
-- com tabela dá para listar, contar e marcar UM anexo como guardado sem
-- reescrever o e-mail inteiro. O jsonb fica onde está, sem uso novo.
--
-- `storage_path` nulo é o normal: por decisão de 26/08/2026 o anexo continua na
-- Microsoft e é buscado na hora de abrir. Só o que o usuário mandar guardar
-- ganha caminho aqui.
create table if not exists public.email_attachments (
  id                  uuid primary key default gen_random_uuid(),
  email_id            uuid not null references public.emails(id) on delete cascade,
  graph_attachment_id text not null,
  name                text not null,
  mime_type           text,
  size                bigint,
  is_inline           boolean not null default false,
  -- Usado pelas imagens embutidas no corpo (cid:...).
  content_id          text,
  storage_path        text,
  guardado_em         timestamptz,
  created_at          timestamptz not null default now(),
  unique (email_id, graph_attachment_id)
);

comment on table public.email_attachments is
  'Manifesto dos anexos de cada email. O binario fica na Microsoft e e buscado sob demanda; storage_path so e preenchido quando alguem manda guardar no bucket email-anexos.';

create index if not exists email_attachments_email_idx on public.email_attachments (email_id);

alter table public.email_attachments enable row level security;

create policy email_attachments_visiveis on public.email_attachments
  for all using (
    exists (
      select 1 from public.emails e
      where e.id = email_attachments.email_id
        and public._pode_ver_conta_de_email(e.account_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. A inscrição do aviso em tempo real
-- ---------------------------------------------------------------------------
-- A Microsoft avisa quando chega e-mail, mas a inscrição VENCE em ~3 dias. Se a
-- renovação falhar, os avisos param sem erro nenhum e a caixa congela em
-- silêncio. Guardar `expires_at` é o que permite renovar antes e, principalmente,
-- PERCEBER que parou.
create table if not exists public.email_subscriptions (
  account_id      uuid primary key references public.email_accounts(id) on delete cascade,
  subscription_id text not null,
  resource        text not null,
  -- Segredo que volta em cada aviso. A URL do aviso é pública por natureza:
  -- sem conferir isto, qualquer um na internet forjaria uma notificação.
  client_state    text not null,
  expires_at      timestamptz not null,
  last_notified_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.email_subscriptions is
  'Inscricao de aviso do Microsoft Graph por caixa. RLS ligada e SEM POLICY: so service_role, porque client_state e segredo.';

alter table public.email_subscriptions enable row level security;
revoke all on public.email_subscriptions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Histórico de sincronização
-- ---------------------------------------------------------------------------
-- Existe para responder "por que não chegou e-mail" sem adivinhação.
--
-- NÃO tem coluna de status como fonte da verdade. Os jobs de importação do
-- WhatsApp ficaram presos em `running` para sempre e bloquearam novas
-- importações — o status mentia. Aqui quem decide se ainda está rodando é o
-- RELÓGIO: `finished_at is null and started_at > now() - interval '10 minutes'`.
-- Uma execução que morreu simplesmente envelhece e para de atrapalhar.
create table if not exists public.email_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.email_accounts(id) on delete cascade,
  origem      text not null check (origem in ('inicial', 'varredura', 'aviso', 'manual')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  novos       int not null default 0,
  atualizados int not null default 0,
  erro        text
);

create index if not exists email_sync_runs_conta_idx
  on public.email_sync_runs (account_id, started_at desc);

alter table public.email_sync_runs enable row level security;

create policy email_sync_runs_visiveis on public.email_sync_runs
  for select using (public._pode_ver_conta_de_email(account_id));

-- ---------------------------------------------------------------------------
-- 7. Onde ficam os anexos que forem guardados
-- ---------------------------------------------------------------------------
-- Privado: anexo de e-mail é conteúdo de terceiro e não pode ficar acessível
-- por URL adivinhada. A entrega passa pela edge function, que confere quem é.
insert into storage.buckets (id, name, public, file_size_limit)
values ('email-anexos', 'email-anexos', false, 52428800)
on conflict (id) do nothing;

commit;
