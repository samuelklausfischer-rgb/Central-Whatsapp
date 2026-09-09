-- Onde fica a pasta do médico no SharePoint, informada no próprio cadastro.
--
-- POR QUE UMA COLUNA, E NÃO UMA LINHA EM `medico_sharepoint_pastas`.
-- Aquela tabela guarda o vínculo RESOLVIDO pelo Microsoft Graph: exige `item_id`
-- (o identificador do item no drive), que uma URL digitada à mão não fornece, e
-- o frontend só tem grant de SELECT nela — a escrita passa pela edge function,
-- que confere a pasta no Graph antes de gravar.
--
-- As duas coisas convivem de propósito:
--   `medicos.pasta_sharepoint`        → onde a pasta fica, dito por quem cadastra;
--   `medico_sharepoint_pastas`        → a pasta já casada com o item do Graph,
--                                       para navegar e baixar arquivo.
--
-- Isso também destrava o dado enquanto a integração com o Graph segue parada no
-- tenant errado: o cadastro registra o endereço da pasta desde já, e a ficha
-- consegue pelo menos abrir o link.

alter table gestao_medica.medicos
  add column if not exists pasta_sharepoint text;

comment on column gestao_medica.medicos.pasta_sharepoint is
  'Pasta do médico no SharePoint como informada no cadastro — link completo ou caminho do diretório. Obrigatória no formulário; nullable aqui para não quebrar registro anterior à coluna.';
