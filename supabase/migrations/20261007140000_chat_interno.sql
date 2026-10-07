-- Chat interno: conversa direta (1:1) e em grupo entre os usuários do app.
--
-- Pedido (Samuel, 07/10/2026): dentro da área do WhatsApp, uma opção "Chat
-- interno" — ver todos os usuários, mandar mensagem direta, criar grupos
-- escolhendo participantes (qualquer usuário pode criar), "funciona como o
-- WhatsApp, só que interno". MVP: texto, emoji, responder, anexos (imagem,
-- arquivo, áudio gravado) em bucket PRIVADO, contador de não lidas, som,
-- gerenciar membros do grupo. Fora do MVP (mas sem fechar a porta): reação,
-- edição, encaminhar.
--
-- REGRA DE PRIVACIDADE, a que manda em todo o desenho abaixo:
--   só quem é membro ATIVO lê uma conversa. Nem admin do app, nem super-admin.
--   Por isso nenhuma policy daqui chama `_is_admin()` — de propósito.
--
-- DEPENDÊNCIA DURA: `public.usuarios_desativados(user_id)`, criada pela
-- migration 20261007130000. As funções SQL abaixo referenciam a tabela no
-- corpo e o Postgres valida o corpo na criação (check_function_bodies=on), então
-- sem ela a migration falharia no meio. O guarda logo abaixo falha ANTES, com
-- mensagem clara, em vez de deixar metade criada.
--
-- Precisa ser aplicada como `supabase_admin` (é o papel do MCP): as policies
-- vão em `storage.objects`, cujo dono é `supabase_storage_admin`; o `postgres`
-- deste self-hosted não é superusuário e receberia "must be owner of table".

DO $guarda$
BEGIN
  IF to_regclass('public.usuarios_desativados') IS NULL THEN
    RAISE EXCEPTION 'chat_interno depende de public.usuarios_desativados (migration 20261007130000). Aplique aquela primeiro.';
  END IF;
END
$guarda$;

-- ===========================================================================
-- PARTE 1 — tabelas
-- ===========================================================================
--
-- Por que `profiles(id)` e não `auth.users(id)` nas FKs: é a convenção do
-- repositório (ver contact_owners) e `profiles.id` já cai em cascata quando o
-- usuário some de `auth.users` — o efeito final é o mesmo. E o diretório do
-- chat sai de `profiles`, então todo participante possível tem perfil.

CREATE TABLE IF NOT EXISTS public.chat_interno_conversas (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                      text NOT NULL CHECK (tipo IN ('direta', 'grupo')),
  -- Só grupo tem nome. Na direta o nome exibido é o da outra pessoa, e é
  -- calculado na leitura (chat_interno_conversas_resumo) — se a pessoa mudar
  -- de nome, a conversa acompanha.
  nome                      text,
  -- Par ordenado 'uuidMenor:uuidMaior'. O UNIQUE é o que torna "abrir
  -- conversa com fulano" idempotente mesmo com dois cliques simultâneos dos
  -- dois lados: só uma linha consegue nascer. Nulo em grupo (UNIQUE aceita
  -- vários nulos).
  direta_chave              text UNIQUE,
  criado_por                uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  atualizado_em             timestamptz NOT NULL DEFAULT now(),
  -- Desnormalizado pelo gatilho de mensagens. Sem isto, a lista de conversas
  -- teria de buscar a última mensagem de cada conversa a cada abertura.
  ultima_mensagem_id        uuid,
  ultima_mensagem_em        timestamptz,
  ultima_mensagem_preview   text,
  ultima_mensagem_autor_id  uuid,
  ultima_mensagem_tipo      text,
  CONSTRAINT chat_interno_conversas_forma CHECK (
    (tipo = 'direta' AND direta_chave IS NOT NULL AND nome IS NULL)
    OR (tipo = 'grupo' AND direta_chave IS NULL AND nome IS NOT NULL
        AND char_length(btrim(nome)) BETWEEN 1 AND 80)
  ),
  CONSTRAINT chat_interno_conversas_preview_curto CHECK (char_length(ultima_mensagem_preview) <= 140)
);

COMMENT ON TABLE public.chat_interno_conversas IS
  'Chat interno entre usuários do app. Leitura só por membro ativo (nem admin).
   Escrita só pelas RPCs chat_interno_*.';

CREATE TABLE IF NOT EXISTS public.chat_interno_membros (
  conversa_id        uuid NOT NULL REFERENCES public.chat_interno_conversas(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  papel              text NOT NULL DEFAULT 'membro' CHECK (papel IN ('admin', 'membro')),
  -- Quem entra num grupo só vê o que foi dito DEPOIS de entrar — como no
  -- WhatsApp. A policy de mensagens compara criado_em >= entrou_em. Ao ser
  -- readicionado, entrou_em é renovado: o que se disse enquanto a pessoa
  -- estava fora continua fora do alcance dela.
  entrou_em          timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Saída é "soft": a linha fica (histórico de quem participou) e a pessoa
  -- perde o acesso na hora, porque toda checagem exige saiu_em IS NULL.
  saiu_em            timestamptz,
  -- Não lidas = mensagens de outros com criado_em > ultima_leitura_em.
  ultima_leitura_em  timestamptz NOT NULL DEFAULT clock_timestamp(),
  silenciada         boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversa_id, user_id)
);

-- A PK (conversa_id, user_id) atende a checagem de membro (RLS e Realtime);
-- este índice atende "minhas conversas" (resumo, total de não lidas) e a
-- cascata quando um perfil é apagado.
CREATE INDEX IF NOT EXISTS chat_interno_membros_user_idx
  ON public.chat_interno_membros (user_id);

