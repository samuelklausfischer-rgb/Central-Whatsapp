-- Agenda: o convite do grupo no Outlook precisa poder FALHAR em voz alta.
--
-- O QUE ESTA COLUNA RESOLVE
-- Salvar um compromisso de grupo passou a fazer DUAS coisas: gravar a linha
-- aqui e, opcionalmente, criar o evento no Outlook de quem criou com todo mundo
-- do grupo como `attendees` (é o Exchange que propaga a cópia para a caixa de
-- cada convidado — ver `outlook_event_id` / `outlook_ical_uid`, criadas em
-- 20260825180000).
--
-- As duas coisas falham de jeitos diferentes, e a segunda NÃO PODE derrubar a
-- primeira: se o token da Microsoft venceu, se o Graph respondeu 503, ou se o
-- Exchange recusou um dos endereços, o compromisso ainda tem de existir no
-- Central Whats — as pessoas do grupo o veem aqui de qualquer forma. Perder o
-- compromisso porque o convite falhou seria trocar um problema pequeno (o
-- convite não chegou) por um grande (a reunião sumiu).
--
-- Mas falhar em silêncio é pior ainda: quem marcou acharia que convidou o grupo
-- e só descobriria que ninguém foi convidado quando a sala ficasse vazia. Por
-- isso a mensagem do Graph é GUARDADA, e o cartão do compromisso mostra o aviso
-- com um botão de tentar de novo.
--
-- POR QUE `text` E NÃO UM `boolean sincronizado`
-- Um booleano diria "não deu certo" e nada mais. O texto do Graph é o que
-- separa "conexão expirada, reconecte" de "o endereço fulano@… não existe" —
-- e essas duas dão em ações completamente diferentes para quem está olhando a
-- tela. Guardar a mensagem custa nada e é o que torna o botão "tentar de novo"
-- uma decisão informada em vez de um chute.
--
-- POR QUE ADITIVA E SEM DEFAULT
-- `NULL` já carrega os dois estados que interessam: sincronizado agora, ou
-- nunca tentado. Nenhuma linha existente precisa ser reescrita, e nenhum
-- caminho de código antigo quebra por causa dela.

ALTER TABLE public.agenda_events
  ADD COLUMN IF NOT EXISTS outlook_sync_erro text;

COMMENT ON COLUMN public.agenda_events.outlook_sync_erro IS
  'Mensagem de erro da chamada ao Microsoft Graph quando o convite do grupo falhou. NULL = sincronizado ou nunca tentado. Nao impede o compromisso de existir aqui.';
