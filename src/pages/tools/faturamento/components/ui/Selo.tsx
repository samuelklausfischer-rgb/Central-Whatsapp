import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { COR_SELO, COR_SELO_CHEIO, cn, type Cor } from './cn'

export interface SeloProps { cor?: Cor; cheio?: boolean; icone?: LucideIcon; title?: string; children: ReactNode }

/** Selo arredondado de estado (emerald sucesso, amber atenção, rose erro, sky informação, violet fixo). */
export function Selo({ cor = 'slate', cheio = false, icone: Icone, title, children }: SeloProps) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', cheio ? cn('font-semibold', COR_SELO_CHEIO[cor]) : COR_SELO[cor])}>
      {Icone && <Icone className="size-3" aria-hidden="true" />}
      {children}
    </span>
  )
}
