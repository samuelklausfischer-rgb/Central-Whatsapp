import supabase from '@/lib/supabase/client'
import { buscarTodasAsPaginas } from '@/lib/supabase/paginate'
import type { ConversationAssignment, TeamMember, ConversationRecentViewer } from '@/lib/supabase/types'

export interface ConversationUserState {
  id: string
  device_id: string
  remote_sender: string
  user_id: string
  last_read_message_id: string | null
  last_read_at: string | null
  last_opened_at: string | null
  manual_unread: boolean
  manual_unread_at: string | null
  marked_unread_by_user_id: string | null
  pinned: boolean
  pinned_at: string | null
  archived: boolean
  archived_at: string | null
  responded_at: string | null
  created_at: string
  updated_at: string
}

// Paginado: o PostgREST corta em 1.000 linhas sem erro (ver lib/supabase/paginate.ts)
// e o filtro aqui é só por `user_id` — 7 dos 12 usuários já passam de 1.000
// estados (1213, 1192, 1189, 1185, 1145, 1144, 1139). Cada carga perdia de 139 a
// 213 estados EM SILÊNCIO: conversas fixadas, marcadas como não lida e
// `responded_at` sumindo de forma aparentemente aleatória.
//
// O `.order('id')` não é cosmético: sem ordenação total e única, o keyset pula e
// repete linhas. A função não tinha ordenação nenhuma, então até o conjunto que
// era descartado mudava conforme a ordem física da heap.
export async function getMyStates(): Promise<ConversationUserState[]> {
  const userId = (await supabase.auth.getSession()).data.session?.user?.id || ''
  try {
    return await buscarTodasAsPaginas<ConversationUserState>(
      (tamanho, cursor) => {
        let q = supabase
          .from('conversation_user_states')
          .select('*')
          .eq('user_id', userId)
          .order('id', { ascending: true })
          .limit(tamanho)
        if (cursor) q = q.gt('id', cursor)
        return q as any
      },
      (linha) => linha.id,
    )
  } catch (error) {
    console.error('Error fetching conversation states:', error)
    return []
  }
}

export async function markConversationRead(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error marking conversation as read:', error)
}

export async function markConversationUnread(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_unread', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error marking conversation as unread:', error)
}

export async function togglePin(deviceId: string, remoteSender: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('toggle_conversation_pin', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error toggling pin:', error)
    return null
  }
  return data as boolean
}

export async function toggleArchive(deviceId: string, remoteSender: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('toggle_conversation_archive', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error toggling archive:', error)
    return null
  }
  return data as boolean
}

export interface ConversationViewer {
  user_id: string
  user_name: string
  last_read_at: string | null
  last_opened_at: string | null
}

export async function markAllConversationsReadForDevice(deviceId: string): Promise<void> {
  const { data } = await supabase
    .from('messages')
    .select('remote_sender')
    .eq('device_id', deviceId)
    .eq('direction', 'inbound')
    .is('deleted_at', null)
  const senders = [...new Set((data || []).map((r: { remote_sender: string }) => r.remote_sender))]
  await Promise.all(senders.map((s) => markConversationRead(deviceId, s)))
}

export async function toggleResponded(deviceId: string, remoteSender: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('toggle_conversation_responded', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error toggling responded:', error)
    return null
  }
  return data as string | null
}

export async function getConversationViewers(deviceId: string, remoteSender: string): Promise<ConversationViewer[]> {
  const { data, error } = await supabase.rpc('get_conversation_viewers', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error fetching conversation viewers:', error)
    return []
  }
  return (data as ConversationViewer[]) || []
}

export async function markConversationReadGlobal(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read_global', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error marking conversation as globally read:', error)
}

export async function takeConversation(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('take_conversation', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error taking conversation:', error)
}

export async function assignConversation(deviceId: string, remoteSender: string, targetUserId: string): Promise<void> {
  const { error } = await supabase.rpc('assign_conversation', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
    p_target_user_id: targetUserId,
  })
  if (error) console.error('Error assigning conversation:', error)
}

