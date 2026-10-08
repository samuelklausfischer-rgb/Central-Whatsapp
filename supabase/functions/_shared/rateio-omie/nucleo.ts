// Núcleo PURO do rateio -> Omie: sem Deno, sem rede, sem relógio.
// Importável pelo Deno (Edge Function) e pelo Node (testes). Só sintaxe apagável:
// sem enum, sem namespace, sem parameter properties; imports com extensão .ts.
// Contrato: docs/rateio-omie/CONTRATO.md

export type Empresa = 'PRN' | 'PRN_APICE' | 'MEDIMAGEM' | 'MEDIMAGEM_APICE'
export type ContaOmie = 'PRN' | 'MEDIMAGEM'

export const EMPRESAS: readonly Empresa[] = ['PRN', 'PRN_APICE', 'MEDIMAGEM', 'MEDIMAGEM_APICE']

const SUFIXO_CHAVE: Record<Empresa, string> = {
  PRN: 'P',
  PRN_APICE: 'PA',
  MEDIMAGEM: 'M',
  MEDIMAGEM_APICE: 'MA',
}

const CONTA_DA_EMPRESA: Record<Empresa, ContaOmie> = {
  PRN: 'PRN',
  PRN_APICE: 'PRN',
  MEDIMAGEM: 'MEDIMAGEM',
  MEDIMAGEM_APICE: 'MEDIMAGEM',
}

/** Teto de ajuste de arredondamento, em centavos (contrato: |diferença| <= 100). */
export const AJUSTE_MAX_CENTAVOS = 100

export type LinhaRateio = { unidade: string; total: number; [k: string]: unknown }

export type VinculoMapa = {
  unidade_chave: string
  cod_departamento: number | string
  departamento_nome?: string | null
  confianca?: 'ALTA' | 'MEDIA' | 'BAIXA' | string | null
}

export type ConfigEmpresa = {
  empresa: string
  conta_omie: string
  cnpj_esperado: string
  cod_fornecedor: number | string
  cod_categoria: string
  tipo_documento: string
  conta_corrente_padrao?: number | string | null
}

export type Execucao = {
  /** Autor da execução (auth.uid() de quem gravou). Sem autor = não lançável. */
  criado_por?: string | null
  linhas: LinhaRateio[] | null | undefined
  total_geral: number | string | null | undefined
  pendencias?: unknown
}

export type JaLancado = {
  status: string
  omie_codigo_lancamento?: number | string | null
  criado_em?: string | null
  atualizado_em?: string | null
  /** false = é outro lançamento (outra NF) ativo na mesma empresa e competência. Padrão: true. */
  mesma_chave?: boolean
}

export type LinhaLancamento = JaLancado & { chave_integracao: string; nf?: string | null; execucao_id?: string | null }

/** `enviando` há mais tempo que isto é um envio órfão (a função morreu no meio): vale como `incerto`. */
export const ENVIANDO_ORFAO_MS = 10 * 60 * 1000

/** Status efetivo: `enviando` com mais de 10 min (atualizado_em, senão criado_em) = `incerto`. */
export function statusEfetivo(l: { status: string; atualizado_em?: string | null; criado_em?: string | null }, agora?: number): string {
  if (l.status !== 'enviando' || agora === undefined) return l.status
  const t = Date.parse(String(l.atualizado_em ?? l.criado_em ?? ''))
  return Number.isFinite(t) && agora - t > ENVIANDO_ORFAO_MS ? 'incerto' : l.status
}

