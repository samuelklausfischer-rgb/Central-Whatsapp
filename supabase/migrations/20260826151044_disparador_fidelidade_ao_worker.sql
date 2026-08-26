-- Disparador em massa: deixar o envio fiel ao worker do `prn-vigilante`.
--
-- Auditoria linha a linha do meu caminho de envio contra o do app original achou
-- tres diferencas. O intervalo aleatorio e a pausa longa ja estavam identicos
-- (medido: 2.000 sorteios, media 481 s); faltavam o "digitando...", a retentativa
-- e o raio-X do numero.

-- ============================================================
-- 1. "digitando..." no celular do contato
-- ============================================================
-- POR QUE UMA RPC PROPRIA, E NAO UM PARAMETRO EM `send_whatsapp_message`
-- Aquela funcao tem 13 KB e e a mais critica do app -- todo envio do chat passa
-- por ela. Acrescentar um campo exigiria reescrever o corpo inteiro (remendar por
-- `replace()` sobre `pg_get_functiondef` e recusado neste projeto). Uma funcao
-- pequena ao lado consegue o mesmo sem encostar nela, e sai com um `drop`.
--
-- POR QUE A CREDENCIAL CONTINUA NO BANCO
-- O worker do disparador nao fala com a Evolution: ele fala com o banco, e o banco
-- fala com a Evolution. Foi assim que a mensagem do disparo passou a aparecer na
-- conversa do chat. Botar a chave da Evolution no worker so para mostrar
-- "digitando" desfaria essa decisao por um enfeite.
--
-- POR QUE NAO MANDAMOS `delay`
-- A Evolution aceita `delay` no sendPresence e SEGURA a conexao por esse tempo.
-- Com `statement_timeout = 8s` neste banco (o mesmo teto que ja derrubou o envio
-- de audio encaminhado) e digitacao calculada em ate 8.000 ms, a chamada bateria
-- exatamente no limite. Entao a presenca e disparada e volta na hora; quem espera
-- e o worker, do lado dele. O efeito para o contato e identico -- o indicador do
-- WhatsApp fica de pe sozinho por ~25 s, e a chegada da mensagem o apaga.
--
-- (O original resolve isso com `delay: 1200` FIXO no payload do envio. Aqui a
-- duracao acompanha o tamanho do texto, usando o calculo que o `humanizer.ts` ja
-- fazia e desperdicava como sleep local.)
create or replace function public.disparo_presenca(
  p_device_id     uuid,
  p_remote_sender text,
  p_presence      text default 'composing'
)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  v_instance_key text;
  v_safe_instance text;
  v_secret_key text;
  v_secret_url text;
  v_normalized text;
  v_body text;
  v_resp http_response;
BEGIN
  SELECT instance_key INTO v_instance_key FROM devices WHERE id = p_device_id;
  IF v_instance_key IS NULL THEN
    RETURN json_build_object('error', 'device not found');
  END IF;
  v_safe_instance := replace(v_instance_key, ' ', '%20');

  SELECT value INTO v_secret_key FROM secrets WHERE key = 'EVOLUTION_API_KEY';
  SELECT value INTO v_secret_url FROM secrets WHERE key = 'EVOLUTION_API_URL';
  IF v_secret_url IS NULL THEN
    v_secret_url := 'http://apps-evolution-api.srofjl.easypanel.host';
  END IF;
  v_secret_url := rtrim(v_secret_url, '/');
  IF v_secret_key IS NULL THEN
    RETURN json_build_object('error', 'missing EVOLUTION_API_KEY');
  END IF;

  -- Mesma normalizacao de `send_whatsapp_message`: grupo vai inteiro, privado vai
  -- so em digitos. Duas regras diferentes para o mesmo numero e como a presenca
  -- ir para um chat e a mensagem para outro.
  IF p_remote_sender LIKE '%@g.us' THEN
    v_normalized := p_remote_sender;
  ELSE
    v_normalized := regexp_replace(
      regexp_replace(p_remote_sender, '@s\.whatsapp\.net|@lid', '', 'g'),
      '\D', '', 'g'
    );
  END IF;

  v_body := jsonb_build_object(
    'number', v_normalized,
    'presence', coalesce(nullif(p_presence, ''), 'composing')
  )::text;

  BEGIN
    v_resp := http(ROW(
      'POST'::http_method,
      v_secret_url || '/chat/sendPresence/' || v_safe_instance,
      ARRAY[
        ROW('Content-Type', 'application/json')::http_header,
        ROW('apikey', v_secret_key)::http_header
      ],
      'application/json',
      v_body
    )::http_request);
  EXCEPTION WHEN OTHERS THEN
    -- Presenca NUNCA derruba nada. Mostrar "digitando" e enfeite; entregar a
    -- mensagem e o trabalho. Quem chama recebe o erro e segue para o envio.
    RETURN json_build_object('error', SQLERRM);
  END;

  RETURN json_build_object('status', v_resp.status);
