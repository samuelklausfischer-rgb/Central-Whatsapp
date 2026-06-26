import { Card, CardContent } from '@/components/ui/card'
import { Calendar, FileText, Hash, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/prn-analise/formatters'

export function PrnHeader({ header }: { header: any }) {
  if (!header) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <Card className="bg-white border-gray-200 shadow-sm group animate-in fade-in slide-in-from-left-4 duration-500">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="p-2.5 bg-blue-100 rounded-xl border border-blue-200 group-hover:scale-110 transition-transform">
            <Hash className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Protocolo ID</p>
            <p className="text-sm font-black text-gray-800 truncate max-w-[150px] font-mono">{header.requestId || '---'}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200 shadow-sm group animate-in fade-in slide-in-from-left-4 duration-700">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="p-2.5 bg-emerald-100 rounded-xl border border-emerald-200 group-hover:scale-110 transition-transform">
            <Calendar className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Referência</p>
            <p className="text-sm font-black text-gray-800">{formatDate(header.referenceDateUsed) || '---'}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200 shadow-sm group md:col-span-2 animate-in fade-in slide-in-from-left-4 duration-1000">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-gray-100 rounded-xl border border-gray-200 group-hover:scale-110 transition-transform">
              <FileText className="h-5 w-5 text-gray-500" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] h-4 bg-gray-100 border-gray-200 text-gray-500 font-bold uppercase tracking-tighter">Diário</Badge>
                <p className="text-xs font-bold text-gray-700 truncate max-w-[200px]">{header.dailyFile || '---'}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] h-4 bg-gray-100 border-gray-200 text-gray-500 font-bold uppercase tracking-tighter">Histórico</Badge>
                <p className="text-xs font-bold text-gray-700 truncate max-w-[200px]">{header.historicalFile || '---'}</p>
              </div>
            </div>
          </div>
          <div className="hidden lg:flex flex-col items-end">
             <div className="flex items-center gap-1 text-emerald-600">
               <ShieldCheck className="h-4 w-4" />
               <span className="text-[10px] font-black uppercase tracking-tighter">Auditado</span>
             </div>
             <p className="text-[9px] text-gray-400 font-bold uppercase mt-0.5 tracking-tighter">Integridade 100%</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
