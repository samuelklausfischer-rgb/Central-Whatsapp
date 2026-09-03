import { format, isSameDay, isSameMonth, startOfDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { corDoItem, estiloDaCorPessoal } from './cores'
import { DIAS_DA_SEMANA, type ItemDaAgenda } from './tipos'

/**
 * A grade do mês, 7 colunas × 6 semanas.
 *
 * Montada à mão com `date-fns`, que o projeto já usa, em vez de trazer uma
 * biblioteca de calendário: as prontas chegam com folha de estilo própria e
 * brigam com o vidro do app — encaixá-las custaria mais que desenhar 42 células.
 */
export function GradeDoMes({
  dias,
  mes,
  diaSelecionado,
  porDia,
  aoSelecionarDia,
  aoMarcarNoDia,
}: {
  dias: Date[]
  mes: Date
  diaSelecionado: Date
  porDia: Map<string, ItemDaAgenda[]>
  aoSelecionarDia: (dia: Date) => void
  aoMarcarNoDia: (dia: Date) => void
}) {
  return (
    <div className="superficie-vidro rounded-xl p-3">
      <div className="grid grid-cols-7 gap-1 pb-2 text-center text-[11px] font-medium uppercase text-muted-foreground">
        {DIAS_DA_SEMANA.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map((dia) => {
          const doDia = porDia.get(format(dia, 'yyyy-MM-dd')) || []
          const noMes = isSameMonth(dia, mes)
          const selecionado = isSameDay(dia, diaSelecionado)
          const hoje = isSameDay(dia, new Date())
          return (
            <div
              key={dia.toISOString()}
              role="button"
              tabIndex={0}
              onClick={() => aoSelecionarDia(startOfDay(dia))}
              onDoubleClick={() => aoMarcarNoDia(dia)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  aoSelecionarDia(startOfDay(dia))
                }
              }}
              title="Clique para ver o dia · dois cliques para marcar algo"
              className={cn(
                'flex min-h-[92px] cursor-pointer flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition-colors',
                noMes ? 'border-border/50' : 'border-transparent opacity-40',
                selecionado ? 'border-primary bg-primary/10' : 'hover:bg-accent/50',
              )}
            >
              <span
                className={cn(
                  'text-xs tabular-nums',
                  hoje && 'rounded-full bg-primary px-1.5 font-semibold text-primary-foreground',
                )}
              >
                {format(dia, 'd')}
              </span>

              {/* Teto de 3: acima disso a célula cresce e a grade inteira
                  desalinha. O resto vira "+N" e aparece na lista ao lado. */}
              {doDia.slice(0, 3).map((ev) => (
                <span
                  key={ev.id}
                  className={cn(
                    'w-full truncate rounded border px-1 text-[10px] leading-4',
                    corDoItem(ev.origem, ev.importancia),
                  )}
                  style={estiloDaCorPessoal(ev.cor)}
                >
                  {ev.dia_inteiro ? '' : `${format(new Date(ev.starts_at), 'HH:mm')} `}
                  {ev.titulo}
                </span>
              ))}
              {doDia.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{doDia.length - 3}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
