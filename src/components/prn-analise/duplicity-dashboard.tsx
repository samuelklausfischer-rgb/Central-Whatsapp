import { useState, useEffect, useMemo } from 'react'
import { useRealtime } from '@/hooks/use-realtime-financeiro'
import { AlertCircle, CheckCircle2, Loader2, AlertTriangle, Eye, Download } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { AnalysisRecord } from '@/services/prn-analise/analise-duplicidade'
import { cn } from '@/lib/utils'

function formatCurrency(val: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
}

function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  if (dateStr.includes('T')) return new Date(dateStr).toLocaleDateString('pt-BR')
  const p = dateStr.split('-')
  if (p.length === 3) return p[2] + '/' + p[1] + '/' + p[0]
  return dateStr
}

type ZoneTheme = 'red' | 'yellow' | 'blue'

const zoneConfig: Record<ZoneTheme, {
  border: string
  bg: string
  headerBg: string
  headerBorder: string
  iconBg: string
  titleColor: string
  badgeBg: string
  badgeText: string
  cardBorder: string
  cardBg: string
  cardHover: string
  label: string
}> = {
  red: {
    border: 'border-red-200', bg: 'bg-red-50', headerBg: 'bg-red-100', headerBorder: 'border-b border-red-200', iconBg: 'bg-red-100 text-red-600', titleColor: 'text-red-700', badgeBg: 'bg-red-100', badgeText: 'text-red-700 border-red-200', cardBorder: 'border-red-200', cardBg: 'bg-red-50', cardHover: 'hover:bg-red-100', label: 'Risco Crítico',
  },
  yellow: {
    border: 'border-yellow-200', bg: 'bg-yellow-50', headerBg: 'bg-yellow-100', headerBorder: 'border-b border-yellow-200', iconBg: 'bg-yellow-100 text-yellow-700', titleColor: 'text-yellow-800', badgeBg: 'bg-yellow-100', badgeText: 'text-yellow-700 border-yellow-200', cardBorder: 'border-yellow-200', cardBg: 'bg-yellow-50', cardHover: 'hover:bg-yellow-100', label: 'Atenção',
  },
  blue: {
    border: 'border-blue-200', bg: 'bg-blue-50', headerBg: 'bg-blue-100', headerBorder: 'border-b border-blue-200', iconBg: 'bg-blue-100 text-blue-600', titleColor: 'text-blue-700', badgeBg: 'bg-blue-100', badgeText: 'text-blue-700 border-blue-200', cardBorder: 'border-blue-200', cardBg: 'bg-blue-50', cardHover: 'hover:bg-blue-100', label: 'Monitoramento',
  },
}

