-- Itens 8 e 14 da fila do Hub: editar uma mensagem no Central Whats não editava
-- no WhatsApp do cliente. Os dois itens são o mesmo problema, reportado duas
-- vezes no mesmo dia.
--
-- A HIPÓTESE ESTAVA ERRADA. Achávamos que a função nem chamava a Evolution.
-- Chama: já monta o POST para `/chat/updateMessage`, já confere o status e já só
-- grava a linha com resposta 2xx. O defeito é mais fino.
--
-- CAUSA REAL. A chave da edição ia com `remoteJid` = `remote_sender` cru. Em
-- conversa 1:1 esse campo é gravado como número puro (`5515997579186`), não como
-- JID — o WhatsApp espera `5515997579186@s.whatsapp.net`. O bloco que deveria
-- completar o domínio tinha TRÊS RAMOS IDÊNTICOS:
--
--     IF   ... LIKE '%@g.us' THEN v_remote_jid := v_msg.remote_sender;
--     ELSIF ... LIKE '%@lid' THEN v_remote_jid := v_msg.remote_sender;
--     ELSE                        v_remote_jid := v_msg.remote_sender;  <-- faltava
--
-- Sem o domínio, o WhatsApp não casa a edição com mensagem nenhuma e a descarta
-- em silêncio. A Evolution, no entanto, responde 2xx — a chamada HTTP em si deu
-- certo — e ainda registra `EDITED` no banco DELA, que casa a mensagem só pelo
-- `key.id`. Por isso ninguém via erro: o app gravava `edited_at`, a Evolution
-- concordava, e só o celular do cliente ficava com o texto velho.
--
-- CONFIRMADO em 24/08/2026 na mensagem `b53b0ffa-99ec-454b-873a-35ce9be5a03b`, a
-- dos prints da fila: enviada 14:59:42Z e editada 14:59:56Z — catorze segundos
-- depois, bem dentro da janela do WhatsApp, então prazo não era o problema. A
-- Evolution guarda a chave dela como `5515997579186@s.whatsapp.net`; nós
-- mandávamos `5515997579186`.
--
-- A normalização abaixo é copiada LINHA A LINHA de `send_whatsapp_message`. O
-- envio funciona, então é ele quem manda no formato do JID; reescrever a regra
-- com outra redação aqui criaria duas verdades sobre a mesma coisa.
--
-- JANELA DE 15 MINUTOS. O WhatsApp só aplica edição até 15 minutos depois do
-- envio; passado isso ignora, e a Evolution SEGUE respondendo 2xx. Sem a guarda,
-- corrigir o JID consertaria só os primeiros 15 minutos e a divergência voltaria
-- — silenciosa e idêntica — em toda edição mais velha. A tela também deixa de
-- oferecer "Editar" nesse caso; esta guarda é a rede de segurança do servidor.
--
-- SEGURANÇA DA APLICAÇÃO. Não mexe na assinatura (continuam 3 argumentos), então
-- é `CREATE OR REPLACE` no lugar: sem `DROP`, sem perda de ACL e sem criar uma
-- sobrecarga que deixaria as chamadas ambíguas. Lê a definição REAL de produção
-- em tempo de execução — este projeto tem drift total do ledger de migrations, e
-- aplicar corpo vindo do repositório reverteria correções feitas fora dele.
-- Idempotente, atômico, e aborta sem alterar nada se qualquer âncora faltar.

DO $migracao$
DECLARE
  v_def   text;
  v_antes text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'edit_whatsapp_message'
     AND p.pronargs = 3;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'edit_whatsapp_message com 3 argumentos não encontrada. '
      'Abortado sem alterar nada: o banco não está no estado esperado.';
  END IF;

  IF position('v_normalized' in v_def) > 0 THEN
    RAISE NOTICE 'Correção já aplicada — nada a fazer.';
    RETURN;
  END IF;

  -- Âncora 1: a variável nova, declarada junto da que ela alimenta.
  v_antes := v_def;
  v_def := replace(v_def,
$ancora1$  v_remote_jid text;
BEGIN$ancora1$,
$novo1$  v_remote_jid text;
  v_normalized text;
BEGIN$novo1$);
  IF v_def = v_antes THEN
    RAISE EXCEPTION 'Âncora 1 (DECLARE) não encontrada. Abortado sem alterar nada.';
  END IF;

  -- Âncora 2: as guardas do que o WhatsApp não aceita, logo depois da checagem
  -- de `external_id` que já existia.
  v_antes := v_def;
  v_def := replace(v_def,
$ancora2$  IF v_msg.external_id IS NULL OR v_msg.external_id = '' THEN
    RETURN json_build_object('error', 'message has no external_id, cannot edit');
  END IF;$ancora2$,
$novo2$  IF v_msg.external_id IS NULL OR v_msg.external_id = '' THEN
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
  END IF;$novo2$);
  IF v_def = v_antes THEN
    RAISE EXCEPTION 'Âncora 2 (external_id) não encontrada. Abortado sem alterar nada.';
  END IF;

  -- Âncora 3: o coração do bug — os três ramos idênticos viram a normalização
  -- do envio.
  v_antes := v_def;
  v_def := replace(v_def,
$ancora3$  -- Build remoteJid
  IF v_msg.remote_sender LIKE '%@g.us' THEN
    v_remote_jid := v_msg.remote_sender;
  ELSIF v_msg.remote_sender LIKE '%@lid' THEN
    v_remote_jid := v_msg.remote_sender;
  ELSE
    v_remote_jid := v_msg.remote_sender;
  END IF;$ancora3$,
$novo3$  -- Mesma normalizacao de send_whatsapp_message. `remote_sender` guarda
  -- numero puro em conversa 1:1, e o WhatsApp exige o JID completo na chave da
  -- edicao; sem o dominio ele descarta a edicao sem avisar ninguem.
  IF v_msg.remote_sender LIKE '%@g.us' THEN
    v_normalized := v_msg.remote_sender;
  ELSE
    v_normalized := regexp_replace(
      regexp_replace(v_msg.remote_sender, '@s\.whatsapp\.net|@lid', '', 'g'),
      '\D', '', 'g'
    );
  END IF;

  IF v_msg.remote_sender LIKE '%@g.us' THEN
    v_remote_jid := v_msg.remote_sender;
  ELSE
    v_remote_jid := v_normalized || '@s.whatsapp.net';
  END IF;$novo3$);
  IF v_def = v_antes THEN
    RAISE EXCEPTION 'Âncora 3 (Build remoteJid) não encontrada. Abortado sem alterar nada.';
  END IF;

  -- Âncora 4: o `number` passa a sair da mesma normalização, em vez de um
  -- recorte próprio que devolvia só os dígitos do id do grupo em conversa de
  -- grupo.
  v_antes := v_def;
  v_def := replace(v_def,
$ancora4$    'number', regexp_replace(v_msg.remote_sender, '@.*$', ''),$ancora4$,
$novo4$    'number', v_normalized,$novo4$);
  IF v_def = v_antes THEN
    RAISE EXCEPTION 'Âncora 4 (number) não encontrada. Abortado sem alterar nada.';
  END IF;

  EXECUTE v_def;

  RAISE NOTICE 'edit_whatsapp_message corrigida a partir da definicao de producao.';
END
$migracao$;
