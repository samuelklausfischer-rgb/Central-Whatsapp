-- O VERIFICADOR: pergunta à Evolution se a mensagem saiu de fato
--
-- Uma tentativa fica `pendente` quando o app gravou a linha e nada voltou —
-- estouro dos 8s de `statement_timeout`, aba fechada no meio, queda de rede.
-- Sem alguém para resolver, ela mostraria "enviando" para sempre.
--
-- POR QUE NÃO BASTA MARCAR COMO FALHA DEPOIS DE UM TEMPO
--
-- Porque a mensagem pode ter saído. O caso ruim é justamente esse: a RPC estoura
-- os 8 segundos DEPOIS de a Evolution já ter aceitado a mensagem — a transação é
-- desfeita, nenhuma linha fica em `messages`, e o WhatsApp entregou assim mesmo.
-- Marcar cegamente como falha convidaria a atendente a reenviar, e a paciente
-- receberia duas vezes.
--
-- DOIS ESTÁGIOS
--
--   1. Procura em `messages`. É de graça e cobre o caso comum (a RPC deu certo e
--      o navegador morreu antes de apagar a tentativa).
--   2. Só então chama `POST /chat/findMessages/{instância}` na Evolution, que é a
--      única fonte de verdade para o caso acima.
--
-- Formato da resposta conferido contra a API real: `messages.records[]`, cada um
-- com `key.id`, `key.fromMe` e `messageTimestamp`.
--
-- O casamento é por REMETENTE + JANELA DE TEMPO + TEXTO CONTIDO. É heurística, e
-- assumidamente: a tentativa que falhou não tem `external_id` — é exatamente o
-- que se perdeu. `strpos` e não `like` porque o conteúdo pode conter `%` ou `_`,
-- e porque a assinatura do atendente vem PREPENDADA ao texto que chega no
-- WhatsApp. Mídia sem legenda casa só por remetente e tempo.
--
-- ELE SÓ MARCA. NUNCA REENVIA — decisão explícita, e o lado seguro da
-- heurística acima. Isto é mensagem para paciente, e o próprio repo já registra
-- (`20260731150000_retry_dns_envio.sql`) que só falha de resolução DNS garante
-- que a requisição não saiu. Reenvio é sempre humano, pelo botão no balão.
--
-- Evolution fora do ar não conclui nada: a tentativa fica `pendente` e volta na
-- rodada seguinte. Só depois de uma hora sem conseguir perguntar é que vira
-- falha — e com um texto que avisa que NÃO houve confirmação, porque quem for
-- clicar em reenviar precisa saber disso.

create or replace function private.verificar_tentativas_de_envio(p_limite int default 10)
returns int
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_t          record;
  v_url        text;
  v_key        text;
  v_inst       text;
  v_jid        text;
  v_resp       extensions.http_response;
  v_rec        jsonb;
  v_texto      text;
  v_quando     timestamptz;
  v_ext        text;
  v_achou      boolean;
  v_respondeu  boolean;
  v_resolvidas int := 0;
