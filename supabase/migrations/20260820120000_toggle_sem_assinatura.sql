-- ITEM 7: toggle "enviar sem assinatura" no compositor.
--
-- O PEDIDO: um jeito de mandar uma mensagem pontual sem a assinatura salva
-- (device.signature ou profiles.signature), sem mudar o comportamento padrão
-- de envio — que continua assinando, exatamente como hoje.
--
-- POR QUE NÃO REAPROVEITAR `p_forwarded`: é o único parâmetro que já pula a
-- assinatura (ver `v_text_content` mais abaixo), mas ele faz DUAS coisas ao
-- mesmo tempo — também grava `is_forwarded = true`, que pinta o balão como
-- "Encaminhada" no WhatsApp de quem recebe. Uma mensagem digitada na hora,
-- sem assinatura, não foi encaminhada de lugar nenhum; usar `p_forwarded`
-- para isso mentiria na conversa do cliente.
--
-- A SAÍDA: `p_sem_assinatura boolean DEFAULT false`, parâmetro novo e
-- dedicado, isolado de `p_forwarded`. Só entra na conta de qual texto vai
-- para a Evolution (`v_text_content`); não toca a coluna `is_forwarded` da
-- inserção, que continua controlada só por `p_forwarded`.
--
-- COMPATIBILIDADE: parâmetro acrescentado no FIM da lista, com DEFAULT false
-- — quem chama a função hoje (edge functions, chamadas antigas em cache do
-- PostgREST, qualquer client que não conhece o parâmetro novo) continua
-- funcionando sem alteração, e continua recebendo assinatura como sempre.
-- Só quem passar `p_sem_assinatura => true` explicitamente muda de
-- comportamento. CREATE OR REPLACE preserva a assinatura da função (mesmo
-- nome + mesmos parâmetros anteriores, na mesma ordem) — não há risco do
-- PostgREST enxergar duas versões e recusar a escolha da função certa, o
-- mesmo cuidado já registrado em 20260731150000_retry_dns_envio.sql.
--
-- ESCOPO DA PREFERÊNCIA (decidido no lado do cliente, não aqui): por
-- CONVERSA, e não persistida. O toggle nasce desligado (assinatura ligada,
-- igual hoje) e volta a desligar sozinho ao trocar de conversa — não existe
-- coluna nova em `profiles`/`devices` para isso porque não há nada para
-- lembrar entre sessões: é uma escolha do momento do envio, não uma
-- preferência duradoura. Ver ChatWindow.tsx (estado `semAssinatura`).

CREATE OR REPLACE FUNCTION public.send_whatsapp_message(p_device_id uuid, p_remote_sender text, p_content text DEFAULT ''::text, p_sender_id uuid DEFAULT NULL::uuid, p_media_url text DEFAULT NULL::text, p_media_type text DEFAULT NULL::text, p_media_name text DEFAULT NULL::text, p_reply_to_id uuid DEFAULT NULL::uuid, p_mentioned jsonb DEFAULT NULL::jsonb, p_mention_everyone boolean DEFAULT false, p_forwarded boolean DEFAULT false, p_sem_assinatura boolean DEFAULT false)
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
  v_tentativa integer;
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

    -- NOVA TENTATIVA quando a CONSULTA DE ENDEREÇO se perde.
    --
    -- ~8% dos envios falhavam com "Resolving timed out after 1000 milliseconds":
    -- o banco fala com a Evolution por um endereço PÚBLICO e precisa resolvê-lo a
    -- cada envio; a consulta vai por UDP e, quando o pacote se perde, ninguém
    -- tentava de novo. Eram 9 eventos isolados em 24h, mais frequentes nas horas
    -- PARADAS (29% às 11h contra 4,5% na hora de pico), quando o endereço já saiu
    -- do cache de 60s e precisa ser perguntado do zero.
    --
    -- DUAS tentativas, não três: esta função é executável pelo papel anon, que
    -- tem statement_timeout de 3s. Duas dão no máximo ~2,2s e cabem com folga;
    -- três passariam de 3s e o Postgres mataria o envio — trocaria um erro por
    -- outro.
    v_tentativa := 0;
    LOOP
      v_tentativa := v_tentativa + 1;
      BEGIN
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
        EXIT;
      EXCEPTION WHEN OTHERS THEN
        -- SÓ falha de RESOLUÇÃO pode ser repetida: é o único caso em que existe
        -- garantia de que a requisição NÃO saiu. O bloco EXCEPTION desfaz a
        -- subtransação, mas NÃO desfaz uma chamada HTTP que já partiu — repetir
        -- uma falha posterior mandaria a mesma mensagem DUAS VEZES para a
        -- paciente. Qualquer outro erro é re-lançado e se comporta como antes.
        IF SQLERRM NOT LIKE '%Resolving timed out%'
           AND SQLERRM NOT LIKE '%Could not resolve host%' THEN
          RAISE;
        END IF;
        IF v_tentativa >= 2 THEN
          RETURN json_build_object(
            'error',
            'Não foi possível falar com o WhatsApp agora. A mensagem NÃO foi enviada — tente novamente.'
          );
        END IF;
        PERFORM pg_sleep(0.15);
      END;
    END LOOP;

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
    -- ITEM 7: `p_sem_assinatura` suprime a assinatura sem marcar a mensagem
    -- como encaminhada — ao contrário de `p_forwarded`, que faz as duas
    -- coisas. `p_forwarded` continua no `OR` porque encaminhamento nunca
    -- levou assinatura (comportamento pré-existente, inalterado).
    IF v_signature IS NOT NULL AND v_signature != '' AND NOT p_forwarded AND NOT p_sem_assinatura THEN
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

    -- NOVA TENTATIVA quando a CONSULTA DE ENDEREÇO se perde.
    --
    -- ~8% dos envios falhavam com "Resolving timed out after 1000 milliseconds":
    -- o banco fala com a Evolution por um endereço PÚBLICO e precisa resolvê-lo a
    -- cada envio; a consulta vai por UDP e, quando o pacote se perde, ninguém
    -- tentava de novo. Eram 9 eventos isolados em 24h, mais frequentes nas horas
    -- PARADAS (29% às 11h contra 4,5% na hora de pico), quando o endereço já saiu
    -- do cache de 60s e precisa ser perguntado do zero.
    --
    -- DUAS tentativas, não três: esta função é executável pelo papel anon, que
    -- tem statement_timeout de 3s. Duas dão no máximo ~2,2s e cabem com folga;
    -- três passariam de 3s e o Postgres mataria o envio — trocaria um erro por
    -- outro.
    v_tentativa := 0;
    LOOP
      v_tentativa := v_tentativa + 1;
      BEGIN
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
        EXIT;
      EXCEPTION WHEN OTHERS THEN
        -- SÓ falha de RESOLUÇÃO pode ser repetida: é o único caso em que existe
        -- garantia de que a requisição NÃO saiu. O bloco EXCEPTION desfaz a
        -- subtransação, mas NÃO desfaz uma chamada HTTP que já partiu — repetir
        -- uma falha posterior mandaria a mesma mensagem DUAS VEZES para a
        -- paciente. Qualquer outro erro é re-lançado e se comporta como antes.
        IF SQLERRM NOT LIKE '%Resolving timed out%'
           AND SQLERRM NOT LIKE '%Could not resolve host%' THEN
          RAISE;
        END IF;
        IF v_tentativa >= 2 THEN
          RETURN json_build_object(
            'error',
            'Não foi possível falar com o WhatsApp agora. A mensagem NÃO foi enviada — tente novamente.'
          );
        END IF;
        PERFORM pg_sleep(0.15);
      END;
    END LOOP;

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
