// Relatório de faturamento por UNIDADE: um arquivo junta todos os nomes da unidade, inclusive os da
// tele parceira (Ápice Tele, DMX, Onelaudos) — decisão do usuário em 09/10/2026, igual às planilhas
// feitas à mão (jun e jul/2026: o nome Ápice sempre na mesma planilha da unidade). De 05 a 09/10 saía
// um arquivo por grupo da Mobilemed. Os 4 grupos (PRN, PRN Apice Tele, Medimagem, Medimagem Apice Tele)
// seguem valendo para saber de onde veio cada nome e para separar as pastas do ZIP.
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
  grupos: Grupo[] // grupos da Mobilemed dos nomes do relatório (ex.: PRN + PRN Apice Tele)
  unidade_id?: string | null // unidade de contrato (para achar as instruções de NF)
}

/** Grupo da empresa: a tele parceira cai no grupo da casa (PRN Apice Tele → PRN; Medimagem Apice Tele → Medimagem). */
export const grupoBase = (g: Grupo): Grupo => (g === 'PRN Apice Tele' ? 'PRN' : g === 'Medimagem Apice Tele' ? 'Medimagem' : g)

/**
 * Junta os nomes simulados em relatórios: UM por unidade de contrato, hospital e período, com os nomes da
 * casa e os da tele parceira juntos. O relatório fica no grupo da casa (PRN ou Medimagem); unidade que só
 * teve nome de tele no mês fica no grupo da tele. Nome sem contrato sai sozinho.
 */
export function agruparRelatorios(nomes: NomeSimulado[], alias: Map<string, InfoAlias>): Relatorio[] {
  const mapa = new Map<string, Relatorio>()
  for (const n of nomes) {
    const info = alias.get(normNome(n.nome_bruto))
    const grupo = grupoDoNome(n.nome_bruto, info?.grupo, n.empresa)
    const sub = info?.subunidade ?? null
    const chave = n.unidade_id ? [grupoBase(grupo), n.unidade_id, sub ?? '', n.periodo].join('|') : ['sem', n.nome_bruto, n.periodo].join('|')
    const r = mapa.get(chave) ?? {
      grupo, rotuloGrupo: grupo, pasta: n.pasta, empresa: n.empresa, subunidade: sub, periodo: n.periodo, nomes: [], grupos: [],
      unidade_id: n.unidade_id,
    }
    if (!r.nomes.includes(n.nome_bruto)) r.nomes.push(n.nome_bruto)
    if (!r.grupos.includes(grupo)) r.grupos.push(grupo)
    // na mesma chave só há a casa e a tele dela: com um nome da casa, o relatório vai para o grupo da casa
    if (ordemDoGrupo(grupo) < ordemDoGrupo(r.grupo)) { r.grupo = grupo; r.rotuloGrupo = grupo }
    mapa.set(chave, r)
  }
  for (const r of mapa.values()) r.grupos.sort((a, b) => ordemDoGrupo(a) - ordemDoGrupo(b))
  return [...mapa.values()].sort((a, b) =>
    ordemDoGrupo(a.grupo) - ordemDoGrupo(b.grupo) || (a.pasta ?? '~').localeCompare(b.pasta ?? '~') ||
    (a.subunidade ?? '').localeCompare(b.subunidade ?? '') || a.periodo.localeCompare(b.periodo))
}

/** Grupo do RELATÓRIO de cada nome (a tele vai junto com a casa) — para o consolidado dividir igual aos relatórios. */
export function grupoDoRelatorioPorNome(nomes: NomeSimulado[], alias: Map<string, InfoAlias>): Map<string, Grupo> {
  const m = new Map<string, Grupo>()
  for (const r of agruparRelatorios(nomes, alias)) for (const nb of r.nomes) if (!m.has(nb)) m.set(nb, r.grupo)
  return m
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
