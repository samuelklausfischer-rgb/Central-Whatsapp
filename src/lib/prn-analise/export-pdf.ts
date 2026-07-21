import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCurrency, formatPercentage } from '@/lib/prn-analise/formatters'
import { buildCockpitRows, groupDuplicateRows, groupRowsByUnitConsolidated, DEFAULT_MONTHS } from '@/lib/prn-analise/audit-utils'
import type { MonthInfo } from '@/lib/prn-analise/audit-utils'
import type { AnalysisRecord } from '@/services/prn-analise/analise-duplicidade'

const UNIT_COLORS: Record<string, number[]> = {
  'PRN MATRIZ': [0, 102, 204],
  CAMBORIU: [16, 185, 129],
  PALHOCA: [245, 158, 11],
}

function getUnitColor(unidade: string): number[] {
  return UNIT_COLORS[unidade] || [100, 100, 100]
}

function formatCurrencyDup(val: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
}

function formatDateDup(dateStr: string) {
  if (!dateStr) return '-'
  if (dateStr.includes('T')) return new Date(dateStr).toLocaleDateString('pt-BR')
  const p = dateStr.split('-')
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`
  return dateStr
}

function addDuplicitySection(doc: jsPDF, duplicityData: AnalysisRecord) {
  doc.addPage()
  let currentY = 20

  doc.setFontSize(18)
  doc.setTextColor(147, 51, 234)
  doc.text('ANÁLISE DE DUPLICIDADE', 14, currentY)
  currentY += 8

  doc.setFontSize(9)
  doc.setTextColor(100, 100, 100)
  doc.text(`Arquivo: ${duplicityData.file_name}`, 14, currentY)
  currentY += 5
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, currentY)
  currentY += 10

  autoTable(doc, {
    startY: currentY,
    head: [
      [
        'Total Registros',
        'Analisados',
        'Duplicidades',
        'Grupos',
        'G. Revisão Manual',
        'Estrutura Parcial',
      ],
    ],
    body: [
      [
        duplicityData.total_records || 0,
        duplicityData.analyzable_records || 0,
        duplicityData.duplicate_count || 0,
        duplicityData.group_count || 0,
        duplicityData.overall_manual_count || 0,
        duplicityData.partial_structure_count || 0,
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [147, 51, 234], halign: 'center' },
    bodyStyles: { halign: 'center', fontStyle: 'bold', fontSize: 10 },
  })

  currentY = (doc as any).lastAutoTable.finalY + 15

  const result_json = duplicityData.result_json
  if (!result_json) return

  const RECORD_HEAD = [
    'Linha',
    'Unidade',
    'Nome',
    'Departamento',
    'Valor',
    'Vencimento',
    'Parcela',
    'CPF/CNPJ',
  ]
  const RECORD_COL_STYLES = {
    0: { cellWidth: 12 },
    2: { cellWidth: 48 },
    3: { cellWidth: 35 },
    4: { halign: 'right' as const },
    5: { cellWidth: 22 },
  }

  const mapRecord = (r: any) => [
    r.linha_origem ?? r.linhaOrigem ?? '-',
    r.unidade ?? '-',
    r.nome_original ?? r.nomeOriginal ?? '-',
    r.departamento_original ?? r.departamentoOriginal ?? '-',
    formatCurrencyDup(r.valor_normalizado ?? r.valorNormalizado ?? 0),
    formatDateDup(r.vencimento ?? ''),
    r.parcela || '-',
    (r.cpf_cnpj ?? r.cpfCnpj) || '-',
  ]

  const renderGroups = (groups: any[], title: string, color: [number, number, number]) => {
    if (!groups || groups.length === 0) return
    if (currentY > 175) {
      doc.addPage()
      currentY = 20
    }
    doc.setFontSize(12)
    doc.setTextColor(color[0], color[1], color[2])
    doc.text(title, 14, currentY)
    currentY += 7

    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      if (currentY > 175) {
        doc.addPage()
        currentY = 20
      }
      doc.setFontSize(9)
      doc.setTextColor(60, 60, 60)
      doc.text(
        `Grupo ${g.groupId || i + 1} — ${g.keyName || g.records?.[0]?.nome_original || 'N/A'}`,
        16,
        currentY,
      )
      autoTable(doc, {
        startY: currentY + 3,
        head: [RECORD_HEAD],
        body: (g.records || []).map(mapRecord),
        headStyles: { fillColor: color, fontSize: 7.5 },
        styles: { fontSize: 7.5 },
        columnStyles: RECORD_COL_STYLES,
      })
      currentY = (doc as any).lastAutoTable.finalY + 7
    }
    currentY += 5
  }

  renderGroups(result_json.duplicateGroups, 'Duplicidades Confirmadas — Risco Crítico', [
    220, 38, 38,
  ])
  renderGroups(result_json.manualReviewGroups, 'Revisão de Contexto — Mesmo Departamento', [
    202, 138, 4,
  ])
  renderGroups(result_json.nameRepeatManualGroups, 'Revisão de Contexto — Nome Repetido', [
    202, 138, 4,
  ])

  const partialRecords = (result_json.partialStructureRecords || []).filter(
    (r: any) => r.vencimento && r.vencimento !== '-' && String(r.vencimento).trim() !== '',
  )
  if (partialRecords.length > 0) {
    if (currentY > 175) {
      doc.addPage()
      currentY = 20
    }
    doc.setFontSize(12)
    doc.setTextColor(37, 99, 235)
    doc.text('Monitoramento — Estrutura Parcial', 14, currentY)
    autoTable(doc, {
      startY: currentY + 4,
      head: [RECORD_HEAD],
      body: partialRecords.map(mapRecord),
      headStyles: { fillColor: [37, 99, 235], fontSize: 7.5 },
      styles: { fontSize: 7.5 },
      columnStyles: RECORD_COL_STYLES,
    })
  }
}

export async function generateAuditPDF(data: any, duplicityData?: AnalysisRecord, months: MonthInfo[] = DEFAULT_MONTHS) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const dateStr =
    data?.meta?.data_referencia || data?.request?.referenceDate || new Date().toLocaleDateString('pt-BR')
  const requestId = data?.requestId || data?.meta?.requestId || 'N/A'

  doc.setFontSize(22)
  doc.setTextColor(0, 102, 204)
  doc.text('PRN FINANCEIRO', 14, 20)
  doc.setFontSize(14)
  doc.setTextColor(0)
  doc.text('Relatório Consolidado de Auditoria Financeira', 14, 30)
  doc.setFontSize(10)
  doc.text(`Data da Auditoria: ${dateStr}`, 14, 38)
  doc.text(`Protocolo: ${requestId}`, 14, 43)

  const summary = data?.summary || {}
  autoTable(doc, {
    startY: 50,
    head: [['TOTAL DESPESAS (DIA)']],
    body: [[formatCurrency(summary.totalDespesas)]],
    theme: 'grid',
    headStyles: { fillColor: [40, 40, 40] },
  })

  const crossAnalysis = data?.data?.crossAnalysis || data?.data || {}
  const byBlock = crossAnalysis.byBlock || {}
  const blockKeys: Record<string, string> = {
    prn_matriz: 'PRN MATRIZ',
    camboriu: 'CAMBORIU',
    palhoca: 'PALHOCA',
  }

  const allRows: any[] = []
  for (const [key, label] of Object.entries(blockKeys)) {
    const blockRows = Array.isArray(byBlock[key]?.rows) ? byBlock[key].rows : []
    const cockpitRows = buildCockpitRows(key, blockRows)
    const grouped = groupDuplicateRows(cockpitRows)
    for (const r of grouped) {
      ;(r as any)._unidadeLabel = label
      allRows.push(r)
    }
  }

  const rowsByUnidade: Record<string, any[]> = {
    'PRN MATRIZ': [],
    CAMBORIU: [],
    PALHOCA: [],
  }
  for (const r of allRows) {
    const un = (r as any)._unidadeLabel || 'PRN MATRIZ'
    if (rowsByUnidade[un]) rowsByUnidade[un].push(r)
  }

  let currentY = (doc as any).lastAutoTable.finalY + 20

  for (const unidade of ['PRN MATRIZ', 'CAMBORIU', 'PALHOCA']) {
    const blockRows = rowsByUnidade[unidade] || []
    if (blockRows.length === 0) continue
    if (currentY > 180) {
      doc.addPage()
      currentY = 20
    }
    const color = getUnitColor(unidade)
    doc.setFontSize(16)
    doc.setTextColor(color[0], color[1], color[2])
    doc.text(unidade, 14, currentY)
    currentY += 8
    doc.setFontSize(10)
    doc.setTextColor(0)
    doc.text(`${blockRows.length} registros encontrados`, 14, currentY)
    currentY += 6

    const tableHead = ['Favorecido', 'Categoria', 'Data Reg.', months[0]?.abbr ?? 'M1', months[1]?.abbr ?? 'M2', months[2]?.abbr ?? 'M3', 'Atual', 'Var %']
    const tableRows: any[] = []
    let groupIndex = 0
    for (const row of blockRows) {
      const currentGroupIndex = groupIndex++
      tableRows.push({
        isDetail: false,
        groupIndex: currentGroupIndex,
        values: [
          row.favorecido || 'Desconhecido',
          row.categoria || 'Indefinido',
          row.dataRegistro || '—',
          formatCurrency(row.m1 || 0),
          formatCurrency(row.m2 || 0),
          formatCurrency(row.m3 || 0),
          formatCurrency(row.atual || 0),
          formatPercentage(row.varPct || 0),
        ],
      })
      if (Array.isArray(row.departamentos)) {
        for (const dept of row.departamentos) {
          tableRows.push({
            isDetail: true,
            groupIndex: currentGroupIndex,
            values: [
              `    ${dept.dept || 'Sem depto'}`,
              '',
              '',
              '',
              '',
              '',
              formatCurrency(dept.valor || 0),
              '',
            ],
          })
        }
      }
    }

    autoTable(doc, {
      startY: currentY,
      head: [tableHead],
      body: tableRows.map((r) => r.values),
      theme: 'grid',
      headStyles: { fillColor: color },
      columnStyles: {
        0: { cellWidth: 48 },
        1: { cellWidth: 28 },
        2: { cellWidth: 20, halign: 'center' },
        6: { halign: 'right', fontStyle: 'bold' },
        7: { halign: 'right' },
      },
      didParseCell: (data: any) => {
        const rowMeta = tableRows[data.row.index]
        if (data.section === 'body') {
          if (rowMeta?.isDetail) {
            data.cell.styles.fillColor = [243, 232, 255]
            data.cell.styles.textColor = [90, 90, 90]
            data.cell.styles.fontSize = 8
          } else {
            const isOddGroup = (rowMeta?.groupIndex || 0) % 2 === 0
            data.cell.styles.fillColor = isOddGroup ? [217, 230, 249] : [242, 247, 254]
            data.cell.styles.textColor = [30, 30, 30]
            data.cell.styles.fontSize = 9
          }
        }
        if (data.section === 'body' && !rowMeta?.isDetail && data.column.index === 7) {
          const valStr = data.cell.text[0].replace('%', '').replace(',', '.')
          const val = parseFloat(valStr)
          if (Math.abs(val) > 25) {
            data.cell.styles.textColor = [220, 53, 69]
            data.cell.styles.fontStyle = 'bold'
          }
        }
      },
    })

    currentY = (doc as any).lastAutoTable.finalY + 15
  }

  if (duplicityData) addDuplicitySection(doc, duplicityData)

  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(
      `Página ${i} de ${pageCount} - Gerado eletronicamente em ${new Date().toLocaleString()}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' },
    )
  }

  doc.save(`Auditoria_PRN_${requestId}.pdf`)
}

