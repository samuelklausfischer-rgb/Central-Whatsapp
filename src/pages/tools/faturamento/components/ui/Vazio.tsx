import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** Estado vazio centralizado: ícone, título, texto e ação opcional. */
export function Vazio({ icone: Icone, titulo, texto, acao }: { icone: LucideIcon; titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <span className="rounded-full bg-white p-3 text-slate-600 shadow-sm ring-1 ring-slate-200" aria-hidden="true"><Icone className="size-6" /></span>
      <p className="mt-3 text-sm font-semibold text-slate-900">{titulo}</p>
      {texto && <p className="mt-1 max-w-md text-sm text-slate-600">{texto}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  )
}
