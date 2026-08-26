-- Resumo do atendimento e recorte por setor.
--
-- POR QUE O RESUMO VIRA RPC
-- Os quatro cartoes da tela eram calculados NO NAVEGADOR sobre
-- `getPendencias({ limite: 200 })`. Em 30 dias, "media do periodo" era a media das
-- 200 linhas mais recentes. Pior: aquele conjunto filtrava por `inbound_at`
-- enquanto as tabelas de baixo filtravam por `responded_at` e ainda aplicavam
-- `requires_reply`, entao numeros da MESMA tela nao fechavam entre si. E a
-- "mediana" era `tempos[floor(n/2)]`, que nao e mediana para n par.
--
-- O RECORTE E POR `inbound_at`, e isso e uma escolha
-- Todas as metricas passam a perguntar a mesma coisa: "das mensagens que CHEGARAM
-- no periodo, como foram atendidas?". Assim recebidas / respondidas / abertas sao
-- um funil que fecha. O recorte por `responded_at` responderia "quanto o time
-- trabalhou no periodo", tambem legitimo -- mas misturar os dois na mesma tela foi
-- exatamente o defeito.
--
-- `abertas` IGNORA O PERIODO, de proposito: e a fila viva. Quem espera desde
-- ontem ainda espera hoje, e esconde-lo pelo filtro seria perder o caso mais grave.
-- Mesma razao ja documentada em `get_pendencias_recentes`.
--
-- SETOR SO FILTRA O QUE FOI RESPONDIDO. Setor vem de `user_sectors` de quem
-- respondeu; pendencia aberta nao tem autor, logo nao tem setor. A fila continua
-- inteira quando ha filtro de setor, e a tela diz isso.
create or replace function public.get_controle_resumo(
  p_desde     timestamptz default (now() - interval '7 days'),
  p_ate       timestamptz default now(),
  p_device_id uuid        default null,
  p_setor     text        default null
)
returns table (
  recebidas        bigint,
  respondidas      bigint,
  abertas          bigint,
  media_corrido    numeric,
  p50_corrido      numeric,
  p90_corrido      numeric,
  p95_corrido      numeric,
  media_integral   numeric,
  p50_integral     numeric,
  p90_integral     numeric,
  p95_integral     numeric,
  estouros_5min    bigint,
  fora_do_app      bigint,
  pct_fora_do_app  numeric,
  medindo_desde    timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select
      p.responded_at,
      p.responded_by,
      p.response_seconds,
      public.segundos_uteis(p.inbound_at, p.responded_at) as seg_integral
    from public.conversation_pendencias p
    where public.can_access_device(p.device_id)
      and (p_device_id is null or p.device_id = p_device_id)
      and p.inbound_at >= p_desde
      and p.inbound_at <  p_ate
      and p.requires_reply is distinct from false
      and (
        p_setor is null
        or exists (
          select 1 from public.user_sectors us
          where us.user_id = p.responded_by and us.setor = p_setor
        )
      )
  )
  select
    count(*),
    count(*) filter (where b.responded_at is not null),
    (
      select count(*)
      from public.conversation_pendencias q
      where public.can_access_device(q.device_id)
        and (p_device_id is null or q.device_id = p_device_id)
        and q.responded_at is null
        and q.requires_reply is distinct from false
    ),
    round(avg(b.response_seconds), 1),
    round(percentile_cont(0.50) within group (order by b.response_seconds)::numeric, 1),
    round(percentile_cont(0.90) within group (order by b.response_seconds)::numeric, 1),
    round(percentile_cont(0.95) within group (order by b.response_seconds)::numeric, 1),
    round(avg(b.seg_integral), 1),
    round(percentile_cont(0.50) within group (order by b.seg_integral)::numeric, 1),
    round(percentile_cont(0.90) within group (order by b.seg_integral)::numeric, 1),
    round(percentile_cont(0.95) within group (order by b.seg_integral)::numeric, 1),
    count(*) filter (where b.response_seconds > 300),
    count(*) filter (where b.responded_at is not null and b.responded_by is null),
    case when count(*) filter (where b.responded_at is not null) > 0
         then round(
           100.0 * count(*) filter (where b.responded_at is not null and b.responded_by is null)
           / count(*) filter (where b.responded_at is not null), 1)
    end,
    (
      -- Para a tela poder dizer "medindo desde X" em vez de mostrar um grafico
      -- vazio sem explicacao. O motor comecou a gravar em 25/08/2026.
      select min(q.inbound_at)
      from public.conversation_pendencias q
      where public.can_access_device(q.device_id)
    )
  from base b;
