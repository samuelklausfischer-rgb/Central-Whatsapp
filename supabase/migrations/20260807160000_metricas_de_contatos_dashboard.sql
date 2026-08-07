-- Métricas do Dashboard por PESSOA, não por mensagem.
--
-- Contagem de mensagem não diz quase nada: dez mensagens podem ser uma pessoa
-- mandando dez linhas seguidas, ou dez pessoas esperando atendimento. O que a
-- gestão precisa saber é quantas PESSOAS procuraram a empresa e em quanto tempo
-- foram respondidas.
--
-- POR QUE MEDIANA E NÃO MÉDIA
-- Medido em produção, últimos 7 dias: mediana 259 s (4min19s), média 13.621 s
-- (3h47min) — 53 vezes maior. Um punhado de conversas esquecidas durante a noite
-- ou o fim de semana desloca a média inteira e faz o número parar de descrever o
-- atendimento real.
--
-- POR QUE AGREGA NO BANCO
-- O Dashboard já lia `messages` três vezes por período (KPIs, gráfico e top
-- conversas), trazendo linha crua para somar no cliente. Latência exige comparar
-- cada mensagem com a seguinte — no cliente, isso significaria baixar o período
-- inteiro. Aqui é uma varredura só, com janela.

CREATE OR REPLACE FUNCTION public.get_dashboard_contact_metrics(
  p_device_ids uuid[],
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  pessoas integer,
  perguntas integer,
  respondidas integer,
  mediana_segundos integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_permitidos uuid[];
BEGIN
  -- Guarda explícita, no padrão de get_conversation_summaries: SECURITY DEFINER
  -- ignora RLS, então o acesso é conferido aqui, aparelho por aparelho. Ids sem
  -- permissão são descartados em silêncio em vez de derrubar a chamada inteira —
  -- o Dashboard manda a lista de aparelhos que ele conhece, não uma escolha.
  SELECT coalesce(array_agg(d), '{}')
  INTO v_permitidos
  FROM unnest(coalesce(p_device_ids, '{}')) AS d
  WHERE public.can_access_device(d);

  IF array_length(v_permitidos, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, NULL::integer;
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      m.device_id,
      m.remote_sender,
      m.direction,
      m.created_at,
      lag(m.direction) OVER (
        PARTITION BY m.device_id, m.remote_sender ORDER BY m.created_at, m.id
      ) AS dir_anterior,
      -- Primeira saída DEPOIS desta linha. Janela em vez de subconsulta
      -- correlacionada: uma passada só sobre o período.
      min(CASE WHEN m.direction = 'outbound' THEN m.created_at END) OVER (
        PARTITION BY m.device_id, m.remote_sender ORDER BY m.created_at, m.id
        ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
      ) AS proxima_saida
    FROM public.messages m
    WHERE m.device_id = ANY(v_permitidos)
      AND m.created_at >= p_from
      -- Sem teto superior de propósito: quem escreveu às 23h50 costuma ser
      -- respondido no dia seguinte, e cortar em p_to contaria essa conversa
      -- como não respondida para sempre.
      AND m.deleted_at IS NULL
      -- Grupo não é "uma pessoa que entrou em contato".
      AND m.remote_sender NOT LIKE '%@g.us'
  ),
  inicios AS (
    -- Só a PRIMEIRA mensagem de cada rajada. Sem isto, alguém que manda cinco
    -- linhas seguidas antes de ser atendido geraria cinco latências, e as quatro
    -- extras seriam artificialmente curtas.
    SELECT * FROM base
    WHERE direction = 'inbound'
      AND dir_anterior IS DISTINCT FROM 'inbound'
      AND created_at < p_to
  )
  SELECT
    (SELECT count(DISTINCT b.remote_sender)::integer
       FROM base b
      WHERE b.direction = 'inbound' AND b.created_at < p_to),
    count(*)::integer,
    count(i.proxima_saida)::integer,
    -- Rajada sem resposta fica FORA da mediana: entraria como tempo infinito e
    -- envenenaria a estatística. Ela já é contada no card de não respondidas.
    round(
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (i.proxima_saida - i.created_at))
      )
    )::integer
  FROM inicios i;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_dashboard_contact_metrics(uuid[], timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.get_dashboard_contact_metrics(uuid[], timestamptz, timestamptz) TO authenticated;
