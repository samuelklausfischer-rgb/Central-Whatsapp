/**
 * `GlassDialogContent` — variante densa do `DialogContent` do shadcn
 * (`@/components/ui/dialog`) para os ~9 modais das telas que virão.
 *
 * Modal fica por cima de conteúdo desfocado (o overlay `bg-black/80` do
 * `DialogContent` base já borra o que está atrás visualmente), então o
 * próprio modal precisa de MAIS contraste que um card comum, não menos — se
 * usássemos `.superficie-vidro` (opacidade 0.72 claro / 0.55 escuro, pensada
 * para ficar sobre o fundo do PRN em telas normais) o texto competiria com o
 * conteúdo desfocado atrás do overlay.
 *
 * Não existe token pronto para essa opacidade mais alta — e este arquivo não
 * tem permissão para mexer em `src/main.css` para criar um. Resolvido só com
 * utilitários do Tailwind (`bg-background/95` + `backdrop-blur-xl`) em cima
 * do `DialogContent` base. Se esse padrão se repetir bastante pelas telas
 * novas, vale promover isso a um token `--vidro-modal-opacidade` depois —
 * por ora, uma classe utilitária resolve sem inventar variável que não
 * existe no design system.
 */
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

import { DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export const GlassDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <DialogContent
    ref={ref}
    className={cn(
      // `bg-background/95` (não `bg-card`): `background` é o token de fundo
      // de página, o mais neutro possível nos dois temas — `card` já carrega
      // uma leitura de "superfície empilhada" que aqui duplicaria com o
      // próprio modal. `backdrop-blur-xl` (~24px) é maior que os 12px do
      // `.superficie-vidro`: não há uma dúzia de modais na tela ao mesmo
      // tempo como há cards, então o limite de performance documentado em
      // `main.css` não se aplica aqui.
      'bg-background/95 backdrop-blur-xl',
      className,
    )}
    {...props}
  />
))
GlassDialogContent.displayName = 'GlassDialogContent'
