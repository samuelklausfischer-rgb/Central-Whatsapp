-- ENVIO QUE DEMORA NÃO É ENVIO QUE FALHOU
--
-- Em 07/10/2026 um texto com o link do ZIP de um exame (mobilemed, ~60 MB, o
-- servidor ignora Range) voltou para o atendente como
-- "Operation timed out after 5001 milliseconds with 0 bytes received" — e a
-- mensagem CHEGOU na paciente 5,3s depois do clique. A tentativa ficou como
-- `falhou`, sem linha em `messages`; quem clicasse em "Tentar de novo"
-- mandaria duas vezes (o mesmo link já tinha ido duas vezes, em 02/10 e hoje).
--
-- Duas partes:
--
-- 1. `send_whatsapp_message`: texto vai com `linkPreview: false`. Sem isso a
--    Evolution (2.3.7 / Baileys 7.0.0-rc.9) abre o link para montar o cartão de
--    prévia ANTES de enviar, e qualquer link lento estoura os 5s da extensão
--    `http`. Só o ramo de texto muda; o corpo é o de produção, transcrito e
--    conferido por md5 do `prosrc` (sem o trecho novo, bate com o anterior).
--    Única troca de escrita: o placeholder corrompido de vídeo (Ã + hífen
--    invisível U+00AD) virou `U&'[V\00C3\00ADdeo]'` — mesmo valor, mas sem um
--    caractere que não aparece na tela e se perde ao copiar.
--
-- 2. `private.verificar_tentativas_de_envio`: quando quem acha a mensagem é a
--    Evolution (estágio 2), a RPC morreu antes do INSERT, então a mensagem
--    saiu e não existe no histórico. O verificador passa a gravá-la em
--    `messages`, com o horário real do WhatsApp. O cliente, por sua vez, deixa
--    a tentativa `pendente` (e não `falhou`) quando o erro é de tempo esgotado —
--    é isso que põe o verificador para trabalhar nesse caso.

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

    INSERT INTO messages (content, device_id, remote_sender, sender_id, direction, is_read, origin, external_id, reactions, reply_to_id, reply_to_snapshot, is_forwarded)
    VALUES (v_text_content, p_device_id, v_normalized, p_sender_id, 'outbound', true, 'app', v_external_id, '[]'::jsonb, p_reply_to_id, v_reply_snapshot, p_forwarded)
    RETURNING * INTO v_message;

    RETURN json_build_object('status', 'sent', 'message', row_to_json(v_message));
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.verificar_tentativas_de_envio(p_limite integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_t          record;
  v_url        text;
  v_key        text;
  v_inst       text;
  v_jid        text;
  v_resp       extensions.http_response;
  v_rec        jsonb;
  v_texto      text;
  v_quando     timestamptz;
  v_ext        text;
  v_achou      boolean;
  v_respondeu  boolean;
  v_resolvidas int := 0;
begin
  select value into v_key from public.secrets where key = 'EVOLUTION_API_KEY';
  select value into v_url from public.secrets where key = 'EVOLUTION_API_URL';
  v_url := rtrim(coalesce(v_url, 'http://apps-evolution-api.srofjl.easypanel.host'), '/');

  if v_key is null then
    raise warning '[verificador] sem EVOLUTION_API_KEY -- nada a fazer';
    return 0;
  end if;

  -- Sem teto de tempo, uma Evolution lenta seguraria o cron inteiro.
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '10');

  for v_t in
    select t.*
    from public.tentativas_de_envio t
    where t.status = 'pendente'
      -- 2 minutos de carencia: o teto de uma chamada de envio e 8s
      -- (statement_timeout), entao nada legitimo fica pendente tanto tempo.
      and t.created_at < now() - interval '2 minutes'
    order by t.created_at
    limit p_limite
    for update skip locked
  loop
    v_achou     := false;
    v_respondeu := false;
    v_ext       := null;
    v_texto     := null;
    v_quando    := null;

    -- ESTAGIO 1: a mensagem real ja esta em `messages`?
    -- Cobre o caso comum de graca: a RPC deu certo e o navegador morreu antes de
    -- apagar a tentativa. `strpos` e nao `like` porque o conteudo pode conter %
    -- ou _, e a assinatura do atendente vem PREPENDADA ao texto.
    select m.external_id into v_ext
    from public.messages m
    where m.device_id     = v_t.device_id
      and m.remote_sender = v_t.remote_sender
      and m.direction     = 'outbound'
      and m.deleted_at is null
      and m.created_at between v_t.created_at - interval '1 minute'
                           and v_t.created_at + interval '10 minutes'
      and (v_t.conteudo = '' or strpos(m.content, v_t.conteudo) > 0)
    order by m.created_at
    limit 1;

    if v_ext is not null then
      v_achou := true;
    else
      -- ESTAGIO 2: perguntar a Evolution. E a unica fonte de verdade para o caso
      -- ruim: a RPC estourou os 8s DEPOIS de a Evolution ja ter aceitado a
      -- mensagem, entao a transacao foi desfeita mas o WhatsApp entregou.
      select instance_key into v_inst from public.devices where id = v_t.device_id;

      if v_inst is not null then
        v_jid := case
                   when v_t.remote_sender like '%@%' then v_t.remote_sender
                   else regexp_replace(v_t.remote_sender, '\D', '', 'g') || '@s.whatsapp.net'
                 end;

        begin
          select * into v_resp from extensions.http((
            'POST',
            v_url || '/chat/findMessages/' || replace(v_inst, ' ', '%20'),
            array[extensions.http_header('apikey', v_key)],
            'application/json',
            json_build_object(
              'where', json_build_object('key', json_build_object('remoteJid', v_jid)),
              'limit', 30
            )::text
          )::extensions.http_request);
          v_respondeu := (v_resp.status = 200);
        exception when others then
          -- Evolution fora do ar NAO e prova de que a mensagem falhou. Deixa
          -- pendente e tenta na proxima rodada.
          raise warning '[verificador] Evolution nao respondeu para %: %', v_t.id, sqlerrm;
          v_respondeu := false;
        end;

        if v_respondeu then
          for v_rec in
            select jsonb_array_elements(v_resp.content::jsonb -> 'messages' -> 'records')
          loop
            continue when coalesce(v_rec -> 'key' ->> 'fromMe', 'false') <> 'true';

            v_quando := to_timestamp((v_rec ->> 'messageTimestamp')::bigint);
            continue when v_quando < v_t.created_at - interval '1 minute'
                       or v_quando > v_t.created_at + interval '10 minutes';

            v_texto := coalesce(
              v_rec -> 'message' ->> 'conversation',
              v_rec -> 'message' -> 'extendedTextMessage' ->> 'text',
              v_rec -> 'message' -> 'imageMessage'    ->> 'caption',
              v_rec -> 'message' -> 'videoMessage'    ->> 'caption',
              v_rec -> 'message' -> 'documentMessage' ->> 'caption',
              ''
            );

            -- Conteudo vazio (midia sem legenda) so casa por remetente e janela
            -- de tempo. E heuristica; o lado seguro esta na decisao de nunca
            -- reenviar sozinho.
            if v_t.conteudo = '' or strpos(v_texto, v_t.conteudo) > 0 then
              v_achou := true;
              v_ext   := v_rec -> 'key' ->> 'id';
              exit;
            end if;
          end loop;
        end if;
      end if;
    end if;

    if v_achou then
      -- SAIU, MAS NAO ESTA NO HISTORICO. Quando quem achou foi a Evolution
      -- (estagio 2), a RPC morreu antes do INSERT: a mensagem chegou na
      -- paciente e nao existe em `messages`, entao some da conversa. Grava aqui,
      -- com o horario real do WhatsApp. O texto vem da Evolution porque e o que
      -- saiu de fato (ja com a assinatura); midia segue o formato da RPC. O
      -- `not exists` deixa o estagio 1 de fora (a linha ja existe) e cobre duas
      -- tentativas casando com a mesma mensagem. Falhar aqui NAO impede marcar
      -- a tentativa -- perde-se so o historico, como era antes.
      if v_ext is not null and v_quando is not null
         and not exists (select 1 from public.messages m
                         where m.device_id = v_t.device_id and m.external_id = v_ext) then
        begin
          insert into public.messages (content, device_id, remote_sender, sender_id, direction,
                                       is_read, origin, attachments, external_id, reactions,
                                       reply_to_id, is_forwarded, created_at)
          values (
            case when v_t.anexos is not null
                 then coalesce(nullif(v_t.conteudo, ''), '[Mídia]')
                 else coalesce(nullif(v_texto, ''), v_t.conteudo)
            end,
            v_t.device_id,
            case when v_t.remote_sender like '%@g.us' then v_t.remote_sender
                 else regexp_replace(
                        regexp_replace(v_t.remote_sender, '@s\.whatsapp\.net|@lid', '', 'g'),
                        '\D', '', 'g')
            end,
            v_t.sender_id,
            'outbound',
            true,
            'app',
            case when v_t.anexos is not null then jsonb_build_array(jsonb_build_object(
                   'url',  v_t.anexos ->> 'mediaUrl',
                   'type', coalesce(v_t.anexos ->> 'mediaType', 'unknown'),
                   'name', coalesce(v_t.anexos ->> 'mediaName', 'media_file')))
            end,
            v_ext,
            '[]'::jsonb,
            v_t.reply_to_id,
            v_t.tipo = 'encaminhada',
            v_quando
          );
        exception when others then
          raise warning '[verificador] % saiu mas nao entrou no historico: %', v_t.id, sqlerrm;
        end;
      end if;

      update public.tentativas_de_envio
      set status = 'enviada', external_id = coalesce(v_ext, external_id),
          erro = null, verificado_em = now()
      where id = v_t.id;
      v_resolvidas := v_resolvidas + 1;

    elsif v_respondeu then
      -- A Evolution respondeu e a mensagem NAO esta la. Agora da para concluir.
      update public.tentativas_de_envio
      set status = 'falhou', verificado_em = now(),
          erro = coalesce(erro, 'A Evolution nao encontrou esta mensagem: ela nao saiu.')
      where id = v_t.id;
      v_resolvidas := v_resolvidas + 1;

    elsif v_t.created_at < now() - interval '1 hour' then
      -- Uma hora sem conseguir perguntar. Marca como falha para nao ficar
      -- "enviando" para sempre, e diz na mensagem que nao houve confirmacao --
      -- o reenvio e humano, e quem for clicar precisa saber disso.
      update public.tentativas_de_envio
      set status = 'falhou', verificado_em = now(),
          erro = coalesce(erro, 'Nao foi possivel confirmar com a Evolution. Confira no WhatsApp antes de reenviar.')
      where id = v_t.id;
      v_resolvidas := v_resolvidas + 1;
    end if;

    -- NADA AQUI REENVIA. Decisao explicita: e mensagem para paciente, e so
    -- falha de resolucao DNS garante que a requisicao nao saiu (ver
    -- 20260731150000_retry_dns_envio.sql). Reenviar cegamente mandaria a
    -- mensagem duas vezes.
  end loop;

  return v_resolvidas;
end;
$function$;
