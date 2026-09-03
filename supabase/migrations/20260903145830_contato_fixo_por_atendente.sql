-- Contato fixo: amarrar um contato a um atendente, com verificação de presença.
--
-- Pedido (Samuel, 02/09/2026): "no setor financeiro surgiu uma ideia [...]
-- poder marcar aquele contato ligado ao usuário X, ou seja, toda vez que aquele
-- usuário mandar msg ele já vai direto para aquela pessoa [...] porém tem que
-- ser desenvolvido de forma inteligente para que essa ligação seja funcional a
-- partir se aquele usuário está conectado ao sistema; se não tiver, outro
-- usuário pode responder aquele ctt para não deixar ele sem resposta."
--
-- Refinado com ele em 03/09/2026:
--   · quem pode fixar: qualquer atendente com acesso ao aparelho (não só admin)
--   · dono OFFLINE: a conversa vai para 'waiting' (aguardando) — NÃO fica solta
--     em 'open'. "Se está disponível deve ficar fixado para o usuário x, se não
--     deve ir para aguardando."
--   · escopo: só conversa 1:1. Grupo não.
--
-- É "uma pegada automática", nas palavras dele: o efeito é o mesmo de a pessoa
-- ter clicado em Pegar, só que sem clicar.

-- ===========================================================================
-- PARTE 1 — quem é dono de qual contato
-- ===========================================================================
--
-- POR QUE UMA TABELA NOVA, E NÃO UMA COLUNA EM `conversation_assignments`
-- São coisas com tempo de vida diferente. `conversation_assignments` é o estado
-- do ATENDIMENTO de agora — tem 'finished', é zerada quando a conversa reabre,
-- e a própria trigger abaixo mexe nela o tempo todo. O vínculo fixo precisa
-- sobreviver a tudo isso: continuar valendo depois de finalizar, de reabrir, e
-- de meses sem contato. Guardar os dois na mesma linha faria o vínculo ser
-- apagado pelos mesmos `update`s que zeram a atribuição.
CREATE TABLE IF NOT EXISTS public.contact_owners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     uuid NOT NULL REFERENCES public.devices(id)  ON DELETE CASCADE,
  remote_sender text NOT NULL,
  owner_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  set_by        uuid          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, remote_sender),
  -- Grupo não entra, e o banco é quem garante. Em grupo várias pessoas
  -- respondem; um "dono" do grupo inteiro não faz sentido — é a mesma decisão
  -- já tomada em `atribuir_conversa_ao_responder`.
  CONSTRAINT contact_owners_sem_grupo CHECK (remote_sender NOT LIKE '%@g.us')
);

COMMENT ON TABLE public.contact_owners IS
  'Vínculo permanente contato -> atendente. Sobrevive a finalizar/reabrir a
   conversa, ao contrário de conversation_assignments. Só 1:1, nunca grupo.';

ALTER TABLE public.contact_owners ENABLE ROW LEVEL SECURITY;

-- Leitura/escrita para quem tem acesso ao aparelho — mesma régua de
-- `conversation_assignments`, via a função que já existe.
CREATE POLICY "contact_owners_select" ON public.contact_owners
  FOR SELECT TO authenticated USING (public.can_access_device(device_id));

