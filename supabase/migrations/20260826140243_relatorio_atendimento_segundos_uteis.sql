-- Quantos segundos de uma espera cairam na JANELA ATIVA (07:00-23:59 America/Sao_Paulo).
--
-- POR QUE ISSO EXISTE
-- A media de resposta da tela de Controle de Mensagens mentia por 10x: 2.544 s de
-- media contra 258 s de mediana. A hipotese obvia -- "mensagem de madrugada" --
-- estava ERRADA: das 260 pendencias medidas, NENHUMA chegou entre 00:00 e 06:59.
-- Ninguem escreve de madrugada.
--
-- O que estraga o numero e a espera ATRAVESSAR a madrugada: mensagem das 22 h
-- respondida as 8 h conta 10 h de demora para um time que nao estava trabalhando.
-- Sao 8 registros em 227, e sao eles que sequestram a media -- mediana e p90 nem
-- se mexem, que e a assinatura de um problema de cauda.
--
-- Medido: media cai de 2.544 s para 1.655 s (-35%) e o pior caso de 60.023 s
-- (16 h 40) para 34.823 s (9 h 40).
--
-- A JANELA MORA AQUI, num lugar so. Qualquer metrica de tempo util chama esta
-- funcao; mudar o expediente e mudar duas constantes nesta linha, e nao cacar
-- `interval '7 hours'` espalhado por seis RPCs.
--
-- STABLE, e nao IMMUTABLE: `at time zone` depende da base de fusos do servidor,
-- que pode ser atualizada. Marcar como imutavel mentiria para o planejador e
-- permitiria indice funcional sobre um valor que pode mudar.
--
-- Casos de borda conferidos na mao apos aplicar:
--   22:00 -> 08:00 do dia seguinte = 10800 s (2 h a noite + 1 h de manha)
--   09:00 -> 09:05                 =   300 s
--   01:00 -> 03:00                 =     0 s
--   sex 20:00 -> seg 08:00         = 140400 s (atravessa tres madrugadas)
--   qualquer argumento nulo        =  null
create or replace function public.segundos_uteis(p_ini timestamptz, p_fim timestamptz)
returns integer
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select case when p_ini is null or p_fim is null then null else coalesce((
    select sum(
      greatest(0, extract(epoch from (
        -- Fim do dia ativo: 24 h, ou seja, ate 23:59:59.
        least(f.fim, d.dia + interval '24 hours')
        -- Inicio do dia ativo: 07:00.
        - greatest(f.ini, d.dia + interval '7 hours')
      )))
    )::int
    from (
      select (p_ini at time zone 'America/Sao_Paulo') as ini,
             (p_fim at time zone 'America/Sao_Paulo') as fim
    ) f
    -- Um dia por vez: a espera pode atravessar varias madrugadas seguidas
    -- (mensagem de sexta a noite respondida na segunda).
    cross join lateral generate_series(
      date_trunc('day', f.ini), date_trunc('day', f.fim), interval '1 day'
    ) as d(dia)
  ), 0) end;
$function$;

comment on function public.segundos_uteis(timestamptz, timestamptz) is
  'Segundos do intervalo que cairam entre 07:00 e 23:59 (America/Sao_Paulo). Usada
   pelas metricas de tempo de resposta para nao contar a madrugada como espera.';
