-- Curva por hora / dia da semana, fila por idade, e percentis nas tabelas que ja existiam.

-- ============================================================
-- SERIE: onde o dia afunda
-- ============================================================
-- Duas granularidades numa RPC so porque a pergunta e a mesma ("quando piora?"),
-- muda o eixo. `p_granularidade` aceita 'hora' (0-23) e 'dia_semana' (0=domingo).
--
-- Devolve o balde como INTEIRO e nao como texto formatado: nome de dia e de hora e
-- decisao de tela, e formatar aqui obrigaria o cliente a desfazer para ordenar.
create or replace function public.get_controle_serie(
  p_desde          timestamptz default (now() - interval '7 days'),
  p_ate            timestamptz default now(),
  p_device_id      uuid        default null,
  p_granularidade  text        default 'hora'
)
returns table (
  balde          int,
  recebidas      bigint,
  respondidas    bigint,
  p50_corrido    numeric,
  p50_integral   numeric,
  estouros_5min  bigint
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select
      case when p_granularidade = 'dia_semana'
           then extract(dow  from p.inbound_at at time zone 'America/Sao_Paulo')::int
           else extract(hour from p.inbound_at at time zone 'America/Sao_Paulo')::int
      end as balde,
      p.responded_at,
      p.response_seconds,
      public.segundos_uteis(p.inbound_at, p.responded_at) as seg_integral
    from public.conversation_pendencias p
    where public.can_access_device(p.device_id)
      and (p_device_id is null or p.device_id = p_device_id)
      and p.inbound_at >= p_desde
      and p.inbound_at <  p_ate
      and p.requires_reply is distinct from false
  )
  select
    b.balde,
    count(*),
    count(*) filter (where b.responded_at is not null),
    round(percentile_cont(0.50) within group (order by b.response_seconds)::numeric, 1),
    round(percentile_cont(0.50) within group (order by b.seg_integral)::numeric, 1),
    count(*) filter (where b.response_seconds > 300)
  from base b
  group by b.balde
  order by b.balde;
$function$;

comment on function public.get_controle_serie(timestamptz, timestamptz, uuid, text) is
  'Volume e tempo de resposta por hora do dia ou por dia da semana. Balde numerico:
   formatar e trabalho da tela.';