CREATE TABLE IF NOT EXISTS public.chat_interno_mensagens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id        uuid NOT NULL REFERENCES public.chat_interno_conversas(id) ON DELETE CASCADE,
  -- SET NULL: a mensagem sobrevive ao autor ser apagado. A conversa dos
  -- outros não pode ficar com buracos porque alguém saiu da empresa.
  autor_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  tipo               text NOT NULL CHECK (tipo IN ('texto', 'imagem', 'arquivo', 'audio', 'sistema')),
  -- Texto da mensagem, ou legenda do anexo (opcional), ou o texto do evento
  -- de sistema ("Fulano adicionou Beltrano").
  conteudo           text,
  -- Caminho no bucket privado 'chat-interno': '<conversa_id>/<uuid>-<nome>'.
  anexo_path         text,
  anexo_nome         text,
  anexo_mime         text,
  anexo_tamanho      bigint,
  anexo_duracao_seg  integer,
  responde_a         uuid REFERENCES public.chat_interno_mensagens(id) ON DELETE SET NULL,
  -- Chave de idempotência gerada no cliente. Reenvio (rede caiu depois do
  -- INSERT mas antes da resposta) devolve a mesma linha em vez de duplicar.
  client_id          uuid,
  -- clock_timestamp(), não now(): as RPCs de grupo gravam a mensagem de
  -- sistema na mesma transação em que mexem nos membros, e now() daria o
  -- mesmo instante a tudo — a ordenação ficaria ambígua. Pelo mesmo motivo
  -- entrou_em/saiu_em/ultima_leitura_em dos membros também usam
  -- clock_timestamp(): "entrou antes ou depois desta mensagem" fica exato.
  criado_em          timestamptz NOT NULL DEFAULT clock_timestamp(),
  editada_em         timestamptz,
  -- Apagar é "soft": a linha fica (vira "Mensagem apagada"), o conteúdo some.
  -- Hard delete não serve com Realtime: o evento de DELETE só leva a PK e,
  -- pior, é entregue a TODO assinante da tabela sem passar pela RLS.
  apagada_em         timestamptz,
  -- Constraint comum (não índice parcial): NULL é distinto de NULL, então
  -- mensagens sem client_id não colidem, e o ON CONFLICT funciona sem o
  -- WHERE que um índice parcial exigiria.
  CONSTRAINT chat_interno_mensagens_client_id_unico UNIQUE (autor_id, client_id),
  CONSTRAINT chat_interno_mensagens_conteudo_tamanho CHECK (char_length(conteudo) <= 10000),
  CONSTRAINT chat_interno_mensagens_forma CHECK (
    apagada_em IS NOT NULL
    OR (tipo IN ('texto', 'sistema') AND conteudo IS NOT NULL AND anexo_path IS NULL)
    OR (tipo IN ('imagem', 'arquivo', 'audio') AND anexo_path IS NOT NULL)
  )
);

COMMENT ON TABLE public.chat_interno_mensagens IS
  'Mensagens do chat interno. Publicada no Realtime; a RLS entrega cada evento
   só a membros ativos. Apagar é soft (apagada_em), nunca DELETE.';

-- Paginação da conversa (conversa_id = X ORDER BY criado_em DESC) e contagem
-- de não lidas (conversa_id = X AND criado_em > ultima_leitura_em).
CREATE INDEX IF NOT EXISTS chat_interno_mensagens_conversa_idx
  ON public.chat_interno_mensagens (conversa_id, criado_em DESC, id DESC);

-- O ON DELETE SET NULL de responde_a precisa achar as respostas de uma
-- mensagem apagada em cascata; sem índice seria um seq scan por mensagem.
CREATE INDEX IF NOT EXISTS chat_interno_mensagens_responde_a_idx
  ON public.chat_interno_mensagens (responde_a) WHERE responde_a IS NOT NULL;

ALTER TABLE public.chat_interno_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_interno_membros   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_interno_mensagens ENABLE ROW LEVEL SECURITY;

-- Os default privileges deste banco dão ALL a anon e authenticated em toda
-- tabela nova de public. Aqui só leitura, e só para authenticated: escrita
-- passa pelas RPCs, que validam membro, papel e anexo. Sem policy de escrita
-- E sem grant de escrita — duas travas.
REVOKE ALL ON public.chat_interno_conversas, public.chat_interno_membros, public.chat_interno_mensagens
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_interno_conversas, public.chat_interno_membros, public.chat_interno_mensagens
  TO authenticated;

-- ===========================================================================
-- PARTE 2 — funções de checagem (usadas pela RLS e pelo Storage)
-- ===========================================================================
--
-- SECURITY DEFINER para ler chat_interno_membros sem passar pela RLS dela
-- (que por sua vez chama estas funções — sem definer seria recursão).
-- Custo: uma busca pela PK (conversa_id, user_id) + uma pela PK de
-- usuarios_desativados. É o que o Realtime roda por evento e por assinante.

-- Desde quando EU posso ler esta conversa. NULL = não posso (não sou membro
-- ativo, ou fui desativado). A policy de mensagens usa isto direto:
-- `criado_em >= NULL` é falso.
CREATE OR REPLACE FUNCTION public.chat_interno_membro_desde(p_conversa uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT m.entrou_em
    FROM public.chat_interno_membros m
   WHERE m.conversa_id = p_conversa
     AND m.user_id = auth.uid()
     AND m.saiu_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.chat_interno_sou_membro(p_conversa uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.chat_interno_membros m
     WHERE m.conversa_id = p_conversa
       AND m.user_id = auth.uid()
       AND m.saiu_em IS NULL
  )
  AND NOT EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = auth.uid());
$function$;

-- Para as policies de storage.objects. plpgsql (e não um `AND` em SQL) porque
-- o Postgres não garante a ordem de avaliação de um AND: um `::uuid` sobre um
-- nome fora do padrão estouraria erro e derrubaria a listagem inteira, em vez
-- de simplesmente negar aquele objeto.
CREATE OR REPLACE FUNCTION public.chat_interno_pode_acessar_objeto(p_nome text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_nome IS NULL
     OR p_nome !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$' THEN
    RETURN false;
  END IF;
  RETURN public.chat_interno_sou_membro(split_part(p_nome, '/', 1)::uuid);
END
$function$;

-- ---------------------------------------------------------------------------
-- Auxiliares internas (só chamadas de dentro das RPCs SECURITY DEFINER; sem
-- grant para ninguém).

-- Quem está chamando. Barra anônimo, desativado e quem não tem perfil.
CREATE OR REPLACE FUNCTION public._chat_interno_eu()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu uuid := auth.uid();
BEGIN
  IF v_eu IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = v_eu) THEN
    RAISE EXCEPTION 'Usuário desativado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_eu) THEN
    RAISE EXCEPTION 'Perfil não encontrado' USING ERRCODE = '42501';
  END IF;
  RETURN v_eu;
END
$function$;

CREATE OR REPLACE FUNCTION public._chat_interno_ativo(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user)
     AND NOT EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = p_user);
$function$;

CREATE OR REPLACE FUNCTION public._chat_interno_nome(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT coalesce(nullif(btrim(p.name), ''), nullif(split_part(p.email, '@', 1), ''))
       FROM public.profiles p WHERE p.id = p_user),
    'Usuário removido'
  );
$function$;

