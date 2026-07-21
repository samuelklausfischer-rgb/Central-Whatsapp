// ─── Tipos de meses dinâmicos ────────────────────────────────────────────────

export interface MonthInfo {
  num: number   // 1–12
  year: number  // ex: 2025
  abbr: string  // 'Mar', 'Abr', 'Jun'
  full: string  // 'Março', 'Abril', 'Junho'
}

const MONTH_ABBR: Record<number, [string, string]> = {
  1:  ['Jan', 'Janeiro'],   2:  ['Fev', 'Fevereiro'],  3:  ['Mar', 'Março'],
  4:  ['Abr', 'Abril'],     5:  ['Mai', 'Maio'],        6:  ['Jun', 'Junho'],
  7:  ['Jul', 'Julho'],     8:  ['Ago', 'Agosto'],      9:  ['Set', 'Setembro'],
  10: ['Out', 'Outubro'],  11:  ['Nov', 'Novembro'],   12:  ['Dez', 'Dezembro'],
}

export function monthInfo(num: number, year: number): MonthInfo {
  const [abbr, full] = MONTH_ABBR[num] ?? [`M${num}`, `Mês ${num}`]
  return { num, year, abbr, full }
}

export const DEFAULT_MONTHS: MonthInfo[] = [
  monthInfo(3, 2025), monthInfo(4, 2025), monthInfo(5, 2025),
]

// ─────────────────────────────────────────────────────────────────────────────

const monthNames: Record<string, string> = {
  '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março',    '04': 'Abril',
  '05': 'Maio',    '06': 'Junho',     '07': 'Julho',    '08': 'Agosto',
  '09': 'Setembro','10': 'Outubro',   '11': 'Novembro', '12': 'Dezembro',
}

export function formatMonthName(monthCode: string): string {
  if (!monthCode || !monthCode.includes('-')) return monthCode
  const [, month] = monthCode.split('-')
  const name = monthNames[month]
  return name ? `${name}` : monthCode
}

export interface AuditRow {
  nome: string
  categoria?: string | null
  valorDia: number
  valorPago: number
  qtdTitulosDia: number
  totalHistorico: number
  mediaHistoricaMensal: number
  divergenciaPct: number | null
  alertaDivergencia25: boolean
  direcaoDivergencia: string
  grupoMensal: string
  meses: Record<string, number>
  categoriaOriginal?: string
  categoriaCruzamento?: string | null
  subcategoria?: string | null
  subcategoriaOriginal?: string | null
  subcategoriaCruzamento?: string | null
  subcategoriaLabel?: string | null
  departamento?: string
}

export function normalizeAuditData(rawRows: any[], _months: string[]): AuditRow[] {
  return rawRows.map(row => ({
    nome: row.nome || 'Desconhecido',
    categoria: row.categoria || null,
    valorDia: row.valorDia || 0,
    valorPago: row.valorPago || row.valorDia || 0,
    qtdTitulosDia: row.qtdTitulosDia || 1,
    totalHistorico: row.totalHistorico || 0,
    mediaHistoricaMensal: row.mediaHistoricaMensal || 0,
    divergenciaPct: row.divergenciaPct,
    alertaDivergencia25: !!row.alertaDivergencia25,
    direcaoDivergencia: row.direcaoDivergencia || 'estavel',
    grupoMensal: row.grupoMensal || 'outros',
    meses: row.meses || {},
    categoriaOriginal: row.categoriaOriginal,
    categoriaCruzamento: row.categoriaCruzamento || null,
    subcategoria: row.subcategoria || null,
    subcategoriaOriginal: row.subcategoriaOriginal || null,
    subcategoriaCruzamento: row.subcategoriaCruzamento || null,
    subcategoriaLabel: row.subcategoriaLabel || null,
    departamento: row.departamento
  }))
}

export type CockpitStatus = 'Aumento' | 'Queda' | 'Novo' | 'Igual'

export interface CockpitRow {
  unidade: string
  favorecido: string
  categoria: string
  m1: number   // mês mais antigo dos 3
  m2: number   // mês do meio
  m3: number   // mês mais recente (base do varPct)
  atual: number
  difVsM2: number
  difVsM3: number
  status: CockpitStatus
  tipoMatch: string
  qtdDepartamentos: number
  departamentos: Array<{ dept: string; valor: number }>
  media: number
  varPct: number
  dataRegistro?: string
  vencimento?: string
  _raw?: any
}

export function ns(s: unknown): string {
  if (s === null || s === undefined) return ''
  return String(s).trim().toUpperCase().replace(/\s+/g, ' ')
}

