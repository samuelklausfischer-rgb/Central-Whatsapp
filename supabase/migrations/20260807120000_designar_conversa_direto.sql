-- Designar conversa passa a ATRIBUIR DIRETO, sem convite com aceite.
--
-- Contexto: o fluxo de convite (status 'invited' + respond_conversation_invite)
-- foi construído em 01/07/2026 e nunca chegou a ser usado — a barra de
-- atendimento inteira ficou escondida por flag de 28/07 a 07/08, e o banco
-- mostra 0 conversas com dono em 1.726 abertas. Nenhuma linha 'invited' existe.
--
-- Decisão do usuário em 07/08/2026: designar joga a conversa para a pessoa na
-- hora. Um passo a menos, e sem a chance de uma conversa ficar parada esperando
-- alguém aceitar.
--
-- O que NÃO muda: respond_conversation_invite, as colunas invited_* e o CHECK
-- que aceita 'invited' continuam existindo. Só param de ser alimentados. Isso
-- mantém o caminho de volta barato se o aceite voltar a ser desejado, e evita
-- quebrar qualquer linha antiga que estivesse nesse estado.

CREATE OR REPLACE FUNCTION public.assign_conversation(
  p_device_id uuid,
  p_remote_sender text,
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

  -- Admin não aparece em user_allowed_devices, por isso as duas checagens.
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

  -- Trava de posse: continua valendo. Quem não é o dono não tira a conversa de
  -- quem está atendendo. Passar a conversa adiante é o dono quem faz.
  IF v_existing.status IN ('taken', 'assigned')
     AND v_existing.assigned_to IS NOT NULL
     AND v_existing.assigned_to <> auth.uid()
     AND v_existing.assigned_to <> p_target_user_id THEN
    RAISE EXCEPTION 'Esta conversa já está sendo atendida por outra pessoa';
  END IF;

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
    -- Zerado para não sobrar convite pendente de um fluxo que não existe mais.
    invited_to  = NULL,
    invited_by  = NULL,
    invited_at  = NULL,
    -- Designar reabre: uma conversa finalizada que é passada adiante volta a
    -- valer, senão ela ficaria atribuída e fechada ao mesmo tempo.
    finished_at = NULL,
    finished_by = NULL,
    updated_at  = now();

  INSERT INTO public.conversation_action_logs (
    device_id, remote_sender, user_id, action, target_user_id
  )
  VALUES (p_device_id, p_remote_sender, auth.uid(), 'assigned', p_target_user_id);
END;
$function$;
