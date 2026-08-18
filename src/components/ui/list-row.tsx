/**
 * "Idioma de listas" da home (`src/pages/Index.tsx`): Minhas tarefas,
 * Anotações, Aparelhos, Conversas mais ativas e Agendamentos pendentes usavam
 * o mesmo desenho de linha copiado e colado cinco vezes — `rounded-xl`,
 * `hover:bg-foreground/5`, ponto de status opcional à esquerda, conteúdo no
 * meio, pílula/valor à direita. Este arquivo é esse desenho, uma vez só.
 *
 * `hover:bg-foreground/5` (em vez de `hover:bg-accent`) é proposital: sobre
 * vidro translúcido um token de superfície opaco (`accent`) cria um retângulo
 * sólido destoando do resto do card — `/5` sobre `foreground` acompanha o
 * texto e funciona nos dois temas sem precisar de um par `dark:`.
 *
 * REGRA DURA: nada de `backdrop-blur` aqui. Só o `GlassCard` externo (que já
 * envolve toda lista que usa `ListRow`) borra — blur aninhado (vidro dentro
 * de vidro) é o que trava a rolagem no Electron, documentado em
 * `.superficie-vidro` (`src/main.css`).
 */
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Paleta de tons reaproveitada pelo idioma de listas inteiro — o mesmo
 * vocabulário de cor que `ACENTOS` usa nos KPIs da home (`Index.tsx`), só que
 * aqui vira ponto de status e pílula em vez de ícone e bloom. "Ardósia" é o
 * tom neutro (cinza) usado quando o item não está nem atrasado nem em
 * destaque — é o que a home chamava de "futura ou sem prazo".
 */
export type ListRowTom = 'rosa' | 'ambar' | 'esmeralda' | 'ardosia' | 'violeta' | 'azul'

const CORES_PONTO: Record<ListRowTom, string> = {
  rosa: 'bg-rose-500',
  ambar: 'bg-amber-500',
  esmeralda: 'bg-emerald-500',
  ardosia: 'bg-slate-400',
  violeta: 'bg-violet-500',
  azul: 'bg-blue-500',
}

/**
 * Opacidade `/15` porque é o padrão que domina a home (pílula de prazo de
 * tarefa, selo de não lidas do aparelho, selo de agendamento hoje). As
 * Anotações usam `/10` — mais suave de propósito, porque ali o selo compete
 * com texto de categoria em vez de só um número — quem precisar desse tom
 * mais fraco passa a própria classe via `className`, não vale a pena um
 * segundo prop só para essa exceção pontual.
 */
const CORES_PILULA: Record<ListRowTom, string> = {
  rosa: 'bg-rose-500/15 text-rose-500',
  ambar: 'bg-amber-500/15 text-amber-500',
  esmeralda: 'bg-emerald-500/15 text-emerald-500',
  ardosia: 'bg-muted text-muted-foreground',
  violeta: 'bg-violet-500/15 text-violet-500',
  azul: 'bg-blue-500/15 text-blue-500',
}

/** Ponto de status colorido — o marcador à esquerda de "Minhas tarefas" e
 * "Agendamentos pendentes" na home (atrasada/vence hoje/futura). */
export function StatusDot({ tom, className }: { tom: ListRowTom; className?: string }) {
  return (
    <span
      className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', CORES_PONTO[tom], className)}
      aria-hidden="true"
    />
  )
}

/** Pílula de data/valor/categoria à direita da linha (prazo de tarefa, selo
 * de agendamento, contagem de não lidas). */
export function ListRowPill({
  tom = 'ardosia', className, children,
}: {
  tom?: ListRowTom; className?: string; children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0',
        CORES_PILULA[tom],
        className,
      )}
    >
      {children}
    </span>
  )
}

interface ListRowPropsComuns {
  /** Ponto colorido à esquerda — omitir quando a linha já abre com avatar
   * (Aparelhos, Conversas mais ativas usam `SmartAvatar` no lugar do ponto). */
  status?: ListRowTom
  className?: string
  children: React.ReactNode
}

type ListRowButtonProps = ListRowPropsComuns &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
    onClick: () => void
  }

type ListRowDivProps = ListRowPropsComuns &
  Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'> & {
    onClick?: undefined
  }

export type ListRowProps = ListRowButtonProps | ListRowDivProps

/**
 * Linha de lista sem borda. Vira `<button>` quando `onClick` é passado —
 * teclado e `role="button"` saem de graça do elemento nativo, em vez do
 * `role`/`tabIndex`/`onKeyDown` manuais que o `KpiCard` da home precisa
 * simular por ser um `GlassCard` (um `<div>`) clicável. Vira `<div>` quando
 * não há clique (ex.: linha de "Agendamentos pendentes", que não navega).
 */
export function ListRow(props: ListRowProps) {
  const { status, className, children, onClick, ...resto } = props
  const classes = cn(
    'group w-full flex items-center gap-2.5 px-2 py-2 rounded-xl',
    'hover:bg-foreground/5 transition-colors',
    onClick && 'cursor-pointer text-left',
    className,
  )

  const conteudo = (
    <>
      {status && <StatusDot tom={status} />}
      {children}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={classes}
        {...(resto as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {conteudo}
      </button>
    )
  }

  return (
    <div className={classes} {...(resto as React.HTMLAttributes<HTMLDivElement>)}>
      {conteudo}
    </div>
  )
}
