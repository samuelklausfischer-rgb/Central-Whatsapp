-- Disparador: o que a tela precisa saber, e o que faltava depois que o worker subiu.
--
-- Com o disparador rodando de verdade ficaram claras as lacunas de uso: a tela
-- mostrava QUE um disparo estava correndo, mas nao ONDE ele estava. E cada campanha
-- precisava ser remontada do zero.

-- ============================================================
-- 1. O TEMPO QUE O WORKER SORTEIA PASSA A SER PUBLICO
-- ============================================================
-- O worker sorteia o intervalo (3 a 13 min) em `intervaloEntreMensagens`, dorme, e
-- envia. Esse numero so existia na memoria do processo -- a tela nao tinha como
-- contar quanto faltava.
--
-- Metade ja estava resolvida por construcao: `disparo_proximo_alvo` trava o alvo
-- ANTES da espera, entao durante todo o intervalo ele fica em 'enviando'. O banco
-- ja sabia QUEM; faltava o QUANDO.
--
-- Agora o worker grava aqui o horario que ele mesmo calculou. A contagem da tela
-- e o numero do worker, e nao uma estimativa paralela que erraria a cada jitter.
alter table public.disparo_alvos
  add column if not exists previsto_para timestamptz;

comment on column public.disparo_alvos.previsto_para is
  'Quando o worker planeja enviar este alvo. Gravado por ele logo apos travar o
   alvo e antes de dormir -- e o mesmo numero que ele vai esperar.';

-- ============================================================
-- 2. ENSAIO POR CAMPANHA
-- ============================================================
-- O `DRY_RUN` do worker e uma chave GLOBAL, e marcava o alvo como 'enviado' --
-- indistinguivel de um envio real a nao ser pelo `message_id` nulo. A campanha
-- usada para testar ficava inutilizavel; foi o que aconteceu no primeiro teste em
-- 26/08/2026.
--
-- Agora e POR CAMPANHA e com status proprio. Da para ensaiar uma campanha enquanto
-- outras enviam de verdade, o ensaio fica visivel em vez de disfarcado, e
-- `disparo_preparar_para_real` devolve os simulados para a fila.
alter table public.disparo_campanhas
  add column if not exists ensaio boolean not null default false;

alter table public.disparo_campanhas
  add column if not exists origem_id uuid references public.disparo_campanhas(id) on delete set null;

comment on column public.disparo_campanhas.ensaio is
  'Campanha de ensaio: o worker percorre a fila e marca os alvos como `simulado`
   sem chamar a Evolution. O DRY_RUN do worker segue como chave mestra.';
comment on column public.disparo_campanhas.origem_id is
  'Campanha da qual esta foi duplicada (ou de onde vieram as falhas reenviadas).';

-- ATENCAO AO RENAME DE TABELA: `alter table ... rename to` renomeia A TABELA e mais
-- nada. As constraints continuaram com o nome de nascimento (`broadcast_*`) depois
-- que as tabelas viraram `disparo_*`, e isso ja custou um erro: o
-- `drop constraint if exists disparo_alvos_status_check` nao achou nada, o `if
-- exists` engoliu em silencio, e a constraint nova nasceu AO LADO da antiga -- com
-- as duas valendo, inserir 'simulado' batia na velha.
alter table public.disparo_alvos drop constraint if exists broadcast_targets_status_check;
alter table public.disparo_alvos drop constraint if exists disparo_alvos_status_check;
alter table public.disparo_alvos add constraint disparo_alvos_status_check
  check (status in ('pendente','enviando','enviado','falhou','pulado','simulado'));

alter table public.disparo_campanhas rename constraint broadcast_campaigns_delay_coerente       to disparo_campanhas_delay_coerente;
alter table public.disparo_campanhas rename constraint broadcast_campaigns_delay_min_ms_check   to disparo_campanhas_delay_min_ms_check;
alter table public.disparo_campanhas rename constraint broadcast_campaigns_hora_fim_check       to disparo_campanhas_hora_fim_check;
alter table public.disparo_campanhas rename constraint broadcast_campaigns_hora_inicio_check    to disparo_campanhas_hora_inicio_check;
alter table public.disparo_campanhas rename constraint broadcast_campaigns_jitter_pct_check     to disparo_campanhas_jitter_pct_check;
alter table public.disparo_campanhas rename constraint broadcast_campaigns_pausa_a_cada_check   to disparo_campanhas_pausa_a_cada_check;
alter table public.disparo_campanhas rename constraint broadcast_campaigns_pausa_longa_ms_check to disparo_campanhas_pausa_longa_ms_check;
alter table public.disparo_campanhas rename constraint broadcast_campaigns_status_check         to disparo_campanhas_status_check;
alter table public.disparo_lista_membros rename constraint broadcast_list_members_origem_check  to disparo_lista_membros_origem_check;

