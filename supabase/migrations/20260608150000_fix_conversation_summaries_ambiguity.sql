drop function if exists public.get_conversation_summaries(uuid);

create or replace function public.get_conversation_summaries(p_device_id uuid)
returns table(
  remote_sender text,
  sender_name text,
  last_message_id uuid,
  last_message_content text,
  last_message_direction text,
  last_message_created_at timestamp with time zone,
  last_message_is_read boolean,
  last_message_attachments jsonb,
  unread_count bigint,
  message_count bigint
)
language plpgsql
set search_path to 'public'
as $function$
begin
  return query
  with ranked_messages as (
    select
      m.remote_sender,
      m.id as message_id,
      m.content,
      m.direction,
      m.created_at,
      m.is_read,
      m.attachments,
      m.sender_name,
      row_number() over (partition by m.remote_sender order by m.created_at desc) as rn,
      count(*) over (partition by m.remote_sender) as total_messages
    from public.messages m
    where m.device_id = p_device_id
      and m.deleted_at is null
  ),
  latest_per_conversation as (
    select
      rm.remote_sender,
      rm.sender_name,
      rm.message_id as last_message_id,
      rm.content as last_message_content,
      rm.direction as last_message_direction,
      rm.created_at as last_message_created_at,
      rm.is_read as last_message_is_read,
      rm.attachments as last_message_attachments,
      rm.total_messages as message_count
    from ranked_messages rm
    where rm.rn = 1
  ),
  unread_counts as (
    select
      m.remote_sender,
      count(*) as unread_count
    from public.messages m
    left join public.conversation_user_states cus
      on cus.device_id = p_device_id
      and cus.remote_sender = m.remote_sender
      and cus.user_id = auth.uid()
    where m.device_id = p_device_id
      and m.deleted_at is null
      and m.direction = 'inbound'
      and (
        cus.last_read_at is null
        or m.created_at > cus.last_read_at
      )
      and not coalesce(cus.manual_unread, false)
    group by m.remote_sender
  ),
  final_summaries as (
    select
      l.remote_sender,
      coalesce(l.sender_name, '') as sender_name,
      l.last_message_id,
      l.last_message_content,
      l.last_message_direction,
      l.last_message_created_at,
      l.last_message_is_read,
      l.last_message_attachments,
      coalesce(u.unread_count, 0) as unread_count,
      l.message_count
    from latest_per_conversation l
    left join unread_counts u on u.remote_sender = l.remote_sender
  )
  select
    fs.remote_sender,
    fs.sender_name,
    fs.last_message_id,
    fs.last_message_content,
    fs.last_message_direction,
    fs.last_message_created_at,
    fs.last_message_is_read,
    fs.last_message_attachments,
    fs.unread_count,
    fs.message_count
  from final_summaries fs
  order by
    exists (
      select 1 from public.conversation_user_states cus
      where cus.device_id = p_device_id
        and cus.remote_sender = fs.remote_sender
        and cus.user_id = auth.uid()
        and cus.pinned = true
    ) desc,
    fs.last_message_created_at desc;
end;
$function$;

create index if not exists idx_messages_device_remote_sender_created
  on public.messages(device_id, remote_sender, created_at desc)
  where deleted_at is null;