END;
$function$;

comment on function public.disparo_presenca(uuid, text, text) is
  'Mostra "digitando..." para o contato. Sem `delay` de proposito: a Evolution
   seguraria a conexao e bateria no statement_timeout de 8s. Quem espera e o worker.';

revoke execute on function public.disparo_presenca(uuid, text, text) from public, anon, authenticated;

-- ============================================================
-- 2. A guarda que torna a retentativa segura
-- ============================================================
-- O worker repete o envio 3x com espera exponencial, como o `prn-vigilante`. So
-- que a `send_whatsapp_message` deste projeto documenta, no proprio corpo, por que
-- ELA nao repete:
--
--   "SO falha de RESOLUCAO pode ser repetida: e o unico caso em que existe
--    garantia de que a requisicao NAO saiu. (...) repetir uma falha posterior
--    mandaria a mesma mensagem DUAS VEZES."
--
-- Um timeout e exatamente o caso ambiguo: a Evolution pode ter entregue e so a
-- resposta ter se perdido. Repetir ali manda a mesma mensagem duas vezes para o
-- cliente -- o erro mais visivel que um disparo em massa pode cometer.
--
-- Esta funcao desfaz a ambiguidade. Antes de cada nova tentativa o worker
-- pergunta: existe mensagem de saida para este contato, neste aparelho, com este
-- conteudo, nos ultimos N segundos? Se existe, o timeout mentiu.
--
-- NAO E IDEIA NOVA: e o mesmo raciocinio do `messageFingerprint` em ChatHub.tsx,
-- que ja reconcilia o eco de Realtime com a mensagem otimista comparando
-- aparelho + contato + conteudo.
--
-- A JANELA CURTA E DE PROPOSITO. Comparar so por conteudo acharia a mensagem do
-- disparo do mes passado; com 2 minutos, o unico jeito de dar falso positivo e
-- alguem ter mandado o MESMO texto para o MESMO contato pelo MESMO aparelho
-- naquele intervalo -- que, num disparo, e precisamente o que estamos procurando.
create or replace function public.disparo_ja_saiu(
  p_device_id     uuid,
  p_remote_sender text,
  p_content       text,
  p_segundos      integer default 120
)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select m.id
  from public.messages m
  where m.device_id = p_device_id
    and m.direction = 'outbound'
    and m.deleted_at is null
    and m.created_at >= now() - make_interval(secs => greatest(10, p_segundos))
    -- Normaliza os dois lados: o alvo guarda so digitos, e `messages` pode ter
    -- gravado com sufixo de JID.
    and regexp_replace(m.remote_sender, '\D', '', 'g')
        = regexp_replace(p_remote_sender, '\D', '', 'g')
    and m.content = p_content
  order by m.created_at desc
  limit 1;
$function$;

comment on function public.disparo_ja_saiu(uuid, text, text, integer) is
  'Devolve o id da mensagem se ela ja foi entregue nos ultimos N segundos. Usada
   pelo worker antes de repetir um envio, para nao mandar duas vezes.';

revoke execute on function public.disparo_ja_saiu(uuid, text, text, integer) from public, anon, authenticated;

-- ============================================================
-- 3. Raio-X: o numero existe no WhatsApp?
-- ============================================================
-- Portado do `prn-vigilante`, com duas diferencas de proposito:
--
-- a) AQUI E AO MONTAR A LISTA, nao durante o disparo. La a checagem entra no meio
--    do envio e soma uma chamada a Evolution por contato. Como o ritmo seguro ja
--    gasta de 3 a 13 min por pessoa, verificar antes evita queimar um slot desses
--    com numero morto -- e numero inexistente em serie e sinal de spam para o
--    WhatsApp, exatamente o que o humanizador tenta evitar.
--
-- b) EM LOTES DE 50, por causa do `statement_timeout` de 8s. Uma lista de 500
--    numeros numa chamada HTTP so estouraria; a tela chama em laco e mostra
--    progresso.
alter table public.disparo_lista_membros
  add column if not exists tem_whatsapp  boolean,
  add column if not exists verificado_em timestamptz;

