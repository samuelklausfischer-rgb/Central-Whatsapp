-- Figurinhas: poder ENVIAR e poder GUARDAR as preferidas.
--
-- Pedido (Samuel, 02/09/2026): "colocar para poder usar figurinhas, ver
-- figurinhas de forma mais eficiente, poder pegar figurinha e também poder
-- deixar figurinhas salvas de forma organizada".
--
-- (A outra metade do pedido — "hoje até se consegue ver algumas figurinhas que
-- são enviadas porém não são todas" — é um bug de recepção e foi corrigido fora
-- daqui, no `evolution-webhook`: `key.participantAlt` não tinha fallback.)

-- ===========================================================================
-- PARTE 1 — enviar figurinha
-- ===========================================================================
--
-- POR QUE UMA FUNÇÃO NOVA, E NÃO UM RAMO DENTRO DE `send_whatsapp_message`
--
-- A Evolution tem endpoint próprio para figurinha (`/message/sendSticker`), com
-- corpo diferente do `/message/sendMedia` que a função de envio usa para
-- imagem/vídeo/documento/áudio. Encaixar isso lá dentro significaria mexer no
-- corpo de 13 KB da função MAIS crítica do app — o mesmo raciocínio que levou a
-- migration 20260826125016 a preferir um gatilho a um enxerto ali. Uma função
-- separada faz o mesmo trabalho, sai com um `drop function`, e um erro aqui não
-- tem como derrubar o envio de mensagem comum.
CREATE OR REPLACE FUNCTION public.send_whatsapp_sticker(
  p_device_id     uuid,
  p_remote_sender text,
  p_sticker_url   text,
  p_sender_id     uuid DEFAULT NULL
)
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
    RETURN jsonb_build_object('error', 'EVOLUTION_API_KEY não configurada');
  END IF;

  SELECT instance_key INTO v_inst FROM public.devices WHERE id = p_device_id;
  IF v_inst IS NULL THEN
    RETURN jsonb_build_object('error', 'Aparelho não encontrado');
  END IF;

  -- Mesma normalização usada no verificador de tentativas: grupo vai com o JID
  -- inteiro, contato vira só dígitos + @s.whatsapp.net.
  v_jid := CASE
             WHEN p_remote_sender LIKE '%@%' THEN p_remote_sender
             ELSE regexp_replace(p_remote_sender, '\D', '', 'g') || '@s.whatsapp.net'
           END;

  -- 10s: o mesmo teto do verificador. O `statement_timeout` de quem chama é
  -- menor que isso, então quem estoura primeiro é a transação — e aí a
  -- figurinha pode ter saído sem a linha ser gravada. É o mesmo risco do envio
  -- normal, coberto pela mesma rede: a tentativa registrada pelo cliente.
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

  -- Grava como qualquer outra mídia recebida/enviada: `attachments` no mesmo
  -- formato que o webhook usa, para a bolha desenhar a figurinha sem saber que
  -- ela veio por um caminho diferente.
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

REVOKE EXECUTE ON FUNCTION public.send_whatsapp_sticker(uuid, text, text, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.send_whatsapp_sticker(uuid, text, text, uuid) TO authenticated;

-- ===========================================================================
-- PARTE 2 — as figurinhas guardadas
-- ===========================================================================
--
-- POR QUE NÃO EXISTE BUCKET NOVO NEM CÓPIA DO ARQUIVO
-- Toda mídia que chega pelo webhook já é baixada da Evolution e gravada no
-- nosso próprio Storage (`chat-attachments`), e a URL que fica em
-- `messages.attachments` é a NOSSA, pública e estável — não a da CDN da Meta,
-- que expira. Favoritar é, portanto, guardar uma referência. Copiar o arquivo
-- duplicaria bytes que já são nossos.
CREATE TABLE IF NOT EXISTS public.saved_stickers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_url       text NOT NULL,
  -- De onde veio, para poder voltar à conversa de origem. `set null` porque a
  -- figurinha guardada tem de sobreviver à mensagem ser apagada.
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- A mesma figurinha só entra uma vez por pessoa. Sem isto, clicar duas vezes
  -- em favoritar encheria a bandeja de repetições.
  UNIQUE (user_id, storage_url)
);

COMMENT ON TABLE public.saved_stickers IS
  'Figurinhas que a pessoa guardou. Só referência à URL no nosso Storage — o
   arquivo não é copiado.';

ALTER TABLE public.saved_stickers ENABLE ROW LEVEL SECURITY;

-- Favorita é pessoal: cada um vê e mexe só nas suas. Sem exceção para admin —
-- não há motivo de suporte para um admin ler a coleção de figurinha de alguém.
CREATE POLICY "saved_stickers_select" ON public.saved_stickers
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "saved_stickers_insert" ON public.saved_stickers
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "saved_stickers_delete" ON public.saved_stickers
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Sem UPDATE: guardar e tirar cobre tudo o que a bandeja faz.
