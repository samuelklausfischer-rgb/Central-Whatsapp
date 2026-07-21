import { useState, useMemo, useEffect, useCallback } from 'react'
import { formatCurrency, formatPercentage } from '@/lib/prn-analise/formatters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  History,
  Filter,
  FileText,
  ChevronDown,
  ChevronRight,
  Layers,
  Sheet,
  PencilLine,
  X,
  Check,
} from 'lucide-react'
import { generateAuditPDF, generateGroupedAuditPDF } from '@/lib/prn-analise/export-pdf'
import { generateAuditExcel, generateGroupedAuditExcel } from '@/lib/prn-analise/export-excel'
import { buildCockpitRows, groupDuplicateRows, CockpitRow, MonthInfo, DEFAULT_MONTHS } from '@/lib/prn-analise/audit-utils'
import { downloadDailyFile } from '@/services/prn-analise/prn-service'
import type { AnalysisRecord } from '@/services/prn-analise/analise-duplicidade'
import {
  getObservationsByRunId,
  saveObservation,
  deleteObservation,
  makeRowKey,
  PrnRowObservation,
} from '@/services/prn-analise/prn-observations'

const UNIT_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  'PRN MATRIZ': { label: 'PRN MATRIZ', bg: 'bg-blue-100 border-blue-200', text: 'text-blue-600' },
  CAMBORIU: { label: 'Camboriú', bg: 'bg-emerald-100 border-emerald-200', text: 'text-emerald-600' },
  PALHOCA: { label: 'Palhoça', bg: 'bg-amber-100 border-amber-200', text: 'text-amber-600' },
}

function unitBadge(unidade: string) {
  const cfg = UNIT_CONFIG[unidade] ?? {
    label: unidade,
    bg: 'bg-gray-100 border-gray-200',
    text: 'text-gray-500',
  }
  return (
    <Badge className={cn('text-[9px] font-black uppercase tracking-wider px-2 py-0.5 border', cfg.bg, cfg.text)}>
      {cfg.label}
    </Badge>
  )
}

function MoneyCell({ value, highlight = false }: { value: number; highlight?: boolean }) {
  return (
    <span
      className={cn(
        'font-mono text-xs tabular-nums',
        value === 0
          ? 'text-gray-300'
          : highlight
          ? 'font-bold text-blue-600 text-sm'
          : 'text-gray-500',
      )}
    >
      {formatCurrency(value)}
    </span>
  )
}

