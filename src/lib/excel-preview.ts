import * as XLSX from 'xlsx'

export type ExcelPreview = { rows: unknown[][]; sheetName: string | null } | null

const cache = new Map<string, Promise<ExcelPreview>>()

/** Lê só um recorte pequeno da primeira planilha (pra mostrar como miniatura). Cacheado por URL. */
export function getExcelPreview(url: string, maxRows = 6, maxCols = 6): Promise<ExcelPreview> {
  const cached = cache.get(url)
  if (cached) return cached
  const promise = loadExcelPreview(url, maxRows, maxCols)
  cache.set(url, promise)
  return promise
}

async function loadExcelPreview(url: string, maxRows: number, maxCols: number): Promise<ExcelPreview> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = await res.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const sheetName = wb.SheetNames[0] ?? null
    if (!sheetName) return { rows: [], sheetName: null }
    const allRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true }) as unknown[][]
    const rows = allRows.slice(0, maxRows).map((row) => (row as unknown[]).slice(0, maxCols))
    return { rows, sheetName }
  } catch (err) {
    console.error('Erro ao gerar prévia da planilha:', err)
    return null
  }
}
