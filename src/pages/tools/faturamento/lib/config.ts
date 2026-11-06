// Lógica pura da tela de Configuração (agrupamento, resumos e textos de regras).
import type { CriterioData, PapelItem, PrecoVigente, RegrasUnidade } from './tipos'
import { MODELO, brl } from './format'
import { diaDeCorte, normNome, semAcento, type AcaoIntensificada, type RegraQuantidade } from '../nucleo/motor'

export const GRUPO_PROPRIO_PRN = 'Contrato próprio — PRN'
export const GRUPO_PROPRIO_MEDIMAGEM = 'Contrato próprio — Medimagem'

export interface GrupoUnidades<T> { nome: string; proprio: boolean; unidades: T[] }

type Regras = Pick<RegrasUnidade, 'janela' | 'criterio_data' | 'franquia_mensal'> &
  Partial<Pick<RegrasUnidade, 'regras_quantidade' | 'estudos_conta_2' | 'todos_status'>> &
  { acao_intensificada?: AcaoIntensificada | null }

/** Regras "estudo conta N" que valem: as novas, ou o "conta 2" antigo quando não há novas (igual ao motor). */
export function regrasQuantidadeEfetivas(r: Partial<Pick<RegrasUnidade, 'regras_quantidade' | 'estudos_conta_2'>> | undefined): RegraQuantidade[] {
  if (r?.regras_quantidade?.length) return r.regras_quantidade
  return r?.estudos_conta_2 ? [{ padrao: r.estudos_conta_2, quantidade: 2 }] : []
}