function DataTable({ records, variant }: { records: any[]; variant?: ZoneTheme }) {
  const theme = variant ? zoneConfig[variant] : null
  if (!records || records.length === 0)
    return <p className="text-gray-400 p-4 text-sm italic">Nenhum caso encontrado para esta categoria.</p>
  return (
    <div className={cn('rounded-md border overflow-x-auto', theme ? theme.cardBorder : 'border-gray-200')}>
      <Table className="text-gray-700 whitespace-nowrap text-sm">
        <TableHeader>
          <TableRow className={cn('hover:bg-transparent bg-gray-50', theme ? theme.cardBorder : 'border-gray-200')}>
            <TableHead className="text-gray-500 font-medium">Linha</TableHead>
            <TableHead className="text-gray-500 font-medium">Unidade</TableHead>
            <TableHead className="text-gray-500 font-medium">Nome</TableHead>
            <TableHead className="text-gray-500 font-medium">Departamento</TableHead>
            <TableHead className="text-gray-500 font-medium">Valor</TableHead>
            <TableHead className="text-gray-500 font-medium">Vencimento</TableHead>
            <TableHead className="text-gray-500 font-medium">Parcela</TableHead>
            <TableHead className="text-gray-500 font-medium">CPF/CNPJ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.slice(0, 10).map((r, i) => (
            <TableRow key={i} className={cn(
              theme ? theme.cardBorder + ' ' + theme.cardHover : 'border-gray-200 hover:bg-gray-50'
            )}>
              <TableCell className="font-mono text-gray-400 text-xs">{r.linha_origem ?? r.linhaOrigem}</TableCell>
              <TableCell className="text-gray-500">{r.unidade}</TableCell>
              <TableCell className="font-medium text-gray-800">{r.nome_original ?? r.nomeOriginal}</TableCell>
              <TableCell className="text-gray-600">{r.departamento_original ?? r.departamentoOriginal}</TableCell>
              <TableCell className="font-mono font-medium text-gray-800">{formatCurrency(r.valor_normalizado ?? r.valorNormalizado)}</TableCell>
              <TableCell className="font-mono text-gray-700">{formatDate(r.vencimento)}</TableCell>
              <TableCell className="font-mono text-gray-500">{r.parcela || '-'}</TableCell>
              <TableCell className="font-mono text-gray-400 text-xs">{(r.cpf_cnpj ?? r.cpfCnpj) || '-'}</TableCell>
            </TableRow>
          ))}
          {records.length > 10 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-gray-400 italic text-xs py-2 bg-gray-50">
                Mais {records.length - 10} registros ocultos. Baixe o PDF para ver todos.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function GroupedDataTable({ groups, variant }: { groups: any[]; variant: ZoneTheme }) {
  const theme = zoneConfig[variant]
  if (!groups || groups.length === 0)
    return <p className="text-gray-400 p-4 text-sm italic">Nenhum caso encontrado para esta categoria.</p>
  return (
    <div className="space-y-4">
      {groups.slice(0, 3).map((g, i) => (
        <div key={i} className={cn('rounded-lg border p-5', theme.cardBorder, theme.cardBg)}>
          <div className="flex items-center gap-3 mb-4">
            <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full border', theme.badgeBg, theme.badgeText)}>
              Grupo {g.groupId || i + 1}
            </span>
            <span className="text-sm text-gray-500 font-medium">
              {g.keyName || g.records?.[0]?.nome_original || 'N/A'}
            </span>
            {g.records?.length > 0 && (
              <span className="text-xs text-gray-400 ml-auto">
                {g.records.length} registro{g.records.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <DataTable records={g.records} variant={variant} />
        </div>
      ))}
      {groups.length > 3 && (
        <div className="p-4 rounded-lg border border-gray-200 bg-gray-50 text-center text-gray-500 text-sm">
          + {groups.length - 3} grupos adicionais encontrados. Baixe o PDF para ver a lista completa.
        </div>
      )}
    </div>
  )
}

function ZoneWrapper({
  theme, icon: Icon, title, description, count, children,
}: {
  theme: ZoneTheme; icon: React.ElementType; title: string; description: string; count?: number; children: React.ReactNode
}) {
  const cfg = zoneConfig[theme]
  return (
    <div className={cn('rounded-xl border overflow-hidden', cfg.border, cfg.bg)}>
      <div className={cn('px-6 py-4', cfg.headerBg, cfg.headerBorder)}>
        <div className="flex items-center gap-3">
          <div className={cn('p-2 rounded-lg', cfg.iconBg)}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className={cn('text-base font-semibold', cfg.titleColor)}>{title}</h3>
              <span className={cn('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border', cfg.badgeBg, cfg.badgeText)}>
                {cfg.label}
              </span>
              {count !== undefined && count > 0 && (
                <span className={cn('text-xs font-mono px-2 py-0.5 rounded-full', cfg.badgeBg, cfg.badgeText)}>
                  {count}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{description}</p>
          </div>
        </div>
      </div>
      <div className="p-5 space-y-0">
        {children}
      </div>
    </div>
  )
}

const metricThemes: Record<string, { bg: string; border: string; text: string; value: string }> = {
  'Analisado':        { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-600',    value: 'text-blue-700' },
  'Grupos':           { bg: 'bg-purple-50',  border: 'border-purple-200',  text: 'text-purple-600',  value: 'text-purple-700' },
  'Duplicidades':     { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-600',     value: 'text-red-700' },
  'G. Manual':        { bg: 'bg-yellow-50',  border: 'border-yellow-200',  text: 'text-yellow-700',  value: 'text-yellow-800' },
  'G. Nome Repetido': { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-600',   value: 'text-amber-700' },
  'Total Manual':     { bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-600',  value: 'text-orange-700' },
}

export function ResultsDashboard({ analysis: initialAnalysis }: { analysis: AnalysisRecord }) {
  const [analysis, setAnalysis] = useState<AnalysisRecord>(initialAnalysis)

  useEffect(() => {
    setAnalysis(initialAnalysis)
  }, [initialAnalysis])

  useRealtime('analises_duplicidade', (e: any) => {
    if ((e.action === 'update' || e.action === 'create') && e.record.id === analysis.id) {
      setAnalysis(
        (prev) => ({ ...prev, ...e.record, expand: prev.expand || e.record.expand }) as AnalysisRecord
      )
    }
  })

  const { status, result_json, error_message } = analysis

  if (status === 'completed' && !result_json) {
    return (
      <Card className="bg-white border-gray-200 text-gray-900 shadow-md">
        <CardContent className="pt-6">
          <p className="text-gray-400 p-4 text-center">Nenhum dado de análise disponível. O arquivo foi importado no formato antigo ou ocorreu erro de processamento.</p>
        </CardContent>
      </Card>
    )
  }

  const getMetric = (snake: keyof AnalysisRecord, camel: string) => {
    const val = analysis[snake] as number
    if (val !== undefined && val !== null && val !== 0) return val
    const summary = result_json?.summary || {}
    const json = result_json || {}
    const fallback = summary[camel] ?? summary[snake] ?? json[camel] ?? json[snake]
    if (fallback !== undefined && fallback !== null) return Number(fallback)
    return val ?? 0
  }

  const metrics = [
    { label: 'Analisado', val: getMetric('analyzable_records', 'analyzableRecords') },
    { label: 'Grupos', val: getMetric('group_count', 'groupCount') },
    { label: 'Duplicidades', val: getMetric('duplicate_count', 'duplicateCount') },
    { label: 'G. Manual', val: getMetric('manual_review_count', 'manualReviewCount') },
    { label: 'G. Nome Repetido', val: getMetric('name_repeat_manual_count', 'nameRepeatManualCount') },
    { label: 'Total Manual', val: getMetric('overall_manual_count', 'overallManualCount') },
  ]

  let statusColor = 'text-gray-500'
  let StatusIcon = CheckCircle2

  if (status === 'processing') {
    statusColor = 'text-blue-600'; StatusIcon = Loader2
  } else if (status === 'error') {
    statusColor = 'text-red-600'; StatusIcon = AlertCircle
  } else if (metrics[2].val > 0) {
    statusColor = 'text-red-600'; StatusIcon = AlertCircle
  } else if (metrics[5].val > 0) {
    statusColor = 'text-yellow-600'; StatusIcon = AlertTriangle
  } else {
    statusColor = 'text-green-600'; StatusIcon = CheckCircle2
  }

  const duplicateCount = useMemo(() => result_json?.duplicateGroups?.length || 0, [result_json])
  const manualCount = useMemo(() => (result_json?.manualReviewGroups?.length || 0) + (result_json?.nameRepeatManualGroups?.length || 0), [result_json])

  const handleExportPDF = () => {
    if (!result_json) return

    const doc = new jsPDF('landscape')

    doc.setFontSize(16)
    doc.setTextColor(20, 20, 20)
    doc.text('Relatório de Análise de Duplicidades', 14, 20)

    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    doc.text(`Arquivo: ${analysis.file_name}`, 14, 28)
    doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}`, 14, 34)

    let startY = 42

    autoTable(doc, {
      startY: startY,
      head: [['Analisado', 'Grupos', 'Duplicidades', 'G. Manual', 'G. Nome Repetido', 'Total Manual']],
      body: [[
        metrics[0].val, metrics[1].val, metrics[2].val,
        metrics[3].val, metrics[4].val, metrics[5].val
      ]],
      theme: 'grid',
      headStyles: { fillColor: [40, 40, 40], halign: 'center' },
      bodyStyles: { halign: 'center', fontStyle: 'bold' }
    })

    startY = (doc as any).lastAutoTable.finalY + 15

    const renderGroups = (groups: any[], title: string, rgbColor: [number, number, number]) => {
      if (!groups || groups.length === 0) return

      doc.setFontSize(12)
      doc.setTextColor(rgbColor[0], rgbColor[1], rgbColor[2])
      doc.text(title, 14, startY)
      startY += 6

      groups.forEach((g: any, i: number) => {
        doc.setFontSize(10)
        doc.setTextColor(60, 60, 60)
        doc.text(`Grupo ${g.groupId || i + 1} - ${g.keyName || g.records?.[0]?.nome_original || 'N/A'}`, 14, startY)

        autoTable(doc, {
          startY: startY + 3,
          head: [['Linha', 'Unidade', 'Nome', 'Departamento', 'Valor', 'Vencimento', 'Parcela', 'CPF/CNPJ']],
          body: g.records.map((r: any) => [
            r.linha_origem ?? r.linhaOrigem ?? '-',
            r.unidade ?? '-',
            r.nome_original ?? r.nomeOriginal ?? '-',
            r.departamento_original ?? r.departamentoOriginal ?? '-',
            formatCurrency(r.valor_normalizado ?? r.valorNormalizado),
            formatDate(r.vencimento),
            r.parcela || '-',
            (r.cpf_cnpj ?? r.cpfCnpj) || '-'
          ]),
          headStyles: { fillColor: rgbColor },
          styles: { fontSize: 8 }
        })

        startY = (doc as any).lastAutoTable.finalY + 8

        if (startY > 170) {
          doc.addPage()
          startY = 20
        }
      })
      startY += 5
    }

    renderGroups(result_json.duplicateGroups, 'Duplicidades Confirmadas (Risco Crítico)', [220, 38, 38])
    renderGroups(result_json.manualReviewGroups, 'Revisão Necessária - Mesmo Departamento', [202, 138, 4])
    renderGroups(result_json.nameRepeatManualGroups, 'Revisão Necessária - Nome Repetido', [202, 138, 4])

    const safeName = analysis.file_name.replace(/[^a-zA-Z0-9]/g, '_')
    doc.save(`Analise_Duplicidade_${safeName}.pdf`)
  }

  return (
    <Card className="bg-white border-gray-200 text-gray-900 shadow-md">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-200 pb-4 gap-4">
        <CardTitle className="text-xl">
          Resultado da análise: <span className="text-gray-500 font-normal ml-2">{analysis.file_name}</span>
        </CardTitle>
        <div className="flex items-center gap-3">
          <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 w-fit', statusColor)}>
            <StatusIcon className={cn('h-5 w-5', status === 'processing' && 'animate-spin')} />
            <span className="capitalize font-medium text-sm">
              {status === 'processing' ? 'Processando' : status === 'error' ? 'Erro' : 'Concluído'}
            </span>
          </div>
          {status === 'completed' && result_json && (
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-4 py-1.5 bg-white hover:bg-gray-50 text-gray-700 rounded-md transition-colors border border-gray-200 text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              Baixar PDF
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {status === 'error' && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-start gap-3">
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">A análise falhou</p>
              <p className="text-sm text-red-600 mt-1">{error_message || 'Erro desconhecido.'}</p>
            </div>
          </div>
        )}

        {(status === 'completed' || status === 'processing') && (
          <div className="mb-10">
            <h3 className="text-lg font-medium text-gray-800 mb-4 px-1">Resumo das Métricas</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {metrics.map((k) => {
                const mTheme = metricThemes[k.label] || { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-500', value: 'text-gray-900' }
                return (
                  <div key={k.label} className={cn('p-4 rounded-xl border text-center flex flex-col justify-center transition-colors', mTheme.bg, mTheme.border)}>
                    <p className={cn('text-xs font-medium mb-1.5', mTheme.text)}>{k.label}</p>
                    <p className={cn('text-3xl font-bold font-mono tracking-tight', mTheme.value)}>{k.val ?? 0}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {status === 'completed' && result_json && (
          <div className="space-y-10">
            <ZoneWrapper theme="red" icon={AlertCircle} title="Duplicidades Confirmadas" description="Ação Imediata: Alta probabilidade de pagamento duplicado detectada." count={duplicateCount}>
              <GroupedDataTable groups={result_json.duplicateGroups || []} variant="red" />
            </ZoneWrapper>

            <ZoneWrapper theme="yellow" icon={Eye} title="Revisão de Contexto" description="Análise Necessária: Coincidência parcial detectada. Verifique o contexto da despesa." count={manualCount}>
              <div className="space-y-8">
                {result_json.manualReviewGroups?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-yellow-700 mb-3 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" /> Mesmo Departamento
                    </h4>
                    <GroupedDataTable groups={result_json.manualReviewGroups} variant="yellow" />
                  </div>
                )}
                {result_json.nameRepeatManualGroups?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-yellow-700 mb-3 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Nome Repetido
                    </h4>
                    <GroupedDataTable groups={result_json.nameRepeatManualGroups} variant="yellow" />
                  </div>
                )}
                {(!result_json.manualReviewGroups?.length && !result_json.nameRepeatManualGroups?.length) && (
                  <p className="text-gray-400 p-2 text-sm italic">Nenhum caso encontrado para esta categoria.</p>
                )}
              </div>
            </ZoneWrapper>

          </div>
        )}
      </CardContent>
    </Card>
  )
}