comment on column public.disparo_lista_membros.tem_whatsapp is
  'null = nunca verificado. Ausencia de verificacao NAO e ausencia de WhatsApp:
   quem esta null continua entrando no disparo.';

create or replace function public.disparo_verificar_whatsapp(
  p_device_id uuid,
  p_list_id   uuid,
  p_limite    integer default 50
)
returns table (verificados integer, com_whatsapp integer, restantes integer)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  v_instance_key text;
  v_safe_instance text;
  v_secret_key text;
  v_secret_url text;
  v_numeros text[];
  v_resp http_response;
  v_json jsonb;
  v_ok integer := 0;
  v_total integer := 0;
BEGIN
  IF NOT public.pode_disparar() THEN
    RAISE EXCEPTION 'Sem permissao para o Disparador em massa';
  END IF;
  IF NOT public.can_access_device(p_device_id) THEN
    RAISE EXCEPTION 'Sem acesso a este aparelho';
  END IF;

  SELECT instance_key INTO v_instance_key FROM devices WHERE id = p_device_id;
  IF v_instance_key IS NULL THEN RAISE EXCEPTION 'Aparelho nao encontrado'; END IF;
  v_safe_instance := replace(v_instance_key, ' ', '%20');

  SELECT value INTO v_secret_key FROM secrets WHERE key = 'EVOLUTION_API_KEY';
  SELECT value INTO v_secret_url FROM secrets WHERE key = 'EVOLUTION_API_URL';
  IF v_secret_url IS NULL THEN
    v_secret_url := 'http://apps-evolution-api.srofjl.easypanel.host';
  END IF;
  v_secret_url := rtrim(v_secret_url, '/');
  IF v_secret_key IS NULL THEN RAISE EXCEPTION 'missing EVOLUTION_API_KEY'; END IF;

  SELECT array_agg(m.remote_sender)
  INTO   v_numeros
  FROM  (SELECT remote_sender FROM public.disparo_lista_membros
          WHERE list_id = p_list_id AND verificado_em IS NULL
          ORDER BY created_at LIMIT greatest(1, least(coalesce(p_limite, 50), 100))) m;

  IF v_numeros IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;
  v_total := array_length(v_numeros, 1);

  v_resp := http(ROW(
    'POST'::http_method,
    v_secret_url || '/chat/whatsappNumbers/' || v_safe_instance,
    ARRAY[
      ROW('Content-Type', 'application/json')::http_header,
      ROW('apikey', v_secret_key)::http_header
    ],
    'application/json',
    jsonb_build_object('numbers', to_jsonb(v_numeros))::text
  )::http_request);

  IF v_resp.status <> 200 THEN
    RAISE EXCEPTION 'Evolution respondeu % ao verificar numeros', v_resp.status;
  END IF;

  v_json := v_resp.content::jsonb;

  -- A resposta vem como [{ exists, jid, number }]. Comparo so por digitos, que e
  -- como o resto do app trata numero.
  UPDATE public.disparo_lista_membros m
     SET tem_whatsapp  = coalesce((r ->> 'exists')::boolean, false),
         verificado_em = now()
  FROM jsonb_array_elements(v_json) AS r
  WHERE m.list_id = p_list_id
    AND regexp_replace(m.remote_sender, '\D', '', 'g')
        = regexp_replace(coalesce(r ->> 'number', ''), '\D', '', 'g');

  -- Quem foi mandado e nao voltou na resposta tambem conta como verificado, senao
  -- a tela ficaria pedindo o mesmo lote para sempre.
  UPDATE public.disparo_lista_membros
     SET tem_whatsapp = coalesce(tem_whatsapp, false), verificado_em = now()
   WHERE list_id = p_list_id
     AND verificado_em IS NULL
     AND remote_sender = ANY(v_numeros);

  SELECT count(*) INTO v_ok
  FROM public.disparo_lista_membros
  WHERE list_id = p_list_id AND remote_sender = ANY(v_numeros) AND tem_whatsapp;

  RETURN QUERY
  SELECT v_total, v_ok,
         (SELECT count(*)::int FROM public.disparo_lista_membros
           WHERE list_id = p_list_id AND verificado_em IS NULL);
END;
$function$;

