-- Item 4 da fila de 25/09/2026: envio mensal de nota fiscal.
--
-- O pedido do Samuel: "poder colocar o email + a NF e colocar uma mensagem
-- padrão, no qual esse disparo vai enviar para cada email a SUA NF com a
-- mensagem padrão".
--
-- O PROBLEMA QUE ORIGINOU A TAREFA: "foi enviado a nota fiscal para email
-- errado, acabou sendo confundido o email". Tudo aqui é desenhado em volta
-- disso — daí a lista de destinatários cadastrada, a conferência antes de
-- disparar, e o registro do que REALMENTE saiu.
--
-- ⚠️ POR QUE NÃO REUSEI A CAMPANHA (`email_campanhas`/`email_campanha_alvos`):
-- campanha é UMA mensagem para MUITOS, e `email_campanha_alvos` não tem
-- coluna de anexo. NF é o oposto: cada destinatário recebe um ARQUIVO
-- DIFERENTE. Forçar isso na campanha significaria mudar a `email-campanha`,
-- que hoje nem manda `attachments` para o Graph.
--
-- ⚠️ POR QUE O PDF NÃO É GUARDADO: o arquivo é escolhido na hora e vai direto
-- para o envio. Guardamos a FICHA dele (nome, tamanho, sha256) — que é o que
-- prova o que foi mandado para quem — sem espalhar documento fiscal por
-- bucket. Se um dia for preciso reenviar sem reescolher o arquivo, o bucket
-- `email-anexos` (privado, 50 MB) é o lugar.

-- ---------------------------------------------------------------------------
-- Quem pode disparar NF
-- ---------------------------------------------------------------------------
--
-- ⚠️ DE PROPÓSITO NÃO USA `public.pode_disparar()`. Aquela função hoje devolve
-- verdadeiro para TODO MUNDO que não tenha bloqueio explícito (decisão de
-- 09/09). Mandar nota fiscal para cliente é mais sensível que mandar campanha:
-- aqui a regra é lista de permissão, não lista de bloqueio.

create or replace function public.pode_enviar_nf(p_conta uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    public._is_admin()
    or exists (
      select 1 from public.email_accounts a
      where a.id = p_conta and a.user_id = auth.uid()
    )
    or exists (
      select 1 from public.tool_access ta
      where ta.user_id = auth.uid()
        and ta.tool = 'nf-automacao'
        and ta.permitido
    );
$function$;


-- ---------------------------------------------------------------------------
-- A lista mensal de quem recebe nota
-- ---------------------------------------------------------------------------

create table if not exists public.nf_destinatarios (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  nome       text not null,
  email      text not null,

  -- CNPJ/CPF é opcional e serve para CONFERÊNCIA humana na hora de parear o
  -- arquivo com a pessoa. O sistema NÃO lê o PDF para adivinhar o
  -- destinatário — foi essa adivinhação que mandou nota para o lugar errado.
  documento  text,

  observacao text,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,

  constraint nf_destinatarios_unico unique (account_id, email)
);

create index if not exists nf_destinatarios_por_conta
  on public.nf_destinatarios (account_id) where ativo;

create or replace function public.nf_destinatario_normaliza()
returns trigger
language plpgsql
as $function$
begin
  new.email := lower(trim(coalesce(new.email, '')));
  if new.email = '' then
    raise exception 'Informe o e-mail do destinatario.';
  end if;
  new.nome := trim(coalesce(new.nome, ''));
  if new.nome = '' then
    raise exception 'Informe o nome do destinatario.';
  end if;
  return new;
end;
$function$;

drop trigger if exists nf_destinatarios_normaliza on public.nf_destinatarios;
create trigger nf_destinatarios_normaliza
  before insert or update on public.nf_destinatarios
  for each row execute function public.nf_destinatario_normaliza();


-- ---------------------------------------------------------------------------
-- A mensagem padrão, configurável pelo próprio sistema
-- ---------------------------------------------------------------------------
--
-- Uma por caixa. `corpo_html` aceita os marcadores {{nome}} e {{documento}},
-- trocados no envio. Marcador é opcional: uma mensagem sem nenhum funciona.

create table if not exists public.nf_config (
  account_id    uuid primary key references public.email_accounts(id) on delete cascade,
  assunto       text not null default 'Nota fiscal',
  corpo_html    text not null default '<p>Olá, {{nome}}.</p><p>Segue em anexo a nota fiscal.</p>',
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles(id) on delete set null
);


-- ---------------------------------------------------------------------------
-- O disparo do mês, e o registro do que saiu
-- ---------------------------------------------------------------------------

create table if not exists public.nf_lotes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.email_accounts(id) on delete cascade,

  -- Ex.: '2026-09'. Só rótulo humano, para achar o lote depois.
  referencia  text,

  -- Cópia da mensagem no momento do disparo. NÃO é uma referência a
  -- `nf_config`: se a mensagem padrão mudar em novembro, o lote de setembro
  -- precisa continuar dizendo o que ele realmente mandou.
  assunto     text not null,
  corpo_html  text not null,

  status      text not null default 'rascunho'
              constraint nf_lotes_status_valido
              check (status in ('rascunho', 'enviando', 'enviado', 'parcial', 'cancelado')),

  criado_por  uuid references public.profiles(id) on delete set null,
  criado_em   timestamptz not null default now(),
  enviado_em  timestamptz
);