export async function setConversationWaiting(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('set_conversation_waiting', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error setting conversation to waiting:', error)
}

export async function finishConversation(deviceId: string, remoteSender: string): Promise<void> {
  const { error } = await supabase.rpc('finish_conversation', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) console.error('Error finishing conversation:', error)
}

export async function getConversationAssignment(deviceId: string, remoteSender: string): Promise<ConversationAssignment | null> {
  const { data, error } = await supabase.rpc('get_conversation_assignment', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error fetching conversation assignment:', error)
    return null
  }
  return (data?.[0] as ConversationAssignment) ?? null
}

export async function getDeviceTeamMembers(deviceId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc('get_device_team_members', {
    p_device_id: deviceId,
  })
  if (error) {
    console.error('Error fetching team members:', error)
    return []
  }
  return (data as TeamMember[]) || []
}

export async function getConversationRecentViewers(deviceId: string, remoteSender: string): Promise<ConversationRecentViewer[]> {
  const { data, error } = await supabase.rpc('get_conversation_recent_viewers', {
    p_device_id: deviceId,
    p_remote_sender: remoteSender,
  })
  if (error) {
    console.error('Error fetching conversation viewers:', error)
    return []
  }
  return (data as ConversationRecentViewer[]) || []
}

// `select('*')` trazia as 18 colunas da tabela — 284-301 kB por troca de aparelho
// nos aparelhos grandes, ~6x o payload da própria lista de conversas. Estas cinco
// são as únicas que a UI lê daqui: `status` e `assigned_to` (badge de atribuição
// e o `pinned` do ChatHub), `invited_to` (convite pendente) e
// `global_responded_at` (selo de não respondido).
//
// NÃO incluir `assigned_to_name`/`invited_to_name`/`invited_by_name`: eles estão
// no tipo `ConversationAssignment` e são lidos pelos componentes, mas NÃO existem
// como coluna da tabela — pedi-los aqui devolve 400 e derruba os assignments
// inteiros. Já chegavam `undefined` por este caminho no tempo do `select('*')`;
// quem os preenche é a RPC de `getConversationAssignment`.
//
// Ao passar a ler uma coluna nova em qualquer consumidor, incluir aqui — senão o
// campo chega `undefined` em silêncio.
// Paginado preventivamente: o filtro é por aparelho e o maior tem 533 linhas
// hoje (53% do teto de 1.000 do PostgREST), então ainda não trunca — mas quando
// cruzar, atribuições sumiriam sem erro nenhum, do mesmo jeito que os contatos
// sumiram. `id` entra no select só para ancorar o keyset.
export async function getDeviceAssignments(deviceId: string): Promise<Map<string, ConversationAssignment>> {
  let linhas: ConversationAssignment[]
  try {
    linhas = await buscarTodasAsPaginas<ConversationAssignment>(
      (tamanho, cursor) => {
        let q = supabase
          .from('conversation_assignments')
          .select('id, remote_sender, status, assigned_to, invited_to, global_responded_at')
          .eq('device_id', deviceId)
          .order('id', { ascending: true })
          .limit(tamanho)
        if (cursor) q = q.gt('id', cursor)
        return q as any
      },
      (linha) => (linha as any).id,
    )
  } catch (error) {
    console.error('getDeviceAssignments error:', error)
    return new Map()
  }
  const map = new Map<string, ConversationAssignment>()
  for (const row of linhas) {
    map.set(row.remote_sender, row as ConversationAssignment)
  }
  return map
}

/**
 * Quando uma conversa conta como RESPONDIDA.
 *
 * São duas marcas diferentes: `conversation_user_states.responded_at`, individual
 * de cada atendente, e `conversation_assignments.global_responded_at`, gravado
 * quando alguém finaliza o atendimento e válido para todo mundo. Vale a mais
 * recente das duas.
 *
 * Mora aqui, e não na tela, porque a lista de conversas e o painel precisam da
 * MESMA regra — quando o painel usava só a individual, conversa finalizada por um
 * colega sumia da lista e continuava contando como não respondida no painel.
 */
export function respondidaEm(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return new Date(a) > new Date(b) ? a : b
}