-- ============================================================
-- FILA: quem espera, e ha quanto tempo
-- ============================================================
-- Sem recorte de periodo, como toda leitura da fila viva neste modulo: quem espera
-- desde ontem ainda espera hoje.
--
-- `ordem` existe para a tela nao ter de reordenar por texto -- alfabeticamente
-- '2-8 h' viria antes de '5-30 min'.
create or replace function public.get_controle_fila(
  p_device_id uuid default null
)
returns table (
  faixa    text,
  ordem    int,
  n        bigint,
  contatos bigint
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with abertas as (
    select
      p.remote_sender,
      extract(epoch from (now() - p.inbound_at))::int as esperando
    from public.conversation_pendencias p
    where public.can_access_device(p.device_id)
      and (p_device_id is null or p.device_id = p_device_id)
      and p.responded_at is null
      and p.requires_reply is distinct from false
  ), classificada as (
    select
      case
        when esperando <   300 then 'ate 5 min'
        when esperando <  1800 then '5-30 min'
        when esperando <  7200 then '30 min-2 h'
        when esperando < 28800 then '2-8 h'
        else                        'mais de 8 h'
      end as faixa,
      case
        when esperando <   300 then 1
        when esperando <  1800 then 2
        when esperando <  7200 then 3
        when esperando < 28800 then 4
        else                        5
      end as ordem,
      remote_sender
    from abertas
  )
  select c.faixa, c.ordem, count(*), count(distinct c.remote_sender)
  from classificada c
  group by c.faixa, c.ordem
  order by c.ordem;
$function$;

comment on function public.get_controle_fila(uuid) is
  'Fila viva por faixa de idade da espera. Ignora periodo de proposito.';

-- ============================================================
-- As duas tabelas que ja existiam: percentis e tempo util
-- ============================================================
-- MUDANCA DE RECORTE, e ela e o ponto. As duas filtravam por `responded_at`
-- enquanto os cartoes filtravam por `inbound_at`, e por isso numeros da mesma tela
-- nao fechavam. Agora todas perguntam "das mensagens que CHEGARAM no periodo, como
-- foram atendidas?" -- ver o comentario de `get_controle_resumo`.
--
-- `drop` antes do `create` porque o tipo de retorno mudou (colunas novas no fim);
-- `create or replace` recusa. As colunas antigas seguem com o mesmo nome, tipo e
-- posicao, entao o cliente atual continua lendo o que lia.
drop function if exists public.get_response_metrics_by_user(timestamptz, timestamptz, uuid);

create function public.get_response_metrics_by_user(
  p_desde     timestamptz default (now() - interval '30 days'),
  p_ate       timestamptz default now(),
  p_device_id uuid        default null
)
returns table (
  user_id          uuid,
  user_name        text,
  respondidas      bigint,
  media_segundos   numeric,
  mediana_segundos numeric,
  estouros_5min    bigint,
  p90_corrido      numeric,
  media_integral   numeric,
  p50_integral     numeric,
  pior_corrido     integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select
      p.responded_by,
      -- 'Respondido pelo celular' e mais honesto que 'Sem autor': nao e dado
      -- faltando, e resposta que saiu por fora do app (origin = 'webhook', sem
      -- sender_id). Sao 53 das 226 no primeiro dia de medicao.
      coalesce(pr.name, 'Respondido pelo celular') as nome,
      p.response_seconds,
      public.segundos_uteis(p.inbound_at, p.responded_at) as seg_integral
    from public.conversation_pendencias p
    left join public.profiles pr on pr.id = p.responded_by
    where public.can_access_device(p.device_id)
      and (p_device_id is null or p.device_id = p_device_id)
      and p.responded_at is not null
      and p.inbound_at >= p_desde
      and p.inbound_at <  p_ate
      and p.requires_reply is distinct from false
  )
  select
    b.responded_by,
    b.nome,
    count(*),
    round(avg(b.response_seconds), 1),
    round(percentile_cont(0.50) within group (order by b.response_seconds)::numeric, 1),
    count(*) filter (where b.response_seconds > 300),
    round(percentile_cont(0.90) within group (order by b.response_seconds)::numeric, 1),
    round(avg(b.seg_integral), 1),
    round(percentile_cont(0.50) within group (order by b.seg_integral)::numeric, 1),
    max(b.response_seconds)
  from base b
  group by b.responded_by, b.nome
  order by count(*) desc;
$function$;

drop function if exists public.get_response_metrics_by_contact(timestamptz, timestamptz, uuid, integer);

create function public.get_response_metrics_by_contact(
  p_desde     timestamptz default (now() - interval '30 days'),
  p_ate       timestamptz default now(),
  p_device_id uuid        default null,
  p_limit     integer     default 50
)
returns table (
  device_id       uuid,
  remote_sender   text,
  contato         text,
  respondidas     bigint,
  media_segundos  numeric,
  estouros_5min   bigint,
  pior_segundos   integer,
  p50_corrido     numeric,
  p90_corrido     numeric,
  media_integral  numeric,
  p50_integral    numeric,
  abertas         bigint
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select
      p.device_id,
      p.remote_sender,
      p.responded_at,
      p.response_seconds,
      public.segundos_uteis(p.inbound_at, p.responded_at) as seg_integral
    from public.conversation_pendencias p
    where public.can_access_device(p.device_id)
      and (p_device_id is null or p.device_id = p_device_id)
      and p.inbound_at >= p_desde
      and p.inbound_at <  p_ate
      and p.requires_reply is distinct from false
  )
  select
    b.device_id,
    b.remote_sender,
    coalesce(max(coalesce(c.nickname, c.name)), split_part(b.remote_sender, '@', 1)),
    count(*) filter (where b.responded_at is not null),
    round(avg(b.response_seconds), 1),
    count(*) filter (where b.response_seconds > 300),
    max(b.response_seconds),
    round(percentile_cont(0.50) within group (order by b.response_seconds)::numeric, 1),
    round(percentile_cont(0.90) within group (order by b.response_seconds)::numeric, 1),
    round(avg(b.seg_integral), 1),
    round(percentile_cont(0.50) within group (order by b.seg_integral)::numeric, 1),
    -- Contato com pendencia aberta no periodo: e a coluna que responde "quem foi
    -- esquecido", que nenhuma versao anterior mostrava.
    count(*) filter (where b.responded_at is null)
  from base b
  left join public.contacts c on c.remote_jid = b.remote_sender
  group by b.device_id, b.remote_sender
  order by count(*) filter (where b.responded_at is null) desc,
           count(*) filter (where b.response_seconds > 300) desc,
           avg(b.response_seconds) desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$function$;
