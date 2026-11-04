// PDFs do relatório da unidade (jsPDF, roda no navegador), além do Excel — pedido da Ketlin em 04/11/2026:
// - Unaí: "é separado a rotina da urgência e é em PDF" → dois PDFs, um com os exames de ROTINA e outro com os de
//   URGÊNCIA (urgência = prioridade em prioridades_urgencia, a mesma regra da tabela de Santarém). Cada um tem o seu
//   subtotal e, no fim, o resumo da competência (rotina + urgência + fixos, como o PACS = TOTAL a faturar).
// - Abdon Batista: "além do Excel vai outros dois documentos e ele em PDF também" → a lista de exames em PDF e o
//   demonstrativo que a equipe fazia no Word (quadro QUANT · EXAME · VALOR UNIT. · VALOR TOTAL, local e data, e o
//   quadro de itens QUANT · DATA · ITEM · EXAME · VALOR), também em PDF.
// Quais unidades: as pastas das chaves pdf_prioridade_pastas e pdf_demonstrativo_pastas da config ("UNAI, OUTRA - UF");
// sem a chave valem os padrões abaixo; com a chave vazia, nenhuma. O Excel da unidade continua saindo igual.
import type { ExameLinha } from './excel'
import { normNome } from '../nucleo/motor'
import type { Relatorio, ResumoLinhaRel } from './relatorioUnidade'

export interface RegraPdf { prioridade: string[]; demonstrativo: string[]; cidade: string }

/** Padrões de 04/11/2026 (valem enquanto a config não tiver a chave). */
export const PDF_PADRAO: RegraPdf = { prioridade: ['UNAI'], demonstrativo: ['ABDON BATISTA - SC'], cidade: 'Camboriú' }

const lista = (v: string | null | undefined, padrao: string[]) =>
  v == null ? padrao : v.split(',').map(s => s.trim()).filter(Boolean)

export function lerRegraPdf(cfg: Record<string, string | null | undefined>): RegraPdf {
  return {
    prioridade: lista(cfg.pdf_prioridade_pastas, PDF_PADRAO.prioridade),
    demonstrativo: lista(cfg.pdf_demonstrativo_pastas, PDF_PADRAO.demonstrativo),
    cidade: cfg.pdf_demonstrativo_cidade?.trim() || PDF_PADRAO.cidade,
  }
}

const temPasta = (rel: Pick<Relatorio, 'pasta'>, pastas: string[]) =>
  !!rel.pasta && pastas.some(p => normNome(p) === normNome(rel.pasta!))

export type TipoPdf = 'rotina' | 'urgencia' | 'lista' | 'demonstrativo'
/** Quais PDFs o relatório leva (vazio = só o Excel). */
export function pdfsDaUnidade(rel: Pick<Relatorio, 'pasta'>, regra: RegraPdf): TipoPdf[] {
  const t: TipoPdf[] = []
  if (temPasta(rel, regra.prioridade)) t.push('rotina', 'urgencia')
  if (temPasta(rel, regra.demonstrativo)) t.push('lista', 'demonstrativo')
  return t
}

// ── contas (puras, testadas) ─────────────────────────────────────────────────
const r2 = (v: number) => Math.round(v * 100) / 100
const cent = (v: number) => Math.round(v * 100)
const somaQ = (xs: { quantidade: number }[]) => xs.reduce((s, x) => s + x.quantidade, 0)
const somaT = (xs: { valor_total: number }[]) => r2(xs.reduce((s, x) => s + x.valor_total, 0))

export function dividirPorPrioridade(exames: ExameLinha[], prioridadesUrgencia: string[]) {
  const urg = new Set(prioridadesUrgencia.map(p => normNome(p)))
  const urgencia = exames.filter(e => urg.has(normNome(e.prioridade ?? '')))
  const rotina = exames.filter(e => !urg.has(normNome(e.prioridade ?? '')))
  return { rotina, urgencia }
}

