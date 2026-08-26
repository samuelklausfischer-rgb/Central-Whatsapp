-- Corrige os índices únicos de `emails` e `email_folders`.
--
-- Eles nasceram PARCIAIS (`where graph_id is not null`) na migration
-- 20260826140000, e isso quebrou toda a importação em silêncio: o Postgres
-- recusa `ON CONFLICT (account_id, graph_id)` quando o único índice que cobre
-- essas colunas tem cláusula WHERE — a inferência não alcança índice parcial.
--
--   ERROR: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- O sintoma na prática foi pior do que um erro: a edge function respondeu
-- `{"pastas": 0}` com status 200, como se tivesse dado certo. A gravação falhava
-- linha a linha e o contador nunca subia.
--
-- Sem o WHERE não se perde nada: em índice único do Postgres os NULLs são
-- distintos entre si por padrão, então linhas sem `graph_id` continuam podendo
-- coexistir — exatamente o que o WHERE tentava garantir.

begin;

drop index if exists public.email_folders_conta_graph_idx;
create unique index email_folders_conta_graph_idx
  on public.email_folders (account_id, graph_id);

drop index if exists public.emails_conta_graph_idx;
create unique index emails_conta_graph_idx
  on public.emails (account_id, graph_id);

commit;
