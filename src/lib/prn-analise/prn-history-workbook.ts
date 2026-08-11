import * as XLSX from 'xlsx'
import { monthInfo, type MonthInfo } from './audit-utils'

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export type HistorySourceMeta = {
  original_filename: string
  source: 'vault' | 'temporary' | 'legacy'
}

export type HistorySheetData = {
  sourceFile: string
  sheetName: string
  rows: unknown[][]
}

/**
 * Cobertura de meses dos arquivos históricos selecionados.
 * Usada para avisar o usuário ANTES de disparar a análise.
 */
export type HistoryCoverage = {
  /** Todos os meses distintos encontrados, do mais antigo para o mais recente. */
  months: MonthInfo[]
  /** Ao menos um dos arquivos tinha a aba consolidada "financas". */
  hasConsolidatedSheet: boolean
  /** Arquivos que não tinham a aba "financas" (caíram no caminho legado). */
  filesWithoutSheet: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES DO NOVO FORMATO CONSOLIDADO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nome da aba que identifica o novo formato consolidado (todas as matrizes
 * em uma única aba organizada em blocos de colunas).
 */
const CONSOLIDATED_SHEET_NAME = 'financas'

/**
 * Mapeamento dos 3 blocos de colunas da planilha consolidada.
 * Cada bloco representa uma matriz e suas respectivas colunas:
 *   colForn  = Fornecedor (Nome Fantasia)
 *   colValor = Valor da Conta
 *   colCat   = Categoria
 *   colData  = Data de Registro (número serial do Excel)
 */
const CONSOLIDATED_BLOCKS = [
  { name: 'PRN MATRIZ', colForn: 0,  colValor: 1,  colCat: 2,  colData: 3  },
  { name: 'CAMBORIU',   colForn: 5,  colValor: 6,  colCat: 7,  colData: 8  },
  { name: 'PALHOCA',    colForn: 10, colValor: 11, colCat: 12, colData: 13 },
] as const

// ALLOWED_MONTHS é calculado dinamicamente por detectMonths() abaixo

/**
 * Linha (índice base-zero) a partir da qual os dados reais começam.
 * Linha 0 = Títulos das matrizes  (PRN MATRIZ / CAMBORIÚ / PALHOÇA)
 * Linha 1 = Cabeçalhos das colunas (Fornecedor, Valor, Categoria, Data)
 * Linha 2 = Primeiro registro real
 */
const DATA_START_ROW = 2

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrai {month, year} de qualquer valor de data suportado:
 *   - número serial do Excel (ex: 45678)
 *   - string DD/MM/AAAA (ex: "15/04/2025")
 *   - string ISO AAAA-MM-DD (ex: "2025-04-15")
 *   - objeto Date
 * Retorna null se não conseguir extrair.
 */
function parseDateValue(value: unknown): { m: number; y: number } | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    try {
      const parsed = XLSX.SSF.parse_date_code(value)
      return parsed ? { m: parsed.m, y: parsed.y } : null
    } catch {
      return null
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { m: value.getMonth() + 1, y: value.getFullYear() }
  }

  const raw = String(value ?? '').trim()
  if (!raw) return null

  // DD/MM/AAAA
  const brMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (brMatch) return { m: parseInt(brMatch[2], 10), y: parseInt(brMatch[3], 10) }

  // AAAA-MM-DD
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return { m: parseInt(isoMatch[2], 10), y: parseInt(isoMatch[1], 10) }

  return null
}

/**
 * Converte um valor de data para mês (1-12). Aceita serial numérico, DD/MM/AAAA ou ISO.
 */
function excelSerialToMonth(value: unknown): number | null {
  const parsed = parseDateValue(value)
  return parsed ? parsed.m : null
}

/**
 * Converte um número serial do Excel para string ISO (YYYY-MM-DD).
 * Retorna null se não conseguir converter.
 */
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

/**
 * Verifica se a linha de um bloco possui dados válidos (fornecedor ou data).
 * Aceita data como serial numérico, string DD/MM/AAAA ou ISO.
 */
function blockRowHasData(row: unknown[], colForn: number, colData: number): boolean {
  const forn = row[colForn]
  const data = row[colData]
  return (
    (typeof forn === 'string' && forn.trim().length > 0) ||
    parseDateValue(data) !== null
  )
}

/**
 * Normaliza nome de aba para comparação tolerante: minúsculas, sem acento,
 * sem espaços nas bordas. Permite reconhecer "Financas", "Finanças", " financas ", etc.
 */
const DIACRITICS_REGEX = /[̀-ͯ]/g

function normalizeSheetName(name: string): string {
  return name
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .trim()
    .toLowerCase()
}

/**
 * Encontra o nome real da aba consolidada dentro do workbook, tolerando
 * variações de maiúsculas/minúsculas, acentos e espaços em relação a "financas".
 */