$function$;

comment on function public.get_controle_resumo(timestamptz, timestamptz, uuid, text) is
  'Resumo do atendimento no periodo, recortado por mensagens RECEBIDAS. Unica fonte
   dos cartoes da tela de Controle de Mensagens. `abertas` e a fila viva e ignora o
   periodo de proposito.';

-- Comparacao entre setores, lado a lado.
--
-- SETOR = `user_sectors` DE QUEM RESPONDEU. Verificado antes de escolher: todo
-- autor que respondeu esta em algum setor (zero orfaos) e so UMA pessoa esta em
-- dois setores.
--
-- CONTAGEM DUPLA E ASSUMIDA. Quem cobre dois setores conta nos dois -- a resposta
-- serviu aos dois de fato. Consequencia: a soma das linhas NAO fecha com o total
-- geral, e a tela precisa dizer isso. Esconder seria pior que explicar.
--
-- O BALDE 'Sem setor' NAO E SOBRA. Sao as respostas sem autor: 53 das 226 (23,5%)
-- saem do celular da pessoa (`origin = 'webhook'`, `sender_id` nulo) e nao passam
-- pelo app. E o KPI de atendimento que escapa do sistema, e por isso aparece
-- nomeado em vez de sumir do agrupamento.
create or replace function public.get_controle_por_setor(
  p_desde     timestamptz default (now() - interval '7 days'),
  p_ate       timestamptz default now(),
  p_device_id uuid        default null
)
returns table (
  setor           text,
  respondidas     bigint,
  media_corrido   numeric,
  p50_corrido     numeric,
  p90_corrido     numeric,
  media_integral  numeric,
  p50_integral    numeric,
  estouros_5min   bigint,
  pior_corrido    integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select
      coalesce(us.setor, 'Sem setor') as setor,
      p.response_seconds,
      public.segundos_uteis(p.inbound_at, p.responded_at) as seg_integral
    from public.conversation_pendencias p
    left join public.user_sectors us on us.user_id = p.responded_by
    where public.can_access_device(p.device_id)
      and (p_device_id is null or p.device_id = p_device_id)
      and p.responded_at is not null
      and p.inbound_at >= p_desde
      and p.inbound_at <  p_ate
      and p.requires_reply is distinct from false
  )
  select
    b.setor,
    count(*),
    round(avg(b.response_seconds), 1),
    round(percentile_cont(0.50) within group (order by b.response_seconds)::numeric, 1),
    round(percentile_cont(0.90) within group (order by b.response_seconds)::numeric, 1),
    round(avg(b.seg_integral), 1),
    round(percentile_cont(0.50) within group (order by b.seg_integral)::numeric, 1),
    count(*) filter (where b.response_seconds > 300),
    max(b.response_seconds)
  from base b
  group by b.setor
  order by count(*) desc;
$function$;

comment on function public.get_controle_por_setor(timestamptz, timestamptz, uuid) is
  'Metricas de resposta agrupadas por setor de quem respondeu (`user_sectors`).
   Quem cobre dois setores conta nos dois: a soma nao fecha com o total. O balde
   "Sem setor" sao as respostas enviadas pelo celular, fora do app.';
