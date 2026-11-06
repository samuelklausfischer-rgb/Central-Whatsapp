/** Junta classes ignorando falsos. */
export function cn(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

export const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40'

export type Cor = 'slate' | 'emerald' | 'amber' | 'rose' | 'sky' | 'indigo' | 'violet'
export const COR_SELO: Record<Cor, string> = {
  slate: 'bg-slate-50 text-slate-700 ring-slate-200',
  emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  rose: 'bg-rose-50 text-rose-800 ring-rose-200',
  sky: 'bg-sky-50 text-sky-800 ring-sky-200',
  indigo: 'bg-indigo-100 text-indigo-900 ring-indigo-300',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
}

/** Cor por seção: filete no topo do cartão, quadrado do ícone e texto/fundo do item do índice. */
export type CorSecao = 'slate' | 'sky' | 'indigo' | 'emerald' | 'violet' | 'cyan' | 'amber'
export const COR_SECAO: Record<CorSecao, { filete: string; icone: string; indice: string; tinta: string }> = {
  slate: { filete: 'bg-slate-400', icone: 'bg-slate-100 text-slate-700', indice: 'hover:bg-slate-100 text-slate-700', tinta: 'border-slate-200 bg-slate-50' },
  sky: { filete: 'bg-sky-500', icone: 'bg-sky-100 text-sky-700', indice: 'hover:bg-sky-50 text-sky-800', tinta: 'border-sky-200 bg-sky-50' },
  indigo: { filete: 'bg-indigo-500', icone: 'bg-indigo-100 text-indigo-700', indice: 'hover:bg-indigo-50 text-indigo-800', tinta: 'border-indigo-200 bg-indigo-50' },
  emerald: { filete: 'bg-emerald-500', icone: 'bg-emerald-100 text-emerald-700', indice: 'hover:bg-emerald-50 text-emerald-800', tinta: 'border-emerald-200 bg-emerald-50' },
  violet: { filete: 'bg-violet-500', icone: 'bg-violet-100 text-violet-700', indice: 'hover:bg-violet-50 text-violet-800', tinta: 'border-violet-200 bg-violet-50' },
  cyan: { filete: 'bg-cyan-500', icone: 'bg-cyan-100 text-cyan-800', indice: 'hover:bg-cyan-50 text-cyan-900', tinta: 'border-cyan-200 bg-cyan-50' },
  amber: { filete: 'bg-amber-500', icone: 'bg-amber-100 text-amber-800', indice: 'hover:bg-amber-50 text-amber-900', tinta: 'border-amber-200 bg-amber-50' },
}

/** Versão cheia (fundo forte, texto branco) para destaques de estado. */
export const COR_SELO_CHEIO: Record<Cor, string> = {
  slate: 'bg-slate-600 text-white ring-slate-700',
  emerald: 'bg-emerald-600 text-white ring-emerald-700',
  amber: 'bg-amber-500 text-slate-900 ring-amber-600',
  rose: 'bg-rose-600 text-white ring-rose-700',
  sky: 'bg-sky-600 text-white ring-sky-700',
  indigo: 'bg-indigo-600 text-white ring-indigo-700',
  violet: 'bg-violet-600 text-white ring-violet-700',
}
