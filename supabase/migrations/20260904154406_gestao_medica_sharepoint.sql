-- Gestão Médica: pasta de documentos do médico no SharePoint, via Microsoft
-- Graph (edge function `sharepoint-microsoft`).
--
-- CONEXÃO ÚNICA, NÃO POR PESSOA. Diferente de `agenda_conexoes` (uma linha por
-- usuário) e mais perto de uma caixa de e-mail "de setor" de
-- `email_accounts` — só que aqui nem isso: existe UMA biblioteca de
-- documentos de médico, conectada uma vez por um super admin e usada em modo
-- leitura por todo mundo que `gestao_medica._pode_usar()`. Daí o singleton
-- `id=1`, como `email_oauth_config` já faz para as chaves compartilhadas.
--
-- MESMO CUIDADO DE `agenda_conexoes`: o token não pode chegar ao navegador.
-- Aqui vai além — nem SELECT: a tela de Configurações pergunta status pela
-- ROTA `status` da edge function (que nunca devolve os tokens), não lendo a
-- tabela direto. Não há necessidade de nenhuma coluna visível ao cliente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.sharepoint_conexao (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  conta_email   text,
  site_id       text,
  drive_id      text,
  site_nome     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sharepoint_conexao IS
  'Conexão única e compartilhada com o SharePoint (Microsoft Graph) para o Gestão Médica. Singleton (id=1): é uma biblioteca de setor, não por pessoa. access_token/refresh_token/site_id/drive_id nunca chegam ao navegador — sem policy nenhuma, só a edge function (service_role) lê/escreve.';

ALTER TABLE public.sharepoint_conexao ENABLE ROW LEVEL SECURITY;
-- Sem nenhuma policy de propósito, nem leitura — ver comentário da tabela.
REVOKE ALL ON public.sharepoint_conexao FROM anon, authenticated;

INSERT INTO public.secrets (key, value)
SELECT 'SHAREPOINT_MS_STATE_SECRET', encode(gen_random_bytes(32), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM public.secrets WHERE key = 'SHAREPOINT_MS_STATE_SECRET');

-- Vínculo médico ↔ pasta no SharePoint. Dado do app (nome/id/link da pasta),
-- não segredo — fica no schema gestao_medica, sob a mesma RLS que as outras
-- tabelas (`_pode_usar()`), assim o frontend LÊ direto pelo client Supabase já
-- configurado com `db.schema='gestao_medica'`. Escrita (vincular/desvincular)
-- passa pela edge function, que confere a pasta no Graph antes de gravar — por
-- isso authenticated só ganha grant de SELECT.
CREATE TABLE IF NOT EXISTS gestao_medica.medico_sharepoint_pastas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id     uuid NOT NULL UNIQUE REFERENCES gestao_medica.medicos(id) ON DELETE CASCADE,
  item_id       text NOT NULL,
  nome_pasta    text NOT NULL,
  caminho       text,
  web_url       text,
  vinculado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS medico_sharepoint_pastas_medico_idx
  ON gestao_medica.medico_sharepoint_pastas (medico_id);

DROP TRIGGER IF EXISTS set_updated_at ON gestao_medica.medico_sharepoint_pastas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON gestao_medica.medico_sharepoint_pastas
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE gestao_medica.medico_sharepoint_pastas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_equipe_leitura ON gestao_medica.medico_sharepoint_pastas;
CREATE POLICY gm_equipe_leitura ON gestao_medica.medico_sharepoint_pastas
  FOR SELECT TO authenticated
  USING (gestao_medica._pode_usar());

GRANT SELECT ON gestao_medica.medico_sharepoint_pastas TO authenticated;
GRANT ALL ON gestao_medica.medico_sharepoint_pastas TO service_role;

COMMIT;

-- ————————————————————————————————————————————————————————————————
-- O QUE FALTA, E SÓ QUEM ADMINISTRA O 365 PODE FAZER
-- ————————————————————————————————————————————————————————————————
-- (registro do app, permissões delegadas e consentimento de admin já feitos
-- pelo usuário nesta rodada — ver a conversa da sessão)
--
-- Falta só cadastrar o Redirect URI (Web) no Azure, depois que esta function
-- estiver publicada:
--   https://apps-supabase.srofjl.easypanel.host/functions/v1/sharepoint-microsoft/callback
--
-- As três chaves (client_id/tenant_id/client_secret) entram pela tela
-- Configurações → Integração SharePoint do Gestão Médica (rota `configurar`
-- da edge function, só super admin) — não pelo banco direto.
