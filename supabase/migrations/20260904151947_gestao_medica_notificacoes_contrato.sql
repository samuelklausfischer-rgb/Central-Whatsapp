-- Gestão Médica: notificação automática de contrato vencendo/vencido.
--
-- Não existia equivalente Supabase para isso — o que existia era um cron do
-- PocketBase legado (`pocketbase/hooks/cron_contratos.js`, fora deste repo,
-- backend desativado desde a migração para cá). O sino de notificações do
-- frontend (`NotificationDropdown.tsx`) já sabe ler `tipo='Contrato'`, só
-- ninguém nunca escreveu essas linhas no Supabase.
--
-- QUEM RECEBE: mesma audiência que `gestao_medica._pode_usar()` define hoje —
-- `is_super_admin` OU `department = 'Administrativo'` (conferido direto na
-- função ao vivo; a migration original do schema, de 26/08, ainda dizia
-- `is_admin`, mas foi trocado por `liberacoes_controle_mensagens_e_gestao_medica`
-- no mesmo dia). Reproduzido aqui em vez de chamar `_pode_usar()` porque essa
-- função depende de `auth.uid()`, que não existe em contexto de cron — aqui eu
-- preciso da LISTA de quem recebe, não de uma checagem do usuário atual.
--
-- FUNÇÃO SQL PURA, SEM EDGE FUNCTION: gerar a notificação só lê/escreve dentro
-- do próprio Postgres (configuracoes_sistema, contratos_medicos, medicos,
-- profiles, notificacoes) — não precisa de Microsoft Graph nem de nenhuma API
-- externa. Segue o padrão de `private.processar_alertas_de_pendencia()`
-- (`20260825192218_alertas_escalonados_de_pendencia.sql`): função
-- `security definer` chamada direto por `cron.schedule`, sem `net.http_post`.
--
-- GRAFIA DA PRIORIDADE IMPORTA: `NotificationDropdown.getPriorityColor` só
-- reconhece as strings exatas 'Crítica'/'Alta'/'Média' (com acento e
-- maiúscula) — o default da coluna é 'media' minúsculo, que cairia no azul
-- "sem categoria" se eu deixasse passar batido.
--
-- IDEMPOTÊNCIA: no máximo uma notificação por (usuário, contrato, dia) — não
-- por (usuário, contrato) fixo, porque um contrato que segue vencendo/vencido
-- deve continuar lembrando a cada dia que o job rodar, só não duplicar dentro
-- do mesmo dia se o job for chamado mais de uma vez.

create unique index if not exists gm_notificacoes_contrato_dia_idx
  on gestao_medica.notificacoes (user_id, (metadata ->> 'contrato_id'), (metadata ->> 'dia'))
  where tipo = 'Contrato';

create or replace function gestao_medica.gerar_notificacoes_contrato()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dias_alerta  integer;
  v_hoje         date := current_date;
  v_contrato     record;
  v_alvo         record;
  v_titulo       text;
  v_mensagem     text;
  v_prioridade   text;
  v_linha        integer;
  v_criadas      integer := 0;
  v_avaliadas    integer := 0;
begin
  select coalesce(cfg.dias_alerta_contrato, 30)
    into v_dias_alerta
  from gestao_medica.configuracoes_sistema cfg
  where cfg.singleton_key = 'default';

  v_dias_alerta := coalesce(v_dias_alerta, 30);

  for v_contrato in
    select
      c.id as contrato_id,
      c.medico_id,
      c.contratante,
      c.vigencia_fim,
      m.nome_completo,
      (c.vigencia_fim - v_hoje) as dias_restantes
    from gestao_medica.contratos_medicos c
    join gestao_medica.medicos m on m.id = c.medico_id
    where c.ativo = true
      and c.vigencia_fim is not null
      and coalesce(m.status_cadastro, '') <> 'Inativo'
      and c.vigencia_fim <= v_hoje + v_dias_alerta
  loop
    v_avaliadas := v_avaliadas + 1;

    if v_contrato.dias_restantes < 0 then
      v_titulo := 'Contrato Expirado';
      v_mensagem := 'O contrato de ' || v_contrato.nome_completo || ' (' ||
        coalesce(v_contrato.contratante, 'OUTRO') || ') venceu há ' ||
        abs(v_contrato.dias_restantes) || ' dia(s).';
      v_prioridade := 'Crítica';
    elsif v_contrato.dias_restantes <= 7 then
      v_titulo := 'Contrato Vencendo';
      v_mensagem := 'O contrato de ' || v_contrato.nome_completo || ' (' ||
        coalesce(v_contrato.contratante, 'OUTRO') || ') vence em ' ||
        v_contrato.dias_restantes || ' dia(s).';
      v_prioridade := 'Crítica';
    else
      v_titulo := 'Contrato Vencendo';
      v_mensagem := 'O contrato de ' || v_contrato.nome_completo || ' (' ||
        coalesce(v_contrato.contratante, 'OUTRO') || ') vence em ' ||
        v_contrato.dias_restantes || ' dia(s).';
      v_prioridade := 'Alta';
    end if;

    for v_alvo in
      select p.id as user_id
      from public.profiles p
      where coalesce(p.is_super_admin, false) or p.department = 'Administrativo'
    loop
      insert into gestao_medica.notificacoes
        (user_id, titulo, mensagem, tipo, prioridade, link, metadata)
      values (
        v_alvo.user_id,
        v_titulo,
        v_mensagem,
        'Contrato',
        v_prioridade,
        '/medicos/' || v_contrato.medico_id,
        jsonb_build_object(
          'contrato_id', v_contrato.contrato_id,
          'medico_id', v_contrato.medico_id,
          'dia', v_hoje::text
        )
      )
      on conflict (user_id, (metadata ->> 'contrato_id'), (metadata ->> 'dia'))
        where tipo = 'Contrato'
      do nothing;

      get diagnostics v_linha = row_count;
      v_criadas := v_criadas + v_linha;
    end loop;
  end loop;

  return jsonb_build_object(
    'processado_em', v_hoje,
    'dias_alerta', v_dias_alerta,
    'contratos_avaliados', v_avaliadas,
    'notificacoes_criadas', v_criadas
  );
end;
$function$;

comment on function gestao_medica.gerar_notificacoes_contrato() is
  'Gera notificações de contrato vencendo/vencido para quem _pode_usar() o Gestão
   Médica hoje (is_super_admin ou setor Administrativo). Idempotente por dia via
   índice único parcial em (user_id, contrato_id, dia) dentro de metadata.';

-- 10:00 UTC ≈ 07:00 BRT — antes do início do expediente, para a notificação já
-- estar no sino quando o time chegar. Ajustável depois se o horário não servir.
select cron.schedule(
  'gestao-medica-contratos-vencendo',
  '0 10 * * *',
  $$select gestao_medica.gerar_notificacoes_contrato();$$
);
