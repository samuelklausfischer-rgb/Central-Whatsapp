-- Caixa de notificações por usuário, e o aviso de compromisso novo.
--
-- POR QUE UMA TABELA NOVA
-- `app_broadcasts` é aviso do ADMIN para TODOS, e bloqueante. Notificação de
-- agendamento é para pessoas específicas e não deve interromper o que a pessoa
-- está fazendo. São coisas diferentes; juntá-las obrigaria uma das duas a
-- carregar campos que não usa.
--
-- Nasce genérica (`tipo`, `link`) de propósito: a Agenda é a primeira, mas
-- Tarefas e PRN Hub cabem aqui sem migration nova.

CREATE TABLE IF NOT EXISTS public.notificacoes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo      text NOT NULL,
  titulo    text NOT NULL,
  corpo     text,
  /** Para onde levar ao clicar. Rota do app, ex.: `/agenda?dia=2026-08-26`. */
  link      text,
  /**
   * O que a gerou (o compromisso, a tarefa...). SEM chave estrangeira DE
   * PROPÓSITO: se o compromisso for apagado, a notificação sobrevive — ela é o
   * registro de que o aviso foi dado. Apagar o histórico junto seria reescrever
   * o passado, e ninguém entenderia por que o sino "esqueceu".
   */
  origem_id uuid,
  criada_em timestamptz NOT NULL DEFAULT now(),
  lida_em   timestamptz
);

-- A pergunta que a tela faz o tempo todo é "quantas NÃO LIDAS eu tenho".
-- O índice parcial responde sem varrer o histórico inteiro.
CREATE INDEX IF NOT EXISTS notificacoes_nao_lidas_idx
  ON public.notificacoes (user_id, criada_em DESC)
  WHERE lida_em IS NULL;

CREATE INDEX IF NOT EXISTS notificacoes_user_idx
  ON public.notificacoes (user_id, criada_em DESC);

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notificacoes_ver ON public.notificacoes;
CREATE POLICY notificacoes_ver ON public.notificacoes
  FOR SELECT USING (user_id = auth.uid());

-- Só dá para marcar a PRÓPRIA como lida. O `WITH CHECK` repete a condição para
-- que ninguém possa, num update, transferir a notificação para outra pessoa.
DROP POLICY IF EXISTS notificacoes_marcar ON public.notificacoes;
CREATE POLICY notificacoes_marcar ON public.notificacoes
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Poder apagar as próprias é o que permite "limpar" a caixa.
DROP POLICY IF EXISTS notificacoes_apagar ON public.notificacoes;
CREATE POLICY notificacoes_apagar ON public.notificacoes
  FOR DELETE USING (user_id = auth.uid());

-- NENHUMA policy de INSERT: o cliente não cria notificação. Quem cria é o
-- gatilho abaixo, que roda como SECURITY DEFINER. Sem isso, qualquer pessoa
-- logada poderia forjar um aviso em nome do sistema.

-- ---------------------------------------------------------------------------
-- Quem é avisado quando nasce um compromisso
-- ---------------------------------------------------------------------------
--
-- NO BANCO, E NÃO NO FRONT: quem cria o compromisso não deve ser responsável
-- por avisar ninguém. Se amanhã um fluxo do n8n ou uma importação inserir em
-- `agenda_events`, a notificação sai igual. No front, sairia só quando o
-- caminho passasse por aquele botão.
--
-- `auth.uid()` QUALIFICADO. Esta função é SECURITY DEFINER com search_path
-- fixo em 'public', onde `uid()` não existe — ela mora em `auth`. Foi
-- exatamente assim que `agenda_conferir_designacao()` derrubava todo insert em
-- `agenda_events`: policies guardam o OID e sobrevivem, o corpo de uma função
-- PL/pgSQL não.
CREATE OR REPLACE FUNCTION public.notificar_novo_compromisso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_autor  text;
  v_quando text;
  v_link   text;
BEGIN
  SELECT coalesce(p.name, 'Alguém') INTO v_autor
    FROM profiles p WHERE p.id = NEW.created_by;

  -- Data no fuso de quem lê o app, não em UTC: "26/08 às 14:00" e não
  -- "26/08 às 17:00", que é o que o timestamptz cru mostraria.
  v_quando := to_char(NEW.starts_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI');
  v_link   := '/agenda?dia=' || to_char(NEW.starts_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD');

  -- Grupo: todos os membros, MENOS quem criou.
  IF NEW.escopo = 'grupo' AND NEW.group_id IS NOT NULL THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, corpo, link, origem_id)
    SELECT m.user_id, 'agenda',
           v_autor || ' marcou um compromisso no grupo',
           NEW.titulo || ' · ' || v_quando,
           v_link, NEW.id
    FROM agenda_group_members m
    WHERE m.group_id = NEW.group_id
      AND m.user_id IS DISTINCT FROM NEW.created_by;
  END IF;

  -- Setor: quem tem o mesmo `department`, MENOS quem criou.
  IF NEW.escopo = 'setor' AND NEW.setor IS NOT NULL THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, corpo, link, origem_id)
    SELECT p.id, 'agenda',
           v_autor || ' marcou um compromisso do setor ' || NEW.setor,
           NEW.titulo || ' · ' || v_quando,
           v_link, NEW.id
    FROM profiles p
    WHERE p.department = NEW.setor
      AND p.id IS DISTINCT FROM NEW.created_by;
  END IF;

  -- Designado: vale para QUALQUER escopo, inclusive pessoal — designar alguém é
  -- justamente o caso em que a pessoa precisa saber. Não avisa se a pessoa
  -- designou a si mesma.
  IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to IS DISTINCT FROM NEW.created_by THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, corpo, link, origem_id)
    VALUES (NEW.assigned_to, 'agenda',
            v_autor || ' designou um compromisso para você',
            NEW.titulo || ' · ' || v_quando,
            v_link, NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agenda_events_notificar ON public.agenda_events;
CREATE TRIGGER agenda_events_notificar
  AFTER INSERT ON public.agenda_events
  FOR EACH ROW EXECUTE FUNCTION public.notificar_novo_compromisso();

-- O sino precisa saber na hora, sem a pessoa recarregar nada.
ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes;
