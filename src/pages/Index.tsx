import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import {
  Smartphone,
  MessageSquareText,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Wifi,
  WifiOff,
  CalendarClock,
  StickyNote,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useNavigate, Link } from 'react-router-dom'
import { getDevices } from '@/services/devices'
import { getNotes } from '@/services/notes'
import { getScheduledMessages } from '@/services/scheduled_messages'
import {
  getDashboardStats,
  getChartData,
  getTopConversations,
  getConversationMetrics,
  type DashboardFilters,
  type PeriodStats,
  type ChartPoint,
  type ConversationActivity,
  type ConversationMetrics,
} from '@/services/dashboard'
import { useRealtime } from '@/hooks/use-realtime'
import { useAuth } from '@/hooks/use-auth'
import type { Note } from '@/lib/supabase/types'
import type { ScheduledMessageWithContact } from '@/services/scheduled_messages'

// ─── Period config ─────────────────────────────────────────────────────────────

type Period = 'today' | 'yesterday' | '7d' | '30d'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
]

function getDateRange(period: Period): { from: Date; to: Date } {
  const now = new Date()
  if (period === 'today') {
    const from = new Date(now); from.setHours(0, 0, 0, 0)
    const to = new Date(now); to.setHours(23, 59, 59, 999)
    return { from, to }
  }
  if (period === 'yesterday') {
    const from = new Date(now); from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0)
    const to = new Date(from); to.setHours(23, 59, 59, 999)
    return { from, to }
  }
  if (period === '7d') {
    const from = new Date(now); from.setDate(from.getDate() - 6); from.setHours(0, 0, 0, 0)
    const to = new Date(now); to.setHours(23, 59, 59, 999)
    return { from, to }
  }
  // 30d
  const from = new Date(now); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0)
  const to = new Date(now); to.setHours(23, 59, 59, 999)
  return { from, to }
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, accentBg, accentText, trend,
}: {
  label: string; value: number; sub?: string; icon: React.ReactNode
  accentBg: string; accentText: string
  trend?: 'up' | 'down' | 'neutral'
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor = trend === 'up' ? 'text-emerald-500' : trend === 'down' ? 'text-rose-500' : 'text-muted-foreground'
  return (
    <Card className="relative overflow-hidden border-border bg-card">
      <div className={`absolute top-0 left-0 w-1 h-full ${accentBg}`} />
      <CardContent className="pt-5 pb-4 pl-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
            <p className="text-3xl font-bold text-foreground tabular-nums">{value.toLocaleString('pt-BR')}</p>
            {sub && (
              <p className={`text-xs mt-1 flex items-center gap-1 ${trendColor}`}>
                {trend && <TrendIcon className="h-3 w-3" />}
                {sub}
              </p>
            )}
          </div>
          <div className={`p-2.5 rounded-xl ${accentBg} bg-opacity-10`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const entries = [
    { key: 'recebidas', label: 'Recebidas', color: '#3b82f6' },
    { key: 'enviadas_eu', label: 'Enviadas por mim', color: '#8b5cf6' },
    { key: 'enviadas', label: 'Enviadas total', color: '#a78bfa' },
  ]
  return (
    <div className="rounded-xl border border-border bg-popover p-3 shadow-xl text-xs min-w-[160px]">
      <p className="font-semibold text-foreground mb-2">{label}</p>
      {entries.map((e) => {
        const item = payload.find((p: any) => p.dataKey === e.key)
        if (!item) return null
        return (
          <div key={e.key} className="flex items-center justify-between gap-3 mb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.color }} />
              <span className="text-muted-foreground">{e.label}</span>
            </div>
            <span className="font-semibold text-foreground">{item.value}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Device dropdown ──────────────────────────────────────────────────────────

function DeviceSelect({
  devices, value, onChange,
}: {
  devices: any[]; value: string | null; onChange: (v: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = devices.find((d) => d.id === value)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 h-9 px-3 rounded-lg border text-sm transition-colors ${
          open ? 'border-primary/50 bg-accent' : 'border-border bg-card hover:bg-accent'
        }`}
      >
        <Smartphone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-foreground font-medium max-w-[140px] truncate">
          {selected ? selected.name : 'Todos os aparelhos'}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
            <button
              onClick={() => { onChange(null); setOpen(false) }}
              className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 hover:bg-accent transition-colors ${!value ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${!value ? 'bg-primary' : 'bg-transparent'}`} />
              Todos os aparelhos
            </button>
            <div className="h-px bg-border mx-2" />
            {devices.map((d) => {
              const isOnline = d.status === 'open' || d.status === 'connected'
              return (
                <button
                  key={d.id}
                  onClick={() => { onChange(d.id); setOpen(false) }}
                  className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 hover:bg-accent transition-colors ${value === d.id ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${value === d.id ? 'bg-primary' : 'bg-transparent'}`} />
                  <span className="flex-1 truncate">{d.name}</span>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Index() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [period, setPeriod] = useState<Period>('today')
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

  const [devices, setDevices] = useState<any[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [scheduled, setScheduled] = useState<ScheduledMessageWithContact[]>([])
  const [stats, setStats] = useState<PeriodStats>({ total: 0, inbound: 0, outbound: 0, sentByMe: 0, byDevice: {} })
  const [chart, setChart] = useState<ChartPoint[]>([])
  const [topConvos, setTopConvos] = useState<ConversationActivity[]>([])
  const [loadingStats, setLoadingStats] = useState(true)
  const [convMetrics, setConvMetrics] = useState<ConversationMetrics>({ unread: 0, pendingReplies: 0 })
  const [metricsRev, setMetricsRev] = useState(0)

  const deviceNameMap = useMemo(
    () => Object.fromEntries(devices.map((d) => [d.id, d.name])),
    [devices]
  )

  const buildFilters = useCallback((): DashboardFilters | null => {
    if (!user?.id) return null
    const { from, to } = getDateRange(period)
    return {
      userId: user.id,
      deviceIds: selectedDeviceId ? [selectedDeviceId] : undefined,
      from,
      to,
    }
  }, [user?.id, period, selectedDeviceId])

  // Load static data once
  useEffect(() => {
    Promise.all([
      getDevices(),
      getNotes(),
      getScheduledMessages().catch(() => []),
    ]).then(([devs, nts, sched]) => {
      setDevices(devs)
      setNotes(nts)
      setScheduled(sched as ScheduledMessageWithContact[])
    })
  }, [])

  // Load stats whenever filters change
  useEffect(() => {
    const f = buildFilters()
    if (!f) return
    setLoadingStats(true)
    Promise.all([
      getDashboardStats(f),
      getChartData(f),
    ]).then(([s, c]) => {
      setStats(s)
      setChart(c)
      setLoadingStats(false)
    })
  }, [buildFilters])

  // Load real unread + pending replies metrics
  useEffect(() => {
    const deviceIds = selectedDeviceId ? [selectedDeviceId] : devices.map((d) => d.id)
    if (!deviceIds.length) return
    getConversationMetrics(deviceIds).then(setConvMetrics)
  }, [devices, selectedDeviceId, metricsRev])

  // Load top conversations after devices are known
  useEffect(() => {
    const f = buildFilters()
    if (!f || !Object.keys(deviceNameMap).length) return
    getTopConversations(f, deviceNameMap).then(setTopConvos)
  }, [buildFilters, deviceNameMap])

  // Realtime — only update KPIs live when period = 'today'
  useRealtime('devices', (e) => {
    if (e.action === 'create') setDevices((p) => [...p, e.record])
    else if (e.action === 'update') setDevices((p) => p.map((d) => d.id === e.record.id ? e.record : d))
    else if (e.action === 'delete') setDevices((p) => p.filter((d) => d.id !== e.record.id))
  })

  useRealtime('notes', (e) => {
    if (e.action === 'create') setNotes((p) => [e.record as Note, ...p])
    else if (e.action === 'update') setNotes((p) => p.map((n) => n.id === e.record.id ? e.record as Note : n))
    else if (e.action === 'delete') setNotes((p) => p.filter((n) => n.id !== e.record.id))
  })

  useRealtime('conversation_user_states', () => setMetricsRev((v) => v + 1))

  useRealtime('messages', (e) => {
    if (e.action !== 'create' || period !== 'today') return
    if (selectedDeviceId && e.record.device_id !== selectedDeviceId) return

    const isInbound = e.record.direction === 'inbound'
    const isMine = e.record.sender_id === user?.id

    setStats((prev) => {
      const devPrev = prev.byDevice[e.record.device_id] || { inbound: 0, outbound: 0, sentByMe: 0 }
      return {
        ...prev,
        total: prev.total + 1,
        inbound: isInbound ? prev.inbound + 1 : prev.inbound,
        outbound: !isInbound ? prev.outbound + 1 : prev.outbound,
        sentByMe: isMine ? prev.sentByMe + 1 : prev.sentByMe,
        byDevice: {
          ...prev.byDevice,
          [e.record.device_id]: {
            inbound: devPrev.inbound + (isInbound ? 1 : 0),
            outbound: devPrev.outbound + (!isInbound ? 1 : 0),
            sentByMe: devPrev.sentByMe + (isMine ? 1 : 0),
          },
        },
      }
    })

    const h = new Date(e.record.created_at).getHours()
    const bucket = Math.floor(h / 2) * 2
    const label = `${String(bucket).padStart(2, '0')}h`
    setChart((prev) =>
      prev.map((row) =>
        row.label === label
          ? {
              ...row,
              recebidas: row.recebidas + (isInbound ? 1 : 0),
              enviadas: row.enviadas + (!isInbound ? 1 : 0),
              enviadas_eu: row.enviadas_eu + (isMine ? 1 : 0),
            }
          : row
      )
    )
  })

  // Derived
  const pendingScheduled = scheduled
    .filter((s) => s.status === 'pending')
    .filter((s) => !selectedDeviceId || s.device_id === selectedDeviceId)

  const recentNotes = notes.filter((n) => n.contact_jid).slice(0, 4)

  const visibleDevices = selectedDeviceId
    ? devices.filter((d) => d.id === selectedDeviceId)
    : devices

  const connectedCount = devices.filter((d) => d.status === 'open' || d.status === 'connected').length
  const now = new Date()
  const dateLabel = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  const periodLabel = PERIODS.find((p) => p.key === period)?.label.toLowerCase() || ''

  return (
    <div className="flex flex-col gap-5 pb-8">

      {/* ── Header + Filtros ── */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Visão Geral</h1>
          <p className="text-sm text-muted-foreground mt-0.5 capitalize">{dateLabel}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector */}
          <div className="flex items-center gap-0.5 p-1 rounded-lg bg-muted border border-border">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 h-7 rounded-md text-xs font-medium transition-all duration-150 ${
                  period === p.key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Device selector */}
          <DeviceSelect
            devices={devices}
            value={selectedDeviceId}
            onChange={setSelectedDeviceId}
          />

          {/* Live badge */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {connectedCount}/{devices.length} online
          </div>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label={`Mensagens — ${periodLabel}`}
          value={stats.total}
          sub={loadingStats ? 'carregando...' : `${stats.inbound} recebidas · ${stats.outbound} enviadas`}
          icon={<MessageSquareText className="h-5 w-5 text-blue-500" />}
          accentBg="bg-blue-500"
          accentText="text-blue-500"
          trend="neutral"
        />
        <KpiCard
          label={`Recebidas — ${periodLabel}`}
          value={stats.inbound}
          sub={selectedDeviceId ? 'neste aparelho' : `de ${connectedCount} aparelhos`}
          icon={<ArrowDownLeft className="h-5 w-5 text-emerald-500" />}
          accentBg="bg-emerald-500"
          accentText="text-emerald-500"
          trend={stats.inbound > 0 ? 'up' : 'neutral'}
        />
        <KpiCard
          label={`Enviadas por mim — ${periodLabel}`}
          value={stats.sentByMe}
          sub={`${stats.outbound} enviadas no total pela equipe`}
          icon={<ArrowUpRight className="h-5 w-5 text-violet-500" />}
          accentBg="bg-violet-500"
          accentText="text-violet-500"
          trend="neutral"
        />
        <KpiCard
          label="Não lidas agora"
          value={convMetrics.unread}
          sub={convMetrics.unread === 0 ? 'Tudo em dia' : 'conversas com mensagens novas'}
          icon={<Bell className="h-5 w-5 text-amber-500" />}
          accentBg="bg-amber-500"
          accentText="text-amber-500"
          trend={convMetrics.unread === 0 ? 'up' : convMetrics.unread > 20 ? 'down' : 'neutral'}
        />
        <KpiCard
          label="Não respondidas"
          value={convMetrics.pendingReplies}
          sub={convMetrics.pendingReplies === 0 ? 'Todas respondidas' : 'aguardando resposta'}
          icon={<Clock className="h-5 w-5 text-rose-500" />}
          accentBg="bg-rose-500"
          accentText="text-rose-500"
          trend={convMetrics.pendingReplies === 0 ? 'up' : convMetrics.pendingReplies > 10 ? 'down' : 'neutral'}
        />
      </div>

      {/* ── Chart + Devices ── */}
      <div className="grid gap-4 md:grid-cols-7">
        <Card className="md:col-span-5 border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm font-semibold text-foreground">
                Tráfego — {periodLabel}
                {selectedDeviceId && devices.find((d) => d.id === selectedDeviceId) &&
                  ` · ${devices.find((d) => d.id === selectedDeviceId)?.name}`}
              </CardTitle>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Recebidas
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-violet-500" /> Enviadas por mim
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-violet-300/60" /> Total equipe
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[240px] w-full -ml-2">
              {loadingStats ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-xs text-muted-foreground">Carregando...</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart} margin={{ top: 6, right: 4, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradOutAll" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      dy={8}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="enviadas" stroke="#a78bfa" strokeWidth={1.5}
                      strokeDasharray="4 3" fill="url(#gradOutAll)" dot={false} />
                    <Area type="monotone" dataKey="enviadas_eu" stroke="#8b5cf6" strokeWidth={2}
                      fill="url(#gradOut)" dot={false} />
                    <Area type="monotone" dataKey="recebidas" stroke="#3b82f6" strokeWidth={2}
                      fill="url(#gradIn)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Devices panel */}
        <Card className="md:col-span-2 border-border flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground">Aparelhos</CardTitle>
              <Link to="/settings/devices" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Gerenciar
              </Link>
            </div>
          </CardHeader>
          <CardContent className="flex-1 pt-0 overflow-y-auto">
            {visibleDevices.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">Nenhum aparelho</p>
            )}
            <div className="space-y-1">
              {visibleDevices.map((device) => {
                const isOnline = device.status === 'open' || device.status === 'connected'
                const devS = stats.byDevice[device.id] || { inbound: 0, outbound: 0, sentByMe: 0 }
                const devTotal = devS.inbound + devS.outbound
                return (
                  <button
                    key={device.id}
                    onClick={() => navigate(`/chat?device=${device.id}`)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent transition-colors text-left"
                  >
                    <div className="relative flex-shrink-0">
                      {device.avatar_url ? (
                        <img src={device.avatar_url} alt={device.name}
                          className="w-8 h-8 rounded-full object-cover border border-border" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Smartphone className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{device.name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        {isOnline ? <Wifi className="h-2.5 w-2.5 text-emerald-500" /> : <WifiOff className="h-2.5 w-2.5 text-slate-400" />}
                        <span className="text-[10px] text-muted-foreground">
                          {isOnline ? `${devTotal} msg — ${periodLabel}` : 'Offline'}
                        </span>
                      </div>
                    </div>
                    {(device.unread_count || 0) > 0 && (
                      <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-amber-950 text-[10px] font-bold flex items-center justify-center">
                        {device.unread_count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Bottom row ── */}
      <div className="grid gap-4 md:grid-cols-7">
        {/* Top conversations */}
        <Card className="md:col-span-4 border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground">
                Conversas mais ativas — {periodLabel}
              </CardTitle>
              <Link to="/chat" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                Chat <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingStats ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : topConvos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <MessageSquareText className="h-8 w-8 opacity-20" />
                <p className="text-xs">Nenhuma mensagem {periodLabel === 'hoje' ? 'ainda hoje' : `no período`}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {topConvos.map((conv, i) => {
                  const pct = topConvos[0]?.total > 0 ? Math.round((conv.total / topConvos[0].total) * 100) : 0
                  const name = conv.sender_name || conv.remote_sender.split('@')[0] || conv.remote_sender
                  return (
                    <button
                      key={`${conv.device_id}|${conv.remote_sender}`}
                      onClick={() => navigate(`/chat?device=${conv.device_id}`)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent transition-colors text-left"
                    >
                      <span className="w-5 text-xs font-semibold text-muted-foreground text-right flex-shrink-0">
                        #{i + 1}
                      </span>
                      <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-foreground flex-shrink-0">
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-medium text-foreground truncate">{name}</p>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <span className="text-[10px] text-muted-foreground">{conv.inbound}↓ {conv.outbound}↑</span>
                            <span className="text-[10px] font-semibold text-foreground">{conv.total}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          {!selectedDeviceId && conv.device_name && (
                            <span className="text-[10px] text-muted-foreground flex-shrink-0 max-w-[80px] truncate">
                              {conv.device_name}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="md:col-span-3 flex flex-col gap-4">
          {/* Volume by device */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-foreground">Volume por aparelho</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {visibleDevices.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">Sem dados</p>
              ) : (
                <div className="space-y-2.5">
                  {visibleDevices
                    .map((d) => {
                      const s = stats.byDevice[d.id] || { inbound: 0, outbound: 0, sentByMe: 0 }
                      return { ...d, total: s.inbound + s.outbound, ...s }
                    })
                    .sort((a, b) => b.total - a.total)
                    .map((d) => {
                      const maxTotal = Math.max(...visibleDevices.map((dev) => {
                        const s = stats.byDevice[dev.id] || { inbound: 0, outbound: 0, sentByMe: 0 }
                        return s.inbound + s.outbound
                      }), 1)
                      const pct = Math.round((d.total / maxTotal) * 100)
                      return (
                        <div key={d.id} className="flex items-center gap-2">
                          <p className="text-[11px] text-muted-foreground w-24 truncate flex-shrink-0">{d.name}</p>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500/70 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[11px] font-semibold text-foreground w-8 text-right flex-shrink-0">{d.total}</span>
                        </div>
                      )
                    })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending scheduled */}
          <Card className="border-border flex-1">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  Agendamentos pendentes
                </CardTitle>
                <Link to="/scheduled-messages" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                  Ver <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {pendingScheduled.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum pendente</p>
              ) : (
                <div className="space-y-1.5">
                  {pendingScheduled.slice(0, 4).map((msg) => {
                    const when = new Date(msg.scheduled_at)
                    const isToday = when.toDateString() === new Date().toDateString()
                    return (
                      <div key={msg.id} className="flex items-start gap-2.5 px-2 py-2 rounded-lg border border-border bg-muted/20">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {msg.contact_name || msg.remote_sender.split('@')[0]}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">{msg.content}</p>
                        </div>
                        <span className={`text-[10px] flex-shrink-0 font-medium ${isToday ? 'text-amber-500' : 'text-muted-foreground'}`}>
                          {when.toLocaleDateString('pt-BR', {
                            day: '2-digit', month: '2-digit',
                            ...(isToday ? { hour: '2-digit', minute: '2-digit' } : {}),
                          })}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Contact Notes ── */}
      {recentNotes.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-muted-foreground" />
                Anotações de contatos
              </CardTitle>
              <Link to="/notes" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                Ver todas <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {recentNotes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => navigate('/notes')}
                  className="p-3 rounded-lg border border-border bg-muted/20 hover:bg-accent cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-foreground">
                      {(note.contact_name || note.title).charAt(0).toUpperCase()}
                    </div>
                    <p className="text-xs font-medium text-foreground truncate flex-1">
                      {note.contact_name || note.title}
                    </p>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                      note.category === 'financeiro' ? 'bg-emerald-500/15 text-emerald-500' :
                      note.category === 'rh' ? 'bg-blue-500/15 text-blue-500' :
                      note.category === 'administrativo' ? 'bg-amber-500/15 text-amber-500' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {note.category === 'financeiro' ? 'Fin' : note.category === 'rh' ? 'RH' : note.category === 'administrativo' ? 'Adm' : 'Ger'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{note.content}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
