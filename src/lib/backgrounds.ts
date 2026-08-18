/**
 * Galeria de artes de fundo do PRN Hub (splash, login, tela de carregamento).
 *
 * Os imports abaixo são ESTÁTICOS, um por arte, de propósito — NUNCA montar o
 * caminho em runtime (ex.: `` `/backgrounds/${nome}.webp` ``). O build do
 * Electron roda `vite build --base ./`, e o Vite só reescreve para um caminho
 * relativo ao bundle os imports que ele consegue ver e processar em tempo de
 * build. Uma string montada em runtime não é processada: ela vira literalmente
 * `/backgrounds/algo.webp` no HTML final e, dentro do app empacotado (que serve
 * os arquivos por `file://`), isso resolve para `file:///backgrounds/algo.webp`
 * — um caminho que não existe. O resultado é um fundo quebrado, e sem nenhum
 * erro de build avisando (o TypeScript não sabe que aquela string devia ser um
 * asset).
 */
import amalfi from '@/assets/backgrounds/amalfi-poente.webp'
import aurora from '@/assets/backgrounds/aurora-fiorde.webp'
import cerejeira from '@/assets/backgrounds/cerejeira-lago.webp'
import deserto from '@/assets/backgrounds/deserto-dourado.webp'
import montanha from '@/assets/backgrounds/montanha-pastel.webp'
import praia from '@/assets/backgrounds/praia-tropical.webp'

export type Background = {
  /** URL resolvida pelo Vite (import estático — ver comentário sobre --base ./). */
  url: string
  /** Nome legível da arte, usado no harness de dev. */
  nome: string
  /** Lado do quadro onde está a esfera do PRN Hub. O painel de vidro vai para o OPOSTO. */
  ladoDaEsfera: 'esquerda' | 'direita'
  /** Cor média da arte, pintada atrás da imagem para não haver frame vazio. */
  corBase: string
}

export const galeria: Background[] = [
  { url: aurora, nome: 'Aurora sobre fiorde nevado', ladoDaEsfera: 'esquerda', corBase: '#1e4f8a' },
  { url: deserto, nome: 'Dunas de deserto ao poente', ladoDaEsfera: 'direita', corBase: '#9b785a' },
  { url: cerejeira, nome: 'Cerejeiras à beira de lago', ladoDaEsfera: 'direita', corBase: '#957d89' },
  { url: montanha, nome: 'Lago de montanha em tons pastel', ladoDaEsfera: 'direita', corBase: '#9f9fb8' },
  { url: praia, nome: 'Praia tropical com coluna de mármore', ladoDaEsfera: 'direita', corBase: '#b19c8a' },
  { url: amalfi, nome: 'Costa de Amalfi ao poente', ladoDaEsfera: 'esquerda', corBase: '#6a5f83' },
]

/**
 * Sorteada UMA vez, no escopo do módulo — não a cada render. O módulo só é
 * avaliado uma vez por carregamento da página, então uma única abertura do
 * app (uma janela do Electron, um refresh do navegador) sorteia uma arte e
 * splash, login e tela de carregamento compartilham exatamente a mesma,
 * porque todos importam este mesmo módulo já resolvido.
 */
export const backgroundDaAbertura: Background = galeria[Math.floor(Math.random() * galeria.length)]
