alter table public.scheduled_messages
  add column if not exists retry_count integer not null default 0;

create or replace function private.process_scheduled_messages(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_record record;
  v_attachments jsonb;
  v_attachment jsonb;
  v_result json;
  v_result_json jsonb;
  v_message_id uuid;
  v_sent_message_ids uuid[];
  v_media_url text;
  v_media_type text;
  v_media_name text;
  v_content text;
  v_index integer;
  v_processed integer := 0;
  v_sent integer := 0;
  v_failed integer := 0;
  v_error text;
  v_error_detail text;
begin
  for v_record in
    with due as (
      select id
      from public.scheduled_messages
      where scheduled_at <= now()
        and (
          status = 'pending'
          or (status = 'processing' and updated_at < now() - interval '5 minutes')
          or (status = 'failed' and retry_count < 3 and updated_at < now() - interval '5 minutes')
        )
      order by
        case when status = 'failed' then 1 else 0 end asc,
        scheduled_at asc
      limit v_limit
      for update skip locked
    )
    update public.scheduled_messages sm
      set status = 'processing',
          error_message = null,
          updated_at = now(),
          retry_count = case when sm.status = 'failed' then sm.retry_count + 1 else sm.retry_count end
    from due
    where sm.id = due.id
    returning sm.*
  loop
    v_processed := v_processed + 1;
    v_sent_message_ids := '{}'::uuid[];

    begin
      v_attachments := case
        when v_record.attachments is null then '[]'::jsonb
        when jsonb_typeof(v_record.attachments) = 'array' then v_record.attachments
        when jsonb_typeof(v_record.attachments) = 'object' then jsonb_build_array(v_record.attachments)
        else '[]'::jsonb
      end;

      if jsonb_array_length(v_attachments) > 0 then
        v_index := 0;

        for v_attachment in select value from jsonb_array_elements(v_attachments)
        loop
          v_index := v_index + 1;
          v_media_url := nullif(coalesce(
            v_attachment ->> 'url',
            v_attachment ->> 'publicUrl',
            v_attachment ->> 'mediaUrl'
          ), '');
          v_media_type := nullif(coalesce(
            v_attachment ->> 'type',
            v_attachment ->> 'mediaType'
          ), '');
          v_media_name := nullif(coalesce(
            v_attachment ->> 'name',
            v_attachment ->> 'fileName'
          ), '');

          if v_media_url is null then
            raise exception 'scheduled attachment is missing public url';
          end if;

          v_content := case
            when v_index = 1 then coalesce(v_record.content, '')
            when v_media_type = 'image' then '[Imagem]'
            when v_media_type = 'video' then '[Vídeo]'
            when v_media_type = 'audio' then '[Áudio]'
            else '[Documento]'
          end;

          v_result := public.send_whatsapp_message(
            p_device_id := v_record.device_id,
            p_remote_sender := v_record.remote_sender,
            p_content := v_content,
            p_sender_id := v_record.user_id,
            p_media_url := v_media_url,
            p_media_type := coalesce(v_media_type, 'document'),
            p_media_name := v_media_name,
            p_reply_to_id := null
          );

          v_result_json := v_result::jsonb;
          if v_result_json ? 'error' then
            v_error_detail :=
              coalesce(v_result_json ->> 'error', '') ||
              ' | HTTP ' || coalesce(v_result_json ->> 'status', '?') ||
              ' | ' || coalesce(v_result_json ->> 'body', '');

            update public.scheduled_messages
              set status = 'failed',
                  processed_at = now(),
                  error_message = left(v_error_detail, 1000),
                  updated_at = now()
            where id = v_record.id;
            v_failed := v_failed + 1;
            continue;
          end if;

          v_message_id := nullif(v_result_json #>> '{message,id}', '')::uuid;
          if v_message_id is not null then
            v_sent_message_ids := array_append(v_sent_message_ids, v_message_id);
          end if;
        end loop;
      else
        v_result := public.send_whatsapp_message(
          p_device_id := v_record.device_id,
          p_remote_sender := v_record.remote_sender,
          p_content := coalesce(v_record.content, ''),
          p_sender_id := v_record.user_id,
          p_media_url := null,
          p_media_type := null,
          p_media_name := null,
          p_reply_to_id := null
        );

        v_result_json := v_result::jsonb;
        if v_result_json ? 'error' then
          v_error_detail :=
            coalesce(v_result_json ->> 'error', '') ||
            ' | HTTP ' || coalesce(v_result_json ->> 'status', '?') ||
            ' | ' || coalesce(v_result_json ->> 'body', '');

          update public.scheduled_messages
            set status = 'failed',
                processed_at = now(),
                error_message = left(v_error_detail, 1000),
                updated_at = now()
          where id = v_record.id;
          v_failed := v_failed + 1;
          continue;
        end if;

        v_message_id := nullif(v_result_json #>> '{message,id}', '')::uuid;
        if v_message_id is not null then
          v_sent_message_ids := array_append(v_sent_message_ids, v_message_id);
        end if;
      end if;

      update public.scheduled_messages
        set status = 'sent',
            processed_at = now(),
            sent_message_ids = coalesce(v_sent_message_ids, '{}'::uuid[]),
            error_message = null,
            updated_at = now()
      where id = v_record.id;

      v_sent := v_sent + 1;
    exception when others then
      get stacked diagnostics v_error = message_text;

      update public.scheduled_messages
        set status = 'failed',
            processed_at = now(),
            error_message = left(coalesce(v_error, 'unexpected error'), 1000),
            updated_at = now()
      where id = v_record.id;

      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'sent', v_sent,
    'failed', v_failed
  );
end;
$$;
