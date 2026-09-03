-- A TENTATIVA DE ENVIO PASSA A EXISTIR
--
-- Hoje, quando um envio falha, NÃO SOBRA NADA. Medido: 12.143 envios pelo app em
-- 30 dias, zero linhas sem `external_id` — porque a linha em `public.messages` só
-- nasce DEPOIS que a Evolution confirma. A falha vira um toast que some, a pessoa
-- fica sem saber se a mensagem chegou na paciente, e não há o que reenviar.
--
-- POR QUE FORA DE `messages`
--
-- Duas razões, e a segunda é a que decide.
--
-- 1. `messages` significa hoje "mensagem que existe no WhatsApp". Guardar
--    tentativa ali quebra esse significado, e TUDO que conta mensagem passaria a
--    precisar de revisão: resumos, não lidas, métricas.
--
-- 2. Os gatilhos de `messages` contaminariam as métricas na hora.
--    `processar_mensagem_para_atendimento` fecha a pendência em
--    `conversation_pendencias` em todo insert de saída — a tentativa registraria
--    um tempo de resposta que nunca aconteceu, e a mensagem real, inserida
--    depois, não corrigiria (a pendência já não estaria com `responded_at is
--    null`). O Controle de Mensagens passaria a medir errado. A história completa
--    está em `20260828125550_envio_status_mensagens.sql`.
--
-- ONDE A LINHA É GRAVADA, E POR QUE NÃO DENTRO DA RPC
--
-- Quem grava é o APP, numa requisição própria e já comitada, ANTES de chamar
-- `send_whatsapp_message`. Gravar dentro da RPC não funcionaria: ela é uma
-- transação só, e `authenticated` tem `statement_timeout = 8s` — se o envio
-- estourar o tempo ou levantar exceção, que são justamente os casos que hoje
-- somem, a transação aborta e o insert feito antes é DESFEITO junto.
--
-- Como consequência boa: `send_whatsapp_message`, a função mais crítica do app,
-- NÃO É TOCADA por este trabalho.
--
-- O CICLO DE VIDA DA LINHA
--
--   1. app insere            -> status 'pendente'   (balão "enviando")
--   2. a RPC devolve ok      -> o app APAGA esta linha; a mensagem de verdade já
--                               existe em `messages`, com `external_id`
--   3. a RPC devolve erro    -> status 'falhou' + `erro`  (balão vermelho, com
--                               botão de tentar de novo)
--   4. nada volta (timeout,  -> a linha fica 'pendente' e o verificador resolve
--      aba fechada, rede)       perguntando à Evolution se saiu
--
-- A linha é visível SÓ para quem tentou (RLS por `sender_id`), e é isso que se
-- quer: a tentativa falhada de uma pessoa não é mensagem da conversa, e não deve
-- aparecer para os colegas nem contar em lugar nenhum.

create table if not exists public.tentativas_de_envio (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.devices(id) on delete cascade,
  remote_sender text not null,
  sender_id     uuid not null,
  conteudo      text not null default '',
  anexos        jsonb,
  reply_to_id   uuid,
  tipo          text not null default 'texto'
                check (tipo in ('texto','audio','midia','edicao','encaminhada')),
  status        text not null default 'pendente'
                check (status in ('pendente','falhou','enviada')),
  erro          text,
  tentativas    int  not null default 1,
  verificado_em timestamptz,
  external_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.tentativas_de_envio is
  'Tentativa de envio pelo app, gravada ANTES de chamar a Evolution. Existe para que a falha nao suma: hoje a linha em messages so nasce depois da confirmacao, entao envio que falha nao deixa rastro nenhum. Fica FORA de messages de proposito -- os gatilhos de messages fechariam a pendencia em conversation_pendencias e o Controle de Mensagens registraria um tempo de resposta que nunca aconteceu. A linha some (deletada) quando o envio confirma; sobrevive como falhou ou pendente quando nao.';

comment on column public.tentativas_de_envio.status is
  'pendente = saiu do app e nao voltou resposta ainda (ou o navegador morreu no meio); falhou = a Evolution recusou ou o verificador nao achou a mensagem; enviada = o verificador confirmou depois, mas a linha real ja existe em messages.';

comment on column public.tentativas_de_envio.tentativas is
  'Quantas vezes esta MESMA tentativa foi reenviada pelo botao. Reenvio e sempre humano -- nada aqui reenvia sozinho.';

-- A fila do verificador é minúscula: índice PARCIAL só do que está em aberto.
create index if not exists tentativas_de_envio_abertas_idx
  on public.tentativas_de_envio (created_at)
  where status = 'pendente';

-- O caminho da interface: as tentativas desta conversa, mais novas primeiro.
create index if not exists tentativas_de_envio_conversa_idx
  on public.tentativas_de_envio (device_id, remote_sender, created_at desc);

create trigger set_updated_at
  before update on public.tentativas_de_envio
  for each row execute function public.trigger_set_updated_at();

alter table public.tentativas_de_envio enable row level security;

-- Só o autor e o admin. Ver a tentativa de outra pessoa não serve para nada e
-- exporia rascunho de mensagem que nunca saiu.
create policy tentativas_select on public.tentativas_de_envio
  for select to authenticated
  using (sender_id = auth.uid() or public._is_admin());

create policy tentativas_insert on public.tentativas_de_envio
  for insert to authenticated
  with check (sender_id = auth.uid());

create policy tentativas_update on public.tentativas_de_envio
  for update to authenticated
  using (sender_id = auth.uid() or public._is_admin());

create policy tentativas_delete on public.tentativas_de_envio
  for delete to authenticated
  using (sender_id = auth.uid() or public._is_admin());

-- ---------------------------------------------------------------------------
-- ⚠️ AINDA NÃO RODADO — limpeza do desenho abandonado.
--
-- As quatro colunas abaixo foram aplicadas em produção antes da mudança de
-- desenho e ficaram sem uso nenhum (todas nulas, índice parcial vazio). O
-- classificador de segurança recusou o `DROP` nesta sessão, então isto precisa
-- ser rodado à mão por quem tem acesso direto ao banco.
--
--   alter table public.messages drop constraint if exists messages_envio_status_check;
--   drop index if exists public.messages_envio_pendente_idx;
--   alter table public.messages
--     drop column if exists envio_status,
--     drop column if exists envio_erro,
--     drop column if exists envio_tentativas,
--     drop column if exists envio_verificado_em;
--   drop function if exists public.mensagem_saiu_de_fato(text);
-- ---------------------------------------------------------------------------
