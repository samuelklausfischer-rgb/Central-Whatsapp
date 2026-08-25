import { format, isSameDay, startOfDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { corDoBloco } from './cores'
import {
  ALTURA_DA_HORA,
  DIAS_DA_SEMANA,
  HORA_FINAL,
  HORA_INICIAL,
  posicaoNaFaixa,
  type ItemDaAgenda,
} from './tipos'

/**
 * A régua de horas das visões de semana e dia.
 *
 * As duas usam ESTE componente; a única diferença é quantos dias entram lado a
 * lado (`dias.length`). Duas grades separadas seriam duas chances de a régua
 * divergir entre elas.
 */
export function GradeDeHoras({
  dias,
  horas,
  porDia,
  aoSelecionarDia,
  aoMarcarNoDia,
  aoAbrirCompromisso,
}: {
  dias: Date[]
  horas: number[]
  porDia: Map<string, ItemDaAgenda[]>
  aoSelecionarDia: (dia: Date) => void
  aoMarcarNoDia: (dia: Date) => void
  aoAbrirCompromisso: (ev: ItemDaAgenda) => void
}) {
  const alturaTotal = horas.length * ALTURA_DA_HORA

  return (
    <div className="superficie-vidro overflow-auto rounded-xl p-3">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `3rem repeat(${dias.length}, minmax(0,1fr))` }}
      >
        <span />
        {dias.map((dia) => {
          const hoje = isSameDay(dia, new Date())
          return (
            <button
              key={dia.toISOString()}
              type="button"
              onClick={() => aoSelecionarDia(startOfDay(dia))}
              className="pb-2 text-center text-[11px] font-medium uppercase text-muted-foreground"
            >
              <span className="block">{DIAS_DA_SEMANA[dia.getDay()]}</span>
              <span
                className={cn(
                  'mt-0.5 inline-block text-sm tabular-nums',
                  hoje ? 'rounded-full bg-primary px-1.5 text-primary-foreground' : 'text-foreground',
                )}
              >
                {format(dia, 'd')}
              </span>
            </button>
          )
        })}

        <div className="relative" style={{ height: alturaTotal }}>
          {horas.map((h, i) => (
            <span
              key={h}
              className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
              style={{ top: i * ALTURA_DA_HORA }}
            >
              {String(h).padStart(2, '0')}h
            </span>
          ))}
        </div>

        {dias.map((dia) => {
          const doDia = porDia.get(format(dia, 'yyyy-MM-dd')) || []
          const agora = new Date()
          const horaAtual = agora.getHours() + agora.getMinutes() / 60
          const mostrarAgora =
            isSameDay(dia, agora) && horaAtual >= HORA_INICIAL && horaAtual <= HORA_FINAL + 1

          return (
            <div
              key={dia.toISOString()}
              className="relative rounded-lg border border-border/40"
              style={{ height: alturaTotal }}
              onDoubleClick={() => aoMarcarNoDia(dia)}
              title="Dois cliques para marcar algo neste dia"
            >
              {horas.map((h, i) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-border/25"
                  style={{ top: i * ALTURA_DA_HORA }}
                />
              ))}

              {/* Compromisso de dia inteiro não tem hora: vai numa faixa fixa
                  no topo, senão cairia às 00h — fora da régua. */}
              <div className="absolute inset-x-0.5 top-0.5 z-10 flex flex-col gap-0.5">
                {doDia
                  .filter((ev) => ev.dia_inteiro)
                  .map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => ev.podeEditar && aoAbrirCompromisso(ev)}
                      className={cn(
                        'truncate rounded border px-1 text-left text-[10px] leading-4',
                        corDoBloco(ev.origem, ev.importancia),
                      )}
                    >
                      {ev.titulo}
                    </button>
                  ))}
              </div>

              {doDia
                .filter((ev) => !ev.dia_inteiro)
                .map((ev) => {
                  const { top, height } = posicaoNaFaixa(new Date(ev.starts_at), new Date(ev.ends_at))
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => ev.podeEditar && aoAbrirCompromisso(ev)}
                      title={`${format(new Date(ev.starts_at), 'HH:mm')} – ${format(new Date(ev.ends_at), 'HH:mm')} · ${ev.titulo}`}
                      className={cn(
                        'absolute inset-x-0.5 overflow-hidden rounded border px-1 text-left text-[10px] leading-tight transition-opacity hover:opacity-80',
                        corDoBloco(ev.origem, ev.importancia),
                      )}
                      style={{ top, height }}
                    >
                      <span className="block truncate font-medium">{ev.titulo}</span>
                      {/* Só mostra a hora se couber: abaixo de ~30px a segunda
                          linha sai cortada pela metade, que é pior que não ter. */}
                      {height > 30 && (
                        <span className="block truncate opacity-75">
                          {format(new Date(ev.starts_at), 'HH:mm')}
                        </span>
                      )}
                    </button>
                  )
                })}

              {mostrarAgora && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
                  style={{ top: (horaAtual - HORA_INICIAL) * ALTURA_DA_HORA }}
                >
                  <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
