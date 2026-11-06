import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { TriangleAlert } from 'lucide-react'
import { cn } from './cn'

export interface ItemDefinicao { rotulo: string; valor: ReactNode; icone?: LucideIcon; alerta?: boolean }

/** Lista "rótulo · valor" para o modo leitura. `alerta` pinta o valor em âmbar com ícone de atenção. */
export function Definicoes({ itens }: { itens: ItemDefinicao[] }) {
  return (
    <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
      {itens.map((it, i) => {
        const Icone = it.icone
        return (
          <div key={`${it.rotulo}-${i}`} className="contents">
            <dt className="flex items-center gap-1.5 text-slate-600">
              {Icone && <Icone className="size-3.5 shrink-0" aria-hidden="true" />}
              {it.rotulo}
            </dt>
            <dd className={cn('min-w-0 break-words', it.alerta ? 'font-medium text-amber-800' : 'text-slate-900')}>
              {it.alerta && <TriangleAlert className="mr-1 inline size-3.5 align-[-2px]" aria-label="Atenção" />}
              {it.valor}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
