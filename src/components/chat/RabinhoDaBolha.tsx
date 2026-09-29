import { cn } from '@/lib/utils'

/**
 * O "rabinho" do WhatsApp: só no primeiro balão de uma sequência. Herda a cor
 * do balão por `currentColor`, então quem usa passa a classe de texto com a
 * mesma cor do fundo (`text-chat-bubble-out` / `text-chat-bubble-in`).
 */
export function RabinhoDaBolha({ lado, className }: { lado: 'esquerda' | 'direita'; className?: string }) {
  const direita = lado === 'direita'
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 13"
      width="8"
      height="13"
      className={cn('pointer-events-none absolute top-0', direita ? '-right-2' : '-left-2', className)}
    >
      {direita ? (
        <path fill="currentColor" d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" />
      ) : (
        <path fill="currentColor" d="M2.812 1H8v11.193L1.533 3.568C.474 2.156 1.042 1 2.812 1z" />
      )}
    </svg>
  )
}
