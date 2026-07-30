-- Encaminhar: a mensagem sai sem a assinatura do atendente e nasce marcada.
--
-- JA APLICADO EM PRODUCAO em 2026-07-30 (por psql, como todo o DDL recente deste
-- projeto). Este arquivo existe para o repo REGISTRAR o que esta no banco — o
-- diretorio `supabase/migrations/` aqui e um conjunto de patches sobre um schema
-- criado fora dele, nao um caminho de provisionamento: nenhum arquivo cria as
-- tabelas base.
--
-- A funcao inteira e reescrita porque `CREATE OR REPLACE` exige o corpo completo.
-- O unico ponto alterado no corpo e a condicao da assinatura, que ganhou
-- `AND NOT p_forwarded`, mais a coluna `is_forwarded` nos dois INSERTs.
--
-- ATENCAO: o `DROP` da sobrecarga de 10 parametros TEM que ficar na MESMA
-- transacao do `CREATE`. Com as duas vivas ao mesmo tempo o PostgREST responde
-- "Could not choose the best candidate function" para TODO envio da clinica.

alter table public.messages
  add column if not exists is_forwarded boolean not null default false;

comment on column public.messages.is_forwarded is
  'Mensagem encaminhada, como o WhatsApp. Preenchida por send_whatsapp_message (encaminhar pelo app) e pelo webhook (contextInfo.isForwarded do que chega).';

