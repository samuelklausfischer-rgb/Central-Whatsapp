-- ABRIR A CONVERSA MARCA LIDA PARA TODOS — inclusive na fila do dia
--
-- O relato (Hub, item 6 de 01/09): "usuário x abre a conversa com o contato n e
-- para o usuário y deveria aparecer como lida, mas continua não lida".
--
-- A arquitetura estava certa: `mark_conversation_read_global` grava
-- `global_read_at` em toda abertura, o UPDATE gera o evento de Realtime em
-- `conversation_assignments`, e o badge do colega recalcula NO CLIENTE, sem
-- rede (`cursorDeLeitura` = o mesmo `GREATEST(cus.last_read_at,
-- ca.global_read_at)` da RPC `get_conversation_summaries`).
--
-- A causa era um CONGELAMENTO DELIBERADO aqui dentro: com a conversa na fila
-- do dia (`status = 'waiting'` — 36 conversas no momento da mudança), o
-- `ON CONFLICT DO UPDATE` tinha um `CASE` que preservava o `global_read_at`
-- antigo, para a fila não parecer atendida. Só que isso confundia badge com
-- fila: o contador de não lida seguia piscando para a equipe inteira mesmo
-- depois de alguém já ter aberto e visto a conversa.
--
-- Decisão do Samuel em 01/09/2026: abrir marca lida SEMPRE. Badge e fila são
-- coisas diferentes — o `status` 'waiting' NÃO muda nesta função, então a
-- conversa continua visível na aba de fila até alguém pegá-la; o que muda é só
-- o contador refletir que alguém da equipe já viu.
--
-- Cliente: ZERO mudança. Testado com rollback: conversa 'waiting' com
-- global_read_at nulo → depois do upsert, preenchido, e o status seguiu
-- 'waiting'.

create or replace function public.mark_conversation_read_global(p_device_id uuid, p_remote_sender text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_current_status text;
  v_finished_at    timestamptz;
  v_last_inbound   timestamptz;
BEGIN
  IF NOT public.can_access_device(p_device_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status, global_read_at, global_read_by, updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'open', now(), auth.uid(), now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    -- Sem o CASE de 'waiting' que existia aqui — ver o cabeçalho.
    global_read_at = now(),
    global_read_by = auth.uid(),
    updated_at = now();

  SELECT ca.status, ca.finished_at
  INTO   v_current_status, v_finished_at
  FROM   public.conversation_assignments ca
  WHERE  ca.device_id     = p_device_id
    AND  ca.remote_sender  = p_remote_sender
  FOR UPDATE;

  IF v_current_status = 'finished' THEN
    SELECT max(m.created_at)
    INTO   v_last_inbound
    FROM   public.messages m
    WHERE  m.device_id     = p_device_id
      AND  m.remote_sender  = p_remote_sender
      AND  m.direction      = 'inbound'
      AND  m.deleted_at     IS NULL;

    IF v_last_inbound IS NOT NULL AND (v_finished_at IS NULL OR v_last_inbound > v_finished_at) THEN
      UPDATE public.conversation_assignments
      SET    status     = 'open',
             updated_at = now()
      WHERE  device_id     = p_device_id
        AND  remote_sender  = p_remote_sender;
    END IF;
  END IF;

  INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'opened');
END;
$function$;