-- ============================================================
-- 3. MODELOS DE MENSAGEM
-- ============================================================
-- Compartilhados pela equipe, como as listas: um texto bom serve para todo mundo, e
-- modelo privado faria cada um reescrever o mesmo. Editar e apagar de quem criou.
create table if not exists public.disparo_modelos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  texto       text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.disparo_modelos enable row level security;

create policy disparo_modelos_select on public.disparo_modelos
  for select to authenticated using (public.pode_disparar());
create policy disparo_modelos_insert on public.disparo_modelos
  for insert to authenticated with check (public.pode_disparar() and created_by = auth.uid());
create policy disparo_modelos_update on public.disparo_modelos
  for update to authenticated
  using (public.pode_disparar() and (created_by = auth.uid() or public._is_admin()));
create policy disparo_modelos_delete on public.disparo_modelos
  for delete to authenticated
  using (public.pode_disparar() and (created_by = auth.uid() or public._is_admin()));

comment on table public.disparo_modelos is
  'Textos reutilizaveis de disparo, com {nome}. Compartilhados pela equipe.';

-- ============================================================
-- 4. RPCs
-- ============================================================

create or replace function public.disparo_marcar_previsao(
  p_alvo_id uuid, p_previsto_para timestamptz
)
returns void language sql security definer set search_path to 'public'
as $function$
  update public.disparo_alvos set previsto_para = p_previsto_para where id = p_alvo_id;
$function$;

revoke execute on function public.disparo_marcar_previsao(uuid, timestamptz) from public, anon, authenticated;

-- `disparo_proximo_alvo` passa a devolver `ensaio`: o worker precisa saber POR
-- CAMPANHA se simula, e a flag tem de vir junto com o alvo -- uma consulta a mais
-- por envio seria desperdicio, e consultar em outro momento abriria janela para a
-- flag mudar no meio. `drop` antes do `create` porque o retorno mudou.
drop function if exists public.disparo_proximo_alvo(text, integer);

create function public.disparo_proximo_alvo(
  p_worker_id text, p_lease_minutos integer default 5
)
returns table (
  alvo_id uuid, campaign_id uuid, device_id uuid, remote_sender text,
  nome_exibicao text, mensagem text, anexos jsonb,
  delay_min_ms integer, delay_max_ms integer, jitter_pct numeric,
  pausa_a_cada integer, pausa_longa_ms integer, created_by uuid, ensaio boolean
)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_alvo uuid; v_camp uuid;
begin
  select a.id, a.campaign_id into v_alvo, v_camp
  from public.disparo_alvos a
  join public.disparo_campanhas c on c.id = a.campaign_id
  where c.status in ('agendado', 'enviando')
    and c.iniciar_em <= now()
    and (a.status = 'pendente'
         or (a.status = 'enviando' and a.locked_at < now() - make_interval(mins => greatest(1, p_lease_minutos))))
  order by c.iniciar_em asc, a.created_at asc
  limit 1
  for update of a skip locked;

  if v_alvo is null then return; end if;

  update public.disparo_alvos
     set status = 'enviando', locked_by = p_worker_id, locked_at = now(),
         tentativas = tentativas + 1
   where id = v_alvo;

  update public.disparo_campanhas
     set status = 'enviando', iniciado_em = coalesce(iniciado_em, now()), updated_at = now()
   where id = v_camp and status = 'agendado';

  return query
  select a.id, a.campaign_id, c.device_id, a.remote_sender, a.nome_exibicao,
         c.mensagem, c.anexos, c.delay_min_ms, c.delay_max_ms, c.jitter_pct,
         c.pausa_a_cada, c.pausa_longa_ms, c.created_by, c.ensaio
  from public.disparo_alvos a
  join public.disparo_campanhas c on c.id = a.campaign_id
  where a.id = v_alvo;
end;
$function$;

revoke execute on function public.disparo_proximo_alvo(text, integer) from public, anon, authenticated;

