-- Desativar usuário (sem apagar) e devolver as conversas dele para a Geral.
--
-- Pedido (Samuel, 07/10/2026): hoje a tela de Equipe só tem "Remover", que
-- apaga a pessoa de vez, e "Bloquear", que só esconde ferramentas da tela. Faltava
-- o meio-termo de quem sai da empresa ou entra de licença: NÃO consegue mais
-- entrar, perde o acesso aos aparelhos, mas o histórico (mensagens, logs,
-- tarefas) continua apontando para ela.
--
-- O que mais pesa na decisão: a conversa que ficou "Pegada" por quem saiu. Hoje
-- ela fica presa — a lista da Geral esconde toda linha que tem dono, então
-- ninguém vê a conversa e ninguém a atende. Esta migration resolve nos DOIS
-- caminhos que deixam conversa sem dono:
--
--   1. Desativar  -> gatilho em `usuarios_desativados` devolve as conversas.
--   2. Remover    -> gatilho em `conversation_assignments` converte o
--                    `ON DELETE SET NULL` das chaves estrangeiras em "voltou
--                    para a Geral" (antes ficava `taken` com dono nulo).
--
-- ⚠️ Esta migration NÃO é espelho fiel da produção: o ledger de migrations do
-- projeto está em drift total. As definições de `colegas()`,
-- `get_device_team_members()` e `get_task_assignees()` abaixo foram copiadas de
-- `pg_get_functiondef` do banco real em 07/10/2026, e a ÚNICA diferença para
-- elas é o `not exists (... usuarios_desativados ...)`. Assinaturas e nomes de
-- coluna de retorno são idênticos de propósito: o app faz `as X[]` cego, e
-- mudar nome de coluna quebra sem aviso.

set local lock_timeout = '5s';

-- ===========================================================================
-- PARTE 1 — onde a marca de "desativado" mora
-- ===========================================================================
--
-- POR QUE TABELA NOVA, E NÃO UMA COLUNA EM `profiles`
-- A policy `users_update_own_profile` só trava `is_admin` no WITH CHECK, então
-- qualquer coluna nova de `profiles` é AUTO-ATRIBUÍVEL: o próprio usuário
-- desativado poderia se reativar com um PATCH no PostgREST (enquanto o token
-- dele ainda vale). Mesma regra da casa que mantém `tool_access` fora de
-- `profiles`.
--
-- `on delete cascade` em auth.users: se a pessoa for REMOVIDA depois, a marca
-- some junto — não sobra lixo apontando para ninguém.
--
-- `desativado_por` aponta para `profiles` (e não auth.users) porque é dali que
-- `conversation_action_logs.user_id` herda a FK. `set null`: apagar o admin que
-- desativou não pode apagar nem bloquear nada.
create table if not exists public.usuarios_desativados (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  desativado_em  timestamptz not null default now(),
  desativado_por uuid references public.profiles (id) on delete set null,
  motivo         text
);

comment on table public.usuarios_desativados is
  'Quem está desativado: não loga (auth.users.banned_until), não tem aparelhos e
   não aparece em seletores de pessoas, mas continua existindo — o histórico
   segue apontando para ela. Escrita só pelas RPCs desativar_usuario /
   reativar_usuario; ver 20261007130000_atendimento_desativar_usuario.sql.';

alter table public.usuarios_desativados enable row level security;

-- Só admin lê direto. Quem NÃO é admin nunca precisa desta tabela: os seletores
-- de pessoas (colegas, equipe do aparelho, responsáveis de tarefa) já filtram
-- por dentro de funções SECURITY DEFINER. Sem policy de insert/update/delete:
-- escrever é só pelas RPCs.
drop policy if exists usuarios_desativados_select on public.usuarios_desativados;
create policy usuarios_desativados_select on public.usuarios_desativados
  for select to authenticated
  using (public._is_admin());

-- O default do Supabase entrega ALL em tabela nova para anon e authenticated.
-- A RLS já negaria, mas privilégio que não precisa existir não deve existir.
revoke all on table public.usuarios_desativados from public, anon, authenticated;
grant select on table public.usuarios_desativados to authenticated;

