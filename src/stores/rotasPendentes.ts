/**
 * Rota que uma ferramenta pediu para OUTRA abrir, esperando ser entregue.
 *
 * POR QUE UMA STORE, E NÃO PROPS
 * Quem recebe o pedido é o `ToolFrame` de quem pediu (é o iframe dele que fala),
 * mas quem precisa da rota é o `ToolFrame` do DESTINO — outro componente, irmão,
 * renderizado pelo `ToolHost` sem props (`<Componente />`). Passar por props
 * exigiria enfiar o assunto em toda ferramenta hospedada, inclusive nas que não
 * têm nada com isso.
 *
 * POR QUE NÃO PELA URL DO IFRAME
 * Trocar o `src` recarregaria o app filho — e as ferramentas ficam montadas de
 * propósito justamente para não refazer o handshake (ver `ferramentasVivas.ts`).
 * Pior: uma rota dentro do `src` seria reaplicada se a ferramenta remontasse,
 * reabrindo o mesmo formulário e criando registro repetido do outro lado.
 *
 * Mesmo padrão de `ferramentasVivas.ts`: store de módulo + `useSyncExternalStore`,
 * sem persistir em disco. Uma rota vale para uma entrega e só.
 */

type Rotas = Record<string, string>

let rotas: Rotas = {}
const ouvintes = new Set<() => void>()

function publicar(proximo: Rotas) {
  rotas = proximo
  ouvintes.forEach((o) => o())
}

export function subscreverRotasPendentes(ouvinte: () => void) {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

/** A referência só muda quando o conteúdo muda — senão `useSyncExternalStore` entra em laço. */
export function lerRotasPendentes(): Rotas {
  return rotas
}

/** Guarda a rota até o `ToolFrame` do destino avisar que está pronto. */
export function pedirRota(slug: string, path: string) {
  if (rotas[slug] === path) return
  publicar({ ...rotas, [slug]: path })
}

/** Chamada depois de entregar: sem isso a rota voltaria a cada `ready` (ex.: um retry). */
export function limparRota(slug: string) {
  if (!(slug in rotas)) return
  const proximo = { ...rotas }
  delete proximo[slug]
  publicar(proximo)
}