function DeptExpander({ row }: { row: CockpitRow }) {
  const [open, setOpen] = useState(false)
  const hasDepts = row.departamentos.length > 0

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        {hasDepts && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-gray-300 hover:text-gray-600 transition-colors"
            aria-label="Expandir departamentos"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        )}
        <span className="font-bold text-gray-800 text-xs truncate max-w-[180px]">{row.favorecido}</span>
      </div>
      {open && hasDepts && (
        <div className="ml-4 space-y-0.5 border-l border-gray-200 pl-2 mt-1">
          {row.departamentos.map((d, i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-[10px]">
              <span className="text-gray-400 uppercase truncate max-w-[150px]">{d.dept}</span>
              <span className="font-mono text-gray-500">{formatCurrency(d.valor)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function parseDate(s: string): number {
  if (!s) return NaN
  const p = s.split('/')
  if (p.length === 3 && p[2].length === 4) return new Date(+p[2], +p[1] - 1, +p[0]).getTime()
  return new Date(s).getTime()
}

function daysBetween(dateStrA: string, dateStrB: string): number {
  const a = parseDate(dateStrA)
  const b = parseDate(dateStrB)
  return Math.round((b - a) / 86400000)
}

function DataRegistroBadge({ dataRegistro, vencimento, referenceDate }: {
  dataRegistro?: string
  vencimento?: string
  referenceDate?: string
}) {
  if (!dataRegistro) return null

  const compareDate = vencimento || referenceDate
  if (!compareDate) return null

  const days = daysBetween(dataRegistro, compareDate)
  if (days <= 0) return null

  const color =
    days <= 7
      ? 'bg-blue-50 text-blue-600 border-blue-200'
      : days <= 30
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-red-50 text-red-600 border-red-200'

  return (
    <span className={cn('inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap', color)}>
      Reg. {days}d atrás
    </span>
  )
}

const FILTERS: Array<{ id: string; label: string; color: string }> = [
  { id: 'all', label: 'Todos', color: 'text-gray-700' },
  { id: 'Aumento', label: 'Aumento', color: 'text-red-600' },
  { id: 'Queda', label: 'Queda', color: 'text-emerald-600' },
  { id: 'Novo', label: 'Novo', color: 'text-blue-600' },
  { id: 'Igual', label: 'Igual', color: 'text-gray-400' },
]

export function PrnCrossAnalysis({ data, fullPayload, duplicityAnalysis, runId }: {
  data?: any
  fullPayload?: any
  duplicityAnalysis?: AnalysisRecord
  runId?: string
}) {
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingGrouped, setIsExportingGrouped] = useState(false)
  const [isExportingExcel, setIsExportingExcel] = useState(false)
  const [isExportingExcelGrouped, setIsExportingExcelGrouped] = useState(false)
  const [isDownloadingBruto, setIsDownloadingBruto] = useState(false)
  const [sortKey, setSortKey] = useState<keyof CockpitRow | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [observations, setObservations] = useState<Record<string, PrnRowObservation>>({})
  const [obsModal, setObsModal] = useState<{ row: CockpitRow; rowKey: string } | null>(null)
  const [obsText, setObsText] = useState('')
  const [obsSaving, setObsSaving] = useState(false)

  const dailyStorageName: string | undefined = fullPayload?.meta?.daily_file_storage_name
  const dailyOriginalName: string | undefined =
    fullPayload?.meta?.daily_file_original_name || fullPayload?.daily_filename || fullPayload?.request?.dailyFilename
  const referenceDate: string | undefined =
    fullPayload?.referenceDateUsed || fullPayload?.meta?.data_referencia

  const months = useMemo<MonthInfo[]>(
    () => fullPayload?.meta?.historical_months ?? DEFAULT_MONTHS,
    [fullPayload],
  )

  useEffect(() => {
    if (!runId) return
    getObservationsByRunId(runId)
      .then((list) => {
        const map: Record<string, PrnRowObservation> = {}
        for (const obs of list) map[obs.row_key] = obs
        setObservations(map)
      })
      .catch(() => {})
  }, [runId])

  const openObsModal = useCallback((row: CockpitRow) => {
    const key = makeRowKey(row.unidade, row.favorecido, row.categoria)
    const existing = observations[key]
    setObsText(existing?.observation || '')
    setObsModal({ row, rowKey: key })
  }, [observations])

  const handleSaveObs = async () => {
    if (!runId || !obsModal) return
    setObsSaving(true)
    try {
      const existing = observations[obsModal.rowKey]
      if (!obsText.trim()) {
        if (existing) {
          await deleteObservation(existing.id)
          setObservations((prev) => {
            const next = { ...prev }
            delete next[obsModal.rowKey]
            return next
          })
        }
      } else {
        const saved = await saveObservation(runId, obsModal.rowKey, obsText.trim(), existing?.id)
        setObservations((prev) => ({ ...prev, [obsModal.rowKey]: saved }))
      }
      setObsModal(null)
    } catch (err) {
      console.error('Failed to save observation:', err)
    } finally {
      setObsSaving(false)
    }
  }

  const allRows = useMemo<CockpitRow[]>(() => {
    const byBlock = data?.byBlock || data?.crossAnalysis?.byBlock
    const result: CockpitRow[] = []

    if (byBlock && typeof byBlock === 'object') {
      for (const key of ['prn_matriz', 'camboriu', 'palhoca']) {
        const blockRows = Array.isArray(byBlock[key]?.rows) ? byBlock[key].rows : []
        result.push(...buildCockpitRows(key, blockRows, months))
      }
    } else {
      const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []
      const byBlockFallback: Record<string, any[]> = { prn_matriz: [], camboriu: [], palhoca: [] }
      for (const row of rows) {
        const b = row._block || 'prn_matriz'
        ;(byBlockFallback[b] = byBlockFallback[b] || []).push(row)
      }
      for (const [key, blockRows] of Object.entries(byBlockFallback)) {
        result.push(...buildCockpitRows(key, blockRows, months))
      }
    }

    return groupDuplicateRows(result)
  }, [data, months])

  const rowsByUnidade = useMemo(() => {
    const grouped: Record<string, CockpitRow[]> = {
      'PRN MATRIZ': [],
      'CAMBORIU': [],
      'PALHOCA': [],
    }
    for (const r of allRows) {
      if (grouped[r.unidade]) grouped[r.unidade].push(r)
    }
    return grouped
  }, [allRows])

  const filterAndSortRows = (rows: CockpitRow[]) => {
    let filtered = filterStatus === 'all' ? rows : rows.filter((r) => r.status === filterStatus)
    if (sortKey) {
      filtered = [...filtered].sort((a, b) => {
        const va = a[sortKey] as any
        const vb = b[sortKey] as any
        const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return filtered
  }

  const counts = useMemo(() => {
    const c = { Aumento: 0, Queda: 0, Novo: 0, Igual: 0 }
    for (const r of allRows) c[r.status]++
    return c
  }, [allRows])

  const handleSort = (key: keyof CockpitRow) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const handleExport = async () => {
    setIsExporting(true)
    try { await generateAuditPDF(fullPayload, duplicityAnalysis ?? undefined, months) } finally { setIsExporting(false) }
  }

  const handleExportGrouped = async () => {
    setIsExportingGrouped(true)
    try { await generateGroupedAuditPDF(fullPayload, duplicityAnalysis ?? undefined, months) } finally { setIsExportingGrouped(false) }
  }

  const handleExportExcel = async () => {
    setIsExportingExcel(true)
    try { await generateAuditExcel(fullPayload, duplicityAnalysis ?? undefined, observations, months) } finally { setIsExportingExcel(false) }
  }

  const handleExportExcelGrouped = async () => {
    setIsExportingExcelGrouped(true)
    try { await generateGroupedAuditExcel(fullPayload, duplicityAnalysis ?? undefined, observations, months) } finally { setIsExportingExcelGrouped(false) }
  }

  const handleDownloadBruto = async () => {
    if (!dailyStorageName) return
    setIsDownloadingBruto(true)
    try { await downloadDailyFile(dailyStorageName, dailyOriginalName) } finally { setIsDownloadingBruto(false) }
  }

  if (!data || (!Array.isArray(data?.rows) && !Array.isArray(data) && !data?.byBlock && !data?.crossAnalysis?.byBlock)) return null

  const SortTh = ({
    label,
    field,
    align = 'left',
  }: {
    label: string
    field: keyof CockpitRow
    align?: 'left' | 'right' | 'center'
  }) => {
    const active = sortKey === field
    return (
      <th
        className={cn(
          'px-3 py-3 text-[9px] font-black uppercase tracking-widest text-gray-400 cursor-pointer select-none hover:text-gray-600 transition-colors whitespace-nowrap',
          align === 'right' && 'text-right',
          align === 'center' && 'text-center',
        )}
        onClick={() => handleSort(field)}
      >
        {label}
        {active && (
          <span className="ml-1 text-blue-600">{sortDir === 'asc' ? '↑' : '↓'}</span>
        )}
      </th>
    )
  }

  return (
    <div className="space-y-6 mt-10 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
      {obsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-gray-900 tracking-tight">Observação</h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5 truncate max-w-[300px]">
                  {obsModal.row.favorecido}
                </p>
              </div>
              <button onClick={() => setObsModal(null)} className="text-gray-300 hover:text-gray-600 transition-colors mt-0.5">
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-300"
              rows={4}
              placeholder="Descreva a observação para este lançamento..."
              value={obsText}
              onChange={(e) => setObsText(e.target.value)}
              autoFocus
            />
            {!runId && (
              <p className="text-[10px] text-amber-600 font-bold bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Observações só podem ser salvas em análises com histórico registrado.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setObsModal(null)} className="rounded-xl border-gray-200 text-gray-500">
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleSaveObs}
                disabled={obsSaving || !runId}
                className="rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold"
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                {obsSaving ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4 border-b border-gray-100 pb-6">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="space-y-2">
            <h3 className="text-2xl font-black text-gray-900 flex items-center gap-3 tracking-tighter">
              <div className="p-2 bg-blue-100 rounded-xl">
                <History className="h-6 w-6 text-blue-600" />
              </div>
              Cockpit Financeiro — Cruzamento vs {months[2]?.abbr ?? 'Atual'}
            </h3>
            <p className="text-gray-400 text-[10px] font-bold uppercase tracking-[0.2em] pl-14">
              {allRows.length} favorecidos · {counts.Aumento} aumentos · {counts.Queda} quedas ·{' '}
              {counts.Novo} novos · {counts.Igual} iguais
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
            className="border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-bold rounded-xl h-10 px-4 transition-all"
          >
            <FileText className={cn('h-4 w-4 mr-2 text-red-500', isExporting && 'animate-pulse')} />
            {isExporting ? 'Exportando...' : 'Exportar PDF'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportGrouped}
            disabled={isExportingGrouped}
            className="border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-bold rounded-xl h-10 px-4 transition-all"
          >
            <Layers className={cn('h-4 w-4 mr-2 text-purple-500', isExportingGrouped && 'animate-pulse')} />
            {isExportingGrouped ? 'Exportando...' : 'PDF Agrupado'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            disabled={isExportingExcel}
            className="border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-xl h-10 px-4 transition-all"
          >
            <Sheet className={cn('h-4 w-4 mr-2', isExportingExcel && 'animate-pulse')} />
            {isExportingExcel ? 'Exportando...' : 'Exportar Excel'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcelGrouped}
            disabled={isExportingExcelGrouped}
            className="border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-700 font-bold rounded-xl h-10 px-4 transition-all"
          >
            <Sheet className={cn('h-4 w-4 mr-2', isExportingExcelGrouped && 'animate-pulse')} />
            {isExportingExcelGrouped ? 'Exportando...' : 'Excel Agrupado'}
          </Button>

          {dailyStorageName && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadBruto}
              disabled={isDownloadingBruto}
              className="border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700 font-bold rounded-xl h-10 px-4 transition-all"
            >
              <Sheet className={cn('h-4 w-4 mr-2', isDownloadingBruto && 'animate-pulse')} />
              {isDownloadingBruto ? 'Baixando...' : 'Excel Bruto'}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3 bg-gray-50 p-1.5 rounded-2xl border border-gray-100 overflow-x-auto max-w-full">
          <div className="flex items-center gap-1.5 px-3">
            <Filter className="h-4 w-4 text-blue-500" />
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Filtros</span>
          </div>
          <div className="flex items-center gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f.id}
                variant="ghost"
                size="sm"
                onClick={() => setFilterStatus(f.id)}
                className={cn(
                  'whitespace-nowrap rounded-xl h-9 text-[11px] font-bold uppercase tracking-widest transition-all px-4',
                  filterStatus === f.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
                )}
              >
                <span
                  className={cn(
                    'mr-1.5 w-1.5 h-1.5 rounded-full inline-block',
                    f.color.replace('text-', 'bg-'),
                  )}
                />
                {f.label}
                {f.id !== 'all' && (
                  <span className="ml-1.5 text-gray-400">
                    {counts[f.id as keyof typeof counts] ?? 0}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {(['PRN MATRIZ', 'CAMBORIU', 'PALHOCA'] as const).map((unidade) => {
        const blockRows = filterAndSortRows(rowsByUnidade[unidade] || [])
        const hasData = blockRows.length > 0
        const cfg = UNIT_CONFIG[unidade] ?? { label: unidade, bg: 'bg-gray-100 border-gray-200', text: 'text-gray-500' }

        return (
          <div key={unidade} className="mb-8">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
              <div className={cn("p-2 rounded-xl border", cfg.bg)}>
                <History className={cn("h-5 w-5", cfg.text)} />
              </div>
              <div>
                <h4 className={cn("text-xl font-bold tracking-tighter", cfg.text)}>
                  {cfg.label}
                </h4>
                <p className="text-gray-400 text-[9px] font-bold uppercase tracking-widest">
                  {blockRows.length} registros encontrados
                </p>
              </div>
            </div>

            {!hasData ? (
              <div className="p-20 text-center bg-gray-50 border border-dashed border-gray-200 rounded-2xl">
                <div className="bg-gray-100 p-4 rounded-full w-fit mx-auto mb-4">
                  <Filter className="h-8 w-8 text-gray-300" />
                </div>
                <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                  Nenhum registro encontrado para este filtro
                </p>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden shadow-sm border border-gray-200">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <SortTh label="Favorecido" field="favorecido" />
                        <SortTh label="Categoria" field="categoria" />
                        <SortTh label="Data Reg." field="dataRegistro" align="center" />
                        <SortTh label={months[0]?.abbr ?? 'M1'} field="m1" align="right" />
                        <SortTh label={months[1]?.abbr ?? 'M2'} field="m2" align="right" />
                        <SortTh label={months[2]?.abbr ?? 'M3'} field="m3" align="right" />
                        <SortTh label="Média" field="media" align="right" />
                        <SortTh label="Atual" field="atual" align="right" />
                        <SortTh label="Var %" field="varPct" align="right" />
                        <th className="px-3 py-3 text-[9px] font-black uppercase tracking-widest text-gray-400 text-center whitespace-nowrap w-8">OBS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockRows.map((row, i) => {
                        const rowKey = makeRowKey(row.unidade, row.favorecido, row.categoria)
                        const hasObs = !!observations[rowKey]

                        return (
                          <tr
                            key={i}
                            className={cn(
                              'border-b border-gray-100 transition-colors hover:bg-gray-50',
                              i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50',
                            )}
                          >
                            <td className="px-3 py-3 min-w-[160px] whitespace-nowrap">
                              <div className="flex flex-col gap-1">
                                <DeptExpander row={row} />
                                {hasObs && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded w-fit">
                                    <PencilLine className="h-2.5 w-2.5" />
                                    Obs. salva
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="px-3 py-3 whitespace-nowrap">
                              {row.categoria ? (
                                <Badge className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 border bg-purple-100 text-purple-600 border-purple-200 max-w-[160px] truncate">
                                  {row.categoria}
                                </Badge>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>

                            <td className="px-3 py-3 text-center whitespace-nowrap">
                              {row.dataRegistro ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="font-mono text-[10px] text-gray-500">{row.dataRegistro}</span>
                                  <DataRegistroBadge
                                    dataRegistro={row.dataRegistro}
                                    vencimento={row.vencimento}
                                    referenceDate={referenceDate}
                                  />
                                </div>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>

                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              <MoneyCell value={row.m1} />
                            </td>

                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              <MoneyCell value={row.m2} />
                            </td>

                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              <MoneyCell value={row.m3} />
                            </td>

                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              <MoneyCell value={row.media} />
                            </td>

                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              <MoneyCell value={row.atual} highlight />
                            </td>

                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              <span className={cn(
                                'font-mono text-xs font-bold tabular-nums',
                                row.varPct > 0 ? 'text-red-600' : row.varPct < 0 ? 'text-emerald-600' : 'text-gray-300'
                              )}>
                                {row.varPct !== 0 ? formatPercentage(row.varPct) : '—'}
                              </span>
                            </td>

                            <td className="px-3 py-3 text-center whitespace-nowrap">
                              <button
                                onClick={() => openObsModal(row)}
                                title={hasObs ? 'Editar observação' : 'Adicionar observação'}
                                className={cn(
                                  'p-1 rounded-lg transition-colors',
                                  hasObs
                                    ? 'text-violet-500 hover:text-violet-700 hover:bg-violet-50'
                                    : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100',
                                )}
                              >
                                <PencilLine className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
