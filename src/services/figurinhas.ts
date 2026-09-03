/**
 * Figurinhas: enviar, guardar as preferidas e achar as recentes da conversa.
 *
 * Enviar não passa pelo `sendMessage` comum: a Evolution tem endpoint próprio
 * para figurinha, com corpo diferente do de mídia genérica, então o caminho é a
 * RPC `send_whatsapp_sticker` (ver a migration
 * 20260903152040_figurinhas_enviar_e_favoritas.sql para o porquê de ser uma
 * função separada e não um ramo dentro do envio normal).
 */

import supabase from '@/lib/supabase/client'
import type { Message } from '@/lib/supabase/types'

export interface FigurinhaSalva {
  id: string
  user_id: string
  storage_url: string
  source_message_id: string | null
  created_at: string
}

export async function enviarFigurinha(
  deviceId: string,
  remoteSender: string,
  urlDaFigurinha: string,
  senderId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc('send_whatsapp_sticker', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
    p_sticker_url: urlDaFigurinha,
    p_sender_id: senderId || null,
  })
  if (error) throw new Error(error.message)

  const resposta = typeof data === 'string' ? JSON.parse(data) : data
  if (resposta?.error) {
    const corpo = typeof resposta.body === 'string' ? resposta.body.slice(0, 200) : ''
    throw new Error(corpo ? `${resposta.error}: ${corpo}` : resposta.error)
  }
}

export async function getFigurinhasSalvas(): Promise<FigurinhaSalva[]> {
  const { data, error } = await supabase
    .from('saved_stickers')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    // Migration ainda não aplicada não pode quebrar o compositor: a aba de
    // favoritas simplesmente aparece vazia.
    console.warn('[figurinhas] não consegui ler as salvas:', error.message)
    return []
  }
  return (data as FigurinhaSalva[]) || []
}

export async function guardarFigurinha(
  userId: string,
  urlDaFigurinha: string,
  mensagemDeOrigem?: string | null,
): Promise<void> {
  const { error } = await supabase.from('saved_stickers').insert({
    user_id: userId,
    storage_url: urlDaFigurinha,
    source_message_id: mensagemDeOrigem ?? null,
  })
  // `23505` = violação de unicidade: já estava guardada. Não é erro para quem
  // clicou — o resultado desejado (a figurinha está na coleção) já vale.
  if (error && error.code !== '23505') throw new Error(error.message)
}

export async function esquecerFigurinha(id: string): Promise<void> {
  const { error } = await supabase.from('saved_stickers').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * As figurinhas que apareceram nesta conversa, das mais novas para as mais
 * velhas, sem repetir.
 *
 * Sai das mensagens que já estão carregadas em vez de ir ao banco: a lista da
 * conversa já tem tudo, e uma consulta a mais só para montar a aba "recentes"
 * seria trabalho repetido.
 */
export function figurinhasRecentes(mensagens: Message[], limite = 24): string[] {
  const urls: string[] = []
  for (let i = mensagens.length - 1; i >= 0 && urls.length < limite; i--) {
    const anexos = mensagens[i]?.attachments
    if (!Array.isArray(anexos)) continue
    for (const anexo of anexos as { type?: string; url?: string }[]) {
      if (anexo?.type === 'sticker' && anexo.url && !urls.includes(anexo.url)) {
        urls.push(anexo.url)
      }
    }
  }
  return urls
}
