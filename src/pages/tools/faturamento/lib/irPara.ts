export type SecaoUnidade = 'contrato' | 'regras' | 'precos' | 'aditivos' | 'nomes' | 'pendencias' | 'observacoes' | 'encerrar'

const CHAVE = 'fat:unidade:alvo'

/** Grava o alvo (seção e, opcional, linha) e devolve o caminho da unidade para navegar. */
export function alvoPara(unidadeId: string, secao: SecaoUnidade, alvoId?: string): string {
  try { sessionStorage.setItem(CHAVE, JSON.stringify({ unidadeId, secao, alvoId })) } catch { /* sem storage: só navega */ }
  return `/faturamento/unidade/${unidadeId}`
}

/** Lê e apaga o alvo; só devolve se for desta unidade. */
export function consumirAlvo(unidadeId: string): { secao: SecaoUnidade; alvoId?: string } | null {
  try {
    const t = sessionStorage.getItem(CHAVE)
    if (!t) return null
    const a = JSON.parse(t) as { unidadeId?: string; secao?: SecaoUnidade; alvoId?: string }
    if (a.unidadeId !== unidadeId || !a.secao) return null
    sessionStorage.removeItem(CHAVE)
    return a.alvoId ? { secao: a.secao, alvoId: a.alvoId } : { secao: a.secao }
  } catch {
    return null
  }
}
