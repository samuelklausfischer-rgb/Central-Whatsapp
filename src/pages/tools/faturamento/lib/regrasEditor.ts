// Lógica pura do editor de regras da unidade (período, "conta mais de 1", fim de semana).
import { diaDeCorte, periodos, semAcento } from '../nucleo/motor'

// ---------------------------------------------------------------- período
export type TipoPeriodo = 'mes' | 'quinzena' | 'corte' | 'ciclo'
export interface PeriodoEditavel { tipo: TipoPeriodo; dia?: number }

export const DIA_CORTE_MIN = 2
export const DIA_CORTE_MAX = 28
export const DIA_CORTE_PROIBIDO = 27 // 27 é o ciclo FHEMIG, que tem opção própria

/** 'corte_14' → {tipo:'corte', dia:14}. Janela desconhecida ou inválida cai em 'mes'. */
export function lerJanela(janela: string | null | undefined): PeriodoEditavel {
  if (janela === 'quinzena') return { tipo: 'quinzena' }
  if (janela === 'ciclo_27_26') return { tipo: 'ciclo', dia: 27 }
  if (janela && /^corte_\d{1,2}$/.test(janela)) {
    const dia = diaDeCorte(janela)
    if (dia) return { tipo: 'corte', dia }
  }
  return { tipo: 'mes' }
}

/** Dia de corte válido no editor: inteiro de 2 a 28, exceto 27. */
export function diaCorteValido(dia: unknown): dia is number {
  return typeof dia === 'number' && Number.isInteger(dia) && dia >= DIA_CORTE_MIN && dia <= DIA_CORTE_MAX && dia !== DIA_CORTE_PROIBIDO
}

/** Escolha da tela → valor gravado. Corte sem dia válido cai em 'mes'. */
export function montarJanela(x: PeriodoEditavel): string {
  if (x.tipo === 'quinzena') return 'quinzena'
  if (x.tipo === 'ciclo') return 'ciclo_27_26'
  if (x.tipo === 'corte' && diaCorteValido(x.dia)) return `corte_${String(x.dia).padStart(2, '0')}`
  return 'mes'
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const dm = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`

/** Exemplo calculado pelo motor: "Out/2026: 14/10 a 13/11" (quinzena: "… 01/10 a 15/10 e 16/10 a 31/10"). */
export function exemploPeriodo(janela: string, competencia: { ano: number; mes: number }): string {
  const comp = `${competencia.ano}-${String(competencia.mes).padStart(2, '0')}`
  const ps = periodos(comp, janela as Parameters<typeof periodos>[1])
  return `${MESES[competencia.mes - 1]}/${competencia.ano}: ${ps.map(p => `${dm(p.inicio)} a ${dm(p.fim)}`).join(' e ')}`
}

// ---------------------------------------------------------------- regras de quantidade
export interface RegraSalva { padrao: string; quantidade: number }
export type LinhaRegra =
  | { tipo: 'simples'; termos: string[]; quantidade: number }
  | { tipo: 'avancada'; padrao: string; quantidade: number }

export const SEPARADOR_E_DEPOIS = ' … '
const LITERAL = String.raw`(?:[A-Z0-9 \-]|\\\.)+` // maiúsculas, números, espaço, hífen, ponto escapado
const ALTERNATIVA_SIMPLES = new RegExp(`^${LITERAL}(?:\\.\\*${LITERAL})*$`)

const desescapar = (s: string) => s.replace(/\\\./g, '.')
const escapar = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
const limpar = (s: string) => semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim()

/** Regra gravada → linha da tela. Simples só quando são termos literais (com ".*" = "e depois"). */
export function regraParaLinha(r: RegraSalva): LinhaRegra {
  const alts = r.padrao.split('|')
  if (alts.every(a => ALTERNATIVA_SIMPLES.test(a))) {
    const termos = alts.map(a => a.split('.*').map(p => desescapar(p).trim()).join(SEPARADOR_E_DEPOIS))
    // só é simples se a volta reproduzir o padrão exato
    const volta = linhaParaRegra({ tipo: 'simples', termos, quantidade: r.quantidade }).padrao
    if (volta === r.padrao) return { tipo: 'simples', termos, quantidade: r.quantidade }
  }
  return { tipo: 'avancada', padrao: r.padrao, quantidade: r.quantidade }
}

/** Linha da tela → regra gravada. Termos: maiúsculas sem acento, caracteres especiais escapados. */
export function linhaParaRegra(l: LinhaRegra): RegraSalva {
  if (l.tipo === 'avancada') return { padrao: l.padrao.trim(), quantidade: l.quantidade }
  const padrao = l.termos
    .map(t => t.split(/\s*…\s*/).map(p => escapar(limpar(p))).join('.*'))
    .join('|')
  return { padrao, quantidade: l.quantidade }
}

/** Erros da linha em português (lista vazia = ok). */
export function validarLinha(l: LinhaRegra): string[] {
  const erros: string[] = []
  if (!Number.isInteger(l.quantidade) || l.quantidade < 2 || l.quantidade > 20) erros.push('A quantidade vai de 2 a 20.')
  if (l.tipo === 'simples') {
    if (!l.termos.length || l.termos.every(t => !t.trim())) erros.push('Escreva pelo menos um texto.')
    else if (l.termos.some(t => !t.trim() || t.split(/\s*…\s*/).some(p => !p.trim()))) erros.push('Há um texto vazio.')
  } else {
    const p = l.padrao.trim()
    if (!p) erros.push('Escreva o padrão.')
    else { try { new RegExp(p) } catch { erros.push('Padrão inválido (expressão regular com erro).') } }
  }
  return erros
}

/** Texto curto da linha para leitura: "ABDOME TOTAL ou TRIFASICO → conta 2". */
export function descreverLinha(l: LinhaRegra): string {
  const q = `conta ${l.quantidade}`
  if (l.tipo === 'avancada') return `${l.padrao} → ${q}`
  const t = l.termos
  return `${t.length > 1 ? `${t.slice(0, -1).join(', ')} ou ${t[t.length - 1]}` : (t[0] ?? '')} → ${q}`
}

// ---------------------------------------------------------------- fim de semana (ação intensificada)
export const MODALIDADES_FIM_DE_SEMANA = ['RX', 'TC', 'RM', 'MG', 'US', 'DO', 'DX', 'CR', 'OT'] as const
export interface AcaoIntensificadaEditavel { ligado: boolean; modalidades: string[] }

/** Valor gravado → tela. null = desligado; {} ou sem modalidades = ligado para todas. */
export function lerAcaoIntensificada(v: { modalidades?: string[] | null } | null | undefined): AcaoIntensificadaEditavel {
  if (v == null) return { ligado: false, modalidades: [] }
  return { ligado: true, modalidades: [...new Set((v.modalidades ?? []).map(m => m.trim().toUpperCase()).filter(Boolean))] }
}

/** Tela → valor gravado: null (desligado) | {} (todas) | {modalidades:[...]}. */
export function montarAcaoIntensificada(x: AcaoIntensificadaEditavel): null | { modalidades?: string[] } {
  if (!x.ligado) return null
  const mods = [...new Set(x.modalidades.map(m => m.trim().toUpperCase()).filter(Boolean))]
  return mods.length ? { modalidades: mods } : {}
}
