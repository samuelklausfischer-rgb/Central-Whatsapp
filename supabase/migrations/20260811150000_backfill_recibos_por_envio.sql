-- ============================================================
-- Backfill de conversation_read_progress a partir do historico de envios
-- ============================================================
--
-- Quem enviou uma mensagem numa conversa tinha visto aquela conversa naquele
-- instante. E a evidencia mais forte de leitura que existe no banco, e a unica
-- recuperavel para o passado: ninguem gravou recibo antes desta feature existir.
--
-- Motivo de existir: o caminho de escrita no cliente estava quebrado desde o
-- lancamento (o registro dependia do array `messages`, mas era disparado por
-- efeitos que rodavam ANTES das mensagens chegarem, e `messages` nao estava nas
-- dependencias). A tabela inteira tinha UMA linha. Sem este backfill, o painel
-- "Informacoes da mensagem" nasceria vazio mesmo com o codigo corrigido, e
-- continuaria parecendo quebrado por semanas.
--
-- Cobertura: ~8.4 mil mensagens enviadas com autor identificado, 12 pessoas,
-- ~501 conversas. As outras ~50 mil mensagens enviadas nao tem `sender_id`
-- (mandadas direto do celular, fora do app) e nao ha como atribuir a ninguem —
-- essas conversas seguem sem historico.
--
-- Imprecisao conhecida: mensagem enviada por agendamento ou automacao pode
-- carregar o `sender_id` de quem criou a regra sem que a pessoa tenha aberto a
-- conversa naquele momento. E minoria, e o erro e sempre para o lado de "viu".
--
-- Idempotente: o NOT EXISTS impede duplicata se a migration for reaplicada.

INSERT INTO public.conversation_read_progress (
  device_id, remote_sender, user_id, up_to_message_id, up_to_message_at, read_at
)
SELECT
  m.device_id,
  m.remote_sender,
  m.sender_id,
  m.id,
  -- Ambos sao o instante do envio: naquele momento a pessoa tinha visto a
  -- conversa ate ali. Nao ha como saber quando ela viu antes disso, e chutar
  -- seria inventar dado num painel cujo proposito e justamente ser confiavel.
  m.created_at,
  m.created_at
FROM public.messages m
-- Os JOINs nao sao decorativos: `conversation_read_progress` tem FK para as duas
-- tabelas, e um `sender_id` orfao (usuario removido) abortaria a migration inteira.
JOIN public.profiles p ON p.id = m.sender_id
JOIN public.devices  d ON d.id = m.device_id
WHERE m.direction  = 'outbound'
  AND m.sender_id  IS NOT NULL
  AND m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.conversation_read_progress r
    WHERE r.up_to_message_id = m.id
      AND r.user_id          = m.sender_id
  );