create index if not exists nf_lotes_por_conta on public.nf_lotes (account_id, criado_em desc);

create table if not exists public.nf_envios (
  id              uuid primary key default gen_random_uuid(),
  lote_id         uuid not null references public.nf_lotes(id) on delete cascade,

  -- Repetido aqui de propósito: deixa a RLS simples e direta, sem precisar
  -- passar pelo lote em toda leitura.
  account_id      uuid not null references public.email_accounts(id) on delete cascade,

  -- FK que pode ficar nula, mas o ENDEREÇO é cópia e é obrigatório. É o
  -- coração da auditoria: se alguém corrigir o cadastro do cliente em
  -- dezembro, o registro de setembro tem de continuar dizendo para onde a
  -- nota foi DE VERDADE. Era exatamente essa pergunta que ninguém conseguia
  -- responder quando a nota foi para o e-mail errado.
  destinatario_id uuid references public.nf_destinatarios(id) on delete set null,
  para_email      text not null,
  para_nome       text,

  arquivo_nome    text not null,
  arquivo_tamanho integer,
  arquivo_sha256  text,

  status          text not null default 'pendente'
                  constraint nf_envios_status_valido
                  check (status in ('pendente', 'enviado', 'falhou')),
  erro            text,
  enviado_em      timestamptz,
  criado_em       timestamptz not null default now()
);

create index if not exists nf_envios_por_lote on public.nf_envios (lote_id);
create index if not exists nf_envios_por_email on public.nf_envios (account_id, para_email, enviado_em desc);


-- ---------------------------------------------------------------------------
-- Acesso
-- ---------------------------------------------------------------------------

alter table public.nf_destinatarios enable row level security;
alter table public.nf_config        enable row level security;
alter table public.nf_lotes         enable row level security;
alter table public.nf_envios        enable row level security;

create policy nf_destinatarios_gerir on public.nf_destinatarios
  for all using (public.pode_enviar_nf(account_id))
  with check (public.pode_enviar_nf(account_id));

create policy nf_config_gerir on public.nf_config
  for all using (public.pode_enviar_nf(account_id))
  with check (public.pode_enviar_nf(account_id));

create policy nf_lotes_gerir on public.nf_lotes
  for all using (public.pode_enviar_nf(account_id))
  with check (public.pode_enviar_nf(account_id));

create policy nf_envios_gerir on public.nf_envios
  for all using (public.pode_enviar_nf(account_id))
  with check (public.pode_enviar_nf(account_id));
