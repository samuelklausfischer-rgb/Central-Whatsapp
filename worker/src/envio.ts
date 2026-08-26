/**
 * Política de retentativa — portada do `prn-vigilante`.
 *
 * Mesmos números do original (`automation/src/services/evolution.ts` e
 * `utils/helpers.ts`): 3 tentativas, espera exponencial 1 s → 2 s → 4 s com teto
 * de 30 s e até 250 ms de jitter, repetindo apenas em `timeout`, `network` e
 * `rate_limit`.
 *
 * ── A DIFERENÇA QUE IMPORTA ─────────────────────────────────────────────────
 * O original repete um timeout às cegas. A `send_whatsapp_message` deste projeto
 * explica no próprio corpo por que ela NÃO faz isso:
 *
 *   "SÓ falha de RESOLUÇÃO pode ser repetida: é o único caso em que existe
 *    garantia de que a requisição NÃO saiu. (…) repetir uma falha posterior
 *    mandaria a mesma mensagem DUAS VEZES."
 *
 * Timeout é justamente o caso ambíguo — a Evolution pode ter entregue e só a
 * resposta ter se perdido. Num disparo de centenas, mandar a mesma mensagem duas
 * vezes para um cliente é o erro mais visível que existe.
 *
 * Por isso a retentativa daqui pergunta ao banco, antes de cada repetição, se a
 * mensagem já saiu (`disparo_ja_saiu`). Se saiu, para e devolve o id encontrado.
 * O resultado é a resiliência do original sem o efeito colateral que ele tem.
 */

export type TipoDeErro = 'timeout' | 'network' | 'rate_limit' | 'api_error' | 'unknown'

const REPETIVEIS: TipoDeErro[] = ['timeout', 'network', 'rate_limit']

/** Erro de envio que preserva o status HTTP, sem o qual não dá para classificar. */
export class ErroDeEnvio extends Error {
  readonly status?: number
  constructor(mensagem: string, status?: number) {
    super(mensagem)
    this.name = 'ErroDeEnvio'
    this.status = status
  }
}

/** Mesma tabela de classificação do original, adaptada à origem do erro aqui. */
export function classificarErro(erro: unknown): TipoDeErro {
  const status = (erro as ErroDeEnvio)?.status
  if (status === 429) return 'rate_limit'
  if (typeof status === 'number' && status > 0) return 'api_error'

  const texto = (erro instanceof Error ? erro.message : String(erro ?? '')).toLowerCase()
  // A falha de resolução de DNS entra como `network` porque é o caso em que há
  // garantia de que nada saiu — repetir é seguro e já rendeu ~8% de envios
  // recuperados quando a própria RPC passou a repetir por dentro.
  if (texto.includes('resolving timed out') || texto.includes('could not resolve')) return 'network'
  if (texto.includes('timeout') || texto.includes('timed out')) return 'timeout'
  if (texto.includes('fetch failed') || texto.includes('network') || texto.includes('econnrefused')) return 'network'
  return 'unknown'
}

export const ehRepetivel = (tipo: TipoDeErro) => REPETIVEIS.includes(tipo)

/** 1 s, 2 s, 4 s… com teto de 30 s e jitter de até 250 ms. Igual ao original. */
export function esperaExponencial(tentativa: number, baseMs = 1000, tetoMs = 30_000): number {
  const bruto = Math.min(baseMs * 2 ** Math.max(0, tentativa - 1), tetoMs)
  return bruto + Math.floor(Math.random() * 250)
}

export interface ResultadoDoEnvio {
  messageId: string | null
  tentativas: number
  /** `true` quando a repetição foi evitada porque a mensagem já havia saído. */
  jaHaviaSaido: boolean
}

/**
 * Envia com retentativa, sem nunca mandar duas vezes.
 *
 * `enviar` e `jaSaiu` entram por parâmetro para esta lógica poder ser testada sem
 * banco e sem Evolution — foi o que já obrigou a separar `montarTexto` do motor.
 */
export async function enviarComRetentativa(opcoes: {
  enviar: () => Promise<string | null>
  jaSaiu: () => Promise<string | null>
  dormir: (ms: number) => Promise<unknown>
  tentativas?: number
  logar?: (m: string) => void
}): Promise<ResultadoDoEnvio> {
  const max = opcoes.tentativas ?? 3
  const logar = opcoes.logar ?? (() => {})
  let ultimoErro: unknown

  for (let tentativa = 1; tentativa <= max; tentativa++) {
    try {
      const messageId = await opcoes.enviar()
      return { messageId, tentativas: tentativa, jaHaviaSaido: false }
    } catch (erro) {
      ultimoErro = erro
      const tipo = classificarErro(erro)
      const ultima = tentativa === max

      if (!ehRepetivel(tipo)) {
        logar(`erro não repetível (${tipo}), desistindo na tentativa ${tentativa}`)
        throw erro
      }
      if (ultima) {
        logar(`erro ${tipo} na última tentativa (${tentativa}/${max})`)
        break
      }

      // O passo que o original não tem. Antes de insistir, confere se a mensagem
      // saiu mesmo assim — é o que separa "resiliente" de "manda duas vezes".
      const idExistente = await opcoes.jaSaiu()
      if (idExistente) {
        logar(`a mensagem já havia saído apesar do ${tipo}; não vou repetir`)
        return { messageId: idExistente, tentativas: tentativa, jaHaviaSaido: true }
      }

      const espera = esperaExponencial(tentativa)
      logar(`erro ${tipo} (${tentativa}/${max}); nova tentativa em ${Math.round(espera / 1000)}s`)
      await opcoes.dormir(espera)
    }
  }

  throw ultimoErro
}
