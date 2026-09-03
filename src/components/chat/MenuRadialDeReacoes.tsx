/**
 * O menu radial de reações.
 *
 * O PEDIDO (Samuel, 02/09/2026)
 * "Ajustar como é visualizada a reação da msg para não deixar escapar essa
 * visualização, e deixar de forma eficiente e mais dinâmica poder reagir a uma
 * msg de forma mais rápida — talvez criar uma roda de atalho de coisas mais
 * usadas por aquele usuário."
 *
 * Perguntado se "roda" era figura de linguagem ou um menu circular de verdade,
 * a resposta foi: circular de verdade. Por isso os emojis são posicionados em
 * arco, e não numa tira.
 *
 * POR QUE TRIGONOMETRIA NA MÃO E NENHUMA BIBLIOTECA
 * O projeto não tem nenhuma lib de menu radial, e trazer uma para posicionar
 * seis botões seria carregar um pacote inteiro por `cos`/`sin`. O cálculo é uma
 * linha por botão.
 *
 * POR QUE ARCO DE 180° E NÃO CÍRCULO FECHADO
 * O menu abre a partir de um botão colado na bolha da mensagem, dentro de uma
 * lista que rola. Um círculo completo jogaria metade dos emojis por cima da
 * própria mensagem (escondendo o que se está reagindo) e, na primeira mensagem
 * visível, metade sairia para fora da área de rolagem. O semicírculo voltado
 * para cima usa o espaço que sempre existe: o vazio acima do botão.
 *
 * O LADO ESPELHA A BOLHA
 * Mensagem minha abre o arco para a esquerda; mensagem do contato, para a
 * direita. É o mesmo lado em que o botão de reagir já vive hoje, então o menu
 * nunca cruza por cima do balão.
 *
 * ORDEM DOS EMOJIS
 * Os mais usados pela PESSOA vêm primeiro, e as posições mais fáceis de acertar
 * (as do meio do arco, na direção do polegar) recebem os primeiros. Sem
 * histórico, cai na mesma lista de sempre — ninguém vê um menu vazio no
 * primeiro uso.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

/** A lista de sempre, e o fallback de quem ainda não reagiu a nada. */
export const REACOES_PADRAO = ['👍', '❤️', '😂', '😮', '😢', '🙏']

const QUANTIDADE = 6
/** Distância do centro do botão até cada emoji. */
const RAIO = 62
/** Diâmetro do botão de emoji, para centrar o cálculo. */
const TAMANHO = 38

interface Props {
  /** `{emoji: vezes}` da pessoa. Vazio ou ausente cai no padrão. */
  usoPorEmoji?: Record<string, number> | null
  /** Mensagem minha abre para a esquerda; do contato, para a direita. */
  paraEsquerda: boolean
  aoEscolher: (emoji: string) => void
  aoFechar: () => void
}

/**
 * Os seis que vão aparecer: mais usados primeiro, completando com o padrão para
 * o menu ter sempre o mesmo tamanho — um arco que muda de tamanho conforme o
 * histórico faria a pessoa perder a memória muscular da posição.
 */
export function reacoesEmOrdem(usoPorEmoji?: Record<string, number> | null): string[] {
  const uso = usoPorEmoji || {}
  const maisUsados = Object.entries(uso)
    .filter(([, vezes]) => vezes > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([emoji]) => emoji)

  const escolhidos: string[] = []
  for (const emoji of [...maisUsados, ...REACOES_PADRAO]) {
    if (escolhidos.length >= QUANTIDADE) break
    if (!escolhidos.includes(emoji)) escolhidos.push(emoji)
  }
  return escolhidos
}

export function MenuRadialDeReacoes({ usoPorEmoji, paraEsquerda, aoEscolher, aoFechar }: Props) {
  const emojis = useMemo(() => reacoesEmOrdem(usoPorEmoji), [usoPorEmoji])
  const containerRef = useRef<HTMLDivElement>(null)
  /** Só para a animação de entrada: os emojis nascem no centro e se abrem. */
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setAberto(true))
    return () => cancelAnimationFrame(id)
  }, [])

  /**
   * Fecha ao clicar fora ou apertar Esc.
   *
   * O `Popover` do Radix fazia isso de graça, mas ele posiciona o conteúdo numa
   * caixa retangular — que é o que precisávamos deixar de ter. Como o menu
   * agora é posicionado à mão, o fechamento também vem para cá.
   */
  useEffect(() => {
    const clicouFora = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) aoFechar()
    }
    const apertouEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar()
    }
    // `true` (fase de captura): a lista de mensagens para propagação de clique
    // em vários pontos, e sem isto o clique fora nunca chegaria aqui.
    document.addEventListener('mousedown', clicouFora, true)
    document.addEventListener('keydown', apertouEsc)
    return () => {
      document.removeEventListener('mousedown', clicouFora, true)
      document.removeEventListener('keydown', apertouEsc)
    }
  }, [aoFechar])

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Reagir à mensagem"
      className="absolute left-1/2 top-1/2 z-[80] h-0 w-0"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {emojis.map((emoji, i) => {
        /**
         * Arco de 180° varrido de baixo para cima, do lado da bolha.
         *
         * A ordem do meio para as pontas põe os mais usados onde o dedo chega
         * primeiro: `ordemNoArco` remapeia 0,1,2,3,4,5 para o centro do arco e
         * vai abrindo para os extremos.
         */
        const meio = (QUANTIDADE - 1) / 2
        const ordemNoArco = meio + (i % 2 === 0 ? -1 : 1) * Math.ceil(i / 2)
        const fracao = ordemNoArco / (QUANTIDADE - 1)
        // -170° a -10°: quase deitado dos dois lados, sem encostar na
        // horizontal (onde o emoji ficaria colado na bolha).
        const graus = -170 + fracao * 160
        const radianos = (graus * Math.PI) / 180
        const x = Math.cos(radianos) * RAIO * (paraEsquerda ? -1 : 1)
        const y = Math.sin(radianos) * RAIO

        return (
          <button
            key={emoji}
            type="button"
            role="menuitem"
            title={`Reagir com ${emoji}`}
            aria-label={`Reagir com ${emoji}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              aoEscolher(emoji)
            }}
            style={{
              width: TAMANHO,
              height: TAMANHO,
              transform: aberto
                ? `translate(${x - TAMANHO / 2}px, ${y - TAMANHO / 2}px) scale(1)`
                : `translate(${-TAMANHO / 2}px, ${-TAMANHO / 2}px) scale(0.4)`,
              // Escalonado: os emojis se abrem em sequência, o que deixa claro
              // que é um leque e não seis botões que apareceram do nada.
              transitionDelay: `${i * 22}ms`,
              opacity: aberto ? 1 : 0,
            }}
            className="absolute flex items-center justify-center rounded-full border border-chat-border bg-chat-panel text-xl shadow-chat transition-all duration-200 ease-out hover:z-10 hover:scale-125 hover:bg-chat-hover"
          >
            {emoji}
          </button>
        )
      })}
    </div>
  )
}
