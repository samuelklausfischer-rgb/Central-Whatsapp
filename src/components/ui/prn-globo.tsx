import { useId } from 'react'

/**
 * Globo do PRN Hub, redesenhado como SVG inline (não o PNG de
 * `public/logo.png` / `brand/prnhub-icone.png`).
 *
 * Dois motivos para não usar o PNG:
 * 1. O PNG é um ÍCONE DE APP: o globo de ladrilhos vem centrado sobre uma
 *    placa branca com cantos arredondados (padrão de ícone macOS/iOS). Dentro
 *    de um avatar circular de ~32px essa placa aparece como um quadrado branco
 *    por trás do círculo — fica visivelmente errado, não "flutua" como logo.
 * 2. Caminho de asset absoluto (`/logo.png`) quebra no build do Electron:
 *    `vite build --base ./` só resolve para caminho relativo ao bundle os
 *    imports que ele processa em build; uma string de caminho absoluto vira
 *    `file:///logo.png` dentro do app empacotado, que não existe. Isso já
 *    está documentado em `src/lib/backgrounds.ts`. Um SVG inline não depende
 *    de nenhum arquivo em disco, então esse problema não existe aqui.
 *
 * Reproduz só os ladrilhos azuis (sem a placa branca), simplificados para
 * continuar legíveis no tamanho de avatar (~20-32px).
 */
export function PrnGlobo({ className }: { className?: string }) {
  // Cada instância monta seu próprio <linearGradient> com id próprio.
  // Se dois <PrnGlobo> renderizarem com o MESMO id de gradiente (ex.: string
  // fixa "prn-globo-gradient"), alguns navegadores (Safari/WebKit em
  // particular) resolvem o `fill="url(#id)"` do segundo elemento pelo
  // primeiro `<linearGradient>` daquele id no documento inteiro — não pelo
  // que está dentro do próprio <svg>. Com 5+ aparelhos na tela ao mesmo
  // tempo (o box "Aparelhos" do dashboard), isso quebraria a renderização
  // silenciosamente. `useId()` garante um sufixo único por instância montada.
  const gradientId = `prn-globo-grad-${useId()}`

  return (
    <svg
      viewBox="0 0 64 64"
      width="100%"
      height="100%"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="55%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>

      {/* Ladrilhos da coluna central, de cima para baixo */}
      <rect x="26" y="6" width="12" height="14" rx="2.5" fill={`url(#${gradientId})`} />
      <rect x="26" y="42" width="12" height="14" rx="2.5" fill={`url(#${gradientId})`} />

      {/* Ladrilho central menor, mais claro — o "brilho" do globo */}
      <rect x="27" y="27" width="10" height="10" rx="2" fill="#7dd3fc" opacity="0.95" />

      {/* Coluna esquerda */}
      <rect x="10" y="26" width="12" height="12" rx="2.5" fill={`url(#${gradientId})`} />

      {/* Ladrilhos intermediários, ao redor do brilho central */}
      <rect x="14" y="14" width="10" height="10" rx="2" fill={`url(#${gradientId})`} />
      <rect x="14" y="40" width="10" height="10" rx="2" fill={`url(#${gradientId})`} />
      <rect x="40" y="14" width="10" height="10" rx="2" fill={`url(#${gradientId})`} />
      <rect x="40" y="40" width="10" height="10" rx="2" fill={`url(#${gradientId})`} />

      {/* Borda direita: quadriláteros em perspectiva (não retângulos retos),
          sugerindo a curvatura da esfera se afastando do observador */}
      <path d="M 52 12 L 60 8 L 58 20 L 50 22 Z" fill={`url(#${gradientId})`} />
      <path d="M 52 24 L 61 22 L 61 34 L 52 35 Z" fill={`url(#${gradientId})`} />
      <path d="M 52 37 L 60 36 L 58 48 L 50 45 Z" fill={`url(#${gradientId})`} />
    </svg>
  )
}
