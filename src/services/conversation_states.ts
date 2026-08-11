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

/**
 * Zera as notificações de TODOS os aparelhos a que o usuário tem acesso, para a
 * EQUIPE INTEIRA. Devolve quantas conversas foram afetadas. Não há desfazer —
 * quem chama precisa confirmar antes.
 *
 * O trabalho todo mora na RPC. A versão anterior desta função vivia aqui no
 * cliente e estava quebrada de duas formas: lia `remote_sender` de `messages` sem
 * paginação (o PostgREST corta em 1.000 linhas em silêncio, e são 46 mil
 * mensagens — enxergava uma fração das conversas) e depois disparava um RPC por
 * conversa, milhares de chamadas para o que no banco é uma instrução só.
 */
export async function zerarTodasAsNotificacoes(): Promise<number> {
  const { data, error } = await supabase.rpc('mark_all_conversations_read_global')
  if (error) {
    console.error('Error clearing all notifications:', error)
    throw error
  }
  return (data as number) ?? 0
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
          .select(
            'id, remote_sender, status, assigned_to, assigned_by, assigned_at, finished_at, invited_to, global_responded_at',
          )
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

export interface MessageReadReceipt {
  user_id: string
  name: string | null
  avatar_url: string | null
  /** `null` = ainda não viu esta mensagem. */
  seen_at: string | null
}

/**
 * Registra que o usuário logado viu esta conversa até a mensagem de horário
 * `upToMessageAt`. É INSERT puro — a tabela `conversation_read_progress` não
 * aceita UPDATE nem DELETE (RLS), então "progresso" é reconstruído lendo o
 * maior `up_to_message_at` entre todas as linhas do usuário na conversa.
 *
 * Por que checar antes de inserir: sem isso, toda vez que a conversa é aberta
 * (ou o efeito de marcar-como-lida roda de novo por qualquer motivo — poll,
 * realtime, StrictMode) nasce uma linha nova, e a tabela cresce pelo NÚMERO DE
 * ABERTURAS, não pela leitura de fato. Só grava quando o horário novo é
 * estritamente maior que o que este usuário já tinha registrado nesta
 * conversa — retroceder (ex.: reabrir depois de rolar pra cima) não conta como
 * progresso e não gera linha.
 */
export async function registrarProgressoDeLeitura(
  deviceId: string,
  remoteSender: string,
  upToMessageId: string | null,
  upToMessageAt: string,
): Promise<void> {
  const userId = (await supabase.auth.getSession()).data.session?.user?.id
  if (!userId) return

  const { data: maiorAtual, error: errBusca } = await supabase
    .from('conversation_read_progress')
    .select('up_to_message_at')
    .eq('device_id', deviceId)
    .eq('remote_sender', remoteSender)
    .eq('user_id', userId)
    .order('up_to_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (errBusca) {
    console.error('Error checking read progress:', errBusca)
    return
  }
  if (maiorAtual && new Date((maiorAtual as any).up_to_message_at) >= new Date(upToMessageAt)) {
    return // não avançou — não insere
  }

  const { error } = await supabase.from('conversation_read_progress').insert({
    device_id: deviceId,
    remote_sender: remoteSender,
    user_id: userId,
    up_to_message_id: upToMessageId,
    up_to_message_at: upToMessageAt,
  } as any)
  if (error) console.error('Error registering read progress:', error)
}

/**
 * Recibos de leitura de UMA mensagem: para cada membro da equipe do aparelho,
 * se viu e quando. "Viu" = existe linha do usuário com
 * `up_to_message_at >= messageCreatedAt`; "quando viu" = a MENOR `read_at`
 * entre essas linhas (a primeira vez que a mensagem entrou no campo de visão
 * dele, não a mais recente).
 *
 * Lança em vez de engolir o erro, ao contrário da maioria das funções deste
 * arquivo: quem chama precisa distinguir "ninguém viu ainda" (lista vazia,
 * resultado legítimo) de "não deu pra saber quem viu" (falha de rede/RLS) — um
 * painel de recibo que mostra todo mundo como "Não visto" por causa de um erro
 * de rede é pior do que mostrar a tela de erro.
 *
 * SEM paginação por `buscarTodasAsPaginas` aqui, de propósito: o filtro não é
 * só por conversa (que cresce sem limite com o histórico, como
 * `conversation_user_states`/`conversation_assignments`), mas por conversa E
 * `up_to_message_at >= messageCreatedAt`. O teto de linhas é o tamanho da
 * equipe do aparelho — hoje algumas dezenas —, várias ordens de grandeza
 * abaixo dos 1.000 do PostgREST. Paginar aqui seria complexidade sem risco
 * correspondente.
 */
export async function getRecibosDaMensagem(
  deviceId: string,
  remoteSender: string,
  messageCreatedAt: string,
): Promise<MessageReadReceipt[]> {
  const membros = await getDeviceTeamMembers(deviceId)

  const { data, error } = await supabase
    .from('conversation_read_progress')
    .select('user_id, read_at')
    .eq('device_id', deviceId)
    .eq('remote_sender', remoteSender)
    .gte('up_to_message_at', messageCreatedAt)
  if (error) {
    console.error('Error fetching message receipts:', error)
    throw error
  }

  const menorReadAtPorUsuario = new Map<string, string>()
  for (const linha of (data ?? []) as { user_id: string; read_at: string }[]) {
    const atual = menorReadAtPorUsuario.get(linha.user_id)
    if (!atual || new Date(linha.read_at) < new Date(atual)) {
      menorReadAtPorUsuario.set(linha.user_id, linha.read_at)
    }
  }

  return membros.map((m) => ({
    user_id: m.user_id,
    name: m.name,
    avatar_url: m.avatar_url,
    seen_at: menorReadAtPorUsuario.get(m.user_id) ?? null,
  }))
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
