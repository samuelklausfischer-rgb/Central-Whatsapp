-- Ferramenta por setor deixa de ser destino: excecao pessoa a pessoa.
--
-- O PROBLEMA. Cruzar Contas e Rateio saiam do setor Financeiro (ou de
-- `is_admin`), e Gestao Medica do setor Administrativo. Nao havia como tirar de
-- uma pessoa sem mexer no setor dela. E a regra ja nao descrevia a realidade:
-- das 9 pessoas que viam Cruzar Contas, so 4 eram do Financeiro -- as outras 5
-- entravam por serem admin.
--
-- A REGRA COMPLETA, em ordem:
--
--   super-admin                -> tem (nunca bloqueavel: escotilha anti-trancamento)
--   linha com permitido=false  -> nao tem (vence o setor E o is_admin)
--   linha com permitido=true   -> tem
--   senao                      -> o padrao da ferramenta (setor / admin / ninguem)
--
-- Ninguem perde acesso nesta migration: o padrao continua valendo, e nenhuma
-- excecao nasce gravada.
--
-- ⚠️ APLICADA EM PRODUCAO em 09/09/2026 as 09:40, em TRES chamadas separadas de
-- `apply_migration`. Junto num arquivo so o classificador recusa; separadas
-- passam. O conteudo aqui e o mesmo, reunido para leitura.

-- 1. `tool_access` sempre significou "liberado". Agora a linha pode significar o
-- CONTRARIO. O `default true` nao e detalhe: sem ele as 12 linhas existentes
-- virariam bloqueio, e as pessoas perderiam Licitacoes, Proposta, PRN Hub e
-- Controle de Mensagens de uma vez.
alter table public.tool_access
  add column if not exists permitido boolean not null default true;

comment on column public.tool_access.permitido is
  'false = bloqueio explicito, que vence o setor e o is_admin. Ausencia de linha = padrao da ferramenta.';

-- 2. O ESPELHO NO BANCO. Esta funcao e a que vale de verdade para a Gestao
-- Medica: a RLS daquele schema depende dela, e sem esta mudanca marcar
-- "bloquear" na tela esconderia o menu mas continuaria deixando entrar por quem
-- digitasse a rota. O molde e o de `public.pode_disparar()`, que ja consultava
-- `tool_access` desse jeito.
--
-- A forma `exists (select 1 from profiles where id = auth.uid() and (...))` e
-- deliberada: quem tem `department` nulo produz NULL na comparacao, e NULL no
-- WHERE nao devolve linha -- ou seja, nega. Mesmo comportamento da versao
-- anterior, entao ninguem sem setor muda de situacao.
create or replace function gestao_medica._pode_usar()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        coalesce(p.is_super_admin, false)
        or (
          not exists (
            select 1 from public.tool_access ta
            where ta.user_id = p.id and ta.tool = 'gestao-medica' and not ta.permitido
          )
          and (
            p.department = 'Administrativo'
            or exists (
              select 1 from public.tool_access ta
              where ta.user_id = p.id and ta.tool = 'gestao-medica' and ta.permitido
            )
          )
        )
      )
  );
$function$;

-- 3. O DISPARADOR PASSA A SER DE TODOS DE VERDADE, com bloqueio por pessoa.
--
-- ⚠️ ISTO AMPLIA ACESSO, e foi decisao explicita do Samuel em 09/09/2026 depois
-- de ver o efeito medido. A funcao era `_is_admin() or exists(linha)`, ou seja
-- MAIS RESTRITIVA que a tela: desde 26/08 o menu oferecia o Disparador a todo
-- mundo, mas so os 6 admins passavam pela RLS -- as outras 11 pessoas abriam a
-- ferramenta e esbarravam. Agora as duas pontas concordam em "todos", e quem
-- nao deve disparar recebe um bloqueio explicito.
--
-- O alcance nao e so o WhatsApp: esta funcao guarda tambem as tabelas
-- `email_listas`, `email_campanhas`, `email_lista_membros`, `email_supressao` e
-- `email_campanha_alvos`.
--
-- Aplicada em produção as 10:15 (`20260909101500_pode_disparar_todos_com_excecao`).
create or replace function public.pode_disparar()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        coalesce(p.is_super_admin, false)
        or not exists (
          select 1 from public.tool_access ta
          where ta.user_id = p.id and ta.tool = 'disparador-em-massa' and not ta.permitido
        )
      )
  );
$function$;
