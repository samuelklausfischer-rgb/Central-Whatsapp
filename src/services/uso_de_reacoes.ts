/**
 * Quantas vezes a pessoa usou cada emoji — o que ordena o menu radial.
 *
 * POR QUE NO PERFIL, E NÃO NO `localStorage`
 * O pedido foi "as mais usadas por aquele USUÁRIO". O `localStorage` é por
 * navegador: a mesma pessoa no Electron do consultório e no celular veria duas
 * rodas diferentes, e trocar de máquina zeraria o histórico. Uma coluna no
 * perfil acompanha a pessoa.
 *
 * POR QUE UMA COLUNA `jsonb` E NÃO UMA TABELA
 * São ~20 a 30 emojis por pessoa, lidos sempre inteiros e sempre junto do
 * perfil, que já vem carregado. Uma tabela `uso_de_reacoes(user_id, emoji,
 * vezes)` seria uma junção a mais em toda abertura de conversa para guardar o
 * que cabe num mapa.
 *
 * DEGRADAÇÃO PROPOSITAL
 * Nada aqui lança erro para cima. Enquanto a migration não estiver aplicada no
 * banco, ler devolve `{}` e gravar não faz nada — o menu radial continua
 * funcionando com a lista padrão. O contrário (quebrar o ato de reagir porque a
 * estatística falhou) seria trocar uma função que importa por uma que não.
 */

import supabase from '@/lib/supabase/client'

export type UsoDeReacoes = Record<string, number>

/** O mapa `{emoji: vezes}` da pessoa logada. `{}` quando ainda não há nada. */
export async function getUsoDeReacoes(userId: string): Promise<UsoDeReacoes> {
  if (!userId) return {}
  const { data, error } = await supabase
    .from('profiles')
    .select('reaction_usage')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[reações] não consegui ler o uso:', error.message)
    return {}
  }
  const bruto = (data as { reaction_usage?: unknown } | null)?.reaction_usage
  return bruto && typeof bruto === 'object' ? (bruto as UsoDeReacoes) : {}
}

/**
 * Soma 1 no contador daquele emoji.
 *
 * Vai por RPC, e não por `update` direto, por dois motivos: o incremento
 * precisa ser atômico (duas reações rápidas em abas diferentes não podem se
 * sobrescrever), e a policy de `profiles` deste projeto é permissiva demais
 * para escrita direta — a RPC fixa o alvo em `auth.uid()` e não aceita
 * parâmetro de usuário.
 */
export async function registrarUsoDeReacao(emoji: string): Promise<void> {
  if (!emoji) return
  const { error } = await supabase.rpc('bump_reaction_usage', { p_emoji: emoji })
  if (error) console.warn('[reações] não consegui registrar o uso:', error.message)
}
