import supabase from '@/lib/supabase/client'
import type { Message } from '@/lib/supabase/types'

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

  const { data: result, error } = await supabase.rpc('send_whatsapp_message', argumentos)

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

  return parsed
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
