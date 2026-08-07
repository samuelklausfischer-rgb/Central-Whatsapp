-- Tarefas ganham RESPONSÁVEL e PRAZO, e passam a poder existir sem contato.
--
-- Contexto: a tabela `tasks` e o Kanban em /crm existem desde o começo do
-- projeto, mas pela metade — a tarefa só nascia de dentro de uma conversa
-- (handleSaveTask no ChatWindow), `contact_id` era obrigatório, não havia como
-- dizer QUEM deve executar, e a tela nem link no menu tinha. Duas tarefas em
-- toda a base.
--
-- Pedido: as gerentes (Kezia e Raphaela, ambas já is_admin) precisam direcionar
-- tarefas para as pessoas usando essa mesma ferramenta.

-- 1. Colunas novas -----------------------------------------------------------

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date date;

COMMENT ON COLUMN public.tasks.assigned_to IS 'Quem deve executar. user_id continua sendo quem criou.';
COMMENT ON COLUMN public.tasks.due_date IS 'Prazo, opcional.';

-- Tarefa avulsa: nem toda tarefa nasce de uma conversa.
ALTER TABLE public.tasks ALTER COLUMN contact_id DROP NOT NULL;

-- Retrocompatibilidade: o que já existia era, na prática, tarefa de quem criou.
UPDATE public.tasks SET assigned_to = user_id WHERE assigned_to IS NULL;

-- Kanban filtra por responsável e por criador o tempo todo.
CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx ON public.tasks (assigned_to);
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON public.tasks (user_id);

-- 2. RLS ---------------------------------------------------------------------
--
-- ESTA É A PARTE QUE NÃO PODE FALTAR. As policies eram `user_id = uid() OR
-- _is_admin()`. Adicionar `assigned_to` sem mexer nelas entregaria a feature
-- quebrada: a pessoa direcionada NÃO ENXERGARIA a própria tarefa, porque não é
-- a criadora nem admin.

DROP POLICY IF EXISTS select_tasks ON public.tasks;
CREATE POLICY select_tasks ON public.tasks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR assigned_to = auth.uid() OR public._is_admin());

-- Quem recebeu precisa poder mover no Kanban (é o ponto da feature).
DROP POLICY IF EXISTS update_tasks ON public.tasks;
CREATE POLICY update_tasks ON public.tasks
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR assigned_to = auth.uid() OR public._is_admin())
  WITH CHECK (
    user_id = auth.uid() OR assigned_to = auth.uid() OR public._is_admin()
  );

-- Apagar continua com o criador e o admin. Quem recebeu conclui, não apaga.
DROP POLICY IF EXISTS delete_tasks ON public.tasks;
CREATE POLICY delete_tasks ON public.tasks
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public._is_admin());

-- O INSERT antigo exigia apenas estar logado: qualquer usuário podia gravar uma
-- linha com `user_id` de outra pessoa. Com `assigned_to` no jogo isso viraria
-- "qualquer um manda tarefa para qualquer um". Agora a regra é explícita:
-- direcionar para OUTRA pessoa é privilégio de admin; os demais só criam para si.
DROP POLICY IF EXISTS insert_tasks ON public.tasks;
CREATE POLICY insert_tasks ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      assigned_to IS NULL
      OR assigned_to = auth.uid()
      OR public._is_admin()
    )
  );

-- 3. Equipe disponível para receber tarefa -----------------------------------
--
-- get_device_team_members não serve: amarra a equipe ao departamento do
-- APARELHO, e tarefa avulsa não tem aparelho. A rota de usuários do app é
-- admin-only e passa por edge function. Daí uma leitura própria, mínima e
-- somente-leitura: só quem pode direcionar precisa da lista.

CREATE OR REPLACE FUNCTION public.get_task_assignees()
RETURNS TABLE (id uuid, name text, avatar_url text, department text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id, p.name, p.avatar_url, p.department
  FROM public.profiles p
  -- Perfis órfãos (sem nome e sem usuário) poluiriam o seletor.
  WHERE p.name IS NOT NULL AND btrim(p.name) <> ''
    -- Só admin enxerga a equipe inteira; os demais só a si mesmos, o que mantém
    -- o seletor coerente com o que a policy de INSERT deixa gravar.
    AND (public._is_admin() OR p.id = auth.uid())
  ORDER BY p.name;
$function$;

REVOKE ALL ON FUNCTION public.get_task_assignees() FROM public;
GRANT EXECUTE ON FUNCTION public.get_task_assignees() TO authenticated;
