-- Itens 9 e 11 da fila do Hub, que se contradiziam e por isso vão juntos.
--
-- ITEM 9 (Ketlin): faltavam situações como "aguardando" e "em validação", com o
-- MOTIVO à vista — "estou aguardando assinatura do documento" — para quem
-- confere entender por que a tarefa ainda não terminou.
--
-- ITEM 11 (Samuel): cada pessoa quer o próprio quadro, criando e excluindo
-- colunas sem mexer no dos outros.
--
-- A CONTRADIÇÃO: se cada um puser a mesma tarefa numa coluna diferente, a
-- conferência do item 9 deixa de existir — não há "a situação da tarefa", há a
-- opinião de cada um. Decidido com o usuário: a SITUAÇÃO é compartilhada, e o
-- que é pessoal é só a EXIBIÇÃO (quais colunas aparecem, em que ordem, com que
-- nome e cor). Assim a Ketlin enxerga o motivo e o quadro de cada um continua
-- do jeito que a pessoa quiser.
--
-- A constraint `tasks_status_check` PRECISA ser recriada, não só ampliada: ela
-- lista os valores um a um, então um `status` novo é rejeitado enquanto ela
-- existir na forma antiga. Isso foi conferido no banco antes de escrever.

BEGIN;

-- 1. Situações novas. A ordem do ARRAY é também a ordem natural do quadro.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status = ANY (ARRAY['pending', 'in_progress', 'waiting', 'in_review', 'completed']::text[]));

-- 2. O motivo do item 9. Texto livre e opcional: só faz sentido em "aguardando"
-- e "em validação", mas prender isso numa constraint obrigaria a limpar o campo
-- em toda mudança de situação e daria mais erro que ajuda.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS status_reason text;

COMMENT ON COLUMN public.tasks.status_reason IS
  'ITEM 9: por que a tarefa está parada. Visível para todos que enxergam a tarefa.';

-- 3. Personalização do quadro, por pessoa (ITEM 11).
--
-- A chave é (user_id, status): uma linha por coluna que a pessoa customizou.
-- Quem nunca mexeu não tem linha nenhuma e vê o padrão — o que evita ter de
-- semear cinco linhas para cada usuário novo e manter isso em dia.
CREATE TABLE IF NOT EXISTS public.task_board_preferences (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status  text NOT NULL,
  visivel boolean NOT NULL DEFAULT true,
  ordem   integer NOT NULL DEFAULT 0,
  titulo  text,
  cor     text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, status)
);

-- 4. Checklist dentro da tarefa (ITEM 11).
CREATE TABLE IF NOT EXISTS public.task_checklist_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  texto      text NOT NULL,
  feito      boolean NOT NULL DEFAULT false,
  ordem      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_checklist_items_task_id_idx
  ON public.task_checklist_items (task_id, ordem);

-- 5. RLS, no mesmo formato das policies que já existem em `tasks`
-- (`uid()` e `_is_admin()` são os auxiliares do projeto).
ALTER TABLE public.task_board_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_checklist_items   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_board_preferences_own ON public.task_board_preferences;
-- Preferência é estritamente pessoal: nem admin lê a dos outros. Não há nada
-- aqui que a Gestão de Equipe precise ver, e abrir por padrão seria expor
-- escolha de tela sem motivo.
CREATE POLICY task_board_preferences_own ON public.task_board_preferences
  FOR ALL USING (user_id = uid()) WITH CHECK (user_id = uid());

DROP POLICY IF EXISTS task_checklist_visivel ON public.task_checklist_items;
-- O checklist acompanha quem enxerga a tarefa — espelha `select_tasks`. Se
-- divergisse, alguém veria itens de uma tarefa que não pode abrir.
CREATE POLICY task_checklist_visivel ON public.task_checklist_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = task_id
         AND (t.user_id = uid() OR t.assigned_to = uid() OR _is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = task_id
         AND (t.user_id = uid() OR t.assigned_to = uid() OR _is_admin())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_board_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_checklist_items   TO authenticated;

COMMIT;