function findConsolidatedSheetName(workbook: XLSX.WorkBook): string | null {
  const target = normalizeSheetName(CONSOLIDATED_SHEET_NAME)
  return workbook.SheetNames.find((name) => normalizeSheetName(name) === target) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRAÇÃO: FORMATO CONSOLIDADO (NOVO)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza categorias históricas genéricas para bater exatamente com a
 * nomenclatura atual de cada unidade esperada pelo n8n no cruzamento.
 */
function normalizeCategoryForN8n(cat: string, unit: string): string {
  const c = cat.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()

  if (unit === 'CAMBORIU' && c === 'HONORARIOS MEDICOS') {
    return 'Honorários Médicos PJ'
  }
  if (unit === 'PALHOCA' && c === 'HONORARIOS MEDICOS') {
    return 'Honorário Médico'
  }

  return cat
}

/**
 * Coleta TODOS os meses distintos presentes nos dados da planilha consolidada.
 * Varre todos os blocos coletando pares {num, year} e devolve em ordem
 * cronológica crescente (mais antigo primeiro).
 */
function collectDistinctMonths(dataRows: unknown[][]): MonthInfo[] {
  const seen = new Map<string, MonthInfo>()

  for (const block of CONSOLIDATED_BLOCKS) {
    const { colData } = block
    for (const row of dataRows) {
      if (!Array.isArray(row)) continue
      const parsed = parseDateValue(row[colData])
      if (!parsed) continue
      const key = `${parsed.y}-${parsed.m}`
      if (!seen.has(key)) {
        seen.set(key, monthInfo(parsed.m, parsed.y))
      }
    }
  }

  return Array.from(seen.values()).sort(
    (a, b) => (a.year * 100 + a.num) - (b.year * 100 + b.num),
  )
}

/**
 * Quantos meses o cruzamento usa como referência histórica.
 */
export const HISTORY_MONTH_WINDOW = 3

/**
 * Detecta os 3 meses mais recentes presentes nos dados da planilha consolidada.
 */
function detectMonths(dataRows: unknown[][]): MonthInfo[] {
  return collectDistinctMonths(dataRows).slice(-HISTORY_MONTH_WINDOW)
}

/**
 * Processa a aba "financas" do novo formato consolidado.
 *
 * Para cada bloco (MATRIZ, CAMBORIU, PALHOCA), percorre as linhas de dados
 * (a partir da linha DATA_START_ROW) e:
 *  1. Verifica se a linha possui dados para aquele bloco.
 *  2. Converte a data serial para ISO e extrai o mês.
 *  3. Descarta linhas cujo mês não esteja em `allowedYearMonths` (os meses
 *     detectados dinamicamente por `detectMonths`).
 *  4. Monta uma linha normalizada com os 4 campos do bloco.
 *
 * Retorna um HistorySheetData por bloco, com sheetName identificando a matriz,
 * garantindo compatibilidade com o formato esperado pelo n8n.
 */
function extractConsolidatedBlocks(
  sourceFile: string,
  rows: unknown[][],
  allowedYearMonths: Set<string>,
): HistorySheetData[] {
  const dataRows = rows.slice(DATA_START_ROW)
  const results: HistorySheetData[] = []

  for (const block of CONSOLIDATED_BLOCKS) {
    const { name, colForn, colValor, colCat, colData } = block
    const blockRows: unknown[][] = []

    // Cabeçalho normalizado para manter compatibilidade com o n8n
    blockRows.push(['Fornecedor', 'Valor', 'Categoria', 'Data'])

    for (const row of dataRows) {
      if (!Array.isArray(row)) continue
      if (!blockRowHasData(row, colForn, colData)) continue

      const parsed = parseDateValue(row[colData])
      if (!parsed) continue
      const yearMonthKey = `${parsed.y}-${String(parsed.m).padStart(2, '0')}`
      if (!allowedYearMonths.has(yearMonthKey)) continue

      const isoDate = excelSerialToIso(row[colData])
      const fornecedor = typeof row[colForn] === 'string' ? (row[colForn] as string).trim() : String(row[colForn] ?? '').trim()
      const valor = typeof row[colValor] === 'number' ? row[colValor] : Number(String(row[colValor] ?? '0').replace(',', '.')) || 0

      const rawCategoria = typeof row[colCat] === 'string' ? (row[colCat] as string).trim() : String(row[colCat] ?? '').trim()
      const categoria = normalizeCategoryForN8n(rawCategoria, name)

      blockRows.push([fornecedor, valor, categoria, isoDate])
    }

    // Só inclui o bloco se tiver ao menos 1 linha de dado (além do cabeçalho)
    if (blockRows.length > 1) {
      results.push({
        sourceFile,
        sheetName: `${sourceFile}::${name}`,
        rows: blockRows,
      })
    }
  }

  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRAÇÃO: FORMATO LEGADO (ANTIGO)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processa planilhas no formato antigo (uma matriz por aba ou por arquivo).
 * Mantém o comportamento original para garantir compatibilidade retroativa.
 */
function extractLegacySheets(
  sourceFile: string,
  workbook: XLSX.WorkBook,
): HistorySheetData[] {
  const results: HistorySheetData[] = []

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    if (!ws || !ws['!ref']) continue

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
    if (rows.length === 0) continue

    results.push({
      sourceFile,
      sheetName: `${sourceFile}::${sheetName}`,
      rows,
    })
  }

  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL EXPORTADA
// ─────────────────────────────────────────────────────────────────────────────

type ParsedConsolidatedFile = { fileName: string; rows: unknown[][]; dataRows: unknown[][] }

type ParsedHistoryFiles = {
  consolidatedFiles: ParsedConsolidatedFile[]
  legacySheets: HistorySheetData[]
  filesWithoutSheet: string[]
}

/**
 * Parseia cada arquivo e separa consolidado (aba "financas", com tolerância a
 * maiúsculas/acentos/espaços) de legado — sem filtrar meses ainda.
 *
 * Compartilhado por `extractHistoricalRows` e `inspectHistoricalCoverage`,
 * para que a prévia mostrada no formulário e o que é de fato enviado à análise
 * nunca divirjam.
 */
async function parseHistoryFiles(files: File[]): Promise<ParsedHistoryFiles> {
  const consolidatedFiles: ParsedConsolidatedFile[] = []
  const legacySheets: HistorySheetData[] = []
  const filesWithoutSheet: string[] = []

  for (const file of files) {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

    const matchedSheetName = findConsolidatedSheetName(workbook)

    if (matchedSheetName) {
      const ws = workbook.Sheets[matchedSheetName]
      if (!ws || !ws['!ref']) continue

      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
      const dataRows = rows.slice(DATA_START_ROW)
      consolidatedFiles.push({ fileName: file.name, rows, dataRows })
    } else {
      // FORMATO LEGADO: uma matriz por aba (comportamento anterior preservado)
      filesWithoutSheet.push(file.name)
      const legacy = extractLegacySheets(file.name, workbook)
      legacySheets.push(...legacy)
    }
  }

  return { consolidatedFiles, legacySheets, filesWithoutSheet }
}

/**
 * Lê os arquivos históricos apenas para descobrir quais meses eles cobrem,
 * sem montar os dados da análise. Serve para avisar no formulário — antes de
 * enviar — que a seleção cobre menos meses do que o cruzamento espera.
 *
 * Diferente de `extractHistoricalRows`, devolve TODOS os meses distintos
 * encontrados (não só os 3 mais recentes), para que a UI possa dizer quantos
 * meses existem e quais serão realmente usados.
 */
export async function inspectHistoricalCoverage(files: File[]): Promise<HistoryCoverage> {
  if (files.length === 0) {
    return { months: [], hasConsolidatedSheet: false, filesWithoutSheet: [] }
  }

  const { consolidatedFiles, filesWithoutSheet } = await parseHistoryFiles(files)
  const combinedDataRows = consolidatedFiles.flatMap((f) => f.dataRows)

  return {
    months: collectDistinctMonths(combinedDataRows),
    hasConsolidatedSheet: consolidatedFiles.length > 0,
    filesWithoutSheet,
  }
}

/**
 * Extrai os dados históricos de uma lista de arquivos Excel.
 *
 * Detecta automaticamente o formato da planilha:
 *   - NOVO (consolidado): aba "financas" com 3 blocos de colunas (MATRIZ,
 *     CAMBORIU, PALHOCA). Filtra pelos 3 meses mais recentes encontrados e
 *     fragmenta em 3 conjuntos de dados independentes.
 *   - LEGADO: formato antigo com uma matriz por aba. Comportamento preservado.
 */
export async function extractHistoricalRows(
  files: File[],
  _meta?: HistorySourceMeta[],
): Promise<{
  sheets: HistorySheetData[]
  detectedMonths: MonthInfo[]
  filesWithoutSheet: string[]
}> {
  if (files.length === 0) {
    throw new Error('Selecione ao menos uma planilha histórica para a análise.')
  }

  const { consolidatedFiles, legacySheets, filesWithoutSheet } = await parseHistoryFiles(files)

  // Detecta os 3 meses mais recentes considerando TODOS os arquivos consolidados
  // juntos (não por arquivo isolado) — evita que a ordem de seleção decida o resultado.
  const combinedDataRows = consolidatedFiles.flatMap((f) => f.dataRows)
  const detectedMonths = detectMonths(combinedDataRows)
  const allowedYearMonths = new Set(
    detectedMonths.map((m) => `${m.year}-${String(m.num).padStart(2, '0')}`),
  )

  // 2ª passagem: extrai os blocos de cada arquivo consolidado usando o MESMO filtro de meses
  const consolidatedSheets = consolidatedFiles.flatMap((f) =>
    extractConsolidatedBlocks(f.fileName, f.rows, allowedYearMonths),
  )

  const allSheets: HistorySheetData[] = [...consolidatedSheets, ...legacySheets]

  if (allSheets.length === 0) {
    throw new Error('Nenhuma aba válida encontrada nos arquivos históricos.')
  }

  return { sheets: allSheets, detectedMonths, filesWithoutSheet }
}
