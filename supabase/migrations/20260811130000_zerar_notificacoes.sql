-- ============================================================
-- mark_all_conversations_read_global() — zerar todas as notificações
-- ============================================================
--
-- Substitui `markAllConversationsReadForDevice` do frontend, que era codigo morto
-- e estava quebrado de duas formas: fazia `select('remote_sender')` em `messages`
-- SEM paginacao (o PostgREST corta em 1.000 linhas em silencio, e ha 46 mil
-- mensagens — enxergaria uma fracao das conversas), e depois disparava um RPC por
-- conversa. Com 1.742 conversas, isso e uma rajada de milhares de chamadas para
-- fazer o que aqui e uma instrucao so.
--
-- Alcance: TODOS os aparelhos a que o chamador tem acesso, e a marca e GLOBAL —
-- zera o badge para a equipe inteira, nao so para quem clicou. Nao ha desfazer.
-- Por isso a UI restringe o botao a admin e exige confirmacao.

CREATE OR REPLACE FUNCTION public.mark_all_conversations_read_global()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_afetadas integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  WITH aparelhos AS (
    -- `can_access_device` e chamada aqui, sobre 5 aparelhos, e nao dentro do
    -- filtro de `messages`: la seria uma chamada por linha, sobre 46 mil.
    -- Ela tambem e o criterio certo por outro motivo: admin NAO esta em
    -- `user_allowed_devices`, e checar aquela tabela direto o deixaria de fora.
    SELECT d.id
    FROM public.devices d
    WHERE d.deleted_at IS NULL
      AND public.can_access_device(d.id)
  ),
  conversas AS (
    SELECT DISTINCT m.device_id, m.remote_sender
    FROM public.messages m
    JOIN aparelhos a ON a.id = m.device_id
    WHERE m.direction  = 'inbound'
      AND m.deleted_at IS NULL
  ),
  gravadas AS (
    INSERT INTO public.conversation_assignments (
      device_id, remote_sender, status, global_read_at, global_read_by, updated_at
    )
    SELECT c.device_id, c.remote_sender, 'open', now(), v_uid, now()
    FROM conversas c
    ON CONFLICT (device_id, remote_sender)
    DO UPDATE SET
      -- Conversa em 'waiting' conserva a marca antiga. A regra vem da
      -- `mark_conversation_read_global`: "aguardando" e um estado deliberado, e
      -- zerar o badge dela apagaria justamente o lembrete que alguem deixou.
      global_read_at = CASE
        WHEN conversation_assignments.status = 'waiting'
        THEN conversation_assignments.global_read_at
        ELSE now()
      END,
      global_read_by = CASE
        WHEN conversation_assignments.status = 'waiting'
        THEN conversation_assignments.global_read_by
        ELSE v_uid
      END,
      updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_afetadas FROM gravadas;

  -- `manual_unread` e por usuario: limpa so o de quem chamou. Conversa que um
  -- colega marcou como nao lida a mao e decisao dele, e a zeragem global nao tem
  -- por que desfazer isso — o badge global some, a marca pessoal dele fica.
  UPDATE public.conversation_user_states
  SET    manual_unread    = false,
         manual_unread_at = NULL,
         updated_at       = now()
  WHERE  user_id       = v_uid
    AND  manual_unread = true;

  RETURN v_afetadas;
END;
$function$;

-- Duas coisas que a `mark_conversation_read_global` faz e esta NAO faz, de proposito:
--
-- 1. Nao grava em `conversation_action_logs`. La cada chamada registra um
--    'opened', o que faz sentido para uma conversa aberta de verdade. Aqui
--    seriam 1.742 registros afirmando que a pessoa abriu todas elas — mentira
--    que ainda por cima alimenta `get_conversation_recent_viewers`.
--
-- 2. Nao reabre conversa 'finished' que recebeu mensagem nova. La isso corrige o
--    estado da conversa que o usuario esta olhando; aqui reabriria em massa
--    atendimentos ja encerrados, efeito que ninguem pediu ao clicar em "zerar
--    notificacoes".

GRANT EXECUTE ON FUNCTION public.mark_all_conversations_read_global() TO authenticated;