/** Padrão da regra em português para leitura: "A|B|C" → "A, B ou C"; ".*" → " … ". Só exibição. */
export function padraoLegivel(padrao: string): string {
  const partes = padrao.split('|').map(p => p.replace(/\.\*/g, ' … ').replace(/\\/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} ou ${partes[partes.length - 1]}` : (partes[0] ?? padrao)
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

// Modelo de cobrança do grupo quando todas as unidades compartilham o mesmo; senão null ("Vários").
// Com `itensDe`, também devolve null se alguma unidade tem rótulo de modelo que contradiz os próprios itens.
export function modeloComum<T extends { modelo_cobranca: string }>(unidades: T[], itensDe?: (u: T) => { papel: string }[]): string | null {
  if (!unidades.length) return null
  const m = unidades[0].modelo_cobranca
  if (!unidades.every(u => u.modelo_cobranca === m)) return null
  if (itensDe && unidades.some(u => alertasModelo(u.modelo_cobranca, itensDe(u)).length)) return null
  return m
}

/** Avisos quando o rótulo do modelo não bate com os itens de preço cadastrados. */
export function alertasModelo(modelo: string, itens: { papel: string }[]): string[] {
  if (!itens.length) return ['Sem preço cadastrado — o cálculo vai parar']
  const normais = itens.filter(i => i.papel === 'normal').length
  const a: string[] = []
  if (modelo === 'preco_unico' && normais > 1) a.push(`Marcado como preço único, mas tem ${normais} preços por exame`)
  if (modelo === 'fixo_mensal' && !itens.some(i => i.papel === 'fixo')) a.push('Marcado como fixo mensal, mas não tem valor fixo')
  return a
}

const nItens = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

// Resumo de preço de uma unidade para a linha fechada.
export function resumoPreco(u: { n_itens: number }, itens: PrecoVigente[]): string {
  const fixos = itens.filter(i => i.papel === 'fixo' && i.valor != null)
  const normais = itens.filter(i => i.papel === 'normal')
  const semValor = itens.filter(i => i.valor == null).length
  const partes: string[] = []
  if (fixos.length) {
    const soma = fixos.reduce((s, i) => s + Number(i.valor), 0)
    partes.push(`Fixo ${brl(soma)}/mês`)
  }
  if (normais.length) {
    if (fixos.length) partes.push(nItens(normais.length, 'preço por exame', 'preços por exame'))
    else {
      const modalidades = normais.map(i => i.modalidade)
      const porModalidade = normais.length <= 5 && modalidades.every(m => !!m) && new Set(modalidades).size === normais.length
        && normais.every(i => i.valor != null)
      if (porModalidade) partes.push(normais.map(i => `${i.modalidade} ${brl(i.valor)}`).join(' · '))
      else if (normais.length === 1 && normais[0].valor != null) partes.push(brl(normais[0].valor))
      else partes.push(`por procedimento · ${nItens(normais.length, 'item', 'itens')}`)
    }
  }
  if (!partes.length) {
    const comValor = itens.filter(i => i.valor != null) // só urgência/excedente
    if (comValor.length) {
      const nome = (i: PrecoVigente) => {
        const m = /\b(sem|com) laudo\b/i.exec(i.exame)
        const n = m ? m[0].toLowerCase() : i.exame
        return n.length > 30 ? n.slice(0, 29) + '…' : n
      }
      const txt = comValor.map(i => `${nome(i)} ${brl(i.valor)}`).join(' / ')
      return semValor ? `${txt} · ${semValor} sem valor` : txt
    }
    if (u.n_itens > 0) return `${nItens(u.n_itens, 'item', 'itens')} sem valor`
    return 'sem preço — o cálculo vai parar'
  }
  return partes.join(' + ')
}

export const ROTULO_JANELA: Record<string, string> = {
  mes: 'mês calendário', ciclo_27_26: 'do dia 27 do mês anterior ao dia 26', quinzena: 'quinzenal (dias 1–15 e 16–fim do mês)',
}

// corte_NN, igual ao motor: começa no dia NN da competência e termina no dia NN−1 do mês seguinte
function textoCorte(d: number): string { return `do dia ${d} do mês da competência ao dia ${d - 1} do mês seguinte` }

/** Opções da tela da unidade: mês, quinzena e os dias de corte 2–28 (o 27 usa o nome antigo ciclo_27_26). */
export const OPCOES_JANELA: { valor: string; rotulo: string }[] = [
  { valor: 'mes', rotulo: ROTULO_JANELA.mes },
  { valor: 'quinzena', rotulo: ROTULO_JANELA.quinzena },
  ...Array.from({ length: 27 }, (_, i) => i + 2).map(d => ({
    valor: d === 27 ? 'ciclo_27_26' : `corte_${d}`,
    rotulo: d === 27 ? `ciclo: ${ROTULO_JANELA.ciclo_27_26}` : `corte: ${textoCorte(d)}`,
  })),
]

/** Texto da janela. 'corte_NN' = do dia NN da competência ao dia NN−1 do mês seguinte; 'ciclo_27_26' = do dia 27 do mês anterior ao dia 26. */
export function rotuloJanela(janela: string | null | undefined): string {
  const j = janela ?? 'mes'
  if (ROTULO_JANELA[j]) return ROTULO_JANELA[j]
  const d = diaDeCorte(j)
  return d ? textoCorte(d) : j
}

export function etiquetasRegras(r: Regras | undefined): string[] {
  if (!r) return []
  const e: string[] = []
  const corte = diaDeCorte(r.janela)
  if (r.janela === 'ciclo_27_26') e.push('27 do mês anterior→26')
  else if (corte) e.push(`corte ${corte}→${corte - 1}`)
  else if (r.janela === 'quinzena') e.push('quinzenal')
  if (r.todos_status) e.push('todos os status')
  if (r.acao_intensificada) e.push('fim de semana')
  if (r.criterio_data === 'exame') e.push('pela data do exame')
  else if (r.criterio_data === 'laudo') e.push('pela data do laudo')
  if (r.franquia_mensal) e.push(`franquia ${r.franquia_mensal.toLocaleString('pt-BR')}/mês`)
  for (const q of regrasQuantidadeEfetivas(r)) { const p = padraoLegivel(q.padrao); e.push(`conta ${q.quantidade}: ${p.length > 28 ? p.slice(0, 27) + '…' : p}`) }
  return e
}

function criterioEfetivo(modelo: string, c: CriterioData): { data: 'laudo' | 'exame'; auto: boolean } {
  if (c) return { data: c, auto: false }
  return { data: modelo === 'fixo_mensal' ? 'exame' : 'laudo', auto: true }
}

function listaE(l: string[]): string {
  return l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`
}

/** Status que entram na fatura, igual ao motor: todos_status → todos; fixo pela data do exame → todos; fixo pela data do laudo → só laudados; senão a lista configurada. */
export function statusAceitos(
  u: { modelo_cobranca: string; todos_status?: boolean | null; criterio_data?: CriterioData | undefined },
  statusPorExame: string[] = ['Assinado', 'Reassinado'],
): { texto: string; todos: boolean } {
  if (u.todos_status) return { texto: 'todos os status, inclusive sem laudo', todos: true }
  const lista = listaE(statusPorExame)
  if (u.modelo_cobranca === 'fixo_mensal') {
    if (criterioEfetivo(u.modelo_cobranca, u.criterio_data ?? null).data === 'exame') return { texto: 'todos os status', todos: true }
    return { texto: `só laudados (${lista})`, todos: false }
  }
  return { texto: lista, todos: false }
}

// Texto curto "Como fatura" (uma linha por regra).
export function comoFatura(modelo: string, r: Regras | undefined): { rotulo: string; texto: string }[] {
  const crit = criterioEfetivo(modelo, r?.criterio_data ?? null)
  const linhas = [
    { rotulo: 'Modelo', texto: MODELO[modelo] ?? modelo },
    { rotulo: 'Data que define o mês', texto: crit.auto ? `Automático (= data do ${crit.data})` : `data do ${crit.data}` },
    { rotulo: 'Status aceitos', texto: statusAceitos({ modelo_cobranca: modelo, todos_status: r?.todos_status, criterio_data: r?.criterio_data }).texto },
    { rotulo: 'Janela', texto: rotuloJanela(r?.janela) },
  ]
  if (r?.franquia_mensal) linhas.push({ rotulo: 'Franquia', texto: `${r.franquia_mensal.toLocaleString('pt-BR')} exames/mês; acima disso cobra o excedente` })
  const qtd = regrasQuantidadeEfetivas(r)
  if (qtd.length) linhas.push({ rotulo: 'Contam mais de 1', texto: qtd.map(x => `${padraoLegivel(x.padrao)} → conta ${x.quantidade}`).join('; ') })
  if (r?.acao_intensificada) {
    const mods = r.acao_intensificada.modalidades?.filter(Boolean) ?? []
    linhas.push({ rotulo: 'Fim de semana', texto: mods.length ? `relatório à parte: ${mods.join(', ')}` : 'relatório à parte, todas as modalidades' })
  }
  return linhas
}

/**
 * Nome do Bruto que recebe o valor fixo, igual a servico.ts (montarContexto): o alias marcado como principal;
 * sem marcação, o primeiro em ordem alfabética, preferindo nome que não seja de tele parceira (Ápice/DMX/TELE).
 * `automatico` = ninguém marcado. Com mais de um marcado o motor dá o fixo a todos: `todos` traz a lista.
 */
export function nomeQueRecebeFixo(
  aliases: { nome_bruto: string; principal: boolean; grupo?: string | null; subunidade?: string | null }[],
): { nome: string; automatico: boolean; todos: string[] } | null {
  if (!aliases.length) return null
  const marcados = aliases.filter(a => a.principal).map(a => a.nome_bruto)
  if (marcados.length) return { nome: marcados[0], automatico: false, todos: marcados }
  const ehTele = (n: string) => /\b(APICE|DMX|TELE)\b/.test(normNome(n))
  const cand = aliases.map(a => a.nome_bruto).sort((x, y) => Number(ehTele(x)) - Number(ehTele(y)) || x.localeCompare(y))
  return { nome: cand[0], automatico: true, todos: [cand[0]] }
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
