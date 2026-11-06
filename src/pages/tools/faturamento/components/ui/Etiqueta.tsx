import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Selo } from './Selo'

/** Etiqueta de regra especial (indigo). */
export function Etiqueta({ icone, title, children }: { icone?: LucideIcon; title?: string; children: ReactNode }) {
  return <Selo cor="indigo" icone={icone} title={title}>{children}</Selo>
}
