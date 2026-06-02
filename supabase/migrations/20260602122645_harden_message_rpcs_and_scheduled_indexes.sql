create index if not exists idx_scheduled_messages_device_id
  on public.scheduled_messages (device_id);

create index if not exists idx_scheduled_messages_user_id
  on public.scheduled_messages (user_id);

revoke execute on function public.send_whatsapp_message(uuid, text, text, uuid, text, text, text) from public;
revoke execute on function public.send_whatsapp_message(uuid, text, text, uuid, text, text, text, uuid) from public;
revoke execute on function public.send_whatsapp_reaction(uuid, text, uuid, uuid) from public;
revoke execute on function public.delete_whatsapp_message(uuid, uuid, boolean) from public;
revoke execute on function public.edit_whatsapp_message(uuid, uuid, text) from public;

grant execute on function public.send_whatsapp_message(uuid, text, text, uuid, text, text, text) to authenticated;
grant execute on function public.send_whatsapp_message(uuid, text, text, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.send_whatsapp_reaction(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.delete_whatsapp_message(uuid, uuid, boolean) to authenticated;
grant execute on function public.edit_whatsapp_message(uuid, uuid, text) to authenticated;
