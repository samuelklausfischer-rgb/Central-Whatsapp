import { useRef, type KeyboardEvent } from 'react'
import { cn, FOCO } from './cn'

export interface OpcaoSegmentado { valor: string; rotulo: string; descricao?: string }
export interface SegmentadoProps {
  opcoes: OpcaoSegmentado[]
  valor: string
  onChange: (valor: string) => void
  nome: string
  /** Rótulo acessível do grupo (padrão: nome). */
  rotulo?: string
}

/** Escolha única em botões/cartões (radiogroup acessível; setas, Home e End navegam e selecionam). */
export function Segmentado({ opcoes, valor, onChange, nome, rotulo }: SegmentadoProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const atual = opcoes.findIndex(o => o.valor === valor)
  const comDescricao = opcoes.some(o => o.descricao)

  function aoTeclar(e: KeyboardEvent, i: number) {
    const passo = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!passo && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const n = opcoes.length
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + passo + n) % n
    onChange(opcoes[j].valor)
    refs.current[j]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={rotulo ?? nome}
      data-nome={nome}
      className={cn('grid gap-2', comDescricao ? 'sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]' : 'grid-flow-col auto-cols-fr')}
    >
      {opcoes.map((o, i) => {
        const marcado = o.valor === valor
        return (
          <button
            key={o.valor}
            ref={el => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={marcado}
            tabIndex={marcado || (atual < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.valor)}
            onKeyDown={e => aoTeclar(e, i)}
            className={cn(
              'rounded-lg border px-3 py-2 text-left transition-colors',
              marcado ? 'border-[#1f4e78] bg-[#1f4e78]/5 ring-1 ring-[#1f4e78]' : 'border-slate-300 bg-white hover:bg-slate-50',
              FOCO,
            )}
          >
            <span className={cn('block text-sm font-medium', marcado ? 'text-[#1f4e78]' : 'text-slate-800')}>{o.rotulo}</span>
            {o.descricao && <span className="mt-0.5 block text-xs text-slate-600">{o.descricao}</span>}
          </button>
        )
      })}
    </div>
  )
}
