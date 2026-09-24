-- Interruptor pessoal para a atribuição automática ao responder.
--
-- Pedido (Samuel, 24/09/2026): "criar um modo pro whatsapp onde o usuário pode
-- ativar e desativar de atribuir aquele contato quando o usuário responde [...]
-- por padrão o toggle de atribuir ele vem ligado, mas se desativar ele deixa de
-- atribuir a conversa de forma automática".
--
-- Desde 26/08/2026 (20260826125016_atribuicao_automatica_ao_responder) responder
-- um contato SEM DONO pelo app passa esse contato para quem respondeu. O efeito
-- que ninguém tinha previsto é que deixou de existir "responder de passagem":
-- quem cobre o colega por cinco minutos herda o atendimento e o contato cai na
-- fila dele.
--
-- Escopo definido com ele nesta conversa: **modo da pessoa, não da conversa**.
-- Liga/desliga uma vez e vale para toda conversa, em todo aparelho e todo
-- navegador — o mesmo desenho já usado em `profiles.notification_prefs`, e pelo
-- mesmo motivo: configuração que mora no cliente é uma por navegador, e a pessoa
-- descobre isso do jeito ruim.
--
-- E desligado significa SÓ isso: não atribui. Nenhuma escrita nova, nenhum outro
-- efeito — ver a nota sobre o gatilho vizinho na parte 2.

-- ===========================================================================
-- PARTE 1 — onde a preferência mora
-- ===========================================================================
--
-- POR QUE UMA COLUNA EM `profiles`, E NÃO UMA TABELA NOVA
-- É preferência pessoal, não permissão. A regra da casa (ver
-- 20260804... / `public.tool_access`) é que FLAG DE PERMISSÃO nunca vira coluna
-- de `profiles`, porque a policy `users_update_own_profile` só trava `is_admin`
-- e qualquer outra coluna é auto-atribuível. Aqui essa "falha" é justamente o
-- comportamento desejado: a pessoa PODE e DEVE mudar a própria preferência.
-- Mesmo raciocínio já aplicado a `notification_prefs`, que também não precisou
-- de policy nova.
--
-- O nome é português para casar com `atribuir_conversa_ao_responder`, que é quem
-- lê esta coluna. As colunas vizinhas de `profiles` são inglesas (`signature`,
-- `notification_prefs`), mas quem for ler o gatilho da parte 2 ganha mais com a
-- ligação óbvia entre os dois nomes do que com a uniformidade da tabela.
--
-- `not null default true` faz a equipe inteira nascer com o comportamento de
-- hoje: a coluna aparece já preenchida em todas as linhas existentes, e ninguém
-- precisa abrir o app para "ligar" nada.
alter table public.profiles
  add column if not exists atribuir_ao_responder boolean not null default true;

comment on column public.profiles.atribuir_ao_responder is
  'Modo pessoal: responder um contato sem dono me atribui esse contato?
   Lido pelo gatilho tg_atribuir_conversa_ao_responder em messages, não pelo app.
   Ligado por padrão — desligar vale para todas as conversas dessa pessoa.';

-- ===========================================================================
-- PARTE 2 — a guarda
-- ===========================================================================
--
-- POR QUE AQUI, E NÃO EM `atribuir_conversa_ao_responder` NEM NA RPC DE ENVIO
--
-- `send_whatsapp_message` continua intocada pelo mesmo motivo escrito em
-- 20260826125016: 13 KB, dois `INSERT INTO messages` no fim de ramos diferentes,
-- e é a função mais crítica do app. Um parâmetro novo lá também exigiria ordem
-- de deploy entre banco e cliente (o PostgREST resolve a função pela LISTA DE
-- ARGUMENTOS — foi assim que `p_sem_assinatura` derrubou o envio inteiro com
-- PGRST202; ver o comentário em `src/services/messages.ts`).
--
-- `atribuir_conversa_ao_responder` também fica intocada: ela guarda a regra de
-- "nunca rouba conversa de colega", que não tem nada a ver com preferência de
-- quem envia. A guarda entra no invólucro, que tem 12 linhas e uma função só.
--
-- POR QUE A CONSULTA FICA DENTRO DO `BEGIN ... EXCEPTION`
-- Quando este gatilho roda, a requisição para a Evolution JÁ SAIU — a RPC só
-- grava a mensagem depois de receber 200/201. Qualquer exceção aqui desfaz o
-- INSERT, e a mensagem passa a existir no WhatsApp da paciente e não no app.
-- Por isso a leitura do perfil entra na mesma rede de proteção que já cobria a
-- chamada: falhar a atribuição é aceitável, perder a mensagem não é.
--
-- POR QUE `coalesce(..., true)`
-- Perfil sem linha (ou apagado no meio do caminho) continua atribuindo, que é o
-- comportamento de hoje. O `not null default true` da parte 1 já deveria tornar
-- isso impossível; o coalesce garante que, se algum dia deixar de ser verdade,
-- o modo de falhar seja o antigo e não o novo.
--
-- O QUE ACONTECE COM O GATILHO VIZINHO QUANDO ESTE SAI SEM FAZER NADA
-- `processar_mensagem_para_atendimento` dispara depois deste (ordem alfabética)
-- e tem um `where status = 'finished'` que marca `global_read_at` ao reabrir uma
-- conversa encerrada. Em 26/08 este gatilho passou a tirar o status de
-- 'finished' ANTES, o vizinho deixou de casar, e isso virou a regressão
-- corrigida em 20260826132909.
--
-- Com o modo DESLIGADO o problema simplesmente não existe: como não escrevemos
-- em `conversation_assignments`, o status continua 'finished' e o vizinho volta
-- a alcançar o caso sozinho. É por isso que "desligado" não precisou de nenhuma
-- escrita compensatória — é literalmente o comportamento anterior a 26/08.
create or replace function public.tg_atribuir_conversa_ao_responder()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.sender_id THEN
    BEGIN
      IF coalesce(
           (SELECT p.atribuir_ao_responder FROM public.profiles p WHERE p.id = NEW.sender_id),
           true
         ) THEN
        PERFORM public.atribuir_conversa_ao_responder(
          NEW.device_id, NEW.remote_sender, NEW.sender_id
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'atribuicao automatica falhou (mensagem gravada normalmente): %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$function$;

comment on function public.tg_atribuir_conversa_ao_responder() is
  'Gatilho de messages: quando alguém responde PELO APP um contato sem dono, o
   contato passa a ser dessa pessoa — a menos que ela tenha desligado
   profiles.atribuir_ao_responder. Nunca levanta exceção: desfazer o INSERT
   perderia uma mensagem que a Evolution já entregou.';

-- O `create trigger` NÃO muda. O `WHEN` continua sendo
-- (direction='outbound' and origin='app' and sender_id is not null and recente),
-- e é ele que mantém webhook, importação e backfill fora daqui.
