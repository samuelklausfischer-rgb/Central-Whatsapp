-- ============================================================
-- conversation_assignments + conversation_action_logs
-- + updated get_conversation_summaries (considers global_read_at)
-- + RPCs for team conversation management
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------

CREATE TABLE public.conversation_assignments (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id      uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  remote_sender  text NOT NULL,
  status         text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'taken', 'assigned', 'finished', 'waiting')),
  assigned_to    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at    timestamptz,
  finished_at    timestamptz,
  finished_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  global_read_at timestamptz,
  global_read_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE(device_id, remote_sender)
);

CREATE TABLE public.conversation_action_logs (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id      uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  remote_sender  text NOT NULL,
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action         text NOT NULL CHECK (action IN ('opened', 'taken', 'assigned', 'finished', 'waiting')),
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. Indexes
-- ------------------------------------------------------------

CREATE INDEX idx_conv_action_logs_device_sender
  ON public.conversation_action_logs(device_id, remote_sender, created_at DESC);

-- ------------------------------------------------------------
-- 3. RLS
-- ------------------------------------------------------------

ALTER TABLE public.conversation_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_action_logs ENABLE ROW LEVEL SECURITY;

-- Helper: user has access to device via user_allowed_devices
CREATE POLICY "conv_assignments_select"
  ON public.conversation_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_allowed_devices uad
      WHERE uad.device_id = conversation_assignments.device_id
        AND uad.user_id = auth.uid()
    )
  );

CREATE POLICY "conv_assignments_insert"
  ON public.conversation_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_allowed_devices uad
      WHERE uad.device_id = conversation_assignments.device_id
        AND uad.user_id = auth.uid()
    )
  );

CREATE POLICY "conv_assignments_update"
  ON public.conversation_assignments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_allowed_devices uad
      WHERE uad.device_id = conversation_assignments.device_id
        AND uad.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_allowed_devices uad
      WHERE uad.device_id = conversation_assignments.device_id
        AND uad.user_id = auth.uid()
    )
  );

-- No DELETE policy for conversation_assignments (admins only — omitted for now)

CREATE POLICY "conv_action_logs_select"
  ON public.conversation_action_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_allowed_devices uad
      WHERE uad.device_id = conversation_action_logs.device_id
        AND uad.user_id = auth.uid()
    )
  );

CREATE POLICY "conv_action_logs_insert"
  ON public.conversation_action_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_allowed_devices uad
      WHERE uad.device_id = conversation_action_logs.device_id
        AND uad.user_id = auth.uid()
    )
  );

-- No UPDATE/DELETE on action_logs (immutable audit trail)

-- ------------------------------------------------------------
-- 4. Rebuild get_conversation_summaries (considers global_read_at)
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_conversation_summaries(uuid);

