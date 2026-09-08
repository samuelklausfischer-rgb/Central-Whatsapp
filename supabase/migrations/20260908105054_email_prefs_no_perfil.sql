-- Ajustes pessoais de e-mail no perfil — a começar pela assinatura.
--
-- POR QUE NÃO EM `email_accounts.signature`, QUE JÁ EXISTE:
-- a policy de escrita daquela tabela é
--   using ( _is_admin() OR (user_id = auth.uid() AND department IS NULL) )
-- ou seja, em caixa PESSOAL o dono edita, mas em caixa de SETOR (`financeiro@`,
-- `suportelaudos@`) só admin escreve — e a linha é UMA SÓ para o setor inteiro.
-- Todo mundo assinaria igual, e ninguém além do admin poderia mexer. É o oposto
-- de "cada pessoa configura a sua". Aquela coluna fica órfã: está nula nas 6
-- contas e nunca teve tela que a escrevesse.
--
-- SEM POLICY NOVA, pelo mesmo motivo de `notification_prefs`:
-- `users_update_own_profile` já permite a cada pessoa atualizar qualquer coluna
-- do próprio perfil menos `is_admin`. Assinatura é dado de quem é dono dele.
--
-- ⚠️ NÃO CONFUNDIR COM `profiles.signature`, LOGO AO LADO.
-- Aquela é a assinatura do WHATSAPP: texto puro, aplicada dentro da RPC
-- `send_whatsapp_message`, prefixada ao conteúdo com duas quebras de linha. Esta
-- aqui é HTML e vale só para e-mail. Unificar as duas mandaria marcação de HTML
-- para dentro de uma mensagem de WhatsApp.
--
-- Nasce `jsonb`, e não `text`, para os próximos ajustes pessoais (qual caixa
-- abrir por padrão, responder-para) caberem sem outra migration.
-- Formato: {"assinatura_html": "<p>...</p>"}

alter table public.profiles
  add column if not exists email_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.email_prefs is
  'Ajustes pessoais do Email Hub, no formato {"assinatura_html": "<p>...</p>"}. NAO confundir com profiles.signature, que e a assinatura do WhatsApp (texto puro, aplicada na RPC send_whatsapp_message). A assinatura de e-mail nao pode viver em email_accounts.signature porque a policy de escrita de la exige admin quando a caixa e de setor, e a linha e compartilhada pelo setor inteiro - todos assinariam igual. A policy users_update_own_profile ja cobre esta coluna.';