/** Os exames batem com o resumo do motor (quantidade e centavos)? Se não, o PDF não sai: nunca um total diferente do Excel. */
export function examesBatemComResumo(exames: ExameLinha[], resumo: ResumoLinhaRel[]): boolean {
  const doExame = resumo.filter(l => !l.fixo)
  return somaQ(exames) === somaQ(doExame) && cent(somaT(exames)) === cent(doExame.reduce((s, l) => s + l.total, 0))
}

const NOME_MODALIDADE: Record<string, string> = {
  RX: 'RAIO-X', DX: 'RAIO-X', CR: 'RAIO-X', CT: 'TOMOGRAFIA', TC: 'TOMOGRAFIA', MG: 'MAMOGRAFIA', MR: 'RESSONÂNCIA MAGNÉTICA',
  RM: 'RESSONÂNCIA MAGNÉTICA', US: 'ULTRASSONOGRAFIA', OT: 'DENSITOMETRIA', DO: 'DENSITOMETRIA', ECG: 'ELETROCARDIOGRAMA',
}
/** Nome do exame no demonstrativo: modalidade por extenso; item fixo sem o " - mensal" do cadastro, em maiúsculas. */
export function nomeNoDemonstrativo(l: Pick<ResumoLinhaRel, 'rotulo' | 'fixo'>): string {
  const t = l.rotulo.trim().toUpperCase()
  if (!l.fixo) return NOME_MODALIDADE[t] ?? t
  return t.replace(/\s*[-–]\s*MENSAL(IDADE)?\s*$/, '').replace(/\s+/g, ' ')
}

export interface LinhaDemonstrativo { quantidade: number; exame: string; item: string; valor_unitario: number | null; total: number }
/** Quadros do demonstrativo, na ordem do Word de Abdon: exames por modalidade, depois os fixos. */
export function linhasDemonstrativo(resumo: ResumoLinhaRel[]): LinhaDemonstrativo[] {
  // modalidades com o mesmo nome por extenso (DX e CR = RAIO-X) viram uma linha só; unitário só se for igual
  const m = new Map<string, { fixo: boolean; exame: string; q: number; t: number; vs: Set<number | null> }>()
  for (const l of [...resumo.filter(x => !x.fixo), ...resumo.filter(x => x.fixo)]) {
    const exame = nomeNoDemonstrativo(l)
    const k = `${l.fixo ? 'F' : 'E'}|${exame}`
    const g = m.get(k) ?? { fixo: l.fixo, exame, q: 0, t: 0, vs: new Set<number | null>() }
    // fixo sem valor unitário gravado: total ÷ quantidade; exame com preços diferentes na modalidade fica sem unitário
    g.q += l.quantidade; g.t += l.total; g.vs.add(l.valor_unitario ?? (l.fixo && l.quantidade ? r2(l.total / l.quantidade) : null))
    m.set(k, g)
  }
  return [...m.values()].map(g => ({
    quantidade: g.q, exame: g.exame, valor_unitario: g.vs.size === 1 ? [...g.vs][0] : null, total: r2(g.t),
    item: g.fixo ? g.exame : `EMISSÃO DE LAUDOS DOS EXAMES DE ${g.exame}`,
  }))
}

/** "01/10/2026 a 31/10/2026" (período inteiro da competência) ou o rótulo do período (quinzena, ação intensificada). */
export function textoPeriodo(competencia: string, periodo: string): string {
  const [a, m] = competencia.split('-').map(Number)
  const ult = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  const mes = `01/${mm}/${a} a ${ult}/${mm}/${a}`
  return periodo ? `${mes} · ${periodo}` : mes
}

