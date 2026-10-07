// Geração do Excel consolidado de uma simulação (ExcelJS, roda no navegador).
// Recebe o agregado pronto (consolidado.ts) — aqui só há apresentação: abas, estilos e formatos.
// Nenhuma aba contém nome de paciente.
import type { Agregado } from './consolidado'
import { ORDEM_GRUPOS, TIPO_PENDENCIA } from './consolidado'
import { MODELO, SITUACAO } from './format'
import type { InstrucaoNF } from './tipos'

export interface MetaConsolidado {
  competencia: string                      // 'AAAA-MM' ou 'AAAA-MM-DD'
  arquivoNome: string | null
  geradoEm: Date
  config: Record<string, string>           // tabela config (chave → valor)
  ignorados: { nome_bruto: string; motivo: string }[]
  instrucoesNF?: Map<string, InstrucaoNF[]> // unidade_id → instruções de emissão de NF (aba "Agenda de NF")
}

// ── paleta e formatos ────────────────────────────────────────────────────────
const AZUL = 'FF1F4E78', CINZA = 'FFF2F4F7', VERDE = 'FFE3F4EA', VERMELHO = 'FFFDE8E6', AMBAR = 'FFFFF4D6'
const CINZA_TOTAL = 'FFE4E9F0', BRANCO = 'FFFFFFFF', TEXTO_CINZA = 'FF667085', BORDA = 'FFD0D5DD'
const FONTE = 'Calibri'
const FMT = { moeda: '"R$" #,##0.00', inteiro: '#,##0', pct: '0.0%' } as const
type Fmt = keyof typeof FMT
type Cor = 'ok' | 'erro' | 'atencao'
const COR: Record<Cor, string> = { ok: VERDE, erro: VERMELHO, atencao: AMBAR }

type Valor = string | number | null | { formula: string; result: number }
interface Coluna { titulo: string; largura: number; fmt?: Fmt; alinhar?: 'left' | 'center' | 'right'; quebrar?: boolean }
type CelulaTotal = 'soma' | string | number | null

/* eslint-disable @typescript-eslint/no-explicit-any */
type Planilha = any

const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
const fina = { style: 'thin' as const, color: { argb: BORDA } }
const BORDAS = { top: fina, left: fina, bottom: fina, right: fina }

