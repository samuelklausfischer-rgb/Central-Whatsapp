-- Disparador em massa: listas de transmissao, campanhas e fila de envio.
--
-- Ferramenta nova do PRN Hub, pedida na fila do Hub (Samuel, 19/08/2026). A base
-- veio do app `prn-vigilante`, mas a camada de dados de la e centrada em
-- pacientes/exames (`patients_queue`) e nao serve: la, "send_list" e um LOTE de
-- disparo, nao uma lista reutilizavel. O conceito de lista de transmissao nasce
-- aqui.
--
-- NOME `disparo_`, E NAO `broadcast_`: `broadcast` ja significa outra coisa neste
-- banco. `app_broadcasts` e `broadcast_reads` sao os avisos internos que aparecem
-- para a equipe ao abrir o app (ver `src/services/broadcasts.ts`). Ter
-- `broadcast_reads` (quem leu um aviso interno) ao lado de uma fila de WhatsApp e
-- pedir para alguem ler a tabela errada num incidente.
--
-- (Em producao estas tabelas nasceram como `broadcast_*` e foram renomeadas no
-- mesmo dia, com tudo vazio; este arquivo ja descreve o estado final.)

-- ============================================================
-- Quem pode usar a ferramenta
-- ============================================================
-- Liberacao pessoa a pessoa por `tool_access`, como Licitacoes e PRN Hub. Mora
-- numa funcao so porque SEIS policies precisam da mesma resposta -- repetir o
-- `exists` em cada uma e como as duas versoes da regra de leitura que ja custaram
-- caro neste banco.
--
-- Admin entra junto: quem administra o app precisa conseguir auditar e limpar
-- campanha de outra pessoa.
create or replace function public.pode_disparar()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public._is_admin() or exists (
    select 1 from public.tool_access
    where user_id = auth.uid() and tool = 'disparador-em-massa'
  );
$function$;

comment on function public.pode_disparar() is
  'Direito de usar o Disparador em massa: tool_access da pessoa, ou admin.';

-- ============================================================
-- LISTAS DE TRANSMISSAO
-- ============================================================
-- Compartilhadas pela equipe, como as etiquetas passaram a ser: montar a lista de
-- clientes de um convenio e util para todo mundo, e lista privada por pessoa faria
-- cada um remontar a mesma coisa. Editar e apagar continuam sendo de quem criou
-- (ou admin) -- mesmo desenho de `podeEditarEtiqueta`.
create table if not exists public.disparo_listas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  descricao   text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.disparo_listas enable row level security;

create policy disparo_listas_select on public.disparo_listas
  for select to authenticated using (public.pode_disparar());
create policy disparo_listas_insert on public.disparo_listas
  for insert to authenticated with check (public.pode_disparar() and created_by = auth.uid());
create policy disparo_listas_update on public.disparo_listas
  for update to authenticated using (public.pode_disparar() and (created_by = auth.uid() or public._is_admin()));
create policy disparo_listas_delete on public.disparo_listas
  for delete to authenticated using (public.pode_disparar() and (created_by = auth.uid() or public._is_admin()));

comment on table public.disparo_listas is
  'Lista de transmissao reutilizavel do Disparador em massa. Compartilhada pela
   equipe; editar e apagar sao de quem criou (ou admin).';

-- Membros da lista.
--
-- `remote_sender` guarda SO DIGITOS no privado, igual ao resto do app -- e o
-- formato que `send_whatsapp_message` espera e que `contacts.remote_jid` usa.
--
-- `origem` existe para a tela saber explicar de onde a pessoa veio, e para o botao
-- de re-sincronizar etiqueta saber o que pode substituir sem apagar o que foi
-- acrescentado na mao.
--
-- IMPORTAR POR ETIQUETA GRAVA OS MEMBROS, nao guarda um vinculo vivo. Lista que
-- muda sozinha na vespera do disparo e surpresa ruim: alguem sai da etiqueta e
-- deixa de receber sem ninguem ter decidido isso.
create table if not exists public.disparo_lista_membros (
  id             uuid primary key default gen_random_uuid(),
  list_id        uuid not null references public.disparo_listas(id) on delete cascade,
  remote_sender  text not null,
  nome_exibicao  text,
  origem         text not null default 'contato'
                 check (origem in ('contato', 'colado', 'etiqueta')),
  created_at     timestamptz not null default now(),
  unique (list_id, remote_sender)
);

alter table public.disparo_lista_membros enable row level security;

create policy disparo_lista_membros_all on public.disparo_lista_membros
  for all to authenticated
  using (public.pode_disparar())
  with check (public.pode_disparar());

create index if not exists idx_disparo_lista_membros_list on public.disparo_lista_membros (list_id);

comment on table public.disparo_lista_membros is
  'Contatos de uma lista. Importar por etiqueta GRAVA os membros (fotografia), nao
   mantem vinculo vivo -- lista que muda sozinha na vespera do disparo e surpresa.';

