// Relatório de UMA unidade num grupo da Mobilemed, pronto para apresentar (ExcelJS, roda no navegador).
// Aba "Fatura": título, quadro de informações, resumo com valores fixos e TOTAL A FATURAR.
// Aba "Exames": lista completa dos exames faturados.
import { CABECALHO, type ExameLinha } from './excel'
import type { Relatorio, ResumoLinhaRel } from './relatorioUnidade'

const MES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// paleta igual à do Excel consolidado
const AZUL = 'FF1F4E78', CINZA = 'FFF2F4F7', AMBAR = 'FFFFF4D6', VERDE = 'FFE3F4EA'
const BRANCO = 'FFFFFFFF', TEXTO_CINZA = 'FF667085', BORDA = 'FFD0D5DD', FONTE = 'Calibri'
const MOEDA = '"R$" #,##0.00', MOEDA4 = '"R$" #,##0.00##', INTEIRO = '#,##0'
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
const fina = { style: 'thin' as const, color: { argb: BORDA } }
const BORDAS = { top: fina, left: fina, bottom: fina, right: fina }

export async function faturaUnidadeXlsx(rel: Relatorio, competencia: string, resumo: ResumoLinhaRel[], exames: ExameLinha[]): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Faturamento por Unidade'
  const [aaaa, mm] = competencia.split('-')
  const comp = `${MES[Number(mm)]}/${aaaa}`
  const unidade = rel.pasta ? rel.pasta + (rel.subunidade ? ` · ${rel.subunidade}` : '') : 'SEM CONTRATO (nome não ligado)'
  const empresa = rel.empresa === 'MEDIMAGEM' ? 'Medimagem' : rel.empresa ?? '—'

  // ── aba Fatura ──────────────────────────────────────────────────────────────
  const ws = wb.addWorksheet('Fatura', { properties: { tabColor: { argb: AZUL } } })
  ws.views = [{ showGridLines: false }]
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
  ;[46, 14, 18, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w })

  ws.mergeCells('A1:D1')
  const t = ws.getCell('A1')
  t.value = `FATURA DE UNIDADE — ${unidade}`
  t.font = { name: FONTE, size: 15, bold: true, color: { argb: BRANCO } }
  t.fill = fill(AZUL)
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true }
  ws.getRow(1).height = 34
  ws.mergeCells('A2:D2')
  const st = ws.getCell('A2')
  st.value = `Competência ${comp}${rel.periodo ? ` (${rel.periodo})` : ''} · grupo ${rel.rotuloGrupo} · ${empresa}`
  st.font = { name: FONTE, size: 10, italic: true, color: { argb: TEXTO_CINZA } }

  const info: [string, string][] = [
    ['Grupo da Mobilemed', rel.rotuloGrupo],
    ['Unidade (contrato)', unidade],
    ['Empresa', empresa],
    ['Competência', comp + (rel.periodo ? ` — ${rel.periodo}` : '')],
    ['Nomes na Mobilemed', rel.nomes.join('\n')],
  ]
  let r = 4
  for (const [rotulo, valor] of info) {
    ws.mergeCells(r, 2, r, 4)
    const a = ws.getCell(r, 1)
    const b = ws.getCell(r, 2)
    a.value = rotulo
    a.font = { name: FONTE, size: 10, bold: true, color: { argb: AZUL } }
    a.fill = fill(CINZA); a.border = BORDAS; a.alignment = { vertical: 'top' }
    b.value = valor
    b.font = { name: FONTE, size: 10 }; b.border = BORDAS; b.alignment = { vertical: 'top', wrapText: true }
    for (let c = 3; c <= 4; c++) ws.getCell(r, c).border = BORDAS
    if (rotulo === 'Nomes na Mobilemed') ws.getRow(r).height = Math.max(16, rel.nomes.length * 14 + 2)
    r++
  }

  r++
  const sec = ws.getCell(r, 1)
  sec.value = 'RESUMO DA FATURA'
  sec.font = { name: FONTE, size: 12, bold: true, color: { argb: AZUL } }
  for (let c = 1; c <= 4; c++) ws.getCell(r, c).border = { bottom: { style: 'medium', color: { argb: AZUL } } }
  r++
  const cab = ['Modalidade / item', 'Quantidade', 'Valor unitário', 'Total']
  cab.forEach((h, i) => {
    const x = ws.getCell(r, i + 1)
    x.value = h
    x.font = { name: FONTE, size: 10, bold: true, color: { argb: BRANCO } }
    x.fill = fill(AZUL); x.border = BORDAS
    x.alignment = { vertical: 'middle', horizontal: i ? 'right' : 'left' }
  })
  ws.getRow(r).height = 22
  r++
  resumo.forEach((it, k) => {
    const valores = [it.fixo ? `${it.rotulo} (valor fixo)` : it.rotulo, it.quantidade, it.valor_unitario, it.total]
    valores.forEach((v, i) => {
      const x = ws.getCell(r, i + 1)
      x.value = v
      x.font = { name: FONTE, size: 10 }; x.border = BORDAS
      x.fill = fill(it.fixo ? AMBAR : k % 2 ? CINZA : BRANCO)
      x.alignment = { vertical: 'top', horizontal: i ? 'right' : 'left', wrapText: i === 0 }
      if (i === 1) x.numFmt = INTEIRO
      if (i === 2) x.numFmt = MOEDA4
      if (i === 3) x.numFmt = MOEDA
    })
    const rot = String(valores[0])
    if (rot.length > 48) ws.getRow(r).height = Math.ceil(rot.length / 48) * 14 + 2
    r++
  })
  const qtd = resumo.filter(x => !x.fixo).reduce((s, x) => s + x.quantidade, 0)
  const total = Math.round(resumo.reduce((s, x) => s + x.total, 0) * 100) / 100
  const linhaTotal: (string | number | null)[] = ['TOTAL A FATURAR', qtd, null, total]
  linhaTotal.forEach((v, i) => {
    const x = ws.getCell(r, i + 1)
    x.value = v
    x.fill = fill(VERDE)
    x.font = { name: FONTE, size: i === 0 || i === 3 ? 13 : 11, bold: true, color: { argb: AZUL } }
    x.border = { top: { style: 'double', color: { argb: AZUL } }, bottom: { style: 'medium', color: { argb: AZUL } }, left: fina, right: fina }
    x.alignment = { vertical: 'middle', horizontal: i ? 'right' : 'left' }
    if (i === 1) x.numFmt = INTEIRO
    if (i === 3) x.numFmt = MOEDA
  })
  ws.getRow(r).height = 26
  r += 2
  const nota = ws.getCell(r, 1)
  nota.value = `Lista completa dos ${exames.length.toLocaleString('pt-BR')} exames na aba "Exames". Valores pelo contrato vigente na competência.`
  nota.font = { name: FONTE, size: 9, italic: true, color: { argb: TEXTO_CINZA } }

  // ── aba Exames ──────────────────────────────────────────────────────────────
  const we = wb.addWorksheet('Exames', { properties: { tabColor: { argb: 'FF2E75B6' } } })
  we.views = [{ state: 'frozen', ySplit: 1 }]
  we.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
  const larguras = [30, 30, 34, 16, 11, 12, 24, 10, 12, 12, 10, 16, 16, 16, 16, 12, 12, 16]
  CABECALHO.forEach((h, i) => {
    we.getColumn(i + 1).width = larguras[i] ?? 14
    const x = we.getCell(1, i + 1)
    x.value = h
    x.font = { name: FONTE, size: 10, bold: true, color: { argb: BRANCO } }
    x.fill = fill(AZUL); x.border = BORDAS
    x.alignment = { vertical: 'middle', horizontal: i >= 7 && i <= 9 ? 'right' : 'left' }
  })
  we.getRow(1).height = 22
  exames.forEach((e, k) => {
    const linha = we.getRow(k + 2)
    linha.values = [
      e.nome_bruto, e.nome_paciente ?? null, e.estudo_descricao ?? null, e.accession_number ?? null,
      e.modalidade ?? null, e.prioridade ?? null, e.medico ?? null,
      e.quantidade, e.valor_unitario, e.valor_total,
      e.duplicado ?? null, e.data_exame ?? null, e.data_transferencia ?? null, e.data_conclusao ?? null,
      e.data_prazo ?? null, e.status_bruto ?? null, e.imagem_chave ?? null, e.digitador ?? null,
    ]
    linha.font = { name: FONTE, size: 10 }
    if (k % 2) linha.eachCell(c => { c.fill = fill(CINZA) })
    linha.getCell(8).numFmt = INTEIRO
    linha.getCell(9).numFmt = MOEDA4
    linha.getCell(10).numFmt = MOEDA
  })
  if (exames.length) we.autoFilter = { from: { row: 1, column: 1 }, to: { row: exames.length + 1, column: CABECALHO.length } }

  return new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer)
}