-- Concluir alvo: agora sabe de ensaio e AVISA quando a campanha fecha.
--
-- O aviso nasce AQUI, e nao no worker, porque esta funcao ja e quem detecta o
-- fechamento -- e faz isso na mesma transacao. Se morasse no worker, um processo
-- morto entre o ultimo envio e a notificacao deixaria a campanha concluida em
-- silencio.
--
-- `notificacoes` e da area de Notificacoes. Nao altero schema nem codigo deles: so
-- insiro linha com `tipo` novo, que a tabela aceita (nao ha CHECK em `tipo`). Ela
-- nao aceita INSERT de usuario logado, so service_role -- outro motivo para o aviso
-- nascer no banco.
drop function if exists public.disparo_concluir_alvo(uuid, boolean, uuid, text);

create or replace function public.disparo_concluir_alvo(
  p_alvo_id uuid, p_sucesso boolean, p_message_id uuid default null,
  p_erro text default null, p_simulado boolean default false
)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_camp uuid; v_nome text; v_dono uuid;
  v_enviados int; v_falhas int; v_ensaio boolean;
begin
  update public.disparo_alvos
     set status = case when p_simulado then 'simulado'
                       when p_sucesso then 'enviado' else 'falhou' end,
         enviado_em = case when p_sucesso then now() else enviado_em end,
         message_id = coalesce(p_message_id, message_id),
         erro = case when p_sucesso then null else left(p_erro, 1000) end,
         locked_by = null, locked_at = null, previsto_para = null
   where id = p_alvo_id
   returning campaign_id into v_camp;

  if v_camp is null then return; end if;

  update public.disparo_campanhas c
     set status = 'concluido', concluido_em = now(), updated_at = now()
   where c.id = v_camp and c.status = 'enviando'
     and not exists (select 1 from public.disparo_alvos a
                     where a.campaign_id = v_camp and a.status in ('pendente','enviando'));

  if not found then return; end if;

  select c.nome, c.created_by, c.ensaio into v_nome, v_dono, v_ensaio
  from public.disparo_campanhas c where c.id = v_camp;

  select count(*) filter (where status in ('enviado','simulado')),
         count(*) filter (where status = 'falhou')
    into v_enviados, v_falhas
  from public.disparo_alvos where campaign_id = v_camp;

  if v_dono is not null then
    insert into public.notificacoes (user_id, tipo, titulo, corpo, link, origem_id)
    values (v_dono, 'disparo_concluido',
            case when v_ensaio then 'Ensaio concluido: ' else 'Disparo concluido: ' end
              || coalesce(v_nome, 'sem nome'),
            v_enviados || ' entregue(s)' ||
              case when v_falhas > 0 then ', ' || v_falhas || ' falha(s)' else '' end,
            '/ferramentas/disparador-em-massa', v_camp);
  end if;
end;
$function$;

revoke execute on function public.disparo_concluir_alvo(uuid, boolean, uuid, text, boolean) from public, anon, authenticated;

-- O botao "enviar de verdade": a MESMA campanha volta a ser disparavel depois do
-- ensaio, em vez de virar lixo.
create or replace function public.disparo_preparar_para_real(p_campaign_id uuid)
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_n integer;
begin
  if not public.pode_disparar() then raise exception 'Sem permissao para o Disparador em massa'; end if;
  if not exists (select 1 from public.disparo_campanhas c
                 where c.id = p_campaign_id and public.can_access_device(c.device_id)) then
    raise exception 'Sem acesso a este disparo';
  end if;

  update public.disparo_alvos
     set status = 'pendente', enviado_em = null, erro = null, tentativas = 0
   where campaign_id = p_campaign_id and status = 'simulado';
  get diagnostics v_n = row_count;

  update public.disparo_campanhas
     set ensaio = false, status = 'agendado', concluido_em = null,
         iniciado_em = null, updated_at = now()
   where id = p_campaign_id;

  return v_n;
end;
$function$;

grant execute on function public.disparo_preparar_para_real(uuid) to authenticated;
revoke execute on function public.disparo_preparar_para_real(uuid) from public, anon;

