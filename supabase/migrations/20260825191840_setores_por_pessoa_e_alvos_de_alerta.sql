-- ETAPA 5: setores por pessoa e para quem escalar aos 10 min.
--
-- `profiles.department` é uma coluna SÓ, e Raphaela cobre dois setores. Em vez de
-- trocar a coluna (que meio app lê hoje), a cobertura vira tabela própria —
-- `department` continua servindo o resto do sistema sem alteração.

create table if not exists public.user_sectors (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  setor      text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, setor)
);

comment on table public.user_sectors is
  'Setores que cada pessoa cobre. Existe porque profiles.department e uma coluna so e ha quem atenda dois setores (Raphaela). department NAO foi removida: continua sendo a lotacao principal, usada pelo resto do app.';

-- Para quem vai o aviso de 10 min, em que número e por qual aparelho. É aqui que
-- mora o telefone que `profiles` não tem. Ter `device_id` junto é o que faz o
-- aviso sair do WhatsApp DO SETOR, e não de um número estranho para a gerente.
create table if not exists public.sector_alert_targets (
  id           uuid primary key default gen_random_uuid(),
  setor        text not null,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  whatsapp_jid text,
  device_id    uuid references public.devices(id) on delete set null,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (setor, user_id)
);

comment on table public.sector_alert_targets is
  'Quem recebe a escalada de 10 min por setor. whatsapp_jid no formato 5511999999999@s.whatsapp.net. device_id e o aparelho que ENVIA o aviso -- deixa a mensagem chegar do WhatsApp do proprio setor. Trocar gerente e cadastro, nao deploy.';

alter table public.user_sectors         enable row level security;
alter table public.sector_alert_targets enable row level security;

-- Leitura para qualquer pessoa logada: a tela precisa saber quem cobre o quê.
drop policy if exists user_sectors_leitura on public.user_sectors;
create policy user_sectors_leitura on public.user_sectors
  for select using (auth.uid() is not null);

drop policy if exists alert_targets_leitura on public.sector_alert_targets;
create policy alert_targets_leitura on public.sector_alert_targets
  for select using (auth.uid() is not null);

-- Escrita só por admin — quem recebe cobrança de atraso não pode se remover da
-- lista sozinho.
drop policy if exists user_sectors_admin on public.user_sectors;
create policy user_sectors_admin on public.user_sectors
  for all using (public._is_admin()) with check (public._is_admin());

drop policy if exists alert_targets_admin on public.sector_alert_targets;
create policy alert_targets_admin on public.sector_alert_targets
  for all using (public._is_admin()) with check (public._is_admin());

-- Semente: todo mundo herda a lotação atual de profiles.department.
insert into public.user_sectors (user_id, setor)
select id, department from public.profiles
where department is not null
on conflict do nothing;

-- E a exceção que motivou a tabela: Raphaela também cobre o Financeiro.
insert into public.user_sectors (user_id, setor)
values ('90cc0025-dcdd-45ed-8119-9451b3568ab4', 'Financeiro')
on conflict do nothing;

-- Gerentes de cada setor. O telefone fica em branco de propósito: será
-- preenchido pelo cadastro, e a Etapa 4 não envia WhatsApp sem ele.
insert into public.sector_alert_targets (setor, user_id)
values
  ('Financeiro',    'c8bc2cf2-ee09-4a73-8ca8-7fc7ee240e40'),  -- Kezia
  ('Administrativo','9ce18a2b-147d-47f1-952e-fbd4a226eede'),  -- Renata Albuquerque
  ('Financeiro',    '90cc0025-dcdd-45ed-8119-9451b3568ab4'),  -- Raphaela (apoio)
  ('Administrativo','90cc0025-dcdd-45ed-8119-9451b3568ab4')   -- Raphaela (apoio)
on conflict (setor, user_id) do nothing;
