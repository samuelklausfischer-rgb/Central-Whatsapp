import supabase from '@/lib/supabase/client'
import type { Message } from '@/lib/supabase/types'
import {
  registrarTentativa,
  marcarTentativaFalhou,
  descartarTentativaSilenciosa,
  type TentativaDeEnvio,
} from '@/services/tentativas-de-envio'

export interface ConversationSummary {
  remote_sender: string
  sender_name: string
  last_message_id: string
  last_message_content: string
  last_message_direction: string
  last_message_created_at: string
  last_message_is_read: boolean
  last_message_attachments: Record<string, unknown> | null
  unread_count: number
  message_count: number
}

export const getConversationSummaries = async (deviceId: string): Promise<ConversationSummary[]> => {
  const { data, error } = await supabase.rpc('get_conversation_summaries', {
    p_device_id: deviceId,
  })
  if (error) throw new Error(error.message)
  return (data as ConversationSummary[]) || []
}

export const getConversationMessages = async (
  deviceId: string,
  remoteSender: string,
  limit = 500
): Promise<Message[]> => {
  // Postgrest aplica ORDER BY antes do LIMIT: para pegar as mensagens mais
  // RECENTES (e não as mais antigas) é preciso ordenar desc, limitar, e só
  // então reverter para ordem cronológica — mesmo padrão do getMessages().
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('device_id', deviceId)
    .eq('remote_sender', remoteSender)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data as Message[]) || []).reverse()
}

export const getMessages = async (deviceId: string) => {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('device_id', deviceId)
    // `deleted_at` é filtro de exclusão em toda listagem do projeto. Este era o
    // único caminho que não filtrava — é o fallback usado quando a RPC de
    // resumos volta vazia, e trazia mensagens já apagadas de volta para a lista.
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    // 1.000, não 2.000: o PostgREST rodava com `db-max-rows=1000` e cortava este
    // pedido em silêncio, então o 2.000 declarado nunca foi verdade. Ao subir o
    // teto do servidor, manter 2.000 dobraria de fato o payload deste fallback
    // sem ninguém ter pedido. Fixando em 1.000, o comportamento é o mesmo de
    // sempre e agora está explícito.
    .limit(1000)
  return ((data as Message[]) || []).reverse()
}

export async function reactToMessage(messageId: string, reaction: string, deviceId: string, senderId: string) {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw new Error('Not authenticated')

  const { data: result, error } = await supabase.rpc('send_whatsapp_reaction', {
    p_message_id: messageId,
    p_reaction: reaction,
    p_device_id: deviceId,
    p_sender_id: senderId || null,
  })

  if (error) throw new Error(error.message)

  const parsed = typeof result === 'string' ? JSON.parse(result) : result
  if (parsed?.error) throw new Error(parsed.error)

  return parsed
}