-- ============================================================
-- CAMPANHAS (o disparo em si)
-- ============================================================
-- O perfil de ritmo mora NA CAMPANHA, e nao numa configuracao global, porque cada
-- disparo tem um risco diferente: 5 contatos internos aceitam pressa, 500 clientes
-- nao. Os padroes sao os do `prn-vigilante`, ja validados em producao: 3 a 13 min
-- entre mensagens, jitter de 15%, pausa longa a cada 5.
--
-- `respeitar_horario` nasce FALSE por decisao do Samuel (26/08/2026) -- o app
-- original tambem dispara 24 h. O campo existe para ligar sem mexer em codigo.
create table if not exists public.disparo_campanhas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  device_id      uuid not null references public.devices(id) on delete restrict,
  list_id        uuid references public.disparo_listas(id) on delete set null,
  mensagem       text not null,
  anexos         jsonb,
  iniciar_em     timestamptz not null default now(),
  status         text not null default 'rascunho'
                 check (status in ('rascunho','agendado','enviando','pausado','concluido','cancelado')),

  -- Ritmo (ver `humanizer.ts` no worker)
  delay_min_ms      integer not null default 180000 check (delay_min_ms >= 5000),
  delay_max_ms      integer not null default 780000,
  jitter_pct        numeric not null default 0.15 check (jitter_pct >= 0 and jitter_pct <= 1),
  pausa_a_cada      integer not null default 5   check (pausa_a_cada >= 0),
  pausa_longa_ms    integer not null default 60000 check (pausa_longa_ms >= 0),
  respeitar_horario boolean not null default false,
  hora_inicio       smallint not null default 8  check (hora_inicio between 0 and 23),
  hora_fim          smallint not null default 20 check (hora_fim between 1 and 24),

  created_by     uuid references auth.users(id) on delete set null,
  iniciado_em    timestamptz,
  concluido_em   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Piso de 5 s no minimo e max >= min: erro de digitacao aqui vira disparo em
  -- rajada, e rajada e o caminho mais curto para o numero do atendimento ser
  -- bloqueado. A trava fica no banco porque a tela nao e o unico caminho.
  constraint disparo_campanhas_delay_coerente check (delay_max_ms >= delay_min_ms)
);

alter table public.disparo_campanhas enable row level security;

-- Alem do direito a ferramenta, a pessoa precisa ter o APARELHO. Sem isso alguem
-- liberado dispararia pelo WhatsApp de um setor que nem enxerga no chat.
create policy disparo_campanhas_select on public.disparo_campanhas
  for select to authenticated using (public.pode_disparar() and public.can_access_device(device_id));
create policy disparo_campanhas_insert on public.disparo_campanhas
  for insert to authenticated
  with check (public.pode_disparar() and public.can_access_device(device_id) and created_by = auth.uid());
create policy disparo_campanhas_update on public.disparo_campanhas
  for update to authenticated
  using (public.pode_disparar() and public.can_access_device(device_id) and (created_by = auth.uid() or public._is_admin()));
create policy disparo_campanhas_delete on public.disparo_campanhas
  for delete to authenticated
  using (public.pode_disparar() and (created_by = auth.uid() or public._is_admin()));

create index if not exists idx_disparo_campanhas_status on public.disparo_campanhas (status, iniciar_em);

comment on table public.disparo_campanhas is
  'Um disparo em massa: lista + mensagem + instancia + inicio + ritmo anti-ban.';

-- ============================================================
-- ALVOS (a fila real)
-- ============================================================
-- Uma linha por destinatario, materializada quando a campanha e criada. E aqui que
-- entra o "colocar alguem a mais sem incluir na lista" do pedido: contato avulso
-- vira alvo direto, com `avulso = true`, sem tocar em `disparo_lista_membros`.
--
-- Materializar em vez de ler a lista na hora do envio nao e detalhe: a lista pode
-- ser editada no meio de um disparo de 13 horas, e o destinatario tem de ser o que
-- estava la quando a campanha comecou.
create table if not exists public.disparo_alvos (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.disparo_campanhas(id) on delete cascade,
  remote_sender  text not null,
  nome_exibicao  text,
  avulso         boolean not null default false,
  status         text not null default 'pendente'
                 check (status in ('pendente','enviando','enviado','falhou','pulado')),
  tentativas     integer not null default 0,
  enviado_em     timestamptz,
  message_id     uuid,
  erro           text,
  -- Lease por alvo, alem do lease por worker: protege contra duas replicas e
  -- contra um worker que morreu no meio do envio.
  locked_by      text,
  locked_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (campaign_id, remote_sender)
);

alter table public.disparo_alvos enable row level security;

-- Leitura acompanha a campanha; escrita e do worker (service_role, que ignora RLS).
-- A tela nao escreve em alvo: quem muda status e quem enviou.
create policy disparo_alvos_select on public.disparo_alvos
  for select to authenticated using (
    public.pode_disparar() and exists (
      select 1 from public.disparo_campanhas c
      where c.id = campaign_id and public.can_access_device(c.device_id)
    )
  );

create index if not exists idx_disparo_alvos_fila on public.disparo_alvos (campaign_id, status);

comment on table public.disparo_alvos is
  'Fila real do disparo, uma linha por destinatario, materializada na criacao da
   campanha. Contato avulso entra aqui com avulso = true, sem tocar na lista.';

-- ============================================================
-- HEARTBEAT DO WORKER
-- ============================================================
-- Portada do `prn-vigilante`. Serve para duas coisas: o lease que garante UM
-- worker ativo, e a tela poder avisar "o disparador esta fora do ar" -- sem isso,
-- uma campanha agendada simplesmente nao sai e ninguem descobre.
create table if not exists public.disparo_worker_heartbeat (
  worker_id    text primary key,
  worker_name  text not null,
  visto_em     timestamptz not null default now(),
  lease_ate    timestamptz,
  detalhes     jsonb
);

alter table public.disparo_worker_heartbeat enable row level security;

create policy disparo_worker_heartbeat_select on public.disparo_worker_heartbeat
  for select to authenticated using (public.pode_disparar());

comment on table public.disparo_worker_heartbeat is
  'Sinal de vida e lease do worker. Sem isto, worker morto = campanha que nao sai
   e ninguem descobre.';
