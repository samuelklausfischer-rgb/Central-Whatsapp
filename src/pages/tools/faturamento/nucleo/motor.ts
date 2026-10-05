// CÓPIA do motor do repositório PRN-faturamento-unidades (supabase/functions/fat-simular/).
// Alterou a regra de cálculo? Altere lá também (os testes de lá cobrem os casos reais de jun–set/2026).
// Motor de cálculo do Faturamento por Unidade — lógica pura, sem dependências.
// Usado pela Edge Function fat-simular (Deno) e testado com Vitest em app/ (motor.test.ts).
// Spec: docs/superpowers/specs/2026-09-30-frontend-testes-faturamento-design.md §6-B

export interface LinhaBruto {
  unidade: string
  nome_paciente?: string
  estudo_descricao?: string
  accession_number?: string
  modalidade?: string
  prioridade?: string
  medico?: string
  duplicado?: string
  data_exame?: string
  data_transferencia?: string
  data_conclusao?: string
  data_prazo?: string
  status?: string
  imagem_chave?: string
  digitador?: string
}

export type Papel = 'normal' | 'urgencia' | 'fixo' | 'excedente'

export interface ItemPreco {
  item_preco_id: string
  exame: string
  modalidade: string | null
  subunidade?: string | null
  valor: number | null
  papel: Papel
}

export interface ContextoUnidade {
  unidade_id: string
  pasta: string
  modelo: string // preco_unico | por_modalidade | por_procedimento | fixo_mensal | misto | nao_identificado
  janela: 'mes' | 'ciclo_27_26' | 'quinzena'
  criterio_data: 'laudo' | 'exame' | null
  franquia_mensal: number | null
  todos_status?: boolean // cobra exame em qualquer status (ex.: Sorocaba, sem laudo na Mobilemed)
  estudos_conta_2?: string | null // regex sobre a descrição normalizada: estudo que conta 2 (ex.: 'ABDOME TOTAL|TRIFASICO')
  situacao: string
  subunidade: string | null // do alias
  principal: boolean // recebe os itens fixos
  itensPorPeriodo: Record<string, ItemPreco[]> // preço vigente no fim de cada período (chave = rotulo)
}

export interface Config {
  prioridadesUrgencia: string[]
  statusPorExame: string[]
  duplicadoEntra: boolean
}

export interface Periodo { rotulo: string; inicio: Date; fim: Date; dataPreco: string }

export interface ExameCalc extends LinhaBruto {
  periodo: string
  item_preco_id: string | null
  item_exame: string | null
  quantidade: number
  valor_unitario: number
  valor_total: number
  motivo: 'ok' | 'sem_preco' | 'fixo' | 'franquia' | 'excedente'
}

export interface ResumoLinha {
  periodo: string
  rotulo: string
  quantidade: number
  valor_unitario: number | null
  total: number
  fixo: boolean
  ordem: number
}

export interface Pendencia { tipo: string; detalhe: string; qtd_exames?: number }

export interface Resultado {
  exames: ExameCalc[]
  resumo: ResumoLinha[]
  pendencias: Pendencia[]
  fora_do_periodo: number
}

