import { cn } from './cn'

export interface BarraVigenciaProps { inicio: string | null | undefined; fim: string | null | undefined; hoje: string }

const MS_DIA = 86_400_000
const ms = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(a, m - 1, d) }
const dma = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const dias = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`

/** Barra de progresso do contrato (datas ISO AAAA-MM-DD) com "faltam N dias" / "venceu há N dias". */
export function BarraVigencia({ inicio, fim, hoje }: BarraVigenciaProps) {
  if (!fim) return <p className="text-sm text-slate-600">Sem data de fim cadastrada.</p>
  const f = ms(fim), h = ms(hoje), i = inicio ? ms(inicio) : null
  const restam = Math.round((f - h) / MS_DIA)
  const vencida = restam < 0
  const pct = i == null || f <= i ? (vencida ? 100 : 0) : Math.min(100, Math.max(0, ((h - i) / (f - i)) * 100))
  const cor = vencida ? 'bg-rose-500' : restam <= 60 ? 'bg-amber-500' : 'bg-emerald-500'
  const textoCor = vencida ? 'text-rose-700' : restam <= 60 ? 'text-amber-800' : 'text-emerald-700'
  const texto = vencida ? `Venceu há ${dias(-restam)}` : restam === 0 ? 'Vence hoje' : `Faltam ${dias(restam)}`
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs text-slate-600">
        <span>{inicio ? dma(inicio) : 'Início não informado'}</span>
        <span className={cn('text-sm font-semibold', textoCor)}>{texto}</span>
        <span>{dma(fim)}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`Vigência: ${texto}`}
        className="h-2 overflow-hidden rounded-full bg-slate-100"
      >
        <div className={cn('h-full rounded-full transition-all', cor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