/** NF só com dígitos e letras, MAIÚSCULAS, sem zeros à esquerda ("00123" = "123"). */
export function nfNormalizada(nf: unknown): string {
  const limpa = String(nf ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  const sem = limpa.replace(/^0+/, '')
  return sem === '' && limpa !== '' ? '0' : sem
}

/**
 * Qual lançamento existente importa para esta chave. A chave é única, então o da mesma chave
 * (qualquer status) vem primeiro; senão, um lançamento ATIVO de outra NF na mesma empresa e
 * competência (o índice único parcial impediria um segundo).
 */
export function escolherLancamentoRelevante(linhas: LinhaLancamento[], chaveInt: string): JaLancado | null {
  const igual = linhas.find((l) => l.chave_integracao === chaveInt)
  if (igual) return { ...igual, mesma_chave: true }
  const outro = linhas.find((l) => ['enviando', 'lancado', 'incerto'].includes(String(l.status)))
  return outro ? { ...outro, mesma_chave: false } : null
}

export type Aviso = { tipo: string; mensagem: string; referencia?: string }
export type Bloqueio = Aviso

export type ItemDistribuicao = {
  cod_departamento: number
  nome: string | null
  unidades: string[]
  valor: number
  perc: number
}

export type Distribuicao = {
  itens: ItemDistribuicao[]
  total_rateio_centavos: number
  diferenca_centavos: number
  ajuste: { cod_departamento: number; centavos: number } | null
  bloqueios: Bloqueio[]
  avisos: Aviso[]
}

export type EntradaAnalise = {
  execucao_id?: string
  empresa: string
  nf: string
  valor_nf: number
  competencia: string // AAAA-MM
  emissao: string // AAAA-MM-DD
  vencimento?: string | null // AAAA-MM-DD; padrão: último dia do mês da emissão
  conta_corrente?: number | string | null
}

export type ContextoAnalise = {
  execucao: Execucao | null
  mapa: VinculoMapa[]
  config: ConfigEmpresa | null
  /** Códigos de departamentos ATIVOS no Omie. null = não consultado (não valida). */
  departamentosAtivos: Array<number | string> | null
  /** CNPJs (qualquer formato) devolvidos por ListarEmpresas. null = não consultado. */
  cnpjsOmie: string[] | null
  jaLancado: JaLancado | null
  /** Lançamentos ATIVOS da empresa (qualquer competência) e da execução, para NF_JA_LANCADA / EXECUCAO_JA_LANCADA. */
  lancamentosAtivos?: LinhaLancamento[]
  /** Usuário que está analisando; precisa ser o autor da execução. */
  usuarioId?: string | null
  /** Relógio injetado (ms), para o `enviando` órfão. Ausente = sem regra de órfão. */
  agora?: number
  /** Valor máximo por conta, em reais. null/ausente = CONFIG_AUSENTE (falha fechada). */
  teto: number | null
}

export type Analise = {
  empresa: Empresa
  conta_omie: ContaOmie
  chave: string
  ja_lancado: { status: string; omie_codigo_lancamento: number | null; criado_em: string | null } | null
  total_rateio: number
  valor_nf: number
  diferenca: number
  ajuste: { cod_departamento: number; centavos: number } | null
  distribuicao: ItemDistribuicao[]
  bloqueios: Bloqueio[]
  avisos: Aviso[]
  hash: string
  // Campos de apoio (não fazem parte do contrato de saída, usados pelo `lancar`):
  cabecalho: {
    nf: string
    competencia: string
    emissao: string
    vencimento: string
    conta_corrente: number | null
  }
}

/** Erro de entrada inválida (o handler devolve { ok:false, erro }). */
export class ErroEntrada extends Error {}

// ---------------------------------------------------------------------------
// Normalização de nomes (igual à chave() do motor do rateio)
// ---------------------------------------------------------------------------

const TRAVESSOES = ['‐', '‑', '‒', '–', '—', '―']

export function chave(nome: unknown): string {
  if (nome === null || nome === undefined) return ''
  let s = String(nome)
  for (const d of TRAVESSOES) s = s.split(d).join('-')
  s = s.split('�').join('')
  s = s.normalize('NFKD')
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const cc = s.charCodeAt(i)
    if (cc >= 768 && cc <= 879) continue
    out += s.charAt(i)
  }
  s = out.toUpperCase()
  return s.split(/\s+/).filter((x) => x).join(' ')
}

// ---------------------------------------------------------------------------
// Dinheiro e datas
// ---------------------------------------------------------------------------

