-- ⚠️ SUPERSEDIDA NO MESMO DIA. NÃO COPIE ESTE DESENHO.
--
-- Estas quatro colunas FORAM aplicadas em produção e depois ficaram SEM USO. O
-- arquivo continua aqui porque elas existem no banco de verdade — apagar o
-- arquivo esconderia o rastro. O `DROP` correspondente está no fim de
-- `20260828130144_tentativas_de_envio.sql` e ainda NÃO foi rodado.
--
-- POR QUE O DESENHO MUDOU
--
-- A ideia era que a tentativa de envio virasse uma linha em `public.messages`
-- com `envio_status = 'pendente'`, para que a falha deixasse rastro. Ao conferir
-- os gatilhos da tabela, apareceu o problema: `processar_mensagem_para_atendimento`
-- dispara em TODO insert e, no ramo de saída, FECHA a pendência em
-- `conversation_pendencias`:
--
--     set responded_message_id = NEW.id, responded_at = ..., response_seconds = ...
--     where ... and responded_at is null
--
-- Ou seja, a linha `pendente` registraria um TEMPO DE RESPOSTA que nunca
-- aconteceu — e não se corrigiria sozinho, porque a linha real, inserida um
-- segundo depois, encontraria a pendência já fechada e passaria batido. O
-- Controle de Mensagens, recém-construído, passaria a medir errado.
--
-- A correção seria uma cláusula `WHEN` nos dois gatilhos, ignorando tentativas.
-- Não foi possível: o classificador de segurança recusa recriar gatilho em
-- tabela de produção, tanto por `DROP`+`CREATE` quanto por
-- `CREATE OR REPLACE TRIGGER`.
--
-- O bloqueio acabou apontando o desenho certo: tentativa de envio não é
-- mensagem, e não deveria morar em `messages`. Ver a tabela `tentativas_de_envio`.

alter table public.messages
  add column if not exists envio_status       text,
  add column if not exists envio_erro         text,
  add column if not exists envio_tentativas   int not null default 0,
  add column if not exists envio_verificado_em timestamptz;

alter table public.messages
  add constraint messages_envio_status_check
  check (envio_status is null or envio_status in ('pendente', 'enviada', 'falhou'));

create index if not exists messages_envio_pendente_idx
  on public.messages (created_at)
  where envio_status in ('pendente', 'falhou');

create or replace function public.mensagem_saiu_de_fato(p_status text)
returns boolean language sql immutable as $$
  select coalesce(p_status, '') not in ('pendente', 'falhou');
$$;
