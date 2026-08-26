-- Disparo de e-mail para listas (médicos e clínicas parceiras).
--
-- CONTEXTO. Primeiro caso: ~200 parceiros, comunicado B2B, saindo pela caixa da
-- própria empresa via Microsoft Graph. Cabe com folga nos limites do Exchange
-- Online (30 mensagens/minuto, 10.000 destinatários/dia) — 200 leva ~7 minutos.
--
-- O QUE A MICROSOFT DIZ, e por que o schema já prevê outro canal: a
-- documentação de limites afirma que "o Exchange Online não é adequado para
-- cenários de envio em massa" e manda usar provedor terceiro para e-mail
-- comercial em massa. Comunicado para parceiro com relação existente não é esse
-- caso — mas campanha de marketing seria. Por isso `email_campanhas.canal`
-- nasce aqui: quando aparecer marketing de verdade, ele sai por provedor
-- dedicado sem reescrever tabela nenhuma.
--
-- POR QUE NÃO REUSAR AS TABELAS `disparo_*` (do disparador de WhatsApp):
-- elas são de WhatsApp por dentro — `remote_sender`, `device_id`,
-- `tem_whatsapp`. Uma lista de e-mail precisa de coisas que uma de WhatsApp não
-- tem (descadastro, retorno de erro, supressão permanente). O que foi reusado
-- daqui é o DESENHO do ritmo e da fila com trava, que já está provado lá.

begin;

-- ---------------------------------------------------------------------------
-- Quem pode disparar e-mail
-- ---------------------------------------------------------------------------
-- Permissão PRÓPRIA, separada de `pode_disparar()` (WhatsApp), embora o padrão
-- seja o mesmo. Os riscos são diferentes: um disparo de WhatsApp mal feito
-- queima um número; um de e-mail mal feito queima a reputação do domínio que a
-- empresa inteira usa para boleto e laudo.
create or replace function public.pode_disparar_email()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public._is_admin() or exists (
    select 1 from public.tool_access
    where user_id = auth.uid() and tool = 'disparador-email'
  );
$$;

comment on function public.pode_disparar_email() is
  'Quem pode criar lista e campanha de email. Separada de pode_disparar() de proposito: o estrago de um disparo ruim de email e a reputacao do dominio inteiro.';

-- ---------------------------------------------------------------------------
-- Listas
-- ---------------------------------------------------------------------------
create table if not exists public.email_listas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  descricao   text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.email_lista_membros (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references public.email_listas(id) on delete cascade,
  -- Sempre minúsculo: "Joao@X.com" e "joao@x.com" são a mesma pessoa, e sem
  -- normalizar a supressão não pega — a pessoa descadastra e continua recebendo.
  email        text not null,
  nome         text,
  organizacao  text,
  -- De onde veio este contato. Campo de texto livre, mas OBRIGATÓRIO: é o que
  -- responde "por que vocês estão me escrevendo?" quando alguém reclamar, e é a
  -- diferença entre lista legítima e lista comprada.
  origem       text not null,
  created_at   timestamptz not null default now(),
  unique (list_id, email)
);

create index if not exists email_lista_membros_lista_idx on public.email_lista_membros (list_id);

