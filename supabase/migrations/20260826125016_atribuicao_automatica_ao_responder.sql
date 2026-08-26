-- Responder um contato sem dono passa a atribuir esse contato a quem respondeu.
--
-- Pedido (Samuel, 26/08/2026): "contato quando é respondido por alguém que está
-- usando o Central Whats e esse contato ainda não possui atribuição, ele é
-- atribuído de forma automática para a pessoa que mandou a msg, até a
-- finalização ou designar a msg".
--
-- Hoje 2.112 conversas estão em `open` e 2.202 não têm sequer linha na tabela —
-- ou seja, a esmagadora maioria não tem dono e alguém precisa perguntar "quem
-- responde por esse?" antes de designar.
--
-- =========================================================================
-- PARTE 1 — a função de atribuir
-- =========================================================================

create or replace function public.atribuir_conversa_ao_responder(
  p_device_id     uuid,
  p_remote_sender text,
  p_user_id       uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_existente record;
BEGIN
  IF p_user_id IS NULL OR p_device_id IS NULL OR p_remote_sender IS NULL THEN
    RETURN;
  END IF;

  -- GRUPO NÃO. Em grupo várias pessoas respondem; a primeira a digitar viraria
  -- dona do grupo inteiro. Pegar e Designar continuam disponíveis na mão.
  IF p_remote_sender LIKE '%@g.us' THEN
    RETURN;
  END IF;

  SELECT status, assigned_to
  INTO   v_existente
  FROM   public.conversation_assignments
  WHERE  device_id = p_device_id AND remote_sender = p_remote_sender
  FOR UPDATE;

  IF FOUND THEN
    -- Convite de designação pendente: quem manda é o fluxo de convite.
    IF v_existente.status = 'invited' THEN
      RETURN;
    END IF;

    -- JÁ TEM DONO. Este é o caso que não pode regredir de jeito nenhum:
    -- responder a conversa de um colega não pode roubá-la dele. É a diferença
    -- entre esta função e `take_conversation`, que sobrescreve sem perguntar.
    IF v_existente.status IN ('taken', 'assigned') AND v_existente.assigned_to IS NOT NULL THEN
      RETURN;
    END IF;
  END IF;

  -- Chega aqui quem não tem linha, ou está em 'open' / 'waiting' / 'finished',
  -- ou está sem `assigned_to`. 'finished' entra de propósito: terminado o
  -- atendimento, terminou a atribuição — se o contato voltou a escrever e
  -- alguém respondeu, o atendimento é novo e o dono é quem respondeu.
  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status,
    assigned_to, assigned_by, assigned_at, updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'taken',
    p_user_id, p_user_id, now(), now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    status      = 'taken',
    assigned_to = p_user_id,
    assigned_by = p_user_id,
    assigned_at = now(),
    invited_to  = NULL,
    invited_by  = NULL,
    invited_at  = NULL,
    finished_at = NULL,
    finished_by = NULL,
    updated_at  = now();
  -- `global_responded_at` fica INTOCADO. Ele marca "alguém respondeu" e é lido
  -- por `respondidaEm()` no cliente; limpá-lo aqui faria uma conversa
  -- recém-respondida aparecer como não respondida — o oposto do que acabou de
  -- acontecer.

  -- 'taken' porque o CHECK da tabela só aceita opened|taken|assigned|finished|
  -- waiting, e é honesto: a pessoa pegou a conversa, só que sem clicar.
  INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
  VALUES (p_device_id, p_remote_sender, p_user_id, 'taken');
END;
$function$;

comment on function public.atribuir_conversa_ao_responder(uuid, text, uuid) is
  'Atribui a conversa a quem respondeu, mas SÓ se ela não tiver dono. Prima
   conservadora de take_conversation: nunca rouba conversa de outra pessoa,
   nunca levanta exceção e ignora grupos.';

revoke execute on function public.atribuir_conversa_ao_responder(uuid, text, uuid) from public;
revoke execute on function public.atribuir_conversa_ao_responder(uuid, text, uuid) from anon;

-- =========================================================================
-- PARTE 2 — o gatilho
-- =========================================================================
--
-- POR QUE UM GATILHO EM `messages`, E NÃO UM ENXERTO EM `send_whatsapp_message`
--
-- Todo envio passa pela RPC `send_whatsapp_message`, então enxertar lá cobriria
-- tudo — mas o corpo dela tem 13 KB e os dois `INSERT INTO messages` ficam no
-- fim de ramos diferentes. Reescrevê-la, ou remendá-la por `replace()` em cima
-- de `pg_get_functiondef`, é mexer na função MAIS crítica do app inteiro para
-- acrescentar um detalhe de atendimento. Um gatilho consegue o mesmo resultado
-- sem tocar nela, e sai com um `drop trigger`.
--
-- A condição do gatilho descreve exatamente "alguém respondeu pelo app":
--
--   direction = 'outbound'   -> saiu daqui, não é mensagem recebida
--   origin    = 'app'        -> foi pelo Central Whats; 'webhook' é a pessoa
--                               respondendo pelo celular dela, e aí não há
--                               usuário do app a quem atribuir (sender_id nulo)
--   sender_id IS NOT NULL    -> existe um usuário do app por trás
--   auth.uid() = sender_id   -> ver abaixo
--
-- COMO PESSOA SE SEPARA DE ROBÔ
-- O cron de agendamentos chama a MESMA RPC e passa `p_sender_id` = quem agendou,
-- então pelo `sender_id` da linha os dois envios são idênticos. Quem separa é
-- `auth.uid()`:
--
--   pessoa no app (authenticated, com JWT)  ->  auth.uid() = sender_id  -> atribui
--   cron pg_cron (sem JWT)                  ->  auth.uid() IS NULL      -> não
--   anon (a RPC é executável por ele)       ->  auth.uid() IS NULL      -> não
--
-- Um agendamento que dispara de madrugada não joga o contato na fila de quem
-- agendou, que pode nem estar trabalhando.
--
-- POR QUE O BLOCO `EXCEPTION` NÃO É OPCIONAL
-- Quando o gatilho roda, a requisição HTTP para a Evolution JÁ SAIU (a RPC só
-- grava a mensagem depois de receber 200/201). Uma exceção aqui desfaria o
-- INSERT — a mensagem chegaria no WhatsApp da pessoa e não existiria no app. É
-- o mesmo raciocínio já escrito no bloco de nova tentativa da própria RPC.
-- Falhar a atribuição é aceitável; perder a mensagem não é.

-- O VIZINHO: `processar_mensagem_para_atendimento`
--
-- Já existe um AFTER INSERT em `messages` com esse nome, e a PRIMEIRA coisa que
-- ele faz — para qualquer direção — é "reabrir" conversa finalizada:
--
--   update conversation_assignments
--   set status = 'open', assigned_to = null, ...
--   where ... and status = 'finished';
--
-- Os dois se cruzam exatamente no caso "conversa finalizada, alguém responde".
-- Gatilhos disparam em ordem ALFABÉTICA, então `atribuir_...` roda antes de
-- `processar_...` — quando o vizinho chega, o status já é 'taken' e o `where
-- status = 'finished'` dele não casa mais.
--
-- ⚠️ CONSEQUÊNCIA MEDIDA, e ela NÃO é neutra.
--
-- Repare que o update do vizinho não muda só o status: ele também grava
-- `global_read_at`/`global_read_by` quando a mensagem é de saída. Como o `where`
-- dele deixou de casar, esse efeito PAROU de acontecer. Comparação com o gatilho
-- ligado e desligado, na mesma transação:
--
--   responder conversa 'finished'   | status | dono          | global_read_at
--   antes desta migration           | open   | ninguém       | marcada
--   depois desta migration          | taken  | quem respondeu| NÃO marcada
--
-- Ou seja: as duas ordens de disparo convergem no STATUS e no DONO, mas NÃO em
-- `global_read_at`. Um colega que ainda não abriu a conversa continua vendo como
-- não lida, onde antes a resposta limpava para todo mundo.
--
-- Isto está deliberadamente NÃO corrigido aqui: `global_read_at` alimenta o
-- cursor de leitura (`cursorDeLeitura` em ChatHub.tsx) e é território da área de
-- notificação/não lida. Quem for mexer lá decide se restaura o comportamento
-- antigo — bastaria esta função gravar `global_read_at = now()` quando o status
-- anterior era 'finished'.
create or replace function public.tg_atribuir_conversa_ao_responder()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.sender_id THEN
    BEGIN
      PERFORM public.atribuir_conversa_ao_responder(
        NEW.device_id, NEW.remote_sender, NEW.sender_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'atribuicao automatica falhou (mensagem gravada normalmente): %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$function$;

drop trigger if exists atribuir_conversa_ao_responder on public.messages;

-- O `WHEN` filtra ANTES de chamar a função: das 176 mil mensagens da tabela, só
-- as 14,8 mil de origem 'app' chegam a executar qualquer coisa. As 161 mil de
-- 'webhook' (recebidas, e as enviadas pelo celular da pessoa) nem entram.
--
-- A guarda de UMA HORA é a mesma do gatilho vizinho
-- `processar_mensagem_para_atendimento`, e existe pelo mesmo motivo: importação
-- e backfill não podem mexer em fila nem em atendimento. Hoje ela é redundante
-- — a importação de histórico grava com `origin = 'webhook'`, então já está fora
-- pelo filtro acima —, mas custa nada e evita que um backfill futuro que grave
-- como 'app' atribua centenas de conversas de uma vez a quem rodou a importação.
create trigger atribuir_conversa_ao_responder
after insert on public.messages
for each row
when (
  new.direction = 'outbound'
  and new.origin = 'app'
  and new.sender_id is not null
  and new.created_at >= now() - interval '1 hour'
)
execute function public.tg_atribuir_conversa_ao_responder();

comment on function public.tg_atribuir_conversa_ao_responder() is
  'Gatilho de messages: quando alguém responde PELO APP um contato sem dono, o
   contato passa a ser dessa pessoa. Nunca levanta exceção — desfazer o INSERT
   perderia uma mensagem que a Evolution já entregou.';
