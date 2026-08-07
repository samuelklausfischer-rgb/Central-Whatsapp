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
  ArrowUpRight,
  Users,
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
  ListTodo,
  AlertTriangle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useNavigate, Link } from 'react-router-dom'
import { getDevices } from '@/services/devices'
import { getNotes } from '@/services/notes'
import { getTasks, type TaskWithRelations } from '@/services/tasks'
import { getScheduledMessages } from '@/services/scheduled_messages'
import {
  getDashboardStats,
  getChartData,
  getTopConversations,
  getConversationMetrics,
  getContactMetrics,
  type ContactMetrics,
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
  label, value, valueText, sub, icon, accentBg, accentText, trend, onClick,
}: {
  label: string; value: number; sub?: string; icon: React.ReactNode
  accentBg: string; accentText: string
  trend?: 'up' | 'down' | 'neutral'
  /** Texto no lugar do número — para valores que não são contagem, como duração. */
  valueText?: string
  /** Quando presente, o card vira botão — usado por "Não respondidas hoje". */
  onClick?: () => void
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor = trend === 'up' ? 'text-emerald-500' : trend === 'down' ? 'text-rose-500' : 'text-muted-foreground'
  return (
    <Card
      className={`relative overflow-hidden border-border bg-card ${onClick ? 'cursor-pointer hover:bg-accent/40 transition-colors' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <div className={`absolute top-0 left-0 w-1 h-full ${accentBg}`} />
      <CardContent className="pt-5 pb-4 pl-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
            <p className="text-3xl font-bold text-foreground tabular-nums">
              {valueText ?? value.toLocaleString('pt-BR')}
            </p>
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

/**
 * Duração curta e legível. Em minutos e segundos até uma hora, porque é essa a
 * ordem de grandeza real do atendimento (a mediana medida em produção é de
 * pouco mais de quatro minutos) — mostrar "0,07 h" esconderia a informação.
 */
function formatarDuracao(segundos: number | null): string {
  if (segundos === null || Number.isNaN(segundos)) return '—'
  if (segundos < 60) return `${Math.round(segundos)}s`
  if (segundos < 3600) {
    const m = Math.floor(segundos / 60)
    const s = Math.round(segundos % 60)
    return s ? `${m}min ${s}s` : `${m}min`
  }
  const h = Math.floor(segundos / 3600)
  const m = Math.round((segundos % 3600) / 60)
  return m ? `${h}h ${m}min` : `${h}h`
}

// ─── Estado dos painéis de trabalho ───────────────────────────────────────────

/**
 * Carregando, erro e vazio são TRÊS coisas diferentes e cada uma tem a sua
 * mensagem. O Dashboard antigo tratava as três como vazio, então uma queda de
 * rede virava "nada pendente" — a leitura oposta à realidade, justamente num
 * painel cuja função é avisar do que falta fazer.
 */
function EstadoPainel({
  carregando, erro, vazio, mensagemVazio, aoTentarDeNovo,
}: {
  carregando: boolean; erro: boolean; vazio: boolean
  mensagemVazio: string; aoTentarDeNovo?: () => void
}) {
  if (carregando) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 rounded-lg bg-muted/40 animate-pulse" />
        ))}
      </div>
    )
  }
  if (erro) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center gap-2">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p className="text-xs text-muted-foreground">Não deu para carregar agora.</p>
        {aoTentarDeNovo && (
          <button
            onClick={aoTentarDeNovo}
            className="text-xs font-medium text-foreground underline underline-offset-2 hover:opacity-80"
          >
            Tentar de novo
          </button>
        )}
      </div>
    )
  }
  if (vazio) {
    return <p className="text-xs text-muted-foreground text-center py-6">{mensagemVazio}</p>
  }
  return null
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
  const [tasks, setTasks] = useState<TaskWithRelations[]>([])
  const [scheduled, setScheduled] = useState<ScheduledMessageWithContact[]>([])

  // Erro e carregamento SEPARADOS de "lista vazia". O Dashboard engolia toda
  // falha com `.catch(() => [])`, e um card vazio por queda de rede se lê como
  // "não tenho nada pendente" — a mensagem exatamente oposta à verdade.
  const [trabalhoCarregando, setTrabalhoCarregando] = useState(true)
  const [erroTarefas, setErroTarefas] = useState(false)
  const [erroNotas, setErroNotas] = useState(false)
  const [stats, setStats] = useState<PeriodStats>({ total: 0, inbound: 0, outbound: 0, sentByMe: 0, byDevice: {} })
  const [chart, setChart] = useState<ChartPoint[]>([])
  const [topConvos, setTopConvos] = useState<ConversationActivity[]>([])
  const [loadingStats, setLoadingStats] = useState(true)
  const [convMetrics, setConvMetrics] = useState<ConversationMetrics>({ unread: 0, pendingReplies: 0, pendingList: [] })
  const [painelPendentes, setPainelPendentes] = useState(false)
  const [contatos, setContatos] = useState<ContactMetrics>({ pessoas: 0, perguntas: 0, respondidas: 0, medianaSegundos: null })
  const [carregandoContatos, setCarregandoContatos] = useState(true)
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
    setTrabalhoCarregando(true)
    // `allSettled` e não `all`: tarefas e anotações são painéis independentes —
    // uma falhar não pode apagar a outra da tela.
    Promise.allSettled([
      getDevices(),
      getNotes(),
      getScheduledMessages(),
      getTasks(),
    ]).then(([devs, nts, sched, tks]) => {
      if (devs.status === 'fulfilled') setDevices(devs.value)

      setErroNotas(nts.status === 'rejected')
      if (nts.status === 'fulfilled') setNotes(nts.value)

      if (sched.status === 'fulfilled') setScheduled(sched.value as ScheduledMessageWithContact[])

      setErroTarefas(tks.status === 'rejected')
      if (tks.status === 'fulfilled') setTasks(tks.value)

      setTrabalhoCarregando(false)
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

  // Pessoas atendidas e tempo de resposta — uma RPC agregada, em vez de baixar
  // o período inteiro de mensagens para somar aqui.
  useEffect(() => {
    const deviceIds = selectedDeviceId ? [selectedDeviceId] : devices.map((d) => d.id)
    if (!deviceIds.length) return
    const { from, to } = getDateRange(period)
    setCarregandoContatos(true)
    getContactMetrics(deviceIds, from, to)
      .then(setContatos)
      .catch(() => setContatos({ pessoas: 0, perguntas: 0, respondidas: 0, medianaSegundos: null }))
      .finally(() => setCarregandoContatos(false))
  }, [devices, selectedDeviceId, period])

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

  // Tarefa muda de dono/status em outra tela (ou outra pessoa direciona uma para
  // mim) — o card precisa refletir sem F5. Recarrega a lista inteira: `tasks`
  // traz responsável/criador/contato juntos, e remontar isso a partir do payload
  // cru do Realtime daria uma linha pela metade.
  useRealtime('tasks', () => {
    getTasks()
      .then((t) => { setTasks(t); setErroTarefas(false) })
      .catch(() => setErroTarefas(true))
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

  // SEM filtro de `contact_jid`: anotação solta, sem contato vinculado, nunca
  // aparecia no Dashboard — e é justamente onde ficam os lembretes gerais.
  const recentNotes = notes.slice(0, 4)

  /** O que está na minha mão: atribuídas a mim e ainda não concluídas. */
  const minhasTarefas = useMemo(() => {
    if (!user?.id) return []
    return tasks
      .filter((t) => t.assigned_to === user.id && t.status !== 'completed')
      .sort((a, b) => {
        // Sem prazo vai para o fim: quem tem data marcada é que corre risco.
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date)
      })
  }, [tasks, user?.id])

  // Comparação por string `YYYY-MM-DD`. Passar por `new Date()` num campo `date`
  // puro traz o fuso junto e faz a tarefa de hoje aparecer como atrasada.
  const hojeISO = new Date().toLocaleDateString('sv-SE')
  const tarefasAtrasadas = minhasTarefas.filter((t) => t.due_date && t.due_date < hojeISO).length

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
        {/*
          Pessoa, não mensagem. Contagem de mensagem não distinguia uma pessoa
          mandando dez linhas de dez pessoas esperando atendimento — era o número
          grande que não respondia a pergunta que importa.
        */}
        <KpiCard
          label={`Pessoas atendidas — ${periodLabel}`}
          value={contatos.pessoas}
          sub={
            carregandoContatos
              ? 'carregando...'
              : selectedDeviceId ? 'neste aparelho' : `em ${connectedCount} aparelhos`
          }
          icon={<Users className="h-5 w-5 text-blue-500" />}
          accentBg="bg-blue-500"
          accentText="text-blue-500"
          trend="neutral"
        />
        <KpiCard
          label={`Tempo de resposta — ${periodLabel}`}
          value={0}
          valueText={carregandoContatos ? '—' : formatarDuracao(contatos.medianaSegundos)}
          // Mediana, não média: medido em produção, a média dá ~3h47 contra 4min
          // de mediana. Meia dúzia de conversas esquecidas de madrugada desloca a
          // média inteira e faz o número parar de descrever o atendimento.
          sub="mediana até a primeira resposta"
          icon={<Clock className="h-5 w-5 text-emerald-500" />}
          accentBg="bg-emerald-500"
          accentText="text-emerald-500"
          trend="neutral"
        />
        <KpiCard
          label={`Taxa de resposta — ${periodLabel}`}
          value={0}
          valueText={
            carregandoContatos || contatos.perguntas === 0
              ? '—'
              : `${Math.round((contatos.respondidas / contatos.perguntas) * 100)}%`
          }
          sub={
            contatos.perguntas === 0
              ? 'ninguém procurou no período'
              : `${contatos.respondidas} de ${contatos.perguntas} conversas`
          }
          icon={<ArrowUpRight className="h-5 w-5 text-violet-500" />}
          accentBg="bg-violet-500"
          accentText="text-violet-500"
          trend={
            contatos.perguntas === 0
              ? 'neutral'
              : contatos.respondidas / contatos.perguntas >= 0.9 ? 'up' : 'down'
          }
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
          label="Não respondidas hoje"
          value={convMetrics.pendingReplies}
          sub={convMetrics.pendingReplies === 0 ? 'Todas respondidas' : 'clique para ver quem'}
          icon={<Clock className="h-5 w-5 text-rose-500" />}
          accentBg="bg-rose-500"
          accentText="text-rose-500"
          trend={convMetrics.pendingReplies === 0 ? 'up' : convMetrics.pendingReplies > 10 ? 'down' : 'neutral'}
          onClick={convMetrics.pendingReplies > 0 ? () => setPainelPendentes(true) : undefined}
        />
      </div>

      {/*
        ── O que está na minha mão ──
        Fica logo abaixo dos KPIs, na primeira dobra. Antes, tarefa não aparecia
        no Dashboard em lugar nenhum e anotação só aparecia lá no fim da página,
        e ainda assim só se tivesse contato vinculado.
      */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-muted-foreground" />
                Minhas tarefas
                {tarefasAtrasadas > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-500">
                    {tarefasAtrasadas} atrasada{tarefasAtrasadas > 1 ? 's' : ''}
                  </span>
                )}
              </CardTitle>
              <Link to="/crm" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                Ver todas <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <EstadoPainel
              carregando={trabalhoCarregando}
              erro={erroTarefas}
              vazio={minhasTarefas.length === 0}
              mensagemVazio="Nenhuma tarefa aberta para você."
              aoTentarDeNovo={() => {
                setErroTarefas(false)
                getTasks().then(setTasks).catch(() => setErroTarefas(true))
              }}
            />
            {!trabalhoCarregando && !erroTarefas && minhasTarefas.length > 0 && (
              <div className="space-y-2">
                {minhasTarefas.slice(0, 4).map((t) => {
                  const atrasada = !!t.due_date && t.due_date < hojeISO
                  return (
                    <div
                      key={t.id}
                      onClick={() => navigate('/crm')}
                      className="p-2.5 rounded-lg border border-border bg-muted/20 hover:bg-accent cursor-pointer transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-foreground line-clamp-1 flex-1">{t.title}</p>
                        {t.due_date && (
                          <span className={`text-[10px] font-medium flex-shrink-0 ${atrasada ? 'text-rose-500' : 'text-muted-foreground'}`}>
                            {t.due_date.split('-').reverse().slice(0, 2).join('/')}
                          </span>
                        )}
                      </div>
                      {t.contact?.name && (
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{t.contact.name}</p>
                      )}
                    </div>
                  )
                })}
                {minhasTarefas.length > 4 && (
                  <p className="text-[11px] text-muted-foreground text-center pt-0.5">
                    e mais {minhasTarefas.length - 4}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-muted-foreground" />
                Anotações
              </CardTitle>
              <Link to="/notes" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                Ver todas <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <EstadoPainel
              carregando={trabalhoCarregando}
              erro={erroNotas}
              vazio={recentNotes.length === 0}
              mensagemVazio="Nenhuma anotação ainda."
              aoTentarDeNovo={() => {
                setErroNotas(false)
                getNotes().then(setNotes).catch(() => setErroNotas(true))
              }}
            />
            {!trabalhoCarregando && !erroNotas && recentNotes.length > 0 && (
              <div className="space-y-2">
                {recentNotes.map((note) => (
                  <div
                    key={note.id}
                    onClick={() => navigate('/notes')}
                    className="p-2.5 rounded-lg border border-border bg-muted/20 hover:bg-accent cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2">
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
                    <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{note.content}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
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

      {/*
        Quem está esperando resposta hoje. O número sozinho dizia que havia fila,
        mas não quem estava nela — e chegar até a pessoa exigia procurar na mão,
        conversa por conversa.
      */}
      <Dialog open={painelPendentes} onOpenChange={setPainelPendentes}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Aguardando resposta hoje</DialogTitle>
            <DialogDescription>
              {convMetrics.pendingReplies === 1
                ? '1 pessoa escreveu hoje e ainda não teve resposta.'
                : `${convMetrics.pendingReplies} pessoas escreveram hoje e ainda não tiveram resposta.`}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto space-y-1.5 -mx-1 px-1">
            {convMetrics.pendingList.map((p) => (
              <button
                key={`${p.device_id}:${p.remote_sender}`}
                onClick={() => {
                  // `device` junto do `jid`: sem ele o chat abriria a conversa no
                  // aparelho que estivesse selecionado, que pode não ser o desta
                  // mensagem.
                  navigate(`/chat?device=${p.device_id}&jid=${encodeURIComponent(p.remote_sender)}`)
                }}
                className="w-full text-left p-2.5 rounded-lg border border-border bg-muted/20 hover:bg-accent transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {p.sender_name || p.remote_sender}
                  </p>
                  <span className="text-[11px] text-muted-foreground flex-shrink-0 tabular-nums">
                    {new Date(p.last_message_created_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className="text-xs text-muted-foreground truncate flex-1">
                    {p.last_message_content || 'sem prévia'}
                  </p>
                  <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">
                    {deviceNameMap[p.device_id] ?? ''}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
