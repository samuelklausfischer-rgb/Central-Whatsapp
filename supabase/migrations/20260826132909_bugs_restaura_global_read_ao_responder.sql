-- Responder uma conversa FINALIZADA volta a marcá-la como lida para a equipe.
--
-- Regressão introduzida em 20260826125016_atribuicao_automatica_ao_responder, e
-- documentada por quem a introduziu: gatilhos disparam em ordem alfabética, então
-- `atribuir_conversa_ao_responder` roda antes de
-- `processar_mensagem_para_atendimento` e tira o status de 'finished' — que é
-- exatamente o `where status = 'finished'` do vizinho.
--
-- O update do vizinho não mudava só o status. Ele também gravava:
--
--   global_read_at = case when NEW.direction = 'outbound' then now() else null end,
--   global_read_by = case when NEW.direction = 'outbound' then NEW.sender_id else null end
--
-- Como o `where` dele deixou de casar, esse efeito parou de acontecer:
--
--   responder conversa 'finished'  | status | dono           | global_read_at
--   antes de 26/08                 | open   | ninguém        | marcada
--   depois da migration            | taken  | quem respondeu | NÃO marcada
--
-- `global_read_at` alimenta o `cursorDeLeitura` de ChatHub.tsx (commit 901d683,
-- item "não lida não sincroniza entre usuários"): é a marca que faz uma conversa
-- já atendida parar de piscar como não lida para os COLEGAS. Sem ela, quem não
-- abriu a conversa continua vendo não lida, mesmo depois de outra pessoa ter
-- respondido — o oposto do que aquele item corrigiu.
--
-- A migration anterior deixou a decisão registrada para a área de não lida
-- ("bastaria esta função gravar global_read_at = now() quando o status anterior
-- era 'finished'"). Decidido com o Samuel em 26/08/2026: restaurar.
--
-- POR QUE SÓ O RAMO 'finished'
-- Espelha o `where status = 'finished'` do vizinho, nem mais nem menos. Marcar
-- leitura global ao responder QUALQUER conversa sem dono seria comportamento novo,
-- e ninguém pediu — responder não é ler, e o único caso em que o app tratava como
-- tal era a reabertura de um atendimento encerrado.
--
-- POR QUE LER O STATUS DENTRO DO `DO UPDATE`
-- `conversation_assignments.status` ali dentro é o valor ANTERIOR da linha, antes
-- desta escrita. É o mesmo idioma que `mark_conversation_read_global` já usa para
-- preservar a marca quando o status é 'waiting'. Ler de `v_existente` também
-- funcionaria, mas o `SELECT ... FOR UPDATE` acima só roda quando a linha existe —
-- dentro do `DO UPDATE` a leitura é sempre da linha certa.
--
-- O ramo de INSERT não ganha `global_read_at`: linha nova nunca teve passado
-- finalizado, então não há leitura anterior a restaurar.
--
-- `direction` não entra na condição porque não precisa: o gatilho que chama esta
-- função tem `new.direction = 'outbound'` no `WHEN`. Toda invocação daqui já é
-- resposta do time.

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
    -- Restaura o efeito que a ordem dos gatilhos tirou do vizinho. Ver o cabeçalho.
    global_read_at = CASE
      WHEN conversation_assignments.status = 'finished' THEN now()
      ELSE conversation_assignments.global_read_at
    END,
    global_read_by = CASE
      WHEN conversation_assignments.status = 'finished' THEN p_user_id
      ELSE conversation_assignments.global_read_by
    END,
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
   nunca levanta exceção e ignora grupos. Ao reabrir uma conversa finalizada,
   marca global_read_at — comportamento que era do gatilho vizinho antes de a
   ordem de disparo mudar.';

revoke execute on function public.atribuir_conversa_ao_responder(uuid, text, uuid) from public;
revoke execute on function public.atribuir_conversa_ao_responder(uuid, text, uuid) from anon;
