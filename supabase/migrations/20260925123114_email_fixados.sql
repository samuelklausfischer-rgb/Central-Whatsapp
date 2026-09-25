-- Item 2 da fila de 25/09/2026: fixar e-mail com etiqueta de urgência e
-- lembrete de leitura, com aviso 15 min antes, na hora, e no dia seguinte
-- às 8h quando o e-mail continua não lido.
--
-- POR QUE TABELA NOVA, e não uma coluna em `email_states`:
-- `email_states` tem `email_id` UNIQUE — é UMA linha por e-mail, do time
-- inteiro. O pin combinado com o Samuel é PESSOAL ("pessoal, com opção de
-- compartilhar"): duas pessoas precisam poder fixar o mesmo e-mail com
-- horários diferentes. Não cabe lá.
--
-- ⚠️ Para quem for mexer: `email_states`, `email_etiquetas`,
-- `email_etiqueta_itens` e `email_responsaveis` estão TODAS com 0 linhas
-- contra 6.032 e-mails. A triagem existe em código e nunca foi usada — não
-- assuma que há dado nelas.

create table if not exists public.email_fixados (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  email_id           uuid not null references public.emails(id)   on delete cascade,

  -- Etiqueta de urgência. `check` em vez de tabela de catálogo porque o
  -- conjunto foi fechado com o Samuel em 25/09 (Urgente / Importante / Ler
  -- depois); acrescentar um quarto valor é um `alter` de uma linha, e uma
  -- tabela de catálogo para três valores fixos seria máquina demais.
  etiqueta           text not null default 'ler_depois'
                     constraint email_fixados_etiqueta_valida
                     check (etiqueta in ('urgente', 'importante', 'ler_depois')),

  -- Quando a pessoa quer ler. NULO é permitido de propósito: fixar sem marcar
  -- horário é caso legítimo ("deixa no topo que eu vejo depois"). Sem horário
  -- não há lembrete — só o destaque na lista.
  ler_em             timestamptz,

  -- Fixar é pessoal; isto abre o pin para quem mais alcança a caixa. Continua
  -- sendo só LEITURA para o colega: ver as policies abaixo.
  compartilhado      boolean not null default false,

  -- Marcas de "já avisei". Mesmo truque de `conversation_pendencias`
  -- (`alerta_2m_at`/`5m`/`10m`): é o que impede o agendador, que roda de
  -- minuto em minuto, de repetir o mesmo aviso sessenta vezes por hora.
  avisado_antes_em   timestamptz,
  avisado_na_hora_em timestamptz,
  avisado_atraso_em  timestamptz,

  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),

  -- Unique COMPLETO (não parcial) de propósito: é ele que faz o
  -- `on conflict (user_id, email_id)` do app funcionar. Índice único PARCIAL
  -- não serve de árbitro para `on conflict` — já custou caro neste projeto.
  constraint email_fixados_um_por_pessoa unique (user_id, email_id)
);

-- A lista do Hub pede "meus fixados" a cada abertura de pasta.
create index if not exists email_fixados_por_usuario
  on public.email_fixados (user_id);

-- O caminho inverso: dado o punhado de e-mails na tela, quem está fixado?
create index if not exists email_fixados_por_email
  on public.email_fixados (email_id);

-- A varredura do agendador. Parcial de propósito: só interessa quem tem
-- horário marcado E ainda tem algum aviso pendente. Isso é uma fração
-- minúscula da tabela, e o índice não cresce junto com o histórico.
create index if not exists email_fixados_lembretes_pendentes
  on public.email_fixados (ler_em)
  where ler_em is not null
    and (avisado_antes_em is null
         or avisado_na_hora_em is null
         or avisado_atraso_em is null);

alter table public.email_fixados enable row level security;

-- Ver: o próprio pin sempre; o de colega só se ele compartilhou E se eu
-- alcanço a caixa daquele e-mail.
--
-- `_pode_ver_conta_de_email` é a MESMA função que `emails` e `email_states`
-- já usam. Reusar, em vez de recopiar a regra, é o que faz o pin acompanhar
-- sozinho qualquer mudança futura de permissão de caixa.
create policy email_fixados_ver on public.email_fixados
  for select
  using (
    user_id = auth.uid()
    or (
      compartilhado
      and exists (
        select 1 from public.emails e
        where e.id = email_fixados.email_id
          and public._pode_ver_conta_de_email(e.account_id)
      )
    )
  );

-- Escrever é só do dono. Compartilhar MOSTRA o pin; não entrega a chave dele
-- — senão um colega poderia apagar o lembrete de outra pessoa.
create policy email_fixados_inserir on public.email_fixados
  for insert with check (user_id = auth.uid());

