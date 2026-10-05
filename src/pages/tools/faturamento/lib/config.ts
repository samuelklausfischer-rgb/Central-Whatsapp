// Lógica pura da tela de Configuração (agrupamento, resumos e textos de regras).
import type { CriterioData, PapelItem, PrecoVigente, RegrasUnidade } from './tipos'
import { MODELO, brl } from './format'

export const GRUPO_PROPRIO_PRN = 'Contrato próprio — PRN'
export const GRUPO_PROPRIO_MEDIMAGEM = 'Contrato próprio — Medimagem'

export interface GrupoUnidades<T> { nome: string; proprio: boolean; unidades: T[] }

type Regras = Pick<RegrasUnidade, 'janela' | 'criterio_data' | 'franquia_mensal'>

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

export function etiquetasRegras(r: Regras | undefined): string[] {
  if (!r) return []
  const e: string[] = []
  if (r.janela === 'ciclo_27_26') e.push('ciclo 27→26')
  else if (r.janela === 'quinzena') e.push('quinzenal')
  if (r.criterio_data === 'exame') e.push('pela data do exame')
  else if (r.criterio_data === 'laudo') e.push('pela data do laudo')
  if (r.franquia_mensal) e.push(`franquia ${r.franquia_mensal.toLocaleString('pt-BR')}/mês`)
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
    { rotulo: 'Janela', texto: ROTULO_JANELA[r?.janela ?? 'mes'] },
  ]
  if (r?.franquia_mensal) linhas.push({ rotulo: 'Franquia', texto: `${r.franquia_mensal.toLocaleString('pt-BR')} exames/mês; acima disso cobra o excedente` })
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
