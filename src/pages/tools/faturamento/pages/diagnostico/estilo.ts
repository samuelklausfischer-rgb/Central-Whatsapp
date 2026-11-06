import { AlertTriangle, CircleDollarSign, Info, type LucideIcon } from 'lucide-react'
import type { Cor } from '../../components/ui'
import type { Severidade } from '../../lib/diagnostico'

/** Cores por severidade: bloqueia = rose, pode errar valor = amber, aviso = sky. */
export const COR_SEV: Record<Severidade, Cor> = { bloqueia: 'rose', valor: 'amber', aviso: 'sky' }
export const ICONE_SEV: Record<Severidade, LucideIcon> = { bloqueia: AlertTriangle, valor: CircleDollarSign, aviso: Info }
export const FAIXA_SEV: Record<Severidade, string> = {
  bloqueia: 'border-l-rose-500 bg-rose-50/40', valor: 'border-l-amber-500 bg-amber-50/40', aviso: 'border-l-sky-500 bg-sky-50/40',
}
export const LINK_CORRIGIR =
  'inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-[#1f4e78] shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40'
