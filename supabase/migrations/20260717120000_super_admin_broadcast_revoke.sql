-- Super-admin + broadcast (mensagem para todos com "quem viu") + revogar acesso por instância.

-- 1) super-admin flag + função
alter table public.profiles add column if not exists is_super_admin boolean not null default false;
update public.profiles set is_super_admin=true where email='samuelklausfischer@hotmail.com';

create or replace function public._is_super_admin() returns boolean
  language sql security definer set search_path=public as
$$ select exists(select 1 from public.profiles where id=auth.uid() and is_super_admin=true) $$;

-- 2) broadcast (mensagem para todos)
create table if not exists public.app_broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text,
  message text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.app_broadcasts enable row level security;
drop policy if exists bc_select on public.app_broadcasts;
drop policy if exists bc_insert on public.app_broadcasts;
drop policy if exists bc_delete on public.app_broadcasts;
create policy bc_select on public.app_broadcasts for select to authenticated using (true);
create policy bc_insert on public.app_broadcasts for insert to authenticated with check (public._is_super_admin());
create policy bc_delete on public.app_broadcasts for delete to authenticated using (public._is_super_admin());

-- 3) rastreio "quem viu"
create table if not exists public.broadcast_reads (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.app_broadcasts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique(broadcast_id, user_id)
);
alter table public.broadcast_reads enable row level security;
drop policy if exists br_insert on public.broadcast_reads;
drop policy if exists br_select on public.broadcast_reads;
create policy br_insert on public.broadcast_reads for insert to authenticated with check (user_id=auth.uid());
create policy br_select on public.broadcast_reads for select to authenticated using (user_id=auth.uid() or public._is_super_admin());

create or replace function public.mark_broadcast_read(p_broadcast_id uuid) returns void
  language sql security definer set search_path=public as
$$ insert into public.broadcast_reads(broadcast_id,user_id) values (p_broadcast_id, auth.uid())
   on conflict (broadcast_id,user_id) do nothing $$;

-- 4) revogar/conceder acesso por instância (super-admin)
create or replace function public.set_user_device_access(p_user_id uuid, p_device_id uuid, p_allowed boolean)
  returns void language plpgsql security definer set search_path=public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: super-admin only'; end if;
  if p_allowed then
    insert into public.user_allowed_devices(user_id,device_id) values (p_user_id,p_device_id)
      on conflict do nothing;
  else
    delete from public.user_allowed_devices where user_id=p_user_id and device_id=p_device_id;
  end if;
end $$;

-- 5) realtime + grants
alter publication supabase_realtime add table public.app_broadcasts;
grant select, insert, delete on public.app_broadcasts to authenticated;
grant select, insert on public.broadcast_reads to authenticated;
grant execute on function public.mark_broadcast_read(uuid) to authenticated;
grant execute on function public.set_user_device_access(uuid,uuid,boolean) to authenticated;
grant execute on function public._is_super_admin() to authenticated;
