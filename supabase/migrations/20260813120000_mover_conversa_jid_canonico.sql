-- ============================================================
-- Mover uma conversa inteira para o JID canonico do WhatsApp
-- ============================================================
--
-- PROBLEMA
-- Quando o atendente cria uma conversa digitando o numero, o app monta a chave
-- com o que foi digitado (`55` + DDD + numero). Para celular brasileiro isso
-- produz 13 digitos, mas o JID canonico de MUITOS numeros tem 12 -- o WhatsApp
-- descarta o nono digito em linhas antigas. Qual das duas formas vale muda de
-- numero para numero, e so o WhatsApp sabe.
--
-- O envio funciona (o WhatsApp resolve sozinho e entrega), mas a linha fica
-- gravada sob a chave digitada. Quando o contato responde, o webhook usa o JID
-- canonico e cria uma SEGUNDA conversa. A mensagem enviada some da conversa em
-- que o atendimento acontece -- foi o relato de 13/08/2026, mensagem `40dbab1e`.
-- Medido na epoca: 8 conversas divididas, 14 mensagens presas.
--
-- POR QUE UMA RPC, E NAO VARIOS UPDATES NO WEBHOOK
-- `remote_sender` e chave em SETE tabelas. Mover so `messages` deixaria
-- atribuicao, marcadores, progresso de leitura e agendamentos apontando para uma
-- conversa que nao existe mais. Meia migracao e pior que nenhuma, e por isso tudo
-- acontece numa transacao so: ou muda inteiro, ou nao muda nada.
--
-- GUARDA DELIBERADAMENTE ESTREITA
-- A funcao SO aceita quando a diferenca e EXATAMENTE o nono digito de um numero
-- brasileiro. Existem 28 mil mensagens legitimas em chaves de 13 digitos (o
-- webhook as gravou assim porque e o JID certo delas); uma regra generica de
-- "normalizar telefone" quebraria todas. Qualquer outra divergencia e recusada.
--
-- COLISAO
-- `conversation_assignments` tem UNIQUE (device_id, remote_sender) e
-- `conversation_user_states` tem UNIQUE (user_id, device_id, remote_sender). Se o
-- destino ja tiver linha, um UPDATE cego aborta a transacao inteira. Nesses dois
-- casos o destino VENCE (e a conversa real, onde o atendimento esta acontecendo)
-- e a linha de origem e descartada.
--
-- Idempotente: rodar de novo com a conversa ja movida devolve zeros.

create or replace function public.mover_conversa_para_jid_canonico(
  p_device_id uuid,
  p_de text,
  p_para text
) returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_msgs int := 0;
  v_tags int := 0;
  v_atrib int := 0;
  v_leitura int := 0;
  v_estados int := 0;
  v_agend int := 0;
  v_logs int := 0;
  v_contato int := 0;
  v_com9 text;
  v_sem9 text;
begin
  if p_device_id is null or coalesce(p_de, '') = '' or coalesce(p_para, '') = '' then
    return json_build_object('error', 'parametros obrigatorios ausentes');
  end if;

  if p_de = p_para then
    return json_build_object('status', 'nada a fazer', 'motivo', 'chaves iguais');
  end if;

  -- Descobre quem e quem, aceitando a troca nos dois sentidos.
  if length(p_de) = 13 then
    v_com9 := p_de; v_sem9 := p_para;
  else
    v_com9 := p_para; v_sem9 := p_de;
  end if;

  -- A UNICA divergencia aceita: `55 DD 9 XXXXXXXX` contra `55 DD XXXXXXXX`.
  -- Mesmo pais, mesmo DDD, mesmos 8 digitos finais, e o `9` no lugar certo.
  if not (
    v_com9 ~ '^55[0-9]{2}9[0-9]{8}$'
    and v_sem9 ~ '^55[0-9]{10}$'
    and substr(v_com9, 1, 4) = substr(v_sem9, 1, 4)
    and substr(v_com9, 6) = substr(v_sem9, 5)
  ) then
    return json_build_object(
      'error', 'divergencia nao e o nono digito -- recusado por seguranca',
      'de', p_de, 'para', p_para
    );
  end if;

  -- ---- Colisoes primeiro: o DESTINO vence, a origem e descartada ----
  delete from conversation_assignments a
   where a.device_id = p_device_id
     and a.remote_sender = p_de
     and exists (
       select 1 from conversation_assignments b
        where b.device_id = p_device_id and b.remote_sender = p_para
     );

  delete from conversation_user_states s
   where s.device_id = p_device_id
     and s.remote_sender = p_de
     and exists (
       select 1 from conversation_user_states t
        where t.device_id = p_device_id
          and t.remote_sender = p_para
          and t.user_id = s.user_id
     );

  -- ---- Movimentacao ----
  update messages set remote_sender = p_para
   where device_id = p_device_id and remote_sender = p_de;
  get diagnostics v_msgs = row_count;

  update contact_tags set remote_sender = p_para
   where device_id = p_device_id and remote_sender = p_de;
  get diagnostics v_tags = row_count;

  update conversation_assignments set remote_sender = p_para
   where device_id = p_device_id and remote_sender = p_de;
  get diagnostics v_atrib = row_count;

  update conversation_read_progress set remote_sender = p_para
   where device_id = p_device_id and remote_sender = p_de;
  get diagnostics v_leitura = row_count;

  update conversation_user_states set remote_sender = p_para
   where device_id = p_device_id and remote_sender = p_de;
  get diagnostics v_estados = row_count;

  update scheduled_messages set remote_sender = p_para
   where device_id = p_device_id and remote_sender = p_de;
  get diagnostics v_agend = row_count;

  update conversation_action_logs set remote_sender = p_para
   where device_id = p_device_id and remote_sender = p_de;
  get diagnostics v_logs = row_count;

  -- `contacts` nao tem device_id nem UNIQUE em remote_jid. So renomeia quando o
  -- destino ainda nao existe; havendo os dois, a linha antiga fica para tras de
  -- proposito -- apagar poderia derrubar referencia que nao controlamos aqui, e
  -- contato sem mensagem nao aparece como conversa.
  if not exists (select 1 from contacts where remote_jid = p_para) then
    update contacts set remote_jid = p_para where remote_jid = p_de;
    get diagnostics v_contato = row_count;
  end if;

  return json_build_object(
    'status', 'ok',
    'de', p_de,
    'para', p_para,
    'messages', v_msgs,
    'contact_tags', v_tags,
    'conversation_assignments', v_atrib,
    'conversation_read_progress', v_leitura,
    'conversation_user_states', v_estados,
    'scheduled_messages', v_agend,
    'conversation_action_logs', v_logs,
    'contacts', v_contato
  );
end;
$function$;

-- Quem chama e o webhook (service_role) e o script de backfill. Usuario comum
-- nao tem motivo para remapear conversa, e liberar isso daria a qualquer sessao
-- autenticada o poder de mover conversa de aparelho alheio.
revoke all on function public.mover_conversa_para_jid_canonico(uuid, text, text) from public;
revoke all on function public.mover_conversa_para_jid_canonico(uuid, text, text) from anon;
revoke all on function public.mover_conversa_para_jid_canonico(uuid, text, text) from authenticated;
grant execute on function public.mover_conversa_para_jid_canonico(uuid, text, text) to service_role;
