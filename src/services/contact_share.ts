import supabase from '@/lib/supabase/client'
import type { Contact } from '@/lib/supabase/types'

/**
 * Compartilhar cartão de contato (vCard).
 *
 * Passa pela RPC `send_whatsapp_contact`, criada com nome novo de propósito: a
 * função de envio existente só roteia texto e mídia, e todo o resto cai no ramo
 * que vai para o endpoint de ÁUDIO — compartilhar contato por lá enviaria lixo.
 *
 * Vários contatos vão numa chamada só: a Evolution aceita `contact` como array e
 * o `ChatWindow` já renderiza um balão por anexo. N contatos = UMA mensagem.
 */

export interface ContatoParaCompartilhar {
  name: string
  phone: string
}

/**
 * Só é compartilhável quem tem telefone de verdade.
 *
 * Grupo não é cartão de contato, e chave `@lid` NÃO é telefone — enviar um LID
 * mandaria um número inexistente para a paciente, e o erro só apareceria do outro
 * lado. Medido na base: 63 grupos e 98 contatos com chave `@lid`.
 */
export function podeCompartilhar(contato: Pick<Contact, 'remote_jid'> | null | undefined): boolean {
  const jid = contato?.remote_jid
  if (!jid) return false
  if (jid.includes('@')) return false
  return /^[0-9]{10,15}$/.test(jid)
}

export function paraCartao(contato: Contact): ContatoParaCompartilhar {
  return {
    name: contato.nickname || contato.name || contato.remote_jid,
    phone: contato.remote_jid,
  }
}

export async function compartilharContatos(params: {
  deviceId: string
  remoteSender: string
  contatos: ContatoParaCompartilhar[]
  senderId?: string | null
}) {
  const { data, error } = await supabase.rpc('send_whatsapp_contact', {
    p_device_id: params.deviceId,
    p_remote_sender: params.remoteSender,
    p_contatos: params.contatos,
    p_sender_id: params.senderId ?? null,
  })

  if (error) throw new Error(error.message)

  const parsed = typeof data === 'string' ? JSON.parse(data) : data
  if (parsed?.error) {
    const detalhe = parsed.status ? ` (status ${parsed.status})` : ''
    throw new Error(parsed.error + detalhe)
  }
  return parsed
}
