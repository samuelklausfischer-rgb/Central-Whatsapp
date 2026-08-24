-- Item 1 da fila do Hub: sistema de Agendas. Não existia nada de agenda no
-- banco — é subsistema novo, do zero.
--
-- V1 SEM RECORRÊNCIA, decidido com o usuário. Evento que se repete exige
-- expandir ocorrências, decidir "editar só esta ou todas" e lidar com fuso —
-- sozinho custa quase tanto quanto todo o resto, e é onde mora a maior parte
-- dos bugs de calendário. Fica para uma segunda leva.
--
-- TRÊS ESCOPOS numa tabela só, e não três tabelas: o pedido inclui um modo que
-- mostra "tudo junto", e com tabelas separadas esse modo viraria UNION de três
-- consultas com paginação e ordenação próprias. Uma tabela com `escopo`
-- resolve os quatro modos de visualização como filtro.
--
-- O SETOR casa com `profiles.department`, que é o campo que o app já usa para
-- setor (ver `canAccessFinanceiroTools`). Guardado como texto, e não como FK,
-- porque não existe tabela de setores — inventar uma aqui seria mudar o
-- cadastro de gente por causa da agenda.

BEGIN;

CREATE TABLE IF NOT EXISTS public.agenda_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agenda_group_members (
  group_id uuid NOT NULL REFERENCES public.agenda_groups(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.agenda_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  descricao   text,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  dia_inteiro boolean NOT NULL DEFAULT false,
  -- Grau de importância pedido no item.
  importancia text NOT NULL DEFAULT 'normal'
    CHECK (importancia IN ('baixa', 'normal', 'alta', 'urgente')),
  -- Link e e-mail que o compromisso pode carregar.
  link  text,
  email text,
  escopo text NOT NULL CHECK (escopo IN ('usuario', 'setor', 'grupo')),
  -- Preenchido conforme o escopo; a consistência entre os dois é garantida
  -- pelo CHECK abaixo, para não existir evento de grupo sem grupo.
  setor    text,
  group_id uuid REFERENCES public.agenda_groups(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Quem deve cumprir. Nulo = é do próprio criador.
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_events_fim_depois_do_inicio CHECK (ends_at >= starts_at),
  CONSTRAINT agenda_events_alvo_do_escopo CHECK (
    (escopo = 'setor' AND setor IS NOT NULL) OR
    (escopo = 'grupo' AND group_id IS NOT NULL) OR
    (escopo = 'usuario')
  )
);

-- A consulta da tela é sempre "eventos deste intervalo", então o índice é por
-- início. `escopo` junto porque os quatro modos filtram por ele.
CREATE INDEX IF NOT EXISTS agenda_events_periodo_idx ON public.agenda_events (starts_at, escopo);
CREATE INDEX IF NOT EXISTS agenda_events_dono_idx ON public.agenda_events (created_by, assigned_to);

-- ————————————————————————————————————————————————————————————————
-- Quem enxerga o quê
-- ————————————————————————————————————————————————————————————————

ALTER TABLE public.agenda_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_events        ENABLE ROW LEVEL SECURITY;

-- Grupos: quem criou e quem participa enxergam; qualquer pessoa pode criar.
DROP POLICY IF EXISTS agenda_groups_ver ON public.agenda_groups;
CREATE POLICY agenda_groups_ver ON public.agenda_groups FOR SELECT USING (
  created_by = uid()
  OR EXISTS (SELECT 1 FROM public.agenda_group_members m
              WHERE m.group_id = id AND m.user_id = uid())
  OR _is_admin()
);

DROP POLICY IF EXISTS agenda_groups_criar ON public.agenda_groups;
CREATE POLICY agenda_groups_criar ON public.agenda_groups FOR INSERT
  WITH CHECK (created_by = uid());

DROP POLICY IF EXISTS agenda_groups_mexer ON public.agenda_groups;
CREATE POLICY agenda_groups_mexer ON public.agenda_groups FOR UPDATE
  USING (created_by = uid() OR _is_admin());

DROP POLICY IF EXISTS agenda_groups_apagar ON public.agenda_groups;
CREATE POLICY agenda_groups_apagar ON public.agenda_groups FOR DELETE
  USING (created_by = uid() OR _is_admin());

-- Participantes: quem é do grupo vê a lista; quem criou o grupo mexe nela.
DROP POLICY IF EXISTS agenda_membros_ver ON public.agenda_group_members;
CREATE POLICY agenda_membros_ver ON public.agenda_group_members FOR SELECT USING (
  user_id = uid()
  OR EXISTS (SELECT 1 FROM public.agenda_groups g
              WHERE g.id = group_id AND (g.created_by = uid()
                OR EXISTS (SELECT 1 FROM public.agenda_group_members m2
                            WHERE m2.group_id = g.id AND m2.user_id = uid())))
  OR _is_admin()
);

DROP POLICY IF EXISTS agenda_membros_mexer ON public.agenda_group_members;
CREATE POLICY agenda_membros_mexer ON public.agenda_group_members FOR ALL USING (
  EXISTS (SELECT 1 FROM public.agenda_groups g WHERE g.id = group_id AND g.created_by = uid())
  OR _is_admin()
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.agenda_groups g WHERE g.id = group_id AND g.created_by = uid())
  OR _is_admin()
);

-- Eventos. É aqui que os quatro modos de visualização ganham sentido: a policy
-- decide o que EXISTE para a pessoa, e a tela só filtra dentro disso.
DROP POLICY IF EXISTS agenda_events_ver ON public.agenda_events;
CREATE POLICY agenda_events_ver ON public.agenda_events FOR SELECT USING (
  created_by = uid()
  OR assigned_to = uid()
  OR (escopo = 'setor' AND setor IS NOT NULL
      AND setor = (SELECT p.department FROM public.profiles p WHERE p.id = uid()))
  OR (escopo = 'grupo' AND EXISTS (
        SELECT 1 FROM public.agenda_group_members m
         WHERE m.group_id = agenda_events.group_id AND m.user_id = uid()))
  OR _is_admin()
);

-- "Quem poderá criar? Todos." — do próprio relato.
DROP POLICY IF EXISTS agenda_events_criar ON public.agenda_events;
CREATE POLICY agenda_events_criar ON public.agenda_events FOR INSERT
  WITH CHECK (created_by = uid());

DROP POLICY IF EXISTS agenda_events_mexer ON public.agenda_events;
CREATE POLICY agenda_events_mexer ON public.agenda_events FOR UPDATE
  USING (created_by = uid() OR assigned_to = uid() OR _is_admin());

DROP POLICY IF EXISTS agenda_events_apagar ON public.agenda_events;
CREATE POLICY agenda_events_apagar ON public.agenda_events FOR DELETE
  USING (created_by = uid() OR _is_admin());

-- ————————————————————————————————————————————————————————————————
-- Designar para outra pessoa: só admin, e só dentro do próprio setor
-- ————————————————————————————————————————————————————————————————
--
-- Esta é a única regra do item que NÃO cabe numa policy: depende de comparar o
-- setor de DUAS pessoas (quem designa e quem recebe), e uma policy de INSERT só
-- enxerga a linha que está entrando. Num gatilho ela pode ser conferida de
-- verdade, e vale igual para insert e update.
--
-- Super-admin escapa da checagem de setor de propósito: é o papel que já
-- atravessa setor em todo o resto do app.
CREATE OR REPLACE FUNCTION public.agenda_conferir_designacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_setor_de_quem_designa text;
  v_setor_do_designado    text;
  v_admin       boolean;
  v_super_admin boolean;
BEGIN
  -- Sem designação, ou designando para si mesmo: nada a conferir.
  IF NEW.assigned_to IS NULL OR NEW.assigned_to = uid() THEN
    RETURN NEW;
  END IF;

  SELECT p.department, COALESCE(p.is_admin, false), COALESCE(p.is_super_admin, false)
    INTO v_setor_de_quem_designa, v_admin, v_super_admin
    FROM profiles p WHERE p.id = uid();

  IF NOT v_admin THEN
    RAISE EXCEPTION 'Só administradores podem designar um compromisso para outra pessoa.';
  END IF;

  IF v_super_admin THEN
    RETURN NEW;
  END IF;

  SELECT p.department INTO v_setor_do_designado
    FROM profiles p WHERE p.id = NEW.assigned_to;

  IF v_setor_do_designado IS DISTINCT FROM v_setor_de_quem_designa THEN
    RAISE EXCEPTION 'Um administrador só pode designar para alguém do próprio setor.';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS agenda_events_designacao ON public.agenda_events;
CREATE TRIGGER agenda_events_designacao
  BEFORE INSERT OR UPDATE OF assigned_to ON public.agenda_events
  FOR EACH ROW EXECUTE FUNCTION public.agenda_conferir_designacao();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_groups        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_group_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_events        TO authenticated;

COMMIT;
