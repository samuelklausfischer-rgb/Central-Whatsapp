import ExcelJS from 'exceljs'
import { buildCockpitRows, groupDuplicateRows, groupRowsByUnitConsolidated, DEFAULT_MONTHS } from '@/lib/prn-analise/audit-utils'
import type { MonthInfo } from '@/lib/prn-analise/audit-utils'
import type { AnalysisRecord } from '@/services/prn-analise/analise-duplicidade'

function buildTableHeaders(months: MonthInfo[]): string[] {
  return [
    'Favorecido',
    'Categoria',
    'Data Reg.',
    months[0]?.abbr ?? 'M1',
    months[1]?.abbr ?? 'M2',
    months[2]?.abbr ?? 'M3',
    'Atual',
    'Var %',
    'OBS do Financeiro',
  ]
}

const UNIT_HEADER_COLORS: Record<string, string> = {
  'PRN MATRIZ': 'FF1E40AF',
  CAMBORIU: 'FF059669',
  PALHOCA: 'FFD97706',
}

const UNIT_ROW_COLORS: Record<string, string> = {
  'PRN MATRIZ': 'FFEBF5FB',
  CAMBORIU: 'FFEBF7EB',
  PALHOCA: 'FFFEF9EB',
}

function formatBRL(value: number | null | undefined) {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return ''
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

function styleTableHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    }
  })
}

function styleUnitHeader(row: ExcelJS.Row, unit: string) {
  const color = UNIT_HEADER_COLORS[unit] || 'FF64748B'
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  })
}

function styleFinanceNoteCell(cell: ExcelJS.Cell) {
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
  cell.font = { color: { argb: 'FF111827' }, size: 10 }
}

