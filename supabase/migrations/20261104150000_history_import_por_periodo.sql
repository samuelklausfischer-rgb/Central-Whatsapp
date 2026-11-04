-- Buscador de mensagens por período (Conexão WhatsApp > Buscar mensagens).
--
-- O importador de histórico só sabia andar "das mais novas para trás" em
-- páginas — "Testar 2 páginas", "Importar 1000", "Importar tudo". Para
-- recuperar um buraco conhecido (ex.: Financeiro PRN sem receber de 09:58 a
-- 11:44 em 04/11/2026) era preciso adivinhar quantas páginas cobriam o período.
--
-- Agora o job pode carregar um período fechado. A edge function
-- `evolution-history-import` pede à Evolution só as mensagens desse intervalo
-- (`where.messageTimestamp.gte/lte`, em ISO) e a contagem de páginas já sai
-- certa. Fora do período, nada é lido.
--
-- Colunas nulas = job antigo (modo por páginas), que continua funcionando.
-- Aditiva e sem backfill: pode ser aplicada antes do deploy da função.

alter table public.evolution_history_import_jobs
  add column if not exists range_from timestamptz,
  add column if not exists range_to timestamptz;

alter table public.evolution_history_import_jobs
  drop constraint if exists evolution_history_import_jobs_range_check;

alter table public.evolution_history_import_jobs
  add constraint evolution_history_import_jobs_range_check
  check (
    (range_from is null and range_to is null)
    or (range_from is not null and range_to is not null and range_from < range_to)
  );

comment on column public.evolution_history_import_jobs.range_from is
  'Início do período buscado na Evolution (inclusivo). Nulo nos jobs por páginas.';
comment on column public.evolution_history_import_jobs.range_to is
  'Fim do período buscado na Evolution (inclusivo). Nulo nos jobs por páginas.';
