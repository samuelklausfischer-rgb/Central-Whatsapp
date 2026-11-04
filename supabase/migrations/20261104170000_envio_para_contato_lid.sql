-- ============================================================================
-- Envio para contato LID (identificador do WhatsApp sem telefone visível)
-- ============================================================================
--
-- Incidente 04/11/2026: Ketlin (Financeiro PRN) não conseguiu responder uma
-- contato do FUSEX/HGEF. Erro na tela:
--
--   Evolution API error (status 400): {"response":{"message":[
--     {"jid":"84911604166679@s.whatsapp.net","exists":false,...}]}}
--
-- `84911604166679` não é telefone: é o LID da contato. Ela achou o Financeiro
-- pela BUSCA GLOBAL do WhatsApp (`entryPointConversionSource:
-- global_search_new_chat`) e o WhatsApp não revela o número de quem chega assim.
-- O webhook recebe `...@lid`, tira o sufixo e grava só os dígitos — e todo envio
-- remontava o endereço como `dígitos@s.whatsapp.net`, um telefone que não existe.
--
-- NÃO ERA CASO ISOLADO. Em 04/11/2026, em produção:
--   - ~475 conversas com chave de LID em 5 aparelhos, desde nov/2025;
--   - ZERO envios pelo app (`origin = 'app'`) em qualquer uma delas, ever. Toda
--     resposta nessas conversas saiu pelo celular. O app nunca conseguiu.
--
-- O que a Evolution 2.3.7 diz (consultado em /chat/whatsappNumbers):
--   - `84911604166679@lid`            -> exists: true  (entrega funciona)
--   - `84911604166679@s.whatsapp.net` -> exists: false (o 400 da tela)
--   - CUIDADO: ela responde `exists: true` para QUALQUER `...@lid`, inclusive
--     para um telefone americano de verdade. Ou seja, mandar "no escuro" para
--     @lid pode "sair" para o nada sem erro nenhum. Por isso a regra abaixo nunca
--     chuta LID: só usa o que foi CONFIRMADO pela recusa da consulta de telefone.
--
-- A CORREÇÃO
--
-- 1. `private.contatos_lid` — o que o sistema aprendeu: "nesta instância, esta
--    chave é LID". É a peça que faltava: o webhook guarda só dígitos e a
--    informação "era @lid" se perdia na entrada.
--
-- 2. `private.jid_do_contato(aparelho, chave)` — ÚNICA fonte de verdade de
--    "qual é o endereço WhatsApp deste contato". Antes eram 6 cópias de
--    `dígitos || '@s.whatsapp.net'` (envio, figurinha, reação, edição, apagar e
--    verificador de tentativas); agora todas chamam esta.
--
-- 3. Envio APRENDE sozinho. Se a Evolution recusar o telefone com
--    `exists:false` e a chave tiver cara de LID (>= 13 dígitos, não é celular
--    brasileiro, e a própria contato JÁ mandou mensagem por ela), o envio é
--    refeito como `@lid` e a chave é gravada em `contatos_lid`. Refazer é
--    SEGURO: o `exists:false` é a validação PRÉVIA da Evolution — a mensagem
--    não saiu, não há risco de chegar duas vezes. Do segundo envio em diante,
--    vai direto para @lid.
--
-- 4. Carga inicial com a mesma regra: 375 pares aparelho+chave. Validada em
--    04/11/2026 contra a Evolution: 324 candidatas nos 4 aparelhos conectados,
--    324 com `exists:false` como telefone — nenhum falso positivo. As 51 do
--    "Whatsapp RH" não puderam ser conferidas (aparelho desconectado, 428).
--
-- 5. O que continua `exists:false` depois disso é número sem WhatsApp de
--    verdade, e o erro passa a dizer isso em português.
--
-- Bases (conferidas contra produção em 04/11/2026, md5 do corpo sem espaços):
--   send_whatsapp_message          e5fdabb95c096a6bd566c2d9bcbd877d (= 20261007190000)
--   verificar_tentativas_de_envio  3d2b17454a60009444e86ca007745ed9 (= 20261007150000)
--   send_whatsapp_sticker          cd05923d43cd147fd129e905fd26f5d4 (produção)
--   send_whatsapp_reaction         55c361c05aa6a36c01e668499e43d477 (produção)
--   edit_whatsapp_message          1db61f2ae211eced6682185192bf0125 (produção)
--   delete_whatsapp_message        b7b042442fd89796044e3cfc4dced2d7 (produção)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. O que o sistema sabe: chaves que são LID, por aparelho
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.contatos_lid (
  device_id  uuid        NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  -- Mesmo formato de messages.remote_sender: só dígitos, sem `@lid`.
  chave      text        NOT NULL CHECK (chave ~ '^[0-9]+$'),
  -- 'carga'  = carga inicial desta migração (regra validada na Evolution);
  -- 'envio'  = aprendido ao vivo: telefone recusado, @lid aceito.
  origem     text        NOT NULL CHECK (origem IN ('carga', 'envio')),
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, chave)
);

