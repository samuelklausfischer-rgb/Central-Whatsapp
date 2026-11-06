import { SEVERIDADES, ROTULO_SEVERIDADE, type Severidade } from '../../lib/diagnostico'
import { cn } from '../../components/ui/cn'
import { ICONE_SEV } from './estilo'

const DESCRICAO: Record<Severidade, string> = {
  bloqueia: 'O exame sai a R$ 0 ou o relatório pede correção',
  valor: 'Pode cobrar a mais, a menos ou deixar de cobrar',
  aviso: 'Vale conferir, mas não muda valor sozinho',
}
const CARTAO: Record<Severidade, { base: string; ativo: string; numero: string }> = {
  bloqueia: { base: 'border-rose-200 bg-rose-50 hover:bg-rose-100', ativo: 'ring-2 ring-rose-400', numero: 'text-rose-800' },
  valor: { base: 'border-amber-200 bg-amber-50 hover:bg-amber-100', ativo: 'ring-2 ring-amber-400', numero: 'text-amber-900' },
  aviso: { base: 'border-sky-200 bg-sky-50 hover:bg-sky-100', ativo: 'ring-2 ring-sky-400', numero: 'text-sky-800' },
}

/** Três cartões de contagem, clicáveis como filtro de severidade. */
export function ResumoSeveridade({ contagem, ativo, onEscolher }: { contagem: Record<Severidade, number>; ativo: Severidade | ''; onEscolher: (s: Severidade | '') => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {SEVERIDADES.map(s => {
        const Icone = ICONE_SEV[s]
        const c = CARTAO[s]
        return (
          <button key={s} type="button" aria-pressed={ativo === s} onClick={() => onEscolher(ativo === s ? '' : s)}
            className={cn('rounded-xl border p-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40', c.base, ativo === s && c.ativo)}>
            <span className={cn('flex items-center gap-2 text-sm font-semibold', c.numero)}><Icone className="size-4" aria-hidden="true" />{ROTULO_SEVERIDADE[s]}</span>
            <span className={cn('mt-1 block text-3xl font-bold tabular-nums', c.numero)}>{contagem[s]}</span>
            <span className="mt-0.5 block text-xs text-slate-700">{DESCRICAO[s]}</span>
          </button>
        )
      })}
    </div>
  )
}
