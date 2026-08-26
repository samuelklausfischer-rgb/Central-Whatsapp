-- RPCs do Disparador em massa.

-- ============================================================
-- Normalizar numero
-- ============================================================
-- Aceita o que a pessoa colar ("(11) 98888-7777", "+55 11 98888 7777") e devolve
-- so digitos, que e o formato de `contacts.remote_jid` e o que
-- `send_whatsapp_message` espera no privado.
--
-- Devolve NULL para o que nao da para salvar, e quem chama decide o que fazer --
-- a tela mostra a linha recusada em vez de engolir em silencio. Numero brasileiro
-- valido tem 12 ou 13 digitos com DDI; sem DDI, 10 ou 11, e o 55 e acrescentado.
create or replace function public.disparo_normalizar_numero(p_bruto text)
returns text
language plpgsql
immutable
as $function$
declare
  v_digitos text;
begin
  if p_bruto is null then return null; end if;
  v_digitos := regexp_replace(p_bruto, '\D', '', 'g');

  if length(v_digitos) in (10, 11) then
    v_digitos := '55' || v_digitos;
  end if;

  if length(v_digitos) not in (12, 13) then
    return null;
  end if;

  return v_digitos;
end;
$function$;

-- ============================================================
-- Criar o disparo e materializar a fila
-- ============================================================
-- Numa transacao so: a campanha e os alvos nascem juntos ou nao nascem. Campanha
-- sem alvo ficaria "agendada" para sempre, e alvo sem campanha e lixo orfao.
--
-- MATERIALIZA em vez de ler a lista na hora do envio. Um disparo no ritmo seguro
-- leva horas; se alguem editar a lista no meio, o destinatario tem de continuar
-- sendo quem estava la quando a campanha comecou.
--
-- `p_avulsos` sao os contatos que entram SO neste disparo, sem sujar a lista --
-- e o "colocar alguem a mais sem precisar incluir na lista" do pedido. Se o mesmo
-- numero vier da lista e dos avulsos, o `on conflict` garante UMA mensagem: enviar
-- duas vezes para a mesma pessoa e o erro mais visivel que um disparo pode ter.
create or replace function public.disparo_criar(
  p_nome        text,
  p_device_id   uuid,
  p_mensagem    text,
  p_iniciar_em  timestamptz,
  p_list_id     uuid    default null,
  p_avulsos     text[]  default null,
  p_anexos      jsonb   default null,
  p_ritmo       jsonb   default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_alvos integer;
begin
  if not public.pode_disparar() then
    raise exception 'Sem permissao para o Disparador em massa';
  end if;
  if not public.can_access_device(p_device_id) then
    raise exception 'Sem acesso a este aparelho';
  end if;
  if coalesce(trim(p_mensagem), '') = '' then
    raise exception 'A mensagem nao pode ser vazia';
  end if;

  insert into public.disparo_campanhas (
    nome, device_id, list_id, mensagem, anexos, iniciar_em, status, created_by,
    delay_min_ms, delay_max_ms, jitter_pct, pausa_a_cada, pausa_longa_ms,
    respeitar_horario, hora_inicio, hora_fim
  )
  values (
    p_nome, p_device_id, p_list_id, p_mensagem, p_anexos,
    coalesce(p_iniciar_em, now()), 'agendado', auth.uid(),
    coalesce((p_ritmo ->> 'delay_min_ms')::int, 180000),
    coalesce((p_ritmo ->> 'delay_max_ms')::int, 780000),
    coalesce((p_ritmo ->> 'jitter_pct')::numeric, 0.15),
    coalesce((p_ritmo ->> 'pausa_a_cada')::int, 5),
    coalesce((p_ritmo ->> 'pausa_longa_ms')::int, 60000),
    coalesce((p_ritmo ->> 'respeitar_horario')::boolean, false),
    coalesce((p_ritmo ->> 'hora_inicio')::smallint, 8),
    coalesce((p_ritmo ->> 'hora_fim')::smallint, 20)
  )
  returning id into v_id;

  -- Alvos vindos da lista
  if p_list_id is not null then
    insert into public.disparo_alvos (campaign_id, remote_sender, nome_exibicao, avulso)
    select v_id, m.remote_sender, m.nome_exibicao, false
    from public.disparo_lista_membros m
    where m.list_id = p_list_id
    on conflict (campaign_id, remote_sender) do nothing;
  end if;

  -- Alvos avulsos. Numero invalido e DESCARTADO aqui em silencio de proposito: a
  -- tela ja validou e mostrou o que recusou antes de chegar neste ponto, e falhar
  -- a campanha inteira por um numero mal digitado seria pior.
  if p_avulsos is not null then
    insert into public.disparo_alvos (campaign_id, remote_sender, nome_exibicao, avulso)
    select v_id, n.numero,
           coalesce(max(coalesce(c.nickname, c.name)), n.numero),
           true
    from (
      select distinct public.disparo_normalizar_numero(x) as numero
      from unnest(p_avulsos) as x
    ) n
    left join public.contacts c on c.remote_jid = n.numero
    where n.numero is not null
    group by n.numero
    on conflict (campaign_id, remote_sender) do nothing;
  end if;

  select count(*) into v_alvos from public.disparo_alvos where campaign_id = v_id;
  if v_alvos = 0 then
    raise exception 'Nenhum destinatario valido: o disparo nao foi criado';
  end if;

  return v_id;
end;
$function$;

comment on function public.disparo_criar(text, uuid, text, timestamptz, uuid, text[], jsonb, jsonb) is
  'Cria a campanha e materializa a fila de alvos numa transacao. Recusa disparo sem
   destinatario valido.';

-- ============================================================
-- O worker pega o proximo alvo
-- ============================================================
-- `for update skip locked` e o que permite consumir a fila sem corrida: duas
-- replicas do worker nunca pegam o mesmo alvo, e um alvo travado por um worker que
-- morreu volta sozinho depois de `p_lease_minutos`.
--
-- So devolve alvo de campanha ja madura (`iniciar_em <= now()`) e no estado certo.
-- A campanha passa de 'agendado' para 'enviando' no primeiro alvo entregue -- e o
-- que faz a tela mostrar progresso sem o worker precisar avisar por outro caminho.
create or replace function public.disparo_proximo_alvo(
  p_worker_id      text,
  p_lease_minutos  integer default 5
)
returns table (
  alvo_id        uuid,
  campaign_id    uuid,
  device_id      uuid,
  remote_sender  text,
  nome_exibicao  text,
  mensagem       text,
  anexos         jsonb,
  delay_min_ms   integer,
  delay_max_ms   integer,
  jitter_pct     numeric,
  pausa_a_cada   integer,
  pausa_longa_ms integer,
  created_by     uuid
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_alvo uuid;
  v_camp uuid;
begin
  select a.id, a.campaign_id into v_alvo, v_camp
  from public.disparo_alvos a
  join public.disparo_campanhas c on c.id = a.campaign_id
  where c.status in ('agendado', 'enviando')
    and c.iniciar_em <= now()
    and (
      a.status = 'pendente'
      or (a.status = 'enviando' and a.locked_at < now() - make_interval(mins => greatest(1, p_lease_minutos)))
    )
  order by c.iniciar_em asc, a.created_at asc
  limit 1
  for update of a skip locked;

  if v_alvo is null then
    return;
  end if;

  update public.disparo_alvos
     set status = 'enviando', locked_by = p_worker_id, locked_at = now(),
         tentativas = tentativas + 1
   where id = v_alvo;

  update public.disparo_campanhas
     set status = 'enviando',
         iniciado_em = coalesce(iniciado_em, now()),
         updated_at = now()
   where id = v_camp and status = 'agendado';

  return query
  select a.id, a.campaign_id, c.device_id, a.remote_sender,
         a.nome_exibicao, c.mensagem, c.anexos,
         c.delay_min_ms, c.delay_max_ms, c.jitter_pct,
         c.pausa_a_cada, c.pausa_longa_ms, c.created_by
  from public.disparo_alvos a
  join public.disparo_campanhas c on c.id = a.campaign_id
  where a.id = v_alvo;
end;
$function$;

-- ============================================================
-- O worker devolve o resultado
-- ============================================================
-- Fecha a campanha sozinha quando nao sobra alvo pendente. Deixar isso com o
-- worker exigiria que ele perguntasse a cada envio; aqui e uma consulta so, na
-- mesma transacao que ja esta aberta.
create or replace function public.disparo_concluir_alvo(
  p_alvo_id     uuid,
  p_sucesso     boolean,
  p_message_id  uuid default null,
  p_erro        text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_camp uuid;
begin
  update public.disparo_alvos
     set status     = case when p_sucesso then 'enviado' else 'falhou' end,
         enviado_em = case when p_sucesso then now() else enviado_em end,
         message_id = coalesce(p_message_id, message_id),
         erro       = case when p_sucesso then null else left(p_erro, 1000) end,
         locked_by  = null,
         locked_at  = null
   where id = p_alvo_id
   returning campaign_id into v_camp;

  if v_camp is null then return; end if;

  update public.disparo_campanhas c
     set status = 'concluido', concluido_em = now(), updated_at = now()
   where c.id = v_camp
     and c.status = 'enviando'
     and not exists (
       select 1 from public.disparo_alvos a
       where a.campaign_id = v_camp and a.status in ('pendente', 'enviando')
     );
end;
$function$;

-- ============================================================
-- Pausar / retomar / cancelar
-- ============================================================
-- Cancelar marca os pendentes como 'pulado' em vez de apagar: quem cancelou um
-- disparo de 500 pessoas no meio precisa saber quem JA recebeu antes do freio.
create or replace function public.disparo_mudar_status(p_campaign_id uuid, p_acao text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.pode_disparar() then
    raise exception 'Sem permissao para o Disparador em massa';
  end if;
  if not exists (
    select 1 from public.disparo_campanhas c
    where c.id = p_campaign_id and public.can_access_device(c.device_id)
  ) then
    raise exception 'Sem acesso a este disparo';
  end if;

  if p_acao = 'pausar' then
    update public.disparo_campanhas set status = 'pausado', updated_at = now()
     where id = p_campaign_id and status in ('agendado', 'enviando');

  elsif p_acao = 'retomar' then
    update public.disparo_campanhas set status = 'agendado', updated_at = now()
     where id = p_campaign_id and status = 'pausado';

  elsif p_acao = 'cancelar' then
    update public.disparo_campanhas set status = 'cancelado', concluido_em = now(), updated_at = now()
     where id = p_campaign_id and status in ('rascunho', 'agendado', 'enviando', 'pausado');
    update public.disparo_alvos set status = 'pulado', locked_by = null, locked_at = null
     where campaign_id = p_campaign_id and status in ('pendente', 'enviando');

  else
    raise exception 'Acao invalida: %', p_acao;
  end if;
end;
$function$;

-- ============================================================
-- Normalizar uma colagem inteira
-- ============================================================
-- A tela precisa mostrar QUAIS linhas foram recusadas, nao so quantas -- colar 300
-- numeros e receber "12 invalidos" sem saber quais e inutil. Devolve o bruto ao
-- lado do normalizado para a tela poder apontar a linha.
--
-- Mora no banco, e nao no cliente, porque a regra ja existe aqui. Duas copias da
-- regra e como um numero entrar na lista pela tela e ser recusado na hora do
-- disparo, sem ninguem entender por que.
create or replace function public.disparo_normalizar_lote(p_brutos text[])
returns table (bruto text, numero text)
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select x, public.disparo_normalizar_numero(x)
  from unnest(coalesce(p_brutos, '{}'::text[])) as x;
$function$;

comment on function public.disparo_normalizar_lote(text[]) is
  'Normaliza uma colagem de numeros devolvendo bruto + normalizado, para a tela
   poder mostrar exatamente quais linhas foram recusadas.';

-- ============================================================
-- Lease do worker
-- ============================================================
-- Garante UM worker enviando, mesmo com duas replicas no ar. Sem isto, duas
-- replicas consumiriam a fila em paralelo e o ritmo anti-ban seria silenciosamente
-- dobrado -- que e justamente o caminho para o numero ser bloqueado. O `skip
-- locked` de `disparo_proximo_alvo` impede duas replicas de pegarem o MESMO alvo,
-- mas nao impede as duas de enviarem ao mesmo tempo para alvos diferentes.
create or replace function public.disparo_adquirir_lease(
  p_worker_id    text,
  p_worker_name  text,
  p_segundos     integer default 90,
  p_detalhes     jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ok boolean := false;
begin
  insert into public.disparo_worker_heartbeat (worker_id, worker_name, visto_em, lease_ate, detalhes)
  values ('lease', p_worker_name, now(), now() - interval '1 second', p_detalhes)
  on conflict (worker_id) do nothing;

  update public.disparo_worker_heartbeat
     set worker_name = p_worker_name,
         visto_em    = now(),
         lease_ate   = now() + make_interval(secs => greatest(10, p_segundos)),
         detalhes    = coalesce(p_detalhes, detalhes)
   where worker_id = 'lease'
     and (lease_ate < now() or detalhes ->> 'dono' is null or detalhes ->> 'dono' = p_worker_id);

  if found then
    update public.disparo_worker_heartbeat
       set detalhes = coalesce(detalhes, '{}'::jsonb) || jsonb_build_object('dono', p_worker_id)
     where worker_id = 'lease';
    v_ok := true;
  end if;

  insert into public.disparo_worker_heartbeat (worker_id, worker_name, visto_em, detalhes)
  values (p_worker_id, p_worker_name, now(), p_detalhes)
  on conflict (worker_id) do update
    set worker_name = excluded.worker_name,
        visto_em    = now(),
        detalhes    = coalesce(excluded.detalhes, public.disparo_worker_heartbeat.detalhes);

  return v_ok;
end;
$function$;

create or replace function public.disparo_soltar_lease(p_worker_id text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.disparo_worker_heartbeat
     set lease_ate = now() - interval '1 second'
   where worker_id = 'lease' and detalhes ->> 'dono' = p_worker_id;
$function$;

-- ============================================================
-- QUEM PODE CHAMAR O QUE
-- ============================================================
-- As quatro RPCs do worker sao SECURITY DEFINER e NAO checam `pode_disparar()` --
-- de proposito, porque quem as chama e um processo sem usuario logado. So que no
-- Postgres o papel PUBLIC recebe EXECUTE por padrao em funcao nova, e grant a
-- PUBLIC vale para TODO papel, inclusive `anon`.
--
-- Somando as duas coisas, qualquer chamador anonimo com a chave publica do app
-- poderia drenar a fila de um disparo, marcar alvos como enviados sem nada ter
-- sido enviado, ou roubar o lease e travar o worker de verdade. Nenhum dado
-- vazaria, mas um disparo seria sabotado em silencio -- e as pessoas veriam
-- "enviado" para quem nunca recebeu.
--
-- `service_role` nao aparece nos revokes porque e superusuario da instancia.
revoke execute on function public.disparo_proximo_alvo(text, integer)                from public, anon, authenticated;
revoke execute on function public.disparo_concluir_alvo(uuid, boolean, uuid, text)   from public, anon, authenticated;
revoke execute on function public.disparo_adquirir_lease(text, text, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.disparo_soltar_lease(text)                         from public, anon, authenticated;

-- As da tela se defendem por dentro (`pode_disparar()` levanta excecao), mas
-- deixar a porta destrancada porque a sala tem cadeado confunde quem le depois:
-- nao da para saber qual das duas travas e a que vale.
revoke execute on function public.disparo_criar(text, uuid, text, timestamptz, uuid, text[], jsonb, jsonb) from public;
revoke execute on function public.disparo_mudar_status(uuid, text) from public;

grant execute on function public.disparo_criar(text, uuid, text, timestamptz, uuid, text[], jsonb, jsonb) to authenticated;
grant execute on function public.disparo_mudar_status(uuid, text) to authenticated;
grant execute on function public.disparo_normalizar_numero(text) to authenticated;
grant execute on function public.disparo_normalizar_lote(text[]) to authenticated;