export async function generateGroupedAuditPDF(data: any, duplicityData?: AnalysisRecord, months: MonthInfo[] = DEFAULT_MONTHS) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const dateStr =
    data?.meta?.data_referencia || data?.request?.referenceDate || new Date().toLocaleDateString('pt-BR')
  const requestId = data?.requestId || data?.meta?.requestId || 'N/A'

  doc.setFontSize(22)
  doc.setTextColor(0, 102, 204)
  doc.text('PRN FINANCEIRO', 14, 20)
  doc.setFontSize(14)
  doc.setTextColor(0)
  doc.text('Relatório de Auditoria Financeira - Visão Agrupada por Unidade', 14, 30)
  doc.setFontSize(10)
  doc.text(`Data da Auditoria: ${dateStr}`, 14, 38)
  doc.text(`Protocolo: ${requestId}`, 14, 43)

  const summary = data?.summary || {}
  autoTable(doc, {
    startY: 50,
    head: [['TOTAL DESPESAS (DIA)']],
    body: [[formatCurrency(summary.totalDespesas)]],
    theme: 'grid',
    headStyles: { fillColor: [40, 40, 40] },
  })

  const unitConfigs = [
    { key: 'prn_matriz', label: 'PRN MATRIZ', color: [0, 102, 204] as [number, number, number] },
    { key: 'camboriu', label: 'CAMBORIU', color: [16, 185, 129] as [number, number, number] },
    { key: 'palhoca', label: 'PALHOCA', color: [245, 158, 11] as [number, number, number] },
  ]

  const crossAnalysis = data?.data?.crossAnalysis || data?.data || {}
  const byBlock = crossAnalysis.byBlock || {}
  let currentY = (doc as any).lastAutoTable.finalY + 20

  for (const unit of unitConfigs) {
    const blockRows = Array.isArray(byBlock[unit.key]?.rows) ? byBlock[unit.key].rows : []
    const cockpitRows = buildCockpitRows(unit.key, blockRows)
    const groupedRows = groupRowsByUnitConsolidated(cockpitRows)
    if (groupedRows.length === 0) continue
    if (currentY > 180) {
      doc.addPage()
      currentY = 20
    }
    doc.setFontSize(16)
    doc.setTextColor(unit.color[0], unit.color[1], unit.color[2])
    doc.text(unit.label, 14, currentY)
    currentY += 8
    doc.setFontSize(10)
    doc.setTextColor(0)
    doc.text(`${groupedRows.length} registros consolidados`, 14, currentY)
    currentY += 6

    const tableHead = ['Favorecido', 'Categoria', 'Data Reg.', months[0]?.abbr ?? 'M1', months[1]?.abbr ?? 'M2', months[2]?.abbr ?? 'M3', 'Atual', 'Var %']
    const tableRows = groupedRows.map((row) => ({
      values: [
        row.favorecido || 'Desconhecido',
        row.categoria || 'Indefinido',
        row.dataRegistro || '—',
        formatCurrency(row.m1 || 0),
        formatCurrency(row.m2 || 0),
        formatCurrency(row.m3 || 0),
        formatCurrency(row.atual || 0),
        formatPercentage(row.varPct || 0),
      ],
    }))

    autoTable(doc, {
      startY: currentY,
      head: [tableHead],
      body: tableRows.map((r) => r.values),
      theme: 'grid',
      headStyles: { fillColor: unit.color },
      columnStyles: {
        0: { cellWidth: 48 },
        1: { cellWidth: 28 },
        2: { cellWidth: 20, halign: 'center' },
        6: { halign: 'right', fontStyle: 'bold' },
        7: { halign: 'right' },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body') {
          const isOdd = data.row.index % 2 === 0
          data.cell.styles.fillColor = isOdd ? [217, 230, 249] : [242, 247, 254]
          data.cell.styles.textColor = [30, 30, 30]
          data.cell.styles.fontSize = 9
          if (data.column.index === 7) {
            const valStr = data.cell.text[0].replace('%', '').replace(',', '.')
            const val = parseFloat(valStr)
            if (Math.abs(val) > 25) {
              data.cell.styles.textColor = [220, 53, 69]
              data.cell.styles.fontStyle = 'bold'
            }
          }
        }
      },
    })
    currentY = (doc as any).lastAutoTable.finalY + 15
  }

  if (duplicityData) addDuplicitySection(doc, duplicityData)

  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(
      `Página ${i} de ${pageCount} - Gerado em ${new Date().toLocaleString()}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' },
    )
  }

  doc.save(`Auditoria_Agrupada_PRN_${requestId}.pdf`)
}
