-- COR DE DESTAQUE NO COMPROMISSO
--
-- Pedido do Samuel: "poder escolher uma cor para conseguir destacar melhor
-- aquela tarefa criada na agenda". Hoje o único destaque visual é a
-- `importancia` (baixa/normal/alta/urgente), que é um sinal do SISTEMA sobre
-- prioridade. Isto aqui é diferente: é a PESSOA escolhendo, por razão dela,
-- qual compromisso quer achar mais rápido na grade — as duas coisas convivem.
--
-- POR QUE SEM CHECK DE VALORES
--
-- A paleta (quais hex existem, quantas cores, os nomes) é decisão de TELA,
-- não de banco. Um `check (cor in (...))` fossilizaria a paleta de hoje: toda
-- vez que alguém quisesse ajustar um tom ou acrescentar uma cor, seria uma
-- migration nova só para isso, e cada compromisso já colorido com o valor
-- antigo ficaria orfão de qualquer forma. `text` livre e a validação (se
-- algum dia fizer falta) fica no cliente, que é quem realmente sabe a paleta
-- vigente.
--
-- POR QUE NÃO SINCRONIZA COM O OUTLOOK
--
-- É campo só nosso. O Microsoft Graph tem categorias de cor próprias, com
-- paleta e API diferentes das nossas — misturar os dois exigiria um mapa de
-- tradução para um recurso que é só de destaque pessoal na tela, e nenhuma
-- fidelidade a mais valeria a complexidade.
alter table public.agenda_events add column if not exists cor text;

comment on column public.agenda_events.cor is
  'Cor de destaque escolhida pela pessoa ao criar/editar (hex, ex. #3b82f6). Nula = sem destaque, visual padrão. Sem CHECK de propósito: a paleta é decisão de tela. Não sincroniza com o Outlook.';