BEGIN;
CREATE OR REPLACE FUNCTION public.send_whatsapp_message(p_device_id uuid, p_remote_sender text, p_content text DEFAULT ''::text, p_sender_id uuid DEFAULT NULL::uuid, p_media_url text DEFAULT NULL::text, p_media_type text DEFAULT NULL::text, p_media_name text DEFAULT NULL::text, p_reply_to_id uuid DEFAULT NULL::uuid, p_mentioned jsonb DEFAULT NULL::jsonb, p_mention_everyone boolean DEFAULT false, p_forwarded boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_instance_key text;
  v_signature text;
  v_secret_key text;
  v_secret_url text;
  v_normalized text;
  v_text_content text;
  v_body text;
  v_req_url text;
  v_resp http_response;
  v_message messages;
  v_endpoint text;
  v_is_media boolean;
  v_payload jsonb;
  v_caption text;
  v_safe_instance text;
  v_external_id text;
  v_resp_json jsonb;
  v_reply_msg messages;
  v_quoted jsonb;
  v_reply_snapshot jsonb;
  v_remote_jid_full text;
  v_mencoes jsonb := '{}'::jsonb;
  v_lista jsonb := '[]'::jsonb;
  v_item text;
BEGIN
  SELECT instance_key, signature INTO v_instance_key, v_signature
  FROM devices WHERE id = p_device_id;
  IF v_instance_key IS NULL THEN
    RETURN json_build_object('error', 'device not found');
  END IF;

  v_safe_instance := replace(v_instance_key, ' ', '%20');

  IF (v_signature IS NULL OR v_signature = '') AND p_sender_id IS NOT NULL THEN
    SELECT signature INTO v_signature FROM profiles WHERE id = p_sender_id;
  END IF;

  SELECT value INTO v_secret_key FROM secrets WHERE key = 'EVOLUTION_API_KEY';
  SELECT value INTO v_secret_url FROM secrets WHERE key = 'EVOLUTION_API_URL';
  IF v_secret_url IS NULL THEN
    v_secret_url := 'http://apps-evolution-api.srofjl.easypanel.host';
  END IF;
  v_secret_url := rtrim(v_secret_url, '/');

  IF v_secret_key IS NULL THEN
    RETURN json_build_object('error', 'missing EVOLUTION_API_KEY');
  END IF;

  IF p_remote_sender LIKE '%@g.us' THEN
    v_normalized := p_remote_sender;
  ELSE
    v_normalized := regexp_replace(
      regexp_replace(p_remote_sender, '@s\.whatsapp\.net|@lid', '', 'g'),
      '\D', '', 'g'
    );
  END IF;

  IF p_remote_sender LIKE '%@g.us' THEN
    v_remote_jid_full := p_remote_sender;
  ELSE
    v_remote_jid_full := v_normalized || '@s.whatsapp.net';
  END IF;

  -- Menções. O cliente manda dígitos ou JID; aqui vira sempre JID completo, que
  -- é o formato que o WhatsApp espera no array.
  IF p_mention_everyone THEN
    v_mencoes := jsonb_build_object('mentionsEveryOne', true);
  ELSIF p_mentioned IS NOT NULL AND jsonb_typeof(p_mentioned) = 'array'
        AND jsonb_array_length(p_mentioned) > 0 THEN
    FOR v_item IN SELECT jsonb_array_elements_text(p_mentioned) LOOP
      IF v_item IS NULL OR v_item = '' THEN
        CONTINUE;
      END IF;
      IF position('@' in v_item) > 0 THEN
        v_lista := v_lista || jsonb_build_array(v_item);
      ELSE
        v_lista := v_lista || jsonb_build_array(regexp_replace(v_item, '\D', '', 'g') || '@s.whatsapp.net');
      END IF;
    END LOOP;
    IF jsonb_array_length(v_lista) > 0 THEN
      v_mencoes := jsonb_build_object('mentioned', v_lista);
    END IF;
  END IF;

  IF p_reply_to_id IS NOT NULL THEN
    SELECT * INTO v_reply_msg FROM messages WHERE id = p_reply_to_id;
    IF v_reply_msg.id IS NOT NULL THEN
      v_quoted := jsonb_build_object(
        'key', jsonb_build_object(
          'remoteJid', v_remote_jid_full,
          'fromMe', CASE WHEN v_reply_msg.direction = 'outbound' THEN true ELSE false END,
          'id', COALESCE(v_reply_msg.external_id, '')
        ),
        'message', jsonb_build_object(
          'conversation', COALESCE(v_reply_msg.content, '')
        )
      );
      v_reply_snapshot := jsonb_build_object(
        'content', COALESCE(v_reply_msg.content, ''),
        'sender_name', COALESCE(v_reply_msg.sender_name, ''),
        'id', v_reply_msg.id
      );
    END IF;
  END IF;

  v_is_media := p_media_url IS NOT NULL AND p_media_url != '';

  IF v_is_media THEN
    IF p_content IS NOT NULL AND p_content != '' AND p_content NOT IN ('[Áudio]', '[Anexo]', '[Imagem]', '[Vídeo]', '[VÃ­deo]', '[Documento]', '[Mídia]') THEN
      v_caption := p_content;
    ELSE
      v_caption := '';
    END IF;

    IF p_media_type IN ('image', 'video', 'document') THEN
      v_endpoint := '/message/sendMedia/' || v_safe_instance;
      v_payload := jsonb_build_object(
        'number', v_normalized,
        'mediatype', p_media_type,
        'media', p_media_url
      );
      IF v_caption != '' THEN
        v_payload := v_payload || jsonb_build_object('caption', v_caption);
      END IF;
      IF p_media_name IS NOT NULL AND p_media_name != '' THEN
        v_payload := v_payload || jsonb_build_object('fileName', p_media_name);
        v_payload := v_payload || jsonb_build_object('mimetype', 'application/octet-stream');
      END IF;
    ELSIF p_media_type = 'audio' THEN
      v_endpoint := '/message/sendWhatsAppAudio/' || v_safe_instance;
      v_payload := jsonb_build_object(
        'number', v_normalized,
        'audio', p_media_url
      );
    ELSE
      v_endpoint := '/message/sendWhatsAppAudio/' || v_safe_instance;
      v_payload := jsonb_build_object(
        'number', v_normalized,
        'audio', p_media_url
      );
    END IF;

    IF v_quoted IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object('quoted', v_quoted);
    END IF;
    v_payload := v_payload || v_mencoes;

    v_req_url := v_secret_url || v_endpoint;
    v_body := v_payload::text;

    v_resp := http(ROW(
      'POST'::http_method,
      v_req_url,
      ARRAY[
        ROW('Content-Type', 'application/json')::http_header,
        ROW('apikey', v_secret_key)::http_header
      ],
      'application/json',
      v_body
    )::http_request);

    IF v_resp.status NOT IN (200, 201) THEN
      RETURN json_build_object('error', 'Evolution API error', 'status', v_resp.status, 'body', v_resp.content);
    END IF;

    v_external_id := NULL;
    BEGIN
      v_resp_json := v_resp.content::jsonb;
      v_external_id := v_resp_json -> 'key' ->> 'id';
    EXCEPTION WHEN OTHERS THEN
      v_external_id := NULL;
    END;

    INSERT INTO messages (content, device_id, remote_sender, sender_id, direction, is_read, origin, attachments, external_id, reactions, reply_to_id, reply_to_snapshot, is_forwarded)
    VALUES (
      COALESCE(p_content, '[Mídia]'),
      p_device_id,
      v_normalized,
      p_sender_id,
      'outbound',
      true,
      'app',
      jsonb_build_array(jsonb_build_object(
        'url', p_media_url,
        'type', COALESCE(p_media_type, 'unknown'),
        'name', COALESCE(p_media_name, 'media_file')
      )),
      v_external_id,
      '[]'::jsonb,
      p_reply_to_id,
      v_reply_snapshot,
      p_forwarded
    )
    RETURNING * INTO v_message;

    RETURN json_build_object('status', 'sent', 'message', row_to_json(v_message));
  ELSE
    IF v_signature IS NOT NULL AND v_signature != '' AND NOT p_forwarded THEN
      v_text_content := v_signature || E'\n\n' || p_content;
    ELSE
      v_text_content := p_content;
    END IF;

    v_payload := jsonb_build_object('number', v_normalized, 'text', v_text_content);

    IF v_quoted IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object('quoted', v_quoted);
    END IF;
    v_payload := v_payload || v_mencoes;

    v_body := v_payload::text;
    v_req_url := v_secret_url || '/message/sendText/' || v_safe_instance;

    v_resp := http(ROW(
      'POST'::http_method,
      v_req_url,
      ARRAY[
        ROW('Content-Type', 'application/json')::http_header,
        ROW('apikey', v_secret_key)::http_header
      ],
      'application/json',
      v_body
    )::http_request);

    IF v_resp.status NOT IN (200, 201) THEN
      RETURN json_build_object('error', 'Evolution API error', 'status', v_resp.status, 'body', v_resp.content);
    END IF;

    v_external_id := NULL;
    BEGIN
      v_resp_json := v_resp.content::jsonb;
      v_external_id := v_resp_json -> 'key' ->> 'id';
    EXCEPTION WHEN OTHERS THEN
      v_external_id := NULL;
    END;

    INSERT INTO messages (content, device_id, remote_sender, sender_id, direction, is_read, origin, external_id, reactions, reply_to_id, reply_to_snapshot, is_forwarded)
    VALUES (v_text_content, p_device_id, v_normalized, p_sender_id, 'outbound', true, 'app', v_external_id, '[]'::jsonb, p_reply_to_id, v_reply_snapshot, p_forwarded)
    RETURNING * INTO v_message;

    RETURN json_build_object('status', 'sent', 'message', row_to_json(v_message));
  END IF;
END;
$function$
;
-- Derruba a sobrecarga de 10 parametros. Tem que ser na MESMA transacao do
-- CREATE: com as duas vivas ao mesmo tempo o PostgREST responde
-- "Could not choose the best candidate function" para todo envio.
DROP FUNCTION public.send_whatsapp_message(uuid,text,text,uuid,text,text,text,uuid,jsonb,boolean);
-- ACL identica a de antes (5 papeis), incluindo anon, que a funcao ja tinha.
REVOKE EXECUTE ON FUNCTION public.send_whatsapp_message(uuid,text,text,uuid,text,text,text,uuid,jsonb,boolean,boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.send_whatsapp_message(uuid,text,text,uuid,text,text,text,uuid,jsonb,boolean,boolean) TO postgres, anon, authenticated, service_role;
COMMIT;