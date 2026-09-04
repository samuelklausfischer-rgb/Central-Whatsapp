import supabase from '@/lib/supabase/client'
import { getConversationSummaries } from '@/services/messages'
import { getDeviceAssignments } from '@/services/conversation_states'

export interface DashboardFilters {
  userId: string
  deviceIds?: string[]  // undefined = todos
  from: Date
  to: Date
}

export interface PeriodStats {
  total: number
  inbound: number
  outbound: number
  sentByMe: number   // outbound WHERE sender_id = userId
  byDevice: Record<string, { inbound: number; outbound: number; sentByMe: number }>
}

export interface ChartPoint {
  label: string
  recebidas: number
  enviadas: number
  enviadas_eu: number
}

export interface ConversationActivity {
  remote_sender: string
  sender_name: string | null
  total: number
  inbound: number
  outbound: number
  device_id: string
  device_name: string
}

// ─── Stat principal ────────────────────────────────────────────────────────────

export async function getDashboardStats(f: DashboardFilters): Promise<PeriodStats> {
  let q = supabase
    .from('messages')
    .select('id, direction, device_id, sender_id')
    .gte('created_at', f.from.toISOString())
    .lte('created_at', f.to.toISOString())
    .is('deleted_at', null)

  if (f.deviceIds?.length) q = q.in('device_id', f.deviceIds)

  const { data } = await q
  const rows = data || []

  const byDevice: PeriodStats['byDevice'] = {}
  let inbound = 0, outbound = 0, sentByMe = 0

  for (const r of rows) {
    if (!byDevice[r.device_id]) byDevice[r.device_id] = { inbound: 0, outbound: 0, sentByMe: 0 }
    if (r.direction === 'inbound') {
      inbound++
      byDevice[r.device_id].inbound++
    } else {
      outbound++
      byDevice[r.device_id].outbound++
      if (r.sender_id === f.userId) {
        sentByMe++
        byDevice[r.device_id].sentByMe++
      }
    }
  }

  return { total: rows.length, inbound, outbound, sentByMe, byDevice }
}

// ─── Gráfico ───────────────────────────────────────────────────────────────────

export async function getChartData(f: DashboardFilters): Promise<ChartPoint[]> {
  let q = supabase
    .from('messages')
    .select('direction, sender_id, created_at')
    .gte('created_at', f.from.toISOString())
    .lte('created_at', f.to.toISOString())
    .is('deleted_at', null)

  if (f.deviceIds?.length) q = q.in('device_id', f.deviceIds)

  const { data } = await q
  const rows = data || []

  const diffMs = f.to.getTime() - f.from.getTime()
  const isSingleDay = diffMs <= 26 * 60 * 60 * 1000  // até ~1 dia

  if (isSingleDay) {
    // Agrupar por blocos de 2h (0h, 2h, 4h ... 22h)
    const map: Record<string, ChartPoint> = {}
    for (let h = 0; h < 24; h += 2) {
      const label = `${String(h).padStart(2, '0')}h`
      map[label] = { label, recebidas: 0, enviadas: 0, enviadas_eu: 0 }
    }
    for (const r of rows) {
      const hour = new Date(r.created_at).getHours()
      const bucket = Math.floor(hour / 2) * 2
      const label = `${String(bucket).padStart(2, '0')}h`
      if (!map[label]) continue
      if (r.direction === 'inbound') map[label].recebidas++
      else {
        map[label].enviadas++
        if (r.sender_id === f.userId) map[label].enviadas_eu++
      }
    }
    return Object.values(map)
  } else {
    // Agrupar por dia
    const map: Record<string, ChartPoint> = {}
    const cursor = new Date(f.from)
    cursor.setHours(0, 0, 0, 0)
    while (cursor <= f.to) {
      const key = `${String(cursor.getDate()).padStart(2, '0')}/${String(cursor.getMonth() + 1).padStart(2, '0')}`
      map[key] = { label: key, recebidas: 0, enviadas: 0, enviadas_eu: 0 }
      cursor.setDate(cursor.getDate() + 1)
    }
    for (const r of rows) {
      const d = new Date(r.created_at)
      const key = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!map[key]) continue
      if (r.direction === 'inbound') map[key].recebidas++
      else {
        map[key].enviadas++
        if (r.sender_id === f.userId) map[key].enviadas_eu++
      }
    }
    return Object.values(map)
  }
}

// ─── Top conversas ─────────────────────────────────────────────────────────────

