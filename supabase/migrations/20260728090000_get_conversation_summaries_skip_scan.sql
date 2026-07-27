-- get_conversation_summaries: skip scan + SECURITY DEFINER
--
-- PROBLEMA (medido em produção, aparelho "WhatsApp Adm", 46 mil msgs / 520 conversas):
--
--   como atendente comum (não-admin)  ->  1136 ms / 61.686 buffers
--   como admin                        ->    40 ms /  9.837 buffers
--
-- Duas causas somadas:
--
--  1. A CTE `senders` fazia `SELECT DISTINCT remote_sender` varrendo o dataset
--     inteiro do aparelho só para extrair 520 valores distintos.
--  2. A função era SECURITY INVOKER, então a policy `select_messages`
--     (`_is_admin() OR EXISTS(user_allowed_devices...)`) virava filtro aplicado
--     LINHA A LINHA nas 46 mil linhas, em todo nó da query. O admin passa pelo
--     InitPlan de `_is_admin()` e não sente; o atendente comum esperava >1 s.
--
-- E esta RPC não roda só na troca de aparelho: roda a cada mensagem nova, a cada
-- evento de estado/atribuição, a cada confirm otimista e a cada poll do cliente.
--
-- CORREÇÃO:
--  - `senders` vira loose index scan (skip scan) recursivo, usando o índice JÁ
--    EXISTENTE idx_messages_device_remote_sender_created
--    (device_id, remote_sender, created_at DESC) WHERE deleted_at IS NULL.
--    São ~520 probes de LIMIT 1 em vez de varrer 46 mil linhas. Nenhum índice novo.
--  - SECURITY DEFINER com guarda explícita `can_access_device(p_device_id)`.
--    A convenção do projeto é essa e não `EXISTS` puro em user_allowed_devices:
--    admins não estão nessa tabela, e `can_access_device` já trata is_super_admin
--    e (is_admin AND NOT devices_restricted).
--  - `auth.uid()` sai para variável local (hoje é reavaliado, com parse do JWT,
--    dentro do join).
--
-- EQUIVALÊNCIA PROVADA (produção, somente leitura, antes de aplicar):
--   skip scan = 520 linhas, DISTINCT = 520 linhas,
--   EXCEPT nos dois sentidos = 0 e 0, md5 idêntico (6deff3ce063872eb7de65cf5c6823243),
--   zero remote_sender nulo ou vazio.
--
-- O QUE NÃO MUDA (de propósito, byte a byte):
--   - o CASE de duas pernas do unread, incluindo `WHEN manual_unread THEN 0`
--   - GREATEST(cus.last_read_at, ca.global_read_at) — a fórmula de não-lidos
--   - `0::bigint AS message_count`
--   - o ORDER BY (pinned DESC, last_message_created_at DESC)
--   - a volatilidade (VOLATILE). Marcar STABLE mudaria o roteamento GET/POST do
--     PostgREST sem necessidade.
--   - os GRANTs. `anon` tem EXECUTE explícito, como as demais funções do projeto;
--     revogar aqui tornaria esta função inconsistente com as vizinhas, e a guarda
--     `v_uid IS NULL -> RETURN` já devolve lista vazia para chamador sem sessão.
--
-- Acesso negado devolve lista vazia (RETURN), não RAISE: é exatamente o que o RLS
-- já fazia, então nenhum caminho de erro novo aparece em src/services/messages.ts.
--
-- ROLLBACK: reaplicar o corpo anterior com CREATE OR REPLACE (sem SECURITY DEFINER
-- e com a CTE `senders` usando SELECT DISTINCT).