/** Data do demonstrativo: dia 1º do mês seguinte à competência (o Word de set/2026 foi datado de 01/10/2026). */
export function dataDoDemonstrativo(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number)
  const d = new Date(Date.UTC(a, m, 1))
  return `01/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

// ── desenho ──────────────────────────────────────────────────────────────────
const brl = (v: number | null) => v == null ? '-' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const int = (v: number) => v.toLocaleString('pt-BR')
// as fontes padrão do PDF só têm o Latin-1: o resto (aspas curvas, travessão, emoji) vira o equivalente simples
const latin1 = (s: string | null | undefined) => (s ?? '').normalize('NFC').replace(/\s+/g, ' ')
  .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—―]/g, '-').replace(/…/g, '...')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
const AZUL: [number, number, number] = [31, 78, 120]

const EMPRESA: Record<string, { nome: string; cnpj: string | null }> = {
  MEDIMAGEM: { nome: 'MEDIMAGEM DIAGNÓSTICOS LTDA', cnpj: '35.688.028/0001-48' },
  PRN: { nome: 'PRN DIAGNÓSTICOS', cnpj: null },
}

type Doc = import('jspdf').jsPDF
type AutoTable = typeof import('jspdf-autotable').default

async function novoDoc(orientacao: 'landscape' | 'portrait'): Promise<{ doc: Doc; autoTable: AutoTable }> {
  const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: orientacao, unit: 'mm', format: 'a4' })
  return { doc, autoTable: at.default }
}

const fimY = (doc: Doc) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 20

/** Título, unidade/competência/período e empresa; o texto longo quebra na largura da página. Devolve o Y livre. */
function cabecalho(doc: Doc, rel: Relatorio, titulo: string, competencia: string): number {
  const emp = EMPRESA[(rel.empresa ?? '').toUpperCase()] ?? { nome: rel.empresa ?? '', cnpj: null }
  const [a, m] = competencia.split('-')
  const largura = doc.internal.pageSize.getWidth() - 28
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...AZUL)
  const t = doc.splitTextToSize(latin1(titulo), largura) as string[]
  doc.text(t, 14, 15)
  const y = 15 + (t.length - 1) * 5.5 + 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60)
  const linhas = [
    ...(doc.splitTextToSize(latin1(`Unidade: ${rel.nomes.join(' · ')}   |   Competência: ${m}/${a}   |   Período: ${textoPeriodo(competencia, rel.periodo)}`), largura) as string[]),
    latin1(`${emp.nome}${emp.cnpj ? ` · CNPJ ${emp.cnpj}` : ''}`),
  ]
  doc.text(linhas, 14, y, { lineHeightFactor: 1.5 })
  return y + linhas.length * 4.8 + 1
}

function rodapes(doc: Doc, rotulo: string) {
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 120, 120)
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight()
    doc.text(latin1(rotulo), 14, h - 7)
    doc.text(`Página ${i} de ${n}`, w - 14, h - 7, { align: 'right' })
  }
}

const bytesDe = (doc: Doc) => new Uint8Array(doc.output('arraybuffer'))

/** Lista de exames (Abdon e cada metade de Unaí): Nº · Paciente · Exame · Modalidade · Prioridade · Médico · Qtd · Valor · Total · Data do exame · Data do laudo. */
async function pdfLista(rel: Relatorio, competencia: string, titulo: string, exames: ExameLinha[], resumoFinal: ResumoLinhaRel[] | null): Promise<Uint8Array> {
  const { doc, autoTable } = await novoDoc('landscape')
  const y0 = cabecalho(doc, rel, titulo, competencia)
  autoTable(doc, {
    startY: y0,
    head: [['Nº', 'Paciente', 'Exame', 'Mod.', 'Prioridade', 'Médico', 'Qtd', 'Valor', 'Total', 'Data do exame', 'Data do laudo']],
    body: exames.map((e, i) => [
      String(i + 1), latin1(e.nome_paciente), latin1(e.estudo_descricao), latin1(e.modalidade), latin1(e.prioridade), latin1(e.medico),
      int(e.quantidade), brl(e.valor_unitario), brl(e.valor_total), latin1(e.data_exame), latin1(e.data_conclusao),
    ]),
    foot: [['', 'TOTAL DOS EXAMES', '', '', '', '', int(somaQ(exames)), '', brl(somaT(exames)), '', '']],
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.2, overflow: 'linebreak' },
    headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [255, 255, 0], textColor: [200, 0, 0], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [242, 244, 247] },
    columnStyles: { 0: { cellWidth: 9, halign: 'right' }, 6: { halign: 'right', cellWidth: 9 }, 7: { halign: 'right' }, 8: { halign: 'right' } },
    showFoot: 'lastPage',
    margin: { left: 14, right: 14, bottom: 14 },
    didParseCell: d => { if (d.section !== 'body' && [6, 7, 8].includes(d.column.index)) d.cell.styles.halign = 'right' },
  })
  if (resumoFinal) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...AZUL)
    let y = fimY(doc) + 8
    // o quadro inteiro na mesma página (título + cabeçalho + linhas + TOTAL, ~7 mm cada)
    if (y + 10 + (resumoFinal.length + 2) * 7 > doc.internal.pageSize.getHeight() - 14) { doc.addPage(); y = 20 }
    doc.text('RESUMO DA COMPETÊNCIA', 14, y)
    const total = r2(resumoFinal.reduce((s, l) => s + l.total, 0))
    autoTable(doc, {
      startY: y + 2,
      head: [['DESCRIÇÃO', 'QUANTIDADE', 'VALOR UNIT.', 'VALOR']],
      body: resumoFinal.map(l => [latin1(l.rotulo), int(l.quantidade), brl(l.valor_unitario), brl(l.total)]),
      foot: [['TOTAL A FATURAR', int(somaQ(resumoFinal)), '', brl(total)]],
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.6 },
      headStyles: { fillColor: AZUL, textColor: 255 },
      footStyles: { fillColor: [255, 255, 0], textColor: [200, 0, 0], fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      didParseCell: d => { if (d.section !== 'body' && d.column.index > 0) d.cell.styles.halign = 'right' },
      tableWidth: 150, margin: { left: 14 },
    })
  }
  rodapes(doc, titulo)
  return bytesDe(doc)
}

/** Demonstrativo (o Word de Abdon): quadro de valores da competência, local e data, e o quadro de itens. */
async function pdfDemonstrativo(rel: Relatorio, competencia: string, resumo: ResumoLinhaRel[], cidade: string): Promise<Uint8Array> {
  const { doc, autoTable } = await novoDoc('portrait')
  const titulo = `DEMONSTRATIVO DE FATURAMENTO - ${nomeDoRelatorio(rel)}`
  const y0 = cabecalho(doc, rel, titulo, competencia)
  const [a, m] = competencia.split('-')
  const linhas = linhasDemonstrativo(resumo)
  const total = r2(linhas.reduce((s, l) => s + l.total, 0))
  const q2 = (q: number) => String(q).padStart(2, '0')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0, 0, 0)
  doc.text(`COMPETÊNCIA: ${m}/${a}`, 14, y0 + 5)
  autoTable(doc, {
    startY: y0 + 8,
    head: [['QUANT.', 'EXAME', 'VALOR UNIT.', 'VALOR TOTAL']],
    body: linhas.map(l => [q2(l.quantidade), latin1(l.exame), brl(l.valor_unitario), brl(l.total)]),
    foot: [['', 'VALOR TOTAL', '', brl(total)]],
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 2, lineColor: [0, 0, 0], lineWidth: 0.2 },
    headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
    columnStyles: { 0: { halign: 'center', cellWidth: 20 }, 2: { halign: 'right', cellWidth: 32 }, 3: { halign: 'right', cellWidth: 34 } },
    theme: 'grid', margin: { left: 14, right: 14 },
  })
  const data = dataDoDemonstrativo(competencia)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(latin1(`${cidade}, ${data}.`), 14, fimY(doc) + 10)
  autoTable(doc, {
    startY: fimY(doc) + 20,
    head: [['QUANT.', 'DATA', 'ITEM', 'EXAME', 'VALOR']],
    body: linhas.map((l, i) => ['01', data, q2(i + 1), latin1(l.item), brl(l.valor_unitario)]),
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 2, lineColor: [0, 0, 0], lineWidth: 0.2 },
    headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { halign: 'center', cellWidth: 18 }, 1: { halign: 'center', cellWidth: 26 }, 2: { halign: 'center', cellWidth: 14 }, 4: { halign: 'right', cellWidth: 32 } },
    theme: 'grid', margin: { left: 14, right: 14 },
  })
  rodapes(doc, titulo)
  return bytesDe(doc)
}

export interface ArquivoPdf { tipo: TipoPdf; sufixo: string; bytes: Uint8Array }
export interface PdfsDoRelatorio { pdfs: ArquivoPdf[]; avisos: string[] }

const nomeDoRelatorio = (rel: Pick<Relatorio, 'pasta' | 'subunidade' | 'nomes'>) =>
  (rel.pasta ?? rel.nomes[0]) + (rel.subunidade ? ` - ${rel.subunidade}` : '')

/**
 * PDFs do relatório conforme a regra (vazio para quase todas as unidades). As listas de exames só saem se os exames
 * batem com o resumo do motor; senão volta um aviso em `avisos` (o ZIP leva um LEIA-ME) e o Excel continua sendo a
 * referência: o total nunca diverge. O demonstrativo usa só o resumo do motor, então sai sempre.
 */
export async function pdfsDoRelatorio(
  rel: Relatorio, competencia: string, resumo: ResumoLinhaRel[], exames: ExameLinha[], regra: RegraPdf, prioridadesUrgencia: string[],
): Promise<PdfsDoRelatorio> {
  const tipos = pdfsDaUnidade(rel, regra)
  const avisos: string[] = []
  const pdfs: ArquivoPdf[] = []
  if (!tipos.length) return { pdfs, avisos }
  const nome = nomeDoRelatorio(rel)
  const listasOk = examesBatemComResumo(exames, resumo)
  if (!listasOk && (tipos.includes('rotina') || tipos.includes('lista'))) {
    const msg = `${nome}: os exames da lista não batem com o resumo do cálculo (quantidade ou valor). Os PDFs com a lista de exames não foram gerados; confira pelo Excel e gere de novo.`
    console.warn(`[faturamento] ${msg}`)
    avisos.push(msg)
  }
  const fixos = resumo.filter(l => l.fixo)
  if (listasOk && tipos.includes('rotina')) {
    const { rotina, urgencia } = dividirPorPrioridade(exames, prioridadesUrgencia)
    const vu = (xs: ExameLinha[]) => { const s = new Set(xs.map(e => e.valor_unitario)); return s.size === 1 ? [...s][0] : null }
    const resumoFinal: ResumoLinhaRel[] = [
      ...(rotina.length ? [{ rotulo: 'LAUDOS DE ROTINA', quantidade: somaQ(rotina), valor_unitario: vu(rotina), total: somaT(rotina), fixo: false }] : []),
      ...(urgencia.length ? [{ rotulo: 'LAUDOS DE URGÊNCIA E EMERGÊNCIA', quantidade: somaQ(urgencia), valor_unitario: vu(urgencia), total: somaT(urgencia), fixo: false }] : []),
      ...fixos,
    ]
    // sem exame nenhum no período, o de rotina sai mesmo vazio, para levar o resumo com os fixos (PACS)
    if (rotina.length || !urgencia.length) pdfs.push({ tipo: 'rotina', sufixo: 'ROTINA', bytes: await pdfLista(rel, competencia, `RELATÓRIO DE LAUDOS DE ROTINA - ${nome}`, rotina, resumoFinal) })
    if (urgencia.length) pdfs.push({ tipo: 'urgencia', sufixo: 'URGENCIA', bytes: await pdfLista(rel, competencia, `RELATÓRIO DE LAUDOS DE URGÊNCIA E EMERGÊNCIA - ${nome}`, urgencia, resumoFinal) })
  }
  if (listasOk && tipos.includes('lista')) pdfs.push({ tipo: 'lista', sufixo: '', bytes: await pdfLista(rel, competencia, `RELATÓRIO DE EXAMES - ${nome}`, exames, null) })
  if (tipos.includes('demonstrativo')) pdfs.push({ tipo: 'demonstrativo', sufixo: 'DEMONSTRATIVO', bytes: await pdfDemonstrativo(rel, competencia, resumo, regra.cidade) })
  return { pdfs, avisos }
}

/** Caminho do PDF no ZIP: o do Excel com o sufixo ("UNAI 10.2026 ROTINA.pdf", "ABDON BATISTA - SC 10.2026.pdf"). */
export const caminhoPdf = (caminhoXlsx: string, sufixo: string) => caminhoXlsx.replace(/\.xlsx$/i, '') + (sufixo ? ` ${sufixo}` : '') + '.pdf'