/** Reais (number ou string) -> centavos inteiros. NaN/inválido -> NaN. */
export function paraCentavos(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n * 100 + (n < 0 ? -1e-9 : 1e-9))
}

export function centavosParaReais(c: number): number {
  return c / 100
}

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const RE_COMP = /^(\d{4})-(0[1-9]|1[0-2])$/

export function dataValida(iso: string): boolean {
  const m = RE_ISO.exec(String(iso ?? ''))
  if (!m) return false
  const [, a, me, d] = m
  const ano = Number(a)
  const mes = Number(me)
  const dia = Number(d)
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasNoMes(ano, mes)
}

export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

/** Último dia do mês da data ISO informada (AAAA-MM-DD ou AAAA-MM). */
export function ultimoDiaDoMes(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) throw new ErroEntrada(`data inválida: ${iso}`)
  const ano = Number(m[1])
  const mes = Number(m[2])
  if (mes < 1 || mes > 12) throw new ErroEntrada(`data inválida: ${iso}`)
  return `${m[1]}-${m[2]}-${String(diasNoMes(ano, mes)).padStart(2, '0')}`
}

/** AAAA-MM-DD -> DD/MM/AAAA (formato do Omie). */
export function dataBr(iso: string): string {
  const m = RE_ISO.exec(String(iso ?? ''))
  if (!m) throw new ErroEntrada(`data inválida: ${iso}`)
  return `${m[3]}/${m[2]}/${m[1]}`
}

/** AAAA-MM -> AAAA-MM-01 (a coluna `competencia` tem check de dia 1). */
export function competenciaParaData(competencia: string): string {
  if (!RE_COMP.test(String(competencia ?? ''))) throw new ErroEntrada(`competência inválida: ${competencia}`)
  return `${competencia}-01`
}

// ---------------------------------------------------------------------------
// Empresa e chave de integração
// ---------------------------------------------------------------------------

export function empresaValida(e: unknown): e is Empresa {
  return typeof e === 'string' && (EMPRESAS as readonly string[]).includes(e)
}

export function contaOmieDaEmpresa(e: Empresa): ContaOmie {
  return CONTA_DA_EMPRESA[e]
}

/** RATEIO-{P|PA|M|MA}-{AAAAMM}-{NF}. NF só com dígitos e letras, sem espaços. */
export function chaveIntegracao(empresa: string, competencia: string, nf: string): string {
  if (!empresaValida(empresa)) throw new ErroEntrada(`empresa inválida: ${empresa}`)
  const m = RE_COMP.exec(String(competencia ?? ''))
  if (!m) throw new ErroEntrada(`competência inválida: ${competencia}`)
  const nfLimpa = String(nf ?? '').replace(/[^0-9A-Za-z]/g, '')
  if (!nfLimpa) throw new ErroEntrada('NF vazia')
  return `RATEIO-${SUFIXO_CHAVE[empresa]}-${m[1]}${m[2]}-${nfLimpa}`
}

// ---------------------------------------------------------------------------
// Distribuição por departamento, em centavos
// ---------------------------------------------------------------------------

type Grupo = { cod: number; nome: string | null; unidades: string[]; centavos: number }

/** Maior departamento: maior valor; empate -> menor código (determinístico). */
function indiceDoMaior(grupos: Grupo[], valores: number[]): number {
  let idx = 0
  for (let i = 1; i < grupos.length; i++) {
    if (valores[i] > valores[idx] || (valores[i] === valores[idx] && grupos[i].cod < grupos[idx].cod)) idx = i
  }
  return idx
}

