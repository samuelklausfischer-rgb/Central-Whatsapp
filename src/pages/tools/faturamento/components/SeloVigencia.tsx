import { alertaVigencia, plural } from '../lib/format'

/** Selo de fim de vigência: vermelho se vencida, âmbar se vence em até 60 dias; nada nos demais casos. */
export function SeloVigencia({ fim, curto = false }: { fim: string | null | undefined; curto?: boolean }) {
  const a = alertaVigencia(fim)
  if (!a) return null
  const cor = a.tipo === 'vencida' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'
  const texto = curto
    ? (a.tipo === 'vencida' ? `Vencida há ${plural(a.dias, 'dia', 'dias')}` : a.dias === 0 ? 'Vence hoje' : `Vence em ${plural(a.dias, 'dia', 'dias')}`)
    : a.texto
  return <span title={a.texto} className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cor}`}>{texto}</span>
}
