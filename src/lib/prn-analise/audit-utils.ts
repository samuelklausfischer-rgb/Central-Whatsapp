export type CockpitStatus = 'Aumento' | 'Queda' | 'Novo' | 'Igual'

export interface CockpitRow {
  unidade: string
  favorecido: string
  categoria: string
  fev: number
  mar: number
  abr: number
  mai: number
  atual: number
  difVsAbr: number
  difVsMai: number
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

function calcVarPct(atual: number, mar: number, abr: number, mai: number): number {
  const base = mai > 0 ? mai : abr > 0 ? abr : mar > 0 ? mar : 0
  if (base <= 0) return 0
  return Math.round(((atual - base) / base) * 10000) / 100
}

function numberValue(...values: unknown[]): number {
  const value = values.find((v) => v !== undefined && v !== null)
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

function mergeHistoricalBaseline(existing: CockpitRow, row: CockpitRow) {
  const existingHasHistory = existing.mar > 0 || existing.abr > 0 || existing.mai > 0
  const incomingHasHistory = row.mar > 0 || row.abr > 0 || row.mai > 0
  if (!existingHasHistory && incomingHasHistory) {
    existing.fev = row.fev
    existing.mar = row.mar
    existing.abr = row.abr
    existing.mai = row.mai
  }
}

function recalculateGroupedRow(row: CockpitRow) {
  const mesesValidos = [row.mar, row.abr, row.mai].filter((v) => v > 0)
  row.media =
    mesesValidos.length > 0
      ? roundMoney((row.mar + row.abr + row.mai) / mesesValidos.length)
      : 0
  row.difVsAbr = roundMoney(row.atual - row.abr)
  row.difVsMai = roundMoney(row.atual - row.mai)
  row.varPct = calcVarPct(row.atual, row.mar, row.abr, row.mai)
  row.status = calcStatus(row.difVsMai, row.tipoMatch)
  row.fev = roundMoney(row.fev)
  row.mar = roundMoney(row.mar)
  row.abr = roundMoney(row.abr)
  row.mai = roundMoney(row.mai)
  row.atual = roundMoney(row.atual)
}

function monthNum(code: string): number {
  const parts = code.split('-')
  return parts.length === 2 ? parseInt(parts[1], 10) : 0
}

function extractHistoricalMonths(row: any): {
  fev: number
  mar: number
  abr: number
  mai: number
} {
  if (
    typeof row.fev !== 'undefined' ||
    typeof row.mar !== 'undefined' ||
    typeof row.abr !== 'undefined' ||
    typeof row.mai !== 'undefined' ||
    typeof row.maio !== 'undefined' ||
    typeof row.may !== 'undefined'
  ) {
    return {
      fev: numberValue(row.fev),
      mar: numberValue(row.mar),
      abr: numberValue(row.abr),
      mai: numberValue(row.mai, row.maio, row.may),
    }
  }
  const meses: Record<string, number> = row.meses || {}
  const sorted = Object.entries(meses)
    .filter(([k]) => /^\d{4}-\d{2}$/.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
  const fev = sorted.find(([k]) => monthNum(k) === 2)?.[1] ?? 0
  const mar = sorted.find(([k]) => monthNum(k) === 3)?.[1] ?? 0
  const abr = sorted.find(([k]) => monthNum(k) === 4)?.[1] ?? 0
  const mai = sorted.find(([k]) => monthNum(k) === 5)?.[1] ?? 0
  return {
    fev: numberValue(fev),
    mar: numberValue(mar),
    abr: numberValue(abr),
    mai: numberValue(mai),
  }
}

export function buildCockpitRows(blockKey: string, rows: any[]): CockpitRow[] {
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
    const { fev, mar, abr, mai } = extractHistoricalMonths(row)
    const atual = Number(row.atual ?? row.valorPago ?? row.valorDia ?? 0)
    const difVsAbr = typeof row.difVsAbr === 'number' ? row.difVsAbr : atual - abr
    const difVsMai =
      typeof row.difVsMai === 'number'
        ? row.difVsMai
        : typeof row.difVsMaio === 'number'
          ? row.difVsMaio
          : atual - mai

    let tipoMatch = row.tipoMatch || ''
    if (!tipoMatch) {
      const temHistorico = row.temHistorico ?? (mar > 0 || abr > 0 || mai > 0)
      tipoMatch = temHistorico ? 'Match exato (favorecido + categoria)' : 'Novo (sem historico)'
    }

    const status = calcStatus(difVsMai, tipoMatch)

    const departamentos: Array<{ dept: string; valor: number }> = []
    if (Array.isArray(row.dailyLines)) {
      for (const dl of row.dailyLines) {
        const dept = ns(dl.departamento || dl.dept || '')
        if (dept) departamentos.push({ dept, valor: Number(dl.valor ?? 0) })
      }
    } else if (Array.isArray(row.departamentos)) {
      for (const d of row.departamentos) {
        departamentos.push({
          dept: ns(d.dept || d.departamento || ''),
          valor: Number(d.valor ?? 0),
        })
      }
    } else if (row.departamento) {
      departamentos.push({ dept: ns(row.departamento), valor: atual })
    }

    const mesesValidos = [mar, abr, mai].filter((v) => v > 0)
    const media = mesesValidos.length > 0 ? (mar + abr + mai) / mesesValidos.length : 0
    const varPct = calcVarPct(atual, mar, abr, mai)

    return {
      unidade,
      favorecido,
      categoria,
      fev,
      mar,
      abr,
      mai,
      atual,
      difVsAbr,
      difVsMai,
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
        fev: row.fev,
        mar: row.mar,
        abr: row.abr,
        mai: row.mai,
        atual: row.atual,
        difVsAbr: row.difVsAbr,
        difVsMai: row.difVsMai,
        status: row.status,
        tipoMatch: row.tipoMatch,
        qtdDepartamentos: 0,
        departamentos: [],
        media: row.media,
        varPct: row.varPct,
        _raw: row._raw,
      })
    } else {
      const existing = map.get(key)!
      existing.fev += row.fev
      existing.mar += row.mar
      existing.abr += row.abr
      existing.mai += row.mai
      existing.atual += row.atual
      if (row.tipoMatch === 'Novo (sem historico)') existing.tipoMatch = 'Novo (sem historico)'
    }
  }
  for (const row of map.values()) recalculateGroupedRow(row)
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
  for (const row of map.values()) recalculateGroupedRow(row)
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
