import type { Notificacao } from '@/services/notificacoes'

/**
 * A caixa de notificações, em memória.
 *
 * POR QUE UMA STORE DE MÓDULO
 * Quem carrega e escuta o realtime é o `Layout`; quem DESENHA são dois
 * cabeçalhos diferentes — `Header` no desktop e `MobileHeader` no celular
 * (`Layout.tsx:109`). Com o estado dentro do componente do sino, o do celular
 * nasceria vazio, porque nunca é o mesmo componente montado.
 *
 * Padrão copiado de `conversationDrafts.ts` e `ferramentasVivas.ts`: store de
 * módulo + `useSyncExternalStore`, nativo do React. Sem dependência nova — o
 * projeto não usa zustand, e trazer um gerenciador de estado para uma lista de
 * cinquenta itens não se paga (além do risco conhecido de dependência nova
 * duplicar o React em dev).
 *
 * ESCOPO: memória, só durante a sessão. Nada em disco — `titulo` e `corpo`
 * carregam nome de pessoa e assunto de compromisso, mesma classe de dado dos
 * rascunhos de conversa.
 */

export interface EstadoDasNotificacoes {
  lista: Notificacao[]
  naoLidas: number
  carregando: boolean
}

let estado: EstadoDasNotificacoes = { lista: [], naoLidas: 0, carregando: false }
const ouvintes = new Set<() => void>()

function publicar(proximo: EstadoDasNotificacoes) {
  estado = proximo
  ouvintes.forEach((o) => o())
}

export function subscreverNotificacoes(ouvinte: () => void) {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

/**
 * A referência só muda quando o CONTEÚDO muda — `useSyncExternalStore` entra em
 * laço infinito se o snapshot vier novo a cada chamada.
 */
export function lerNotificacoes(): EstadoDasNotificacoes {
  return estado
}

export function definirNotificacoes(lista: Notificacao[], naoLidas: number) {
  publicar({ ...estado, lista, naoLidas })
}

export function definirCarregando(carregando: boolean) {
  if (estado.carregando === carregando) return
  publicar({ ...estado, carregando })
}

/** Chegou uma nova pelo realtime. O teto de 50 é o mesmo da consulta. */
export function empilharNotificacao(nova: Notificacao) {
  if (estado.lista.some((n) => n.id === nova.id)) return
  publicar({
    ...estado,
    lista: [nova, ...estado.lista].slice(0, 50),
    naoLidas: estado.naoLidas + 1,
  })
}

/**
 * Marca uma como lida na tela, antes de o banco confirmar.
 *
 * Otimista de propósito: a bolinha some no clique. Se a gravação falhar, o
 * `recarregar` seguinte devolve o estado real — esperar a rede para apagar um
 * ponto vermelho faria a interface parecer travada.
 */
export function marcarLidaLocal(id: string) {
  const alvo = estado.lista.find((n) => n.id === id)
  if (!alvo || alvo.lida_em) return
  publicar({
    ...estado,
    lista: estado.lista.map((n) =>
      n.id === id ? { ...n, lida_em: new Date().toISOString() } : n,
    ),
    naoLidas: Math.max(0, estado.naoLidas - 1),
  })
}

/** Sair da conta não pode deixar a caixa da pessoa anterior na tela. */
export function limparNotificacoes() {
  publicar({ lista: [], naoLidas: 0, carregando: false })
}
