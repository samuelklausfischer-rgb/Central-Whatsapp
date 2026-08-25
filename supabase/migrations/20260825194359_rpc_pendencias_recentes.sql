-- Pendências em formato legível, para a tela "Controle de Mensagens".
--
-- POR QUE UMA RPC E NÃO UM SELECT DO CLIENTE: `conversation_pendencias.remote_sender`
-- NÃO é chave estrangeira para `contacts.remote_jid` — são textos que casam por
-- convenção, não por constraint. Sem FK o PostgREST não consegue embutir o nome do
-- contato, e o cliente teria que fazer uma segunda consulta e montar um Map a cada
-- carga. Aqui sai pronto.
--
-- `p_apenas_abertas` serve à "fila viva" da tela (quem está esperando agora), que
-- ignora o filtro de período de propósito: uma mensagem de ontem sem resposta ainda
-- está esperando hoje, e sumir do painel por causa do filtro seria justamente
-- esconder o caso mais grave.

create or replace function public.get_pendencias_recentes(
  p_desde          timestamptz default now() - interval '7 days',
  p_ate            timestamptz default now(),
  p_device_id      uuid        default null,
  p_apenas_abertas boolean     default false,
  p_limit          integer     default 200
)
returns table (
  id                 uuid,
  device_id          uuid,
  aparelho           text,
  remote_sender      text,
  contato            text,
  inbound_at         timestamptz,
  responded_at       timestamptz,
  response_seconds   integer,
  respondido_por     text,
  requires_reply     boolean,
  classification     text,
  alerta_2m_at       timestamptz,
  alerta_5m_at       timestamptz,
  alerta_10m_at      timestamptz,
  esperando_segundos integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    p.id,
    p.device_id,
    d.name,
    p.remote_sender,
    coalesce(c.nickname, c.name, split_part(p.remote_sender, '@', 1)),
    p.inbound_at,
    p.responded_at,
    p.response_seconds,
    pr.name,
    p.requires_reply,
    p.classification,
    p.alerta_2m_at,
    p.alerta_5m_at,
    p.alerta_10m_at,
    -- Só faz sentido para as abertas; nas fechadas o tempo real é response_seconds.
    case when p.responded_at is null
         then greatest(0, extract(epoch from (now() - p.inbound_at))::int)
    end
  from public.conversation_pendencias p
  join public.devices d on d.id = p.device_id
  left join public.contacts c on c.remote_jid = p.remote_sender
  left join public.profiles pr on pr.id = p.responded_by
  where public.can_access_device(p.device_id)
    and (p_device_id is null or p.device_id = p_device_id)
    and (
      case when p_apenas_abertas
           -- Fila viva: sem recorte de período, de propósito (ver o topo).
           then p.responded_at is null
           else p.inbound_at >= p_desde and p.inbound_at < p_ate
      end
    )
  order by
    case when p_apenas_abertas then p.inbound_at end asc nulls last,
    p.inbound_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$function$;

comment on function public.get_pendencias_recentes is
  'Pendencias com nome de contato, aparelho e autor da resposta ja resolvidos. Existe porque remote_sender nao e FK para contacts.remote_jid e o PostgREST nao consegue embutir o nome. Com p_apenas_abertas a funcao ignora o periodo: quem esta esperando desde ontem continua esperando hoje.';
