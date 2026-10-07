// Relatório de faturamento por UNIDADE, separado pelos 4 grupos da Mobilemed:
// PRN, PRN Apice Tele, Medimagem e Medimagem Apice Tele (decisão do usuário em 05/10/2026).
// Um arquivo junta todos os nomes da unidade que são do mesmo grupo.
import { normNome } from '../nucleo/motor'

/** Os 4 grupos, na ordem de apresentação. */
export const GRUPOS = ['PRN', 'PRN Apice Tele', 'Medimagem', 'Medimagem Apice Tele'] as const
export type Grupo = typeof GRUPOS[number]
export const ordemDoGrupo = (g: string) => { const i = (GRUPOS as readonly string[]).indexOf(g); return i < 0 ? GRUPOS.length : i }

/**
 * Traduz qualquer texto de grupo (coluna GRUPO da LISTA PORTAL, valor salvo no cadastro ou o próprio rótulo) para um dos 4.
 * Parceiros de laudo à distância (Ápice, DMX/Digimax, Onelaudos, TELE) caem no grupo "… Apice Tele" da empresa.
 */
export function grupoCanonico(texto: string | null | undefined): Grupo | null {
  if (!texto || !texto.trim()) return null
  const n = normNome(texto)
  const medimagem = /\bMEDIMAGEM\b/.test(n)
  const tele = /\b(APICE|TELE|DIGIMAX|DMX|ONELAUDOS)\b/.test(n)
  if (medimagem) return tele ? 'Medimagem Apice Tele' : 'Medimagem'
  return tele ? 'PRN Apice Tele' : 'PRN'
}

/** Grupo do nome: o cadastrado (LISTA PORTAL ou tela da unidade); senão deduz pelo nome e pela empresa da unidade. */
export function grupoDoNome(nome: string, cadastrado: string | null | undefined, empresa: string | null | undefined): Grupo {
  const c = grupoCanonico(cadastrado)
  if (c) return c
  const n = normNome(nome)
  const medimagem = (empresa ?? '').toUpperCase() === 'MEDIMAGEM' || /\bMEDIMAGEM\b/.test(n)
  const tele = /\b(APICE|TELE|DIGIMAX|DMX|ONELAUDOS)\b/.test(n) || /\bTELE_/.test(nome.toUpperCase())
  if (medimagem) return tele ? 'Medimagem Apice Tele' : 'Medimagem'
  return tele ? 'PRN Apice Tele' : 'PRN'
}

export interface NomeSimulado {
  nome_bruto: string; periodo: string; unidade_id: string | null; pasta: string | null; empresa: string | null
}
export interface InfoAlias { grupo: string | null; subunidade: string | null }

export interface Relatorio {
  grupo: Grupo; rotuloGrupo: string; pasta: string | null; empresa: string | null
  subunidade: string | null; periodo: string; nomes: string[]
  unidade_id?: string | null // unidade de contrato (para achar as instruções de NF)
}

/** Junta os nomes simulados em relatórios: (grupo, unidade, subunidade, período). Nome sem contrato sai sozinho. */
export function agruparRelatorios(nomes: NomeSimulado[], alias: Map<string, InfoAlias>): Relatorio[] {
  const mapa = new Map<string, Relatorio>()
  for (const n of nomes) {
    const info = alias.get(normNome(n.nome_bruto))
    const grupo = grupoDoNome(n.nome_bruto, info?.grupo, n.empresa)
    const sub = info?.subunidade ?? null
    const chave = n.unidade_id ? [grupo, n.unidade_id, sub ?? '', n.periodo].join('|') : ['sem', n.nome_bruto, n.periodo].join('|')
    const r = mapa.get(chave) ?? {
      grupo, rotuloGrupo: grupo, pasta: n.pasta, empresa: n.empresa, subunidade: sub, periodo: n.periodo, nomes: [],
      unidade_id: n.unidade_id,
    }
    if (!r.nomes.includes(n.nome_bruto)) r.nomes.push(n.nome_bruto)
    mapa.set(chave, r)
  }
  return [...mapa.values()].sort((a, b) =>
    ordemDoGrupo(a.grupo) - ordemDoGrupo(b.grupo) || (a.pasta ?? '~').localeCompare(b.pasta ?? '~') ||
    (a.subunidade ?? '').localeCompare(b.subunidade ?? '') || a.periodo.localeCompare(b.periodo))
}

export interface ResumoLinhaRel { rotulo: string; quantidade: number; valor_unitario: number | null; total: number; fixo: boolean }

/** Soma o resumo dos vários nomes do relatório (mesma modalidade/item somam; valor unitário só se for igual). */
export function juntarResumo(partes: ResumoLinhaRel[]): ResumoLinhaRel[] {
  const m = new Map<string, ResumoLinhaRel & { vs: Set<number | null> }>()
  for (const p of partes) {
    const k = `${p.fixo ? 'F' : 'E'}|${p.rotulo}`
    const g = m.get(k) ?? { rotulo: p.rotulo, quantidade: 0, valor_unitario: null, total: 0, fixo: p.fixo, vs: new Set() }
    g.quantidade += p.quantidade; g.total = Math.round((g.total + p.total) * 100) / 100; g.vs.add(p.valor_unitario)
    m.set(k, g)
  }
  return [...m.values()]
    .map(({ vs, ...g }) => ({ ...g, valor_unitario: vs.size === 1 ? [...vs][0] : null }))
    .sort((a, b) => Number(a.fixo) - Number(b.fixo) || a.rotulo.localeCompare(b.rotulo))
}

export { faturaUnidadeXlsx } from './faturaUnidadeXlsx'

export function caminhoRelatorio(rel: Relatorio, competencia: string): string {
  const [aaaa, mm] = competencia.split('-')
  const limpa = (s: string) => s.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
  const base = rel.pasta ? rel.pasta + (rel.subunidade ? ` - ${rel.subunidade}` : '') : `SEM CONTRATO - ${rel.nomes[0]}`
  return `${limpa(rel.rotuloGrupo)}/${limpa(base)} ${mm}.${aaaa}${rel.periodo ? ' ' + limpa(rel.periodo) : ''}.xlsx`
}
