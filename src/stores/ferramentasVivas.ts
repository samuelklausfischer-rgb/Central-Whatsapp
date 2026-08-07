/**
 * Quais ferramentas continuam MONTADAS mesmo quando a tela mostra outra coisa.
 *
 * O PROBLEMA
 * Cada rota é um `<Route>` sob o `<Outlet>` do Layout. Trocar de rota desmonta o
 * componente: sair da Análise PRN para o WhatsApp e voltar zera formulário,
 * arquivo escolhido e resultado na tela. Nas duas ferramentas embutidas por
 * iframe (Relatórios e Licitações) o prejuízo é maior que perder posição — o
 * `ToolFrame` refaz o handshake de credencial a cada montagem, então voltar
 * significa LOGAR DE NOVO.
 *
 * A SOLUÇÃO
 * As ferramentas passam a ser renderizadas por um host que vive dentro do
 * Layout, fora da troca de rotas. A rota vira só um registrador: ela diz "esta
 * ferramenta está ativa" e as guardas de permissão continuam onde estavam. Quem
 * não está ativa fica montada e escondida.
 *
 * O TETO DE 3 EXISTE POR UM MOTIVO
 * Ferramenta viva custa memória de verdade — as duas de iframe carregam um app
 * inteiro cada, com bundle e árvore React próprios. O app já levou um ciclo
 * dedicado a reduzir RAM (v0.0.174). Passando de 3, a menos usada é DESMONTADA
 * de fato, não só escondida.
 *
 * Padrão copiado de `conversationDrafts.ts`: store de módulo + `useSyncExternalStore`,
 * sem persistir em disco — o estado vale enquanto o app estiver aberto.
 */

export const MAX_FERRAMENTAS_VIVAS = 3

export interface EstadoFerramentas {
  /** Da mais recente para a mais antiga. A ordem É a política de descarte. */
  vivas: string[]
  /** `null` quando a tela atual não é uma ferramenta. */
  ativa: string | null
}

let estado: EstadoFerramentas = { vivas: [], ativa: null }
const ouvintes = new Set<() => void>()

function publicar(proximo: EstadoFerramentas) {
  estado = proximo
  ouvintes.forEach((o) => o())
}

export function subscreverFerramentas(ouvinte: () => void) {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

/**
 * A referência só muda quando o CONTEÚDO muda — `useSyncExternalStore` entra em
 * laço infinito se o snapshot vier novo a cada chamada.
 */
export function lerFerramentas(): EstadoFerramentas {
  return estado
}

/** Abre (ou traz para a frente) uma ferramenta. */
export function ativarFerramenta(slug: string) {
  if (estado.ativa === slug && estado.vivas[0] === slug) return
  const vivas = [slug, ...estado.vivas.filter((s) => s !== slug)].slice(0, MAX_FERRAMENTAS_VIVAS)
  publicar({ vivas, ativa: slug })
}

/**
 * Saiu para uma tela que não é ferramenta. As vivas continuam montadas — é isso
 * que faz voltar ao WhatsApp e retornar não custar nada.
 */
export function desativarFerramenta() {
  if (estado.ativa === null) return
  publicar({ vivas: estado.vivas, ativa: null })
}

/** Fecha de verdade: desmonta e libera a memória. */
export function fecharFerramenta(slug: string) {
  const vivas = estado.vivas.filter((s) => s !== slug)
  publicar({ vivas, ativa: estado.ativa === slug ? null : estado.ativa })
}

/** Ao sair da conta, nada de ferramenta de outra sessão continuar viva. */
export function limparFerramentas() {
  if (!estado.vivas.length && estado.ativa === null) return
  publicar({ vivas: [], ativa: null })
}
