import supabase from '@/lib/supabase/client'
import { getConversationSummaries } from '@/services/messages'
import { getMyStates } from '@/services/conversation_states'

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

export interface ConversationMetrics {
  unread: number
  pendingReplies: number
}

export async function getConversationMetrics(deviceIds: string[]): Promise<ConversationMetrics> {
  if (!deviceIds.length) return { unread: 0, pendingReplies: 0 }

  const [allSummaries, states] = await Promise.all([
    Promise.all(
      deviceIds.map(async (id) => {
        const summaries = await getConversationSummaries(id)
        return summaries.map((s) => ({ ...s, device_id: id }))
      })
    ).then((r) => r.flat()),
    getMyStates(),
  ])

  const statesMap = new Map(states.map((s) => [`${s.device_id}|${s.remote_sender}`, s]))

  return {
    unread: allSummaries.reduce((sum, s) => sum + (s.unread_count || 0), 0),
    pendingReplies: allSummaries.filter((s) => {
      if (s.last_message_direction !== 'inbound') return false
      const state = statesMap.get(`${s.device_id}|${s.remote_sender}`)
      if (!state?.responded_at) return true
      return new Date(s.last_message_created_at) > new Date(state.responded_at)
    }).length,
  }
}
