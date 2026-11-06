import type { ReactNode } from 'react'
import { Pencil, type LucideIcon } from 'lucide-react'
import { COR_SECAO, cn, type CorSecao } from './cn'

export interface CartaoProps {
  titulo: string
  icone?: LucideIcon
  descricao?: string
  acoes?: ReactNode
  id?: string
  destaque?: 'edicao'
  /** Cor da seção (filete no topo e quadrado do ícone). Padrão: slate. */
  cor?: CorSecao
  /** Cabeçalho tingido com a cor da seção (usado nos cartões laterais). */
  tingido?: boolean
  children?: ReactNode
}

/** Seção com filete colorido, cabeçalho (ícone, título, descrição) e ações à direita. `destaque='edicao'` marca o cartão em edição. */
export function Cartao({ titulo, icone: Icone, descricao, acoes, id, destaque, cor = 'slate', tingido, children }: CartaoProps) {
  const c = COR_SECAO[cor]
  return (
    <section
      id={id}
      className={cn(
        'relative scroll-mt-20 overflow-hidden rounded-xl border p-5 pt-6 shadow-sm transition-colors',
        destaque === 'edicao' ? 'border-sky-300 bg-sky-50/30 ring-2 ring-sky-300' : tingido ? c.tinta.split(' ')[0] + ' bg-white' : 'border-slate-200 bg-white',
      )}
    >
      <span className={cn('absolute inset-x-0 top-0 h-1.5', destaque === 'edicao' ? 'bg-sky-500' : c.filete)} aria-hidden="true" />
      {destaque === 'edicao' && (
        <p className="-mx-5 -mt-6 mb-4 flex items-center gap-2 bg-sky-600 px-5 pb-2 pt-3.5 text-sm font-medium text-white">
          <Pencil className="size-4" aria-hidden="true" />Você está editando — nada é gravado antes de confirmar
        </p>
      )}
      <header className={cn('flex flex-wrap items-start gap-3', tingido && cn('-mx-5 -mt-2 border-b px-5 pb-3 pt-2', c.tinta))}>
        {Icone && (
          <span className={cn('rounded-lg p-2', c.icone)} aria-hidden="true">
            <Icone className="size-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
          {descricao && <p className="mt-0.5 text-sm text-slate-600">{descricao}</p>}
        </div>
        {acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
      </header>
      {children != null && <div className="mt-4 border-t border-slate-100 pt-4">{children}</div>}
    </section>
  )
}
