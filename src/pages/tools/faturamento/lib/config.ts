// Lógica pura da tela de Configuração (agrupamento, resumos e textos de regras).
import type { CriterioData, PapelItem, PrecoVigente, RegrasUnidade } from './tipos'
import { MODELO, brl } from './format'
import { diaDeCorte, semAcento, type RegraQuantidade } from '../nucleo/motor'

export const GRUPO_PROPRIO_PRN = 'Contrato próprio — PRN'
export const GRUPO_PROPRIO_MEDIMAGEM = 'Contrato próprio — Medimagem'

export interface GrupoUnidades<T> { nome: string; proprio: boolean; unidades: T[] }

type Regras = Pick<RegrasUnidade, 'janela' | 'criterio_data' | 'franquia_mensal'> &
  Partial<Pick<RegrasUnidade, 'regras_quantidade' | 'estudos_conta_2'>>

/** Regras "estudo conta N" que valem: as novas, ou o "conta 2" antigo quando não há novas (igual ao motor). */
export function regrasQuantidadeEfetivas(r: Partial<Pick<RegrasUnidade, 'regras_quantidade' | 'estudos_conta_2'>> | undefined): RegraQuantidade[] {
  if (r?.regras_quantidade?.length) return r.regras_quantidade
  return r?.estudos_conta_2 ? [{ padrao: r.estudos_conta_2, quantidade: 2 }] : []
}

/** Regras → texto da tela: uma por linha, "PADRÃO = N". */
export function textoRegrasQuantidade(r: Partial<Pick<RegrasUnidade, 'regras_quantidade' | 'estudos_conta_2'>> | undefined): string {
  return regrasQuantidadeEfetivas(r).map(x => `${x.padrao} = ${x.quantidade}`).join('\n')
}

/**
 * Texto da tela → regras. Cada linha "PADRÃO = N" (N de 2 a 20). O padrão vira maiúscula e
 * perde o acento, porque a descrição do estudo é comparada assim ("Mãos e punhos" = "MAOS E PUNHOS").
 */
export function lerRegrasQuantidade(texto: string): { regras: RegraQuantidade[]; erros: string[] } {
  const regras: RegraQuantidade[] = []
  const erros: string[] = []
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim()
    if (!linha) continue
    const m = /^(.*?)\s*=\s*(\d+)$/.exec(linha)
    if (!m || !m[1].trim()) { erros.push(`"${linha}": escreva PADRÃO = número`); continue }
    const quantidade = Number(m[2])
    if (quantidade < 2 || quantidade > 20) { erros.push(`"${linha}": a quantidade vai de 2 a 20`); continue }
    const padrao = semAcento(m[1].trim()).toUpperCase()
    try { new RegExp(padrao) } catch { erros.push(`"${linha}": padrão inválido`); continue }
    regras.push({ padrao, quantidade })
  }
  return { regras, erros }
}

// Nome do grupo de uma unidade: o grupo do contrato ou, sem grupo, o "Contrato próprio" da empresa.
export function nomeGrupo(u: { grupo: string | null; empresa: string }): string {
  const g = u.grupo?.trim()
  if (g) return g
  return u.empresa === 'MEDIMAGEM' ? GRUPO_PROPRIO_MEDIMAGEM : GRUPO_PROPRIO_PRN
}

// Grupos nomeados primeiro (ordem alfabética), depois os dois "Contrato próprio". Unidades ordenadas por pasta.
export function agruparUnidades<T extends { grupo: string | null; empresa: string; pasta: string }>(lista: T[]): GrupoUnidades<T>[] {
  const m = new Map<string, T[]>()
  for (const u of lista) {
    const n = nomeGrupo(u)
    const l = m.get(n)
    if (l) l.push(u); else m.set(n, [u])
  }
  const proprios = [GRUPO_PROPRIO_PRN, GRUPO_PROPRIO_MEDIMAGEM]
  const porPasta = (a: T, b: T) => a.pasta.localeCompare(b.pasta, 'pt-BR')
  const nomeados = [...m.keys()].filter(k => !proprios.includes(k)).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return [...nomeados, ...proprios.filter(k => m.has(k))].map(nome => ({
    nome, proprio: proprios.includes(nome), unidades: [...m.get(nome)!].sort(porPasta),
  }))
}

// Modelo de cobrança do grupo quando todas as unidades compartilham o mesmo; senão null.
export function modeloComum(unidades: { modelo_cobranca: string }[]): string | null {
  if (!unidades.length) return null
  const m = unidades[0].modelo_cobranca
  return unidades.every(u => u.modelo_cobranca === m) ? m : null
}