export function montarDistribuicao(args: {
  linhas: LinhaRateio[]
  mapa: VinculoMapa[]
  valorNfCentavos: number
}): Distribuicao {
  const { linhas, mapa, valorNfCentavos } = args
  const bloqueios: Bloqueio[] = []
  const avisos: Aviso[] = []

  const porChave = new Map<string, VinculoMapa>()
  for (const v of mapa) porChave.set(v.unidade_chave, v)

  const grupos = new Map<number, Grupo>()
  const avisadas = new Set<string>()
  const semDepto = new Set<string>()
  let totalCentavos = 0

  for (const l of linhas) {
    const nomeUnidade = String(l.unidade ?? '')
    const cent = paraCentavos(l.total)
    if (!Number.isFinite(cent)) {
      bloqueios.push({
        tipo: 'EXECUCAO_INCONSISTENTE',
        mensagem: `Linha sem total numérico: ${nomeUnidade}`,
        referencia: nomeUnidade,
      })
      continue
    }
    if (cent === 0) continue // unidade zerada não precisa de vínculo
    const k = chave(nomeUnidade)
    const v = porChave.get(k)
    if (!v) {
      if (!semDepto.has(k)) {
        semDepto.add(k)
        bloqueios.push({
          tipo: 'UNIDADE_SEM_DEPARTAMENTO',
          mensagem: `A unidade "${nomeUnidade}" tem valor mas não está vinculada a um departamento do Omie.`,
          referencia: nomeUnidade,
        })
      }
      continue
    }
    const cod = Number(v.cod_departamento)
    let g = grupos.get(cod)
    if (!g) {
      g = { cod, nome: v.departamento_nome ?? null, unidades: [], centavos: 0 }
      grupos.set(cod, g)
    }
    g.centavos += cent
    if (!g.unidades.includes(nomeUnidade)) g.unidades.push(nomeUnidade)
    totalCentavos += cent
    const conf = String(v.confianca ?? 'ALTA').toUpperCase()
    if ((conf === 'MEDIA' || conf === 'BAIXA') && !avisadas.has(k)) {
      avisadas.add(k)
      avisos.push({
        tipo: 'VINCULO_BAIXA_CONFIANCA',
        mensagem: `Vínculo da unidade "${nomeUnidade}" tem confiança ${conf}; confira o departamento.`,
        referencia: nomeUnidade,
      })
    }
  }

  const lista = [...grupos.values()].sort((a, b) => a.cod - b.cod)
  const valores = lista.map((g) => g.centavos)
  const diferenca = valorNfCentavos - totalCentavos
  let ajuste: Distribuicao['ajuste'] = null

  if (lista.length > 0 && diferenca !== 0 && Math.abs(diferenca) <= AJUSTE_MAX_CENTAVOS) {
    const i = indiceDoMaior(lista, valores)
    if (valores[i] + diferenca >= 0) {
      valores[i] += diferenca
      ajuste = { cod_departamento: lista[i].cod, centavos: diferenca }
      avisos.push({
        tipo: 'AJUSTE_CENTAVOS',
        mensagem: `Diferença de ${(diferenca / 100).toFixed(2)} entre a NF e o rateio somada ao maior departamento.`,
        referencia: String(lista[i].cod),
      })
    }
  }

  // Percentuais em centésimos de ponto percentual (inteiros): 100,00% = 10000.
  const somaValores = valores.reduce((a, b) => a + b, 0)
  const percs = valores.map((c) => (valorNfCentavos > 0 ? Math.round((c * 10000) / valorNfCentavos) : 0))
  if (lista.length > 0 && valorNfCentavos > 0 && somaValores === valorNfCentavos) {
    const sobra = 10000 - percs.reduce((a, b) => a + b, 0)
    if (sobra !== 0) percs[indiceDoMaior(lista, valores)] += sobra
  }

  const itens: ItemDistribuicao[] = lista.map((g, i) => ({
    cod_departamento: g.cod,
    nome: g.nome,
    unidades: g.unidades,
    valor: centavosParaReais(valores[i]),
    perc: percs[i] / 100,
  }))

  return {
    itens,
    total_rateio_centavos: totalCentavos,
    diferenca_centavos: diferenca,
    ajuste,
    bloqueios,
    avisos,
  }
}

// ---------------------------------------------------------------------------
// Análise completa (sem hash; o hash é calculado por hashAnalise)
// ---------------------------------------------------------------------------

const apenasDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