export async function getTopConversations(
  f: DashboardFilters,
  deviceNameMap: Record<string, string>,
): Promise<ConversationActivity[]> {
  let q = supabase
    .from('messages')
    .select('remote_sender, sender_name, direction, device_id')
    .gte('created_at', f.from.toISOString())
    .lte('created_at', f.to.toISOString())
    .is('deleted_at', null)

  if (f.deviceIds?.length) q = q.in('device_id', f.deviceIds)

  const { data } = await q
  const map: Record<string, ConversationActivity> = {}

  for (const r of data || []) {
    const key = `${r.device_id}|${r.remote_sender}`
    if (!map[key]) {
      map[key] = {
        remote_sender: r.remote_sender,
        sender_name: r.sender_name,
        total: 0,
        inbound: 0,
        outbound: 0,
        device_id: r.device_id,
        device_name: deviceNameMap[r.device_id] || '',
      }
    }
    if (r.sender_name && !map[key].sender_name) map[key].sender_name = r.sender_name
    map[key].total++
    if (r.direction === 'inbound') map[key].inbound++
    else map[key].outbound++
  }

  return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 6)
}

// ─── Métricas de conversas (não lidas + não respondidas) ───────────────────────

export interface ContactMetrics {
  /** Pessoas distintas que escreveram no período. Grupo não conta. */
  pessoas: number
  /** Rajadas de mensagem que pediam resposta. */
  perguntas: number
  respondidas: number
  /** Mediana em segundos; `null` quando ninguém foi respondido no período. */
  medianaSegundos: number | null
}

/**
 * Pessoas atendidas e tempo de resposta, agregados no banco.
 *
 * Substitui a contagem de mensagens: dez mensagens tanto podem ser uma pessoa
 * escrevendo dez linhas quanto dez pessoas na fila, e o número não distinguia.
 */
export async function getContactMetrics(
  deviceIds: string[],
  from: Date,
  to: Date,
): Promise<ContactMetrics> {
  if (!deviceIds.length) return { pessoas: 0, perguntas: 0, respondidas: 0, medianaSegundos: null }

  const { data, error } = await supabase.rpc('get_dashboard_contact_metrics', {
    p_device_ids: deviceIds,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  })
  if (error) throw new Error(error.message)

  const linha = Array.isArray(data) ? data[0] : data
  return {
    pessoas: linha?.pessoas ?? 0,
    perguntas: linha?.perguntas ?? 0,
    respondidas: linha?.respondidas ?? 0,
    medianaSegundos: linha?.mediana_segundos ?? null,
  }
}

/**
 * Uma conversa que EU peguei e ainda não finalizei. Alimenta o card
 * "Chat não finalizado" e a lista que ele abre.
 */
export interface NaoFinalizado {
  device_id: string
  remote_sender: string
  sender_name: string | null
  /** Quando a conversa passou para as minhas mãos — é por isto que o filtro corta. */
  assigned_at: string
}

/**
 * Uma conversa com mensagens ainda não lidas.
 *
 * Os campos vinham de `PendingReply`, que saiu junto com o card de "não
 * respondidas" (04/09). Manter a herança obrigaria a preservar uma interface
 * sem dono só para esta estender; estão escritos aqui porque agora é o único
 * lugar que os usa.
 */
export interface UnreadConversation {
  device_id: string
  remote_sender: string
  sender_name: string | null
  last_message_content: string | null
  last_message_created_at: string
  unread_count: number
}

export interface ConversationMetrics {
  /** Soma de MENSAGENS não lidas — não é o número de conversas. */
  unread: number
  /**
   * Quantas CONVERSAS têm mensagem não lida. Existe separado de `unread` porque
   * o card abre uma lista de conversas: mostrar a soma de mensagens ao lado de
   * uma lista de conversas faria o número não bater com o que se vê.
   */
  unreadConversations: number
  /** Idem, para o card de não lidas. */
  unreadList: UnreadConversation[]
  /**
   * Conversas atribuídas a mim e ainda não finalizadas, SEM recorte de data —
   * de propósito. É o card "Contatos não finalizados", o total do que está na
   * minha mão; o card vizinho é a fatia do período. Se este também seguisse o
   * filtro, os dois mostrariam a mesma coisa e o "total" deixaria de existir.
   */
  myOpen: number
  /**
   * As que eu peguei DENTRO do período selecionado e ainda não finalizei.
   * Card "Chat não finalizado — {período}".
   */
  naoFinalizadosPeriodo: number
  /**
   * A lista por trás do número. Vem junto porque é a mesma varredura — pedir de
   * novo ao abrir o painel repetiria uma RPC por aparelho sem necessidade.
   */
  naoFinalizadosList: NaoFinalizado[]
}

const METRICAS_VAZIAS: ConversationMetrics = {
  unread: 0,
  unreadConversations: 0,
  unreadList: [],
  myOpen: 0,
  naoFinalizadosPeriodo: 0,
  naoFinalizadosList: [],
}

/**
 * `periodo` é OPCIONAL e recorta só o card "Chat não finalizado" — os de não
 * lidas e o total continuam sem data. Nasceu em 04/09: até então esta função
 * não recebia período nenhum e calculava um "hoje" interno, então o seletor
 * Hoje/Ontem/7 dias do painel não tinha efeito nenhum sobre estes cards.
 * Sem `periodo`, o card do período simplesmente não conta nada.
 */
