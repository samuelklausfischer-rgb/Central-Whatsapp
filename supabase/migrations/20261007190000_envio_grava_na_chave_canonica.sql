-- ============================================================================
-- Envio grava a mensagem na chave CANÔNICA do WhatsApp (nono dígito)
-- ============================================================================
--
-- Incidente 07/10/2026: Ketlin (Financeiro PRN) abriu conversa nova digitando
-- 5532 9 99422738. A Evolution entregou para o JID real, 553299422738 (sem o 9),
-- mas `send_whatsapp_message` gravou a linha com o número DIGITADO. A resposta da
-- contato chegou pelo webhook na chave real e abriu uma SEGUNDA conversa — a que
-- ficou na tela, só com a resposta. "Minha mensagem sumiu."
--
-- Não foi caso isolado: 22 conversas rachadas assim em 4 aparelhos, de nov/2025
-- até hoje. A auto-cura do webhook (20260813120000, `curarChave`) nunca as pegou:
-- ela espera o eco da mensagem enviada como MESSAGES_UPSERT, mas mensagem enviada
-- pela API dispara SEND_MESSAGE (não assinado), e o MESSAGES_UPDATE da v2.3.7 vem
-- plano (`keyId`, sem `key.id`) e é descartado como "update for unknown message".
--
-- A correção vai na ORIGEM: a resposta do envio já traz o JID canônico em
-- `key.remoteJid`. A RPC passa a gravar nele (só quando a diferença é exatamente
-- o nono dígito) e move a conversa digitada para lá na mesma transação.
--
-- Corpo de `send_whatsapp_message` partiu de 20261007150000, conferido por md5
-- contra produção (7ecce6ef45443e5fe6fe527d3744688f) antes da edição.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.chave_canonica_do_envio(p_digitada text, p_resposta jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_jid  text;
  v_resp text;
  v_com9 text;
  v_sem9 text;
begin
  if p_digitada is null or p_resposta is null or jsonb_typeof(p_resposta) <> 'object' then
    return p_digitada;
  end if;

  v_jid := p_resposta -> 'key' ->> 'remoteJid';
  -- Só JID de telefone. Grupo (@g.us) e LID (@lid) nunca trocam a chave.
  if v_jid is null or v_jid not like '%@s.whatsapp.net' then
    return p_digitada;
  end if;

  v_resp := split_part(v_jid, '@', 1);
  if v_resp = p_digitada then
    return p_digitada;
  end if;

  if length(p_digitada) = 13 then
    v_com9 := p_digitada; v_sem9 := v_resp;
  else
    v_com9 := v_resp; v_sem9 := p_digitada;
  end if;

  -- Mesma regra de `mover_conversa_para_jid_canonico` e de `soDifereNoNonoDigito`
  -- no webhook: mesmo DDD, mesmos 8 finais, só o 9 a mais ou a menos. Qualquer
  -- outra divergência mantém o número digitado, como sempre foi.
  if v_com9 ~ '^55[0-9]{2}9[0-9]{8}$'
     and v_sem9 ~ '^55[0-9]{10}$'
     and substr(v_com9, 1, 4) = substr(v_sem9, 1, 4)
     and substr(v_com9, 6) = substr(v_sem9, 5) then
    return v_resp;
  end if;

  return p_digitada;
end;
$function$;

REVOKE ALL ON FUNCTION private.chave_canonica_do_envio(text, jsonb) FROM public;
REVOKE ALL ON FUNCTION private.chave_canonica_do_envio(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION private.chave_canonica_do_envio(text, jsonb) FROM authenticated;

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
  v_chave text;
  v_conversa_movida json;
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
      -- Citacao SO quando existe id da Evolution para apontar. Com id vazio
      -- o WhatsApp desenha um balao de citacao quebrado no celular de quem
      -- recebe. Sem citacao e melhor que citacao corrompida; o balao daqui nao
      -- muda, porque quem o desenha e o v_reply_snapshot montado abaixo.
      IF v_reply_msg.external_id IS NOT NULL AND v_reply_msg.external_id <> '' THEN
        v_quoted := jsonb_build_object(
          'key',
            jsonb_build_object(
              'remoteJid', v_remote_jid_full,
              'fromMe', CASE WHEN v_reply_msg.direction = 'outbound' THEN true ELSE false END,
              'id', v_reply_msg.external_id
            )
            -- Em grupo o remoteJid e o do GRUPO, entao o autor da mensagem
            -- citada so se identifica por participant.
            || CASE
                 WHEN p_remote_sender LIKE '%@g.us'
                  AND v_reply_msg.group_participant IS NOT NULL
                  AND v_reply_msg.group_participant <> ''
                 THEN jsonb_build_object(
                        'participant',
                        CASE WHEN v_reply_msg.group_participant LIKE '%@%'
                             THEN v_reply_msg.group_participant
                             ELSE v_reply_msg.group_participant || '@s.whatsapp.net'
                        END)
                 ELSE '{}'::jsonb
               END,
          'message', jsonb_build_object(
            'conversation', COALESCE(v_reply_msg.content, '')
          )
        );
      END IF;
      v_reply_snapshot := jsonb_build_object(
        'content', COALESCE(v_reply_msg.content, ''),
        'sender_name', COALESCE(v_reply_msg.sender_name, ''),
        'id', v_reply_msg.id
      );
    END IF;
  END IF;

  v_is_media := p_media_url IS NOT NULL AND p_media_url != '';

  IF v_is_media THEN
    IF p_content IS NOT NULL AND p_content != '' AND p_content NOT IN ('[Áudio]', '[Anexo]', '[Imagem]', '[Vídeo]', U&'[V\00C3\00ADdeo]', '[Documento]', '[Mídia]') THEN
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

    -- CHAVE CANÔNICA DA CONVERSA (nono dígito).
    --
    -- O número que o atendente DIGITOU nem sempre é o JID do WhatsApp: para muitos
    -- celulares o canônico tem 12 dígitos, sem o 9. A Evolution resolve sozinha e
    -- entrega, mas a linha era gravada com o número digitado — e quando o contato
    -- respondia, o webhook abria a conversa DE VERDADE e a mensagem enviada
    -- "sumia" (07/10/2026: 22 conversas rachadas). A auto-cura do webhook nunca
    -- disparava: mensagem enviada pela API não volta como MESSAGES_UPSERT.
    --
    -- A resposta do envio já traz o JID canônico em key.remoteJid. Só é adotado
    -- quando a diferença é EXATAMENTE o nono dígito (ver a função auxiliar).
    --
    -- O mover roda num sub-bloco: a mensagem JÁ SAIU, e um erro aqui não pode
    -- desfazer o registro dela. Se mover falhar, a linha ainda vai para a chave
    -- canônica — que é onde o contato vai responder.
    v_chave := private.chave_canonica_do_envio(v_normalized, v_resp_json);
    IF v_chave <> v_normalized THEN
      BEGIN
        v_conversa_movida := public.mover_conversa_para_jid_canonico(p_device_id, v_normalized, v_chave);
      EXCEPTION WHEN OTHERS THEN
        v_conversa_movida := json_build_object('error', SQLERRM);
      END;
    END IF;

    INSERT INTO messages (content, device_id, remote_sender, sender_id, direction, is_read, origin, attachments, external_id, reactions, reply_to_id, reply_to_snapshot, is_forwarded)
    VALUES (
      COALESCE(p_content, '[Mídia]'),
      p_device_id,
      v_chave,
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

    RETURN json_build_object('status', 'sent', 'message', row_to_json(v_message), 'conversa_movida', v_conversa_movida);
  ELSE
    IF v_signature IS NOT NULL AND v_signature != '' AND NOT p_forwarded AND NOT p_sem_assinatura THEN
      v_text_content := v_signature || E'\n\n' || p_content;
    ELSE
      v_text_content := p_content;
    END IF;

    -- SEM PRÉVIA DE LINK. Sem `linkPreview: false` a Evolution abre o link para
    -- montar o cartão de prévia ANTES de enviar. Em 07/10/2026 o link era o ZIP
    -- de um exame (~60 MB): a chamada passou dos 5s, o app disse que falhou e a
    -- mensagem saiu assim mesmo.
    v_payload := jsonb_build_object('number', v_normalized, 'text', v_text_content, 'linkPreview', false);

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

    -- CHAVE CANÔNICA DA CONVERSA (nono dígito).
    --
    -- O número que o atendente DIGITOU nem sempre é o JID do WhatsApp: para muitos
    -- celulares o canônico tem 12 dígitos, sem o 9. A Evolution resolve sozinha e
    -- entrega, mas a linha era gravada com o número digitado — e quando o contato
    -- respondia, o webhook abria a conversa DE VERDADE e a mensagem enviada
    -- "sumia" (07/10/2026: 22 conversas rachadas). A auto-cura do webhook nunca
    -- disparava: mensagem enviada pela API não volta como MESSAGES_UPSERT.
    --
    -- A resposta do envio já traz o JID canônico em key.remoteJid. Só é adotado
    -- quando a diferença é EXATAMENTE o nono dígito (ver a função auxiliar).
    --
    -- O mover roda num sub-bloco: a mensagem JÁ SAIU, e um erro aqui não pode
    -- desfazer o registro dela. Se mover falhar, a linha ainda vai para a chave
    -- canônica — que é onde o contato vai responder.
    v_chave := private.chave_canonica_do_envio(v_normalized, v_resp_json);
    IF v_chave <> v_normalized THEN
      BEGIN
        v_conversa_movida := public.mover_conversa_para_jid_canonico(p_device_id, v_normalized, v_chave);
      EXCEPTION WHEN OTHERS THEN
        v_conversa_movida := json_build_object('error', SQLERRM);
      END;
    END IF;

    INSERT INTO messages (content, device_id, remote_sender, sender_id, direction, is_read, origin, external_id, reactions, reply_to_id, reply_to_snapshot, is_forwarded)
    VALUES (v_text_content, p_device_id, v_chave, p_sender_id, 'outbound', true, 'app', v_external_id, '[]'::jsonb, p_reply_to_id, v_reply_snapshot, p_forwarded)
    RETURNING * INTO v_message;

    RETURN json_build_object('status', 'sent', 'message', row_to_json(v_message), 'conversa_movida', v_conversa_movida);
  END IF;
END;
$function$;
