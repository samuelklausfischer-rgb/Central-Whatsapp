-- Agenda: sai a recursão de RLS, entram grupos com convite no Outlook.
--
-- O QUE ESTAVA QUEBRADO
-- `select` em QUALQUER uma das três tabelas da agenda estourava com
-- "infinite recursion detected in policy for relation agenda_group_members".
-- Não era só o grupo: `agenda_events_ver` também consultava a tabela de
-- membros, então a tabela de compromissos inteira ia junto. É por isso que
-- `agenda_events` tinha ZERO linhas — nunca foi possível gravar nem ler.
--
-- O ciclo tinha duas voltas:
--   1. `agenda_membros_ver` fazia EXISTS sobre `agenda_group_members m2` — ou
--      seja, sobre a própria tabela cuja policy estava sendo avaliada;
--   2. e consultava `agenda_groups`, cuja policy voltava a consultar
--      `agenda_group_members`.
--
-- A SAÍDA
-- Função SECURITY DEFINER, que roda com os privilégios do dono e NÃO reavalia
-- RLS — cortando o ciclo. É o padrão que o projeto já usa em `_is_admin()`.

-- ---------------------------------------------------------------------------
-- 1. As duas perguntas que atravessam tabelas
-- ---------------------------------------------------------------------------

-- `STABLE` (e não VOLATILE) deixa o planejador chamar uma vez por consulta em
-- vez de uma vez por linha — numa policy, essa diferença é a consulta inteira.
CREATE OR REPLACE FUNCTION public._sou_membro_do_grupo(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.agenda_group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public._sou_dono_do_grupo(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.agenda_groups
    WHERE id = p_group_id AND created_by = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public._sou_membro_do_grupo(uuid) FROM public;
REVOKE ALL ON FUNCTION public._sou_dono_do_grupo(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public._sou_membro_do_grupo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._sou_dono_do_grupo(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Policies sem subconsulta entre tabelas
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS agenda_membros_ver ON public.agenda_group_members;
CREATE POLICY agenda_membros_ver ON public.agenda_group_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR public._sou_dono_do_grupo(group_id)
    OR public._sou_membro_do_grupo(group_id)
    OR public._is_admin()
  );

-- Quem mexe na lista de membros é o DONO do grupo. Membro comum vê, não altera.
DROP POLICY IF EXISTS agenda_membros_mexer ON public.agenda_group_members;
CREATE POLICY agenda_membros_mexer ON public.agenda_group_members
  FOR ALL
  USING (public._sou_dono_do_grupo(group_id) OR public._is_admin())
  WITH CHECK (public._sou_dono_do_grupo(group_id) OR public._is_admin());

DROP POLICY IF EXISTS agenda_groups_ver ON public.agenda_groups;
CREATE POLICY agenda_groups_ver ON public.agenda_groups
  FOR SELECT USING (
    created_by = auth.uid()
    OR public._sou_membro_do_grupo(id)
    OR public._is_admin()
  );

-- A de compromissos ia junto no estouro: o EXISTS sobre `agenda_group_members`
-- disparava a policy recursiva.
DROP POLICY IF EXISTS agenda_events_ver ON public.agenda_events;
CREATE POLICY agenda_events_ver ON public.agenda_events
  FOR SELECT USING (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR (
      escopo = 'setor'
      AND setor IS NOT NULL
      AND setor = (SELECT p.department FROM public.profiles p WHERE p.id = auth.uid())
    )
    OR (escopo = 'grupo' AND public._sou_membro_do_grupo(group_id))
    OR public._is_admin()
  );

-- ---------------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------------

-- A PK é (group_id, user_id) e já atende "fulano é membro deste grupo?".
-- Falta a pergunta inversa — "de quais grupos eu participo" —, que é a que a
-- tela de grupos faz o tempo todo.
CREATE INDEX IF NOT EXISTS agenda_group_members_user_idx
  ON public.agenda_group_members (user_id);

-- ---------------------------------------------------------------------------
-- 4. Vínculo com o compromisso no Outlook
-- ---------------------------------------------------------------------------
--
-- DUAS colunas, com papéis DIFERENTES — e trocá-las é o defeito que só
-- apareceria quando a segunda pessoa abrisse a agenda:
--
--   outlook_event_id  → o id NA CAIXA DO CRIADOR. Serve para editar e cancelar.
--                       É diferente em cada caixa de correio.
--   outlook_ical_uid  → o iCalUId, que é O MESMO em todas as caixas. É por ele
--                       que a tela deduplica: sem isso, quem foi convidado veria
--                       o compromisso duas vezes (a linha daqui e o evento lido
--                       do próprio Outlook), porque os `id` não bateriam.
ALTER TABLE public.agenda_events
  ADD COLUMN IF NOT EXISTS outlook_event_id text,
  ADD COLUMN IF NOT EXISTS outlook_ical_uid text;

COMMENT ON COLUMN public.agenda_events.outlook_event_id IS
  'Id do evento na caixa de quem criou. Para editar/cancelar via Graph.';
COMMENT ON COLUMN public.agenda_events.outlook_ical_uid IS
  'iCalUId — igual em TODAS as caixas. É a chave de deduplicação na tela.';

CREATE INDEX IF NOT EXISTS agenda_events_ical_idx
  ON public.agenda_events (outlook_ical_uid)
  WHERE outlook_ical_uid IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. A lista mínima de colegas
-- ---------------------------------------------------------------------------
--
-- `profiles` só é legível pelo próprio dono ou por admin
-- (policy `users_read_own_profile`) — então ninguém conseguiria escolher gente
-- para montar um grupo.
--
-- Em vez de afrouxar aquela policy (o que exporia e-mail, `is_admin`, telefone
-- e o resto), esta função devolve SÓ o necessário para montar um grupo: quem é,
-- de que setor, e se já conectou o Outlook. Nenhum e-mail sai daqui — a lista
-- de convite é resolvida no servidor, na hora de convidar.
CREATE OR REPLACE FUNCTION public.colegas()
RETURNS TABLE (id uuid, nome text, setor text, tem_outlook boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id,
    coalesce(p.name, '') AS nome,
    p.department AS setor,
    EXISTS (SELECT 1 FROM public.agenda_conexoes c WHERE c.user_id = p.id) AS tem_outlook
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
  ORDER BY coalesce(p.name, '');
$$;

REVOKE ALL ON FUNCTION public.colegas() FROM public;
GRANT EXECUTE ON FUNCTION public.colegas() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. O SEGUNDO defeito, que estava escondido atrás do primeiro
-- ---------------------------------------------------------------------------
--
-- Com a recursão resolvida, o INSERT em `agenda_events` continuava estourando:
-- "function uid() does not exist".
--
-- O gatilho `agenda_conferir_designacao()` é SECURITY DEFINER com
-- `SET search_path TO 'public'`, e chamava `uid()` SEM qualificar — mas `uid()`
-- mora em `auth`, que aquele search_path exclui.
--
-- Policies sobrevivem a isso porque guardam o OID da função no momento em que
-- são criadas. O corpo de uma função PL/pgSQL, não: é resolvido em tempo de
-- execução. E o PL/pgSQL prepara a expressão INTEIRA antes de avaliar, então
-- nem o curto-circuito do `OR` salvava — com `assigned_to` nulo o erro
-- acontecia igual, no parse.
--
-- Ou seja: TODO insert e update em `agenda_events` falhava, com ou sem RLS.
CREATE OR REPLACE FUNCTION public.agenda_conferir_designacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_setor_de_quem_designa text;
  v_setor_do_designado    text;
  v_admin       boolean;
  v_super_admin boolean;
BEGIN
  IF NEW.assigned_to IS NULL OR NEW.assigned_to = auth.uid() THEN
    RETURN NEW;
  END IF;

  SELECT p.department, COALESCE(p.is_admin, false), COALESCE(p.is_super_admin, false)
    INTO v_setor_de_quem_designa, v_admin, v_super_admin
    FROM profiles p WHERE p.id = auth.uid();

  IF NOT COALESCE(v_admin, false) THEN
    RAISE EXCEPTION 'So administradores podem designar um compromisso para outra pessoa.';
  END IF;

  IF v_super_admin THEN
    RETURN NEW;
  END IF;

  SELECT p.department INTO v_setor_do_designado FROM profiles p WHERE p.id = NEW.assigned_to;

  IF v_setor_do_designado IS DISTINCT FROM v_setor_de_quem_designa THEN
    RAISE EXCEPTION 'Um administrador so pode designar para alguem do proprio setor.';
  END IF;

  RETURN NEW;
END;
$function$;