export async function getConversationMetrics(
  deviceIds: string[],
  periodo?: { from: Date; to: Date },
): Promise<ConversationMetrics> {
  if (!deviceIds.length) return { ...METRICAS_VAZIAS }

  // `getMyStates()` saiu daqui em 04/09, junto com o card de "não respondidas":
  // ele existia só para montar o `statesMap`, usado no cruzamento de
  // `responded_at` individual com `global_responded_at`. Sem aquele card, era
  // uma consulta por carga do painel para não usar o resultado.
  const [allSummaries, assignmentsPorAparelho, userId] = await Promise.all([
    Promise.all(
      deviceIds.map(async (id) => {
        const summaries = await getConversationSummaries(id)
        return summaries.map((s) => ({ ...s, device_id: id }))
      })
    ).then((r) => r.flat()),
    Promise.all(
      deviceIds.map(async (id) => [id, await getDeviceAssignments(id)] as const),
    ),
    supabase.auth.getSession().then((r) => r.data.session?.user?.id ?? ''),
  ])

  // `getDeviceAssignments` já devolve chaveado por `aparelho|contato` (o mesmo
  // contato existe em várias instâncias e o atendimento é de cada uma), então aqui
  // é só juntar os mapas dos aparelhos.
  const assignmentsMap = new Map(
    assignmentsPorAparelho.flatMap(([, mapa]) => [...mapa.entries()]),
  )

  // Não lidas: sem recorte de data. O card se chama
  // "agora" justamente porque mensagem não lida de ontem continua não lida hoje —
  // aplicar o corte de hoje aqui esconderia conversa esquecida, que é o oposto do
  // que o card serve para mostrar.
  const naoLidas: UnreadConversation[] = allSummaries
    .filter((s) => (s.unread_count || 0) > 0)
    .sort(
      (a, b) =>
        new Date(b.last_message_created_at).getTime() -
        new Date(a.last_message_created_at).getTime(),
    )
    .map((s) => ({
      device_id: s.device_id,
      remote_sender: s.remote_sender,
      sender_name: s.sender_name ?? null,
      last_message_content: s.last_message_content ?? null,
      last_message_created_at: s.last_message_created_at,
      unread_count: s.unread_count || 0,
    }))

  // O que está na MINHA mão. `assignmentsMap` já foi montado acima — este bloco
  // não custa consulta nenhuma.
  //
  // 'open' fica de fora: é o estado inicial de toda conversa, sem dono. Só
  // 'taken' (peguei), 'assigned' (designaram para mim) e 'waiting' representam
  // atendimento em curso — e 'waiting' na prática nunca tem `assigned_to`, então
  // o filtro por dono logo acima já a descarta; fica na lista por clareza.
  //
  // O status é quem decide se está finalizada, NÃO `finished_at`: conversa
  // finalizada que recebe mensagem nova é reaberta pelo gatilho do banco e volta
  // para 'open' MANTENDO o `finished_at` antigo. Filtrar pela data daria número
  // errado.
  const emAberto = (status: string) =>
    status === 'taken' || status === 'assigned' || status === 'waiting'

  let myOpen = 0
  const naoFinalizados: NaoFinalizado[] = []
  if (userId) {
    for (const [chave, a] of assignmentsMap.entries()) {
      if (a.assigned_to !== userId || !emAberto(a.status)) continue
      myOpen++

      // A fatia do período corta por QUANDO PEGUEI (`assigned_at`), não por
      // quando a conversa teve atividade: o card responde "o que eu peguei
      // nesse dia e não fechei".
      if (!periodo || !a.assigned_at) continue
      const pegoEm = new Date(a.assigned_at)
      if (pegoEm < periodo.from || pegoEm > periodo.to) continue

      // `assignmentsMap` é chaveado por `aparelho|contato`; o resumo dá o nome.
      // Corta no PRIMEIRO `|` porque o aparelho é UUID (nunca tem `|`) e o lado
      // do contato pode ser qualquer JID — um `split` cru perderia o resto.
      const corte = chave.indexOf('|')
      const device_id = chave.slice(0, corte)
      const remote_sender = chave.slice(corte + 1)
      naoFinalizados.push({
        device_id,
        remote_sender,
        sender_name:
          allSummaries.find((s) => s.device_id === device_id && s.remote_sender === remote_sender)
            ?.sender_name ?? null,
        assigned_at: a.assigned_at,
      })
    }
  }

  // Mais recente primeiro: o que peguei por último é o que ainda está fresco.
  naoFinalizados.sort(
    (a, b) => new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime(),
  )

  return {
    unread: allSummaries.reduce((sum, s) => sum + (s.unread_count || 0), 0),
    unreadConversations: naoLidas.length,
    unreadList: naoLidas,
    myOpen,
    naoFinalizadosPeriodo: naoFinalizados.length,
    naoFinalizadosList: naoFinalizados,
  }
}
