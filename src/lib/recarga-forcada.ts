/**
 * ITEM 3: rastro das recargas que o app faz sozinho.
 *
 * Existe por um motivo concreto: o relato de "abro uma conversa e o app volta
 * para o início" já custou uma correção errada. A primeira tentativa mexeu numa
 * corrida de sessão que era real, foi publicada, e o problema continuou — ou
 * seja, gastou-se uma rodada inteira para descobrir que o palpite estava errado.
 *
 * Com o rastro, a próxima ocorrência responde sozinha: se ele aparecer, a
 * recarga foi nossa e sabemos o motivo; se o app pular SEM rastro nenhum, o
 * culpado é outro e isso fica evidente na hora, em vez de custar mais uma
 * rodada de suposição.
 *
 * Tudo em `sessionStorage` (por aba) e dentro de `try`: em janela anônima com
 * armazenamento bloqueado o acesso lança, e ficar sem o rastro é muito melhor
 * que derrubar o app na abertura.
 */

/** Trava de uma tentativa por aba, para um erro insistente não virar laço. */
export const CHAVE_RECARGA = 'preload-error-recarregado'

/** Onde o rastro fica até alguém ler. */
const CHAVE_RASTRO = 'central-whats:recarga-forcada'

/** Avisa o app de que existe versão nova e ele deveria oferecer recarregar. */
export const EVENTO_VERSAO_NOVA = 'prnhub:versao-nova'

export interface RastroDeRecarga {
  motivo: 'preload'
  /** ISO. Serve para saber se o rastro é desta sessão ou sobrou de antes. */
  quando: string
  /** Onde a pessoa estava — o dado que faltava para entender o relato. */
  rota: string
}

export function registrarRastro(motivo: RastroDeRecarga['motivo']) {
  try {
    const rastro: RastroDeRecarga = {
      motivo,
      quando: new Date().toISOString(),
      rota: window.location.pathname + window.location.search,
    }
    sessionStorage.setItem(CHAVE_RASTRO, JSON.stringify(rastro))
  } catch {
    /* sem armazenamento: segue sem rastro */
  }
}

export function lerRastro(): RastroDeRecarga | null {
  try {
    const cru = sessionStorage.getItem(CHAVE_RASTRO)
    if (!cru) return null
    return JSON.parse(cru) as RastroDeRecarga
  } catch {
    return null
  }
}

export function limparRastro() {
  try {
    sessionStorage.removeItem(CHAVE_RASTRO)
  } catch {
    /* idem */
  }
}

/**
 * O aviso de versão nova chegou a ser DESENHADO por alguém?
 *
 * A rede de segurança em `main.tsx` depende disto: se o pedaço que falhou for
 * justamente o que desenharia o aviso, ninguém atende e a recarga automática
 * precisa acontecer mesmo assim — senão a pessoa fica olhando uma tela quebrada.
 * Uma variável de módulo, e não um evento de volta, porque quem pergunta e quem
 * responde vivem no mesmo bundle e um evento a mais só adicionaria ordem de
 * escuta para dar errado.
 */
let avisoFoiAtendido = false

export function marcarAvisoAtendido() {
  avisoFoiAtendido = true
}

export function avisoAtendido(): boolean {
  return avisoFoiAtendido
}
