-- Solta a trava de posse de take_conversation, assign_conversation e
-- set_conversation_waiting.
--
-- ── O beco sem saída que isto resolve ──
--
-- As três recusavam com "Esta conversa já está sendo atendida por outra pessoa"
-- quando `assigned_to <> auth.uid()`. A trava foi deliberada (01/07/2026), mas
-- criava um estado sem saída: designar para a pessoa errada travava a conversa
-- até ela aparecer — ninguém conseguia devolver para a fila nem repassar. Como a
-- tela também escondia a barra de atendimento nesse caso, não havia nem botão
-- nem RPC que aceitasse. Eram 26 conversas presas assim.
--
-- ── O que NÃO muda ──
--
-- * `can_access_device` continua barrando quem não tem o aparelho.
-- * `assign_conversation` continua recusando alvo sem acesso ao aparelho.
-- * `SELECT ... FOR UPDATE` continua evitando corrida entre dois cliques.
-- * Os `conversation_action_logs` continuam gravando quem fez o quê — é esse
--   rastro que substitui a confirmação que se decidiu não pedir.
-- * A guarda de `status = 'invited'` fica: é inerte (nenhuma RPC cria esse
--   status e há 0 linhas com ele), e removê-la só aumentaria o diff.
--
-- `finish_conversation` NÃO é tocada de propósito: "Finalizar" não aparece em
-- conversa alheia, então a trava dela não atrapalha ninguém. Quem quiser
-- finalizar a conversa de outra pessoa pega primeiro, e aí o rastro fica claro.
--
-- ── Um acréscimo em take_conversation ──
--
-- O `DO UPDATE` passou a zerar `finished_at`/`finished_by`. Antes não zerava
-- porque pegar uma conversa finalizada não era um caminho oferecido pela tela;
-- agora é (botão "Pegar" em conversa finalizada). Sem isso a conversa voltaria a
-- ficar ativa carregando a marca de quem a finalizou — dado velho que mentiria
-- no painel "Dados da conversa". `assign_conversation` já zerava.

CREATE OR REPLACE FUNCTION public.take_conversation(p_device_id uuid, p_remote_sender text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing record;
BEGIN
  IF NOT public.can_access_device(p_device_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT status, assigned_to
  INTO   v_existing
  FROM   public.conversation_assignments
  WHERE  device_id = p_device_id AND remote_sender = p_remote_sender
  FOR UPDATE;

  IF v_existing.status = 'invited' THEN
    RAISE EXCEPTION 'Esta conversa tem um convite de designação pendente';
  END IF;

  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status,
    assigned_to, assigned_by, assigned_at, updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'taken',
    auth.uid(), auth.uid(), now(), now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    status      = 'taken',
    assigned_to = auth.uid(),
    assigned_by = auth.uid(),
    assigned_at = now(),
    invited_to  = NULL,
    invited_by  = NULL,
    invited_at  = NULL,
    finished_at = NULL,
    finished_by = NULL,
    updated_at  = now();

  INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'taken');
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_conversation(p_device_id uuid, p_remote_sender text, p_target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing record;
BEGIN
  IF NOT public.can_access_device(p_device_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = p_target_user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_target_user_id AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Target user does not have access to this device';
  END IF;

  SELECT status, assigned_to
  INTO   v_existing
  FROM   public.conversation_assignments
  WHERE  device_id = p_device_id AND remote_sender = p_remote_sender
  FOR UPDATE;

  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status,
    assigned_to, assigned_by, assigned_at,
    invited_to, invited_by, invited_at,
    updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'assigned',
    p_target_user_id, auth.uid(), now(),
    NULL, NULL, NULL,
    now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    status      = 'assigned',
    assigned_to = p_target_user_id,
    assigned_by = auth.uid(),
    assigned_at = now(),
    invited_to  = NULL,
    invited_by  = NULL,
    invited_at  = NULL,
    finished_at = NULL,
    finished_by = NULL,
    updated_at  = now();

  INSERT INTO public.conversation_action_logs (
    device_id, remote_sender, user_id, action, target_user_id
  )
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'assigned', p_target_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_conversation_waiting(p_device_id uuid, p_remote_sender text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing record;
BEGIN
  IF NOT public.can_access_device(p_device_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT status, assigned_to
  INTO   v_existing
  FROM   public.conversation_assignments
  WHERE  device_id = p_device_id AND remote_sender = p_remote_sender
  FOR UPDATE;

  IF v_existing.status = 'invited' THEN
    RAISE EXCEPTION 'Esta conversa tem um convite de designação pendente';
  END IF;

  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status, updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'waiting', now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    status         = 'waiting',
    global_read_at = NULL,
    assigned_to    = NULL,
    assigned_by    = NULL,
    assigned_at    = NULL,
    invited_to     = NULL,
    invited_by     = NULL,
    invited_at     = NULL,
    updated_at     = now();

  INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'waiting');
END;
$function$;
