-- Item 10 da fila do Hub, a metade que ficou de fora da Onda 1: "no próprio
-- WhatsApp essa mensagem fica bugada". A exibição dentro do app já foi corrigida;
-- aqui é a citação que SAI daqui e chega deformada no celular de quem recebe.
--
-- DEFEITO 1 — ID VAZIO. A chave ia com `'id', COALESCE(external_id, '')`. Toda
-- mensagem sem `external_id` — as que vieram da importação de histórico, por
-- exemplo — produzia uma citação apontando para `""`, ou seja, para mensagem
-- nenhuma. O WhatsApp então desenha um balão de citação quebrado. Agora, sem id
-- para apontar, a mensagem simplesmente sai SEM citação: melhor que uma citação
-- corrompida.
--
-- O balão de citação DENTRO do Central Whats não muda com isso. Quem o desenha é
-- o `v_reply_snapshot`, montado logo abaixo e preservado sempre — os dois campos
-- são independentes de propósito.
--
-- DEFEITO 2 — FALTA `participant` EM GRUPO. Em conversa de grupo o `remoteJid` é
-- o do grupo, e o autor da mensagem citada só se identifica por `key.participant`.
-- Sem ele o WhatsApp recebe uma citação sem dono. `group_participant` já é
-- gravado pelo webhook; em LID ele vem com sufixo, em telefone vem sem — por isso
-- o `LIKE '%@%'` antes de completar o domínio.
--
-- FICA DE FORA: citação de mídia ainda vai como `conversation`, então responder a
-- uma foto mostra no celular do cliente um balão de TEXTO escrito "[Imagem]".
-- Corrigir exige montar `imageMessage`/`audioMessage`/`documentMessage` com forma
-- de protobuf que só dá para confirmar enviando de verdade — e isto aqui é o
-- caminho de envio da empresa inteira. Fica para depois do teste em número
-- interno, em migration própria.
--
-- Não mexe na assinatura (continuam 12 argumentos, com `p_sem_assinatura`), então
-- é `CREATE OR REPLACE` no lugar: sem `DROP`, sem perda de ACL e sem criar
-- sobrecarga ambígua — o erro que a `20260820120000` documenta e que pararia todo
-- o envio. Lê a definição REAL de produção em tempo de execução por causa do
-- drift do ledger. Idempotente, atômico, aborta sem alterar nada se a âncora
-- faltar.

DO $migracao$
DECLARE
  v_def   text;
  v_antes text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'send_whatsapp_message'
     AND p.pronargs = 12;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'send_whatsapp_message com 12 argumentos não encontrada. '
      'Abortado sem alterar nada: o banco não está no estado esperado.';
  END IF;

  IF position('participant' in v_def) > 0 THEN
    RAISE NOTICE 'Correção da citação já aplicada — nada a fazer.';
    RETURN;
  END IF;

  v_antes := v_def;
  v_def := replace(v_def,
$ancora$      v_quoted := jsonb_build_object(
        'key', jsonb_build_object(
          'remoteJid', v_remote_jid_full,
          'fromMe', CASE WHEN v_reply_msg.direction = 'outbound' THEN true ELSE false END,
          'id', COALESCE(v_reply_msg.external_id, '')
        ),
        'message', jsonb_build_object(
          'conversation', COALESCE(v_reply_msg.content, '')
        )
      );$ancora$,
$novo$      -- Citacao SO quando existe id da Evolution para apontar. Com id vazio
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
      END IF;$novo$);

  IF v_def = v_antes THEN
    RAISE EXCEPTION 'Âncora da citação não encontrada na definição de produção. '
      'Abortado sem alterar nada.';
  END IF;

  EXECUTE v_def;

  RAISE NOTICE 'Citacao corrigida a partir da definicao de producao.';
END
$migracao$;
