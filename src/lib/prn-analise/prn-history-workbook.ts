import * as XLSX from 'xlsx'

export type HistorySourceMeta = {
  original_filename: string
  source: 'vault' | 'temporary' | 'legacy'
}

export type HistorySheetData = {
  sourceFile: string
  sheetName: string
  rows: unknown[][]
}

const CONSOLIDATED_SHEET_NAME = 'financas'

const CONSOLIDATED_BLOCKS = [
  { name: 'PRN MATRIZ', colForn: 0, colValor: 1, colCat: 2, colData: 3 },
  { name: 'CAMBORIU', colForn: 5, colValor: 6, colCat: 7, colData: 8 },
  { name: 'PALHOCA', colForn: 10, colValor: 11, colCat: 12, colData: 13 },
] as const

const ALLOWED_MONTHS = new Set([3, 4, 5])
const DATA_START_ROW = 2

function excelSerialToMonth(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  try {
    const parsed = XLSX.SSF.parse_date_code(value)
    return parsed ? parsed.m : null
  } catch {
    return null
  }
}

function excelSerialToIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    try {
      const parsed = XLSX.SSF.parse_date_code(value)
      if (parsed) {
        const m = String(parsed.m).padStart(2, '0')
        const d = String(parsed.d).padStart(2, '0')
        return `${parsed.y}-${m}-${d}`
      }
    } catch {
      return null
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (brMatch) {
    const [, day, month, year] = brMatch
    return `${year}-${month}-${day}`
  }
  return null
}

function blockRowHasData(row: unknown[], colForn: number, colData: number): boolean {
  const forn = row[colForn]
  const data = row[colData]
  return (
    (typeof forn === 'string' && forn.trim().length > 0) ||
    (typeof data === 'number' && data > 0)
  )
}

function normalizeCategoryForN8n(cat: string, unit: string): string {
  const c = cat
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
  if (unit === 'CAMBORIU' && c === 'HONORARIOS MEDICOS') return 'Honorários Médicos PJ'
  if (unit === 'PALHOCA' && c === 'HONORARIOS MEDICOS') return 'Honorário Médico'
  return cat
}

function extractConsolidatedBlocks(sourceFile: string, rows: unknown[][]): HistorySheetData[] {
  const dataRows = rows.slice(DATA_START_ROW)
  const results: HistorySheetData[] = []

  for (const block of CONSOLIDATED_BLOCKS) {
    const { name, colForn, colValor, colCat, colData } = block
    const blockRows: unknown[][] = [['Fornecedor', 'Valor', 'Categoria', 'Data']]

    for (const row of dataRows) {
      if (!Array.isArray(row)) continue
      if (!blockRowHasData(row, colForn, colData)) continue
      const month = excelSerialToMonth(row[colData])
      if (month === null || !ALLOWED_MONTHS.has(month)) continue
      const isoDate = excelSerialToIso(row[colData])
      const fornecedor =
        typeof row[colForn] === 'string'
          ? (row[colForn] as string).trim()
          : String(row[colForn] ?? '').trim()
      const valor =
        typeof row[colValor] === 'number'
          ? row[colValor]
          : Number(String(row[colValor] ?? '0').replace(',', '.')) || 0
      const rawCategoria =
        typeof row[colCat] === 'string'
          ? (row[colCat] as string).trim()
          : String(row[colCat] ?? '').trim()
      const categoria = normalizeCategoryForN8n(rawCategoria, name)
      blockRows.push([fornecedor, valor, categoria, isoDate])
    }

    if (blockRows.length > 1) {
      results.push({ sourceFile, sheetName: `${sourceFile}::${name}`, rows: blockRows })
    }
  }
  return results
}

function extractLegacySheets(sourceFile: string, workbook: XLSX.WorkBook): HistorySheetData[] {
  const results: HistorySheetData[] = []
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    if (!ws || !ws['!ref']) continue
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
    if (rows.length === 0) continue
    results.push({ sourceFile, sheetName: `${sourceFile}::${sheetName}`, rows })
  }
  return results
}

export async function extractHistoricalRows(
  files: File[],
  _meta?: HistorySourceMeta[],
): Promise<HistorySheetData[]> {
  if (files.length === 0) {
    throw new Error('Selecione ao menos uma planilha histórica para a análise.')
  }
  const allSheets: HistorySheetData[] = []
  for (const file of files) {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
    const isConsolidated = workbook.SheetNames.includes(CONSOLIDATED_SHEET_NAME)
    if (isConsolidated) {
      const ws = workbook.Sheets[CONSOLIDATED_SHEET_NAME]
      if (!ws || !ws['!ref']) continue
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
      allSheets.push(...extractConsolidatedBlocks(file.name, rows))
    } else {
      allSheets.push(...extractLegacySheets(file.name, workbook))
    }
  }
  if (allSheets.length === 0) {
    throw new Error('Nenhuma aba válida encontrada nos arquivos históricos.')
  }
  return allSheets
}
