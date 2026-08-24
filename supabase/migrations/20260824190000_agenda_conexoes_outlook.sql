-- Agenda conectada ao Outlook: onde os tokens da conta de cada pessoa moram.
--
-- POR QUE NÃO O LOGIN SOCIAL DO SUPABASE. Ligar um provedor OAuth no Supabase
-- Auth exige mexer no `.env` do stack e RECRIAR o container `auth`. O `.env`
-- deste self-hosted está defasado desde 16/07 e o papel `supabase_auth_admin`
-- ainda tem senha divergente — recriar aquele container derrubaria o login da
-- empresa inteira (aconteceu igual com o `rest` em 29/07, ~1h fora do ar).
-- Por isso o fluxo OAuth é nosso, numa edge function, e o segredo do
-- aplicativo mora na tabela `secrets`, exatamente como a chave da Evolution.
--
-- O CUIDADO PRINCIPAL DESTE ARQUIVO É O TOKEN NÃO CHEGAR AO NAVEGADOR.
--
-- RLS sozinha não resolve: ela decide QUAIS LINHAS alguém vê, não quais
-- colunas. Com RLS `user_id = uid()` a pessoa veria a própria linha — e junto
-- viria o `refresh_token`, que dá acesso à agenda dela por tempo indeterminado,
-- legível por qualquer extensão do navegador.
--
-- Então vale também GRANT POR COLUNA. E o REVOKE antes dele é obrigatório, não
-- decorativo: este Supabase concede privilégios amplos a `anon` e
-- `authenticated` em tabela nova por padrão (dá para ver isso na `secrets`, que
-- tem `arwdDxt` para os dois e só está segura porque a RLS não tem policy
-- nenhuma). Sem revogar primeiro, o grant por coluna não limitaria nada.

BEGIN;

CREATE TABLE IF NOT EXISTS public.agenda_conexoes (
  user_id       uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider      text NOT NULL DEFAULT 'microsoft' CHECK (provider IN ('microsoft')),
  -- Os dois campos que NUNCA podem sair do servidor.
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  -- Só para a tela poder dizer "conectado como fulano@…".
  conta_email   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agenda_conexoes IS
  'Conexao da agenda pessoal com o Outlook. access_token/refresh_token sao lidos SO pela edge function (service_role); authenticated nao tem grant nessas colunas.';

ALTER TABLE public.agenda_conexoes ENABLE ROW LEVEL SECURITY;

-- Ver só a própria conexão. Sem policy de escrita de propósito: quem grava
-- token é a edge function, com papel de serviço.
DROP POLICY IF EXISTS agenda_conexoes_ver_a_propria ON public.agenda_conexoes;
CREATE POLICY agenda_conexoes_ver_a_propria ON public.agenda_conexoes
  FOR SELECT USING (user_id = uid());

-- A ordem importa: revogar o que o padrão do Supabase deu, e só então conceder
-- as colunas seguras.
REVOKE ALL ON public.agenda_conexoes FROM anon, authenticated;
GRANT SELECT (user_id, provider, conta_email, updated_at)
  ON public.agenda_conexoes TO authenticated;

-- Segredo do `state` do OAuth: assina o parâmetro que volta da Microsoft, para
-- o retorno de uma pessoa não conseguir amarrar a conta dela ao usuário de
-- outra. Gerado aqui porque não é credencial de ninguém — é interno, e assim
-- deixa de ser mais um passo manual. Não sobrescreve se já existir.
INSERT INTO public.secrets (key, value)
SELECT 'AGENDA_MS_STATE_SECRET', encode(gen_random_bytes(32), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM public.secrets WHERE key = 'AGENDA_MS_STATE_SECRET');

COMMIT;

-- ————————————————————————————————————————————————————————————————
-- O QUE FALTA, E SÓ QUEM ADMINISTRA O 365 PODE FAZER
-- ————————————————————————————————————————————————————————————————
--
-- Registrar o aplicativo no Azure (Microsoft Entra ID › Registros de
-- aplicativo), com:
--   - URI de redirecionamento (Web):
--     https://apps-supabase.srofjl.easypanel.host/functions/v1/agenda-microsoft/callback
--   - Permissões delegadas: Calendars.ReadWrite, offline_access, User.Read
--   - Consentimento do administrador concedido
--
-- Depois, gravar as três chaves. O SEGREDO NÃO DEVE PASSAR POR CONVERSA NEM
-- POR COMMIT — rodar isto direto no banco, substituindo os valores:
--
--   INSERT INTO public.secrets (key, value) VALUES
--     ('AGENDA_MS_CLIENT_ID',     'id-do-aplicativo'),
--     ('AGENDA_MS_TENANT_ID',     'id-do-diretorio'),
--     ('AGENDA_MS_CLIENT_SECRET', 'o-segredo')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--
-- Enquanto essas chaves não existirem, a tela mostra "Outlook ainda não
-- configurado" em vez de quebrar.
