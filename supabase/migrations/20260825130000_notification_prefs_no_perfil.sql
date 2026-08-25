-- Preferências de notificação passam a viver no perfil, não no navegador.
--
-- Antes existiam SÓ em `localStorage`, na chave `notif_prefs_<user_id>`. Como o
-- localStorage é por navegador/aplicativo, o app Electron, o PWA instalado e cada
-- aba do Chrome tinham configurações independentes — e o padrão de quem não tem
-- registro é `{sound: true, background: true}`. Ou seja: abrir o app num lugar novo
-- ressuscitava o aviso de TODOS os aparelhos, inclusive os deliberadamente
-- silenciados. Falhava sempre para o lado barulhento.
--
-- Formato: {"<device_id>": {"sound": bool, "background": bool}}
--
-- SEM policy nova de propósito: `users_update_own_profile` já permite a cada
-- pessoa atualizar qualquer coluna do próprio perfil menos `is_admin`. Para
-- notificação isso é exatamente o desejado — cada um ajusta o próprio aviso, e
-- não há nada aqui que valha a pena proteger de quem é dono do dado.

alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.notification_prefs is
  'Preferencias de notificacao por aparelho, no formato {"<device_id>": {"sound": bool, "background": bool}}. Antes viviam so no localStorage: como ele e por navegador, o app desktop, o PWA e cada aba tinham configuracao propria, e a ausencia de registro cai no padrao {sound:true, background:true} - ou seja, falhava para o lado BARULHENTO. A policy users_update_own_profile ja cobre esta coluna (auto-atualizacao de qualquer coluna menos is_admin), que aqui e o comportamento desejado: cada pessoa ajusta o proprio aviso.';