CREATE OR REPLACE FUNCTION public._chat_interno_msg_sistema(p_conversa uuid, p_autor uuid, p_texto text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.chat_interno_mensagens (conversa_id, autor_id, tipo, conteudo)
  VALUES (p_conversa, p_autor, 'sistema', left(p_texto, 10000));
$function$;

-- Texto curto da lista de conversas. Sem emoji: o front sabe o tipo
-- (ultima_mensagem_tipo) e põe o ícone que quiser.
CREATE OR REPLACE FUNCTION public._chat_interno_preview(p_tipo text, p_conteudo text, p_anexo_nome text, p_apagada boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT left(
    CASE
      WHEN p_apagada         THEN 'Mensagem apagada'
      WHEN p_tipo = 'imagem'  THEN coalesce(nullif(regexp_replace(btrim(coalesce(p_conteudo, '')), '\s+', ' ', 'g'), ''), 'Foto')
      WHEN p_tipo = 'audio'   THEN 'Áudio'
      WHEN p_tipo = 'arquivo' THEN coalesce(nullif(btrim(coalesce(p_anexo_nome, '')), ''), 'Arquivo')
      ELSE regexp_replace(btrim(coalesce(p_conteudo, '')), '\s+', ' ', 'g')
    END,
    140
  );
$function$;

-- ===========================================================================
-- PARTE 3 — RLS
-- ===========================================================================

DROP POLICY IF EXISTS chat_interno_conversas_select ON public.chat_interno_conversas;
CREATE POLICY chat_interno_conversas_select ON public.chat_interno_conversas
  FOR SELECT TO authenticated
  USING (public.chat_interno_sou_membro(id));

-- Membro vê os outros membros (e o ultima_leitura_em deles — base para um
-- futuro "lida por").
DROP POLICY IF EXISTS chat_interno_membros_select ON public.chat_interno_membros;
CREATE POLICY chat_interno_membros_select ON public.chat_interno_membros
  FOR SELECT TO authenticated
  USING (public.chat_interno_sou_membro(conversa_id));

-- Esta é a policy que o Realtime avalia por evento e por assinante (ele roda
-- `select exists(... where id = <pk>)` com o papel e o JWT de cada um). Por
-- isso uma função só, com duas buscas por PK — nada de join ou subquery
-- que cresça com a tabela.
DROP POLICY IF EXISTS chat_interno_mensagens_select ON public.chat_interno_mensagens;
CREATE POLICY chat_interno_mensagens_select ON public.chat_interno_mensagens
  FOR SELECT TO authenticated
  USING (criado_em >= public.chat_interno_membro_desde(conversa_id));

-- Sem policy de INSERT/UPDATE/DELETE em nenhuma das três: toda escrita é RPC.

-- ===========================================================================
-- PARTE 4 — gatilho: a conversa acompanha a última mensagem
-- ===========================================================================
--
-- Gatilho (e não código em cada RPC) porque mensagem nasce em vários lugares:
-- enviar, e as mensagens de sistema de criar grupo, adicionar, remover, sair,
-- renomear. Um ponto só garante que a lista de conversas nunca fica para trás.
CREATE OR REPLACE FUNCTION public._chat_interno_mensagem_atualiza_conversa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.chat_interno_conversas c
       SET ultima_mensagem_id       = NEW.id,
           ultima_mensagem_em       = NEW.criado_em,
           ultima_mensagem_preview  = public._chat_interno_preview(NEW.tipo, NEW.conteudo, NEW.anexo_nome, NEW.apagada_em IS NOT NULL),
           ultima_mensagem_autor_id = NEW.autor_id,
           ultima_mensagem_tipo     = NEW.tipo,
           atualizado_em            = now()
     WHERE c.id = NEW.conversa_id
       -- Duas mensagens concorrentes: vence a mais nova, não a última a commitar.
       AND (c.ultima_mensagem_em IS NULL OR c.ultima_mensagem_em <= NEW.criado_em);
  ELSIF NEW.apagada_em IS NOT NULL AND OLD.apagada_em IS NULL THEN
    UPDATE public.chat_interno_conversas c
       SET ultima_mensagem_preview = 'Mensagem apagada',
           atualizado_em           = now()
     WHERE c.id = NEW.conversa_id
       AND c.ultima_mensagem_id = NEW.id;
  END IF;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE TRIGGER chat_interno_mensagens_atualiza_conversa
  AFTER INSERT OR UPDATE OF apagada_em ON public.chat_interno_mensagens
  FOR EACH ROW EXECUTE FUNCTION public._chat_interno_mensagem_atualiza_conversa();

-- ===========================================================================
-- PARTE 5 — RPCs
-- ===========================================================================
--
-- Todas: SECURITY DEFINER, search_path fixo, `auth.uid()` qualificado (um
-- `uid()` sem schema já quebrou insert neste banco), e começam por
-- `_chat_interno_eu()` — que barra anônimo e desativado.
--
-- Erros: o texto da mensagem é o contrato com o front (é o que aparece no
-- toast). ERRCODE: 28000 sem login · 42501 sem permissão · P0002 não achado
-- (inclusive "não sou membro" — não confirmamos que a conversa existe para
-- quem não participa) · 22023 entrada inválida.

-- Diretório: todo usuário ativo, menos eu. `colegas()` não serve: não traz
-- avatar e não exclui desativado.
-- SEM e-mail de propósito: parte dos perfis usa endereço pessoal (@gmail,
-- @hotmail), e a tela só precisa de nome e setor para distinguir as pessoas.
CREATE OR REPLACE FUNCTION public.chat_interno_diretorio()
RETURNS TABLE(id uuid, nome text, setor text, avatar_url text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_eu uuid := public._chat_interno_eu();
BEGIN
  RETURN QUERY
  SELECT p.id,
         coalesce(nullif(btrim(p.name), ''), nullif(split_part(p.email, '@', 1), ''), '') AS nome,
         p.department,
         p.avatar_url
    FROM public.profiles p
   WHERE p.id <> v_eu
     AND NOT EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = p.id)
   ORDER BY lower(coalesce(nullif(btrim(p.name), ''), nullif(split_part(p.email, '@', 1), ''), '')), p.id;
END
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_interno_abrir_direta(p_outro uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu    uuid := public._chat_interno_eu();
  v_chave text;
  v_id    uuid;
BEGIN
  IF p_outro IS NULL OR p_outro = v_eu THEN
    RAISE EXCEPTION 'Escolha outra pessoa para conversar' USING ERRCODE = '22023';
  END IF;
  IF NOT public._chat_interno_ativo(p_outro) THEN
    RAISE EXCEPTION 'Usuário não encontrado ou desativado' USING ERRCODE = 'P0002';
  END IF;

  v_chave := least(v_eu::text, p_outro::text) || ':' || greatest(v_eu::text, p_outro::text);

  INSERT INTO public.chat_interno_conversas (tipo, direta_chave, criado_por)
  VALUES ('direta', v_chave, v_eu)
  ON CONFLICT (direta_chave) DO NOTHING
  RETURNING chat_interno_conversas.id INTO v_id;

  IF v_id IS NULL THEN
    SELECT c.id INTO v_id FROM public.chat_interno_conversas c WHERE c.direta_chave = v_chave;
  END IF;

  -- Direta não tem "sair", então membro que já existe fica como está
  -- (inclusive entrou_em: o histórico continua visível).
  INSERT INTO public.chat_interno_membros (conversa_id, user_id, papel, entrou_em, ultima_leitura_em)
  VALUES (v_id, v_eu, 'membro', clock_timestamp(), clock_timestamp()),
         (v_id, p_outro, 'membro', clock_timestamp(), clock_timestamp())
  ON CONFLICT (conversa_id, user_id) DO NOTHING;

  RETURN v_id;
END
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_interno_criar_grupo(p_nome text, p_membros uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu        uuid := public._chat_interno_eu();
  v_nome      text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_ids       uuid[];
  v_invalidos text;
  v_id        uuid;
BEGIN
  IF char_length(v_nome) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Informe um nome de grupo com até 80 caracteres' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_ids
    FROM unnest(coalesce(p_membros, '{}'::uuid[])) AS u
   WHERE u IS NOT NULL AND u <> v_eu;

  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos uma pessoa para o grupo' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) > 255 THEN
    RAISE EXCEPTION 'Um grupo pode ter no máximo 256 pessoas' USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(u::text, ', ') INTO v_invalidos
    FROM unnest(v_ids) AS u WHERE NOT public._chat_interno_ativo(u);
  IF v_invalidos IS NOT NULL THEN
    RAISE EXCEPTION 'Usuário(s) inexistente(s) ou desativado(s): %', v_invalidos USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.chat_interno_conversas (tipo, nome, criado_por)
  VALUES ('grupo', v_nome, v_eu)
  RETURNING chat_interno_conversas.id INTO v_id;

  INSERT INTO public.chat_interno_membros (conversa_id, user_id, papel, entrou_em, ultima_leitura_em)
  SELECT v_id, v_eu, 'admin', clock_timestamp(), clock_timestamp()
  UNION ALL
  SELECT v_id, u, 'membro', clock_timestamp(), clock_timestamp() FROM unnest(v_ids) AS u;

  -- Além de registrar o evento, esta mensagem é o que AVISA os convidados:
  -- ela passa pela RLS deles (já são membros) e chega pelo canal Realtime de
  -- mensagens, sem precisar de um segundo canal só para "entrei num grupo".
  PERFORM public._chat_interno_msg_sistema(
    v_id, v_eu, format('%s criou o grupo "%s"', public._chat_interno_nome(v_eu), v_nome));

  RETURN v_id;
END
$function$;

-- ---------------------------------------------------------------------------
-- Devolve quantas pessoas entraram de fato (já membro ativo é ignorado).
CREATE OR REPLACE FUNCTION public.chat_interno_adicionar_membros(p_conversa uuid, p_membros uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu        uuid := public._chat_interno_eu();
  v_tipo      text;
  v_papel     text;
  v_ids       uuid[];
  v_invalidos text;
  v_entraram  uuid[];
  v_total     integer;
BEGIN
  -- Trava a conversa: mudanças de membro concorrentes (dois admins ao mesmo
  -- tempo) passam uma de cada vez.
  PERFORM 1 FROM public.chat_interno_conversas c WHERE c.id = p_conversa FOR UPDATE;

  SELECT c.tipo, m.papel INTO v_tipo, v_papel
    FROM public.chat_interno_membros m
    JOIN public.chat_interno_conversas c ON c.id = m.conversa_id
   WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.saiu_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada ou você não participa dela' USING ERRCODE = 'P0002';
  END IF;
  IF v_tipo <> 'grupo' THEN
    RAISE EXCEPTION 'Só é possível adicionar pessoas em grupos' USING ERRCODE = '22023';
  END IF;
  IF v_papel <> 'admin' THEN
    RAISE EXCEPTION 'Só administradores do grupo podem adicionar pessoas' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_ids
    FROM unnest(coalesce(p_membros, '{}'::uuid[])) AS u
   WHERE u IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.chat_interno_membros m
                      WHERE m.conversa_id = p_conversa AND m.user_id = u AND m.saiu_em IS NULL);

  IF cardinality(v_ids) = 0 THEN
    RETURN 0;
  END IF;

  SELECT string_agg(u::text, ', ') INTO v_invalidos
    FROM unnest(v_ids) AS u WHERE NOT public._chat_interno_ativo(u);
  IF v_invalidos IS NOT NULL THEN
    RAISE EXCEPTION 'Usuário(s) inexistente(s) ou desativado(s): %', v_invalidos USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.chat_interno_membros m WHERE m.conversa_id = p_conversa AND m.saiu_em IS NULL;
  IF v_total + cardinality(v_ids) > 256 THEN
    RAISE EXCEPTION 'Um grupo pode ter no máximo 256 pessoas' USING ERRCODE = '22023';
  END IF;

  -- Readicionar quem saiu: renova entrou_em, então o que foi dito enquanto a
  -- pessoa estava fora continua invisível para ela.
  WITH ins AS (
    INSERT INTO public.chat_interno_membros AS m (conversa_id, user_id, papel, entrou_em, ultima_leitura_em)
    SELECT p_conversa, u, 'membro', clock_timestamp(), clock_timestamp() FROM unnest(v_ids) AS u
    ON CONFLICT (conversa_id, user_id) DO UPDATE
       SET saiu_em = NULL, entrou_em = clock_timestamp(), ultima_leitura_em = clock_timestamp(),
           papel = 'membro', silenciada = false
     WHERE m.saiu_em IS NOT NULL
    RETURNING m.user_id
  )
  SELECT array_agg(ins.user_id) INTO v_entraram FROM ins;

  IF v_entraram IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM public._chat_interno_msg_sistema(
    p_conversa, v_eu,
    format('%s adicionou %s', public._chat_interno_nome(v_eu),
           (SELECT string_agg(public._chat_interno_nome(u), ', ' ORDER BY public._chat_interno_nome(u))
              FROM unnest(v_entraram) AS u)));

  RETURN cardinality(v_entraram);
END
$function$;

-- ---------------------------------------------------------------------------
-- p_user = eu  → sair do grupo (qualquer membro).
-- p_user = outro → remover (só admin).
-- Se o grupo ficar sem admin ativo, o membro mais antigo vira admin — como no
-- WhatsApp — para o grupo nunca ficar sem ninguém que consiga gerenciá-lo.
CREATE OR REPLACE FUNCTION public.chat_interno_remover_membro(p_conversa uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu         uuid := public._chat_interno_eu();
  v_tipo       text;
  v_papel      text;
  v_novo_admin uuid;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'Informe quem remover' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.chat_interno_conversas c WHERE c.id = p_conversa FOR UPDATE;

  SELECT c.tipo, m.papel INTO v_tipo, v_papel
    FROM public.chat_interno_membros m
    JOIN public.chat_interno_conversas c ON c.id = m.conversa_id
   WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.saiu_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada ou você não participa dela' USING ERRCODE = 'P0002';
  END IF;
  IF v_tipo <> 'grupo' THEN
    RAISE EXCEPTION 'Não é possível sair ou remover pessoas de uma conversa direta' USING ERRCODE = '22023';
  END IF;

  IF p_user = v_eu THEN
    UPDATE public.chat_interno_membros m SET saiu_em = clock_timestamp()
     WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.saiu_em IS NULL;
    PERFORM public._chat_interno_msg_sistema(
      p_conversa, v_eu, format('%s saiu do grupo', public._chat_interno_nome(v_eu)));
  ELSE
    IF v_papel <> 'admin' THEN
      RAISE EXCEPTION 'Só administradores do grupo podem remover pessoas' USING ERRCODE = '42501';
    END IF;
    UPDATE public.chat_interno_membros m SET saiu_em = clock_timestamp()
     WHERE m.conversa_id = p_conversa AND m.user_id = p_user AND m.saiu_em IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Essa pessoa não participa do grupo' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._chat_interno_msg_sistema(
      p_conversa, v_eu,
      format('%s removeu %s', public._chat_interno_nome(v_eu), public._chat_interno_nome(p_user)));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.chat_interno_membros m
                  WHERE m.conversa_id = p_conversa AND m.saiu_em IS NULL AND m.papel = 'admin') THEN
    SELECT m.user_id INTO v_novo_admin
      FROM public.chat_interno_membros m
     WHERE m.conversa_id = p_conversa AND m.saiu_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = m.user_id)
     ORDER BY m.entrou_em, m.user_id
     LIMIT 1;
    IF v_novo_admin IS NOT NULL THEN
      UPDATE public.chat_interno_membros m SET papel = 'admin'
       WHERE m.conversa_id = p_conversa AND m.user_id = v_novo_admin;
      PERFORM public._chat_interno_msg_sistema(
        p_conversa, v_eu,
        format('%s agora é administrador(a) do grupo', public._chat_interno_nome(v_novo_admin)));
    END IF;
  END IF;
END
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_interno_renomear_grupo(p_conversa uuid, p_nome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu    uuid := public._chat_interno_eu();
  v_nome  text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_tipo  text;
  v_papel text;
  v_atual text;
BEGIN
  IF char_length(v_nome) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Informe um nome de grupo com até 80 caracteres' USING ERRCODE = '22023';
  END IF;

  SELECT c.tipo, m.papel, c.nome INTO v_tipo, v_papel, v_atual
    FROM public.chat_interno_membros m
    JOIN public.chat_interno_conversas c ON c.id = m.conversa_id
   WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.saiu_em IS NULL
     FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada ou você não participa dela' USING ERRCODE = 'P0002';
  END IF;
  IF v_tipo <> 'grupo' THEN
    RAISE EXCEPTION 'Só grupos têm nome' USING ERRCODE = '22023';
  END IF;
  IF v_papel <> 'admin' THEN
    RAISE EXCEPTION 'Só administradores do grupo podem mudar o nome' USING ERRCODE = '42501';
  END IF;
  IF v_atual = v_nome THEN
    RETURN;
  END IF;

  UPDATE public.chat_interno_conversas c SET nome = v_nome, atualizado_em = now() WHERE c.id = p_conversa;

  PERFORM public._chat_interno_msg_sistema(
    p_conversa, v_eu,
    format('%s mudou o nome do grupo para "%s"', public._chat_interno_nome(v_eu), v_nome));
END
$function$;

-- ---------------------------------------------------------------------------
-- Promover/rebaixar admin. Sem isto o grupo teria um admin só, para sempre.
CREATE OR REPLACE FUNCTION public.chat_interno_definir_papel(p_conversa uuid, p_user uuid, p_papel text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu      uuid := public._chat_interno_eu();
  v_tipo    text;
  v_papel   text;
  v_atual   text;
BEGIN
  IF p_papel IS NULL OR p_papel NOT IN ('admin', 'membro') THEN
    RAISE EXCEPTION 'Papel inválido (use admin ou membro)' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.chat_interno_conversas c WHERE c.id = p_conversa FOR UPDATE;

  SELECT c.tipo, m.papel INTO v_tipo, v_papel
    FROM public.chat_interno_membros m
    JOIN public.chat_interno_conversas c ON c.id = m.conversa_id
   WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.saiu_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada ou você não participa dela' USING ERRCODE = 'P0002';
  END IF;
  IF v_tipo <> 'grupo' THEN
    RAISE EXCEPTION 'Conversa direta não tem administradores' USING ERRCODE = '22023';
  END IF;
  IF v_papel <> 'admin' THEN
    RAISE EXCEPTION 'Só administradores do grupo podem mudar papéis' USING ERRCODE = '42501';
  END IF;

  SELECT m.papel INTO v_atual
    FROM public.chat_interno_membros m
   WHERE m.conversa_id = p_conversa AND m.user_id = p_user AND m.saiu_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Essa pessoa não participa do grupo' USING ERRCODE = 'P0002';
  END IF;
  IF v_atual = p_papel THEN
    RETURN;
  END IF;

  IF p_papel = 'membro' AND NOT EXISTS (
    SELECT 1 FROM public.chat_interno_membros m
     WHERE m.conversa_id = p_conversa AND m.saiu_em IS NULL AND m.papel = 'admin' AND m.user_id <> p_user
  ) THEN
    RAISE EXCEPTION 'O grupo precisa de ao menos um administrador' USING ERRCODE = '22023';
  END IF;

  UPDATE public.chat_interno_membros m SET papel = p_papel
   WHERE m.conversa_id = p_conversa AND m.user_id = p_user;

  PERFORM public._chat_interno_msg_sistema(
    p_conversa, v_eu,
    CASE WHEN p_papel = 'admin'
      THEN format('%s tornou %s administrador(a)', public._chat_interno_nome(v_eu), public._chat_interno_nome(p_user))
      ELSE format('%s tirou %s da administração', public._chat_interno_nome(v_eu), public._chat_interno_nome(p_user))
    END);
END
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_interno_silenciar(p_conversa uuid, p_silenciada boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu uuid := public._chat_interno_eu();
BEGIN
  UPDATE public.chat_interno_membros m SET silenciada = coalesce(p_silenciada, false)
   WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.saiu_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada ou você não participa dela' USING ERRCODE = 'P0002';
  END IF;
END
$function$;

-- ---------------------------------------------------------------------------
-- Enviar. Fluxo de anexo: o front sobe o arquivo em
-- 'chat-interno/<conversa_id>/<uuid>-<nome>' (a policy do bucket só deixa
-- membro subir na pasta da conversa) e DEPOIS chama esta RPC com o caminho.
-- Conferimos que o objeto existe no bucket: impede mensagem apontando para
-- arquivo de outra conversa ou para nada.
CREATE OR REPLACE FUNCTION public.chat_interno_enviar(
  p_conversa          uuid,
  p_tipo              text,
  p_conteudo          text    DEFAULT NULL,
  p_anexo_path        text    DEFAULT NULL,
  p_anexo_nome        text    DEFAULT NULL,
  p_anexo_mime        text    DEFAULT NULL,
  p_anexo_tamanho     bigint  DEFAULT NULL,
  p_anexo_duracao_seg integer DEFAULT NULL,
  p_responde_a        uuid    DEFAULT NULL,
  p_client_id         uuid    DEFAULT NULL
)
RETURNS public.chat_interno_mensagens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu        uuid := public._chat_interno_eu();
  v_msg       public.chat_interno_mensagens%ROWTYPE;
  v_tipo_conv text;
  v_entrou    timestamptz;
  v_outro     uuid;
  v_conteudo  text;
  v_meta      jsonb;
  v_mime      text;
  v_tamanho   bigint;
  v_nome      text;
BEGIN
  -- Idempotência antes de tudo: o reenvio de algo que JÁ entrou devolve a
  -- mesma linha, mesmo que o estado tenha mudado entre as duas tentativas.
  IF p_client_id IS NOT NULL THEN
    SELECT * INTO v_msg FROM public.chat_interno_mensagens m
     WHERE m.autor_id = v_eu AND m.client_id = p_client_id;
    IF FOUND THEN
      IF v_msg.conversa_id <> p_conversa THEN
        RAISE EXCEPTION 'client_id já usado em outra conversa' USING ERRCODE = '22023';
      END IF;
      RETURN v_msg;
    END IF;
  END IF;

  IF p_tipo IS NULL OR p_tipo NOT IN ('texto', 'imagem', 'arquivo', 'audio') THEN
    RAISE EXCEPTION 'Tipo de mensagem inválido: %', coalesce(p_tipo, '(vazio)') USING ERRCODE = '22023';
  END IF;

  SELECT c.tipo, m.entrou_em INTO v_tipo_conv, v_entrou
    FROM public.chat_interno_membros m
    JOIN public.chat_interno_conversas c ON c.id = m.conversa_id
   WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.saiu_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada ou você não participa dela' USING ERRCODE = 'P0002';
  END IF;

  -- Direta com alguém que foi desativado (ou apagado): ninguém leria.
  IF v_tipo_conv = 'direta' THEN
    SELECT m.user_id INTO v_outro
      FROM public.chat_interno_membros m
     WHERE m.conversa_id = p_conversa AND m.user_id <> v_eu AND m.saiu_em IS NULL;
    IF v_outro IS NULL OR NOT public._chat_interno_ativo(v_outro) THEN
      RAISE EXCEPTION 'Esta pessoa não está mais ativa; não é possível enviar mensagens' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_conteudo := nullif(btrim(p_conteudo, E' \t\r\n'), '');
  IF char_length(v_conteudo) > 10000 THEN
    RAISE EXCEPTION 'Mensagem muito longa (máximo de 10.000 caracteres)' USING ERRCODE = '22023';
  END IF;

  IF p_tipo = 'texto' THEN
    IF v_conteudo IS NULL THEN
      RAISE EXCEPTION 'Mensagem vazia' USING ERRCODE = '22023';
    END IF;
    IF p_anexo_path IS NOT NULL THEN
      RAISE EXCEPTION 'Mensagem de texto não leva anexo' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_anexo_path IS NULL THEN
      RAISE EXCEPTION 'Anexo obrigatório para mensagem do tipo %', p_tipo USING ERRCODE = '22023';
    END IF;
    IF char_length(p_anexo_path) > 1024
       OR split_part(p_anexo_path, '/', 1) <> p_conversa::text
       OR p_anexo_path !~ '^[^/]+/[^/]+$' THEN
      RAISE EXCEPTION 'Caminho do anexo fora desta conversa (esperado "<conversa_id>/<arquivo>")' USING ERRCODE = '42501';
    END IF;

    SELECT o.metadata INTO v_meta
      FROM storage.objects o
     WHERE o.bucket_id = 'chat-interno' AND o.name = p_anexo_path;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Anexo não encontrado no armazenamento; envie o arquivo antes da mensagem' USING ERRCODE = 'P0002';
    END IF;

    -- Tamanho: o do Storage manda (o cliente pode mentir); o do cliente é só
    -- reserva. MIME: o do cliente primeiro — o Storage às vezes grava
    -- 'text/plain' para Blob sem tipo.
    v_tamanho := coalesce((v_meta ->> 'size')::bigint, p_anexo_tamanho);
    v_mime    := coalesce(nullif(btrim(p_anexo_mime), ''), v_meta ->> 'mimetype');

    IF p_tipo = 'imagem' AND coalesce(v_mime, '') NOT ILIKE 'image/%' THEN
      RAISE EXCEPTION 'O anexo não é uma imagem' USING ERRCODE = '22023';
    END IF;
    IF p_tipo = 'audio' THEN
      IF coalesce(v_mime, '') NOT ILIKE 'audio/%' AND coalesce(v_mime, '') NOT ILIKE 'video/webm%' THEN
        RAISE EXCEPTION 'O anexo não é um áudio' USING ERRCODE = '22023';
      END IF;
      -- Gravação que subiu só com o cabeçalho WebM (~110 bytes) chega muda do
      -- outro lado. Já aconteceu no envio para o WhatsApp; aqui barramos na
      -- entrada.
      IF v_tamanho IS NOT NULL AND v_tamanho < 1000 THEN
        RAISE EXCEPTION 'Áudio vazio ou corrompido (gravação sem som)' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF p_anexo_duracao_seg IS NOT NULL AND p_anexo_duracao_seg < 0 THEN
      RAISE EXCEPTION 'Duração inválida' USING ERRCODE = '22023';
    END IF;

    v_nome := left(coalesce(
      nullif(btrim(p_anexo_nome), ''),
      -- '<uuid>-<nome original>' → '<nome original>'
      nullif(regexp_replace(split_part(p_anexo_path, '/', 2), '^[0-9a-fA-F-]{36}-', ''), '')
    ), 255);
  END IF;

  IF p_responde_a IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chat_interno_mensagens r
     WHERE r.id = p_responde_a AND r.conversa_id = p_conversa AND r.criado_em >= v_entrou
  ) THEN
    RAISE EXCEPTION 'Mensagem respondida não encontrada nesta conversa' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.chat_interno_mensagens AS m
         (conversa_id, autor_id, tipo, conteudo,
          anexo_path, anexo_nome, anexo_mime, anexo_tamanho, anexo_duracao_seg,
          responde_a, client_id)
  VALUES (p_conversa, v_eu, p_tipo, v_conteudo,
          CASE WHEN p_tipo = 'texto' THEN NULL ELSE p_anexo_path END,
          v_nome,
          CASE WHEN p_tipo = 'texto' THEN NULL ELSE left(v_mime, 255) END,
          CASE WHEN p_tipo = 'texto' THEN NULL ELSE v_tamanho END,
          CASE WHEN p_tipo = 'audio' THEN p_anexo_duracao_seg END,
          p_responde_a, p_client_id)
  ON CONFLICT ON CONSTRAINT chat_interno_mensagens_client_id_unico DO NOTHING
  RETURNING m.* INTO v_msg;

  -- Corrida: duas tentativas com o mesmo client_id ao mesmo tempo. A segunda
  -- cai no DO NOTHING e devolve a linha que a primeira gravou.
  IF v_msg.id IS NULL THEN
    SELECT * INTO v_msg FROM public.chat_interno_mensagens m
     WHERE m.autor_id = v_eu AND m.client_id = p_client_id;
    RETURN v_msg;
  END IF;

  -- Quem envia leu tudo até a própria mensagem.
  UPDATE public.chat_interno_membros m SET ultima_leitura_em = v_msg.criado_em
   WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.ultima_leitura_em < v_msg.criado_em;

  RETURN v_msg;
END
$function$;

-- ---------------------------------------------------------------------------
-- Apagar a própria mensagem (para todos). O conteúdo e o anexo são zerados
-- na linha; o ARQUIVO no bucket o front apaga em seguida via Storage API (a
-- policy de DELETE deixa o dono apagar). Se ele ficasse, membros ainda o
-- achariam listando a pasta da conversa.
CREATE OR REPLACE FUNCTION public.chat_interno_apagar_mensagem(p_mensagem uuid)
RETURNS public.chat_interno_mensagens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu  uuid := public._chat_interno_eu();
  v_msg public.chat_interno_mensagens%ROWTYPE;
BEGIN
  SELECT * INTO v_msg FROM public.chat_interno_mensagens m WHERE m.id = p_mensagem FOR UPDATE;

  -- Não-membro recebe "não encontrada" — não confirmamos que a mensagem existe.
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.chat_interno_membros mb
     WHERE mb.conversa_id = v_msg.conversa_id AND mb.user_id = v_eu AND mb.saiu_em IS NULL
       AND mb.entrou_em <= v_msg.criado_em
  ) THEN
    RAISE EXCEPTION 'Mensagem não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_msg.tipo = 'sistema' THEN
    RAISE EXCEPTION 'Mensagens do sistema não podem ser apagadas' USING ERRCODE = '42501';
  END IF;
  IF v_msg.autor_id IS DISTINCT FROM v_eu THEN
    RAISE EXCEPTION 'Só é possível apagar as próprias mensagens' USING ERRCODE = '42501';
  END IF;
  IF v_msg.apagada_em IS NOT NULL THEN
    RETURN v_msg;
  END IF;

  UPDATE public.chat_interno_mensagens m
     SET apagada_em = now(), conteudo = NULL,
         anexo_path = NULL, anexo_nome = NULL, anexo_mime = NULL,
         anexo_tamanho = NULL, anexo_duracao_seg = NULL
   WHERE m.id = p_mensagem
  RETURNING m.* INTO v_msg;

  RETURN v_msg;
END
$function$;

-- ---------------------------------------------------------------------------
-- p_ate: o criado_em da última mensagem que o front MOSTROU. Sem ele, usa o
-- relógio — mas aí uma mensagem que commitou um instante depois, com
-- criado_em anterior, seria dada como lida sem ter aparecido. Nunca anda
-- para trás, e só grava se mudar (cada UPDATE é WAL e vacuum).
CREATE OR REPLACE FUNCTION public.chat_interno_marcar_lida(p_conversa uuid, p_ate timestamptz DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu uuid := public._chat_interno_eu();
  v_ate timestamptz := least(coalesce(p_ate, clock_timestamp()), clock_timestamp());
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_interno_membros m
                  WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.saiu_em IS NULL) THEN
    RAISE EXCEPTION 'Conversa não encontrada ou você não participa dela' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.chat_interno_membros m SET ultima_leitura_em = v_ate
   WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.saiu_em IS NULL
     AND m.ultima_leitura_em < v_ate;
END
$function$;

-- ---------------------------------------------------------------------------
-- A lista de conversas, numa chamada. Direta sem nenhuma mensagem só aparece
-- para quem a abriu — senão o outro lado veria uma conversa vazia "do nada".
-- nao_lidas ignora mensagens de sistema e apagadas.
CREATE OR REPLACE FUNCTION public.chat_interno_conversas_resumo()
RETURNS TABLE(
  id                          uuid,
  tipo                        text,
  nome                        text,
  outro_user_id               uuid,
  outro_desativado            boolean,
  membros_count               integer,
  meu_papel                   text,
  silenciada                  boolean,
  criado_em                   timestamptz,
  ultima_mensagem_em          timestamptz,
  ultima_mensagem_preview     text,
  ultima_mensagem_tipo        text,
  ultima_mensagem_autor_id    uuid,
  ultima_mensagem_autor_nome  text,
  nao_lidas                   integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_eu uuid := public._chat_interno_eu();
BEGIN
  RETURN QUERY
  SELECT c.id,
         c.tipo,
         CASE WHEN c.tipo = 'grupo' THEN c.nome
              ELSE coalesce(nullif(btrim(op.name), ''), nullif(split_part(op.email, '@', 1), ''), 'Usuário removido')
         END,
         o.outro,
         CASE WHEN o.outro IS NULL THEN NULL
              ELSE (op.id IS NULL OR EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = o.outro))
         END,
         (SELECT count(*)::integer FROM public.chat_interno_membros mm
           WHERE mm.conversa_id = c.id AND mm.saiu_em IS NULL),
         me.papel,
         me.silenciada,
         c.criado_em,
         c.ultima_mensagem_em,
         c.ultima_mensagem_preview,
         c.ultima_mensagem_tipo,
         c.ultima_mensagem_autor_id,
         CASE WHEN c.ultima_mensagem_autor_id IS NULL THEN NULL
              ELSE coalesce(nullif(btrim(ap.name), ''), nullif(split_part(ap.email, '@', 1), ''), 'Usuário removido')
         END,
         (SELECT count(*)::integer FROM public.chat_interno_mensagens msg
           WHERE msg.conversa_id = c.id
             AND msg.criado_em > me.ultima_leitura_em
             AND msg.autor_id IS DISTINCT FROM v_eu
             AND msg.apagada_em IS NULL
             AND msg.tipo <> 'sistema')
    FROM public.chat_interno_membros me
    JOIN public.chat_interno_conversas c ON c.id = me.conversa_id
    -- A outra pessoa sai da própria chave: continua certa mesmo se o perfil
    -- dela tiver sido apagado (e a linha de membro, em cascata, junto).
    CROSS JOIN LATERAL (
      SELECT CASE WHEN c.tipo <> 'direta' THEN NULL
                  WHEN split_part(c.direta_chave, ':', 1) = v_eu::text THEN split_part(c.direta_chave, ':', 2)::uuid
                  ELSE split_part(c.direta_chave, ':', 1)::uuid
             END AS outro
    ) o
    LEFT JOIN public.profiles op ON op.id = o.outro
    LEFT JOIN public.profiles ap ON ap.id = c.ultima_mensagem_autor_id
   WHERE me.user_id = v_eu
     AND me.saiu_em IS NULL
     AND (c.tipo = 'grupo' OR c.ultima_mensagem_em IS NOT NULL OR c.criado_por = v_eu)
   ORDER BY coalesce(c.ultima_mensagem_em, c.criado_em) DESC, c.id;
END
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_interno_membros_da_conversa(p_conversa uuid)
RETURNS TABLE(
  user_id            uuid,
  nome               text,
  setor              text,
  avatar_url         text,
  papel              text,
  entrou_em          timestamptz,
  ultima_leitura_em  timestamptz,
  desativado         boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_eu uuid := public._chat_interno_eu();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_interno_membros m
                  WHERE m.conversa_id = p_conversa AND m.user_id = v_eu AND m.saiu_em IS NULL) THEN
    RAISE EXCEPTION 'Conversa não encontrada ou você não participa dela' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT m.user_id,
         coalesce(nullif(btrim(p.name), ''), nullif(split_part(p.email, '@', 1), ''), 'Usuário removido'),
         p.department,
         p.avatar_url,
         m.papel,
         m.entrou_em,
         m.ultima_leitura_em,
         EXISTS (SELECT 1 FROM public.usuarios_desativados d WHERE d.user_id = m.user_id)
    FROM public.chat_interno_membros m
    LEFT JOIN public.profiles p ON p.id = m.user_id
   WHERE m.conversa_id = p_conversa AND m.saiu_em IS NULL
   ORDER BY (m.papel = 'admin') DESC, lower(coalesce(p.name, '')), m.user_id;
END
$function$;

-- ---------------------------------------------------------------------------
-- Para o badge. Conversa silenciada não entra na soma (como no WhatsApp),
-- mas continua com o seu número no resumo.
CREATE OR REPLACE FUNCTION public.chat_interno_total_nao_lidas()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu    uuid := public._chat_interno_eu();
  v_total integer;
BEGIN
  SELECT coalesce(sum(
           (SELECT count(*) FROM public.chat_interno_mensagens msg
             WHERE msg.conversa_id = me.conversa_id
               AND msg.criado_em > me.ultima_leitura_em
               AND msg.autor_id IS DISTINCT FROM v_eu
               AND msg.apagada_em IS NULL
               AND msg.tipo <> 'sistema')
         ), 0)::integer
    INTO v_total
    FROM public.chat_interno_membros me
   WHERE me.user_id = v_eu AND me.saiu_em IS NULL AND NOT me.silenciada;
  RETURN v_total;
END
$function$;

-- ===========================================================================
-- PARTE 6 — permissões das funções
-- ===========================================================================
--
-- Os default privileges deste banco dão EXECUTE a anon em toda função nova de
-- public; REVOKE só de PUBLIC não tiraria. Por isso PUBLIC e anon, sempre.

-- Auxiliares internas: ninguém chama direto.
REVOKE ALL ON FUNCTION public._chat_interno_eu()                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._chat_interno_ativo(uuid)                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._chat_interno_nome(uuid)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._chat_interno_msg_sistema(uuid, uuid, text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._chat_interno_preview(text, text, text, boolean)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._chat_interno_mensagem_atualiza_conversa()           FROM PUBLIC, anon, authenticated;

-- Usadas DENTRO de policies: a policy roda como o usuário, então ele precisa
-- de EXECUTE (o corpo, definer, é que lê as tabelas).
REVOKE ALL ON FUNCTION public.chat_interno_membro_desde(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_sou_membro(uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_pode_acessar_objeto(text)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_interno_membro_desde(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_sou_membro(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_pode_acessar_objeto(text) TO authenticated;

-- RPCs do front.
REVOKE ALL ON FUNCTION public.chat_interno_diretorio()                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_abrir_direta(uuid)                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_criar_grupo(text, uuid[])                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_adicionar_membros(uuid, uuid[])              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_remover_membro(uuid, uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_renomear_grupo(uuid, text)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_definir_papel(uuid, uuid, text)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_silenciar(uuid, boolean)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_enviar(uuid, text, text, text, text, text, bigint, integer, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_apagar_mensagem(uuid)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_marcar_lida(uuid, timestamptz)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_conversas_resumo()                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_membros_da_conversa(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_interno_total_nao_lidas()                            FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.chat_interno_diretorio()                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_abrir_direta(uuid)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_criar_grupo(text, uuid[])                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_adicionar_membros(uuid, uuid[])           TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_remover_membro(uuid, uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_renomear_grupo(uuid, text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_definir_papel(uuid, uuid, text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_silenciar(uuid, boolean)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_enviar(uuid, text, text, text, text, text, bigint, integer, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_apagar_mensagem(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_marcar_lida(uuid, timestamptz)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_conversas_resumo()                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_membros_da_conversa(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_interno_total_nao_lidas()                         TO authenticated;

-- ===========================================================================
-- PARTE 7 — Storage: bucket privado 'chat-interno'
-- ===========================================================================
--
-- NÃO reaproveitamos 'chat-attachments': ele é público e as policies dele
-- deixam qualquer usuário logado apagar/sobrescrever qualquer objeto.
--
-- Convenção de caminho: '<conversa_id>/<uuid>-<nome original>'. A primeira
-- pasta é a conversa — é dela que a policy tira quem pode ler/subir.
-- Download só por URL assinada (createSignedUrl), que exige SELECT, ou seja,
-- ser membro ativo no momento de assinar.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-interno', 'chat-interno', false, 26214400, NULL)  -- 25 MB
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS chat_interno_obj_select ON storage.objects;
CREATE POLICY chat_interno_obj_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-interno' AND public.chat_interno_pode_acessar_objeto(name));

DROP POLICY IF EXISTS chat_interno_obj_insert ON storage.objects;
CREATE POLICY chat_interno_obj_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-interno' AND public.chat_interno_pode_acessar_objeto(name));

-- Sem UPDATE de propósito: nome de arquivo leva uuid, então nunca há motivo
-- para sobrescrever — e sem UPDATE o upsert falha, ninguém troca o arquivo
-- por baixo de uma mensagem já enviada.
-- DELETE só do próprio arquivo: limpar anexo de mensagem apagada, ou upload
-- cuja RPC de envio falhou.
DROP POLICY IF EXISTS chat_interno_obj_delete ON storage.objects;
CREATE POLICY chat_interno_obj_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-interno' AND owner_id = (auth.uid())::text);

-- ===========================================================================
-- PARTE 8 — Realtime
-- ===========================================================================
--
-- Só mensagens. O front abre UM canal nesta tabela, sem filtro, e a RLS
-- entrega a cada usuário só as conversas dele (incidente de 02/09: canal
-- demais derrubou o Postgres compartilhado).
--
-- `chat_interno_membros` fica FORA de propósito: marcar como lida é um UPDATE
-- nela, a cada conversa aberta — publicá-la poria cada leitura no WAL
-- decodificado pelo Realtime. "Entrei num grupo" já chega pela mensagem de
-- sistema; "fui removido" o front descobre no próximo resumo (ou no erro ao
-- enviar).
DO $realtime$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_interno_mensagens'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_interno_mensagens;
  END IF;
END
$realtime$;