CREATE OR REPLACE FUNCTION public.get_conversation_summaries(p_device_id uuid)
RETURNS TABLE(
  remote_sender text,
  sender_name text,
  last_message_id uuid,
  last_message_content text,
  last_message_direction text,
  last_message_created_at timestamp with time zone,
  last_message_is_read boolean,
  last_message_attachments jsonb,
  unread_count bigint,
  message_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- A função passa a rodar como owner (bypass de RLS), então a autorização vira
  -- responsabilidade desta linha. Sem sessão ou sem acesso ao aparelho: lista vazia.
  IF v_uid IS NULL OR NOT public.can_access_device(p_device_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH RECURSIVE senders_raw AS (
    -- Loose index scan: primeiro remote_sender do aparelho...
    (
      SELECT m.remote_sender
      FROM public.messages m
      WHERE m.device_id = p_device_id
        AND m.deleted_at IS NULL
      ORDER BY m.remote_sender
      LIMIT 1
    )
    UNION ALL
    -- ...e, a cada passo, o próximo maior. Cada iteração é um probe no índice.
    SELECT (
      SELECT m.remote_sender
      FROM public.messages m
      WHERE m.device_id = p_device_id
        AND m.deleted_at IS NULL
        AND m.remote_sender > s.remote_sender
      ORDER BY m.remote_sender
      LIMIT 1
    )
    FROM senders_raw s
    WHERE s.remote_sender IS NOT NULL
  ),
  senders AS (
    -- A última iteração devolve NULL (não há próximo) — descartada aqui.
    SELECT sr.remote_sender FROM senders_raw sr WHERE sr.remote_sender IS NOT NULL
  ),
  last_msg AS (
    SELECT s.remote_sender, lm.*
    FROM senders s
    CROSS JOIN LATERAL (
      SELECT
        m.id AS last_message_id,
        m.content AS last_message_content,
        m.direction AS last_message_direction,
        m.created_at AS last_message_created_at,
        m.is_read AS last_message_is_read,
        m.attachments AS last_message_attachments,
        m.sender_name
      FROM public.messages m
      WHERE m.device_id = p_device_id
        AND m.remote_sender = s.remote_sender
        AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT 1
    ) lm
  ),
  ctx AS (
    SELECT
      s.remote_sender,
      GREATEST(cus.last_read_at, ca.global_read_at) AS read_cursor,
      coalesce(cus.manual_unread, false) AS manual_unread,
      coalesce(cus.pinned, false) AS pinned
    FROM senders s
    LEFT JOIN public.conversation_user_states cus
      ON cus.device_id = p_device_id
      AND cus.remote_sender = s.remote_sender
      AND cus.user_id = v_uid
    LEFT JOIN public.conversation_assignments ca
      ON ca.device_id = p_device_id
      AND ca.remote_sender = s.remote_sender
  ),
  unread AS (
    SELECT
      c.remote_sender,
      c.pinned,
      CASE
        WHEN c.manual_unread THEN 0
        WHEN c.read_cursor IS NULL THEN (
          SELECT count(*) FROM public.messages m2
          WHERE m2.device_id = p_device_id
            AND m2.remote_sender = c.remote_sender
            AND m2.deleted_at IS NULL
            AND m2.direction = 'inbound'
        )
        ELSE (
          SELECT count(*) FROM public.messages m2
          WHERE m2.device_id = p_device_id
            AND m2.remote_sender = c.remote_sender
            AND m2.deleted_at IS NULL
            AND m2.direction = 'inbound'
            AND m2.created_at > c.read_cursor
        )
      END AS unread_count
    FROM ctx c
  )
  SELECT
    lm.remote_sender,
    coalesce(lm.sender_name, '') AS sender_name,
    lm.last_message_id,
    lm.last_message_content,
    lm.last_message_direction,
    lm.last_message_created_at,
    lm.last_message_is_read,
    lm.last_message_attachments,
    coalesce(u.unread_count, 0) AS unread_count,
    0::bigint AS message_count
  FROM last_msg lm
  LEFT JOIN unread u ON u.remote_sender = lm.remote_sender
  ORDER BY
    coalesce(u.pinned, false) DESC,
    lm.last_message_created_at DESC;
END;
$function$;
