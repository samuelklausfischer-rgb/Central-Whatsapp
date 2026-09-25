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
 * O TETO EXISTE POR UM MOTIVO
 * Ferramenta viva custa memória de verdade — as de iframe carregam um app
 * inteiro cada, com bundle e árvore React próprios. O app já levou um ciclo
 * dedicado a reduzir RAM (v0.0.174). Passando do teto, a menos usada é
 * DESMONTADA de fato, não só escondida.
 *
 * Era 3 e passou a 5 em 25/09/2026, a pedido do Samuel, junto com a barra de
 * abas deixar de se esconder (ver `ToolHost.tsx`). O motivo de subir: com a
 * barra visível o atendente enxerga o que está aberto e passa a usar mais de
 * uma ferramenta de propósito — com 3 o descarte batia rápido demais e ele
 * perdia o app filho sem entender por quê. Se algum dia a memória apertar, é
 * ESTE número que se mexe primeiro, e não o keep-alive inteiro.
 *
 * Padrão copiado de `conversationDrafts.ts`: store de módulo + `useSyncExternalStore`,
 * sem persistir em disco — o estado vale enquanto o app estiver aberto.
 */

export const MAX_FERRAMENTAS_VIVAS = 5

export interface EstadoFerramentas {
  /**
   * Ordem de MONTAGEM, e ela é ESTÁVEL: uma ferramenta entra no fim e nunca
   * muda de lugar enquanto estiver viva.
   *
   * Isto não é preciosismo. Até 25/09/2026 esta lista era reordenada a cada
   * troca (a ativa ia para a frente) e servia de política de descarte ao mesmo
   * tempo. Como o `ToolHost` renderiza `vivas.map(...)`, reordenar o array
   * reordena os nós no DOM — e **mover um `<iframe>` no DOM recarrega o
   * iframe**. Resultado: trocar de aba e voltar reabria a ferramenta do zero,
   * perdendo rolagem, formulário preenchido e diálogo aberto. Com componente
   * interno o estado do React sobrevivia, mas a rolagem também se perdia.
   *
   * Por isso a recência mora em `recentes`, separada: quem decide QUEM SAI não
   * pode ser quem decide A ORDEM DE RENDERIZAÇÃO.
   */
  vivas: string[]
  /** Da mais recente para a mais antiga. Serve só para escolher quem é descartado. */
  recentes: string[]
  /** `null` quando a tela atual não é uma ferramenta. */
  ativa: string | null
}

let estado: EstadoFerramentas = { vivas: [], recentes: [], ativa: null }
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

/**
 * Abre uma ferramenta, ou traz para a frente uma que já estava viva.
 *
 * "Trazer para a frente" mexe em `ativa` e em `recentes` — NUNCA em `vivas`.
 * Ver o comentário de `EstadoFerramentas`: reordenar `vivas` recarrega iframe.
 */
export function ativarFerramenta(slug: string) {
  if (estado.ativa === slug && estado.recentes[0] === slug) return

  const recentes = [slug, ...estado.recentes.filter((s) => s !== slug)]

  if (estado.vivas.includes(slug)) {
    publicar({ vivas: estado.vivas, recentes, ativa: slug })
    return
  }

  // Entra no FIM, para não empurrar as que já estão montadas.
  let vivas = [...estado.vivas, slug]

  if (vivas.length > MAX_FERRAMENTAS_VIVAS) {
    // Descarta a menos usada recentemente — nunca a recém-aberta. `recentes`
    // está do mais novo para o mais velho, então o fim dele é o candidato.
    const descartada = [...recentes].reverse().find((s) => s !== slug && vivas.includes(s))
    if (descartada) vivas = vivas.filter((s) => s !== descartada)
  }

  publicar({ vivas, recentes: recentes.filter((s) => vivas.includes(s)), ativa: slug })
}

/**
 * Saiu para uma tela que não é ferramenta. As vivas continuam montadas — é isso
 * que faz voltar ao WhatsApp e retornar não custar nada.
 */
export function desativarFerramenta() {
  if (estado.ativa === null) return
  publicar({ vivas: estado.vivas, recentes: estado.recentes, ativa: null })
}

/** Fecha de verdade: desmonta e libera a memória. */
export function fecharFerramenta(slug: string) {
  const vivas = estado.vivas.filter((s) => s !== slug)
  publicar({
    vivas,
    recentes: estado.recentes.filter((s) => s !== slug),
    ativa: estado.ativa === slug ? null : estado.ativa,
  })
}

/** Ao sair da conta, nada de ferramenta de outra sessão continuar viva. */
export function limparFerramentas() {
  if (!estado.vivas.length && estado.ativa === null) return
  publicar({ vivas: [], recentes: [], ativa: null })
}
