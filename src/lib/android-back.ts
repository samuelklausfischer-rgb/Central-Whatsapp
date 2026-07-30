/**
 * Botão VOLTAR do Android.
 *
 * No Android o voltar é o gesto mais usado do sistema. Sem tratamento, ele
 * FECHA o app — e fechar o app no meio de um atendimento derruba a conexão em
 * tempo real e faz o atendente perder o lugar na conversa.
 *
 * A ordem é a mesma que a pessoa espera, do mais interno para o mais externo:
 *
 *   1. diálogo/gaveta aberto  → fecha só ele
 *   2. conversa aberta        → volta para a lista
 *   3. não está na raiz       → volta uma tela
 *   4. na raiz                → MINIMIZA (não fecha)
 *
 * Passo 1 reusa a cadeia de Escape que o app já tem: o Radix fecha a camada do
 * topo e o `ChatHub` já escuta Escape para fechar a conversa. Duplicar essa
 * lógica aqui criaria duas verdades sobre "o que fechar primeiro".
 *
 * Passo 2 usa uma pilha em escopo de módulo — mesmo padrão dos outros stores
 * deste projeto. Quem sabe que tem algo aberto se registra; o resto do app não
 * precisa saber que o Android existe.
 */

type Manipulador = () => boolean | void

const pilha: Manipulador[] = []

/**
 * Registra um tratador de "voltar". Devolve a função de remoção — chamar no
 * cleanup do efeito é obrigatório, senão a pilha cresce a cada render e o
 * voltar passa a executar handlers de telas que já saíram.
 *
 * O tratador devolve `true` quando CONSUMIU o voltar. Devolvendo `false` (ou
 * nada), o voltar segue para o próximo nível.
 */
export function registrarVoltar(fn: Manipulador): () => void {
  pilha.push(fn)
  return () => {
    const i = pilha.lastIndexOf(fn)
    if (i >= 0) pilha.splice(i, 1)
  }
}

/** Executa o tratador mais recente que consumir o voltar. */
export function consumirVoltarRegistrado(): boolean {
  for (let i = pilha.length - 1; i >= 0; i--) {
    if (pilha[i]() === true) return true
  }
  return false
}

/**
 * Existe camada do Radix aberta? Cobre Dialog, AlertDialog e Sheet, que marcam
 * `data-state="open"` no elemento com papel de diálogo.
 */
export function fecharCamadaAberta(): boolean {
  const abertos = document.querySelectorAll(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  )
  if (abertos.length === 0) return false
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  return true
}