create policy email_fixados_alterar on public.email_fixados
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy email_fixados_apagar on public.email_fixados
  for delete using (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- O agendador
-- ---------------------------------------------------------------------------
--
-- Molde: `private.processar_alertas_de_pendencia`, que já roda de minuto em
-- minuto para cobrar resposta no WhatsApp. Mesma forma: um `update ...
-- returning` RECLAMA as linhas e alimenta o `insert` do aviso. Reclamar antes
-- de avisar é o que torna a função segura para rodar a cada minuto — duas
-- execuções simultâneas não mandam o aviso em dobro.
--
-- ⚠️ As conversões para 'America/Sao_Paulo' não são preciosismo: o banco roda
-- em UTC e o Brasil é UTC-3. "8 da manhã" escrito direto sairia às 5h.

create or replace function private.processar_lembretes_de_email()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_antes  integer := 0;
  v_hora   integer := 0;
  v_atraso integer := 0;
begin
  -- 1) Faltando 15 minutos.
  with alvos as (
    update public.email_fixados f
       set avisado_antes_em = now(),
           atualizado_em    = now()
     where f.id in (
             select f2.id
               from public.email_fixados f2
              where f2.ler_em is not null
                and f2.avisado_antes_em is null
                and f2.ler_em >  now()
                and f2.ler_em <= now() + interval '15 minutes'
              limit 200
           )
    returning f.user_id, f.email_id, f.ler_em
  )
  insert into public.notificacoes (user_id, tipo, titulo, corpo, link, origem_id)
  select a.user_id,
         'email_lembrete',
         'Falta pouco: e-mail marcado para '
           || to_char(a.ler_em at time zone 'America/Sao_Paulo', 'HH24:MI'),
         coalesce(nullif(e.subject, ''), '(sem assunto)')
           || ' — de ' || coalesce(nullif(e.from_name, ''), e.from_email),
         '/email?abrir=' || a.email_id::text,
         a.email_id
    from alvos a
    join public.emails e on e.id = a.email_id;
  get diagnostics v_antes = row_count;

  -- 2) Na hora marcada.
  --
  -- Fecha junto o aviso dos 15 minutos: quando a pessoa marca um horário que
  -- JÁ passou, aquele momento nunca vai acontecer, e deixar a marca nula
  -- prenderia a linha para sempre dentro do índice parcial da varredura.
  with alvos as (
    update public.email_fixados f
       set avisado_na_hora_em = now(),
           avisado_antes_em   = coalesce(f.avisado_antes_em, now()),
           atualizado_em      = now()
     where f.id in (
             select f2.id
               from public.email_fixados f2
              where f2.ler_em is not null
                and f2.avisado_na_hora_em is null
                and f2.ler_em <= now()
              limit 200
           )
    returning f.user_id, f.email_id, f.ler_em
  )
  insert into public.notificacoes (user_id, tipo, titulo, corpo, link, origem_id)
  select a.user_id,
         'email_lembrete',
         'Hora de ler o e-mail que você marcou',
         coalesce(nullif(e.subject, ''), '(sem assunto)')
           || ' — de ' || coalesce(nullif(e.from_name, ''), e.from_email),
         '/email?abrir=' || a.email_id::text,
         a.email_id
    from alvos a
    join public.emails e on e.id = a.email_id;
  get diagnostics v_hora = row_count;

  -- 3) Em atraso: virou o dia e o e-mail continua NÃO LIDO.
  --
  -- `e2.is_read = false` é exatamente o "não foi aberto e desmarcado como
  -- lido" do pedido. Quem leu não é cobrado, mesmo que o pin continue lá.
  --
  -- ⚠️ `avisado_na_hora_em < now()` é o que impede DOIS avisos no mesmo
  -- minuto, e não é paranoia: medido em transação revertida em 25/09, um
  -- lembrete marcado para ontem recebia "Hora de ler" e "Em atraso" na mesma
  -- passagem. Dentro de uma transação `now()` é CONSTANTE, então a linha que o
  -- bloco 2 acabou de marcar tem `avisado_na_hora_em = now()` exatamente, e
  -- `< now()` a exclui; linhas marcadas em passagens anteriores têm valor
  -- estritamente menor e entram normalmente. Acontece com lembrete criado
  -- com data passada e com fila acumulada, se o agendador ficar parado.
  with alvos as (
    update public.email_fixados f
       set avisado_atraso_em = now(),
           atualizado_em     = now()
     where f.id in (
             select f2.id
               from public.email_fixados f2
               join public.emails e2 on e2.id = f2.email_id
              where f2.ler_em is not null
                and f2.avisado_atraso_em is null
                and e2.is_read = false
                and f2.avisado_na_hora_em is not null
                and f2.avisado_na_hora_em < now()
                and (f2.ler_em at time zone 'America/Sao_Paulo')::date
                  < (now()     at time zone 'America/Sao_Paulo')::date
                and (now() at time zone 'America/Sao_Paulo')::time >= time '08:00'
              limit 200
           )
    returning f.user_id, f.email_id, f.ler_em
  )
  insert into public.notificacoes (user_id, tipo, titulo, corpo, link, origem_id)
  select a.user_id,
         'email_lembrete',
         'E-mail em atraso',
         coalesce(nullif(e.subject, ''), '(sem assunto)')
           || ' — era para ler em '
           || to_char(a.ler_em at time zone 'America/Sao_Paulo', 'DD/MM')
           || ' às '
           || to_char(a.ler_em at time zone 'America/Sao_Paulo', 'HH24:MI'),
         '/email?abrir=' || a.email_id::text,
         a.email_id
    from alvos a
    join public.emails e on e.id = a.email_id;
  get diagnostics v_atraso = row_count;

  return jsonb_build_object('antes', v_antes, 'na_hora', v_hora, 'atraso', v_atraso);
end;
$function$;


-- O quinto job de minuto em minuto. Os outros quatro
-- (`process-scheduled-messages`, `alertas-de-pendencia`,
-- `email-disparo-worker`, `verificar-tentativas-de-envio`) já provaram que
-- essa cadência é sustentada por esta instância.
select cron.schedule(
  'email-lembretes',
  '* * * * *',
  $cron$select private.processar_lembretes_de_email();$cron$
);
