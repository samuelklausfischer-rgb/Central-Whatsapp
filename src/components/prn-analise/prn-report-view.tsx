import { Card } from '@/components/ui/card'
import { FileJson, AlertCircle } from 'lucide-react'
import { PrnCrossAnalysis } from '@/components/prn-analise/prn-cross-analysis'
import type { AnalysisRecord } from '@/services/prn-analise/analise-duplicidade'

export function PrnReportView({ data, duplicityAnalysis, runId }: { data: any; duplicityAnalysis?: AnalysisRecord; runId?: string }) {
  if (data?.type === 'legacy_html') {
    return (
      <Card className="p-8 text-center bg-white border-gray-200 shadow-sm">
        <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
        <h3 className="text-xl font-bold text-gray-900">Relatório Legado</h3>
        <p className="text-gray-400 mt-2 max-w-md mx-auto">
          Relatórios antigos não são mais suportados nesta visualização.
        </p>
      </Card>
    )
  }

  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center border-2 rounded-3xl bg-gray-50 border-dashed border-gray-200 animate-in fade-in duration-500">
        <FileJson className="h-20 w-20 text-gray-200 mb-6" />
        <h3 className="text-3xl font-black text-gray-700 mb-2 tracking-tighter">Motor Silencioso</h3>
        <p className="text-gray-400 text-lg max-w-md">
          A execução foi concluída, mas não retornou uma estrutura de dados reconhecida.
        </p>
      </div>
    )
  }

  const crossAnalysis = data.data?.byBlock
    ? { byBlock: data.data.byBlock }
    : (data.data?.crossAnalysis || { rows: [], months: [] })

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000">
      <PrnCrossAnalysis data={crossAnalysis} fullPayload={data} duplicityAnalysis={duplicityAnalysis} runId={runId} />
    </div>
  )
}
