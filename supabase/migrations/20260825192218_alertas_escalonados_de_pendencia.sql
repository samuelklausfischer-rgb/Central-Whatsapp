-- ETAPA 4: avisos de 2, 5 e 10 minutos.
--
-- Roda no BANCO, e não no navegador, de propósito: aviso que só existe enquanto
-- alguém está com o app aberto não serve para cobrar atraso — justamente quando
-- ninguém está olhando é que a mensagem fica parada.
--
-- IDEMPOTÊNCIA: o job roda a cada minuto. Os carimbos `alerta_*_at` são o que
-- impede avisar duas vezes a mesma pendência — cada UPDATE só pega linha com o
-- carimbo ainda nulo.
--
-- O aviso de 10 min sai por `public.send_whatsapp_message`, a MESMA RPC que as
-- mensagens agendadas usam (`private.process_scheduled_messages`). Não há edge
-- function nova: o caminho de envio já existia e é o testado em produção.
--
-- NOTA: o lookup de nome do contato aqui já está corrigido (`contacts.remote_jid`,
-- não `remote_sender`). A versão aplicada primeiro em produção tinha o nome
-- errado e foi consertada na migration seguinte — ver
-- `20260825192432_corrige_lookup_de_contato_no_alerta.sql`.

create or replace function private.processar_alertas_de_pendencia()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $function$
declare
  v_2m       integer := 0;
  v_5m       integer := 0;
  v_10m      integer := 0;
  v_enviados integer := 0;
  v_p        record;
  v_alvo     record;
  v_setor    text;
  v_nome     text;
  v_minutos  integer;
  v_device   uuid;
  v_texto    text;
  v_erro     text;
begin
  -- ── 2 minutos: destaque na lista ──
  with marcadas as (
    update public.conversation_pendencias
    set alerta_2m_at = now(), updated_at = now()
    where responded_at is null
      and alerta_2m_at is null
      and inbound_at < now() - interval '2 minutes'
    returning 1
  ) select count(*) into v_2m from marcadas;

  -- ── 5 minutos: destaque forte ──
  -- `is distinct from false` e não `= true`: pendência ainda NÃO classificada
  -- (requires_reply nulo) conta como "pede resposta". Falha da IA não pode
  -- silenciar cobrança.
  with marcadas as (
    update public.conversation_pendencias
    set alerta_5m_at = now(), updated_at = now()
    where responded_at is null
      and alerta_5m_at is null
      and requires_reply is distinct from false
      and inbound_at < now() - interval '5 minutes'
    returning 1
  ) select count(*) into v_5m from marcadas;

  -- ── 10 minutos: escala para o gerente do setor ──
  for v_p in
    select p.id, p.device_id, p.remote_sender, p.inbound_at,
           d.department as setor,
           extract(epoch from (now() - p.inbound_at))::int / 60 as minutos
    from public.conversation_pendencias p
    join public.devices d on d.id = p.device_id
    where p.responded_at is null
      and p.alerta_10m_at is null
      and p.requires_reply is distinct from false
      and p.inbound_at < now() - interval '10 minutes'
    order by p.inbound_at asc
    limit 20
    for update of p skip locked
  loop
    v_setor   := v_p.setor;
    v_minutos := v_p.minutos;

    select coalesce(c.nickname, c.name)
      into v_nome
    from public.contacts c
    where c.remote_jid = v_p.remote_sender
    limit 1;

    v_nome := coalesce(v_nome, split_part(v_p.remote_sender, '@', 1));

    v_texto := '⚠️ Atendimento parado há ' || v_minutos || ' min' ||
               E'\n\nContato: ' || v_nome ||
               E'\nSetor: ' || coalesce(v_setor, 'sem setor') ||
               E'\n\nNinguém respondeu ainda.';

    -- Carimba ANTES de enviar. Se o envio falhar, a pendência não fica tentando
    -- de novo a cada minuto — o aviso na tela continua valendo, e uma falha de
    -- rede não vira enxurrada de WhatsApp quando a Evolution voltar.
    update public.conversation_pendencias
    set alerta_10m_at = now(), updated_at = now()
    where id = v_p.id;
    v_10m := v_10m + 1;

    if v_setor is null then
      continue;
    end if;

    for v_alvo in
      select t.user_id, t.whatsapp_jid, t.device_id
      from public.sector_alert_targets t
      where t.setor = v_setor
        and t.ativo
        and t.whatsapp_jid is not null
    loop
      -- Aparelho configurado para o alvo, ou o próprio da conversa: assim o
      -- aviso chega do WhatsApp do setor, e não de um número estranho.
      v_device := coalesce(v_alvo.device_id, v_p.device_id);

      begin
        perform public.send_whatsapp_message(
          p_device_id     := v_device,
          p_remote_sender := v_alvo.whatsapp_jid,
          p_content       := v_texto,
          p_sender_id     := v_alvo.user_id,
          p_media_url     := null,
          p_media_type    := null,
          p_media_name    := null,
          p_reply_to_id   := null
        );
        v_enviados := v_enviados + 1;
      exception when others then
        -- Um destinatário com número errado não pode derrubar o aviso dos outros
        -- nem a varredura inteira.
        get stacked diagnostics v_erro = message_text;
        raise warning 'alerta 10min falhou para % : %', v_alvo.whatsapp_jid, v_erro;
      end;
    end loop;
  end loop;

  return jsonb_build_object(
    'marcadas_2m', v_2m,
    'marcadas_5m', v_5m,
    'marcadas_10m', v_10m,
    'whatsapp_enviados', v_enviados
  );
end;
$function$;

select cron.schedule(
  'alertas-de-pendencia',
  '* * * * *',
  $$select private.processar_alertas_de_pendencia();$$
);
