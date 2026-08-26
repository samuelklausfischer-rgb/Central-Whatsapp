-- Alinha o OAuth do Email Hub com o padrão que a Agenda já usa em produção.
--
-- A migration anterior (20260826124852) criou duas tabelas que não precisavam
-- existir, porque foi escrita antes de eu encontrar a `agenda-microsoft`. Aquela
-- edge function faz o MESMO fluxo (OAuth2 + Microsoft Graph, mesmo tenant), está
-- no ar com conexões ativas, e resolve as duas coisas de um jeito melhor:
--
--   email_oauth_config -> a tabela `public.secrets` já é o cofre do projeto.
--                         Guarda AGENDA_MS_* e EVOLUTION_API_KEY, tem RLS ligada
--                         e ZERO policy, então só o service_role alcança. Criar
--                         um segundo cofre só para e-mail deixaria duas verdades
--                         sobre onde segredo mora neste app.
--
--   email_oauth_states -> o `state` do OAuth vai ASSINADO por HMAC
--                         (agenda-microsoft/index.ts:108-133): o próprio
--                         parâmetro carrega quem pediu e quando, e a assinatura
--                         recusa adulteração. Sem linha para gravar, sem linha
--                         para expirar, sem faxina agendada.
--
-- As duas estão vazias — nada foi conectado ainda.

begin;

drop table if exists public.email_oauth_config;
drop table if exists public.email_oauth_states;

-- O que sobra da migration anterior e continua certo:
--
--   email_account_tokens  — os tokens de cada caixa, fora de `email_accounts`.
--     Difere DE PROPÓSITO do padrão da Agenda, que protege os tokens com grant
--     por coluna em `agenda_conexoes`. Aqui grant por coluna não serve:
--     `getEmailAccounts()` (src/services/email_accounts.ts) faz `select('*')`, e
--     o PostgREST devolve ERRO quando o papel não tem privilégio em alguma
--     coluna pedida — a tela quebraria inteira. Tabela separada dá a mesma
--     proteção sem obrigar a reescrever o serviço.
--
--   As policies de `email_accounts` — acesso por setor via `user_sectors`,
--     testado com 4 pessoas reais.

-- Segredo que assina o `state`. Gerado aqui, e não pedido a alguém, porque não é
-- credencial de ninguém: é interno e serve só para detectar adulteração. Mesmo
-- truque da migration 20260824190000 (Agenda), que evitou virar mais um passo
-- manual de instalação. `do nothing` para nunca invalidar um state em voo caso
-- esta migration rode duas vezes.
insert into public.secrets (key, value)
values ('EMAIL_MS_STATE_SECRET', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

commit;

-- ————————————————————————————————————————————————————————————————
-- AS TRÊS CHAVES DO APLICATIVO — normalmente pela tela, e não por aqui
-- ————————————————————————————————————————————————————————————————
--
-- O caminho normal é Configurações › Contas de Email, com o admin logado: os
-- valores vão do navegador direto para a edge function `email-microsoft`, que
-- grava com service_role. Foi a forma escolhida porque a alternativa (variável
-- de ambiente no Easypanel) exige RECRIAR container, e recriar container neste
-- stack já derrubou a API REST por ~1h em 29/07/2026.
--
-- Este bloco é o plano B, se a tela falhar. O SEGREDO NÃO DEVE PASSAR POR
-- CONVERSA NEM POR COMMIT — rodar direto no banco, trocando os valores:
--
--   INSERT INTO public.secrets (key, value) VALUES
--     ('EMAIL_MS_CLIENT_ID',     'id-do-aplicativo'),
--     ('EMAIL_MS_TENANT_ID',     'ec5a76d5-4773-4c5f-ae34-e667576941ae'),
--     ('EMAIL_MS_CLIENT_SECRET', 'o-valor-do-segredo')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--
-- Registro do aplicativo no Entra ID (já feito em 26/08/2026):
--   - URI de redirecionamento (Web):
--     https://apps-supabase.srofjl.easypanel.host/functions/v1/email-microsoft/callback
--   - Permissões delegadas: offline_access, User.Read, Mail.Read, Mail.ReadWrite,
--     Mail.Send
--   - Consentimento do administrador concedido
--
-- Enquanto as chaves não existirem, a tela mostra "Microsoft não configurada" em
-- vez de quebrar.