function formatDateExcel(dateStr: string) {
  if (!dateStr) return '-'
  if (dateStr.includes('T')) return new Date(dateStr).toLocaleDateString('pt-BR')
  const p = dateStr.split('-')
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`
  return dateStr
}

function saveBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function addDuplicitySheet(workbook: ExcelJS.Workbook, duplicityData: AnalysisRecord) {
  const ws = workbook.addWorksheet('Duplicidade')
  const titleRow = ws.addRow(['ANÁLISE DE DUPLICIDADE'])
  titleRow.font = { bold: true, size: 14, color: { argb: 'FF9333EA' } }
  ws.addRow([`Arquivo: ${duplicityData.file_name}`]).font = { size: 10, italic: true }
  ws.addRow([`Gerado em: ${new Date().toLocaleString('pt-BR')}`]).font = {
    size: 9,
    color: { argb: 'FF6B7280' },
  }
  ws.addRow([])

  const metricsHeaderRow = ws.addRow([
    'Total Registros',
    'Analisados',
    'Duplicidades',
    'Grupos',
    'G. Revisão Manual',
    'Estrutura Parcial',
  ])
  const metricColors = [
    'FF6B7280',
    'FF2563EB',
    'FFDC2626',
    'FF9333EA',
    'FFCA8A04',
    'FF2563EB',
  ]
  metricsHeaderRow.eachCell((cell, colNum) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: metricColors[colNum - 1] || 'FF6B7280' },
    }
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    }
  })

  const metricsValRow = ws.addRow([
    duplicityData.total_records || 0,
    duplicityData.analyzable_records || 0,
    duplicityData.duplicate_count || 0,
    duplicityData.group_count || 0,
    duplicityData.overall_manual_count || 0,
    duplicityData.partial_structure_count || 0,
  ])
  metricsValRow.eachCell((cell) => {
    cell.font = { bold: true, size: 12 }
    cell.alignment = { horizontal: 'center' }
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    }
  })
  ws.addRow([])
  ws.addRow([])

  const result_json = duplicityData.result_json
  if (!result_json) {
    ws.columns = [
      { width: 20 },
      { width: 20 },
      { width: 20 },
      { width: 20 },
      { width: 20 },
      { width: 20 },
    ]
    return
  }

  const RECORD_HEADERS = [
    'Linha',
    'Unidade',
    'Nome',
    'Departamento',
    'Valor',
    'Vencimento',
    'Parcela',
    'CPF/CNPJ',
  ]

  const addSectionTitle = (title: string, argb: string) => {
    ws.addRow([])
    const sRow = ws.addRow([title])
    sRow.font = { bold: true, size: 12, color: { argb: argb } }
    ws.addRow([])
  }

  const addRecordTableHeader = (fillArgb: string) => {
    const hRow = ws.addRow(RECORD_HEADERS)
    hRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 9 }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      }
    })
  }

  const addRecordRow = (r: any, bgArgb: string) => {
    const dRow = ws.addRow([
      r.linha_origem ?? r.linhaOrigem ?? '-',
      r.unidade ?? '-',
      r.nome_original ?? r.nomeOriginal ?? '-',
      r.departamento_original ?? r.departamentoOriginal ?? '-',
      formatBRL(r.valor_normalizado ?? r.valorNormalizado ?? 0),
      formatDateExcel(r.vencimento ?? ''),
      r.parcela || '-',
      (r.cpf_cnpj ?? r.cpfCnpj) || '-',
    ])
    dRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } }
      cell.font = { size: 9 }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } }
    })
  }

  const addGroups = (
    groups: any[],
    title: string,
    titleArgb: string,
    headerArgb: string,
    rowBgArgb: string,
  ) => {
    if (!groups || groups.length === 0) return
    addSectionTitle(title, titleArgb)
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      const groupLabelRow = ws.addRow([
        `Grupo ${g.groupId || i + 1} — ${g.keyName || g.records?.[0]?.nome_original || 'N/A'}`,
      ])
      groupLabelRow.font = { bold: true, italic: true, size: 9, color: { argb: titleArgb } }
      addRecordTableHeader(headerArgb)
      for (const r of g.records || []) addRecordRow(r, rowBgArgb)
      ws.addRow([])
    }
  }

  addGroups(
    result_json.duplicateGroups,
    'DUPLICIDADES CONFIRMADAS — RISCO CRÍTICO',
    'FFDC2626',
    'FFDC2626',
    'FFFFF5F5',
  )
  addGroups(
    result_json.manualReviewGroups,
    'REVISÃO DE CONTEXTO — MESMO DEPARTAMENTO',
    'FFCA8A04',
    'FFCA8A04',
    'FFFFFBEB',
  )
  addGroups(
    result_json.nameRepeatManualGroups,
    'REVISÃO DE CONTEXTO — NOME REPETIDO',
    'FFD97706',
    'FFD97706',
    'FFFFFBEB',
  )

  const partialRecords = (result_json.partialStructureRecords || []).filter(
    (r: any) => r.vencimento && r.vencimento !== '-' && String(r.vencimento).trim() !== '',
  )
  if (partialRecords.length > 0) {
    addSectionTitle('MONITORAMENTO — ESTRUTURA PARCIAL', 'FF2563EB')
    addRecordTableHeader('FF2563EB')
    for (const r of partialRecords) addRecordRow(r, 'FFEFF6FF')
  }

  ws.columns = [
    { width: 10 },
    { width: 15 },
    { width: 42 },
    { width: 32 },
    { width: 16 },
    { width: 14 },
    { width: 12 },
    { width: 20 },
  ]
}

export async function generateAuditExcel(
  data: any,
  duplicityData?: AnalysisRecord,
  observations?: Record<string, { observation: string }>,
  months: MonthInfo[] = DEFAULT_MONTHS,
) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Auditoria Detalhada')

  const crossAnalysis = data?.data?.byBlock || data?.data?.crossAnalysis?.byBlock || {}
  const UNIT_KEYS: Record<string, string> = {
    'PRN MATRIZ': 'prn_matriz',
    CAMBORIU: 'camboriu',
    PALHOCA: 'palhoca',
  }

  worksheet.addRow(['PRN FINANCEIRO - RELATÓRIO DE AUDITORIA']).font = { bold: true, size: 16 }
  worksheet.addRow([
    `Data de Referência: ${data?.meta?.data_referencia || data?.request?.referenceDate || new Date().toLocaleDateString()}`,
  ])
  worksheet.addRow([`ID Processamento: ${data?.requestId || 'N/A'}`])
  worksheet.addRow([])

  for (const unitLabel of ['PRN MATRIZ', 'CAMBORIU', 'PALHOCA']) {
    const key = UNIT_KEYS[unitLabel]
    const blockRows = Array.isArray(crossAnalysis[key]?.rows) ? crossAnalysis[key].rows : []
    const cockpitRows = buildCockpitRows(key, blockRows, months)
    const grouped = groupDuplicateRows(cockpitRows)
    if (grouped.length === 0) continue

    const unitRow = worksheet.addRow([unitLabel])
    styleUnitHeader(unitRow, unitLabel)
    worksheet.mergeCells(`A${unitRow.number}:I${unitRow.number}`)

    const headerRow = worksheet.addRow(buildTableHeaders(months))
    styleTableHeader(headerRow)

    const unitBg = UNIT_ROW_COLORS[unitLabel] || 'FFFFFFFF'
    let isZebra = false

    for (const row of grouped) {
      isZebra = !isZebra
      const rowColor = isZebra ? unitBg : 'FFFFFFFF'
      const rowKey = `${row.unidade}|||${row.favorecido}|||${row.categoria}`
      const obsText = observations?.[rowKey]?.observation || ''

      const mainRow = worksheet.addRow([
        row.favorecido,
        row.categoria,
        row.dataRegistro || '—',
        formatBRL(row.m1),
        formatBRL(row.m2),
        formatBRL(row.m3),
        formatBRL(row.atual),
        `${row.varPct?.toFixed(2)}%`,
        obsText,
      ])

      mainRow.eachCell((cell, colNumber) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } }
        if (colNumber === 8) {
          if (row.status === 'Aumento') cell.font = { color: { argb: 'FFEF4444' }, bold: true }
          if (row.status === 'Queda') cell.font = { color: { argb: 'FF10B981' }, bold: true }
          if (row.status === 'Novo') cell.font = { color: { argb: 'FF3B82F6' }, bold: true }
        }
        if (colNumber === 9) styleFinanceNoteCell(cell)
      })

      if (Array.isArray(row.departamentos)) {
        for (const dept of row.departamentos) {
          const deptRow = worksheet.addRow([
            `    └─ ${dept.dept}`,
            '',
            '',
            '',
            '',
            '',
            formatBRL(dept.valor),
            '',
            '',
          ])
          deptRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
            cell.font = { size: 9, color: { argb: 'FF4B5563' }, italic: true }
            if (cell.col === 9) styleFinanceNoteCell(cell)
          })
        }
      }
    }

    const spacer = worksheet.addRow([])
    spacer.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'medium', color: { argb: UNIT_HEADER_COLORS[unitLabel] } },
      }
    })
    worksheet.addRow([])
  }

  worksheet.columns = [
    { width: 45 },
    { width: 30 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 28 },
  ]

  if (duplicityData) addDuplicitySheet(workbook, duplicityData)

  const buffer = await workbook.xlsx.writeBuffer()
  saveBuffer(buffer as ArrayBuffer, `Relatorio_Auditoria_PRN_${Date.now()}.xlsx`)
}

export async function generateGroupedAuditExcel(
  data: any,
  duplicityData?: AnalysisRecord,
  observations?: Record<string, { observation: string }>,
  months: MonthInfo[] = DEFAULT_MONTHS,
) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Consolidado por Unidade')

  const crossAnalysis = data?.data?.byBlock || data?.data?.crossAnalysis?.byBlock || {}
  worksheet.addRow(['PRN FINANCEIRO - VISÃO CONSOLIDADA POR UNIDADE']).font = {
    bold: true,
    size: 16,
  }
  worksheet.addRow([`Data de Exportação: ${new Date().toLocaleString('pt-BR')}`])
  worksheet.addRow([])

  const UNIT_KEYS: Record<string, string> = {
    'PRN MATRIZ': 'prn_matriz',
    CAMBORIU: 'camboriu',
    PALHOCA: 'palhoca',
  }

  for (const [unitLabel, key] of Object.entries(UNIT_KEYS)) {
    const blockRows = Array.isArray(crossAnalysis[key]?.rows) ? crossAnalysis[key].rows : []
    const cockpitRows = buildCockpitRows(key, blockRows, months)
    const grouped = groupRowsByUnitConsolidated(cockpitRows)
    if (grouped.length === 0) continue

    const unitRow = worksheet.addRow([unitLabel])
    styleUnitHeader(unitRow, unitLabel)
    worksheet.mergeCells(`A${unitRow.number}:I${unitRow.number}`)

    const headerRow = worksheet.addRow(buildTableHeaders(months))
    styleTableHeader(headerRow)

    const unitBg = UNIT_ROW_COLORS[unitLabel] || 'FFFFFFFF'
    let isZebra = false

    for (const row of grouped) {
      isZebra = !isZebra
      const rowColor = isZebra ? unitBg : 'FFFFFFFF'
      const rowKey = `${row.unidade}|||${row.favorecido}|||${row.categoria}`
      const obsText = observations?.[rowKey]?.observation || ''

      const r = worksheet.addRow([
        row.favorecido,
        row.categoria,
        row.dataRegistro || '—',
        formatBRL(row.m1),
        formatBRL(row.m2),
        formatBRL(row.m3),
        formatBRL(row.atual),
        `${row.varPct?.toFixed(2)}%`,
        obsText,
      ])

      r.eachCell((cell, colNum) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } }
        if (colNum === 8) {
          if (row.status === 'Aumento') cell.font = { color: { argb: 'FFEF4444' }, bold: true }
          if (row.status === 'Queda') cell.font = { color: { argb: 'FF10B981' }, bold: true }
          if (row.status === 'Novo') cell.font = { color: { argb: 'FF3B82F6' }, bold: true }
        }
        if (colNum === 9) styleFinanceNoteCell(cell)
      })
    }

    const spacer = worksheet.addRow([])
    spacer.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'medium', color: { argb: UNIT_HEADER_COLORS[unitLabel] } },
      }
    })
    worksheet.addRow([])
  }

  worksheet.columns = [
    { width: 45 },
    { width: 30 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 28 },
  ]

  if (duplicityData) addDuplicitySheet(workbook, duplicityData)

  const buffer = await workbook.xlsx.writeBuffer()
  saveBuffer(buffer as ArrayBuffer, `Consolidado_Premium_PRN_${Date.now()}.xlsx`)
}
