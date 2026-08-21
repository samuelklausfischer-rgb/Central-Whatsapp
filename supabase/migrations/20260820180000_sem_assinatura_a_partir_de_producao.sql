-- Acrescenta `p_sem_assinatura` a `send_whatsapp_message` SEM reescrever o corpo.
--
-- Substitui a migration 20260820120000, que NÃO pode ser aplicada. Duas razões,
-- e a segunda derrubaria o envio de mensagens da empresa inteira:
--
-- 1. DRIFT. Aquela migration trazia o corpo da função do repositório. Este
--    projeto tem drift total do ledger de migrations — o que está versionado
--    não corresponde ao que roda. Medido em 20/08: produção tinha 12.220
--    caracteres de definição, o arquivo do repo 12.672, e o parâmetro mais o
--    comentário novos explicavam só ~270 dessa diferença. Aplicar substituiria
--    o corpo vivo por uma cópia possivelmente desatualizada.
--
-- 2. AMBIGUIDADE. Em Postgres a lista de argumentos faz parte da IDENTIDADE da
--    função. A função em produção tem 11 argumentos; aquela migration criava
--    uma de 12 com `CREATE OR REPLACE` e sem remover a antiga — ou seja, não
--    substituía, criava uma SEGUNDA. Com as duas coexistindo, toda chamada de
--    11 argumentos (todo envio normal do app) casa com ambas e o Postgres
--    recusa com "function is not unique". O bug do toggle viraria parada total
--    do envio.
--
-- Este arquivo evita as duas coisas: lê a definição REAL de produção no momento
-- da execução, aplica só as duas alterações necessárias, remove a versão de 11
-- argumentos e recria. Nada do corpo trafega para fora do banco.
--
-- Idempotente: se `p_sem_assinatura` já existir, não faz nada.
-- Atômico: um bloco DO é uma única instrução — qualquer exceção desfaz tudo.

DO $migracao$
DECLARE
  v_def        text;
  v_antes      text;
  v_assinatura text;
BEGIN
  -- Estado atual. Filtra por `pronargs = 11` de propósito: se alguém já tiver
  -- criado a versão de 12, este bloco não deve tocar em nada.
  SELECT pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid)
    INTO v_def, v_assinatura
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'send_whatsapp_message'
     AND p.pronargs = 11;

  IF v_def IS NULL THEN
    -- Já aplicada? Então sai em silêncio (idempotência).
    IF EXISTS (
      SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'send_whatsapp_message'
         AND pg_get_function_identity_arguments(p.oid) LIKE '%p_sem_assinatura%'
    ) THEN
      RAISE NOTICE 'p_sem_assinatura já existe — nada a fazer.';
      RETURN;
    END IF;

    RAISE EXCEPTION 'send_whatsapp_message com 11 argumentos não encontrada. '
      'Abortado sem alterar nada: o estado do banco não é o esperado.';
  END IF;

  -- Âncora 1: fim da lista de parâmetros.
  v_antes := v_def;
  v_def := replace(
    v_def,
    'p_forwarded boolean DEFAULT false)',
    'p_forwarded boolean DEFAULT false, p_sem_assinatura boolean DEFAULT false)'
  );
  IF v_def = v_antes THEN
    RAISE EXCEPTION 'Âncora do parâmetro não encontrada na definição de produção. '
      'Abortado sem alterar nada.';
  END IF;

  -- Âncora 2: a condição que decide aplicar a assinatura. `p_forwarded` já
  -- suprimia a assinatura, mas também marca a mensagem como "Encaminhada" —
  -- por isso o parâmetro novo é separado, e não um reaproveitamento daquele.
  v_antes := v_def;
  v_def := replace(
    v_def,
    'AND NOT p_forwarded THEN',
    'AND NOT p_forwarded AND NOT p_sem_assinatura THEN'
  );
  IF v_def = v_antes THEN
    RAISE EXCEPTION 'Âncora da condição de assinatura não encontrada. '
      'Abortado sem alterar nada.';
  END IF;

  -- A ordem aqui é obrigatória: remover a de 11 argumentos ANTES de criar a de
  -- 12. Com as duas no ar, o envio normal fica ambíguo e para de funcionar.
  EXECUTE format('DROP FUNCTION public.send_whatsapp_message(%s);', v_assinatura);

  EXECUTE v_def;

  -- O DROP acima apaga a ACL junto. Estes são os papéis medidos em produção
  -- antes da troca; sem restaurar, o app (anon/authenticated) perde o direito
  -- de executar e o envio para por permissão em vez de por ambiguidade.
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.send_whatsapp_message('
       || 'uuid, text, text, uuid, text, text, text, uuid, jsonb, boolean, boolean, boolean'
       || ') TO supabase_admin, postgres, anon, authenticated, service_role';

  RAISE NOTICE 'p_sem_assinatura acrescentado a partir da definição de produção.';
END
$migracao$;
