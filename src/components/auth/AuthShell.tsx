/* Moldura compartilhada das telas de entrada: fundo fotográfico sorteado por
   abertura + painel de vidro. Consumida pelo UpdateGate, pelo Login e pelo
   loading de boot — eles só trazem o conteúdo do painel. */
import type { ReactNode } from 'react'

import { backgroundDaAbertura, type Background } from '@/lib/backgrounds'
import { cn } from '@/lib/utils'

export function AuthShell({
  children,
  background = backgroundDaAbertura,
}: {
  children: ReactNode
  background?: Background
}) {
  // Painel some do lado onde está a esfera do PRN Hub na arte sorteada.
  const painelNaDireita = background.ladoDaEsfera === 'esquerda'

  return (
    // Escopo `.dark` forçado: a entrada é sempre escura, independente do tema
    // do usuário. O vidro do GlassPanel (`bg-background/70`) só fica legível
    // sobre as três artes claras (cerejeira, praia, lago) se resolver para os
    // tokens escuros — um vidro branco por cima delas lavaria o contraste do
    // texto. Então a subárvore inteira re-declara `.dark` (src/main.css:70-126)
    // sem depender do tema que o usuário escolheu no app.
    // A classe `auth-shell` é a âncora do bloco prefers-reduced-motion em
    // src/main.css — ela escopa o desligamento das animações desta tela sem
    // afetar skeletons e diálogos do resto do app.
    <div className="auth-shell dark min-h-screen w-full text-foreground">
      {/* Camada de fundo: cor média -> foto -> scrim, nessa ordem, todas fixed
          e fora do fluxo para nunca capturar clique do formulário. */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        style={{ backgroundColor: background.corBase }}
      >
        {/* Cor média evita frame vazio/flash enquanto o WebP decodifica. */}
        <img
          src={background.url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full origin-center object-cover animate-ken-burns"
        />

        {/* Scrim do lado do painel: gradiente mais forte atrás do vidro, para
            o texto continuar legível nas seis artes (claras e escuras). */}
        <div
          className={cn(
            'absolute inset-0',
            painelNaDireita ? 'bg-gradient-to-l from-black/55 via-black/25 to-transparent' : 'bg-gradient-to-r from-black/55 via-black/25 to-transparent',
          )}
        />
        {/* Escurece a foto inteira um pouco, independente do lado do painel.
            Abaixo de `lg` o véu é mais forte: ali o painel centraliza e sai da
            parte densa do gradiente lateral, então o scrim cai para ~25% justo
            onde as artes claras (praia, cerejeira, lago pastel) têm as regiões
            mais estouradas — o texto secundário chegava a raspar em 4.4:1. */}
        <div className="absolute inset-0 bg-black/25 lg:bg-black/10" />
      </div>

      {/* Conteúdo: painel de vidro no lado livre (sem a esfera atrás).
          Abaixo de `lg` centraliza — a janela mínima do Electron (960x600)
          não cabe esfera + painel lado a lado. */}
      <div
        className={cn(
          'relative flex min-h-screen w-full items-center justify-center px-6 lg:px-24',
          painelNaDireita ? 'lg:justify-end' : 'lg:justify-start',
        )}
      >
        {children}
      </div>
    </div>
  )
}