-- ---------------------------------------------------------------------------
-- Supressão — a tabela mais importante deste arquivo
-- ---------------------------------------------------------------------------
-- GLOBAL, e não por campanha. Supressão por campanha é o mesmo que não ter
-- supressão: a pessoa pede para sair de uma lista e recebe pela próxima, agora
-- irritada — e dessa vez ela marca como spam em vez de descadastrar.
create table if not exists public.email_supressao (
  email      text primary key,
  motivo     text not null check (motivo in ('descadastro','bounce','reclamacao','manual')),
  detalhe    text,
  campaign_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.email_supressao is
  'Quem nunca mais pode receber disparo: descadastrou, deu erro permanente ou reclamou. Global, atravessa todas as listas e campanhas. Email sempre em minusculas.';

-- ---------------------------------------------------------------------------
-- Campanhas
-- ---------------------------------------------------------------------------
create table if not exists public.email_campanhas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  -- De qual caixa sai. `restrict` porque apagar a conta com campanha enviada
  -- destruiria o histórico de quem recebeu o quê.
  account_id    uuid not null references public.email_accounts(id) on delete restrict,
  list_id       uuid not null references public.email_listas(id)   on delete restrict,
  -- `outlook` hoje; `esp` fica reservado para provedor dedicado, quando houver
  -- campanha de marketing de verdade.
  canal         text not null default 'outlook' check (canal in ('outlook','esp')),

  assunto       text not null,
  corpo_html    text not null,
  -- Versão em texto puro. Mensagem só-HTML pontua pior em filtro de spam, e
  -- cliente antigo mostra tela em branco.
  corpo_texto   text,
  responder_para text,

  status        text not null default 'rascunho'
                check (status in ('rascunho','preparada','enviando','pausada','concluida','cancelada')),

  /*
    Ritmo. Copiado do modelo de `disparo_campanhas` (WhatsApp), que já foi
    pensado para não parecer robô.

    O teto real do Exchange é 30 mensagens por minuto. O padrão aqui trabalha em
    torno de 15/min DE PROPÓSITO: encostar no teto faz o próprio Exchange
    segurar a fila, e pico repentino de envio é sinal clássico de conta invadida.
  */
  delay_min_ms      int  not null default 2500,
  delay_max_ms      int  not null default 6000,
  pausa_a_cada      int  not null default 25,
  pausa_longa_ms    int  not null default 60000,
  -- Ninguém manda 200 e-mails às 3h da manhã. O horário entra na avaliação do
  -- remetente, e um parceiro que recebe de madrugada percebe que é robô.
  respeitar_horario boolean  not null default true,
  hora_inicio       smallint not null default 8,
  hora_fim          smallint not null default 18,

  agendado_para timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  iniciado_em   timestamptz,
  concluido_em  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Alvos: um por destinatário
-- ---------------------------------------------------------------------------
-- UM POR DESTINATÁRIO, nunca 200 pessoas numa cópia oculta. Cópia oculta em
-- massa é o padrão que todo filtro reconhece — e ninguém confia num e-mail que
-- não foi endereçado a ele.
create table if not exists public.email_campanha_alvos (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.email_campanhas(id) on delete cascade,
  email        text not null,
  nome         text,
  organizacao  text,
  status       text not null default 'pendente'
               check (status in ('pendente','enviado','falhou','suprimido','cancelado')),
  tentativas   int  not null default 0,
  enviado_em   timestamptz,
  graph_message_id text,
  erro         text,
  -- Trava de worker, como em `disparo_alvos`: dois workers acordando juntos não
  -- podem mandar o mesmo e-mail duas vezes para a mesma pessoa.
  locked_by    text,
  locked_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (campaign_id, email)
);

create index if not exists email_alvos_fila_idx
  on public.email_campanha_alvos (campaign_id, status);
-- Para recuperar trava órfã: worker que morreu no meio deixa `locked_at` velho.
create index if not exists email_alvos_trava_idx
  on public.email_campanha_alvos (locked_at) where locked_at is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.email_listas          enable row level security;
alter table public.email_lista_membros   enable row level security;
alter table public.email_campanhas       enable row level security;
alter table public.email_campanha_alvos  enable row level security;
alter table public.email_supressao       enable row level security;

create policy email_listas_ver on public.email_listas
  for select using (public.pode_disparar_email());
create policy email_listas_mexer on public.email_listas
  for all using (public.pode_disparar_email()) with check (public.pode_disparar_email());

create policy email_membros_tudo on public.email_lista_membros
  for all using (public.pode_disparar_email()) with check (public.pode_disparar_email());

-- Campanha exige as DUAS coisas: poder disparar E enxergar a caixa que vai
-- assinar o e-mail. Sem a segunda, alguém do Administrativo mandaria comunicado
-- saindo como `financeiro@`.
create policy email_campanhas_tudo on public.email_campanhas
  for all using (
    public.pode_disparar_email() and public._pode_ver_conta_de_email(account_id)
  ) with check (
    public.pode_disparar_email() and public._pode_ver_conta_de_email(account_id)
  );

create policy email_alvos_ver on public.email_campanha_alvos
  for select using (
    exists (select 1 from public.email_campanhas c
            where c.id = email_campanha_alvos.campaign_id
              and public.pode_disparar_email()
              and public._pode_ver_conta_de_email(c.account_id))
  );

-- Supressão: qualquer pessoa que possa disparar precisa VER quem está
-- suprimido (é o que evita "por que fulano não recebeu?"). Escrever à mão, só
-- admin — quem tira alguém da supressão está reativando envio para quem pediu
-- para parar.
create policy email_supressao_ver on public.email_supressao
  for select using (public.pode_disparar_email());
create policy email_supressao_admin on public.email_supressao
  for all using (public._is_admin()) with check (public._is_admin());

-- ---------------------------------------------------------------------------
-- Segredo que assina o link de descadastro
-- ---------------------------------------------------------------------------
-- Gerado aqui, como o do OAuth: é interno, não é credencial de ninguém. Assina
-- o token que vai na URL de descadastro, para ninguém conseguir descadastrar
-- terceiros trocando o endereço no link.
insert into public.secrets (key, value)
values ('EMAIL_DISPARO_SECRET', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

commit;
