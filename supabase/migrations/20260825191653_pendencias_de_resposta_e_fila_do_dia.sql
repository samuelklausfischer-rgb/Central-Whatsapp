-- ETAPA 1 + 2: fila do dia e pendência de resposta.
--
-- Duas regras que entram pelo mesmo lugar (o gatilho de INSERT em `messages`):
--
-- 1. Contato que fala pela PRIMEIRA VEZ NO DIA volta para a fila (`waiting`),
--    para alguém pegar ou designar — salvo se já tem dono recente (7 dias).
-- 2. Toda mensagem recebida abre uma PENDÊNCIA, que fecha sozinha quando alguém
--    do time responde, gravando quanto tempo levou.
--
-- A pendência é o alicerce das outras duas frentes: dela saem a média de tempo
-- de resposta (por atendente e por contato), a contagem de estouros de 5 min, e
-- a fila que o cron dos avisos de 2/5/10 min vai varrer.

create table if not exists public.conversation_pendencias (
  id                   uuid primary key default gen_random_uuid(),
  device_id            uuid not null references public.devices(id) on delete cascade,
  remote_sender        text not null,
  inbound_message_id   uuid not null references public.messages(id) on delete cascade,
  inbound_at           timestamptz not null,
  requires_reply       boolean,
  classification       text check (classification in ('pergunta','agradecimento','encerramento')),
  classified_at        timestamptz,
  responded_message_id uuid references public.messages(id) on delete set null,
  responded_at         timestamptz,
  responded_by         uuid references public.profiles(id) on delete set null,
  response_seconds     integer,
  alerta_2m_at         timestamptz,
  alerta_5m_at         timestamptz,
  alerta_10m_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.conversation_pendencias is
  'Uma linha por mensagem recebida que abre uma espera por resposta. Alicerce unico das tres frentes: media de tempo de resposta (por atendente e por contato), contagem de estouros de 5 min, e a fila que o cron varre para os avisos de 2/5/10 min. Os carimbos alerta_*_at existem para IDEMPOTENCIA: o cron roda a cada minuto e nao pode avisar duas vezes a mesma coisa.';

-- Uma pendência ABERTA por conversa. É este índice que implementa "abre pendência
-- se não houver outra aberta" — o `ON CONFLICT DO NOTHING` do gatilho depende dele.
create unique index if not exists conversation_pendencias_aberta_unica
  on public.conversation_pendencias (device_id, remote_sender)
  where responded_at is null;

-- Varredura do cron: só olha aberta, ordenada pela chegada.
create index if not exists conversation_pendencias_abertas
  on public.conversation_pendencias (inbound_at)
  where responded_at is null;

-- Agregação do painel (média por atendente / por período).
create index if not exists conversation_pendencias_respondidas
  on public.conversation_pendencias (responded_by, responded_at)
  where responded_at is not null;

alter table public.conversation_pendencias enable row level security;

-- Leitura para quem tem o aparelho. Escrita é exclusiva dos gatilhos, que são
-- SECURITY DEFINER — não existe policy de insert/update/delete de propósito.
drop policy if exists pendencias_leitura_por_aparelho on public.conversation_pendencias;
create policy pendencias_leitura_por_aparelho
  on public.conversation_pendencias for select
  using (public.can_access_device(device_id));


-- ── O gatilho ────────────────────────────────────────────────────────────────
--
-- Substitui `reopen_finished_conversation_on_message()`. Uma função só, e não
-- duas em sequência, porque a ORDEM entre as regras importa e ordem alfabética
-- de gatilho é um jeito frágil de garantir isso.
--
-- GUARDA DE FRESCOR (o detalhe que evita um estrago): este gatilho roda em TODO
-- insert de mensagem, e `origin` NÃO distingue importação de histórico — os dois
-- gravam 'webhook' (161k linhas, começando em out/2025). Sem a guarda, uma
-- importação reorganizaria a fila inteira e criaria milhares de pendências
-- retroativas. Só mensagem que chegou agora conta.
--
-- GRUPOS ficam fora da pendência (não do 'aguardando'): "responder um grupo em
-- 10 min" não é atendimento 1:1, e deixaria a média suja e a gerente recebendo
-- cobrança por conversa de grupo.

create or replace function public.processar_mensagem_para_atendimento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status         text;
  v_assigned_to    uuid;
  v_assigned_at    timestamptz;
  v_primeira_do_dia boolean;
  v_recente        boolean;
  v_eh_grupo       boolean;
begin
  -- Mensagem antiga (importação/backfill) não mexe em fila nem em pendência.
  if NEW.created_at < now() - interval '1 hour' then
    return NEW;
  end if;

  v_eh_grupo := NEW.remote_sender like '%@g.us';

  -- 1. Reabrir conversa finalizada. Comportamento que já existia, preservado.
  update public.conversation_assignments
  set status         = 'open',
      global_read_at = case when NEW.direction = 'outbound' then now() else null end,
      global_read_by = case when NEW.direction = 'outbound' then NEW.sender_id else null end,
      assigned_to    = null,
      assigned_by    = null,
      assigned_at    = null,
      updated_at     = now()
  where device_id     = NEW.device_id
    and remote_sender = NEW.remote_sender
    and status        = 'finished';

  if NEW.direction = 'inbound' then
    select status, assigned_to, assigned_at
      into v_status, v_assigned_to, v_assigned_at
    from public.conversation_assignments
    where device_id = NEW.device_id and remote_sender = NEW.remote_sender
    for update;

    -- "Dono recente" = pegou/foi designado há menos de 7 dias. Conversa assim
    -- NÃO volta para a fila: continua com quem estava cuidando dela.
    v_recente := v_status in ('taken','assigned')
                 and v_assigned_to is not null
                 and v_assigned_at > now() - interval '7 days';

    -- Primeira do dia no fuso de São Paulo, e não em UTC: 21h daqui já é o dia
    -- seguinte em UTC, e a fila viraria no horário errado.
    select not exists (
      select 1 from public.messages m
      where m.device_id     = NEW.device_id
        and m.remote_sender = NEW.remote_sender
        and m.direction     = 'inbound'
        and m.id           <> NEW.id
        and m.deleted_at is null
        and (m.created_at at time zone 'America/Sao_Paulo')::date
            = (NEW.created_at at time zone 'America/Sao_Paulo')::date
    ) into v_primeira_do_dia;

    if v_primeira_do_dia and not v_recente then
      insert into public.conversation_assignments (device_id, remote_sender, status, updated_at)
      values (NEW.device_id, NEW.remote_sender, 'waiting', now())
      on conflict (device_id, remote_sender) do update set
        status         = 'waiting',
        assigned_to    = null,
        assigned_by    = null,
        assigned_at    = null,
        global_read_at = null,
        global_read_by = null,
        updated_at     = now();
    end if;

    if not v_eh_grupo then
      insert into public.conversation_pendencias (
        device_id, remote_sender, inbound_message_id, inbound_at
      )
      values (NEW.device_id, NEW.remote_sender, NEW.id, NEW.created_at)
      on conflict do nothing;
    end if;

  else
    -- Qualquer saída do time fecha o que estava esperando. `greatest(0, ...)`
    -- protege de relógio da Evolution vindo adiantado, que daria tempo negativo.
    update public.conversation_pendencias
    set responded_message_id = NEW.id,
        responded_at         = NEW.created_at,
        responded_by         = NEW.sender_id,
        response_seconds     = greatest(0, extract(epoch from (NEW.created_at - inbound_at))::int),
        updated_at           = now()
    where device_id     = NEW.device_id
      and remote_sender = NEW.remote_sender
      and responded_at is null;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists reopen_conversation_on_new_message on public.messages;

create trigger processar_mensagem_para_atendimento
  after insert on public.messages
  for each row execute function public.processar_mensagem_para_atendimento();