-- Duplicar e reenviar-falhas sao a MESMA operacao com um filtro diferente. Nascem
-- como RASCUNHO de proposito: copiar nao pode virar disparo saindo sem ninguem
-- reler a mensagem e a data.
create or replace function public.disparo_duplicar(
  p_campaign_id uuid, p_apenas_falhas boolean default false, p_nome text default null
)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare v_novo uuid; v_alvos integer;
begin
  if not public.pode_disparar() then raise exception 'Sem permissao para o Disparador em massa'; end if;
  if not exists (select 1 from public.disparo_campanhas c
                 where c.id = p_campaign_id and public.can_access_device(c.device_id)) then
    raise exception 'Sem acesso a este disparo';
  end if;

  insert into public.disparo_campanhas (
    nome, device_id, list_id, mensagem, anexos, iniciar_em, status, created_by,
    delay_min_ms, delay_max_ms, jitter_pct, pausa_a_cada, pausa_longa_ms,
    respeitar_horario, hora_inicio, hora_fim, origem_id
  )
  select coalesce(p_nome, case when p_apenas_falhas then 'Reenvio: ' else 'Copia: ' end || c.nome),
         c.device_id, c.list_id, c.mensagem, c.anexos, now(), 'rascunho', auth.uid(),
         c.delay_min_ms, c.delay_max_ms, c.jitter_pct, c.pausa_a_cada, c.pausa_longa_ms,
         c.respeitar_horario, c.hora_inicio, c.hora_fim, c.id
  from public.disparo_campanhas c where c.id = p_campaign_id
  returning id into v_novo;

  insert into public.disparo_alvos (campaign_id, remote_sender, nome_exibicao, avulso)
  select v_novo, a.remote_sender, a.nome_exibicao, a.avulso
  from public.disparo_alvos a
  where a.campaign_id = p_campaign_id
    and (not p_apenas_falhas or a.status = 'falhou')
  on conflict (campaign_id, remote_sender) do nothing;

  select count(*) into v_alvos from public.disparo_alvos where campaign_id = v_novo;
  if v_alvos = 0 then
    raise exception 'Nada para duplicar: nenhum destinatario%',
      case when p_apenas_falhas then ' falhou neste disparo' else '' end;
  end if;

  return v_novo;
end;
$function$;

grant execute on function public.disparo_duplicar(uuid, boolean, text) to authenticated;
revoke execute on function public.disparo_duplicar(uuid, boolean, text) from public, anon;

-- Editar so `rascunho` e `agendado`. Depois do primeiro envio, mudar a mensagem
-- deixaria a campanha com dois textos: metade das pessoas recebeu uma coisa e
-- metade outra, sem nada no registro explicando.
create or replace function public.disparo_editar(
  p_campaign_id uuid, p_nome text, p_mensagem text, p_iniciar_em timestamptz,
  p_list_id uuid default null, p_ritmo jsonb default null, p_trocar_lista boolean default false
)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_status text;
begin
  if not public.pode_disparar() then raise exception 'Sem permissao para o Disparador em massa'; end if;

  select c.status into v_status from public.disparo_campanhas c
  where c.id = p_campaign_id and public.can_access_device(c.device_id);

  if v_status is null then raise exception 'Sem acesso a este disparo'; end if;
  if v_status not in ('rascunho', 'agendado') then
    raise exception 'Este disparo ja comecou (%), nao da mais para editar', v_status;
  end if;

  update public.disparo_campanhas
     set nome = coalesce(p_nome, nome),
         mensagem = coalesce(nullif(trim(p_mensagem), ''), mensagem),
         iniciar_em = coalesce(p_iniciar_em, iniciar_em),
         list_id = case when p_trocar_lista then p_list_id else list_id end,
         delay_min_ms   = coalesce((p_ritmo ->> 'delay_min_ms')::int, delay_min_ms),
         delay_max_ms   = coalesce((p_ritmo ->> 'delay_max_ms')::int, delay_max_ms),
         pausa_a_cada   = coalesce((p_ritmo ->> 'pausa_a_cada')::int, pausa_a_cada),
         pausa_longa_ms = coalesce((p_ritmo ->> 'pausa_longa_ms')::int, pausa_longa_ms),
         updated_at = now()
   where id = p_campaign_id;

  if p_trocar_lista then
    -- Alvo avulso SOBREVIVE a troca de lista: foi acrescentado a mao para este
    -- disparo, e apaga-lo seria perder o que a pessoa digitou.
    delete from public.disparo_alvos where campaign_id = p_campaign_id and not avulso;

    if p_list_id is not null then
      insert into public.disparo_alvos (campaign_id, remote_sender, nome_exibicao, avulso)
      select p_campaign_id, m.remote_sender, m.nome_exibicao, false
      from public.disparo_lista_membros m
      where m.list_id = p_list_id and m.tem_whatsapp is not false
      on conflict (campaign_id, remote_sender) do nothing;
    end if;
  end if;