CREATE OR REPLACE FUNCTION public.get_conversation_summaries(p_device_id uuid)
RETURNS TABLE(
  remote_sender              text,
  sender_name                text,
  last_message_id            uuid,
  last_message_content       text,
  last_message_direction     text,
  last_message_created_at    timestamp with time zone,
  last_message_is_read       boolean,
  last_message_attachments   jsonb,
  unread_count               bigint,
  message_count              bigint
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH ranked_messages AS (
    SELECT
      m.remote_sender,
      m.id AS message_id,
      m.content,
      m.direction,
      m.created_at,
      m.is_read,
      m.attachments,
      m.sender_name,
      row_number() OVER (PARTITION BY m.remote_sender ORDER BY m.created_at DESC) AS rn,
      count(*) OVER (PARTITION BY m.remote_sender) AS total_messages
    FROM public.messages m
    WHERE m.device_id = p_device_id
      AND m.deleted_at IS NULL
  ),
  latest_per_conversation AS (
    SELECT
      rm.remote_sender,
      rm.sender_name,
      rm.message_id AS last_message_id,
      rm.content    AS last_message_content,
      rm.direction  AS last_message_direction,
      rm.created_at AS last_message_created_at,
      rm.is_read    AS last_message_is_read,
      rm.attachments AS last_message_attachments,
      rm.total_messages AS message_count
    FROM ranked_messages rm
    WHERE rm.rn = 1
  ),
  unread_counts AS (
    SELECT
      m.remote_sender,
      count(*) AS unread_count
    FROM public.messages m
    LEFT JOIN public.conversation_user_states cus
      ON  cus.device_id    = p_device_id
      AND cus.remote_sender = m.remote_sender
      AND cus.user_id       = auth.uid()
    LEFT JOIN public.conversation_assignments ca
      ON  ca.device_id    = p_device_id
      AND ca.remote_sender = m.remote_sender
    WHERE m.device_id  = p_device_id
      AND m.deleted_at IS NULL
      AND m.direction  = 'inbound'
      AND (
        GREATEST(cus.last_read_at, ca.global_read_at) IS NULL
        OR m.created_at > GREATEST(cus.last_read_at, ca.global_read_at)
      )
      AND NOT coalesce(cus.manual_unread, false)
    GROUP BY m.remote_sender
  ),
  final_summaries AS (
    SELECT
      l.remote_sender,
      coalesce(l.sender_name, '') AS sender_name,
      l.last_message_id,
      l.last_message_content,
      l.last_message_direction,
      l.last_message_created_at,
      l.last_message_is_read,
      l.last_message_attachments,
      coalesce(u.unread_count, 0) AS unread_count,
      l.message_count
    FROM latest_per_conversation l
    LEFT JOIN unread_counts u ON u.remote_sender = l.remote_sender
  )
  SELECT
    fs.remote_sender,
    fs.sender_name,
    fs.last_message_id,
    fs.last_message_content,
    fs.last_message_direction,
    fs.last_message_created_at,
    fs.last_message_is_read,
    fs.last_message_attachments,
    fs.unread_count,
    fs.message_count
  FROM final_summaries fs
  ORDER BY
    EXISTS (
      SELECT 1 FROM public.conversation_user_states cus
      WHERE cus.device_id    = p_device_id
        AND cus.remote_sender = fs.remote_sender
        AND cus.user_id       = auth.uid()
        AND cus.pinned        = true
    ) DESC,
    fs.last_message_created_at DESC;
END;
$function$;

-- ------------------------------------------------------------
-- 5. RPCs
-- ------------------------------------------------------------

-- 5a. mark_conversation_read_global
CREATE OR REPLACE FUNCTION public.mark_conversation_read_global(
  p_device_id    uuid,
  p_remote_sender text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status text;
  v_finished_at    timestamptz;
  v_last_inbound   timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Upsert assignment record, marking global read
  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status, global_read_at, global_read_by, updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'open', now(), auth.uid(), now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    global_read_at = now(),
    global_read_by = auth.uid(),
    updated_at     = now();

  -- If status was 'finished' and a new inbound message arrived after finished_at, reopen
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

  -- Audit log
  INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'opened');
END;
$function$;

-- 5b. take_conversation
CREATE OR REPLACE FUNCTION public.take_conversation(
  p_device_id     uuid,
  p_remote_sender text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
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
    updated_at  = now();

  INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'taken');
END;
$function$;

-- 5c. assign_conversation
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

  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status,
    assigned_to, assigned_by, assigned_at, updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'assigned',
    p_target_user_id, auth.uid(), now(), now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    status      = 'assigned',
    assigned_to = p_target_user_id,
    assigned_by = auth.uid(),
    assigned_at = now(),
    updated_at  = now();

  INSERT INTO public.conversation_action_logs (
    device_id, remote_sender, user_id, action, target_user_id
  )
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'assigned', p_target_user_id);
END;
$function$;

-- 5d. set_conversation_waiting
CREATE OR REPLACE FUNCTION public.set_conversation_waiting(
  p_device_id     uuid,
  p_remote_sender text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status, updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'waiting', now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    status      = 'waiting',
    global_read_at = NULL,
    assigned_to = NULL,
    assigned_by = NULL,
    assigned_at = NULL,
    updated_at  = now();

  INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'waiting');
END;
$function$;