export const sendMessage = async (data: {
  content: string
  device_id: string
  sender_id: string
  is_read: boolean
  direction?: string
  remote_sender?: string
  attachments?: File[]
  mediaUrl?: string
  mediaType?: string
  mediaName?: string
  reply_to_id?: string
  /**
   * JIDs ou telefones a mencionar. A RPC normaliza para JID completo, que é o
   * formato que o WhatsApp espera — sem isso a menção sai como texto comum, com
   * o número escrito na mensagem e ninguém notificado.
   */
  mentioned?: string[]
  /** Marca todos os participantes; a Evolution preenche a lista sozinha. */
  mentionEveryone?: boolean
  /**
   * Encaminhamento. Faz duas coisas na função do banco: NÃO prepende a
   * assinatura do atendente (encaminhamento de verdade no WhatsApp não tem
   * assinatura) e grava a linha marcada, para o balão mostrar "Encaminhada".
   *
   * O rótulo aparece só DENTRO do Central Whats. Marcar a mensagem como
   * encaminhada no WhatsApp de quem recebe exige `contextInfo.isForwarded`, que
   * a Evolution API não expõe em nenhuma versão — conferido no DTO da 2.3.7 e
   * da 2.4.0-rc2, e por busca no repositório inteiro.
   */
  forwarded?: boolean
  /**
   * ITEM 7: pula a assinatura salva (device.signature/profiles.signature)
   * para ESTE envio, sem marcar a mensagem como encaminhada — ao contrário
   * de `forwarded`, que faz as duas coisas. Vem do toggle "sem assinatura"
   * do compositor; default `false` preserva o comportamento de hoje
   * (assina sempre que houver assinatura salva).
   */
  noSignature?: boolean
}) => {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw new Error('Not authenticated')

  if (!data.remote_sender) {
    throw new Error('remote_sender is required')
  }

  /**
   * A TENTATIVA É GRAVADA ANTES, e este é o ponto de todo o recurso.
   *
   * Até aqui, envio que falhava não deixava rastro nenhum: a linha em
   * `messages` só nasce depois que a Evolution confirma, então "não sobrou
   * nada" era o comportamento normal. A pessoa via um toast sumir e não sabia
   * se a mensagem tinha chegado na paciente.
   *
   * SEM `await` DE PROPÓSITO. A requisição do registro sai em paralelo com o
   * envio, então o caminho feliz não fica um round-trip mais lento — e a linha
   * é comitada de qualquer forma, mesmo que o envio estoure depois. Awaitar
   * aqui só serviria para atrasar toda mensagem do app por causa de um caso
   * raro.
   *
   * Gravar do lado do cliente, e não dentro de `send_whatsapp_message`, também
   * é deliberado: a RPC é UMA transação, e `authenticated` tem
   * `statement_timeout = 8s`. Se ela estourar o tempo ou levantar exceção —
   * justamente os casos que hoje somem —, qualquer insert feito lá dentro é
   * DESFEITO junto. Como efeito colateral bom, a função mais crítica do app não
   * precisou ser tocada.
   */
  const idDeQuemEnvia = data.sender_id || session.data.session.user.id
  const tipoDaTentativa: TentativaDeEnvio['tipo'] = data.forwarded
    ? 'encaminhada'
    : data.mediaType?.startsWith('audio')
      ? 'audio'
      : data.mediaUrl || data.attachments?.length
        ? 'midia'
        : 'texto'
  // O `File` cru não é persistível, mas a URL já foi resolvida antes de chegar
  // aqui — e é ela que torna o reenvio de mídia possível.
  const tentativa = idDeQuemEnvia
    ? registrarTentativa({
        device_id: data.device_id,
        remote_sender: data.remote_sender,
        sender_id: idDeQuemEnvia,
        conteudo: data.content,
        anexos: data.mediaUrl
          ? { mediaUrl: data.mediaUrl, mediaType: data.mediaType, mediaName: data.mediaName }
          : null,
        reply_to_id: data.reply_to_id || null,
        tipo: tipoDaTentativa,
      })
    : Promise.resolve(null)

  /**
   * `p_sem_assinatura` só entra no payload quando é TRUE — de propósito.
   *
   * O parâmetro nasceu numa migration que pode ainda não ter sido aplicada no
   * banco quando este código subir. O PostgREST resolve a função pela lista de
   * argumentos: mandar um parâmetro que a função ainda não tem faz a chamada
   * falhar por assinatura desconhecida — e aqui isso não seria "o toggle não
   * funciona", seria **todo envio de mensagem quebrado**, que é a função
   * principal do app.
   *
   * Omitindo quando é `false` (o padrão, e a esmagadora maioria das chamadas),
   * as duas pontas ficam independentes: o app funciona igual a hoje mesmo sem a
   * migration, e o toggle passa a ter efeito assim que ela for aplicada. Sem
   * ordem obrigatória de deploy.
   */
  const argumentos: Record<string, unknown> = {
    p_device_id: data.device_id,
    p_remote_sender: data.remote_sender,
    p_content: data.content,
    p_sender_id: data.sender_id || null,
    p_media_url: data.mediaUrl || null,
    p_media_type: data.mediaType || null,
    p_media_name: data.mediaName || null,
    p_reply_to_id: data.reply_to_id || null,
    p_mentioned: data.mentioned && data.mentioned.length > 0 ? data.mentioned : null,
    p_mention_everyone: data.mentionEveryone ?? false,
    p_forwarded: data.forwarded ?? false,
  }
  if (data.noSignature) argumentos.p_sem_assinatura = true

  try {
    let { data: result, error } = await supabase.rpc('send_whatsapp_message', argumentos)

    /**
     * Rede de segurança: banco sem o parâmetro que este cliente conhece.
     *
     * Já aconteceu. O toggle "sem assinatura" foi publicado antes da migration
     * ser aplicada, e como o PostgREST resolve a função pela LISTA DE ARGUMENTOS,
     * mandar um parâmetro que o banco ainda não tem devolve `PGRST202` — e a
     * mensagem simplesmente não saía.
     *
     * Num app de atendimento, "não enviou nada" é pior que "enviou assinado": a
     * pessoa perde o que digitou e costuma nem entender o porquê. Então aqui a
     * falha degrada — reenvia sem o parâmetro e devolve um aviso para a interface
     * contar o que houve, em vez de sumir com a mensagem.
     *
     * Só entra neste caminho quem pediu `noSignature`; envio normal nunca passa
     * por aqui.
     */
    let assinaturaNaoSuprimida = false
    if (error && data.noSignature && error.code === 'PGRST202') {
      console.warn(
        '[envio] banco não conhece `p_sem_assinatura` — reenviando com assinatura.',
        error.message,
      )
      delete argumentos.p_sem_assinatura
      ;({ data: result, error } = await supabase.rpc('send_whatsapp_message', argumentos))
      assinaturaNaoSuprimida = !error
    }

    if (error) throw new Error(error.message)

    const parsed = typeof result === 'string' ? JSON.parse(result) : result
    if (parsed?.error) {
      const detail = parsed.status ? ` (status ${parsed.status})` : ''
      // `body` é a resposta CRUA da Evolution e era descartada aqui. Sem ela todo
      // erro de envio chegava ao atendente como "Evolution API error (status 400)",
      // que não distingue número inválido de arquivo que a Evolution não conseguiu
      // converter. Truncado porque a resposta às vezes traz um stack inteiro.
      const corpo = typeof parsed.body === 'string' ? parsed.body : parsed.body ? JSON.stringify(parsed.body) : ''
      const causa = corpo ? `: ${corpo.slice(0, 300)}` : ''
      throw new Error(parsed.error + detail + causa)
    }

    // A mensagem SAIU: a linha real já existe em `messages`, então a tentativa
    // não tem mais função. Sem `await` — quem enviou não deve esperar por uma
    // limpeza, e se ela falhar o verificador do banco resolve depois.
    void tentativa.then((id) => {
      if (id) void descartarTentativaSilenciosa(id)
    })

    // Sinaliza o caso da rede de segurança acima: a mensagem SAIU, mas assinada,
    // porque o banco não suportava suprimir. Quem chama decide como contar isso —
    // o importante é não deixar a pessoa achar que saiu sem assinatura.
    if (assinaturaNaoSuprimida && parsed && typeof parsed === 'object') {
      return { ...parsed, assinaturaNaoSuprimida: true }
    }

    return parsed
  } catch (e) {
    /*
      Aqui a tentativa deixa de ser rascunho e vira registro de falha: é o que
      faz o balão vermelho sobreviver a recarregar a página. Awaitamos porque
      ninguém está esperando velocidade neste caminho — o envio já falhou.

      A exceção é RELANÇADA sem alteração: todos os 7 pontos de envio do app
      dependem do erro chegar até eles para mostrar o toast, e engolir isso
      trocaria uma falha visível por uma silenciosa.
    */
    const id = await tentativa
    if (id) {
      await marcarTentativaFalhou(id, e instanceof Error ? e.message : String(e))
      /*
        O id vai CARIMBADO no erro para que a interface saiba, na hora, que a
        falha ficou gravada. Sem isso ela teria que adivinhar: mostraria o balão
        otimista em memória (que some ao recarregar e não tem botão de reenviar)
        e, ao mesmo tempo, o balão persistido apareceria na próxima abertura da
        conversa — duas representações da mesma falha.

        Quando o carimbo NÃO vem, é porque nem o registro deu certo (tipicamente
        offline, em que as duas requisições falham juntas). Aí o balão em
        memória é tudo o que existe, e continua sendo mostrado.
      */
      if (e instanceof Error) {
        ;(e as Error & { idTentativa?: string }).idTentativa = id
      }
    }
    throw e
  }
}

export async function deleteMessage(messageId: string, deviceId: string, deleteForEveryone: boolean) {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw new Error('Not authenticated')

  const { data: result, error } = await supabase.rpc('delete_whatsapp_message', {
    p_message_id: messageId,
    p_device_id: deviceId,
    p_delete_for_everyone: deleteForEveryone,
  })

  if (error) throw new Error(error.message)

  const parsed = typeof result === 'string' ? JSON.parse(result) : result
  if (parsed?.error) throw new Error(parsed.error)

  return parsed
}

export async function editMessage(messageId: string, deviceId: string, newContent: string) {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw new Error('Not authenticated')

  const { data: result, error } = await supabase.rpc('edit_whatsapp_message', {
    p_message_id: messageId,
    p_device_id: deviceId,
    p_new_content: newContent,
  })

  if (error) throw new Error(error.message)

  const parsed = typeof result === 'string' ? JSON.parse(result) : result
  if (parsed?.error) throw new Error(parsed.error)

  return parsed
}