-- ===========================================================================
-- PARTE 2 — devolver as conversas de alguém para a Geral
-- ===========================================================================
--
-- POR QUE NÃO REUSAR `set_conversation_waiting`
-- Ela começa com `can_access_device(auth.uid())` do CHAMADOR e mexe numa
-- conversa por vez; aqui quem age é o sistema (um gatilho), sobre todas as
-- conversas de OUTRA pessoa. Então este é o mesmo efeito, escrito em lote.
--
-- O EFEITO é o de `set_conversation_waiting`, campo a campo: status 'waiting',
-- `global_read_at` nulo (volta como NÃO LIDA para o time inteiro — é isso que
-- faz alguém notar), e dono/designador/convite zerados.
--
-- O QUE ENTRA
--   * assigned_to = pessoa e status 'taken' ou 'assigned'  -> estava com ela.
--   * invited_to  = pessoa e status 'invited'              -> convite pendente
--     para ela, que nunca vai responder (e `set_conversation_waiting`,
--     `finish_conversation` e `take_conversation` RECUSAM mexer em conversa
--     'invited' — o convite ficaria travado para sempre).
--
-- O QUE FICA DE FORA
--   * 'finished': é histórico. Mantém `assigned_to` apontando para quem
--     atendeu, de propósito (`finish_conversation` não zera o dono).
--   * 'waiting': nunca guarda dono. Todo código que grava 'waiting' zera
--     assigned_to junto (set_conversation_waiting, respond_conversation_invite
--     recusando, processar_mensagem_para_atendimento). Conferido no banco em
--     07/10/2026: 0 linhas 'waiting' com dono.
--   * 'open': idem, nunca tem dono.
--
-- O LOG
-- `conversation_action_logs.user_id` é NOT NULL e FK para `profiles`, então
-- "autor nulo" não existe. Autor = quem desativou; sem autor (chamada direta
-- por SQL), cai na própria pessoa — `user_id = target_user_id` é como se
-- reconhece, depois, que foi automático. `target_user_id` é preenchido (a
-- `set_conversation_waiting` não preenche) porque aqui a pergunta que o log
-- precisa responder é "de quem foi tirada".
--
-- Devolve quantas conversas foram liberadas.
create or replace function public.liberar_conversas_do_usuario(
  p_user_id uuid,
  p_autor   uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;

  with liberadas as (
    update public.conversation_assignments a
       set status         = 'waiting',
           global_read_at = null,
           assigned_to    = null,
           assigned_by    = null,
           assigned_at    = null,
           invited_to     = null,
           invited_by     = null,
           invited_at     = null,
           updated_at     = now()
     where (a.assigned_to = p_user_id and a.status in ('taken', 'assigned'))
        or (a.invited_to  = p_user_id and a.status = 'invited')
    returning a.device_id, a.remote_sender
  ),
  registradas as (
    insert into public.conversation_action_logs (
      device_id, remote_sender, user_id, action, target_user_id
    )
    select l.device_id, l.remote_sender, coalesce(p_autor, p_user_id), 'waiting', p_user_id
      from liberadas l
    returning 1
  )
  select count(*) into v_total from liberadas;

  return v_total;
end;
$function$;

-- Interna: só gatilho e SQL de quem administra o banco chamam. NÃO vai para
-- `authenticated` — qualquer logado esvaziaria a fila de qualquer colega. O
-- default do Supabase concede EXECUTE a anon/authenticated em função nova, por
-- isso o revoke é explícito.
revoke all on function public.liberar_conversas_do_usuario(uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- PARTE 3 — desativar libera, sempre
-- ===========================================================================
--
-- Em gatilho, e não só dentro da RPC, para que NÃO haja outro jeito de
-- desativar alguém (SQL direto, outro painel) que esqueça de soltar as
-- conversas.
create or replace function public.tg_usuario_desativado_libera_conversas()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.liberar_conversas_do_usuario(new.user_id, new.desativado_por);
  return null;
end;
$function$;

revoke all on function public.tg_usuario_desativado_libera_conversas() from public, anon, authenticated;

drop trigger if exists usuarios_desativados_libera_conversas on public.usuarios_desativados;
create trigger usuarios_desativados_libera_conversas
  after insert on public.usuarios_desativados
  for each row execute function public.tg_usuario_desativado_libera_conversas();

-- ===========================================================================
-- PARTE 4 — "Remover" também devolve a conversa
-- ===========================================================================
--
-- As FKs `assigned_to`/`invited_to` de `conversation_assignments` são
-- `ON DELETE SET NULL` e NÃO mexem em `status`. Resultado hoje: remover alguém
-- deixa a linha 'taken'/'assigned'/'invited' com dono nulo — escondida da Geral
-- (que oculta linha com status de dono) e sem ninguém para atender.
--
-- Ação referencial dispara gatilho BEFORE UPDATE de linha na tabela filha (é um
-- UPDATE comum, executado por SPI), então dá para consertar aqui, sem mexer em
-- nenhuma RPC existente. O gatilho SÓ age quando o dono SOME e o status
-- continua o de "tem dono" — que, lendo todas as funções que escrevem nesta
-- tabela em 07/10/2026, só acontece pela FK:
--   * set_conversation_waiting / respond_conversation_invite (recusar) /
--     processar_mensagem_para_atendimento: zeram o dono JUNTO com status
--     'waiting' ou 'open' -> não passam pela condição.
--   * reopen_finished_conversation_on_message / processar_...: partem de
--     'finished' e vão para 'open' -> idem.
--   * respond_conversation_invite (aceitar) e assign_conversation: tiram o
--     convite, mas o status novo é 'taken'/'assigned' COM dono -> a condição do
--     convite exige status 'invited' e não dispara.
--   * finish_conversation: não zera dono.
--   * mover_conversa_para_jid_canonico: só troca remote_sender.
--
-- O `when` mantém o gatilho fora do caminho de 99% dos updates desta tabela
-- (que é quente: toda mensagem recebida passa por aqui).
--
-- Sem log: neste caminho a pessoa está sendo apagada, o autor é a service_role
-- (auth.uid() nulo) e `conversation_action_logs.user_id` é NOT NULL — um log
-- apontaria para um perfil que está sumindo no mesmo comando.
--
-- Não precisa de SECURITY DEFINER: só reescreve a linha que está sendo gravada.
create or replace function public.tg_conversa_sem_dono_volta_para_geral()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.assigned_to is not null
     and new.assigned_to is null
     and new.status in ('taken', 'assigned') then
    new.status         := 'waiting';
    new.assigned_by    := null;
    new.assigned_at    := null;
    new.global_read_at := null;
  end if;

  if old.invited_to is not null
     and new.invited_to is null
     and new.status = 'invited' then
    new.status         := 'waiting';
    new.invited_by     := null;
    new.invited_at     := null;
    new.global_read_at := null;
  end if;

  return new;
end;
$function$;

drop trigger if exists conversa_sem_dono_volta_para_geral on public.conversation_assignments;
create trigger conversa_sem_dono_volta_para_geral
  before update on public.conversation_assignments
  for each row
  when (
    (old.assigned_to is not null and new.assigned_to is null)
    or (old.invited_to is not null and new.invited_to is null)
  )
  execute function public.tg_conversa_sem_dono_volta_para_geral();

-- ===========================================================================
-- PARTE 5 — as RPCs do admin
-- ===========================================================================
--
-- POR QUE O BANIMENTO É FEITO AQUI, EM SQL, E NÃO NA EDGE FUNCTION
-- Conferido em 07/10/2026: toda função de `public` pertence a `supabase_admin`
-- (superusuário), que tem UPDATE em `auth.users` e DELETE em `auth.sessions` e
-- `auth.refresh_tokens`. Como a RPC é SECURITY DEFINER, ela herda isso — então
-- NÃO há deploy de edge function nesta funcionalidade.
--
-- `banned_until = now() + 100 anos`, nunca 'infinity': o GoTrue (Go) não lê
-- 'infinity' como data. É o mesmo valor que o `ban_duration` da API admin
-- produziria. GoTrue recusa login e renovação de token de quem tem
-- `banned_until` no futuro.
--
-- Apagar `auth.sessions` e `auth.refresh_tokens` derruba quem já está logado:
-- sem refresh token válido, o app dela não renova a sessão e cai na tela de
-- login — onde o ban a recusa. LIMITE CONHECIDO: o access token (JWT) já emitido
-- continua válido até expirar (padrão 1 h); nesse intervalo o PostgREST ainda
-- aceita as chamadas dela. Os aparelhos, porém, já foram retirados.
--
-- Todo o resto roda na MESMA transação: ou desativa por inteiro ou nada muda.

create or replace function public.desativar_usuario(
  p_user_id uuid,
  p_motivo  text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_autor  uuid := auth.uid();
  v_alvo   record;
  v_motivo text := nullif(left(btrim(coalesce(p_motivo, '')), 500), '');
begin
  if v_autor is null or not public._is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Informe o usuário a desativar';
  end if;

  if p_user_id = v_autor then
    raise exception 'Você não pode desativar a própria conta';
  end if;

  select p.id, p.name, p.email, coalesce(p.is_super_admin, false) as is_super_admin
    into v_alvo
    from public.profiles p
   where p.id = p_user_id;

  if not found then
    raise exception 'Usuário não encontrado';
  end if;

  -- Super admin é quem administra as travas. Desativá-lo por esta tela
  -- (aberta a qualquer admin) deixaria o sistema sem dono de uma hora para outra.
  if v_alvo.is_super_admin then
    raise exception 'Não é possível desativar um super admin';
  end if;

  if exists (select 1 from public.usuarios_desativados d where d.user_id = p_user_id) then
    raise exception 'Este usuário já está desativado';
  end if;

  -- 1) A marca. O gatilho AFTER INSERT devolve as conversas ativas para a Geral.
  insert into public.usuarios_desativados (user_id, desativado_por, motivo)
  values (p_user_id, v_autor, v_motivo);

  -- 2) Aparelhos. Cada linha apagada cai no `audit_user_allowed_devices`
  --    (log_admin_change), que registra o autor pelo auth.uid().
  --
  --    ⚠️ Não basta para ADMIN: `can_access_device` libera tudo para admin sem
  --    restrição (`devices_restricted = false`) sem olhar esta tabela. Para
  --    admin, quem fecha a porta é o banimento abaixo.
  delete from public.user_allowed_devices where user_id = p_user_id;

  -- 3) Presença. O contato fixo (`contact_owners`) só entrega a conversa para
  --    quem tem heartbeat dos últimos 3 min; sem esta linha ela some do "online"
  --    na hora, em vez de daqui a 3 min.
  delete from public.user_app_sessions where user_id = p_user_id;

  -- 4) Login e sessões.
  update auth.users
     set banned_until = now() + interval '100 years'
   where id = p_user_id;

  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions       where user_id = p_user_id;

  -- 5) Quem fez, e quando. Mesma tabela do restante do cadastro
  --    (admin_audit_log), para aparecer no "Histórico de Alterações" da tela.
  insert into public.admin_audit_log (
    actor_id, actor_label, target_user_id, target_label,
    entity, action, changes, source
  )
  values (
    v_autor,
    (select coalesce(a.name, a.email) from public.profiles a where a.id = v_autor),
    p_user_id,
    coalesce(v_alvo.name, v_alvo.email),
    'usuarios_desativados',
    'update',
    jsonb_build_object('desativado', jsonb_build_object('de', false, 'para', true))
      || case when v_motivo is not null then jsonb_build_object('motivo', v_motivo) else '{}'::jsonb end,
    public.audit_source()
  );
