import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn, type Cor } from '../../components/ui/cn'

const ATIVO: Record<string, string> = {
  slate: 'border-[#1f4e78] bg-[#1f4e78] text-white hover:bg-[#173d5f]',
  amber: 'border-amber-600 bg-amber-500 text-slate-900 ring-2 ring-amber-300',
  rose: 'border-rose-700 bg-rose-600 text-white ring-2 ring-rose-300',
  indigo: 'border-indigo-700 bg-indigo-600 text-white ring-2 ring-indigo-300',
}
const REPOUSO: Record<string, string> = {
  slate: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  amber: 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200',
  rose: 'border-rose-300 bg-rose-100 text-rose-900 hover:bg-rose-200',
  indigo: 'border-indigo-300 bg-indigo-100 text-indigo-900 hover:bg-indigo-200',
}

/** Chip que liga/desliga um filtro (botão com aria-pressed), com contagem opcional. */
export function ChipFiltro({ ativo, onClick, icone: Icone, contagem, cor = 'slate', title, children }: {
  ativo: boolean; onClick: () => void; icone?: LucideIcon; contagem?: number; cor?: Cor; title?: string; children: ReactNode
}) {
  const tom = cor in ATIVO ? cor : 'slate'
  const vazio = contagem === 0 && !ativo
  return (
    <button
      type="button"
      aria-pressed={ativo}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40',
        ativo ? ATIVO[tom] : REPOUSO[tom],
        vazio && 'opacity-60',
      )}
    >
      {Icone && <Icone className="size-3.5" aria-hidden="true" />}
      {children}
      {contagem != null && <span className={cn('tabular-nums text-xs font-semibold', ativo ? 'opacity-90' : 'rounded-full bg-white/70 px-1.5')}>{contagem}</span>}
    </button>
  )
}
