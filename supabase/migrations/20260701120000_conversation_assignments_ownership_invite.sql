-- ============================================================
-- Trava de posse real + fluxo de convite (Designar) + integração
-- com "não respondido" no Finalizar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Novas colunas + novo status 'invited'
-- ------------------------------------------------------------

ALTER TABLE public.conversation_assignments
  ADD COLUMN invited_to           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN invited_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN invited_at           timestamptz,
  ADD COLUMN global_responded_at timestamptz,
  ADD COLUMN global_responded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.conversation_assignments
  DROP CONSTRAINT conversation_assignments_status_check;

ALTER TABLE public.conversation_assignments
  ADD CONSTRAINT conversation_assignments_status_check
  CHECK (status IN ('open', 'taken', 'assigned', 'finished', 'waiting', 'invited'));

-- ------------------------------------------------------------
-- 2. take_conversation — agora com trava de posse
-- ------------------------------------------------------------

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
  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = auth.uid()
  ) THEN
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

-- ------------------------------------------------------------
-- 3. assign_conversation — agora cria um convite (não atribui direto)
-- ------------------------------------------------------------

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
  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = p_target_user_id
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

-- ------------------------------------------------------------
-- 4. respond_conversation_invite — aceitar/recusar o convite
-- ------------------------------------------------------------

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
  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = auth.uid()
  ) THEN
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

GRANT EXECUTE ON FUNCTION public.respond_conversation_invite(uuid, text, boolean) TO authenticated;

-- ------------------------------------------------------------
-- 5. set_conversation_waiting — trava de posse
-- ------------------------------------------------------------

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
  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = auth.uid()
  ) THEN
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

-- ------------------------------------------------------------
-- 6. finish_conversation — trava de posse + zera "não respondido" pro time
-- ------------------------------------------------------------

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
  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = auth.uid()
  ) THEN
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

-- ------------------------------------------------------------
-- 7. get_conversation_assignment — inclui os novos campos de convite
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_conversation_assignment(uuid, text);

CREATE OR REPLACE FUNCTION public.get_conversation_assignment(
  p_device_id     uuid,
  p_remote_sender text
)
RETURNS TABLE(
  id                   uuid,
  device_id            uuid,
  remote_sender        text,
  status               text,
  assigned_to          uuid,
  assigned_by          uuid,
  assigned_at          timestamptz,
  finished_at          timestamptz,
  finished_by          uuid,
  global_read_at       timestamptz,
  global_read_by       uuid,
  invited_to           uuid,
  invited_by           uuid,
  invited_at           timestamptz,
  global_responded_at  timestamptz,
  global_responded_by  uuid,
  created_at           timestamptz,
  updated_at           timestamptz,
  assigned_to_name     text,
  assigned_by_name     text,
  invited_to_name      text,
  invited_by_name      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ca.id,
    ca.device_id,
    ca.remote_sender,
    ca.status,
    ca.assigned_to,
    ca.assigned_by,
    ca.assigned_at,
    ca.finished_at,
    ca.finished_by,
    ca.global_read_at,
    ca.global_read_by,
    ca.invited_to,
    ca.invited_by,
    ca.invited_at,
    ca.global_responded_at,
    ca.global_responded_by,
    ca.created_at,
    ca.updated_at,
    p_to.name  AS assigned_to_name,
    p_by.name  AS assigned_by_name,
    p_inv_to.name AS invited_to_name,
    p_inv_by.name AS invited_by_name
  FROM  public.conversation_assignments ca
  LEFT JOIN public.profiles p_to     ON p_to.id     = ca.assigned_to
  LEFT JOIN public.profiles p_by     ON p_by.id     = ca.assigned_by
  LEFT JOIN public.profiles p_inv_to ON p_inv_to.id = ca.invited_to
  LEFT JOIN public.profiles p_inv_by ON p_inv_by.id = ca.invited_by
  WHERE ca.device_id     = p_device_id
    AND ca.remote_sender  = p_remote_sender;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_conversation_assignment(uuid, text) TO authenticated;