-- Sem policy de INSERT/UPDATE/DELETE de propósito: toda escrita passa pelas
-- RPCs abaixo, que registram QUEM fixou (`set_by`). Escrita direta da tabela
-- deixaria esse rastro em branco.

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_contact_owner(
  p_device_id     uuid,
  p_remote_sender text,
  p_owner_id      uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_device(p_device_id) THEN
    RAISE EXCEPTION 'Acesso negado a este aparelho';
  END IF;

  -- O dono precisa ter acesso ao aparelho, senão fixaríamos a conversa em
  -- alguém que não consegue nem abri-la — a conversa ficaria presa.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_allowed_devices
    WHERE device_id = p_device_id AND user_id = p_owner_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_owner_id AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Essa pessoa não tem acesso a este aparelho';
  END IF;

  IF p_remote_sender LIKE '%@g.us' THEN
    RAISE EXCEPTION 'Grupo não pode ter contato fixo';
  END IF;

  INSERT INTO public.contact_owners (device_id, remote_sender, owner_id, set_by)
  VALUES (p_device_id, p_remote_sender, p_owner_id, auth.uid())
  ON CONFLICT (device_id, remote_sender) DO UPDATE SET
    owner_id   = excluded.owner_id,
    set_by     = auth.uid(),
    updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_contact_owner(
  p_device_id     uuid,
  p_remote_sender text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_device(p_device_id) THEN
    RAISE EXCEPTION 'Acesso negado a este aparelho';
  END IF;

  DELETE FROM public.contact_owners
  WHERE device_id = p_device_id AND remote_sender = p_remote_sender;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_contact_owner(uuid, text, uuid)   FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.clear_contact_owner(uuid, text)       FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.set_contact_owner(uuid, text, uuid)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.clear_contact_owner(uuid, text)       TO authenticated;

-- ===========================================================================
-- PARTE 2 — quem está online agora
-- ===========================================================================
--
-- `user_app_sessions` é legível só por super-admin, de propósito (ver
-- 20260728093000_user_app_activity.sql) — é dado de quanto cada pessoa fica no
-- app. A tela do chat só precisa saber "está online?", então a RPC devolve um
-- booleano e nada mais: nem `last_seen_at`, nem tempo de uso, nem plataforma.
--
-- TRÊS MINUTOS porque o heartbeat bate a cada 120s. Dois minutos marcariam
-- offline quem perdeu uma única batida (aba em segundo plano, rede oscilando);
-- três dá folga para uma falha sem fingir que alguém que fechou o app continua
-- disponível.
CREATE OR REPLACE FUNCTION public.is_profile_online(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_app_sessions
    WHERE user_id = p_user_id
      AND last_seen_at > now() - interval '3 minutes'
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.is_profile_online(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.is_profile_online(uuid) TO authenticated;

-- ===========================================================================
-- PARTE 3 — o roteamento
-- ===========================================================================
--
-- POR QUE ESTENDER `processar_mensagem_para_atendimento`, E NÃO CRIAR UMA
-- TERCEIRA TRIGGER
--
-- `messages` já tem DUAS triggers `AFTER INSERT`: esta e
-- `atribuir_conversa_ao_responder`. Elas disparam em ordem ALFABÉTICA, e isso
-- já produziu um bug real e medido — `atribuir_...` roda antes e tira o status
-- de 'finished', fazendo o `where status = 'finished'` desta aqui não casar
-- mais, o que parou de marcar `global_read_at` (ver o comentário longo em
-- 20260826125016 e a correção em 20260826132909).
--
-- Uma terceira trigger chamada, por exemplo, `aplicar_contato_fixo` cairia
-- ANTES das duas no alfabeto e mexeria em `conversation_assignments` antes de
-- ambas — reabrindo exatamente a mesma classe de bug, agora com três peças em
-- vez de duas. Estender esta função mantém uma ordem única e explícita.
--
-- NOTA: o corpo abaixo é a definição VIVA em produção (lida com
-- `pg_get_functiondef` em 03/09/2026), preservada linha a linha, mais o bloco
-- novo marcado como "2b". A definição não estava em nenhuma migration deste
-- repositório — as partes 1 e 2 dela nasceram em 20260825191653 e foram
-- alteradas direto no banco depois.
CREATE OR REPLACE FUNCTION public.processar_mensagem_para_atendimento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_status         text;
  v_assigned_to    uuid;
  v_assigned_at    timestamptz;
  v_primeira_do_dia boolean;
  v_recente        boolean;
  v_eh_grupo       boolean;
  v_dono_fixo      uuid;
  v_dono_online    boolean;
begin
  -- Mensagem antiga (importacao/backfill) nao mexe em fila nem em pendencia.
  if NEW.created_at < now() - interval '1 hour' then
    return NEW;
  end if;

  v_eh_grupo := NEW.remote_sender like '%@g.us';

  -- 1. Reabrir conversa finalizada. Comportamento que ja existia, preservado.
  update public.conversation_assignments
  set status         = 'open',
      global_read_at = case when NEW.direction = 'outbound' then now() else null end,
      global_read_by = case when NEW.direction = 'outbound' then NEW.sender_id else null end,
      assigned_to    = null,
      assigned_by    = null,
      assigned_at    = null,
      updated_at     = now()
  where device_id     = NEW.device_id
    and remote_sender = NEW.remote_sender
    and status        = 'finished';

  if NEW.direction = 'inbound' then
    select status, assigned_to, assigned_at
      into v_status, v_assigned_to, v_assigned_at
    from public.conversation_assignments
    where device_id = NEW.device_id and remote_sender = NEW.remote_sender
    for update;

    -- "Dono recente" = pegou/foi designado ha menos de 7 dias. Conversa assim
    -- NAO volta para a fila: continua com quem estava cuidando dela.
    v_recente := v_status in ('taken','assigned')
                 and v_assigned_to is not null
                 and v_assigned_at > now() - interval '7 days';

    -- Primeira do dia no fuso de Sao Paulo, e nao em UTC: as 21h daqui ja e o
    -- dia seguinte em UTC, e a fila viraria de madrugada no horario errado.
    select not exists (
      select 1 from public.messages m
      where m.device_id     = NEW.device_id
        and m.remote_sender = NEW.remote_sender
        and m.direction     = 'inbound'
        and m.id           <> NEW.id
        and m.deleted_at is null
        and (m.created_at at time zone 'America/Sao_Paulo')::date
            = (NEW.created_at at time zone 'America/Sao_Paulo')::date
    ) into v_primeira_do_dia;

    -- =====================================================================
    -- 2b. CONTATO FIXO (novo em 03/09/2026)
    -- =====================================================================
    --
    -- Roda ANTES da fila do dia porque, quando existe dono fixo disponivel, o
    -- destino da conversa ja esta decidido e nao ha fila a formar.
    v_dono_fixo := null;

    if not v_eh_grupo then
      select owner_id into v_dono_fixo
      from public.contact_owners
      where device_id = NEW.device_id and remote_sender = NEW.remote_sender;
    end if;

    -- A guarda de "nunca rouba" vale para OUTRA pessoa: se um colega pegou a
    -- conversa nos ultimos 7 dias, ela continua com ele, e o vinculo fixo volta
    -- a valer no proximo ciclo -- sem puxar o contato do meio de um atendimento
    -- em andamento. Mesma regra da `atribuir_conversa_ao_responder`.
    --
    -- MAS se quem esta com a conversa e o PROPRIO dono fixo, a presenca dele
    -- precisa ser reavaliada a cada mensagem. A primeira versao desta migration
    -- nao fazia essa distincao, e o teste em transacao revertida pegou o
    -- defeito: uma vez entregue ao dono online, a conversa ficava presa nele
    -- mesmo depois de ele fechar o app -- exatamente o caso que o pedido manda
    -- mandar para 'aguardando'.
    if v_dono_fixo is not null and v_recente and v_assigned_to <> v_dono_fixo then
      v_dono_fixo := null;
    end if;

    if v_dono_fixo is not null then
      -- Disponibilidade agora. Consulta direta em `user_app_sessions` (a
      -- funcao e SECURITY DEFINER, entao nao esbarra na RLS de super-admin) —
      -- passar pela RPC `is_profile_online` aqui seria uma chamada a mais
      -- dentro de um gatilho que roda em TODA mensagem recebida.
      select exists (
        select 1 from public.user_app_sessions
        where user_id = v_dono_fixo
          and last_seen_at > now() - interval '3 minutes'
      ) into v_dono_online;

      if v_dono_online then
        -- Online: entrega direto. 'assigned' e nao 'taken' porque ninguem
        -- clicou em Pegar — foi o sistema que designou. `assigned_by` nulo e o
        -- que distingue atribuicao automatica de designacao feita por alguem.
        insert into public.conversation_assignments (
          device_id, remote_sender, status,
          assigned_to, assigned_by, assigned_at,
          global_read_at, global_read_by, updated_at
        )
        values (
          NEW.device_id, NEW.remote_sender, 'assigned',
          v_dono_fixo, null, now(),
          null, null, now()
        )
        on conflict (device_id, remote_sender) do update set
          status         = 'assigned',
          assigned_to    = v_dono_fixo,
          assigned_by    = null,
          assigned_at    = now(),
          global_read_at = null,
          global_read_by = null,
          updated_at     = now();
      else
        -- Offline: 'waiting', nao 'open'. Decisao explicita do Samuel — o
        -- contato fica aguardando em vez de cair na fila geral como se nao
        -- tivesse dono. Qualquer atendente ainda pode Pegar na mao, entao
        -- ninguem fica sem resposta; o que muda e o app parar de fingir que
        -- aquele contato nao tem responsavel.
        insert into public.conversation_assignments (
          device_id, remote_sender, status, updated_at
        )
        values (NEW.device_id, NEW.remote_sender, 'waiting', now())
        on conflict (device_id, remote_sender) do update set
          status         = 'waiting',
          assigned_to    = null,
          assigned_by    = null,
          assigned_at    = null,
          global_read_at = null,
          global_read_by = null,
          updated_at     = now();
      end if;

    elsif v_primeira_do_dia and not v_recente then
      -- Fila do dia, como sempre foi. So entra quando NAO ha dono fixo
      -- decidindo o destino — senao os dois `update` brigariam pela mesma
      -- linha na mesma transacao.
      insert into public.conversation_assignments (device_id, remote_sender, status, updated_at)
      values (NEW.device_id, NEW.remote_sender, 'waiting', now())
      on conflict (device_id, remote_sender) do update set
        status         = 'waiting',
        assigned_to    = null,
        assigned_by    = null,
        assigned_at    = null,
        global_read_at = null,
        global_read_by = null,
        updated_at     = now();
    end if;

    if not v_eh_grupo then
      insert into public.conversation_pendencias (
        device_id, remote_sender, inbound_message_id, inbound_at
      )
      values (NEW.device_id, NEW.remote_sender, NEW.id, NEW.created_at)
      on conflict do nothing;
    end if;

  else
    -- Qualquer saida do time fecha o que estava esperando. `greatest(0, ...)`
    -- protege de relogio da Evolution vindo adiantado, que daria tempo negativo.
    update public.conversation_pendencias
    set responded_message_id = NEW.id,
        responded_at         = NEW.created_at,
        responded_by         = NEW.sender_id,
        response_seconds     = greatest(0, extract(epoch from (NEW.created_at - inbound_at))::int),
        updated_at           = now()
    where device_id     = NEW.device_id
      and remote_sender = NEW.remote_sender
      and responded_at is null;
  end if;

  return NEW;
end;
$function$;
