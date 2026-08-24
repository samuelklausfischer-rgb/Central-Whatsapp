/* Scroll Area Component primitives - A component that displays a scroll area - from shadcn/ui (exposes ScrollArea, ScrollBar) */
import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@/lib/utils'

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn('relative overflow-hidden', className)}
    {...props}
  >
    {/*
      `[&>div]:!block` conserta texto cortado na direita.

      O Radix renderiza, DENTRO do Viewport, um `div` com
      `display: table; min-width: 100%` em estilo INLINE. Um `table` se
      dimensiona pela largura do CONTEÚDO, e não pela do contêiner: um parágrafo
      longo quebra numa largura maior que a caixa, e o `overflow-hidden` do Root
      corta o que passou. Quem via isso achava que o texto era comprido demais —
      é o contêiner que se recusava a respeitar o próprio limite.

      Aquele `display: table` existe para viabilizar rolagem HORIZONTAL. Nenhum
      `ScrollArea` deste app usa `orientation="horizontal"` (conferido nos 11
      arquivos que o usam), então trocar para `block` não tira nada de ninguém.

      O `!` é obrigatório: classe não vence estilo inline.
    */}
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit] [&>div]:!block">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-colors',
      orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-[1px]',
      orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-[1px]',
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
