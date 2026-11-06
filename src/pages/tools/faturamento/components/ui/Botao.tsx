import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { FOCO, cn } from './cn'

export interface BotaoProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variante?: 'primario' | 'secundario' | 'fantasma' | 'perigo'
  icone?: LucideIcon
  tamanho?: 'pequeno' | 'medio'
}

const VARIANTE = {
  primario: 'bg-[#1f4e78] text-white hover:bg-[#173d5f] border border-transparent shadow-sm',
  secundario: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 shadow-sm',
  fantasma: 'bg-transparent text-slate-700 border border-transparent hover:bg-slate-100',
  perigo: 'bg-rose-600 text-white border border-transparent hover:bg-rose-700 shadow-sm',
} as const

/** Botão com variantes, ícone opcional à esquerda e foco visível. */
export function Botao({ variante = 'secundario', icone: Icone, tamanho = 'medio', type = 'button', children, ...r }: BotaoProps) {
  return (
    <button
      type={type}
      {...r}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tamanho === 'pequeno' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        VARIANTE[variante], FOCO,
      )}
    >
      {Icone && <Icone className={tamanho === 'pequeno' ? 'size-3.5' : 'size-4'} aria-hidden="true" />}
      {children}
    </button>
  )
}
