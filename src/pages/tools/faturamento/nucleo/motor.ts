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
  /** Último mês de Bruto mensal em que o exame veio ('AAAA-MM-01'), guardado no acervo. Ver intervaloDoLaudo. */
  mes_arquivo?: string | null
  /** Arquivo de onde a linha veio (leitura no navegador; vai para o acervo). */
  arquivo_nome?: string
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

/**
 * "Este estudo conta N": `padrao` é uma expressão regular aplicada à descrição do estudo
 * sem acento e em maiúsculas (ex.: 'MAOS E PUNHOS.*IDADE OSSEA' = 4; 'ABDOME TOTAL|TRIFASICO' = 2).
 * Vale a primeira regra que casar; nenhuma casou = 1.
 */
export interface RegraQuantidade { padrao: string; quantidade: number }

/**
 * Ação intensificada: exame FEITO no fim de semana (sábado ou domingo, pela data do exame) sai num relatório à
 * parte, com o mesmo preço (explicação do financeiro em 09/10/2026; planilhas de jun e jul/2026 de CISRJ, CISTEC,
 * Jacobina e Guanambi). `modalidades` (RX, TC, RM, MG…) limita quais entram; vazio = todas do fim de semana.
 */
export interface AcaoIntensificada { modalidades?: string[] | null }
export const ROTULO_ACAO_INTENSIFICADA = 'AÇÃO INTENSIFICADA'

export interface ContextoUnidade {
  unidade_id: string
  pasta: string
  modelo: string // preco_unico | por_modalidade | por_procedimento | fixo_mensal | misto | nao_identificado
  janela: Janela
  criterio_data: 'laudo' | 'exame' | null
  franquia_mensal: number | null
  todos_status?: boolean // cobra exame em qualquer status (ex.: Sorocaba, sem laudo na Mobilemed)
  regras_quantidade?: RegraQuantidade[] | null // estudo que conta N (ex.: idade óssea = 4 na Jandaia)
  estudos_conta_2?: string | null // formato antigo (só "conta 2"): vale quando não há regras_quantidade
  acao_intensificada?: AcaoIntensificada | null // exame de fim de semana em relatório à parte (CISRJ, CISTEC…)
  situacao: string
  subunidade: string | null // do alias
  principal: boolean // recebe os itens fixos
  itensPorPeriodo: Record<string, ItemPreco[]> // preço vigente no fim de cada período (chave = rotulo)
}

/**
 * Período de faturamento da unidade:
 * - 'mes': mês fechado; 'quinzena': dias 1–15 e 16–fim;
 * - 'corte_NN': do dia NN do mês anterior ao dia NN−1 da competência (ex.: corte_21 = 21/08 a 20/09);
 * - 'ciclo_27_26': nome antigo de corte_27 (FHEMIG), mantido para não quebrar o cadastro.
 */
export type Janela = 'mes' | 'quinzena' | 'ciclo_27_26' | `corte_${number}`

