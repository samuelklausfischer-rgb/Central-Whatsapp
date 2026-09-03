-- As reações mais usadas por cada pessoa, para o menu radial abrir já com o
-- que ela costuma escolher.
--
-- Pedido (Samuel, 02/09/2026): "deixar de forma eficiente e mais dinâmica poder
-- reagir a uma msg de forma mais rápida, talvez criar uma roda de atalho de
-- coisas mais usadas por aquele usuário".
--
-- POR QUE UMA COLUNA jsonb NO PERFIL, E NÃO UMA TABELA
-- São ~20 a 30 emojis por pessoa, sempre lidos inteiros e sempre junto do
-- perfil, que a tela já carrega. Uma tabela `uso_de_reacoes(user_id, emoji,
-- vezes)` acrescentaria uma junção em toda abertura de conversa para guardar o
-- que cabe num mapa. E não há relatório nenhum pedindo cruzar isso.
--
-- POR QUE NÃO É `localStorage`
-- O pedido diz "daquele USUÁRIO". O `localStorage` é por navegador: a mesma
-- pessoa veria rodas diferentes no Electron e no celular.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reaction_usage jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.reaction_usage IS
  'Mapa {emoji: vezes} de quantas vezes a pessoa usou cada reação. Ordena o
   menu radial de reações do chat. Só cresce; nada aqui é apagado.';

-- ---------------------------------------------------------------------------
-- O incremento
-- ---------------------------------------------------------------------------
--
-- POR QUE UMA RPC, E NÃO UM `update` DIRETO DO CLIENTE
--
-- 1. ATOMICIDADE. Ler o mapa no cliente, somar 1 e gravar de volta perde
--    reações quando duas acontecem juntas (duas abas, ou reagir rápido a duas
--    mensagens): as duas leriam o mesmo valor e a segunda sobrescreveria a
--    primeira. Aqui a soma acontece dentro do próprio `update`.
--
-- 2. ALVO FIXO. A policy de escrita de `profiles` deste projeto deixa a pessoa
--    atualizar a própria linha, e uma coluna nova nasce dentro dessa permissão.
--    A RPC não aceita parâmetro de usuário: escreve sempre em `auth.uid()`.
--    Assim, ninguém consegue mexer na estatística de outra pessoa nem que
--    monte a chamada na mão.
--
-- `SECURITY INVOKER` (o padrão) de propósito: a RPC não precisa de poder além
-- do que a pessoa já tem sobre a própria linha. Definer aqui seria dar
-- privilégio sem necessidade.
CREATE OR REPLACE FUNCTION public.bump_reaction_usage(p_emoji text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_emoji IS NULL OR p_emoji = '' THEN
    RETURN;
  END IF;

  -- Teto de tamanho: emoji com modificadores (tom de pele, ZWJ de família)
  -- chega a alguns caracteres, mas nada perto disso. O limite existe para a
  -- coluna não virar depósito de texto arbitrário caso alguém chame a RPC na
  -- mão — a chave do mapa é dado, não entrada livre.
  IF length(p_emoji) > 16 THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET reaction_usage = jsonb_set(
        coalesce(reaction_usage, '{}'::jsonb),
        array[p_emoji],
        to_jsonb(coalesce((reaction_usage ->> p_emoji)::int, 0) + 1),
        true
      )
  WHERE id = auth.uid();
END;
$function$;

COMMENT ON FUNCTION public.bump_reaction_usage(text) IS
  'Soma 1 no contador daquele emoji para quem chamou. Alvo sempre auth.uid() —
   não existe parâmetro de usuário de propósito.';

REVOKE EXECUTE ON FUNCTION public.bump_reaction_usage(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.bump_reaction_usage(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bump_reaction_usage(text) TO authenticated;