ALTER TABLE private.contatos_lid ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.contatos_lid FROM public;
REVOKE ALL ON TABLE private.contatos_lid FROM anon;
REVOKE ALL ON TABLE private.contatos_lid FROM authenticated;


-- ----------------------------------------------------------------------------
-- 2. Endereço do contato — única fonte de verdade
-- ----------------------------------------------------------------------------
-- Grupo, LID explícito ou JID completo passam como vieram. Dígitos puros viram
-- `@lid` SÓ se a chave estiver em `contatos_lid`; senão, telefone — exatamente
-- o comportamento de antes para todo o resto.
CREATE OR REPLACE FUNCTION private.jid_do_contato(p_device_id uuid, p_remote text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_remote IS NULL OR p_remote = '' THEN p_remote
    WHEN position('@' in p_remote) > 0 THEN p_remote
    WHEN EXISTS (
      SELECT 1 FROM private.contatos_lid l
      WHERE l.device_id = p_device_id
        AND l.chave = regexp_replace(p_remote, '\D', '', 'g')
    ) THEN regexp_replace(p_remote, '\D', '', 'g') || '@lid'
    ELSE regexp_replace(p_remote, '\D', '', 'g') || '@s.whatsapp.net'
  END
$function$;


-- A chave TEM CARA de LID? Só serve para decidir se vale tentar @lid depois
-- que a Evolution JÁ recusou o telefone — nunca para chutar antes.
--   - >= 13 dígitos: os LIDs vistos em produção têm 13 a 15;
--   - não é celular/fixo brasileiro (55 + DDD + 8/9 dígitos): um número BR
--     recusado é número errado ou conta apagada, e mandar para @lid "sairia"
--     para o nada sem erro (a Evolution aceita qualquer @lid);
--   - a contato JÁ mandou mensagem por essa chave: a chave veio do WhatsApp,
--     não foi digitada pelo atendente.
CREATE OR REPLACE FUNCTION private.pode_ser_lid(p_device_id uuid, p_chave text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT p_chave ~ '^[0-9]{13,}$'
     AND p_chave !~ '^55[0-9]{10,11}$'
     AND EXISTS (
       SELECT 1 FROM public.messages m
       WHERE m.device_id = p_device_id
         AND m.remote_sender = p_chave
         AND m.direction = 'inbound'
     )
$function$;


-- A Evolution recusou porque o número não existe no WhatsApp?
-- Formato da 2.3.7: {"status":400,"response":{"message":[{"exists":false,...}]}}
-- Essa recusa vem da consulta PRÉVIA ao envio: a mensagem não saiu.
CREATE OR REPLACE FUNCTION private.recusa_numero_inexistente(p_body text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_lista jsonb;
begin
  if p_body is null or p_body = '' then
    return false;
  end if;
  v_lista := p_body::jsonb -> 'response' -> 'message';
  if v_lista is null or jsonb_typeof(v_lista) <> 'array' then
    return false;
  end if;
  return exists (
    select 1 from jsonb_array_elements(v_lista) e
    where jsonb_typeof(e) = 'object' and e ->> 'exists' = 'false'
  );
exception when others then
  return false;
end;
$function$;

REVOKE ALL ON FUNCTION private.jid_do_contato(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION private.pode_ser_lid(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION private.recusa_numero_inexistente(text) FROM public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. Carga inicial
-- ----------------------------------------------------------------------------
-- Mesma regra de `pode_ser_lid`, aplicada ao histórico. Validada contra a
-- Evolution em 04/11/2026 (324/324, ver cabeçalho).
INSERT INTO private.contatos_lid (device_id, chave, origem)
SELECT DISTINCT m.device_id, m.remote_sender, 'carga'
FROM public.messages m
WHERE m.direction = 'inbound'
  AND m.remote_sender ~ '^[0-9]{13,}$'
  AND m.remote_sender !~ '^55[0-9]{10,11}$'
ON CONFLICT DO NOTHING;


-- ----------------------------------------------------------------------------
-- 4. send_whatsapp_message
-- ----------------------------------------------------------------------------
-- Além do LID, os dois ramos (mídia e texto) deixaram de duplicar a chamada
-- HTTP, a nova tentativa de DNS, a leitura da resposta e a chave canônica:
-- cada ramo só monta o payload, e o resto roda uma vez. O comportamento de cada
-- trecho é o mesmo de 20261007190000.
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
  v_destino text;
  v_aprendeu_lid boolean := false;
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

  -- v_normalized é a CHAVE da conversa (como `messages.remote_sender` guarda);
  -- v_remote_jid_full é o ENDEREÇO no WhatsApp (telefone, LID ou grupo).
  IF p_remote_sender LIKE '%@g.us' THEN
    v_normalized := p_remote_sender;
    v_remote_jid_full := p_remote_sender;
  ELSE
    v_normalized := regexp_replace(
      regexp_replace(p_remote_sender, '@s\.whatsapp\.net|@lid', '', 'g'),
      '\D', '', 'g'
    );
    v_remote_jid_full := private.jid_do_contato(p_device_id, p_remote_sender);
  END IF;

  -- `number` da Evolution: telefone vai só com dígitos, como sempre foi (é o
  -- que deixa a Evolution resolver o nono dígito); LID e grupo vão com o JID
  -- inteiro, porque sem o sufixo a Evolution trataria como telefone.
  IF v_remote_jid_full LIKE '%@lid' THEN
    v_destino := v_remote_jid_full;
  ELSE
    v_destino := v_normalized;
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

  -- -------------------------------------------------------------- payload ---
  IF v_is_media THEN
    IF p_content IS NOT NULL AND p_content != '' AND p_content NOT IN ('[Áudio]', '[Anexo]', '[Imagem]', '[Vídeo]', U&'[V\00C3\00ADdeo]', '[Documento]', '[Mídia]') THEN
      v_caption := p_content;
    ELSE
      v_caption := '';
    END IF;

    IF p_media_type IN ('image', 'video', 'document') THEN
      v_endpoint := '/message/sendMedia/' || v_safe_instance;
      v_payload := jsonb_build_object(
        'number', v_destino,
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
    ELSE
      -- 'audio' e qualquer outro tipo: mesmo endpoint, como era.
      v_endpoint := '/message/sendWhatsAppAudio/' || v_safe_instance;
      v_payload := jsonb_build_object(
        'number', v_destino,
        'audio', p_media_url
      );
    END IF;
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
    v_endpoint := '/message/sendText/' || v_safe_instance;
    v_payload := jsonb_build_object('number', v_destino, 'text', v_text_content, 'linkPreview', false);
  END IF;

  IF v_quoted IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('quoted', v_quoted);
  END IF;
  v_payload := v_payload || v_mencoes;

  v_req_url := v_secret_url || v_endpoint;
  v_body := v_payload::text;

  -- ---------------------------------------------------------------- envio ---
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

  -- CONTATO LID (04/11/2026). A Evolution recusou o TELEFONE com exists:false,
  -- mas a chave tem cara de LID e veio da própria contato: refaz como @lid.
  -- Refazer é seguro — essa recusa é a checagem PRÉVIA da Evolution, a
  -- mensagem não saiu. Nunca entra aqui para grupo nem para quem já foi como
  -- @lid (v_remote_jid_full não termina em @s.whatsapp.net).
  IF v_resp.status = 400
     AND v_remote_jid_full LIKE '%@s.whatsapp.net'
     AND private.recusa_numero_inexistente(v_resp.content)
     AND private.pode_ser_lid(p_device_id, v_normalized) THEN
    v_remote_jid_full := v_normalized || '@lid';
    v_payload := jsonb_set(v_payload, '{number}', to_jsonb(v_remote_jid_full));
    IF v_payload ? 'quoted' THEN
      v_payload := jsonb_set(v_payload, '{quoted,key,remoteJid}', to_jsonb(v_remote_jid_full));
    END IF;
    v_body := v_payload::text;

    -- Uma chamada só: o endereço acabou de ser resolvido pela chamada acima.
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
    v_aprendeu_lid := v_resp.status IN (200, 201);
  END IF;

  IF v_resp.status NOT IN (200, 201) THEN
    IF v_resp.status = 400 AND private.recusa_numero_inexistente(v_resp.content) THEN
      RETURN json_build_object(
        'error', 'Este número não está no WhatsApp. A mensagem NÃO foi enviada.',
        'status', v_resp.status,
        'body', v_resp.content
      );
    END IF;
    RETURN json_build_object('error', 'Evolution API error', 'status', v_resp.status, 'body', v_resp.content);
  END IF;

  -- Aprendido: do próximo envio em diante vai direto para @lid. Sub-bloco
  -- porque a mensagem JÁ SAIU — falhar em lembrar não pode desfazer o registro.
  IF v_aprendeu_lid THEN
    BEGIN
      INSERT INTO private.contatos_lid (device_id, chave, origem)
      VALUES (p_device_id, v_normalized, 'envio')
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
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
  -- quando a diferença é EXATAMENTE o nono dígito (ver a função auxiliar). Para
  -- LID a resposta vem com `@lid` e a função devolve a chave como está.
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

  -- -------------------------------------------------------------- registro --
  IF v_is_media THEN
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
  ELSE
    INSERT INTO messages (content, device_id, remote_sender, sender_id, direction, is_read, origin, external_id, reactions, reply_to_id, reply_to_snapshot, is_forwarded)
    VALUES (v_text_content, p_device_id, v_chave, p_sender_id, 'outbound', true, 'app', v_external_id, '[]'::jsonb, p_reply_to_id, v_reply_snapshot, p_forwarded)
    RETURNING * INTO v_message;
  END IF;

  RETURN json_build_object('status', 'sent', 'message', row_to_json(v_message), 'conversa_movida', v_conversa_movida);
END;
$function$;


-- ----------------------------------------------------------------------------
-- 5. send_whatsapp_sticker — base: produção
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_whatsapp_sticker(p_device_id uuid, p_remote_sender text, p_sticker_url text, p_sender_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_key      text;
  v_url      text;
  v_inst     text;
  v_jid      text;
  v_resp     extensions.http_response;
  v_ext      text;
  v_msg_id   uuid;
BEGIN
  IF NOT public.can_access_device(p_device_id) THEN
    RETURN jsonb_build_object('error', 'Acesso negado a este aparelho');
  END IF;

  SELECT value INTO v_key FROM public.secrets WHERE key = 'EVOLUTION_API_KEY';
  SELECT value INTO v_url FROM public.secrets WHERE key = 'EVOLUTION_API_URL';
  v_url := rtrim(coalesce(v_url, 'http://apps-evolution-api.srofjl.easypanel.host'), '/');

  IF v_key IS NULL THEN
    RETURN jsonb_build_object('error', 'EVOLUTION_API_KEY nao configurada');
  END IF;

  SELECT instance_key INTO v_inst FROM public.devices WHERE id = p_device_id;
  IF v_inst IS NULL THEN
    RETURN jsonb_build_object('error', 'Aparelho nao encontrado');
  END IF;

  -- Endereço pela fonte única (grupo inteiro, LID conhecido ou telefone).
  v_jid := private.jid_do_contato(p_device_id, p_remote_sender);

  -- 10s: o mesmo teto do verificador.
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT', '10');

  BEGIN
    SELECT * INTO v_resp FROM extensions.http((
      'POST',
      v_url || '/message/sendSticker/' || replace(v_inst, ' ', '%20'),
      array[extensions.http_header('apikey', v_key)],
      'application/json',
      json_build_object('number', v_jid, 'sticker', p_sticker_url)::text
    )::extensions.http_request);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'Falha ao falar com a Evolution', 'body', SQLERRM);
  END;

  IF v_resp.status NOT BETWEEN 200 AND 299 THEN
    RETURN jsonb_build_object('error', 'Evolution recusou a figurinha',
                              'status', v_resp.status, 'body', v_resp.content);
  END IF;

  v_ext := v_resp.content::jsonb -> 'key' ->> 'id';

  -- Grava como qualquer outra midia: `attachments` no mesmo formato que o
  -- webhook usa, para a bolha desenhar a figurinha sem saber que ela veio por
  -- um caminho diferente.
  INSERT INTO public.messages (
    content, device_id, sender_id, is_read, remote_sender,
    direction, origin, external_id, attachments
  )
  VALUES (
    '', p_device_id, p_sender_id, true, p_remote_sender,
    'outbound', 'app', v_ext,
    jsonb_build_array(jsonb_build_object(
      'url', p_sticker_url, 'type', 'sticker', 'mime', 'image/webp', 'name', 'figurinha.webp'
    ))
  )
  RETURNING id INTO v_msg_id;

  RETURN jsonb_build_object('ok', true, 'message_id', v_msg_id, 'external_id', v_ext);
END;
$function$;


-- ----------------------------------------------------------------------------
-- 6. send_whatsapp_reaction — base: produção
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_whatsapp_reaction(p_message_id uuid, p_reaction text, p_device_id uuid, p_sender_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_msg messages;
  v_instance_key text;
  v_secret_key text;
  v_secret_url text;
  v_safe_instance text;
  v_req_url text;
  v_payload jsonb;
  v_body text;
  v_resp http_response;
  v_key jsonb;
  v_reactions jsonb;
  v_sender_phone text;
  v_sender_name text;
  v_updated_reactions jsonb;
  v_reactor_entry jsonb;
  v_found boolean;
  v_idx int;
BEGIN
  -- Fetch original message
  SELECT * INTO v_msg FROM messages WHERE id = p_message_id;
  IF v_msg.id IS NULL THEN
    RETURN json_build_object('error', 'message not found');
  END IF;

  -- Get instance key
  SELECT instance_key INTO v_instance_key FROM devices WHERE id = p_device_id;
  IF v_instance_key IS NULL THEN
    RETURN json_build_object('error', 'device not found');
  END IF;
  v_safe_instance := replace(v_instance_key, ' ', '%20');

  -- Get secrets
  SELECT value INTO v_secret_key FROM secrets WHERE key = 'EVOLUTION_API_KEY';
  SELECT value INTO v_secret_url FROM secrets WHERE key = 'EVOLUTION_API_URL';
  IF v_secret_url IS NULL THEN
    v_secret_url := 'http://apps-evolution-api.srofjl.easypanel.host';
  END IF;
  v_secret_url := rtrim(v_secret_url, '/');

  IF v_secret_key IS NULL THEN
    RETURN json_build_object('error', 'missing EVOLUTION_API_KEY');
  END IF;

  -- Determine sender phone
  IF v_msg.direction = 'outbound' AND v_msg.remote_sender NOT LIKE '%@g.us' THEN
    v_sender_phone := v_msg.remote_sender;
  ELSE
    v_sender_phone := v_msg.remote_sender;
  END IF;

  -- Get sender name
  IF p_sender_id IS NOT NULL THEN
    SELECT name INTO v_sender_name FROM profiles WHERE id = p_sender_id;
  ELSE
    v_sender_name := v_msg.sender_name;
  END IF;

  -- Send reaction via Evolution API. Endereço pela fonte única: grupo inteiro,
  -- LID conhecido ou telefone.
  v_key := jsonb_build_object(
    'remoteJid',
    private.jid_do_contato(p_device_id, v_msg.remote_sender),
    'fromMe',
    CASE WHEN v_msg.direction = 'outbound' THEN true ELSE false END,
    'id',
    COALESCE(v_msg.external_id, '')
  );

  v_payload := jsonb_build_object(
    'key', v_key,
    'reaction', p_reaction
  );

  v_req_url := v_secret_url || '/message/sendReaction/' || v_safe_instance;
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

  -- Update local reactions array
  v_reactions := COALESCE(v_msg.reactions, '[]'::jsonb);

  IF p_reaction = '' THEN
    -- Remove ALL reactions from this sender
    v_updated_reactions := '[]'::jsonb;
    FOR v_idx IN 0 .. jsonb_array_length(v_reactions) - 1 LOOP
      v_reactor_entry := v_reactions -> v_idx;
      IF v_reactor_entry ->> 'sender' = v_sender_phone THEN
        NULL; -- skip (remove)
      ELSE
        v_updated_reactions := v_updated_reactions || jsonb_build_array(v_reactor_entry);
      END IF;
    END LOOP;
  ELSE
    -- Check if this sender already reacted with this emoji → toggle off
    v_found := false;
    v_updated_reactions := '[]'::jsonb;
    FOR v_idx IN 0 .. jsonb_array_length(v_reactions) - 1 LOOP
      v_reactor_entry := v_reactions -> v_idx;
      IF v_reactor_entry ->> 'sender' = v_sender_phone
         AND v_reactor_entry ->> 'emoji' = p_reaction THEN
        v_found := true; -- skip (un-react)
      ELSE
        v_updated_reactions := v_updated_reactions || jsonb_build_array(v_reactor_entry);
      END IF;
    END LOOP;
    IF NOT v_found THEN
      -- Add new reaction
      v_reactor_entry := jsonb_build_object(
        'emoji', p_reaction,
        'sender', v_sender_phone,
        'sender_name', COALESCE(v_sender_name, v_sender_phone),
        'timestamp', now()::text
      );
      v_updated_reactions := v_updated_reactions || jsonb_build_array(v_reactor_entry);
    END IF;
  END IF;

  UPDATE messages SET reactions = v_updated_reactions WHERE id = p_message_id;

  RETURN json_build_object('status', 'sent', 'reactions', v_updated_reactions);
END;
$function$;


-- ----------------------------------------------------------------------------
-- 7. edit_whatsapp_message — base: produção
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_whatsapp_message(p_message_id uuid, p_device_id uuid, p_new_content text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_msg messages;
  v_instance_key text;
  v_secret_key text;
  v_secret_url text;
  v_safe_instance text;
  v_key jsonb;
  v_payload jsonb;
  v_req_url text;
  v_resp http_response;
  v_resp_json jsonb;
  v_remote_jid text;
  v_normalized text;
BEGIN
  SELECT * INTO v_msg FROM messages WHERE id = p_message_id;
  IF v_msg.id IS NULL THEN
    RETURN json_build_object('error', 'message not found');
  END IF;

  SELECT instance_key INTO v_instance_key FROM devices WHERE id = p_device_id;
  IF v_instance_key IS NULL THEN
    RETURN json_build_object('error', 'device not found');
  END IF;
  v_safe_instance := replace(v_instance_key, ' ', '%20');

  SELECT value INTO v_secret_key FROM secrets WHERE key = 'EVOLUTION_API_KEY';
  SELECT value INTO v_secret_url FROM secrets WHERE key = 'EVOLUTION_API_URL';
  IF v_secret_url IS NULL THEN
    v_secret_url := 'http://apps-evolution-api.srofjl.easypanel.host';
  END IF;
  v_secret_url := rtrim(v_secret_url, '/');

  IF v_secret_key IS NULL THEN
    RETURN json_build_object('error', 'missing EVOLUTION_API_KEY');
  END IF;

  IF v_msg.external_id IS NULL OR v_msg.external_id = '' THEN
    RETURN json_build_object('error', 'message has no external_id, cannot edit');
  END IF;

  IF v_msg.direction <> 'outbound' THEN
    RETURN json_build_object('error', 'so e possivel editar mensagem enviada por nos');
  END IF;

  IF v_msg.deleted_at IS NOT NULL THEN
    RETURN json_build_object('error', 'mensagem apagada nao pode ser editada');
  END IF;

  -- Passados 15 minutos o WhatsApp ignora a edicao em silencio, e a Evolution
  -- ainda responde 2xx. Recusar aqui e o que impede o app de gravar de novo uma
  -- edicao que nao existe do outro lado.
  IF v_msg.created_at < now() - interval '15 minutes' THEN
    RETURN json_build_object('error', 'passou da janela de 15 minutos do WhatsApp');
  END IF;

  -- Mesma normalizacao de send_whatsapp_message. remote_sender guarda numero
  -- puro em conversa 1:1, e o WhatsApp exige o JID completo na chave da edicao;
  -- sem o dominio ele descarta a edicao sem avisar ninguem. O JID vem da fonte
  -- unica (telefone, LID conhecido ou grupo).
  IF v_msg.remote_sender LIKE '%@g.us' THEN
    v_normalized := v_msg.remote_sender;
  ELSE
    v_normalized := regexp_replace(
      regexp_replace(v_msg.remote_sender, '@s\.whatsapp\.net|@lid', '', 'g'),
      '\D', '', 'g'
    );
  END IF;

  v_remote_jid := private.jid_do_contato(p_device_id, v_msg.remote_sender);

  -- LID vai com o JID inteiro também no `number` (sem o sufixo a Evolution
  -- trataria como telefone e recusaria).
  IF v_remote_jid LIKE '%@lid' THEN
    v_normalized := v_remote_jid;
  END IF;

  -- Build key object
  v_key := jsonb_build_object(
    'remoteJid', v_remote_jid,
    'fromMe', true,
    'id', v_msg.external_id
  );

  -- Build payload: number (as numeric string), text, key
  v_payload := jsonb_build_object(
    'number', v_normalized,
    'text', p_new_content,
    'key', v_key
  );

  v_req_url := v_secret_url || '/chat/updateMessage/' || v_safe_instance;

  v_resp := http(ROW(
    'POST'::http_method,
    v_req_url,
    ARRAY[
      ROW('Content-Type', 'application/json')::http_header,
      ROW('apikey', v_secret_key)::http_header
    ],
    'application/json',
    v_payload::text
  )::http_request);

  IF v_resp.status NOT IN (200, 201, 204) THEN
    RETURN json_build_object(
      'error', 'Evolution API returned error',
      'status', v_resp.status,
      'body', v_resp.content
    );
  END IF;

  UPDATE messages
  SET content = p_new_content, edited_at = now()
  WHERE id = p_message_id;

  RETURN json_build_object('status', 'edited', 'method', 'native');
END;
$function$;


-- ----------------------------------------------------------------------------
-- 8. delete_whatsapp_message — base: produção
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_whatsapp_message(p_message_id uuid, p_device_id uuid, p_delete_for_everyone boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_msg messages;
  v_instance_key text;
  v_secret_key text;
  v_secret_url text;
  v_safe_instance text;
  v_remote_jid text;
  v_req_url text;
  v_payload jsonb;
  v_resp http_response;
BEGIN
  SELECT * INTO v_msg FROM messages WHERE id = p_message_id;
  IF v_msg.id IS NULL THEN
    RETURN json_build_object('error', 'message not found');
  END IF;

  -- Delete for me: just mark locally, no API call needed
  IF NOT p_delete_for_everyone THEN
    UPDATE messages
    SET content = '[Mensagem apagada]', deleted_at = now()
    WHERE id = p_message_id;
    RETURN json_build_object('status', 'deleted', 'for_everyone', false);
  END IF;

  -- Delete for everyone: call Evolution API
  SELECT instance_key INTO v_instance_key FROM devices WHERE id = p_device_id;
  IF v_instance_key IS NULL THEN
    RETURN json_build_object('error', 'device not found');
  END IF;
  v_safe_instance := replace(v_instance_key, ' ', '%20');

  SELECT value INTO v_secret_key FROM secrets WHERE key = 'EVOLUTION_API_KEY';
  SELECT value INTO v_secret_url FROM secrets WHERE key = 'EVOLUTION_API_URL';
  IF v_secret_url IS NULL THEN
    v_secret_url := 'http://apps-evolution-api.srofjl.easypanel.host';
  END IF;
  v_secret_url := rtrim(v_secret_url, '/');

  IF v_secret_key IS NULL THEN
    RETURN json_build_object('error', 'missing EVOLUTION_API_KEY');
  END IF;

  IF v_msg.external_id IS NULL OR v_msg.external_id = '' THEN
    RETURN json_build_object('error', 'message has no external_id, cannot delete for everyone');
  END IF;

  -- remoteJid pela fonte única: grupo inteiro, LID conhecido ou telefone.
  v_remote_jid := private.jid_do_contato(p_device_id, v_msg.remote_sender);

  v_payload := jsonb_build_object(
    'id', v_msg.external_id,
    'remoteJid', v_remote_jid,
    'fromMe', true,
    'participant', ''
  );

  -- Try DELETE first (as per spec), then fallback to POST
  v_req_url := v_secret_url || '/chat/deleteMessageForEveryone/' || v_safe_instance;

  v_resp := http(ROW(
    'DELETE'::http_method,
    v_req_url,
    ARRAY[
      ROW('Content-Type', 'application/json')::http_header,
      ROW('apikey', v_secret_key)::http_header
    ],
    'application/json',
    v_payload::text
  )::http_request);

  -- If DELETE fails, try POST (some servers strip body from DELETE)
  IF v_resp.status NOT IN (200, 201, 204) THEN
    v_resp := http(ROW(
      'POST'::http_method,
      v_req_url,
      ARRAY[
        ROW('Content-Type', 'application/json')::http_header,
        ROW('apikey', v_secret_key)::http_header
      ],
      'application/json',
      v_payload::text
    )::http_request);
  END IF;

  IF v_resp.status NOT IN (200, 201, 204) THEN
    RETURN json_build_object(
      'error', 'Evolution API delete failed',
      'status', v_resp.status,
      'body', v_resp.content
    );
  END IF;

  UPDATE messages
  SET content = '[Mensagem apagada]', deleted_at = now()
  WHERE id = p_message_id;

  RETURN json_build_object('status', 'deleted', 'for_everyone', true);
END;
$function$;


-- ----------------------------------------------------------------------------
-- 9. private.verificar_tentativas_de_envio — base: 20261007150000 (= produção)
-- ----------------------------------------------------------------------------
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
        -- Endereco pela fonte unica. Sem isso, conversa LID era procurada
        -- como telefone, a Evolution nao achava nada e a tentativa virava
        -- "falhou" mesmo quando a mensagem tinha saido.
        v_jid := private.jid_do_contato(v_t.device_id, v_t.remote_sender);

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