// ---------------------------------------------------------------- utilidades
export function semAcento(s: string): string {
  return (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

export function normNome(s: string): string {
  return semAcento(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

export function parseDataBR(s: string | undefined | null): Date | null {
  if (!s) return null
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!m) return null
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0))
}

const MOD: Record<string, string> = { CR: 'RX', DX: 'RX', RX: 'RX', CT: 'TC', TC: 'TC', MR: 'RM', RM: 'RM', MG: 'MG', US: 'US', DO: 'DO', BMD: 'DO', ECG: 'ECG', OT: 'DO', XA: 'OUTRO' } // OT na Mobilemed = densitometria/DXA (jun/2026)
export function normModalidade(m: string | undefined | null): string {
  return MOD[(m ?? '').trim().toUpperCase()] ?? 'OUTRO'
}

function iso(d: Date): string { return d.toISOString().slice(0, 10) }
function fimDoDia(a: number, m: number, d: number): Date { return new Date(Date.UTC(a, m, d, 23, 59, 59)) }
function ultimoDia(a: number, m: number): number { return new Date(Date.UTC(a, m + 1, 0)).getUTCDate() }

/** Períodos de faturamento da competência 'AAAA-MM' conforme a janela da unidade. */
export function periodos(competencia: string, janela: ContextoUnidade['janela']): Periodo[] {
  const [a, m1] = competencia.split('-').map(Number)
  const m = m1 - 1
  if (janela === 'ciclo_27_26') {
    const inicio = new Date(Date.UTC(a, m - 1, 27))
    const fim = fimDoDia(a, m, 26)
    return [{ rotulo: '', inicio, fim, dataPreco: iso(fim) }]
  }
  if (janela === 'quinzena') {
    const u = ultimoDia(a, m)
    const f1 = fimDoDia(a, m, 15), f2 = fimDoDia(a, m, u)
    return [
      { rotulo: '1ª QUINZENA', inicio: new Date(Date.UTC(a, m, 1)), fim: f1, dataPreco: iso(f1) },
      { rotulo: '2ª QUINZENA', inicio: new Date(Date.UTC(a, m, 16)), fim: f2, dataPreco: iso(f2) },
    ]
  }
  const fim = fimDoDia(a, m, ultimoDia(a, m))
  return [{ rotulo: '', inicio: new Date(Date.UTC(a, m, 1)), fim, dataPreco: iso(fim) }]
}

// ---------------------------------------------------------------- casamento exame → item
const GENERICAS = new Set(['LAUDO', 'LAUDOS', 'EXAME', 'EXAMES', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'COM', 'SEM', 'PARA', 'POR',
  'EMISSAO', 'ELABORACAO', 'ATRAVES', 'TELEMEDICINA', 'URGENCIA', 'URGENTE', 'URGENTISSIMO', 'ELETIVA', 'ELETIVO', 'ROTINA',
  'COMPUTADORIZADA', 'TOMOGRAFIA', 'RESSONANCIA', 'MAGNETICA', 'RAIO', 'X', 'RX', 'TC', 'RM', 'MG', 'MAMOGRAFIA', 'GERAL', 'NAO',
  'DIGITAL', 'C', 'S', 'SC', 'CC', 'A', 'O', 'NO', 'NA', 'AO', 'AS', 'OS', 'ATE', 'RESULTADO', 'H', 'HORAS'])

function tokens(s: string): Set<string> {
  return new Set(normNome(s).split(' ').filter(t => t.length > 1 && !GENERICAS.has(t)))
}

// item "coringa": "(todas, exceto abdome total)", "demais exames"… — é o padrão quando nada casa melhor,
// e não vale para estudo que tem as palavras do "exceto"
const CORINGA = /\b(TODAS|TODOS|DEMAIS|OUTRAS|OUTROS|EXCETO)\b/
const REGIAO = /\b(ABDOME|ABDOMEN|ABDOMINAL|TORAX|CRANIO|PELVE|BACIA|COLUNA|ANGIO\w*|CORONARIAS?|MAMAS?|PESCOCO|FACE|SEIOS|JOELHO|OMBRO|PUNHO|MAO|PE|TORNOZELO|QUADRIL|FEMUR|CERVICAL|LOMBAR|DORSAL)\b/
function coringa(item: string): { eh: boolean; base: string; excluidas: Set<string> } {
  const n = normNome(item)
  if (!CORINGA.test(n)) return { eh: false, base: item, excluidas: new Set() }
  const [antes, depois = ''] = n.split(/\bEXCETO\b/)
  return { eh: true, base: antes, excluidas: tokens(depois) }
}

function semelhanca(estudo: string, item: string): number {
  const te = tokens(estudo), ti = tokens(item)
  let n = 0
  for (const t of ti) {
    if (te.has(t)) n += 2
    else for (const e of te) if (e.length >= 5 && t.length >= 5 && (e.startsWith(t.slice(0, 5)) || t.startsWith(e.slice(0, 5)))) { n += 1; break }
  }
  return n
}

export function escolherItem(linha: LinhaBruto, candidatos: ItemPreco[], urgente: boolean, precoUnico: boolean): ItemPreco | null {
  if (!candidatos.length) return null
  if (precoUnico && candidatos.length === 1) return candidatos[0]
  const mod = normModalidade(linha.modalidade)
  let porMod = candidatos.filter(c => !c.modalidade || c.modalidade === mod)
  if (!porMod.length) return null // nunca empresta preço de outra modalidade (sem item → pendência sem_preco)
  const papelDesejado: Papel = urgente ? 'urgencia' : 'normal'
  const porPapel = porMod.filter(c => c.papel === papelDesejado)
  if (porPapel.length) porMod = porPapel
  if (porMod.length === 1) return porMod[0]
  // desempate: semelhança com a descrição do estudo; empate → item coringa ("todas, exceto…") e depois o mais genérico
  const te = tokens(linha.estudo_descricao ?? '')
  let melhor = porMod[0], mScore = -1, mEspec = Infinity
  for (const c of porMod) {
    const cg = coringa(c.exame)
    if (cg.eh && cg.excluidas.size && [...cg.excluidas].every(t => te.has(t))) continue // estudo é justamente o "exceto"
    const s = semelhanca(linha.estudo_descricao ?? '', cg.base)
    // item de uma região do corpo (ex.: "Abdômen Total") que não casou com o estudo fica por último no desempate
    const espec = cg.eh ? -1 : (s === 0 && REGIAO.test(normNome(c.exame)) ? 1000 : tokens(c.exame).size)
    if (s > mScore || (s === mScore && espec < mEspec)) { melhor = c; mScore = s; mEspec = espec }
  }
  return melhor
}

// ---------------------------------------------------------------- cálculo de um nome do Bruto
export function calcular(nomeBruto: string, linhas: LinhaBruto[], ctx: ContextoUnidade | null, competencia: string, cfg: Config): Resultado {
  if (!ctx) {
    return {
      exames: [], resumo: [], fora_do_periodo: 0,
      pendencias: [{ tipo: 'unidade_desconhecida', detalhe: `"${nomeBruto}" não está ligado a nenhuma unidade de contrato (cadastre em Nomes do Bruto)`, qtd_exames: linhas.length }],
    }
  }
  const fixo = ctx.modelo === 'fixo_mensal'
  const criterio = ctx.criterio_data ?? (fixo ? 'exame' : 'laudo')
  const urg = new Set(cfg.prioridadesUrgencia.map(p => normNome(p)))
  const statusOk = new Set(cfg.statusPorExame.map(s => normNome(s)))
  const precoUnico = ctx.modelo === 'preco_unico'
  const pend: Pendencia[] = []
  const conta2 = ctx.estudos_conta_2 ? new RegExp(ctx.estudos_conta_2, 'i') : null
  const exames: ExameCalc[] = []
  const resumo: ResumoLinha[] = []
  const usadas = new Set<LinhaBruto>()

  if (ctx.situacao === 'vencido' || ctx.situacao === 'encerrado' || ctx.situacao === 'minuta')
    pend.push({ tipo: 'situacao', detalhe: `contrato ${ctx.situacao} (${ctx.pasta}) — faturado mesmo assim, confirmar` })

  const doSub = (i: ItemPreco) => !ctx.subunidade || normNome(i.exame).startsWith(normNome(ctx.subunidade))

  for (const p of periodos(competencia, ctx.janela)) {
    const itens = (ctx.itensPorPeriodo[p.rotulo] ?? []).filter(doSub)
    const fixos = itens.filter(i => i.papel === 'fixo' && i.valor != null)
    const cobraveis = itens.filter(i => (i.papel === 'normal' || i.papel === 'urgencia') && i.valor != null)
    const excedente = itens.find(i => i.papel === 'excedente' && i.valor != null) ?? null

    const sel = linhas.filter(l => {
      const d = parseDataBR(criterio === 'laudo' ? l.data_conclusao : l.data_exame)
      const dentro = !!d && d >= p.inicio && d <= p.fim
      const statusPassa = fixo || !!ctx.todos_status || statusOk.has(normNome(l.status ?? ''))
      const dupPassa = cfg.duplicadoEntra || normNome(l.duplicado ?? '') !== 'SIM'
      return dentro && statusPassa && dupPassa
    })
    sel.forEach(l => usadas.add(l))
    const ordenadas = [...sel].sort((a, b) =>
      (parseDataBR(criterio === 'laudo' ? a.data_conclusao : a.data_exame)?.getTime() ?? 0) -
      (parseDataBR(criterio === 'laudo' ? b.data_conclusao : b.data_exame)?.getTime() ?? 0))

    let semPreco = 0
    ordenadas.forEach((l, idx) => {
      const base = { ...l, periodo: p.rotulo, quantidade: 1 }
      if (ctx.franquia_mensal && excedente) {
        if (idx < ctx.franquia_mensal) exames.push({ ...base, item_preco_id: null, item_exame: 'franquia do valor fixo', valor_unitario: 0, valor_total: 0, motivo: 'franquia' })
        else exames.push({ ...base, item_preco_id: excedente.item_preco_id, item_exame: excedente.exame, valor_unitario: excedente.valor!, valor_total: round2(excedente.valor!), motivo: 'excedente' })
        return
      }
      if (fixo) {
        exames.push({ ...base, item_preco_id: null, item_exame: 'valor fixo mensal', valor_unitario: 0, valor_total: 0, motivo: 'fixo' })
        return
      }
      const urgente = urg.has(normNome(l.prioridade ?? ''))
      const it = escolherItem(l, cobraveis, urgente, precoUnico)
      if (!it) { semPreco++; exames.push({ ...base, item_preco_id: null, item_exame: null, valor_unitario: 0, valor_total: 0, motivo: 'sem_preco' }); return }
      const q = conta2?.test(normNome(l.estudo_descricao ?? '')) ? 2 : 1
      exames.push({ ...base, quantidade: q, item_preco_id: it.item_preco_id, item_exame: it.exame, valor_unitario: it.valor!, valor_total: round2(it.valor! * q), motivo: 'ok' })
    })

    if (semPreco) pend.push({ tipo: 'sem_preco', detalhe: `${semPreco} exame(s) sem item de preço no contrato${p.rotulo ? ` (${p.rotulo})` : ''}`, qtd_exames: semPreco })
    if (fixo && ctx.franquia_mensal && !excedente && sel.length > ctx.franquia_mensal)
      pend.push({ tipo: 'franquia', detalhe: `${sel.length} exames contra franquia de ${ctx.franquia_mensal}/mês e sem preço de excedente`, qtd_exames: sel.length - ctx.franquia_mensal })

    // resumo por modalidade do Bruto (como nas planilhas de agosto)
    const porMod = new Map<string, { q: number; t: number; v: Set<number> }>()
    for (const e of exames.filter(x => x.periodo === p.rotulo)) {
      const k = (e.modalidade ?? '').trim().toUpperCase() || '—'
      const g = porMod.get(k) ?? { q: 0, t: 0, v: new Set<number>() }
      g.q += e.quantidade; g.t += e.valor_total; g.v.add(e.valor_unitario); porMod.set(k, g)
    }
    let ordem = 0
    for (const [k, g] of [...porMod.entries()].sort()) {
      resumo.push({ periodo: p.rotulo, rotulo: k, quantidade: g.q, valor_unitario: g.v.size === 1 ? [...g.v][0] : null, total: round2(g.t), fixo: false, ordem: ordem++ })
    }
    if (ctx.principal) {
      for (const f of fixos) resumo.push({ periodo: p.rotulo, rotulo: f.exame, quantidade: 1, valor_unitario: f.valor, total: round2(f.valor!), fixo: true, ordem: ordem++ })
    }
    if (fixo && !fixos.length && ctx.principal)
      pend.push({ tipo: 'fixo_sem_valor', detalhe: 'unidade de valor fixo sem item fixo com valor vigente no período' })
  }
  return { exames, resumo, pendencias: pend, fora_do_periodo: linhas.length - usadas.size }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
