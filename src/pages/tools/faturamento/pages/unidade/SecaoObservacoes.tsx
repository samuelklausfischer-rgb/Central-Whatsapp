import { ChevronDown, Info, StickyNote } from 'lucide-react'

export function SecaoObservacoes({ observacoes }: { observacoes: string[] }) {
  if (!(observacoes?.length > 0)) return null
  return (
    <details id="observacoes" className="group relative scroll-mt-20 overflow-hidden rounded-xl border border-slate-200 bg-white p-5 pt-6 shadow-sm">
      <span className="absolute inset-x-0 top-0 h-1.5 bg-slate-400" aria-hidden="true" />
      <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <span className="rounded-lg bg-slate-100 p-2 text-slate-700" aria-hidden="true"><StickyNote className="size-5" /></span>
        <span className="flex-1 text-base font-semibold text-slate-900">Observações do contrato <span className="text-sm font-normal text-slate-600">({observacoes.length})</span></span>
        <ChevronDown className="size-4 text-slate-600 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Regra escrita só aqui não entra no cálculo. Para valer na fatura, ela precisa estar em “Como fatura”, nos preços ou nos aditivos.
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">{observacoes.map((o, k) => <li key={k}>{o}</li>)}</ul>
      </div>
    </details>
  )
}
