-- ETAPA 6: média de tempo de resposta, por atendente e por contato.
--
-- As duas funções ignoram pendência com `requires_reply = false`. É o motivo de
-- a Etapa 3 existir: "obrigada!" respondida em 40 min não pode puxar a média do
-- time para baixo, porque nunca houve nada a responder.
--
-- `is distinct from false` (e não `= true`) mantém no cálculo o que a IA ainda
-- não classificou ou não conseguiu classificar — some do relatório só o que foi
-- comprovadamente cortesia.

create or replace function public.get_response_metrics_by_user(
  p_desde     timestamptz default now() - interval '30 days',
  p_ate       timestamptz default now(),
  p_device_id uuid        default null
)
returns table (
  user_id          uuid,
  user_name        text,
  respondidas      bigint,
  media_segundos   numeric,
  mediana_segundos numeric,
  estouros_5min    bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    p.responded_by,
    coalesce(pr.name, 'Sem autor'),
    count(*),
    round(avg(p.response_seconds), 1),
    round(percentile_cont(0.5) within group (order by p.response_seconds)::numeric, 1),
    count(*) filter (where p.response_seconds > 300)
  from public.conversation_pendencias p
  left join public.profiles pr on pr.id = p.responded_by
  where p.responded_at is not null
    and p.responded_at >= p_desde
    and p.responded_at <  p_ate
    and p.requires_reply is distinct from false
    and (p_device_id is null or p.device_id = p_device_id)
    and public.can_access_device(p.device_id)
  group by p.responded_by, pr.name
  order by count(*) desc;
$function$;

comment on function public.get_response_metrics_by_user is
  'Media e mediana de tempo de resposta por atendente, mais quantas vezes passou de 5 min. A mediana acompanha a media porque uma unica conversa esquecida por 3 horas distorce a media e faz o relatorio mentir sobre o dia normal do time.';

create or replace function public.get_response_metrics_by_contact(
  p_desde     timestamptz default now() - interval '30 days',
  p_ate       timestamptz default now(),
  p_device_id uuid        default null,
  p_limit     integer     default 50
)
returns table (
  device_id      uuid,
  remote_sender  text,
  contato        text,
  respondidas    bigint,
  media_segundos numeric,
  estouros_5min  bigint,
  pior_segundos  integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    p.device_id,
    p.remote_sender,
    coalesce(max(coalesce(c.nickname, c.name)), split_part(p.remote_sender, '@', 1)),
    count(*),
    round(avg(p.response_seconds), 1),
    count(*) filter (where p.response_seconds > 300),
    max(p.response_seconds)
  from public.conversation_pendencias p
  left join public.contacts c on c.remote_jid = p.remote_sender
  where p.responded_at is not null
    and p.responded_at >= p_desde
    and p.responded_at <  p_ate
    and p.requires_reply is distinct from false
    and (p_device_id is null or p.device_id = p_device_id)
    and public.can_access_device(p.device_id)
  group by p.device_id, p.remote_sender
  order by count(*) filter (where p.response_seconds > 300) desc, avg(p.response_seconds) desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$function$;

comment on function public.get_response_metrics_by_contact is
  'Mesma medicao agrupada por contato, ordenada pelos que mais estouraram 5 min. Serve para achar QUEM esta sendo mal atendido, nao so quem atende devagar.';
