import type { ReactNode } from 'react'

const TONS = {
  ambar: 'border-amber-200 bg-amber-50 text-amber-900',
  vermelho: 'border-rose-200 bg-rose-50 text-rose-800',
} as const

/** Aviso discreto em linha (âmbar = atenção, vermelho = erro). */
export function Aviso({ tom = 'ambar', children }: { tom?: keyof typeof TONS; children: ReactNode }) {
  return <span role={tom === 'vermelho' ? 'alert' : undefined} className={`inline-block rounded border px-2 py-0.5 text-xs ${TONS[tom]}`}>{children}</span>
}
