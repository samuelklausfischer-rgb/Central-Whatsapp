/**
 * `GlassCard` é o `Card` de sempre (`@/components/ui/card`) com a pele de
 * vidro (`.superficie-vidro`, definida em `src/main.css`) por cima. Existe
 * como componente separado — em vez de espalhar `superficie-vidro` direto
 * pelo app — porque o `Card` já vem com `bg-card`: um preenchimento opaco do
 * design system que, se não for sobrescrito, esconde o vidro por completo
 * (o `className` do `cn()` entra depois e vence, mas só se `border-0` e o
 * fundo forem repassados aqui, e não deixados para quem consome o card).
 *
 * Não alteramos `card.tsx` de propósito: o `Card` base serve o app inteiro,
 * inclusive telas que não têm o fundo do PRN atrás (ex.: dentro do chat).
 *
 * Conceitualmente é o mesmo princípio do `GlassPanel`
 * (`@/components/ui/glass-panel.tsx`, usado no login/splash de atualização):
 * um contêiner translúcido com blur sobre uma imagem de fundo. A diferença é
 * o par de tokens — `GlassPanel` usa `bg-background/70` fixo pensado para
 * ficar sobre foto, `GlassCard` usa os tokens `--vidro-*` pensados para o
 * fundo SVG do PRN e para respeitar o tema claro/escuro sem depender de
 * quem monta a tela garantir escopo `.dark` como o `GlassPanel` exige.
 */
import * as React from 'react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const GlassCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <Card ref={ref} className={cn('superficie-vidro rounded-2xl border-0 bg-transparent', className)} {...props} />
  ),
)
GlassCard.displayName = 'GlassCard'

export { GlassCard }
