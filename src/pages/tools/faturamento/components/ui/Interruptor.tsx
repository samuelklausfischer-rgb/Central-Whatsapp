import { useId } from 'react'
import { cn, FOCO } from './cn'

export interface InterruptorProps {
  ligado: boolean
  onChange: (ligado: boolean) => void
  rotulo: string
  descricao?: string
  desabilitado?: boolean
}

/** Switch acessível (role="switch") com rótulo e descrição. */
export function Interruptor({ ligado, onChange, rotulo, descricao, desabilitado }: InterruptorProps) {
  const id = useId()
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={ligado}
        aria-describedby={descricao ? `${id}-d` : undefined}
        disabled={desabilitado}
        onClick={() => onChange(!ligado)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          ligado ? 'bg-[#1f4e78]' : 'bg-slate-300', FOCO,
        )}
      >
        <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', ligado ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-slate-900">{rotulo}</label>
        {descricao && <p id={`${id}-d`} className="text-xs text-slate-600">{descricao}</p>}
      </div>
    </div>
  )
}
