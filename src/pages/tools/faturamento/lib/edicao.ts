// Comparação "antes → depois" para o painel de revisão antes de salvar.
export interface Rotulo<V = unknown> { rotulo: string; formatar?: (v: V) => string }
export interface Mudanca { rotulo: string; antes: string; depois: string }

/** Igualdade profunda para primitivos, arrays e objetos simples (null/undefined contam como iguais). */
export function iguais(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true
  if (a === b) return true
  if (typeof a !== typeof b || a == null || b == null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => iguais(x, b[i]))
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a as object), kb = Object.keys(b as object)
    return ka.length === kb.length && ka.every(k => iguais((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

export function formatarPadrao(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  if (Array.isArray(v)) return v.length ? v.map(formatarPadrao).join(', ') : '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Só os campos que mudaram, na ordem dos rótulos, já formatados em texto. */
export function mudancas<T extends object>(
  antes: T, depois: T, rotulos: { [K in keyof T]?: Rotulo<T[K]> },
): Mudanca[] {
  const out: Mudanca[] = []
  for (const k of Object.keys(rotulos) as (keyof T)[]) {
    const r = rotulos[k]
    if (!r || iguais(antes[k], depois[k])) continue
    const f = (r.formatar ?? formatarPadrao) as (v: unknown) => string
    out.push({ rotulo: r.rotulo, antes: f(antes[k]), depois: f(depois[k]) })
  }
  return out
}

export interface LinhaTexto { rotulo: string; texto: string }
export interface DiffLinha { rotulo: string; antes: string | null; depois: string | null; tipo: 'novo' | 'removido' | 'alterado' }

/** Compara dois "Como fatura": linhas de mesmo rótulo com texto diferente, novas e removidas (iguais somem). */
export function diffLinhas(antes: LinhaTexto[], depois: LinhaTexto[]): DiffLinha[] {
  const resto = new Map<string, string[]>()
  for (const l of antes) resto.set(l.rotulo, [...(resto.get(l.rotulo) ?? []), l.texto])
  const out: DiffLinha[] = []
  for (const l of depois) {
    const fila = resto.get(l.rotulo)
    if (!fila?.length) { out.push({ rotulo: l.rotulo, antes: null, depois: l.texto, tipo: 'novo' }); continue }
    const i = fila.indexOf(l.texto)
    if (i >= 0) { fila.splice(i, 1); continue }
    out.push({ rotulo: l.rotulo, antes: fila.shift()!, depois: l.texto, tipo: 'alterado' })
  }
  for (const [rotulo, fila] of resto) for (const t of fila) out.push({ rotulo, antes: t, depois: null, tipo: 'removido' })
  return out
}
