-- Email Hub: os dois trabalhos automáticos que mantêm a caixa viva.
--
-- POR QUE SÃO DOIS, E NÃO UM. O aviso em tempo real da Microsoft é o caminho
-- normal, mas a inscrição dele VENCE em ~3 dias. Se a renovação falhar, os
-- avisos param SEM ERRO NENHUM: a caixa simplesmente congela e ninguém percebe
-- até sentir falta de um e-mail. Então:
--   - `email-renovar-avisos` cuida de a inscrição nunca vencer;
--   - `email-varredura` é a rede embaixo, caso ela vença assim mesmo.
-- Uma sozinha seria confiar demais em algo que falha calado.

begin;

-- Segredos gerados aqui, e não pedidos a alguém: não são credencial de
-- ninguém, são internos. Mesmo critério do EMAIL_MS_STATE_SECRET.
insert into public.secrets (key, value) values
  ('EMAIL_MS_WEBHOOK_SECRET', encode(gen_random_bytes(32), 'hex')),
  ('EMAIL_MS_CRON_SECRET',    encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

/*
  Chama a edge function.

  O agendador se identifica por `EMAIL_MS_CRON_SECRET`, e NÃO pela chave de
  serviço. Guardar a chave de serviço dentro de uma função do Postgres para o
  cron alcançar daria a este job poder sobre o banco inteiro; este segredo só
  abre "sincronizar" e "renovar".

  `net.http_post` é assíncrono: enfileira e devolve na hora. É o que se quer —
  uma varredura demorada não pode segurar o worker do pg_cron.
*/
create or replace function private.email_chamar_funcao(p_rota text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_segredo text;
  v_id      bigint;
begin
  select value into v_segredo from public.secrets where key = 'EMAIL_MS_CRON_SECRET';
  if v_segredo is null then
    raise notice 'EMAIL_MS_CRON_SECRET ausente — % nao foi chamada', p_rota;
    return null;
  end if;

  select net.http_post(
    url     := 'https://apps-supabase.srofjl.easypanel.host/functions/v1/email-microsoft/' || p_rota,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_segredo),
    body    := '{}'::jsonb
  ) into v_id;
  return v_id;
end;
$$;

comment on function private.email_chamar_funcao(text) is
  'Dispara uma rota da edge function email-microsoft a partir do pg_cron, autenticando por EMAIL_MS_CRON_SECRET (nao pela chave de servico).';

-- A cada 15 min: pega o que o aviso em tempo real porventura perdeu. Usa delta,
-- então quando não há novidade a chamada custa quase nada.
select cron.schedule(
  'email-varredura',
  '*/15 * * * *',
  $$select private.email_chamar_funcao('sincronizar');$$
);

-- A cada 6h: renova o que vence nas próximas 24h. Renovar com um dia de
-- antecedência — e não na última hora — dá várias tentativas antes de a caixa
-- congelar, mesmo que a Microsoft esteja instável por um período.
select cron.schedule(
  'email-renovar-avisos',
  '17 */6 * * *',
  $$select private.email_chamar_funcao('renovar');$$
);

commit;