end;
$function$;

-- Reativar: libera o login de novo. NÃO devolve as conversas (elas já foram
-- para a Geral e outras pessoas podem ter pegado) e NÃO restaura os aparelhos —
-- quem reativa escolhe de novo, pelo cadastro.
create or replace function public.reativar_usuario(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_autor uuid := auth.uid();
  v_alvo  record;
begin
  if v_autor is null or not public._is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Informe o usuário a reativar';
  end if;

  if not exists (select 1 from public.usuarios_desativados d where d.user_id = p_user_id) then
    raise exception 'Este usuário não está desativado';
  end if;

  select p.name, p.email into v_alvo from public.profiles p where p.id = p_user_id;

  delete from public.usuarios_desativados where user_id = p_user_id;

  update auth.users set banned_until = null where id = p_user_id;

  insert into public.admin_audit_log (
    actor_id, actor_label, target_user_id, target_label,
    entity, action, changes, source
  )
  values (
    v_autor,
    (select coalesce(a.name, a.email) from public.profiles a where a.id = v_autor),
    p_user_id,
    coalesce(v_alvo.name, v_alvo.email),
    'usuarios_desativados',
    'update',
    jsonb_build_object('desativado', jsonb_build_object('de', true, 'para', false)),
    public.audit_source()
  );
end;
$function$;

-- Lista de ids para o selo "Desativado" da tela de Equipe. Quem não é admin
-- recebe lista vazia, e não erro — o mesmo contrato de `getAdminAuditLog`.
create or replace function public.usuarios_desativados_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select d.user_id
    from public.usuarios_desativados d
   where public._is_admin();
$function$;

revoke all on function public.desativar_usuario(uuid, text) from public, anon;
revoke all on function public.reativar_usuario(uuid) from public, anon;
revoke all on function public.usuarios_desativados_ids() from public, anon;
grant execute on function public.desativar_usuario(uuid, text) to authenticated;
grant execute on function public.reativar_usuario(uuid) to authenticated;
grant execute on function public.usuarios_desativados_ids() to authenticated;

-- ===========================================================================
-- PARTE 6 — fora dos seletores de pessoas
-- ===========================================================================
--
-- Só a cláusula `not exists` é nova nas três; o resto é a definição que estava
-- em produção em 07/10/2026.
--
-- ⚠️ NÃO cobre as telas que leem `profiles` direto do cliente (broadcasts,
-- setores, `use-atribuicao-automatica`, e-mail prefs): essas continuam
-- listando quem está desativado até migrarem para função.

-- Colegas (e-mail compartilhado, agenda, "Designar" da caixa de e-mail).
create or replace function public.colegas()
returns table(id uuid, nome text, setor text, tem_outlook boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT
    p.id,
    coalesce(p.name, '') AS nome,
    p.department AS setor,
    EXISTS (SELECT 1 FROM public.agenda_conexoes c WHERE c.user_id = p.id) AS tem_outlook
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = p.id)
  ORDER BY coalesce(p.name, '');
$function$;

-- "Designar" no chat. Quem foi desativado já perdeu `user_allowed_devices`, mas
-- o cadastro pode ser editado depois e devolver a linha: o filtro garante que
-- uma pessoa desativada nunca volta a receber conversa por esse caminho.
create or replace function public.get_device_team_members(p_device_id uuid)
returns table(user_id uuid, name text, email text, avatar_url text, department text)
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF NOT public.can_access_device(p_device_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id        AS user_id,
    p.name,
    p.email,
    p.avatar_url,
    p.department
  FROM   public.profiles p
  JOIN   public.user_allowed_devices uad ON uad.user_id = p.id
  WHERE  uad.device_id = p_device_id
    AND  NOT EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = p.id)
  ORDER BY p.name;
END;
$function$;

-- Responsável de tarefa.
create or replace function public.get_task_assignees()
returns table(id uuid, name text, avatar_url text, department text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT p.id, p.name, p.avatar_url, p.department
  FROM public.profiles p
  WHERE p.name IS NOT NULL AND btrim(p.name) <> ''
    AND (public._is_admin() OR p.id = auth.uid())
    AND NOT EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = p.id)
  ORDER BY p.name;
$function$;
