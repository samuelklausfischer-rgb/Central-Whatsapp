// Relatório de UMA unidade (ExcelJS, roda no navegador), no formato que o financeiro usa (pedido de 13/10/2026):
// uma aba só, com a lista de todos os exames e, no fim, a tabela MODALIDADE · QUANTIDADE · VALOR com o TOTAL.
// Os valores fixos (mensalidade, locação, responsável técnico…) entram como linhas da tabela.
// As instruções de emissão da nota ficam na aba "Agenda de NF" do Excel consolidado.
import { CABECALHO, type ExameLinha } from './excel'
import type { Relatorio, ResumoLinhaRel } from './relatorioUnidade'

const AZUL = 'FF1F4E78', CINZA = 'FFF2F4F7', AMARELO = 'FFFFFF00', VERMELHO = 'FFFF0000'
const BRANCO = 'FFFFFFFF', BORDA = 'FFD0D5DD', FONTE = 'Calibri'
const MOEDA = '"R$" #,##0.00', MOEDA4 = '"R$" #,##0.00##', INTEIRO = '#,##0'
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
const fina = { style: 'thin' as const, color: { argb: BORDA } }
const BORDAS = { top: fina, left: fina, bottom: fina, right: fina }

export async function faturaUnidadeXlsx(_rel: Relatorio, _competencia: string, resumo: ResumoLinhaRel[], exames: ExameLinha[]): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Faturamento por Unidade'
  const ws = wb.addWorksheet('Relatório', { properties: { tabColor: { argb: AZUL } } })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }

  // ── lista de exames ────────────────────────────────────────────────────────
  const larguras = [30, 30, 34, 16, 11, 12, 24, 12, 14, 14, 10, 16, 16, 16, 16, 12, 12, 16]
  CABECALHO.forEach((h, i) => {
    ws.getColumn(i + 1).width = larguras[i] ?? 14
    const x = ws.getCell(1, i + 1)
    x.value = h
    x.font = { name: FONTE, size: 10, bold: true, color: { argb: BRANCO } }
    x.fill = fill(AZUL); x.border = BORDAS
    x.alignment = { vertical: 'middle', horizontal: i >= 7 && i <= 9 ? 'right' : 'left' }
  })
  ws.getRow(1).height = 22
  exames.forEach((e, k) => {
    const linha = ws.getRow(k + 2)
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
  if (exames.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: exames.length + 1, column: CABECALHO.length } }

  // ── tabela do fim: MODALIDADE · QUANTIDADE · VALOR e TOTAL ──────────────────
  let r = exames.length + 3
  ;['MODALIDADE', 'QUANTIDADE', 'VALOR'].forEach((h, i) => {
    const x = ws.getCell(r, i + 1)
    x.value = h
    x.font = { name: FONTE, size: 10, bold: true, color: { argb: BRANCO } }
    x.fill = fill(AZUL); x.border = BORDAS
    x.alignment = { vertical: 'middle', horizontal: i ? 'right' : 'left', wrapText: true }
  })
  ws.getRow(r).height = 22
  r++
  // o resumo já vem somado por modalidade (juntarResumo); os fixos vêm depois, com quantidade 1
  for (const l of resumo) {
    ;[l.rotulo, l.quantidade, l.total].forEach((v, i) => {
      const x = ws.getCell(r, i + 1)
      x.value = v
      x.font = { name: FONTE, size: 10 }; x.border = BORDAS
      x.alignment = { vertical: 'top', horizontal: i ? 'right' : 'left', wrapText: i === 0 }
      if (i === 1) x.numFmt = INTEIRO
      if (i === 2) x.numFmt = MOEDA
    })
    r++
  }
  const qtd = resumo.reduce((s, l) => s + l.quantidade, 0)
  const total = Math.round(resumo.reduce((s, l) => s + l.total, 0) * 100) / 100
  ;['TOTAL', qtd, total].forEach((v, i) => {
    const x = ws.getCell(r, i + 1)
    x.value = v
    x.fill = fill(AMARELO)
    x.font = { name: FONTE, size: 11, bold: true, color: { argb: VERMELHO } }
    x.border = BORDAS
    x.alignment = { vertical: 'middle', horizontal: i ? 'right' : 'left' }
    if (i === 1) x.numFmt = INTEIRO
    if (i === 2) x.numFmt = MOEDA
  })

  return new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer)
}
