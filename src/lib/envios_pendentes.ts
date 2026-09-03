/**
 * As mensagens que não saíram, guardadas NO APARELHO.
 *
 * O QUE ACONTECIA (relato do Samuel, 03/09/2026)
 * "Desliguei a internet e mandei a msg: enquanto está off, a msg não sai e fica
 * com badge de falha — está correto. Porém ao voltar a internet a msg some de
 * forma imediata, não faz o envio, e como ela some não dá para fazer o reenvio
 * manual."
 *
 * POR QUE SUMIA — a cadeia inteira:
 *   1. `ChatHub.tsx` escuta `window.addEventListener('online', refetchOpen)`.
 *      No instante em que a internet volta, a conversa é recarregada.
 *   2. `loadConversationMessages` faz `definirMensagens(chave, msgs)`, que
 *      SUBSTITUI a lista inteira pelo que veio do servidor.
 *   3. O balão que falhou é uma mensagem otimista que só existia em memória —
 *      ela nunca chegou ao banco, justamente porque estava offline. Não está na
 *      resposta do servidor, então some na substituição.
 *   4. E o badge "falhou" era texto puro, sem botão nenhum: mesmo antes de
 *      sumir, não havia como reenviar.
 *
 * POR QUE `localStorage` E NÃO O BANCO
 * A rede de segurança do servidor (`tentativas_de_envio` + o cron que confere na
 * Evolution) resolve o caso "online, mas sem resposta". Ela não tem como cobrir
 * ESTE caso: sem internet, o `insert` da tentativa também não chega ao servidor.
 * O único lugar que sobrevive a estar offline é o próprio aparelho.
 *
 * O MOTIVO DA FALHA É GUARDADO, E ISSO NÃO É DETALHE
 * `'offline'` significa que a requisição comprovadamente não saiu (o navegador
 * nem tentou). Só nesse caso é seguro reenviar sozinho quando a rede volta.
 * Qualquer outra falha entra como `'desconhecido'` e espera clique humano — no
 * timeout, por exemplo, a Evolution pode ter aceitado a mensagem e a resposta é
 * que se perdeu. Reenviar às cegas mandaria a mesma mensagem duas vezes para um
 * paciente. É a mesma decisão que `private.verificar_tentativas_de_envio` já
 * documenta no banco ("NADA AQUI REENVIA").
 */

const CHAVE = 'central-whats:envios-pendentes'

/** O que a falha comprovadamente NÃO saiu, versus o que ninguém sabe. */
export type MotivoDaFalha = 'offline' | 'desconhecido'

export interface EnvioPendente {
  /** O mesmo id do balão otimista, para casar um com o outro na tela. */
  tempId: string
  deviceId: string
  remoteSender: string
  senderId: string
  criadoEm: string
  motivo: MotivoDaFalha
  /** Tudo o que `sendMessage` precisa para refazer o envio igualzinho. */
  payload: {
    content: string
    mediaUrl?: string
    mediaType?: string
    mediaName?: string
    reply_to_id?: string
    mentioned?: string[]
    mentionEveryone?: boolean
    forwarded?: boolean
    noSignature?: boolean
  }
}

function ler(): EnvioPendente[] {
  try {
    const cru = localStorage.getItem(CHAVE)
    if (!cru) return []
    const lista = JSON.parse(cru)
    return Array.isArray(lista) ? (lista as EnvioPendente[]) : []
  } catch {
    // JSON corrompido (versão antiga do formato, escrita interrompida) não pode
    // derrubar a conversa: vale mais perder a fila do que travar o chat.
    return []
  }
}

function gravar(lista: EnvioPendente[]): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista))
  } catch {
    // Cota estourada ou modo privado. Perder a rede de segurança é ruim; impedir
    // a pessoa de usar o chat seria pior.
  }
}

export function guardarEnvioPendente(envio: EnvioPendente): void {
  const lista = ler().filter((e) => e.tempId !== envio.tempId)
  lista.push(envio)
  gravar(lista)
}

export function esquecerEnvioPendente(tempId: string): void {
  gravar(ler().filter((e) => e.tempId !== tempId))
}

export function getEnviosPendentes(deviceId: string, remoteSender: string): EnvioPendente[] {
  return ler().filter((e) => e.deviceId === deviceId && e.remoteSender === remoteSender)
}

/** Todos, de todas as conversas — para o reenvio automático quando a rede volta. */
export function getTodosOsEnviosPendentes(): EnvioPendente[] {
  return ler()
}

/**
 * Monta o balão a ser reinjetado na lista depois de um recarregamento.
 *
 * A forma imita a de uma linha de `messages` porque quem desenha não deve
 * precisar saber que esta mensagem é diferente — só o `status: 'failed'` muda o
 * que aparece.
 */
export function comoMensagemNaTela(envio: EnvioPendente): Record<string, unknown> {
  return {
    id: envio.tempId,
    content: envio.payload.content,
    device_id: envio.deviceId,
    remote_sender: envio.remoteSender,
    sender_id: envio.senderId,
    direction: 'outbound',
    origin: 'app',
    is_read: true,
    created_at: envio.criadoEm,
    updated_at: envio.criadoEm,
    attachments: envio.payload.mediaUrl
      ? [{
          url: envio.payload.mediaUrl,
          type: envio.payload.mediaType || 'document',
          name: envio.payload.mediaName || '',
        }]
      : null,
    reply_to_id: envio.payload.reply_to_id ?? null,
    reactions: [],
    status: 'failed',
  }
}
