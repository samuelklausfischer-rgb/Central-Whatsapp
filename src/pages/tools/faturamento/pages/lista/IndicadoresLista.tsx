import { AlertTriangle, ClipboardList, Building2, ShieldCheck, type LucideIcon } from 'lucide-react'
import { cn } from '../../components/ui/cn'

type Tom = 'blue' | 'emerald' | 'rose' | 'amber'
const TOM: Record<Tom, { caixa: string; icone: string; numero: string }> = {
  blue: { caixa: 'border-sky-200 bg-gradient-to-br from-sky-50 to-white', icone: 'bg-[#1f4e78] text-white', numero: 'text-[#1f4e78]' },
  emerald: { caixa: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white', icone: 'bg-emerald-600 text-white', numero: 'text-emerald-700' },
  rose: { caixa: 'border-rose-300 bg-gradient-to-br from-rose-50 to-white', icone: 'bg-rose-600 text-white', numero: 'text-rose-700' },
  amber: { caixa: 'border-amber-300 bg-gradient-to-br from-amber-50 to-white', icone: 'bg-amber-500 text-slate-900', numero: 'text-amber-800' },
}

function Cartaozinho({ rotulo, valor, icone: Icone, tom, dica }: { rotulo: string; valor: number; icone: LucideIcon; tom: Tom; dica: string }) {
  const t = TOM[tom]
  return (
    <div title={dica} className={cn('flex items-center gap-3 rounded-xl border px-4 py-3 shadow-sm', t.caixa)}>
      <span className={cn('rounded-xl p-2.5', t.icone)} aria-hidden="true"><Icone className="size-5" /></span>
      <div>
        <p className={cn('text-2xl font-bold tabular-nums leading-none', t.numero)}>{valor}</p>
        <p className="mt-1 text-xs font-semibold text-slate-700">{rotulo}</p>
      </div>
    </div>
  )
}

/** Faixa de números no topo da lista (sobre todas as unidades, sem considerar os filtros). */
export function IndicadoresLista({ total, vigentes, atencao, pendencia }: { total: number; vigentes: number; atencao: number; pendencia: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Resumo das unidades">
      <Cartaozinho rotulo="Total de unidades" valor={total} icone={Building2} tom="blue" dica="Todas as unidades cadastradas" />
      <Cartaozinho rotulo="Vigentes" valor={vigentes} icone={ShieldCheck} tom="emerald" dica="Contratos com situação vigente" />
      <Cartaozinho rotulo="Precisam de atenção" valor={atencao} icone={AlertTriangle} tom={atencao > 0 ? 'rose' : 'emerald'} dica="Vencida marcada como vigente, sem preço ou tipo de cobrança divergente" />
      <Cartaozinho rotulo="Com pendência" valor={pendencia} icone={ClipboardList} tom="amber" dica="Unidades com pendência de cadastro aberta" />
    </div>
  )
}