function dataHoraBR(d: Date): string {
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
function mmaaaa(competencia: string): string {
  const [a, m] = competencia.split('-')
  return `${m}/${a}`
}
function corSituacao(s: string): Cor {
  if (s === 'vigente') return 'ok'
  if (s === 'vencido' || s === 'encerrado') return 'erro'
  return 'atencao'
}
function corTipoPendencia(t: string): Cor {
  return t === 'situacao' || t === 'franquia' ? 'atencao' : 'erro'
}
/** Altura estimada de uma linha com texto quebrado (ExcelJS não calcula sozinho). */
function alturaTexto(texto: string, largura: number): number {
  const linhas = Math.max(1, Math.ceil(texto.length / Math.max(8, largura * 1.05)))
  return Math.max(15, linhas * 13.5 + 2)
}

function titulo(ws: Planilha, texto: string, sub: string, col = 1) {
  const t = ws.getCell(1, col)
  t.value = texto; t.font = { name: FONTE, size: 16, bold: true, color: { argb: AZUL } }
  ws.getRow(1).height = 26
  const s = ws.getCell(2, col)
  s.value = sub; s.font = { name: FONTE, size: 10, italic: true, color: { argb: TEXTO_CINZA } }
}

function secao(ws: Planilha, linha: number, col: number, ncols: number, texto: string) {
  for (let c = col; c < col + ncols; c++) {
    ws.getCell(linha, c).border = { bottom: { style: 'medium', color: { argb: AZUL } } }
  }
  const x = ws.getCell(linha, col)
  x.value = texto; x.font = { name: FONTE, size: 12, bold: true, color: { argb: AZUL } }
  ws.getRow(linha).height = 20
}

function cabecalho(ws: Planilha, linha: number, colIni: number, colunas: Coluna[]) {
  colunas.forEach((c, i) => {
    const x = ws.getCell(linha, colIni + i)
    x.value = c.titulo
    x.font = { name: FONTE, size: 10, bold: true, color: { argb: BRANCO } }
    x.fill = fill(AZUL); x.border = BORDAS
    x.alignment = { vertical: 'middle', horizontal: c.alinhar ?? (c.fmt ? 'right' : 'left'), wrapText: true }
  })
  ws.getRow(linha).height = 30
}

interface OpcoesTabela {
  total?: CelulaTotal[]                                  // linha de TOTAL ('soma' vira SUBTOTAL(109,…))
  cor?: (l: number, c: number, valor: Valor) => Cor | undefined
  autofiltro?: boolean
  destaque?: (l: number) => boolean                      // linha de subtotal (negrito, fundo cinza)
}

/** Escreve cabeçalho + linhas (+ total). Devolve a primeira/última linha de dados e a linha do total. */
function tabela(ws: Planilha, linhaCab: number, colIni: number, colunas: Coluna[], linhas: Valor[][], op: OpcoesTabela = {}) {
  colunas.forEach((c, i) => { ws.getColumn(colIni + i).width = c.largura })
  cabecalho(ws, linhaCab, colIni, colunas)
  const primeira = linhaCab + 1
  linhas.forEach((l, i) => {
    const r = primeira + i
    let altura = 15
    colunas.forEach((c, j) => {
      const x = ws.getCell(r, colIni + j)
      const v = l[j]
      x.value = v
      x.font = { name: FONTE, size: 10 }
      x.border = BORDAS
      const sub = op.destaque?.(i)
      const cor = sub ? undefined : op.cor?.(i, j, v)
      x.fill = fill(sub ? CINZA_TOTAL : cor ? COR[cor] : i % 2 === 1 ? CINZA : BRANCO)
      if (sub) { x.font = { name: FONTE, size: 10, bold: true, color: { argb: AZUL } }; x.border = { ...BORDAS, top: { style: 'thin', color: { argb: AZUL } } } }
      x.alignment = { vertical: 'top', horizontal: c.alinhar ?? (c.fmt ? 'right' : 'left'), wrapText: !!c.quebrar }
      if (c.fmt) x.numFmt = FMT[c.fmt]
      if (c.quebrar && typeof v === 'string') altura = Math.max(altura, alturaTexto(v, c.largura))
    })
    if (altura > 15) ws.getRow(r).height = altura
  })
  const ultima = primeira + linhas.length - 1
  let linhaTotal: number | undefined
  if (op.total) {
    linhaTotal = ultima + 1
    colunas.forEach((c, j) => {
      const x = ws.getCell(linhaTotal!, colIni + j)
      const t = op.total![j]
      if (t === 'soma') {
        const letra = ws.getColumn(colIni + j).letter
        const soma = linhas.reduce((s, l) => s + (typeof l[j] === 'number' ? (l[j] as number) : 0), 0)
        x.value = linhas.length ? { formula: `SUBTOTAL(109,${letra}${primeira}:${letra}${ultima})`, result: Math.round(soma * 1e6) / 1e6 } : 0
      } else x.value = t
      x.font = { name: FONTE, size: 10, bold: true }
      x.fill = fill(CINZA_TOTAL)
      x.border = { top: { style: 'double', color: { argb: AZUL } }, left: fina, right: fina, bottom: fina }
      x.alignment = { vertical: 'middle', horizontal: c.alinhar ?? (c.fmt ? 'right' : 'left') }
      if (c.fmt) x.numFmt = FMT[c.fmt]
    })
  }
  if (op.autofiltro && linhas.length) {
    ws.autoFilter = { from: { row: linhaCab, column: colIni }, to: { row: ultima, column: colIni + colunas.length - 1 } }
  }
  return { primeira, ultima, linhaTotal }
}

/** Intercala uma linha de subtotal (fórmula SUBTOTAL) depois de cada grupo. O TOTAL geral com SUBTOTAL(109) ignora essas linhas. */
function comSubtotais<T>(itens: T[], grupoDe: (t: T) => string, linha: (t: T) => Valor[], primeira: number, colIni: number,
  ncols: number, colsSoma: number[], colRotulo: number, letra: (c: number) => string) {
  const linhas: Valor[][] = []
  const origem: (T | null)[] = []
  let i = 0
  while (i < itens.length) {
    const g = grupoDe(itens[i])
    const ini = primeira + linhas.length
    const doGrupo: Valor[][] = []
    while (i < itens.length && grupoDe(itens[i]) === g) { const l = linha(itens[i]); doGrupo.push(l); linhas.push(l); origem.push(itens[i]); i++ }
    const fim = primeira + linhas.length - 1
    const sub: Valor[] = Array(ncols).fill(null)
    sub[colRotulo] = `Subtotal ${g || 'sem grupo'}`
    for (const c of colsSoma) {
      const soma = doGrupo.reduce((s, l) => s + (typeof l[c] === 'number' ? (l[c] as number) : 0), 0)
      sub[c] = { formula: `SUBTOTAL(109,${letra(colIni + c)}${ini}:${letra(colIni + c)}${fim})`, result: Math.round(soma * 1e6) / 1e6 }
    }
    linhas.push(sub); origem.push(null)
  }
  return { linhas, origem }
}

function barras(ws: Planilha, ref: string, argb: string) {
  ws.addConditionalFormatting({
    ref,
    rules: [{ type: 'dataBar', priority: 1, gradient: false, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb } } as any],
  })
}