/** Dia de corte da janela (2–28), ou null para mês fechado/quinzena. */
export function diaDeCorte(janela: string): number | null {
  if (janela === 'ciclo_27_26') return 27
  const m = /^corte_(\d{1,2})$/.exec(janela)
  const d = m ? Number(m[1]) : NaN
  return d >= 2 && d <= 28 ? d : null
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

/**
 * Quando caiu o 1º laudo de um exame REASSINADO.
 *
 * Quando o laudo é reassinado, a Mobilemed troca a data de conclusão pela da nova assinatura. Mas o
 * Bruto mensal traz o exame transferido no mês OU laudado (1ª assinatura) no mês — conferido no Bruto
 * de set/2026 (Arco Verde, 09/10/2026). Então o 1º laudo do reassinado é, no máximo, do último mês de
 * Bruto em que o exame veio (`mes_arquivo`). Se a conclusão passou desse mês, o 1º laudo foi entre a
 * transferência (ou o dia 1) e o fim do mês do arquivo: é o intervalo devolvido.
 * `transferidoNoMes`: a transferência também é desse mês, então o exame pode ter vindo no Bruto só por
 * ela, com o 1º laudo no mês seguinte — dúvida que só o Bruto do mês seguinte no acervo tira (se o exame
 * vier nele, o `mes_arquivo` passa a ser o seguinte).
 * Null = vale a conclusão (não é reassinado, conclusão dentro do mês do arquivo ou sem `mes_arquivo`,
 * como nos exames mandados no pedido pelo app de testes).
 */
export function intervaloDoLaudo(l: LinhaBruto): { de: Date; ate: Date; transferidoNoMes: boolean } | null {
  const d = parseDataBR(l.data_conclusao)
  if (!d || !l.mes_arquivo || normNome(l.status ?? '') !== 'REASSINADO') return null
  const m = /^(\d{4})-(\d{2})/.exec(l.mes_arquivo)
  if (!m) return null
  const a = +m[1], mes = +m[2] - 1
  const inicio = new Date(Date.UTC(a, mes, 1))
  const fim = fimDoDia(a, mes, ultimoDia(a, mes))
  if (d <= fim) return null
  const t = parseDataBR(l.data_transferencia)
  const transferidoNoMes = !!t && t >= inicio && t <= fim
  return { de: transferidoNoMes ? t! : inicio, ate: fim, transferidoNoMes }
}

/** Data do laudo que vale para faturar: a do 1º laudo do reassinado (início do intervalo) ou a conclusão. */
export function dataDoLaudo(l: LinhaBruto): Date | null {
  return intervaloDoLaudo(l)?.de ?? parseDataBR(l.data_conclusao)
}

/** Opções do cálculo que vêm do acervo. */
export interface OpcoesCalculo {
  /** O acervo já tem o Bruto do mês seguinte à competência (tira a dúvida do reassinado, ver intervaloDoLaudo). */
  mesSeguinteNoAcervo?: boolean
  /**
   * Exames dos OUTROS nomes do Bruto da mesma unidade (ex.: RIO GRANDE PRN e RIO GRANDE - APICE TELE).
   * Só servem para a franquia, que é da unidade: o exame é franquia ou excedente pela posição dele entre
   * todos os exames da unidade no período, e não só entre os do próprio nome.
   */
  linhasDosOutrosNomes?: LinhaBruto[]
}

/** Períodos de faturamento da competência 'AAAA-MM' conforme a janela da unidade. */
export function periodos(competencia: string, janela: ContextoUnidade['janela']): Periodo[] {
  const [a, m1] = competencia.split('-').map(Number)
  const m = m1 - 1
  const corte = diaDeCorte(janela)
  if (corte) {
    const inicio = new Date(Date.UTC(a, m - 1, corte))
    const fim = fimDoDia(a, m, corte - 1)
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

/** Quantas letras do começo duas palavras têm em comum. */
function prefixoComum(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/**
 * Quanto o item combina com o estudo: palavra igual vale 2; mesma palavra com outro final (7+ letras iguais no
 * começo, ex.: ONCOLÓGICO × ONCOLOGIA) vale 2; só o começo parecido (5–6 letras, ex.: ANGIOTC × ANGIOTOMOGRAFIA) vale 1.
 */
function semelhanca(estudo: string, item: string): number {
  const te = tokens(estudo), ti = tokens(item)
  let n = 0
  for (const t of ti) {
    if (te.has(t)) { n += 2; continue }
    let melhor = 0
    for (const e of te) {
      if (e.length < 5 || t.length < 5) continue
      const p = prefixoComum(e, t)
      melhor = Math.max(melhor, p >= 7 ? 2 : p >= 5 ? 1 : 0)
    }
    n += melhor
  }
  return n
}

/**
 * Item de preço do exame. Vale o item que MAIS combina com o estudo (ex.: angiotomografia para "ANGIOTC TÓRAX");
 * a urgência só escolhe entre os itens que combinam igual (eletivo × urgente do mesmo procedimento). Antes (até
 * 09/10/2026) a urgência vinha primeiro e a angio de urgência da FAEPU saía pelo "TC geral urgente" (R$ 38 em vez de 45).
 */
export function escolherItem(linha: LinhaBruto, candidatos: ItemPreco[], urgente: boolean, precoUnico: boolean): ItemPreco | null {
  if (!candidatos.length) return null
  if (precoUnico && candidatos.length === 1) return candidatos[0]
  const mod = normModalidade(linha.modalidade)
  const porMod = candidatos.filter(c => !c.modalidade || c.modalidade === mod)
  if (!porMod.length) return null // nunca empresta preço de outra modalidade (sem item → pendência sem_preco)
  if (porMod.length === 1) return porMod[0]
  const papelDesejado: Papel = urgente ? 'urgencia' : 'normal'
  const te = tokens(linha.estudo_descricao ?? '')
  const avaliados = porMod.flatMap(c => {
    const cg = coringa(c.exame)
    if (cg.eh && cg.excluidas.size && [...cg.excluidas].every(t => te.has(t))) return [] // estudo é justamente o "exceto"
    const s = semelhanca(linha.estudo_descricao ?? '', cg.base)
    // desempate: item coringa ("todas, exceto…"), depois o mais genérico; item de uma região do corpo
    // (ex.: "Abdômen Total") que não casou com o estudo fica por último
    const espec = cg.eh ? -1 : (s === 0 && REGIAO.test(normNome(c.exame)) ? 1000 : tokens(c.exame).size)
    return [{ c, s, espec }]
  })
  if (!avaliados.length) return porMod[0]
  const max = Math.max(...avaliados.map(a => a.s))
  let pool = avaliados.filter(a => a.s === max)
  const doPapel = pool.filter(a => a.c.papel === papelDesejado)
  if (doPapel.length) pool = doPapel
  return pool.reduce((m, a) => (a.espec < m.espec ? a : m)).c
}

// ---------------------------------------------------------------- cálculo de um nome do Bruto
export function calcular(nomeBruto: string, linhas: LinhaBruto[], ctx: ContextoUnidade | null, competencia: string, cfg: Config, opcoes: OpcoesCalculo = {}): Resultado {
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
  // quantidade por estudo (ver RegraQuantidade); estudos_conta_2 é o formato antigo, só "conta 2"
  const fonteQtd: RegraQuantidade[] = ctx.regras_quantidade?.length ? ctx.regras_quantidade
    : ctx.estudos_conta_2 ? [{ padrao: ctx.estudos_conta_2, quantidade: 2 }] : []
  const regrasQtd = fonteQtd.flatMap(r => {
    try { return [{ re: new RegExp(r.padrao, 'i'), q: Math.max(1, Math.round(Number(r.quantidade) || 1)) }] }
    catch { pend.push({ tipo: 'regra_invalida', detalhe: `regra de quantidade inválida, ignorada: "${r.padrao}"` }); return [] }
  })
  const exames: ExameCalc[] = []
  const resumo: ResumoLinha[] = []
  const usadas = new Set<LinhaBruto>()

  if (ctx.situacao === 'vencido' || ctx.situacao === 'encerrado' || ctx.situacao === 'minuta')
    pend.push({ tipo: 'situacao', detalhe: `contrato ${ctx.situacao} (${ctx.pasta}) — faturado mesmo assim, confirmar` })

  // preço do hospital (subunidade): pela coluna subunidade do item; nos itens com hospital no nome ("HGES (Salvador)
  // — Raio-x", padrão do Exército), pelo começo do nome. Item genérico (sem " — " e sem subunidade) vale para todos
  // os hospitais da unidade (FHEMIG: o mesmo contrato para os 8 hospitais, um relatório por hospital).
  const doSub = (i: ItemPreco) => {
    if (!ctx.subunidade) return true
    if (i.subunidade) return normNome(i.subunidade) === normNome(ctx.subunidade)
    return normNome(i.exame).startsWith(normNome(ctx.subunidade)) || !i.exame.includes(' — ')
  }
  // reassinado (ver intervaloDoLaudo): o 1º laudo caiu num intervalo dentro do mês do Bruto. Com dia de corte ou
  // quinzena, o intervalo pode atravessar a divisa do período: aí não se chuta — vai para o período que começa na
  // divisa (o mesmo de antes, pela reassinatura) e vira pendência. Também é pendência a dúvida do mês seguinte.
  const divisa = diaDeCorte(ctx.janela) ?? (ctx.janela === 'quinzena' ? 16 : null)
  const laudo = (l: LinhaBruto): { data: Date | null; incerto: boolean } => {
    const iv = intervaloDoLaudo(l)
    if (!iv) return { data: parseDataBR(l.data_conclusao), incerto: false }
    if (divisa && iv.de.getUTCDate() < divisa && iv.ate.getUTCDate() >= divisa)
      return { data: new Date(Date.UTC(iv.ate.getUTCFullYear(), iv.ate.getUTCMonth(), divisa)), incerto: true }
    return { data: iv.de, incerto: iv.transferidoNoMes && !opcoes.mesSeguinteNoAcervo }
  }
  const dataDoCriterio = (l: LinhaBruto) => criterio === 'laudo' ? laudo(l).data : parseDataBR(l.data_exame)

  for (const p of periodos(competencia, ctx.janela)) {
    const itens = (ctx.itensPorPeriodo[p.rotulo] ?? []).filter(doSub)
    const fixos = itens.filter(i => i.papel === 'fixo' && i.valor != null)
    const cobraveis = itens.filter(i => (i.papel === 'normal' || i.papel === 'urgencia') && i.valor != null)
    const excedente = itens.find(i => i.papel === 'excedente' && i.valor != null) ?? null

    const entra = (l: LinhaBruto) => {
      const d = dataDoCriterio(l)
      const dentro = !!d && d >= p.inicio && d <= p.fim
      const statusPassa = fixo || !!ctx.todos_status || statusOk.has(normNome(l.status ?? ''))
      const dupPassa = cfg.duplicadoEntra || normNome(l.duplicado ?? '') !== 'SIM'
      return dentro && statusPassa && dupPassa
    }
    const selPeriodo = linhas.filter(entra)
    selPeriodo.forEach(l => usadas.add(l))
    // ação intensificada: o exame do fim de semana vai para um relatório à parte (período próprio, mesmo preço)
    const grupos = ctx.acao_intensificada
      ? [
        { rotulo: p.rotulo, sel: selPeriodo.filter(l => !ehAcaoIntensificada(l, ctx.acao_intensificada!)), principal: true },
        { rotulo: rotuloAcaoIntensificada(p.rotulo), sel: selPeriodo.filter(l => ehAcaoIntensificada(l, ctx.acao_intensificada!)), principal: false },
      ]
      : [{ rotulo: p.rotulo, sel: selPeriodo, principal: true }]
    for (const { rotulo, sel, principal: doRelatorioPrincipal } of grupos) {
      if (!doRelatorioPrincipal && !sel.length) continue // sem exame no fim de semana: não abre relatório vazio
      const ordenadas = [...sel].sort((a, b) => (dataDoCriterio(a)?.getTime() ?? 0) - (dataDoCriterio(b)?.getTime() ?? 0))
      // franquia da UNIDADE: posição do exame entre os exames de todos os nomes dela no período. A ordem é a mesma
      // no cálculo de cada nome (data e, no empate, nome/paciente/estudo), então cada exame tem uma posição só.
      const chaveOrdem = (l: LinhaBruto) => [l.unidade, l.data_exame, l.nome_paciente, l.estudo_descricao, l.accession_number].map(v => v ?? '').join('|')
      const posicaoNaFranquia = new Map<LinhaBruto, number>()
      if (ctx.franquia_mensal && excedente) {
        const daUnidade = [...sel, ...(opcoes.linhasDosOutrosNomes ?? []).filter(entra)]
        daUnidade.sort((a, b) => (dataDoCriterio(a)?.getTime() ?? 0) - (dataDoCriterio(b)?.getTime() ?? 0) || chaveOrdem(a).localeCompare(chaveOrdem(b)))
        daUnidade.forEach((l, i) => posicaoNaFranquia.set(l, i))
      }
      const incertos = criterio === 'laudo' ? sel.filter(l => laudo(l).incerto).length : 0
      if (incertos) pend.push({
        tipo: 'reassinado_incerto', qtd_exames: incertos,
        detalhe: `${incertos} laudo(s) reassinado(s) sem a data do 1º laudo${rotulo ? ` (${rotulo})` : ''}: suba o Bruto do mês seguinte (do dia 1 até hoje) com "Só guardar no acervo" e gere de novo; se continuar, confira o 1º laudo na Mobilemed`,
      })

      let semPreco = 0
      ordenadas.forEach(l => {
        const base = { ...l, periodo: rotulo, quantidade: 1 }
        if (ctx.franquia_mensal && excedente) {
          if (posicaoNaFranquia.get(l)! < ctx.franquia_mensal) exames.push({ ...base, item_preco_id: null, item_exame: 'franquia do valor fixo', valor_unitario: 0, valor_total: 0, motivo: 'franquia' })
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
        const estudo = normNome(l.estudo_descricao ?? '')
        const q = regrasQtd.find(r => r.re.test(estudo))?.q ?? 1
        exames.push({ ...base, quantidade: q, item_preco_id: it.item_preco_id, item_exame: it.exame, valor_unitario: it.valor!, valor_total: round2(it.valor! * q), motivo: 'ok' })
      })

      if (semPreco) pend.push({ tipo: 'sem_preco', detalhe: `${semPreco} exame(s) sem item de preço no contrato${rotulo ? ` (${rotulo})` : ''}`, qtd_exames: semPreco })
      if (fixo && ctx.franquia_mensal && !excedente && sel.length > ctx.franquia_mensal)
        pend.push({ tipo: 'franquia', detalhe: `${sel.length} exames contra franquia de ${ctx.franquia_mensal}/mês e sem preço de excedente`, qtd_exames: sel.length - ctx.franquia_mensal })

      // resumo por modalidade do Bruto (como nas planilhas de agosto)
      const porMod = new Map<string, { q: number; t: number; v: Set<number> }>()
      for (const e of exames.filter(x => x.periodo === rotulo)) {
        const k = (e.modalidade ?? '').trim().toUpperCase() || '—'
        const g = porMod.get(k) ?? { q: 0, t: 0, v: new Set<number>() }
        g.q += e.quantidade; g.t += e.valor_total; g.v.add(e.valor_unitario); porMod.set(k, g)
      }
      let ordem = 0
      for (const [k, g] of [...porMod.entries()].sort()) {
        resumo.push({ periodo: rotulo, rotulo: k, quantidade: g.q, valor_unitario: g.v.size === 1 ? [...g.v][0] : null, total: round2(g.t), fixo: false, ordem: ordem++ })
      }
      // itens fixos (mensalidade, locação…) só no relatório principal do período, nunca no da ação intensificada
      if (ctx.principal && doRelatorioPrincipal) {
        for (const f of fixos) resumo.push({ periodo: rotulo, rotulo: f.exame, quantidade: 1, valor_unitario: f.valor, total: round2(f.valor!), fixo: true, ordem: ordem++ })
      }
      if (fixo && !fixos.length && ctx.principal && doRelatorioPrincipal)
        pend.push({ tipo: 'fixo_sem_valor', detalhe: 'unidade de valor fixo sem item fixo com valor vigente no período' })
    }
  }
  return { exames, resumo, pendencias: pend, fora_do_periodo: linhas.length - usadas.size }
}

/** Exame feito no sábado ou domingo (data do exame), da modalidade que a unidade manda para a ação intensificada. */
export function ehAcaoIntensificada(l: LinhaBruto, ai: AcaoIntensificada): boolean {
  const d = parseDataBR(l.data_exame)
  if (!d) return false
  const dia = d.getUTCDay() // 0 = domingo, 6 = sábado
  if (dia !== 0 && dia !== 6) return false
  const mods = (ai.modalidades ?? []).map(m => normModalidade(m) === 'OUTRO' ? m.trim().toUpperCase() : normModalidade(m))
  return !mods.length || mods.includes(normModalidade(l.modalidade))
}

/** Rótulo do relatório da ação intensificada (na quinzena, junto do rótulo dela). */
export function rotuloAcaoIntensificada(rotuloPeriodo: string): string {
  return rotuloPeriodo ? `${rotuloPeriodo} · ${ROTULO_ACAO_INTENSIFICADA}` : ROTULO_ACAO_INTENSIFICADA
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
