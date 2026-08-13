/**
 * Tradução de erro técnico para o que o atendente precisa saber.
 *
 * POR QUE EXISTE
 * Os catches de envio jogavam `err.message` cru no toast. Numa clínica isso
 * significa a recepcionista vendo "Failed to fetch dynamically imported module:
 * https://…/assets/storage-D3e78fk8.js" no meio do atendimento — uma frase que
 * não diz o que fazer e nem em que idioma está.
 *
 * O QUE ELE NÃO FAZ
 * Não engole a causa. Quem chama continua obrigado a `console.error(err)` com o
 * erro original: a tradução é só do texto que aparece na tela. Esconder o erro
 * técnico do console tornaria o próximo diagnóstico impossível — foi conferindo
 * o hash dentro dessa mensagem que a causa do bug de 13/08 foi encontrada.
 *
 * DESCONHECIDO CONTINUA PASSANDO CRU
 * Só padrões reconhecidos são traduzidos. Um erro novo aparece como sempre
 * apareceu, em vez de virar um "algo deu errado" genérico que apaga a pista.
 */

/** Nova versão publicada: o chunk que a aba pediu não existe mais no servidor. */
const MODULO_SUMIU = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i

/** Rede indisponível — o navegador nem chegou a falar com o servidor. */
const SEM_REDE = /^(failed to fetch|networkerror|load failed)$/i

export function traduzErro(err: unknown, padrao: string): string {
  const bruto = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const texto = bruto.trim()
  if (!texto) return padrao

  if (MODULO_SUMIU.test(texto)) {
    return 'Uma nova versão do app foi publicada. Recarregue a página para continuar.'
  }

  if (SEM_REDE.test(texto)) {
    return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  }

  return texto
}