export function analisarNucleo(entrada: EntradaAnalise, ctx: ContextoAnalise): Omit<Analise, 'hash'> {
  if (!empresaValida(entrada.empresa)) throw new ErroEntrada(`empresa inválida: ${entrada.empresa}`)
  const empresa = entrada.empresa
  if (!RE_COMP.test(String(entrada.competencia ?? ''))) {
    throw new ErroEntrada(`competência inválida: ${entrada.competencia}`)
  }
  if (!dataValida(entrada.emissao)) throw new ErroEntrada(`emissão inválida: ${entrada.emissao}`)
  const vencimento = entrada.vencimento ? String(entrada.vencimento) : ultimoDiaDoMes(entrada.emissao)
  if (!dataValida(vencimento)) throw new ErroEntrada(`vencimento inválido: ${vencimento}`)

  const bloqueios: Bloqueio[] = []
  const avisos: Aviso[] = []

  const nfLimpa = String(entrada.nf ?? '').replace(/[^0-9A-Za-z]/g, '')
  const nfVazia = nfLimpa === ''
  if (nfVazia) {
    bloqueios.push({ tipo: 'NF_VAZIA', mensagem: 'Informe o número da NF.' })
  }
  const chaveInt = nfVazia ? '' : chaveIntegracao(empresa, entrada.competencia, entrada.nf)

  const valorNfCent = paraCentavos(entrada.valor_nf)
  const valorNfOk = Number.isFinite(valorNfCent) && valorNfCent > 0
  if (!valorNfOk) {
    bloqueios.push({ tipo: 'NF_DIVERGENTE', mensagem: 'O valor da NF deve ser maior que zero.' })
  }

  // --- configuração ---
  const cfg = ctx.config
  const contaCorrenteRaw = entrada.conta_corrente ?? cfg?.conta_corrente_padrao ?? null
  const contaCorrente =
    contaCorrenteRaw === null || contaCorrenteRaw === '' || !Number.isFinite(Number(contaCorrenteRaw))
      ? null
      : Number(contaCorrenteRaw)
  const faltaConfig: string[] = []
  if (!cfg) faltaConfig.push(`rateio_omie_config da empresa ${empresa}`)
  else {
    if (cfg.cod_fornecedor === null || cfg.cod_fornecedor === undefined || cfg.cod_fornecedor === '') faltaConfig.push('cod_fornecedor')
    if (!cfg.cod_categoria) faltaConfig.push('cod_categoria')
    if (!cfg.tipo_documento) faltaConfig.push('tipo_documento')
    if (!cfg.cnpj_esperado) faltaConfig.push('cnpj_esperado')
  }
  if (contaCorrente === null) faltaConfig.push('conta_corrente (tela ou conta_corrente_padrao)')
  if (ctx.teto === null || ctx.teto === undefined || !Number.isFinite(ctx.teto) || ctx.teto <= 0) {
    faltaConfig.push('RATEIO_OMIE_TETO')
  }
  if (faltaConfig.length) {
    bloqueios.push({ tipo: 'CONFIG_AUSENTE', mensagem: `Configuração ausente: ${faltaConfig.join(', ')}.` })
  }

  if (valorNfOk && ctx.teto !== null && ctx.teto !== undefined && Number.isFinite(ctx.teto) && ctx.teto > 0) {
    if (valorNfCent > Math.round(ctx.teto * 100)) {
      bloqueios.push({
        tipo: 'ACIMA_DO_TETO',
        mensagem: `Valor ${(valorNfCent / 100).toFixed(2)} acima do teto de ${ctx.teto.toFixed(2)} por conta.`,
      })
    }
  }

  // --- execução ---
  const exec = ctx.execucao
  const linhas = Array.isArray(exec?.linhas) ? (exec!.linhas as LinhaRateio[]) : []
  let dist: Distribuicao = {
    itens: [],
    total_rateio_centavos: 0,
    diferenca_centavos: 0,
    ajuste: null,
    bloqueios: [],
    avisos: [],
  }
  if (linhas.length === 0) {
    bloqueios.push({
      tipo: 'EXECUCAO_SEM_LINHAS',
      mensagem: 'A execução não tem linhas por unidade (execução antiga ou não gravada); não dá para lançar.',
    })
  } else {
    const somaLinhas = linhas.reduce((a, l) => {
      const c = paraCentavos(l.total)
      return a + (Number.isFinite(c) ? c : 0)
    }, 0)
    const totalGeral = paraCentavos(exec?.total_geral)
    if (!Number.isFinite(totalGeral) || Math.abs(somaLinhas - totalGeral) > 1) {
      bloqueios.push({
        tipo: 'EXECUCAO_INCONSISTENTE',
        mensagem: `A soma das linhas (${(somaLinhas / 100).toFixed(2)}) difere do total geral da execução (${
          Number.isFinite(totalGeral) ? (totalGeral / 100).toFixed(2) : 'ausente'
        }).`,
      })
    }
    dist = montarDistribuicao({
      linhas,
      mapa: ctx.mapa,
      valorNfCentavos: valorNfOk ? valorNfCent : 0,
    })
    bloqueios.push(...dist.bloqueios)
    avisos.push(...dist.avisos)
    if (valorNfOk && Math.abs(dist.diferenca_centavos) > AJUSTE_MAX_CENTAVOS) {
      bloqueios.push({
        tipo: 'NF_DIVERGENTE',
        mensagem: `A NF (${(valorNfCent / 100).toFixed(2)}) difere do rateio (${(
          dist.total_rateio_centavos / 100
        ).toFixed(2)}) em mais de R$ 1,00.`,
      })
    } else if (valorNfOk && dist.diferenca_centavos !== 0 && dist.ajuste === null && dist.itens.length > 0) {
      bloqueios.push({
        tipo: 'NF_DIVERGENTE',
        mensagem: 'O ajuste de centavos deixaria um departamento negativo.',
      })
    }
    if (valorNfOk && dist.itens.length === 0 && !dist.bloqueios.length) {
      bloqueios.push({ tipo: 'NF_DIVERGENTE', mensagem: 'Nenhuma unidade com valor para ratear.' })
    }
  }
  if (exec?.pendencias) {
    const p = exec.pendencias
    const tem = Array.isArray(p) ? p.length > 0 : typeof p === 'number' ? p > 0 : Boolean(p)
    if (tem) {
      avisos.push({ tipo: 'EXECUCAO_COM_PENDENCIAS', mensagem: 'A execução do rateio tem pendências registradas.' })
    }
  }

  // --- valores por departamento ---
  for (const it of dist.itens) {
    if (!(it.valor > 0) || !(it.perc > 0)) {
      bloqueios.push({
        tipo: 'DEPARTAMENTO_VALOR_INVALIDO',
        mensagem: `O departamento ${it.cod_departamento}${it.nome ? ` (${it.nome})` : ''} ficaria com valor ${it.valor.toFixed(2)} e ${it.perc.toFixed(
          2,
        )}%; o Omie exige valor e percentual maiores que zero.`,
        referencia: String(it.cod_departamento),
      })
    }
  }

  // --- autor da execução ---
  if (!exec?.criado_por || !ctx.usuarioId || exec.criado_por !== ctx.usuarioId) {
    bloqueios.push({
      tipo: 'EXECUCAO_DE_OUTRO_USUARIO',
      mensagem: exec?.criado_por
        ? 'Esta execução foi gerada por outro usuário; só o autor pode lançá-la.'
        : 'Esta execução não tem autor registrado (execução antiga); não pode ser lançada.',
    })
  }

  // --- mesma NF ou mesma execução já lançada (qualquer competência) ---
  if (ctx.lancamentosAtivos && chaveInt) {
    const nfAtual = nfNormalizada(entrada.nf)
    const ativos = ctx.lancamentosAtivos.filter(
      (l) => l.chave_integracao !== chaveInt && ['enviando', 'lancado', 'incerto'].includes(String(l.status)),
    )
    const porNf = ativos.find((l) => l.nf !== undefined && l.nf !== null && nfNormalizada(l.nf) === nfAtual)
    if (porNf) {
      bloqueios.push({
        tipo: 'NF_JA_LANCADA',
        mensagem: `A NF ${entrada.nf} já tem lançamento ativo (${statusEfetivo(porNf, ctx.agora)}) desta empresa em outra competência ou chave.`,
        referencia: porNf.chave_integracao,
      })
    }
    const porExec = ativos.find((l) => l.execucao_id && l.execucao_id === entrada.execucao_id)
    if (porExec) {
      bloqueios.push({
        tipo: 'EXECUCAO_JA_LANCADA',
        mensagem: `Esta execução já tem lançamento ativo (${statusEfetivo(porExec, ctx.agora)}) com outra chave.`,
        referencia: porExec.chave_integracao,
      })
    }
  }

  // --- departamentos no Omie ---
  if (ctx.departamentosAtivos) {
    const ativos = new Set(ctx.departamentosAtivos.map((c) => String(c)))
    for (const it of dist.itens) {
      if (!ativos.has(String(it.cod_departamento))) {
        bloqueios.push({
          tipo: 'DEPARTAMENTO_INEXISTENTE',
          mensagem: `O departamento ${it.cod_departamento}${it.nome ? ` (${it.nome})` : ''} não está ativo no Omie.`,
          referencia: String(it.cod_departamento),
        })
      }
    }
  }

  // --- CNPJ da conta ---
  if (ctx.cnpjsOmie && cfg?.cnpj_esperado) {
    const esperado = apenasDigitos(cfg.cnpj_esperado)
    const achou = ctx.cnpjsOmie.some((c) => apenasDigitos(c) === esperado)
    if (!achou) {
      bloqueios.push({
        tipo: 'CREDENCIAL_EMPRESA_ERRADA',
        mensagem: `A conta Omie consultada não tem o CNPJ esperado para ${empresa}. Credencial possivelmente trocada.`,
      })
    }
  }

  // --- lançamento anterior da mesma chave (CONTRATO: tabela "Lançamento anterior") ---
  const ant = ctx.jaLancado
  if (ant) {
    const st = statusEfetivo(ant, ctx.agora)
    const mesma = ant.mesma_chave !== false
    if (st === 'lancado' || (!mesma && st === 'incerto')) {
      bloqueios.push({
        tipo: 'JA_LANCADO',
        mensagem: mesma
          ? 'Esta NF já foi lançada no Omie.'
          : `Já existe um lançamento (${st}) desta empresa nesta competência, com outra NF.`,
      })
    } else if (st === 'enviando') {
      bloqueios.push({
        tipo: 'LANCAMENTO_EM_ANDAMENTO',
        mensagem: 'Há um lançamento em andamento para esta NF; aguarde o término.',
      })
    } else if (st === 'incerto') {
      avisos.push({
        tipo: 'LANCAMENTO_INCERTO',
        mensagem: 'A tentativa anterior terminou incerta; o envio vai consultar o Omie pela chave antes de qualquer inclusão.',
      })
    } else if (st === 'erro') {
      avisos.push({ tipo: 'TENTATIVA_ANTERIOR_COM_ERRO', mensagem: 'A tentativa anterior terminou em erro; será refeita.' })
    }
  }

  const totalRateio = centavosParaReais(dist.total_rateio_centavos)
  return {
    empresa,
    conta_omie: contaOmieDaEmpresa(empresa),
    chave: chaveInt,
    ja_lancado: ctx.jaLancado && ctx.jaLancado.status !== 'excluido'
      ? {
          status: statusEfetivo(ctx.jaLancado, ctx.agora),
          omie_codigo_lancamento:
            ctx.jaLancado.omie_codigo_lancamento === null || ctx.jaLancado.omie_codigo_lancamento === undefined
              ? null
              : Number(ctx.jaLancado.omie_codigo_lancamento),
          criado_em: ctx.jaLancado.criado_em ?? null,
        }
      : null,
    total_rateio: totalRateio,
    valor_nf: valorNfOk ? centavosParaReais(valorNfCent) : Number(entrada.valor_nf),
    diferenca: centavosParaReais(dist.diferenca_centavos),
    ajuste: dist.ajuste,
    distribuicao: dist.itens,
    bloqueios,
    avisos,
    cabecalho: {
      nf: nfLimpa,
      competencia: entrada.competencia,
      emissao: entrada.emissao,
      vencimento,
      conta_corrente: contaCorrente,
    },
  }
}

