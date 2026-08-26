-- Agendamento do worker de disparo.
--
-- `private.email_chamar_funcao` (migration 20260826150000) só sabe falar com a
-- edge function `email-microsoft` — o nome estava fixo dentro dela. Agora há uma
-- segunda função (`email-campanha`), então a chamada passa a receber qual.
-- A versão antiga continua existindo como atalho, porque os dois jobs de
-- sincronização já criados a usam e não há motivo para mexer neles.

begin;

create or replace function private.email_chamar(p_funcao text, p_rota text)
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
    raise notice 'EMAIL_MS_CRON_SECRET ausente — %/% nao foi chamada', p_funcao, p_rota;
    return null;
  end if;

  select net.http_post(
    url     := 'https://apps-supabase.srofjl.easypanel.host/functions/v1/'
               || p_funcao || '/' || p_rota,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_segredo),
    body    := '{}'::jsonb
  ) into v_id;
  return v_id;
end;
$$;

comment on function private.email_chamar(text, text) is
  'Dispara uma rota de qualquer edge function de email a partir do pg_cron, autenticando por EMAIL_MS_CRON_SECRET.';

-- A antiga vira atalho para a nova, para os jobs existentes continuarem valendo.
create or replace function private.email_chamar_funcao(p_rota text)
returns bigint
language sql
security definer
set search_path to 'public'
as $$
  select private.email_chamar('email-microsoft', p_rota);
$$;

/*
  O worker do disparo, de minuto em minuto.

  Cada rodada manda o que couber em ~100 segundos e devolve o resto para a
  próxima — uma campanha de 200 leva umas 15 rodadas. Quem controla o ritmo é o
  worker, não o cron: ele espaça os envios, faz pausa longa a cada bloco e
  respeita a janela de horário. O cron só acorda.

  Quando não há campanha em andamento a chamada devolve `{"nada": true}` e custa
  praticamente nada.
*/
select cron.schedule(
  'email-disparo-worker',
  '* * * * *',
  $$select private.email_chamar('email-campanha', 'disparar');$$
);

commit;