// Normaliza data para DD/MM/YYYY independente do formato de entrada
function toDisplayDate(val: unknown): string | undefined {
  if (!val) return undefined
  const s = String(val).trim()
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.substring(0, 10).split('-')
    return `${d}/${m}/${y}`
  }
  const num = Number(s)
  if (!isNaN(num) && num > 20000 && num < 60000) {
    const dt = new Date((num - 25569) * 86400 * 1000)
    return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`
  }
  return s || undefined
}

// Remove tudo que não é letra/número para criar chave de deduplicação robusta
function normalizeKey(s: string): string {
  return s.replace(/[^A-Z0-9]/g, '')
}

export function catMatch(curCat: string, histCat: string): boolean {
  if (curCat === histCat) return true
  if (curCat.includes('HONOR') && histCat.includes('HONOR')) {
    if (histCat.includes('PJ & SCP') && (curCat.includes('PJ') || curCat.includes('SCP'))) return true
    if (curCat.includes('PJ & SCP') && (histCat.includes('PJ') || histCat.includes('SCP'))) return true
  }
  return false
}

export function calcStatus(dif: number, tipoMatch: string): CockpitStatus {
  if (dif > 0.01) return 'Aumento'
  if (dif < -0.01) return 'Queda'
  if (tipoMatch.includes('Novo')) return 'Novo'
  return 'Igual'
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

// Variação % contra o mês mais recente com dado. Sem histórico → 0%.
function calcVarPct(atual: number, m1: number, m2: number, m3: number): number {
  const base = m3 > 0 ? m3 : m2 > 0 ? m2 : m1 > 0 ? m1 : 0
  if (base <= 0) return 0
  return Math.round(((atual - base) / base) * 10000) / 100
}

function numberValue(...values: unknown[]): number {
  const value = values.find(v => v !== undefined && v !== null)
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

function mergeHistoricalBaseline(existing: CockpitRow, row: CockpitRow) {
  const existingHasHistory = existing.m1 > 0 || existing.m2 > 0 || existing.m3 > 0
  const incomingHasHistory = row.m1 > 0 || row.m2 > 0 || row.m3 > 0

  if (!existingHasHistory && incomingHasHistory) {
    existing.m1 = row.m1
    existing.m2 = row.m2
    existing.m3 = row.m3
  }
}

function recalculateGroupedRow(row: CockpitRow) {
  const mesesValidos = [row.m1, row.m2, row.m3].filter(v => v > 0)
  row.media = mesesValidos.length > 0
    ? roundMoney((row.m1 + row.m2 + row.m3) / mesesValidos.length)
    : 0
  row.difVsM2 = roundMoney(row.atual - row.m2)
  row.difVsM3 = roundMoney(row.atual - row.m3)
  row.varPct = calcVarPct(row.atual, row.m1, row.m2, row.m3)
  row.status = calcStatus(row.difVsM3, row.tipoMatch)
  row.m1 = roundMoney(row.m1)
  row.m2 = roundMoney(row.m2)
  row.m3 = roundMoney(row.m3)
  row.atual = roundMoney(row.atual)
}

// Extrai os valores dos 3 meses históricos de uma linha do n8n.
// Suporta dois formatos:
//   1. meses Record { "YYYY-MM": valor } — formato novo/dinâmico (qualquer mês)
//   2. Campos diretos mar/abr/mai — formato V5 legado (fallback)
function extractHistoricalMonths(
  row: any,
  months: MonthInfo[],
): { m1: number; m2: number; m3: number } {
  const toKey = (m: MonthInfo) => `${m.year}-${String(m.num).padStart(2, '0')}`

  // Formato novo: meses Record { "YYYY-MM": valor }
  if (row.meses && typeof row.meses === 'object' && !Array.isArray(row.meses)) {
    const mesesMap: Record<string, number> = row.meses
    return {
      m1: numberValue(mesesMap[toKey(months[0])]),
      m2: numberValue(mesesMap[toKey(months[1])]),
      m3: numberValue(mesesMap[toKey(months[2])]),
    }
  }

  // Fallback legado: campos diretos mar/abr/mai (antigo formato n8n V5)
  // Mapeia pelo número do mês para continuar funcionando quando months=DEFAULT_MONTHS
  if (
    typeof row.mar !== 'undefined' || typeof row.abr !== 'undefined' ||
    typeof row.mai !== 'undefined' || typeof row.maio !== 'undefined'
  ) {
    const legacyByMonth: Record<number, number> = {
      3: numberValue(row.mar),
      4: numberValue(row.abr),
      5: numberValue(row.mai, row.maio, row.may),
    }
    return {
      m1: legacyByMonth[months[0]?.num] ?? 0,
      m2: legacyByMonth[months[1]?.num] ?? 0,
      m3: legacyByMonth[months[2]?.num] ?? 0,
    }
  }

  return { m1: 0, m2: 0, m3: 0 }
}

export function buildCockpitRows(
  blockKey: string,
  rows: any[],
  months: MonthInfo[] = DEFAULT_MONTHS,
): CockpitRow[] {
  const UNIT_LABELS: Record<string, string> = {
    prn_matriz: 'PRN MATRIZ',
    MATRIZ: 'PRN MATRIZ',
    camboriu: 'CAMBORIU',
    palhoca: 'PALHOCA',
  }
  const unidade = UNIT_LABELS[blockKey] ?? blockKey.toUpperCase()

  return rows.map((row) => {
    const favorecido = ns(row.nome || row.favorecido || row.name || '')
    const categoria = ns(row.categoria || row.categoriaOriginal || '')

    const { m1, m2, m3 } = extractHistoricalMonths(row, months)

    const atual = Number(row.atual ?? row.valorPago ?? row.valorDia ?? 0)
    const difVsM2 = typeof row.difVsAbr === 'number' ? row.difVsAbr : (atual - m2)
    const difVsM3 = typeof row.difVsMai === 'number'
      ? row.difVsMai
      : (typeof row.difVsMaio === 'number' ? row.difVsMaio : (atual - m3))

    let tipoMatch = row.tipoMatch || ''
    if (!tipoMatch) {
      const temHistorico = row.temHistorico ?? (m1 > 0 || m2 > 0 || m3 > 0)
      tipoMatch = temHistorico ? 'Match exato (favorecido + categoria)' : 'Novo (sem historico)'
    }

    const status = calcStatus(difVsM3, tipoMatch)

    const departamentos: Array<{ dept: string; valor: number }> = []
    if (Array.isArray(row.dailyLines)) {
      for (const dl of row.dailyLines) {
        const dept = ns(dl.departamento || dl.dept || '')
        if (dept) departamentos.push({ dept, valor: Number(dl.valor ?? 0) })
      }
    } else if (Array.isArray(row.departamentos)) {
      for (const d of row.departamentos) {
        departamentos.push({ dept: ns(d.dept || d.departamento || ''), valor: Number(d.valor ?? 0) })
      }
    } else if (row.departamento) {
      departamentos.push({ dept: ns(row.departamento), valor: atual })
    }

    const mesesValidos = [m1, m2, m3].filter(v => v > 0)
    const media = mesesValidos.length > 0 ? (m1 + m2 + m3) / mesesValidos.length : 0
    const varPct = calcVarPct(atual, m1, m2, m3)

    return {
      unidade,
      favorecido,
      categoria,
      m1,
      m2,
      m3,
      atual,
      difVsM2,
      difVsM3,
      status,
      tipoMatch,
      qtdDepartamentos: departamentos.length,
      departamentos,
      media: Math.round(media * 100) / 100,
      varPct: Math.round(varPct * 100) / 100,
      dataRegistro: toDisplayDate(row.dataRegistro || row.data_registro),
      vencimento: toDisplayDate(row.vencimento),
      _raw: row,
    }
  })
}

export function groupRowsConsolidated(allRows: CockpitRow[]): CockpitRow[] {
  const map = new Map<string, CockpitRow>()

  for (const row of groupDuplicateRows(allRows)) {
    const key = `${normalizeKey(row.favorecido)}|||${normalizeKey(row.categoria)}`
    if (!map.has(key)) {
      map.set(key, {
        unidade: 'CONSOLIDADO',
        favorecido: row.favorecido,
        categoria: row.categoria,
        m1: row.m1,
        m2: row.m2,
        m3: row.m3,
        atual: row.atual,
        difVsM2: row.difVsM2,
        difVsM3: row.difVsM3,
        status: row.status,
        tipoMatch: row.tipoMatch,
        qtdDepartamentos: 0,
        departamentos: [],
        media: row.media,
        varPct: row.varPct,
        _raw: row._raw
      })
    } else {
      const existing = map.get(key)!
      existing.m1 += row.m1
      existing.m2 += row.m2
      existing.m3 += row.m3
      existing.atual += row.atual

      if (row.tipoMatch === 'Novo (sem historico)') {
        existing.tipoMatch = 'Novo (sem historico)'
      }
    }
  }

  for (const row of map.values()) {
    recalculateGroupedRow(row)
  }

  return Array.from(map.values())
}

export function groupRowsByUnitConsolidated(rows: CockpitRow[]): CockpitRow[] {
  const map = new Map<string, CockpitRow>()

  for (const row of rows) {
    const key = `${normalizeKey(row.favorecido)}|||${normalizeKey(row.categoria)}`
    if (!map.has(key)) {
      map.set(key, { ...row, departamentos: [], qtdDepartamentos: 0 })
    } else {
      const existing = map.get(key)!
      existing.atual += row.atual
      mergeHistoricalBaseline(existing, row)
    }
  }

  for (const row of map.values()) {
    recalculateGroupedRow(row)
  }

  return Array.from(map.values())
}

export function groupDuplicateRows(rows: CockpitRow[]): CockpitRow[] {
  const map = new Map<string, CockpitRow>()

  for (const row of rows) {
    const key = `${normalizeKey(row.unidade)}|||${normalizeKey(row.favorecido)}|||${normalizeKey(row.categoria)}`
    if (!map.has(key)) {
      map.set(key, { ...row, departamentos: [...row.departamentos] })
    } else {
      const existing = map.get(key)!
      existing.atual += row.atual
      mergeHistoricalBaseline(existing, row)
      existing.departamentos.push(...row.departamentos)
      existing.qtdDepartamentos = existing.departamentos.length
      recalculateGroupedRow(existing)
    }
  }

  return Array.from(map.values())
}
