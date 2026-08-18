/* Painel de vidro reutilizável para telas de entrada (splash de atualização, login).
   Isolado de AuthShell porque o harness de dev também precisa montá-lo sozinho. */
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function GlassPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // `bg-background/70` só fica legível porque quem monta este painel garante escopo `.dark`
        // ao redor (ver AuthShell) — um vidro claro sobre foto some de vista.
        'w-[400px] max-w-[calc(100vw-4rem)] rounded-2xl border border-border/60 bg-background/70 p-8 shadow-2xl backdrop-blur-2xl',
        'animate-in fade-in slide-in-from-bottom-4 duration-500',
        className,
      )}
    >
      {children}
    </div>
  )
}