function configurarPagina(ws: Planilha, congelarLinhas = 0, congelarColunas = 0, grade = true) {
  ws.views = [{
    showGridLines: grade,
    ...(congelarLinhas || congelarColunas ? { state: 'frozen', ySplit: congelarLinhas, xSplit: congelarColunas } : {}),
  }]
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
}

const rotuloModelo = (m: string) => MODELO[m] ?? m
const rotuloSituacao = (s: string) => SITUACAO[s]?.rotulo ?? s
const rotuloTipo = (t: string) => TIPO_PENDENCIA[t] ?? t
const empresaBonita = (e: string | null) => e === 'MEDIMAGEM' ? 'Medimagem' : e ?? '—'

// ── geração ──────────────────────────────────────────────────────────────────
export async function gerarConsolidado(agg: Agregado, meta: MetaConsolidado): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Faturamento por Unidade'; wb.created = meta.geradoEm
  const comp = mmaaaa(meta.competencia)
  const subBase = `Competência ${comp} · Relatório das unidades (teste) · gerado em ${dataHoraBR(meta.geradoEm)}`
  const k = agg.kpis

  // 1) Painel ────────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Painel', { properties: { tabColor: { argb: AZUL } } })
    configurarPagina(ws, 0, 0, false)
    ws.getColumn(1).width = 2
    for (let c = 2; c <= 7; c++) ws.getColumn(c).width = 26
    titulo(ws, `Faturamento por Unidade — Relatório ${comp}`, `Arquivo: ${meta.arquivoNome ?? '—'} · Gerado em ${dataHoraBR(meta.geradoEm)} · Versão: teste`, 2)

    // cartões de KPI
    const cartoes: { rotulo: string; valor: number; fmt: Fmt; cor?: Cor }[] = [
      { rotulo: 'Total faturado', valor: k.total, fmt: 'moeda' },
      { rotulo: 'Exames', valor: k.exames, fmt: 'inteiro' },
      { rotulo: 'Ticket médio por exame', valor: k.ticketMedio, fmt: 'moeda' },
      { rotulo: 'Unidades faturadas', valor: k.unidadesFaturadas, fmt: 'inteiro' },
      { rotulo: 'Valor fixo mensal', valor: k.totalFixo, fmt: 'moeda' },
      { rotulo: 'Pendências', valor: agg.pendencias.length, fmt: 'inteiro', cor: agg.pendencias.length ? 'erro' : 'ok' },
    ]
    ws.getRow(4).height = 38; ws.getRow(5).height = 20
    cartoes.forEach((c, i) => {
      const bg = fill(c.cor ? COR[c.cor] : CINZA)
      const borda = { top: { style: 'medium' as const, color: { argb: AZUL } }, left: fina, right: fina, bottom: fina }
      const v = ws.getCell(4, 2 + i)
      v.value = c.valor; v.numFmt = FMT[c.fmt]; v.fill = bg; v.border = borda
      v.font = { name: FONTE, size: 18, bold: true, color: { argb: AZUL } }
      v.alignment = { horizontal: 'center', vertical: 'middle' }
      const r = ws.getCell(5, 2 + i)
      r.value = c.rotulo; r.fill = bg; r.border = { left: fina, right: fina, bottom: fina }
      r.font = { name: FONTE, size: 10, color: { argb: TEXTO_CINZA } }
      r.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    // PRN × Medimagem
    let linha = 7
    secao(ws, linha, 2, 6, 'PRN × Medimagem')
    const emp = (['PRN', 'MEDIMAGEM'] as const).map(e => [empresaBonita(e), k.porEmpresa[e].total, k.porEmpresa[e].exames, k.porEmpresa[e].unidades, k.total ? k.porEmpresa[e].total / k.total : 0] as Valor[])
    const t1 = tabela(ws, linha + 1, 2, [
      { titulo: 'Empresa', largura: 26 }, { titulo: 'Total', largura: 26, fmt: 'moeda' }, { titulo: 'Exames', largura: 26, fmt: 'inteiro' },
      { titulo: 'Unidades faturadas', largura: 26, fmt: 'inteiro' }, { titulo: '% do total', largura: 26, fmt: 'pct' },
    ], emp, { total: ['Total', 'soma', 'soma', 'soma', 'soma'] })
    linha = (t1.linhaTotal ?? t1.ultima) + 2

    // Por grupo da Mobilemed
    if (agg.porGrupo.some(g => g.grupo)) {
      secao(ws, linha, 2, 6, 'Por grupo da Mobilemed')
      const tg = tabela(ws, linha + 1, 2, [
        { titulo: 'Grupo', largura: 26 }, { titulo: 'Unidades', largura: 26, fmt: 'inteiro' }, { titulo: 'Exames', largura: 26, fmt: 'inteiro' },
        { titulo: 'Valor fixo', largura: 26, fmt: 'moeda' }, { titulo: 'Total', largura: 26, fmt: 'moeda' }, { titulo: '% do total', largura: 26, fmt: 'pct' },
      ], agg.porGrupo.map(g => [g.grupo || 'sem grupo', g.unidades, g.exames, g.valorFixo, g.total, g.pctTotal] as Valor[]),
      { total: ['Total', null, 'soma', 'soma', 'soma', 'soma'] })
      barras(ws, `F${tg.primeira}:F${tg.ultima}`, 'FF5B9BD5')
      linha = (tg.linhaTotal ?? tg.ultima) + 2
    }

    // Top 10 unidades
    secao(ws, linha, 2, 6, 'Top 10 unidades por valor')
    const top = agg.porUnidade.slice(0, 10)
    const t2 = tabela(ws, linha + 1, 2, [
      { titulo: 'Unidade (pasta)', largura: 26, quebrar: true }, { titulo: 'Grupo Mobilemed', largura: 26, quebrar: true }, { titulo: 'Empresa', largura: 26 },
      { titulo: 'Exames', largura: 26, fmt: 'inteiro' }, { titulo: 'Total', largura: 26, fmt: 'moeda' }, { titulo: '% do total', largura: 26, fmt: 'pct' },
    ], top.map(u => [u.pasta, u.grupoMobilemed || u.grupo, empresaBonita(u.empresa), u.exames, u.total, u.pctTotal] as Valor[]))
    if (top.length) barras(ws, `G${t2.primeira}:G${t2.ultima}`, 'FF5B9BD5')
    linha = t2.ultima + 2

    // Por modalidade
    secao(ws, linha, 2, 6, 'Por modalidade')
    const mods = agg.porModalidade
    const t3 = tabela(ws, linha + 1, 2, [
      { titulo: 'Modalidade', largura: 26 }, { titulo: 'Quantidade', largura: 26, fmt: 'inteiro' }, { titulo: 'Total', largura: 26, fmt: 'moeda' },
      { titulo: 'Ticket médio', largura: 26, fmt: 'moeda' }, { titulo: '% do total', largura: 26, fmt: 'pct' },
    ], mods.map(m => [m.fixo ? 'Valor fixo mensal' : m.modalidade, m.quantidade, m.total, m.ticket, m.pctTotal] as Valor[]),
    { total: ['Total', 'soma', 'soma', k.exames ? k.totalPorExame / k.exames : null, 'soma'] })
    if (mods.length) barras(ws, `F${t3.primeira}:F${t3.ultima}`, 'FF5B9BD5')
    linha = (t3.linhaTotal ?? t3.ultima) + 2

    // Pendências por tipo
    secao(ws, linha, 2, 6, 'Pendências por tipo')
    if (k.pendenciasPorTipo.length) {
      tabela(ws, linha + 1, 2, [
        { titulo: 'Tipo', largura: 26, quebrar: true }, { titulo: 'Ocorrências', largura: 26, fmt: 'inteiro' }, { titulo: 'Exames afetados', largura: 26, fmt: 'inteiro' },
      ], k.pendenciasPorTipo.map(p => [rotuloTipo(p.tipo), p.quantidade, p.exames] as Valor[]),
      { cor: (l, c) => (c === 0 ? corTipoPendencia(k.pendenciasPorTipo[l].tipo) : undefined) })
    } else {
      const x = ws.getCell(linha + 1, 2)
      x.value = 'Nenhuma pendência neste relatório.'; x.font = { name: FONTE, size: 10, bold: true }; x.fill = fill(VERDE)
    }
  }

  // 2) Por unidade ───────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Por unidade', { properties: { tabColor: { argb: 'FF2E75B6' } } })
    titulo(ws, 'Faturamento por unidade', `${subBase} · uma linha por unidade em cada grupo da Mobilemed (igual aos relatórios por unidade) · ordenado por valor`)
    configurarPagina(ws, 4, 3)
    const porGrupo = agg.porUnidade.some(u => u.grupoMobilemed)
    const { linhas, origem } = comSubtotais(agg.porUnidade, u => porGrupo ? u.grupoMobilemed : '', u => [
      empresaBonita(u.empresa), u.grupoMobilemed || u.grupo, u.pasta, rotuloModelo(u.modelo), rotuloSituacao(u.situacao),
      u.exames, u.valorExames, u.valorFixo, u.total, u.pctTotal, u.nPendencias, u.nomes.join(' · '),
    ] as Valor[], 5, 1, 12, [5, 6, 7, 8, 9, 10], 2, c => ws.getColumn(c).letter)
    const linhasFinais = porGrupo ? linhas : linhas.filter((_, i) => origem[i])
    const origemFinal = porGrupo ? origem : origem.filter(o => o)
    const t = tabela(ws, 4, 1, [
      { titulo: 'Empresa', largura: 13 }, { titulo: 'Grupo Mobilemed', largura: 22, quebrar: true }, { titulo: 'Unidade (pasta)', largura: 36, quebrar: true },
      { titulo: 'Modelo de cobrança', largura: 17 }, { titulo: 'Situação', largura: 13, alinhar: 'center' },
      { titulo: 'Exames', largura: 10, fmt: 'inteiro' }, { titulo: 'Valor por exame', largura: 17, fmt: 'moeda' }, { titulo: 'Valor fixo', largura: 15, fmt: 'moeda' },
      { titulo: 'Total', largura: 17, fmt: 'moeda' }, { titulo: '% do total', largura: 10, fmt: 'pct' }, { titulo: 'Pendências', largura: 11, fmt: 'inteiro' },
      { titulo: 'Nomes no Bruto', largura: 55, quebrar: true },
    ], linhasFinais, {
      total: ['TOTAL', null, null, null, null, 'soma', 'soma', 'soma', 'soma', 'soma', 'soma', null],
      autofiltro: true,
      destaque: l => !origemFinal[l],
      cor: (l, c) => { const u = origemFinal[l]; return !u ? undefined : c === 4 ? corSituacao(u.situacao) : c === 10 && u.nPendencias > 0 ? 'atencao' : undefined },
    })
    if (!porGrupo && linhasFinais.length) barras(ws, `I${t.primeira}:I${t.ultima}`, 'FF9DC3E6')
  }

  // 2b) Agenda de NF — uma linha por unidade de contrato (somando os grupos), com o que o
  // financeiro precisa para emitir a nota (planilhas de 14 - POP FINANCEIRO). Sem paciente.
  if (meta.instrucoesNF) {
    const ws = wb.addWorksheet('Agenda de NF', { properties: { tabColor: { argb: 'FF548235' } } })
    titulo(ws, 'Agenda de emissão das notas fiscais', `${subBase} · prazos, envio e documentos pelas instruções do financeiro · ordenado por prazo`)
    configurarPagina(ws, 4, 2)
    const porUnidade = new Map<string, { empresa: string; pasta: string; total: number; grupos: Set<string> }>()
    for (const u of agg.porUnidade) {
      const x = porUnidade.get(u.unidadeId) ?? { empresa: u.empresa, pasta: u.pasta, total: 0, grupos: new Set<string>() }
      x.total = Math.round((x.total + u.total) * 100) / 100
      if (u.grupoMobilemed) x.grupos.add(u.grupoMobilemed)
      porUnidade.set(u.unidadeId, x)
    }
    const juntar = (is: InstrucaoNF[], f: (i: InstrucaoNF) => string | null | undefined) =>
      [...new Set(is.map(f).filter((v): v is string => !!v && !!v.trim()))].join('\n') || null
    const linhas = [...porUnidade.entries()].map(([id, u]) => {
      const is = meta.instrucoesNF!.get(id) ?? []
      return {
        sem: !is.length,
        prazo: juntar(is, i => i.prazo_nf) ?? '',
        valores: [
          empresaBonita(u.empresa), u.pasta, [...u.grupos].sort((a, b) => ORDEM_GRUPOS.indexOf(a) - ORDEM_GRUPOS.indexOf(b)).join(' · '), u.total,
          is.length ? juntar(is, i => i.prazo_nf) : 'sem instrução cadastrada',
          juntar(is, i => i.prazo_relatorio),
          juntar(is, i => [...(i.envio_emails ?? []), i.envio_portal ? `Portal: ${i.envio_portal}` : ''].filter(Boolean).join('\n')),
          juntar(is, i => (i.documentos ?? []).join('\n')),
          juntar(is, i => i.notas_separadas_por), juntar(is, i => i.retencoes), juntar(is, i => i.responsavel),
        ] as Valor[],
      }
    }).sort((a, b) => Number(a.sem) - Number(b.sem) || a.prazo.localeCompare(b.prazo) || String(a.valores[1]).localeCompare(String(b.valores[1])))
    tabela(ws, 4, 1, [
      { titulo: 'Empresa', largura: 12 }, { titulo: 'Unidade (pasta)', largura: 32, quebrar: true }, { titulo: 'Grupos Mobilemed', largura: 22, quebrar: true },
      { titulo: 'Total a faturar', largura: 16, fmt: 'moeda' }, { titulo: 'Prazo da nota', largura: 26, quebrar: true },
      { titulo: 'Prazo do relatório', largura: 22, quebrar: true }, { titulo: 'Enviar para', largura: 38, quebrar: true },
      { titulo: 'Documentos', largura: 34, quebrar: true }, { titulo: 'Notas separadas por', largura: 20, quebrar: true },
      { titulo: 'Retenções', largura: 22, quebrar: true }, { titulo: 'Responsável', largura: 16, quebrar: true },
    ], linhas.map(l => l.valores), {
      total: ['TOTAL', null, null, 'soma', null, null, null, null, null, null, null],
      autofiltro: true,
      cor: (l, c) => linhas[l].sem && c === 4 ? 'atencao' : undefined,
    })
  }

  // 3) Por modalidade ────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Por modalidade', { properties: { tabColor: { argb: 'FF2E75B6' } } })
    titulo(ws, 'Faturamento por modalidade', `${subBase} · CR/DX = RX, CT = TC, MR = RM`)
    configurarPagina(ws, 4, 1)
    const gruposM = ORDEM_GRUPOS.filter(g => agg.porModalidade.some(m => m.porGrupo[g]))
    const blocos: { titulo: string; q: (m: typeof agg.porModalidade[number]) => number; v: (m: typeof agg.porModalidade[number]) => number }[] = gruposM.length
      ? gruposM.map(g => ({ titulo: g, q: m => m.porGrupo[g]?.quantidade ?? 0, v: m => m.porGrupo[g]?.total ?? 0 }))
      : [{ titulo: 'PRN', q: m => m.porEmpresa.PRN.quantidade, v: m => m.porEmpresa.PRN.total },
         { titulo: 'Medimagem', q: m => m.porEmpresa.MEDIMAGEM.quantidade, v: m => m.porEmpresa.MEDIMAGEM.total }]
    const linhas = agg.porModalidade.map(m => [
      m.fixo ? 'Valor fixo mensal' : m.modalidade, m.quantidade, m.total, m.ticket, m.pctTotal,
      ...blocos.flatMap(b => [b.q(m), b.v(m)]),
    ] as Valor[])
    const t = tabela(ws, 4, 1, [
      { titulo: 'Modalidade', largura: 20 }, { titulo: 'Quantidade', largura: 13, fmt: 'inteiro' }, { titulo: 'Total', largura: 17, fmt: 'moeda' },
      { titulo: 'Ticket médio', largura: 15, fmt: 'moeda' }, { titulo: '% do total', largura: 11, fmt: 'pct' },
      ...blocos.flatMap(b => [{ titulo: `${b.titulo} — quantidade`, largura: 15, fmt: 'inteiro' as Fmt }, { titulo: `${b.titulo} — valor`, largura: 17, fmt: 'moeda' as Fmt }]),
    ], linhas, {
      total: ['TOTAL', 'soma', 'soma', k.exames ? k.totalPorExame / k.exames : null, 'soma', ...blocos.flatMap(() => ['soma', 'soma'] as CelulaTotal[])],
      autofiltro: true,
    })
    if (linhas.length) barras(ws, `C${t.primeira}:C${t.ultima}`, 'FF9DC3E6')
  }

  // 4) Unidade x Modalidade ─────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Unidade x Modalidade', { properties: { tabColor: { argb: 'FF2E75B6' } } })
    titulo(ws, 'Unidade × Modalidade', `${subBase} · quantidade de exames e valor por modalidade`)
    const m = agg.matriz
    const nm = m.modalidades.length
    configurarPagina(ws, 5, 2)
    const colunas: Coluna[] = [
      { titulo: 'Grupo Mobilemed', largura: 20, quebrar: true }, { titulo: 'Unidade (pasta)', largura: 36, quebrar: true },
      ...m.modalidades.map(x => ({ titulo: x, largura: 11, fmt: 'inteiro' as Fmt })),
      { titulo: 'Total exames', largura: 13, fmt: 'inteiro' as Fmt },
      ...m.modalidades.map(x => ({ titulo: x, largura: 15, fmt: 'moeda' as Fmt })),
      { titulo: 'Valor fixo', largura: 15, fmt: 'moeda' as Fmt }, { titulo: 'Total valor', largura: 17, fmt: 'moeda' as Fmt },
    ]
    // faixa de grupos acima do cabeçalho
    const g = (c1: number, c2: number, texto: string) => {
      ws.mergeCells(4, c1, 4, c2)
      const x = ws.getCell(4, c1)
      x.value = texto; x.font = { name: FONTE, size: 10, bold: true, color: { argb: AZUL } }
      x.alignment = { horizontal: 'center' }
      for (let c = c1; c <= c2; c++) { ws.getCell(4, c).fill = fill(CINZA_TOTAL); ws.getCell(4, c).border = BORDAS }
    }
    if (nm) { g(3, 3 + nm, 'QUANTIDADE DE EXAMES'); g(4 + nm, 5 + 2 * nm, 'VALOR (R$)') }
    const porGrupoM = m.linhas.some(l => l.grupoMobilemed)
    const ncolsM = 2 + nm + 1 + nm + 2
    const sm = comSubtotais(m.linhas, l => porGrupoM ? l.grupoMobilemed : '', l => [
      l.grupoMobilemed || empresaBonita(l.empresa), l.pasta,
      ...m.modalidades.map(x => l.quantidade[x] ?? 0), l.totalQuantidade,
      ...m.modalidades.map(x => l.valor[x] ?? 0), l.valorFixo, l.totalValor,
    ] as Valor[], 6, 1, ncolsM, Array.from({ length: ncolsM - 2 }, (_, i) => i + 2), 1, c => ws.getColumn(c).letter)
    const linhas = porGrupoM ? sm.linhas : sm.linhas.filter((_, i) => sm.origem[i])
    const origemM = porGrupoM ? sm.origem : sm.origem.filter(o => o)
    const t = tabela(ws, 5, 1, colunas, linhas, {
      total: ['TOTAL', null, ...Array(nm + 1 + nm + 2).fill('soma')], autofiltro: true, destaque: l => !origemM[l],
    })
    if (linhas.length && nm && !porGrupoM) {
      const letra = (c: number) => ws.getColumn(c).letter
      ws.addConditionalFormatting({
        ref: `${letra(4 + nm)}${t.primeira}:${letra(3 + 2 * nm)}${t.ultima}`,
        rules: [{ type: 'colorScale', cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: BRANCO }, { argb: 'FF9DC3E6' }] } as any],
      })
    }
  }

  // 5) Por nome Mobilemed ───────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Por nome Mobilemed', { properties: { tabColor: { argb: 'FF2E75B6' } } })
    titulo(ws, 'Faturamento por nome no Bruto', `${subBase} · período vazio = mês inteiro`)
    configurarPagina(ws, 4, 1)
    const linhas = agg.porNome.map(n => [n.grupo || '—', n.nome_bruto, n.periodo, n.unidade ?? 'sem contrato', n.qtd, n.total, n.pendencias] as Valor[])
    tabela(ws, 4, 1, [
      { titulo: 'Grupo Mobilemed', largura: 20 }, { titulo: 'Nome no Bruto', largura: 38, quebrar: true }, { titulo: 'Período', largura: 15 },
      { titulo: 'Unidade (pasta)', largura: 34, quebrar: true },
      { titulo: 'Exames', largura: 11, fmt: 'inteiro' }, { titulo: 'Total', largura: 17, fmt: 'moeda' }, { titulo: 'Pendências', largura: 12, fmt: 'inteiro' },
    ], linhas, {
      total: ['TOTAL', null, null, null, 'soma', 'soma', 'soma'], autofiltro: true,
      cor: (l, c) => c === 3 && agg.porNome[l].unidade == null ? 'erro' : c === 6 && agg.porNome[l].pendencias > 0 ? 'atencao' : undefined,
    })
  }

  // 6) Pendências ───────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Pendências', { properties: { tabColor: { argb: 'FFC00000' } } })
    titulo(ws, 'Pendências do relatório', `${subBase} · o que precisa ser conferido antes de faturar`)
    configurarPagina(ws, 4, 0)
    const linhas = agg.pendencias.map(p => [p.grupo || '—', rotuloTipo(p.tipo), p.unidade ?? '—', p.nome_bruto ?? '—', p.detalhe, p.qtd_exames ?? null] as Valor[])
    tabela(ws, 4, 1, [
      { titulo: 'Grupo Mobilemed', largura: 20 }, { titulo: 'Tipo', largura: 32, quebrar: true }, { titulo: 'Unidade (pasta)', largura: 32, quebrar: true },
      { titulo: 'Nome no Bruto', largura: 34, quebrar: true },
      { titulo: 'Detalhe', largura: 80, quebrar: true }, { titulo: 'Exames afetados', largura: 15, fmt: 'inteiro' },
    ], linhas, {
      total: linhas.length ? ['TOTAL', null, null, null, null, 'soma'] : undefined, autofiltro: true,
      cor: (l, c) => (c === 1 ? corTipoPendencia(agg.pendencias[l].tipo) : undefined),
    })
    if (!linhas.length) {
      const x = ws.getCell(5, 1)
      x.value = 'Nenhuma pendência neste relatório.'; x.font = { name: FONTE, size: 10, bold: true }; x.fill = fill(VERDE)
    }
  }

  // 7) Premissas ────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Premissas', { properties: { tabColor: { argb: 'FF7F7F7F' } } })
    titulo(ws, 'Premissas e regras deste relatório', subBase)
    configurarPagina(ws, 0, 0, false)
    ws.getColumn(1).width = 34; ws.getColumn(2).width = 22; ws.getColumn(3).width = 90

    const cfg = meta.config
    const lista = (v: string | undefined, padrao: string[]) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : padrao)
    const juntar = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs.join('')
    const status = lista(cfg.status_por_exame, ['Assinado', 'Reassinado'])
    const urg = lista(cfg.prioridades_urgencia, ['URGENCIA', 'EMERGENCIA', 'PLANTAO'])
    const dupEntra = !['nao', 'não'].includes((cfg.duplicado_entra ?? 'sim').toLowerCase())

    const regras: [string, string][] = [
      ['Competência', comp],
      ['Preço por exame', `O mês é definido pela data do laudo (Data_Conclusao). Entram apenas exames com status ${juntar(status)}.`],
      ['Unidade de valor fixo', 'O mês é definido pela data do exame, com todos os status. O valor fixo é lançado uma única vez por unidade, no nome principal.'],
      ['Exame duplicado', dupEntra ? 'Entra e é cobrado (prática de jul/ago/2026).' : 'Não entra na cobrança.'],
      ['Urgência', `Prioridades tratadas como urgência: ${urg.join(', ')}. Usam o preço de urgência do contrato quando existe.`],
      ['Coluna Valor da Mobilemed', 'Ignorada. Os valores vêm sempre do contrato cadastrado.'],
      ['Preço aplicado', 'Contrato vigente na data de fim do período (mês, ciclo ou quinzena).'],
      ['Dados de paciente', 'Este relatório não contém nome de paciente nem dados de exames individuais.'],
    ]
    let linha = 4
    secao(ws, linha, 1, 3, 'Regras gerais')
    regras.forEach(([a, b], i) => {
      const r = linha + 1 + i
      const ca = ws.getCell(r, 1), cb = ws.getCell(r, 2)
      ws.mergeCells(r, 2, r, 3)
      ca.value = a; ca.font = { name: FONTE, size: 10, bold: true }
      cb.value = b; cb.font = { name: FONTE, size: 10 }
      for (const c of [ca, cb, ws.getCell(r, 3)]) { c.fill = fill(i % 2 ? CINZA : BRANCO); c.border = BORDAS; c.alignment = { vertical: 'top', wrapText: true } }
      ws.getRow(r).height = alturaTexto(b, 108)
    })
    linha += regras.length + 2

    secao(ws, linha, 1, 3, 'Exceções por unidade')
    if (agg.excecoes.length) {
      const t = tabela(ws, linha + 1, 1, [
        { titulo: 'Unidade (pasta)', largura: 34, quebrar: true }, { titulo: 'Empresa', largura: 22 }, { titulo: 'Regra diferente do padrão', largura: 90, quebrar: true },
      ], agg.excecoes.map(e => [e.pasta, empresaBonita(e.empresa), e.regras.join(' · ')] as Valor[]), {})
      linha = t.ultima + 2
    } else {
      ws.getCell(linha + 1, 1).value = 'Nenhuma unidade com regra diferente do padrão.'
      linha += 3
    }

    secao(ws, linha, 1, 3, `Nomes ignorados (${meta.ignorados.length}) — não entram no faturamento`)
    if (meta.ignorados.length) {
      const t = tabela(ws, linha + 1, 1, [
        { titulo: 'Nome no Bruto', largura: 34, quebrar: true }, { titulo: '', largura: 22 }, { titulo: 'Motivo', largura: 90, quebrar: true },
      ], meta.ignorados.map(n => [n.nome_bruto, '', n.motivo] as Valor[]), {})
      linha = t.ultima + 2
    } else {
      ws.getCell(linha + 1, 1).value = 'Nenhum nome ignorado.'
      linha += 3
    }

    ws.mergeCells(linha, 1, linha, 3)
    const o = ws.getCell(linha, 1)
    o.value = 'Relatório de TESTE — conferir antes de faturar.'
    o.font = { name: FONTE, size: 12, bold: true, color: { argb: 'FF7A5200' } }
    o.fill = fill(AMBAR); o.border = BORDAS; o.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(linha).height = 28
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}

/** Nome do arquivo baixado: "Faturamento consolidado MM.AAAA.xlsx". */
export function nomeArquivoConsolidado(competencia: string): string {
  const [a, m] = competencia.split('-')
  return `Faturamento consolidado ${m}.${a}.xlsx`
}
