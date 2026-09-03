/**
 * Contato fixo — o vínculo permanente entre um contato e um atendente.
 *
 * A diferença para `conversation_states.ts` (designar/pegar conversa) é o tempo
 * de vida: aquilo é o estado do atendimento de AGORA e é zerado ao finalizar ou
 * reabrir; isto sobrevive a tudo e volta a valer na próxima mensagem que chegar.
 *
 * Quem aplica o vínculo é o banco, no gatilho `processar_mensagem_para_atendimento`:
 * mensagem recebida de contato com dono fixo cai direto na mão dele se estiver
 * online, ou em 'aguardando' se não estiver. Este arquivo só cuida de ler e
 * escrever o vínculo — o roteamento nunca depende do app estar aberto.
 */

import supabase from '@/lib/supabase/client'

export interface DonoDoContato {
  owner_id: string
  owner_name: string | null
  set_by: string | null
  online: boolean
}

/**
 * Quem é o dono fixo deste contato, e se está disponível agora.
 *
 * Duas consultas em vez de uma junção porque a presença não sai de `profiles`:
 * ela mora em `user_app_sessions`, que é fechada por RLS a super-admin. A RPC
 * `is_profile_online` devolve só o booleano, sem expor horário de acesso nem
 * tempo de uso de ninguém.
 */
export async function getDonoDoContato(
  deviceId: string,
  remoteSender: string,
): Promise<DonoDoContato | null> {
  if (!deviceId || !remoteSender) return null

  const { data, error } = await supabase
    .from('contact_owners')
    .select('owner_id, set_by, profiles:owner_id (name)')
    .eq('device_id', deviceId)
    .eq('remote_sender', remoteSender)
    .maybeSingle()

  if (error) {
    // Enquanto a migration não estiver aplicada, a tabela não existe — e isso
    // não pode virar erro na tela de chat. Sem dono fixo, tudo segue como antes.
    console.warn('[contato fixo] não consegui ler:', error.message)
    return null
  }
  if (!data) return null

  const linha = data as unknown as {
    owner_id: string
    set_by: string | null
    profiles?: { name: string | null } | { name: string | null }[] | null
  }
  const perfil = Array.isArray(linha.profiles) ? linha.profiles[0] : linha.profiles

  let online = false
  const { data: estaOnline, error: erroPresenca } = await supabase.rpc('is_profile_online', {
    p_user_id: linha.owner_id,
  })
  if (erroPresenca) console.warn('[contato fixo] não consegui ver a presença:', erroPresenca.message)
  else online = Boolean(estaOnline)

  return {
    owner_id: linha.owner_id,
    owner_name: perfil?.name ?? null,
    set_by: linha.set_by,
    online,
  }
}

export async function fixarContato(
  deviceId: string,
  remoteSender: string,
  ownerId: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_contact_owner', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
    p_owner_id: ownerId,
  })
  if (error) throw new Error(traduzir(error.message))
}

export async function desfixarContato(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('clear_contact_owner', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) throw new Error(traduzir(error.message))
}

/** As RPCs levantam exceção em português; isto cobre o que vier do PostgREST. */
function traduzir(mensagem: string): string {
  if (mensagem.includes('does not exist') || mensagem.includes('schema cache')) {
    return 'Recurso ainda não disponível neste banco (migration pendente).'
  }
  return mensagem
}
