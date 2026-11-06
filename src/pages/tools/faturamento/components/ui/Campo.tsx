import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

export interface CampoProps {
  rotulo: string
  ajuda?: string
  erro?: string
  /** Um único controle (input/select/textarea): ganha id, aria-describedby e aria-invalid automaticamente. */
  children: ReactNode
}

/** Rótulo associado ao controle + ajuda + erro. */
export function Campo({ rotulo, ajuda, erro, children }: CampoProps) {
  const id = useId()
  const idAjuda = `${id}-ajuda`, idErro = `${id}-erro`
  const descr = [ajuda && idAjuda, erro && idErro].filter(Boolean).join(' ') || undefined
  const controle = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id, 'aria-describedby': descr, 'aria-invalid': erro ? true : undefined,
      })
    : children
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">{rotulo}</label>
      {controle}
      {ajuda && <p id={idAjuda} className="text-xs text-slate-600">{ajuda}</p>}
      {erro && <p id={idErro} role="alert" className="text-xs font-medium text-rose-700">{erro}</p>}
    </div>
  )
}

/** Classe pronta para input/select/textarea dentro de `Campo`. */
export const CLASSE_CONTROLE =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:border-[#1f4e78] focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40 disabled:bg-slate-50 disabled:text-slate-600'