end;
$function$;

grant execute on function public.disparo_editar(uuid, text, text, timestamptz, uuid, jsonb, boolean) to authenticated;
revoke execute on function public.disparo_editar(uuid, text, text, timestamptz, uuid, jsonb, boolean) from public, anon;

-- `disparo_criar` ganha rascunho, ensaio e TETO DE SEGURANCA.
--
-- O teto mora aqui, e nao so na tela, porque a tela nao e o unico caminho ate a
-- tabela. Sao dois niveis: acima de 300 a chamada e recusada sem `p_confirmado`
-- (forcando a tela a perguntar -- ela nao consegue "esquecer"), e acima de 2.000
-- e recusada sempre. No ritmo seguro, 300 contatos ja sao ~40 horas de disparo; o
-- teto nao e sobre volume, e sobre quanto estrago um clique consegue fazer.
drop function if exists public.disparo_criar(text, uuid, text, timestamptz, uuid, text[], jsonb, jsonb);

create or replace function public.disparo_criar(
  p_nome text, p_device_id uuid, p_mensagem text, p_iniciar_em timestamptz,
  p_list_id uuid default null, p_avulsos text[] default null,
  p_anexos jsonb default null, p_ritmo jsonb default null,
  p_rascunho boolean default false, p_ensaio boolean default false,
  p_confirmado boolean default false
)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id uuid; v_alvos integer;
  TETO_CONFIRMACAO constant integer := 300;
  TETO_ABSOLUTO    constant integer := 2000;
begin
  if not public.pode_disparar() then raise exception 'Sem permissao para o Disparador em massa'; end if;
  if not public.can_access_device(p_device_id) then raise exception 'Sem acesso a este aparelho'; end if;
  if coalesce(trim(p_mensagem), '') = '' then raise exception 'A mensagem nao pode ser vazia'; end if;

  insert into public.disparo_campanhas (
    nome, device_id, list_id, mensagem, anexos, iniciar_em, status, created_by, ensaio,
    delay_min_ms, delay_max_ms, jitter_pct, pausa_a_cada, pausa_longa_ms,
    respeitar_horario, hora_inicio, hora_fim
  )
  values (
    p_nome, p_device_id, p_list_id, p_mensagem, p_anexos, coalesce(p_iniciar_em, now()),
    case when p_rascunho then 'rascunho' else 'agendado' end,
    auth.uid(), coalesce(p_ensaio, false),
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

  if p_list_id is not null then
    insert into public.disparo_alvos (campaign_id, remote_sender, nome_exibicao, avulso)
    select v_id, m.remote_sender, m.nome_exibicao, false
    from public.disparo_lista_membros m
    where m.list_id = p_list_id and m.tem_whatsapp is not false
    on conflict (campaign_id, remote_sender) do nothing;
  end if;

  if p_avulsos is not null then
    insert into public.disparo_alvos (campaign_id, remote_sender, nome_exibicao, avulso)
    select v_id, n.numero, coalesce(max(coalesce(c.nickname, c.name)), n.numero), true
    from (select distinct public.disparo_normalizar_numero(x) as numero from unnest(p_avulsos) as x) n
    left join public.contacts c on c.remote_jid = n.numero
    where n.numero is not null
    group by n.numero
    on conflict (campaign_id, remote_sender) do nothing;
  end if;

  select count(*) into v_alvos from public.disparo_alvos where campaign_id = v_id;

  if v_alvos = 0 then
    raise exception 'Nenhum destinatario valido: o disparo nao foi criado';
  end if;
  if v_alvos > TETO_ABSOLUTO then
    raise exception 'Sao % destinatarios, acima do teto de % por disparo. Divida em campanhas menores.',
      v_alvos, TETO_ABSOLUTO;
  end if;
  if v_alvos > TETO_CONFIRMACAO and not coalesce(p_confirmado, false) then
    raise exception 'Sao % destinatarios (acima de %). Confirme na tela antes de criar.',
      v_alvos, TETO_CONFIRMACAO;
  end if;

  return v_id;
end;
$function$;

revoke execute on function public.disparo_criar(text, uuid, text, timestamptz, uuid, text[], jsonb, jsonb, boolean, boolean, boolean) from public, anon;
grant execute on function public.disparo_criar(text, uuid, text, timestamptz, uuid, text[], jsonb, jsonb, boolean, boolean, boolean) to authenticated;
