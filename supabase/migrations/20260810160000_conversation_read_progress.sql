-- ============================================================
-- conversation_read_progress — quem viu cada mensagem, estilo WhatsApp
-- ============================================================
--
-- O que existia antes: `conversation_user_states.last_opened_at`, um carimbo por
-- CONVERSA, sobrescrito a cada abertura. Dava para dizer "fulano abriu esta
-- conversa às 14h", nunca "fulano viu ESTA mensagem".
--
-- Por que um log de progresso e não um carimbo por (mensagem × usuário):
-- carimbar cada par geraria volume proibitivo — produção tem aparelho com 46 mil
-- mensagens e ~12 atendentes ativos, o que daria centenas de milhares de linhas
-- por aparelho, crescendo para sempre. Aqui grava-se UMA linha por avanço de
-- leitura: "o usuário X, nesta conversa, tinha visto até a mensagem de tal
-- horário, e isso foi às tantas horas".
--
-- Como se deriva "quem viu a mensagem M":
--   usuário viu M  ⇔  existe linha dele com up_to_message_at >= M.created_at
--   quando viu     =  MIN(read_at) entre essas linhas (a primeira vez que M
--                     entrou no campo de visão dele)
--
-- A tabela é SOMENTE INSERÇÃO. Não há policy de UPDATE nem de DELETE, do mesmo
-- jeito que `conversation_action_logs`: o requisito é que o horário visto não
-- mude depois, e a forma de garantir isso é não dar a ninguém o direito de
-- reescrever a linha.
--
-- Contenção de volume: o cliente só insere quando o progresso AVANÇA. Reabrir
-- uma conversa sem mensagem nova não grava nada — sem essa regra, cada abertura
-- viraria uma linha e a tabela cresceria pelo uso, não pela leitura.

CREATE TABLE IF NOT EXISTS public.conversation_read_progress (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id        uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  remote_sender    text NOT NULL,
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- A mensagem mais recente que o usuário efetivamente enxergou nessa leitura.
  -- ON DELETE SET NULL e não CASCADE: se a mensagem for apagada, o fato de que
  -- alguém leu até ali continua verdadeiro — quem some é a referência, não o
  -- evento de leitura.
  up_to_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,

  -- `created_at` da mensagem acima, desnormalizado de propósito: é a chave da
  -- comparação em toda consulta de "quem viu". Com o join, cada leitura de
  -- recibo teria de tocar `messages` (46 mil linhas no maior aparelho).
  up_to_message_at timestamptz NOT NULL,

  -- Carimbo permanente. Nunca é atualizado — ver comentário do cabeçalho.
  read_at          timestamptz NOT NULL DEFAULT now()
);

-- Sustenta a única consulta que existe: "nesta conversa, quem tinha visto até
-- pelo menos o horário X". `up_to_message_at DESC` porque a busca é sempre por
-- limite inferior (>=), então as linhas úteis ficam na cabeça do índice.
CREATE INDEX IF NOT EXISTS conversation_read_progress_lookup
  ON public.conversation_read_progress (device_id, remote_sender, up_to_message_at DESC);

-- Sustenta a checagem "qual foi o último progresso deste usuário nesta conversa",
-- feita antes de cada insert para não gravar avanço que não avançou.
CREATE INDEX IF NOT EXISTS conversation_read_progress_ultimo_do_usuario
  ON public.conversation_read_progress (device_id, remote_sender, user_id, up_to_message_at DESC);

ALTER TABLE public.conversation_read_progress ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer atendente com acesso ao aparelho enxerga os recibos daquele
-- aparelho — é o que torna possível mostrar "não visto por fulano".
--
-- O `OR is_admin` não é zelo: administradores NÃO estão em `user_allowed_devices`.
-- Checar só aquela tabela é uma armadilha já documentada neste projeto (01/07/2026),
-- que bloqueou admins nas RPCs de atendimento. Sem esta segunda condição, gerente
-- abriria "Informações da mensagem" e veria a equipe inteira como "não visto".
CREATE POLICY "conv_read_progress_select"
  ON public.conversation_read_progress
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_allowed_devices uad
      WHERE uad.device_id = conversation_read_progress.device_id
        AND uad.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- Escrita: além do acesso ao aparelho, `user_id = auth.uid()`. Sem essa segunda
-- condição um atendente poderia gravar que OUTRA pessoa leu a mensagem, e o
-- recibo deixaria de significar qualquer coisa.
CREATE POLICY "conv_read_progress_insert"
  ON public.conversation_read_progress
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.user_allowed_devices uad
        WHERE uad.device_id = conversation_read_progress.device_id
          AND uad.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin = true
      )
    )
  );

-- Sem policy de UPDATE e sem policy de DELETE: intencional. Ver cabeçalho.
