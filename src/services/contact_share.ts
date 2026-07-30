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
 * mandaria um número inexistente para a paciente, e o erro só apareceria do
 * outro lado.
 *
 * O `includes('@')` resolve GRUPO, que a ingestão preserva como `@g.us`. Não
 * resolve LID: a ingestão grava LID SEM o sufixo, em dígitos puros, então a
 * guarda nunca disparava e a faixa de 10–15 dígitos aceitava.
 *
 * O corte é por COMPRIMENTO porque é o que separa os dois na base real
 * (contagem em 2026-07-30, `contacts` com chave numérica):
 *
 *   12 dígitos → 639 contatos, 638 começam com 55   ← telefone BR (55+DDD+8)
 *   13 dígitos → 202 contatos, 184 começam com 55   ← telefone BR (55+DDD+9)
 *   14 dígitos → 187 contatos,   5 começam com 55   ← LID
 *   15 dígitos → 371 contatos,   0 começam com 55   ← LID
 *   16-17      → 112 contatos                        ← LID
 *
 * Número brasileiro para em 13 dígitos com o país; de 14 para cima é LID, e as 5
 * exceções que começam com 55 são coincidência de prefixo, não telefone. O teto
 * de 13 mantém os 843 contatos reais (inclusive o internacional de 11 dígitos) e
 * barra as 558 chaves LID que a faixa antiga liberava.
 */
export function podeCompartilhar(contato: Pick<Contact, 'remote_jid'> | null | undefined): boolean {
  const jid = contato?.remote_jid
  if (!jid) return false
  if (jid.includes('@')) return false
  return /^[0-9]{10,13}$/.test(jid)
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
