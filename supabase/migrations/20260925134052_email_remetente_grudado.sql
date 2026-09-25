-- Item 3 da fila de 25/09/2026: atribuição de e-mail no molde do WhatsApp
-- (abas Geral / Minhas) e o remetente GRUDADO numa pessoa.
--
-- O pedido do Samuel: "atribuir um e-mail para uma pessoa da equipe do setor,
-- e esse de grudar no usuário seria: aquele remetente, quando enviar e-mail,
-- já cair direto para a pessoa que deixou aquele e-mail grudado".
--
-- A atribuição em si NÃO precisa de coluna nova: `email_states.assigned_to`
-- já existe (e a tabela está com 0 linhas — a triagem nunca foi usada). O que
-- falta é a REGRA por remetente, e quem a aplica.
--
-- ⚠️ POR QUE A REGRA MORA NO BANCO, e não no app: os e-mails entram por
-- upsert da edge function `email-microsoft`, não pela tela. Uma regra escrita
-- no app simplesmente não rodaria para quem escreve de verdade.

create table if not exists public.email_remetentes_fixos (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts(id) on delete cascade,

  -- Endereço do remetente, SEMPRE em minúsculas e sem espaço nas pontas —
  -- garantido pelo gatilho de normalização abaixo, e não pela boa vontade de
  -- quem chama. "Financeiro@Cliente.com" e "financeiro@cliente.com" são a
  -- mesma pessoa, e sem isso viravam duas regras conflitantes.
  remetente  text not null,

  user_id    uuid not null references public.profiles(id) on delete cascade,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em  timestamptz not null default now(),

  -- Unique COMPLETO (não parcial): é o árbitro do `on conflict` da RPC.
  constraint email_remetentes_fixos_unico unique (account_id, remetente)
);

create index if not exists email_remetentes_fixos_por_pessoa
  on public.email_remetentes_fixos (user_id);

-- Normalização no próprio banco. O gatilho roda ANTES do árbitro do
-- `on conflict` ser avaliado, então funciona mesmo se quem chamar mandar o
-- endereço com maiúsculas.
create or replace function public.email_remetente_fixo_normaliza()
returns trigger
language plpgsql
as $function$
begin
  new.remetente := lower(trim(coalesce(new.remetente, '')));
  if new.remetente = '' then
    raise exception 'Remetente não pode ser vazio';
  end if;
  return new;
end;
$function$;

drop trigger if exists email_remetentes_fixos_normaliza on public.email_remetentes_fixos;
create trigger email_remetentes_fixos_normaliza
  before insert or update on public.email_remetentes_fixos
  for each row execute function public.email_remetente_fixo_normaliza();

alter table public.email_remetentes_fixos enable row level security;

-- Quem enxerga a caixa administra as regras dela. `_pode_ver_conta_de_email`
-- é a MESMA função usada por `emails`, `email_states` e `email_fixados` —
-- reusar é o que mantém tudo coerente quando a regra de acesso mudar.
create policy email_remetentes_fixos_gerir on public.email_remetentes_fixos
  for all
  using (public._pode_ver_conta_de_email(account_id))
  with check (public._pode_ver_conta_de_email(account_id));


-- ---------------------------------------------------------------------------
-- Quem aplica a regra no e-mail que ACABOU de chegar
-- ---------------------------------------------------------------------------
--
-- ⚠️ `after insert` e NÃO `after insert or update`, de propósito. A edge
-- function grava com `on conflict (account_id, graph_id) do update`
-- (merge-duplicates): e-mail que já existe toma o caminho do UPDATE, e o
-- gatilho de INSERT não dispara. É exatamente o que se quer — se alguém
-- reatribuiu um e-mail na mão, a próxima varredura não pode desfazer isso.

create or replace function public.email_aplicar_remetente_fixo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dono uuid;
begin
  select r.user_id into v_dono
    from public.email_remetentes_fixos r
   where r.account_id = new.account_id
     and r.remetente  = lower(trim(coalesce(new.from_email, '')))
   limit 1;

  if v_dono is null then
    return new;
  end if;

  insert into public.email_states (email_id, assigned_to, status)
  values (new.id, v_dono, 'open')
  on conflict (email_id) do update
    set assigned_to = excluded.assigned_to,
        updated_at  = now();

  return new;
end;
$function$;

drop trigger if exists emails_aplica_remetente_fixo on public.emails;
create trigger emails_aplica_remetente_fixo
  after insert on public.emails
  for each row execute function public.email_aplicar_remetente_fixo();


-- ---------------------------------------------------------------------------
-- Grudar / desgrudar, pela tela
-- ---------------------------------------------------------------------------
--
-- Grudar também ARRUMA O PASSADO: aplica ao que já está na caixa daquele
-- remetente e ainda não tem dono. Sem isso a regra só valeria a partir do
-- próximo e-mail, e no dia 1 pareceria que não fez nada.
--
-- O que já tem dono é DEIXADO EM PAZ — grudar não rouba e-mail de colega.

create or replace function public.email_grudar_remetente(
  p_account_id uuid,
  p_remetente  text,
  p_user_id    uuid
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_remetente text := lower(trim(coalesce(p_remetente, '')));
  v_aplicados integer := 0;
begin
  if v_remetente = '' then
    raise exception 'Informe o remetente.';
  end if;

  if not public._pode_ver_conta_de_email(p_account_id) then
    raise exception 'Você não tem acesso a esta caixa.';
  end if;

  insert into public.email_remetentes_fixos (account_id, remetente, user_id, criado_por)
  values (p_account_id, v_remetente, p_user_id, auth.uid())
  on conflict (account_id, remetente) do update
    set user_id    = excluded.user_id,
        criado_por = auth.uid(),
        criado_em  = now();

  with alvos as (
    select e.id
      from public.emails e
      left join public.email_states s on s.email_id = e.id
     where e.account_id = p_account_id
       and lower(trim(coalesce(e.from_email, ''))) = v_remetente
       and (s.id is null or s.assigned_to is null)
  )
  insert into public.email_states (email_id, assigned_to, status)
  select a.id, p_user_id, 'open' from alvos a
  on conflict (email_id) do update
    set assigned_to = excluded.assigned_to,
        updated_at  = now();

  get diagnostics v_aplicados = row_count;
  return v_aplicados;
end;
$function$;

create or replace function public.email_desgrudar_remetente(
  p_account_id uuid,
  p_remetente  text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public._pode_ver_conta_de_email(p_account_id) then
    raise exception 'Você não tem acesso a esta caixa.';
  end if;

  -- Só a REGRA sai. Os e-mails que já foram atribuídos continuam com dono —
  -- desgrudar é parar de atribuir daqui pra frente, não desfazer o trabalho
  -- que já foi distribuído.
  delete from public.email_remetentes_fixos
   where account_id = p_account_id
     and remetente  = lower(trim(coalesce(p_remetente, '')));
end;
$function$;
