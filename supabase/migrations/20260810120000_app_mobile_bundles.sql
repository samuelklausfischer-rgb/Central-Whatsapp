-- Tabela de bundles OTA do app Android (Capgo self-hospedado).
--
-- Contexto: o app Android vai passar a usar @capgo/capacitor-updater apontando
-- para um servidor próprio (edge function `mobile-update`), em vez do serviço
-- pago da Capgo. Essa função precisa de ONDE ler "qual é a versão mais nova e
-- onde está o zip", e essa tabela é esse "onde".
--
-- Por que NÃO reusar `app_releases`: aquela tabela tem só
-- (id, version, released_at) e alimenta — via Realtime, ver
-- `src/hooks/use-updater.ts` — o aviso de atualização do app DESKTOP
-- (Electron). Misturar uma versão de bundle MOBILE ali faria o desktop
-- (que escuta INSERT em `app_releases` sem filtrar plataforma) anunciar
-- update de uma versão que não é a dele. Mobile e desktop têm ciclos de
-- release independentes; precisam de tabelas independentes.
--
-- Nome: `app_mobile_bundles` segue o prefixo `app_` já usado por
-- `app_releases` (e por `user_app_activity`, que é outro domínio). Este
-- schema `public` é COMPARTILHADO entre Central Whats, PRN Hub, Financeiro e
-- Relatórios — não há nenhuma tabela `app_mobile_bundles` hoje no repo nem
-- nas migrations dos outros projetos-irmãos que passam por aqui, então o
-- nome está livre.
CREATE TABLE public.app_mobile_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  url text NOT NULL,
  checksum text NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now()
);

-- RLS habilitado, SEM policy de leitura para anon/authenticated.
--
-- Quem lê esta tabela é a edge function `mobile-update`, com a service role
-- (que ignora RLS). O app Android chama a função sem sessão de usuário — não
-- faz sentido dar a `anon`/`authenticated` uma policy de SELECT direta na
-- tabela, porque isso abriria a lista de bundles (URLs de download, hashes)
-- para qualquer chamada com a anon key, sem passar pela função. Não ter
-- nenhuma policy é o estado seguro por padrão: RLS ligado + zero policy =
-- zero acesso fora da service role.
ALTER TABLE public.app_mobile_bundles ENABLE ROW LEVEL SECURITY;