begin
  select value into v_key from public.secrets where key = 'EVOLUTION_API_KEY';
  select value into v_url from public.secrets where key = 'EVOLUTION_API_URL';
  v_url := rtrim(coalesce(v_url, 'http://apps-evolution-api.srofjl.easypanel.host'), '/');

  if v_key is null then
    raise warning '[verificador] sem EVOLUTION_API_KEY -- nada a fazer';
    return 0;
  end if;

  -- Sem teto de tempo, uma Evolution lenta seguraria o cron inteiro.
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '10');

  for v_t in
    select t.*
    from public.tentativas_de_envio t
    where t.status = 'pendente'
      -- 2 minutos de carencia: o teto de uma chamada de envio e 8s
      -- (statement_timeout), entao nada legitimo fica pendente tanto tempo.
      and t.created_at < now() - interval '2 minutes'
    order by t.created_at
    limit p_limite
    for update skip locked
  loop
    v_achou     := false;
    v_respondeu := false;
    v_ext       := null;

    -- ESTAGIO 1: a mensagem real ja esta em `messages`?
    select m.external_id into v_ext
    from public.messages m
    where m.device_id     = v_t.device_id
      and m.remote_sender = v_t.remote_sender
      and m.direction     = 'outbound'
      and m.deleted_at is null
      and m.created_at between v_t.created_at - interval '1 minute'
                           and v_t.created_at + interval '10 minutes'
      and (v_t.conteudo = '' or strpos(m.content, v_t.conteudo) > 0)
    order by m.created_at
    limit 1;

    if v_ext is not null then
      v_achou := true;
    else
      -- ESTAGIO 2: perguntar a Evolution.
      select instance_key into v_inst from public.devices where id = v_t.device_id;

      if v_inst is not null then
        v_jid := case
                   when v_t.remote_sender like '%@%' then v_t.remote_sender
                   else regexp_replace(v_t.remote_sender, '\D', '', 'g') || '@s.whatsapp.net'
                 end;

        begin
          select * into v_resp from extensions.http((
            'POST',
            v_url || '/chat/findMessages/' || replace(v_inst, ' ', '%20'),
            array[extensions.http_header('apikey', v_key)],
            'application/json',
            json_build_object(
              'where', json_build_object('key', json_build_object('remoteJid', v_jid)),
              'limit', 30
            )::text
          )::extensions.http_request);
          v_respondeu := (v_resp.status = 200);
        exception when others then
          raise warning '[verificador] Evolution nao respondeu para %: %', v_t.id, sqlerrm;
          v_respondeu := false;
        end;

        if v_respondeu then
          for v_rec in
            select jsonb_array_elements(v_resp.content::jsonb -> 'messages' -> 'records')
          loop
            continue when coalesce(v_rec -> 'key' ->> 'fromMe', 'false') <> 'true';

            v_quando := to_timestamp((v_rec ->> 'messageTimestamp')::bigint);
            continue when v_quando < v_t.created_at - interval '1 minute'
                       or v_quando > v_t.created_at + interval '10 minutes';

            v_texto := coalesce(
              v_rec -> 'message' ->> 'conversation',
              v_rec -> 'message' -> 'extendedTextMessage' ->> 'text',
              v_rec -> 'message' -> 'imageMessage'    ->> 'caption',
              v_rec -> 'message' -> 'videoMessage'    ->> 'caption',
              v_rec -> 'message' -> 'documentMessage' ->> 'caption',
              ''
            );

            if v_t.conteudo = '' or strpos(v_texto, v_t.conteudo) > 0 then
              v_achou := true;
              v_ext   := v_rec -> 'key' ->> 'id';
              exit;
            end if;
          end loop;
        end if;
      end if;
    end if;

    if v_achou then
      update public.tentativas_de_envio
      set status = 'enviada', external_id = coalesce(v_ext, external_id),
          erro = null, verificado_em = now()
      where id = v_t.id;
      v_resolvidas := v_resolvidas + 1;

    elsif v_respondeu then
      update public.tentativas_de_envio
      set status = 'falhou', verificado_em = now(),
          erro = coalesce(erro, 'A Evolution nao encontrou esta mensagem: ela nao saiu.')
      where id = v_t.id;
      v_resolvidas := v_resolvidas + 1;

    elsif v_t.created_at < now() - interval '1 hour' then
      update public.tentativas_de_envio
      set status = 'falhou', verificado_em = now(),
          erro = coalesce(erro, 'Nao foi possivel confirmar com a Evolution. Confira no WhatsApp antes de reenviar.')
      where id = v_t.id;
      v_resolvidas := v_resolvidas + 1;
    end if;
  end loop;

  return v_resolvidas;
end;
$function$;

comment on function private.verificar_tentativas_de_envio(int) is
  'Resolve tentativas de envio penduradas: procura primeiro em messages e, se nao achar, pergunta a Evolution (findMessages). SO MARCA -- nunca reenvia.';

-- A cada minuto, como o `process-scheduled-messages` que serviu de molde.
-- Lote de 10 com `FOR UPDATE SKIP LOCKED`: se uma rodada ainda estiver correndo,
-- a próxima pega outras linhas em vez de esperar.
select cron.schedule(
  'verificar-tentativas-de-envio',
  '* * * * *',
  $cron$select private.verificar_tentativas_de_envio(10);$cron$
);

-- Tentativa confirmada não interessa mais a ninguém depois de uma semana — a
-- mensagem de verdade está em `messages`. As `falhou` NÃO são apagadas: são o
-- registro de que algo não saiu, e quem apaga é a pessoa, pelo botão descartar.
select cron.schedule(
  'limpar-tentativas-confirmadas',
  '40 4 * * *',
  $cron$delete from public.tentativas_de_envio where status = 'enviada' and verificado_em < now() - interval '7 days';$cron$
);