// Resumo de preço de uma unidade para a linha fechada.
export function resumoPreco(u: { n_itens: number }, itens: PrecoVigente[]): string {
  const fixos = itens.filter(i => i.papel === 'fixo' && i.valor != null)
  const normais = itens.filter(i => i.papel === 'normal')
  const partes: string[] = []
  if (fixos.length) {
    const soma = fixos.reduce((s, i) => s + Number(i.valor), 0)
    partes.push(`Fixo ${brl(soma)}/mês`)
  }
  if (normais.length) {
    const modalidades = normais.map(i => i.modalidade)
    const porModalidade = normais.length <= 5 && modalidades.every(m => !!m) && new Set(modalidades).size === normais.length
      && normais.every(i => i.valor != null)
    if (porModalidade) partes.push(normais.map(i => `${i.modalidade} ${brl(i.valor)}`).join(' · '))
    else if (normais.length === 1 && normais[0].valor != null) partes.push(brl(normais[0].valor))
    else partes.push(`por procedimento · ${normais.length} ${normais.length === 1 ? 'item' : 'itens'}`)
  }
  if (!partes.length) {
    const comValor = itens.filter(i => i.valor != null).length // só urgência/excedente
    if (comValor) return `${comValor} ${comValor === 1 ? 'valor' : 'valores'} (urgência/excedente)`
    return u.n_itens > 0 ? `${u.n_itens} ${u.n_itens === 1 ? 'item' : 'itens'} sem valor vigente` : 'sem preço'
  }
  return partes.join(' + ')
}

export const ROTULO_JANELA: Record<string, string> = {
  mes: 'mês calendário', ciclo_27_26: 'ciclo do dia 27 ao dia 26', quinzena: 'quinzenal (dias 1–15 e 16–fim do mês)',
}

/** Opções da tela da unidade: mês, quinzena e os dias de corte 2–28 (o 27 usa o nome antigo ciclo_27_26). */
export const OPCOES_JANELA: { valor: string; rotulo: string }[] = [
  { valor: 'mes', rotulo: ROTULO_JANELA.mes },
  { valor: 'quinzena', rotulo: ROTULO_JANELA.quinzena },
  ...Array.from({ length: 27 }, (_, i) => i + 2).map(d => ({
    valor: d === 27 ? 'ciclo_27_26' : `corte_${d}`,
    rotulo: `corte: do dia ${d} do mês anterior ao dia ${d - 1}`,
  })),
]

/** Texto da janela, incluindo os cortes 'corte_NN' (do dia NN do mês anterior ao dia NN−1). */
export function rotuloJanela(janela: string | null | undefined): string {
  const j = janela ?? 'mes'
  if (ROTULO_JANELA[j]) return ROTULO_JANELA[j]
  const d = diaDeCorte(j)
  return d ? `do dia ${d} do mês anterior ao dia ${d - 1}` : j
}

export function etiquetasRegras(r: Regras | undefined): string[] {
  if (!r) return []
  const e: string[] = []
  const corte = diaDeCorte(r.janela)
  if (corte) e.push(`ciclo ${corte}→${corte - 1}`)
  else if (r.janela === 'quinzena') e.push('quinzenal')
  if (r.criterio_data === 'exame') e.push('pela data do exame')
  else if (r.criterio_data === 'laudo') e.push('pela data do laudo')
  if (r.franquia_mensal) e.push(`franquia ${r.franquia_mensal.toLocaleString('pt-BR')}/mês`)
  for (const q of regrasQuantidadeEfetivas(r)) e.push(`conta ${q.quantidade}: ${q.padrao.length > 28 ? q.padrao.slice(0, 27) + '…' : q.padrao}`)
  return e
}

function criterioEfetivo(modelo: string, c: CriterioData): { data: 'laudo' | 'exame'; auto: boolean } {
  if (c) return { data: c, auto: false }
  return { data: modelo === 'fixo_mensal' ? 'exame' : 'laudo', auto: true }
}

// Texto curto "Como fatura" (uma linha por regra).
export function comoFatura(modelo: string, r: Regras | undefined): { rotulo: string; texto: string }[] {
  const crit = criterioEfetivo(modelo, r?.criterio_data ?? null)
  const linhas = [
    { rotulo: 'Modelo', texto: MODELO[modelo] ?? modelo },
    { rotulo: 'Data que define o mês', texto: `data do ${crit.data}${crit.auto ? ' (automático)' : ''}` },
    { rotulo: 'Status aceitos', texto: modelo === 'fixo_mensal' ? 'todos' : 'Assinado e Reassinado' },
    { rotulo: 'Janela', texto: rotuloJanela(r?.janela) },
  ]
  if (r?.franquia_mensal) linhas.push({ rotulo: 'Franquia', texto: `${r.franquia_mensal.toLocaleString('pt-BR')} exames/mês; acima disso cobra o excedente` })
  const qtd = regrasQuantidadeEfetivas(r)
  if (qtd.length) linhas.push({ rotulo: 'Estudos que contam mais de 1', texto: qtd.map(x => `${x.padrao} = ${x.quantidade}`).join('; ') })
  return linhas
}

export const BLOCOS_PRECO: { papel: PapelItem; titulo: string }[] = [
  { papel: 'fixo', titulo: 'Valor fixo mensal' },
  { papel: 'normal', titulo: 'Por exame' },
  { papel: 'urgencia', titulo: 'Urgência' },
  { papel: 'excedente', titulo: 'Excedente' },
]

export const ROTULO_PAPEL: Record<PapelItem, string> = {
  fixo: 'Fixo', normal: 'Normal', urgencia: 'Urgência', excedente: 'Excedente',
}
