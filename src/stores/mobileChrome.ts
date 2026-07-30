import { useSyncExternalStore } from 'react'

/**
 * Há uma conversa aberta ocupando a tela?
 *
 * O `Layout` precisa saber disso para sumir com a barra de cima e as abas de
 * baixo — no celular a conversa vale a tela inteira, como no WhatsApp. Só que
 * "conversa aberta" é estado do `ChatHub` (`selectedContact`), não é rota: não
 * dá para derivar do endereço.
 *
 * Store de escopo de módulo em vez de contexto porque o sinal sobe do FILHO
 * (`ChatHub`) para o PAI (`Layout`) — contexto vai no sentido contrário, e a
 * alternativa seria o `Layout` passar um setter por toda a árvore de rotas.
 *
 * Sumir com as barras é seguro: o `ChatWindow` tem cabeçalho próprio com botão
 * de voltar, e o botão voltar do Android também sai da conversa para a lista.
 */

let conversaAberta = false
const ouvintes = new Set<() => void>()

export function definirConversaAberta(aberta: boolean): void {
  if (conversaAberta === aberta) return
  conversaAberta = aberta
  for (const ouvinte of ouvintes) ouvinte()
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  return () => {
    ouvintes.delete(ouvinte)
  }
}

function ler(): boolean {
  return conversaAberta
}

export function useConversaAberta(): boolean {
  // O terceiro argumento (snapshot do servidor) devolve `false`: não há
  // renderização no servidor aqui, mas sem ele o React reclama em modo estrito.
  return useSyncExternalStore(assinar, ler, () => false)
}