-- 5e. finish_conversation
CREATE OR REPLACE FUNCTION public.finish_conversation(
  p_device_id     uuid,
  p_remote_sender text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.conversation_assignments (
    device_id, remote_sender, status,
    finished_by, finished_at, updated_at
  )
  VALUES (
    p_device_id, p_remote_sender, 'finished',
    auth.uid(), now(), now()
  )
  ON CONFLICT (device_id, remote_sender)
  DO UPDATE SET
    status      = 'finished',
    finished_by = auth.uid(),
    finished_at = now(),
    updated_at  = now();

  INSERT INTO public.conversation_action_logs (device_id, remote_sender, user_id, action)
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'finished');
END;
$function$;

-- 5f. get_conversation_assignment
CREATE OR REPLACE FUNCTION public.get_conversation_assignment(
  p_device_id     uuid,
  p_remote_sender text
)
RETURNS TABLE(
  id               uuid,
  device_id        uuid,
  remote_sender    text,
  status           text,
  assigned_to      uuid,
  assigned_by      uuid,
  assigned_at      timestamptz,
  finished_at      timestamptz,
  finished_by      uuid,
  global_read_at   timestamptz,
  global_read_by   uuid,
  created_at       timestamptz,
  updated_at       timestamptz,
  assigned_to_name text,
  assigned_by_name text
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
    ca.created_at,
    ca.updated_at,
    p_to.name  AS assigned_to_name,
    p_by.name  AS assigned_by_name
  FROM  public.conversation_assignments ca
  LEFT JOIN public.profiles p_to ON p_to.id = ca.assigned_to
  LEFT JOIN public.profiles p_by ON p_by.id = ca.assigned_by
  WHERE ca.device_id     = p_device_id
    AND ca.remote_sender  = p_remote_sender;
END;
$function$;

-- 5g. get_device_team_members
CREATE OR REPLACE FUNCTION public.get_device_team_members(
  p_device_id uuid
)
RETURNS TABLE(
  id          uuid,
  name        text,
  email       text,
  avatar_url  text,
  department  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_department text;
BEGIN
  SELECT d.department INTO v_department FROM public.devices d WHERE d.id = p_device_id;
  IF v_department IS NULL THEN
    RETURN;  -- device has no department, return empty set gracefully
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.email,
    p.avatar_url,
    p.department
  FROM  public.profiles p
  WHERE p.department = v_department
    AND p.id IN (
          SELECT uad.user_id
          FROM   public.user_allowed_devices uad
          WHERE  uad.device_id = p_device_id
        )
  ORDER BY p.name;
END;
$function$;

-- 5h. get_conversation_recent_viewers
CREATE OR REPLACE FUNCTION public.get_conversation_recent_viewers(
  p_device_id     uuid,
  p_remote_sender text
)
RETURNS TABLE(
  user_id   uuid,
  user_name text,
  read_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_global_read_at timestamptz;
BEGIN
  -- Get the timestamp of the last global read reset (for boundary filtering)
  SELECT ca.global_read_at
  INTO   v_global_read_at
  FROM   public.conversation_assignments ca
  WHERE  ca.device_id     = p_device_id
    AND  ca.remote_sender  = p_remote_sender;

  RETURN QUERY
  SELECT
    cal.user_id,
    p.name   AS user_name,
    cal.created_at AS read_at
  FROM  public.conversation_action_logs cal
  JOIN  public.profiles p ON p.id = cal.user_id
  WHERE cal.device_id     = p_device_id
    AND cal.remote_sender  = p_remote_sender
    AND cal.action         = 'opened'
    AND cal.created_at    >= COALESCE(v_global_read_at - interval '1 second', now() - interval '24 hours')
  ORDER BY cal.created_at DESC;
END;
$function$;

-- ------------------------------------------------------------
-- 6. Grant execute on RPCs to authenticated role
-- ------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.mark_conversation_read_global(uuid, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.take_conversation(uuid, text)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_conversation(uuid, text, uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_conversation_waiting(uuid, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_conversation(uuid, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_assignment(uuid, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_device_team_members(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_recent_viewers(uuid, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_summaries(uuid)            TO authenticated;
