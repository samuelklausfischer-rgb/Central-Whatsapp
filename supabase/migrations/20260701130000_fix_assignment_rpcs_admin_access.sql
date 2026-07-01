-- ============================================================
-- Fix: take_conversation/assign_conversation/set_conversation_waiting/
-- finish_conversation/respond_conversation_invite checavam acesso via
-- user_allowed_devices puro, sem considerar profiles.is_admin — admins
-- (que não estão em user_allowed_devices) tomavam "Access denied" ao
-- tentar pegar/designar/finalizar conversas. Passa a usar
-- can_access_device(), mesmo padrão já usado em mark_conversation_read_global,
-- get_device_team_members e get_conversation_recent_viewers.
-- ============================================================

CREATE OR REPLACE FUNCTION public.take_conversation(
  p_device_id     uuid,
  p_remote_sender text
)
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

  IF v_existing.status IN ('taken', 'assigned')
     AND v_existing.assigned_to IS NOT NULL
     AND v_existing.assigned_to <> auth.uid() THEN
    RAISE EXCEPTION 'Esta conversa já está sendo atendida por outra pessoa';
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
    updated_at  = now();

  INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'taken');
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_conversation(
  p_device_id      uuid,
  p_remote_sender  text,
  p_target_user_id uuid
)
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

  SELECT status, assigned_to, invited_by
  INTO   v_existing
  FROM   public.conversation_assignments
  WHERE  device_id = p_device_id AND remote_sender = p_remote_sender
  FOR UPDATE;

  IF v_existing.status IN ('taken', 'assigned')
     AND v_existing.assigned_to IS NOT NULL
     AND v_existing.assigned_to <> auth.uid() THEN
    RAISE EXCEPTION 'Esta conversa já está sendo atendida por outra pessoa';
  END IF;

  IF v_existing.status = 'invited'
     AND v_existing.invited_by IS NOT NULL
     AND v_existing.invited_by <> auth.uid() THEN
    RAISE EXCEPTION 'Já existe um convite pendente enviado por outra pessoa';
  END IF;

  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status,
    invited_to, invited_by, invited_at, updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'invited',
    p_target_user_id, auth.uid(), now(), now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    status      = 'invited',
    invited_to  = p_target_user_id,
    invited_by  = auth.uid(),
    invited_at  = now(),
    updated_at  = now();

  INSERT INTO public.conversation_action_logs (
    device_id, remote_sender, user_id, action, target_user_id
  )
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'assigned', p_target_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_conversation_waiting(
  p_device_id     uuid,
  p_remote_sender text
)
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

  IF v_existing.status IN ('taken', 'assigned')
     AND v_existing.assigned_to IS NOT NULL
     AND v_existing.assigned_to <> auth.uid() THEN
    RAISE EXCEPTION 'Esta conversa já está sendo atendida por outra pessoa';
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

CREATE OR REPLACE FUNCTION public.finish_conversation(
  p_device_id     uuid,
  p_remote_sender text
)
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

  IF v_existing.status IN ('taken', 'assigned')
     AND v_existing.assigned_to IS NOT NULL
     AND v_existing.assigned_to <> auth.uid() THEN
    RAISE EXCEPTION 'Esta conversa já está sendo atendida por outra pessoa';
  END IF;

  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status,
    finished_by, finished_at, global_responded_at, global_responded_by, updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'finished',
    auth.uid(), now(), now(), auth.uid(), now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    status               = 'finished',
    finished_by          = auth.uid(),
    finished_at          = now(),
    global_responded_at  = now(),
    global_responded_by  = auth.uid(),
    updated_at           = now();

  INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'finished');
END;
$function$;

CREATE OR REPLACE FUNCTION public.respond_conversation_invite(
  p_device_id     uuid,
  p_remote_sender text,
  p_accept        boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
BEGIN
  IF NOT public.can_access_device(p_device_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT *
  INTO   v_row
  FROM   public.conversation_assignments
  WHERE  device_id = p_device_id AND remote_sender = p_remote_sender
  FOR UPDATE;

  IF v_row IS NULL OR v_row.status <> 'invited' THEN
    RAISE EXCEPTION 'Não há convite pendente para esta conversa';
  END IF;

  IF v_row.invited_to IS NULL OR v_row.invited_to <> auth.uid() THEN
    RAISE EXCEPTION 'Você não é o destinatário deste convite';
  END IF;

  IF p_accept THEN
    UPDATE public.conversation_assignments
    SET status      = 'taken',
        assigned_to = auth.uid(),
        assigned_by = coalesce(v_row.invited_by, auth.uid()),
        assigned_at = now(),
        invited_to  = NULL,
        invited_by  = NULL,
        invited_at  = NULL,
        updated_at  = now()
    WHERE device_id = p_device_id AND remote_sender = p_remote_sender;

    INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
    VALUES (p_device_id, p_remote_sender, auth.uid(), 'taken');
  ELSE
    UPDATE public.conversation_assignments
    SET status         = 'waiting',
        global_read_at = NULL,
        assigned_to    = NULL,
        assigned_by    = NULL,
        assigned_at    = NULL,
        invited_to     = NULL,
        invited_by     = NULL,
        invited_at     = NULL,
        updated_at     = now()
    WHERE device_id = p_device_id AND remote_sender = p_remote_sender;

    INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
    VALUES (p_device_id, p_remote_sender, auth.uid(), 'waiting');
  END IF;
END;
$function$;
