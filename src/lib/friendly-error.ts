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

/** O que sobrou de um erro de `supabase.functions.invoke`, já legível. */
export interface ErroDeFuncao {
  /** Mensagem pronta para mostrar ao atendente. */
  message: string
  /** Código HTTP, quando houve resposta. */
  status?: number
  /** Corpo JSON, quando a função respondeu com um. */
  corpo: Record<string, any>
  /** Sessão encerrada no servidor — quem chama pode mandar para o login. */
  sessaoExpirada: boolean
}

/**
 * Interpreta o erro de uma chamada a edge function.
 *
 * POR QUE EXISTE
 * O `supabase.functions.invoke` devolve um erro cuja `message` é sempre a mesma
 * frase — "Edge Function returned a non-2xx status code" —, e a causa real fica no
 * CORPO da resposta, dentro de `error.context`. Cada serviço lia isso de um jeito
 * (ou não lia), e o resultado era o atendente vendo uma frase em inglês que não diz
 * o que fazer. Em 14/08/2026 isso custou uma investigação inteira: o corpo dizia
 * `WorkerRequestCancelled` e ninguém via.
 *
 * O corpo é lido como TEXTO e só então interpretado como JSON. Chamar `.json()`
 * direto consome o corpo quando ele não é JSON, e aí a causa se perde de vez —
 * justamente nos casos em que quem respondeu não foi a função, e sim a plataforma
 * (worker morto, gateway, proxy), que é quando a informação mais faz falta.
 */
export async function interpretarErroDeFuncao(err: unknown, padrao: string): Promise<ErroDeFuncao> {
  const ctx = (err as { context?: unknown } | null)?.context
  const resposta = ctx && typeof (ctx as Response).clone === 'function' ? (ctx as Response) : null

  let corpo: Record<string, any> = {}
  let textoCru = ''
  if (resposta) {
    textoCru = await resposta.clone().text().catch(() => '')
    try {
      corpo = textoCru ? JSON.parse(textoCru) : {}
    } catch {
      corpo = {}
    }
  }

  const status = resposta?.status
  const doServidor = typeof corpo.error === 'string' ? corpo.error : ''

  // 401/403 com "session"/"JWT" no texto: a sessão morreu no servidor. Acontece
  // quando alguém sai em outra máquina, quando a senha muda, ou quando um admin
  // revoga o acesso. O token guardado aqui continua "válido" até vencer, então o
  // app não percebe sozinho — daí a mensagem precisar dizer o que fazer.
  const sessaoExpirada =
    (status === 401 || status === 403) && /invalid session|jwt|session|token/i.test(doServidor || '')

  if (sessaoExpirada) {
    return {
      message: 'Sua sessão foi encerrada. Entre novamente para continuar.',
      status,
      corpo,
      sessaoExpirada: true,
    }
  }

  if (doServidor) return { message: doServidor, status, corpo, sessaoExpirada: false }

  // Sem `error` no corpo, quem respondeu NÃO foi a função — toda saída de erro dela
  // carrega esse campo. Mostrar status e trecho cru é o que permite distinguir
  // worker morto de proxy sem abrir log de container.
  if (status) {
    return {
      message: `HTTP ${status}${textoCru ? ` — ${textoCru.slice(0, 200)}` : ' (resposta sem corpo — função não respondeu)'}`,
      status,
      corpo,
      sessaoExpirada: false,
    }
  }

  return { message: traduzErro(err, padrao), corpo, sessaoExpirada: false }
}
