-- Super-admin pode restringir o acesso a instâncias TAMBÉM de usuários admin.
-- Admin sem restrição = acesso a tudo (padrão). Admin restrito = só user_allowed_devices.
-- Super-admin nunca é restrito (sempre tem acesso total).

alter table public.profiles add column if not exists devices_restricted boolean not null default false;

create or replace function public.can_access_device(p_device_id uuid)
 returns boolean language plpgsql security definer set search_path to 'public' as $function$
begin
  return exists (
    select 1 from public.user_allowed_devices where device_id = p_device_id and user_id = auth.uid()
  ) or exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (is_super_admin = true or (is_admin = true and devices_restricted = false))
  );
end;
$function$;

create or replace function public.set_user_devices_restricted(p_user_id uuid, p_restricted boolean)
 returns void language plpgsql security definer set search_path to public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: super-admin only'; end if;
  update public.profiles set devices_restricted = p_restricted where id = p_user_id;
end $$;

grant execute on function public.set_user_devices_restricted(uuid, boolean) to authenticated;