comment on function public.disparo_verificar_whatsapp(uuid, uuid, integer) is
  'Verifica em lote se os numeros da lista existem no WhatsApp. Lote pequeno por
   causa do statement_timeout de 8s; a tela chama em laco.';

revoke execute on function public.disparo_verificar_whatsapp(uuid, uuid, integer) from public, anon;
grant execute on function public.disparo_verificar_whatsapp(uuid, uuid, integer) to authenticated;

-- ============================================================
-- 4. O disparo passa a pular quem nao tem WhatsApp
-- ============================================================
-- Sem isto o raio-X seria enfeite: a tela mostraria a marcacao e o disparo mandaria
-- assim mesmo.
--
-- `tem_whatsapp IS NOT FALSE` e nao `= true`: quem nunca foi verificado (`null`)
-- CONTINUA entrando. Ausencia de verificacao nao e ausencia de WhatsApp, e travar
-- disparo de lista nao verificada seria uma surpresa ruim.
--
-- O resto do corpo esta identico ao de `20260826142207_disparador_rpcs`; a unica
-- linha nova e o `and m.tem_whatsapp is not false`.
create or replace function public.disparo_criar(
  p_nome        text,
  p_device_id   uuid,
  p_mensagem    text,
  p_iniciar_em  timestamptz,
  p_list_id     uuid    default null,
  p_avulsos     text[]  default null,
  p_anexos      jsonb   default null,
  p_ritmo       jsonb   default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_alvos integer;
begin
  if not public.pode_disparar() then
    raise exception 'Sem permissao para o Disparador em massa';
  end if;
  if not public.can_access_device(p_device_id) then
    raise exception 'Sem acesso a este aparelho';
  end if;
  if coalesce(trim(p_mensagem), '') = '' then
    raise exception 'A mensagem nao pode ser vazia';
  end if;

  insert into public.disparo_campanhas (
    nome, device_id, list_id, mensagem, anexos, iniciar_em, status, created_by,
    delay_min_ms, delay_max_ms, jitter_pct, pausa_a_cada, pausa_longa_ms,
    respeitar_horario, hora_inicio, hora_fim
  )
  values (
    p_nome, p_device_id, p_list_id, p_mensagem, p_anexos,
    coalesce(p_iniciar_em, now()), 'agendado', auth.uid(),
    coalesce((p_ritmo ->> 'delay_min_ms')::int, 180000),
    coalesce((p_ritmo ->> 'delay_max_ms')::int, 780000),
    coalesce((p_ritmo ->> 'jitter_pct')::numeric, 0.15),
    coalesce((p_ritmo ->> 'pausa_a_cada')::int, 5),
    coalesce((p_ritmo ->> 'pausa_longa_ms')::int, 60000),
    coalesce((p_ritmo ->> 'respeitar_horario')::boolean, false),
    coalesce((p_ritmo ->> 'hora_inicio')::smallint, 8),
    coalesce((p_ritmo ->> 'hora_fim')::smallint, 20)
  )
  returning id into v_id;

  if p_list_id is not null then
    insert into public.disparo_alvos (campaign_id, remote_sender, nome_exibicao, avulso)
    select v_id, m.remote_sender, m.nome_exibicao, false
    from public.disparo_lista_membros m
    where m.list_id = p_list_id
      and m.tem_whatsapp is not false
    on conflict (campaign_id, remote_sender) do nothing;
  end if;

  if p_avulsos is not null then
    insert into public.disparo_alvos (campaign_id, remote_sender, nome_exibicao, avulso)
    select v_id, n.numero,
           coalesce(max(coalesce(c.nickname, c.name)), n.numero),
           true
    from (
      select distinct public.disparo_normalizar_numero(x) as numero
      from unnest(p_avulsos) as x
    ) n
    left join public.contacts c on c.remote_jid = n.numero
    where n.numero is not null
    group by n.numero
    on conflict (campaign_id, remote_sender) do nothing;
  end if;

  select count(*) into v_alvos from public.disparo_alvos where campaign_id = v_id;
  if v_alvos = 0 then
    raise exception 'Nenhum destinatario valido: o disparo nao foi criado';
  end if;

  return v_id;
end;
$function$;

revoke execute on function public.disparo_criar(text, uuid, text, timestamptz, uuid, text[], jsonb, jsonb) from public, anon;
grant execute on function public.disparo_criar(text, uuid, text, timestamptz, uuid, text[], jsonb, jsonb) to authenticated;