// ---------------------------------------------------------------------------
// Hash estável
// ---------------------------------------------------------------------------

/** JSON com chaves ordenadas, para o hash não depender da ordem de inserção. */
export function jsonEstavel(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(jsonEstavel).join(',')}]`
  const o = v as Record<string, unknown>
  const ks = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
  return `{${ks.map((k) => `${JSON.stringify(k)}:${jsonEstavel(o[k])}`).join(',')}}`
}

export type Sha256 = (texto: string) => string | Promise<string>

/** SHA-256 (hex, via função injetada) da distribuição + cabeçalho, em centavos. */
export async function hashAnalise(
  a: Omit<Analise, 'hash'>,
  sha256: Sha256,
  config?: Pick<ConfigEmpresa, 'cod_fornecedor' | 'cod_categoria' | 'tipo_documento'> | null,
): Promise<string> {
  const base = {
    config: config
      ? { cod_fornecedor: String(config.cod_fornecedor), cod_categoria: config.cod_categoria, tipo_documento: config.tipo_documento }
      : null,
    empresa: a.empresa,
    chave: a.chave,
    valor_nf_centavos: paraCentavos(a.valor_nf),
    cabecalho: a.cabecalho,
    distribuicao: a.distribuicao.map((d) => ({
      cod: d.cod_departamento,
      centavos: paraCentavos(d.valor),
      perc_centesimos: Math.round(d.perc * 100),
    })),
    ajuste: a.ajuste,
  }
  return await sha256(jsonEstavel(base))
}

// ---------------------------------------------------------------------------
// Payload do IncluirContaPagar
// ---------------------------------------------------------------------------

export type PayloadIncluir = {
  codigo_lancamento_integracao: string
  codigo_cliente_fornecedor: number
  codigo_categoria: string
  codigo_tipo_documento: string
  id_conta_corrente: number
  data_emissao: string
  data_entrada: string
  data_vencimento: string
  data_previsao: string
  valor_documento: number
  numero_documento_fiscal: string
  numero_parcela: string
  observacao: string
  distribuicao: Array<{ cCodDep: string; nValDep: number; nPerDep: number }>
}

export function montarPayloadIncluir(a: Omit<Analise, 'hash'>, config: ConfigEmpresa): PayloadIncluir {
  const { cabecalho } = a
  if (cabecalho.conta_corrente === null) throw new ErroEntrada('conta corrente ausente')
  const [ano, mes] = cabecalho.competencia.split('-')
  return {
    codigo_lancamento_integracao: a.chave,
    codigo_cliente_fornecedor: Number(config.cod_fornecedor),
    codigo_categoria: config.cod_categoria,
    codigo_tipo_documento: config.tipo_documento,
    id_conta_corrente: cabecalho.conta_corrente,
    data_emissao: dataBr(cabecalho.emissao),
    data_entrada: dataBr(cabecalho.emissao),
    data_vencimento: dataBr(cabecalho.vencimento),
    data_previsao: dataBr(cabecalho.vencimento),
    valor_documento: a.valor_nf,
    numero_documento_fiscal: cabecalho.nf,
    numero_parcela: '001/001',
    observacao: `Rateio Mobilemed ${a.empresa} competencia ${mes}/${ano} - gerado pelo Central-Whatsapp`,
    distribuicao: a.distribuicao.map((d) => ({
      // cCodDep como texto: é como o Omie declara o campo e como o worker já lança.
      cCodDep: String(d.cod_departamento),
      nValDep: d.valor,
      nPerDep: d.perc,
    })),
  }
}
