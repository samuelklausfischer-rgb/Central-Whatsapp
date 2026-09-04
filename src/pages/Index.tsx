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
  Inbox,
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
} from 'lucide-react'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { EstadoPainel } from '@/components/ui/estado-painel'
import { ACENTOS } from '@/components/ui/stat-block'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useNavigate, Link } from 'react-router-dom'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
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

// `ACENTOS` mora em `@/components/ui/stat-block` — mesmo mapa reaproveitado
// pelo `StatBlock` (números agrupados em outras telas). Ver o comentário lá
// para o porquê do formato (ícone + bloom por nome de cor).

function KpiCard({
  label, value, valueText, sub, icon, acento, trend, onClick,
}: {
  label: string; value: number; sub?: string; icon: React.ReactNode
  acento: keyof typeof ACENTOS
  trend?: 'up' | 'down' | 'neutral'
  /** Texto no lugar do número — para valores que não são contagem, como duração. */
  valueText?: string
  /** Quando presente, o card vira botão — usado por "Não respondidas hoje". */
  onClick?: () => void
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor = trend === 'up' ? 'text-emerald-500' : trend === 'down' ? 'text-rose-500' : 'text-muted-foreground'
  const { icone, bloom } = ACENTOS[acento]
  return (
    <GlassCard
      className={`relative overflow-hidden ${onClick ? 'cursor-pointer hover:bg-foreground/5 transition-colors' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      {/* Bloom radial no canto superior direito — no lugar da barra colorida e
          do chip de ícone antigos, que eram justamente o par datado que o
          usuário apontou. `pointer-events-none` porque é decoração pura, não
          pode roubar o clique do card quando ele é um botão. */}
      <div
        className="absolute -top-8 -right-8 h-28 w-28 rounded-full pointer-events-none"
        style={{ background: bloom }}
        aria-hidden="true"
      />
      <CardContent className="relative pt-5 pb-4 pl-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
            <p className="text-3xl font-semibold text-foreground tracking-tight tabular-nums">
              {valueText ?? value.toLocaleString('pt-BR')}
            </p>
            {sub && (
              <p className={`text-xs mt-1 flex items-center gap-1 ${trendColor}`}>
                {trend && <TrendIcon className="h-3 w-3" />}
                {sub}
              </p>
            )}
          </div>
          {/* Ícone solto sobre o bloom, sem caixa por baixo — a cor vem do
              mesmo mapa que define o bloom, então basta trocar `acento`. */}
          <div className={icone}>{icon}</div>
        </div>
      </CardContent>
    </GlassCard>
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
  const [convMetrics, setConvMetrics] = useState<ConversationMetrics>({
    unread: 0,
    unreadConversations: 0,
    unreadList: [],
    myOpen: 0,
    naoFinalizadosPeriodo: 0,
    naoFinalizadosList: [],
  })
  const [painelNaoFinalizados, setPainelNaoFinalizados] = useState(false)
  const [painelNaoLidas, setPainelNaoLidas] = useState(false)
  const [contatos, setContatos] = useState<ContactMetrics>({ pessoas: 0, perguntas: 0, respondidas: 0, medianaSegundos: null })
  const [carregandoContatos, setCarregandoContatos] = useState(true)
  const [metricsRev, setMetricsRev] = useState(0)

  const deviceNameMap = useMemo(
    () => Object.fromEntries(devices.map((d) => [d.id, d.name])),
    [devices]
  )

  // Mesmo padrão do `deviceNameMap` acima — aqui para alimentar o `SmartAvatar`
  // de contato no card "Conversas mais ativas", que precisa da instância dona
  // da conversa para saber onde buscar/atualizar a foto.
  const deviceInstanceMap = useMemo(
    () => Object.fromEntries(devices.map((d) => [d.id, d.instance_key])),
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

  // Não lidas + o que está na minha mão.
  //
  // O período entrou aqui em 04/09: o cartão "Chat não finalizado" conta o que
  // FOI PEGO na janela escolhida, então precisa refazer a busca a cada troca do
  // seletor — daí `period` nas dependências. As outras métricas do mesmo
  // retorno (não lidas, total em aberto) ignoram a janela de propósito.
  useEffect(() => {
    const deviceIds = selectedDeviceId ? [selectedDeviceId] : devices.map((d) => d.id)
    if (!deviceIds.length) return
    getConversationMetrics(deviceIds, getDateRange(period)).then(setConvMetrics)
  }, [devices, selectedDeviceId, metricsRev, period])

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

  /**
   * Linhas do card "Volume por aparelho" já ordenadas, com o maior total do
   * conjunto calculado UMA vez. A versão anterior recalculava esse máximo
   * dentro do `.map()` de cada linha — um `Math.max` percorrendo todos os
   * aparelhos, repetido para cada aparelho, sem necessidade nenhuma porque o
   * maior total não muda entre linhas do mesmo card.
   */
  const volumePorAparelho = useMemo(() => {
    const linhas = visibleDevices
      .map((d) => {
        const s = stats.byDevice[d.id] || { inbound: 0, outbound: 0, sentByMe: 0 }
        return { ...d, inbound: s.inbound, outbound: s.outbound, total: s.inbound + s.outbound }
      })
      .sort((a, b) => b.total - a.total)
    const maxTotal = Math.max(...linhas.map((l) => l.total), 1)
    return { linhas, maxTotal }
  }, [visibleDevices, stats])

  const connectedCount = devices.filter((d) => d.status === 'open' || d.status === 'connected').length
  const now = new Date()
  const dateLabel = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  const periodLabel = PERIODS.find((p) => p.key === period)?.label.toLowerCase() || ''
  // O rótulo do seletor cabe em título ("— 30 dias"), mas não dentro de uma
  // frase: "que você pegou 30 dias" fica errado. "hoje" e "ontem" já são
  // advérbios e entram crus; as janelas de dias ganham a preposição.
  const periodoNaFrase =
    period === 'today' || period === 'yesterday' ? periodLabel : `nos últimos ${periodLabel}`

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
          icon={<Users className="h-5 w-5" />}
          acento="azul"
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
          icon={<Clock className="h-5 w-5" />}
          acento="esmeralda"
          trend="neutral"
        />
        {/*
          O contraponto do cartão de "chat não finalizado": aqui é a fila
          inteira, sem recorte de data. A legenda diz isso em voz alta porque os
          dois ficam lado a lado e, sem o aviso, o número maior pareceria erro do
          filtro.
        */}
        <KpiCard
          label="Contatos não finalizados"
          value={convMetrics.myOpen}
          sub={convMetrics.myOpen === 0 ? 'nada na sua mão' : 'total, sem filtro de período'}
          icon={<Inbox className="h-5 w-5" />}
          acento="violeta"
          trend={convMetrics.myOpen === 0 ? 'up' : convMetrics.myOpen > 10 ? 'down' : 'neutral'}
        />
        <KpiCard
          label="Não lidas agora"
          value={convMetrics.unreadConversations}
          sub={convMetrics.unreadConversations === 0 ? 'Tudo em dia' : 'clique para ver quem'}
          icon={<Bell className="h-5 w-5" />}
          acento="ambar"
          trend={convMetrics.unreadConversations === 0 ? 'up' : convMetrics.unreadConversations > 20 ? 'down' : 'neutral'}
          onClick={convMetrics.unreadConversations > 0 ? () => setPainelNaoLidas(true) : undefined}
        />
        {/*
          O rótulo segue o seletor (`periodLabel`) em vez de dizer "hoje" fixo:
          com o filtro em "ontem" o título mentiria, já que o número passa a ser
          o do dia anterior.
        */}
        <KpiCard
          label={`Chat não finalizado — ${periodLabel}`}
          value={convMetrics.naoFinalizadosPeriodo}
          sub={
            convMetrics.naoFinalizadosPeriodo === 0
              ? 'nada em aberto no período'
              : 'clique para ver quem'
          }
          icon={<Clock className="h-5 w-5" />}
          acento="rosa"
          trend={
            convMetrics.naoFinalizadosPeriodo === 0
              ? 'up'
              : convMetrics.naoFinalizadosPeriodo > 10
                ? 'down'
                : 'neutral'
          }
          onClick={
            convMetrics.naoFinalizadosPeriodo > 0 ? () => setPainelNaoFinalizados(true) : undefined
          }
        />
      </div>

      {/*
        ── O que está na minha mão ──
        Fica logo abaixo dos KPIs, na primeira dobra. Antes, tarefa não aparecia
        no Dashboard em lugar nenhum e anotação só aparecia lá no fim da página,
        e ainda assim só se tivesse contato vinculado.
      */}
      <div className="grid gap-4 md:grid-cols-2">
        <GlassCard>
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
              <div className="space-y-0.5">
                {minhasTarefas.slice(0, 4).map((t) => {
                  const atrasada = !!t.due_date && t.due_date < hojeISO
                  const venceHoje = !!t.due_date && t.due_date === hojeISO
                  // Ponto de status substitui a borda: rosa = atrasada, âmbar =
                  // vence hoje, ardósia = futura ou sem prazo. Não vira checkbox
                  // de propósito — clicar navega para o CRM, e um checkbox aqui
                  // sugeriria "concluir" sem passar por lá (controle inerte).
                  const corPonto = atrasada ? 'bg-rose-500' : venceHoje ? 'bg-amber-500' : 'bg-slate-400'
                  const corPill = atrasada
                    ? 'bg-rose-500/15 text-rose-500'
                    : venceHoje
                      ? 'bg-amber-500/15 text-amber-500'
                      : 'bg-muted text-muted-foreground'
                  return (
                    <div
                      key={t.id}
                      onClick={() => navigate('/crm')}
                      className="group flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-foreground/5 cursor-pointer transition-colors"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${corPonto}`} aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground line-clamp-1">{t.title}</p>
                        {t.contact?.name && (
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{t.contact.name}</p>
                        )}
                      </div>
                      {t.due_date && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${corPill}`}>
                          {t.due_date.split('-').reverse().slice(0, 2).join('/')}
                        </span>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  )
                })}
                {minhasTarefas.length > 4 && (
                  <p className="text-[11px] text-muted-foreground text-center pt-1">
                    e mais {minhasTarefas.length - 4}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </GlassCard>

        <GlassCard>
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
              <div className="space-y-0.5">
                {recentNotes.map((note) => (
                  <div
                    key={note.id}
                    onClick={() => navigate('/notes')}
                    className="group flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-foreground/5 cursor-pointer transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium text-foreground truncate flex-1">
                          {note.contact_name || note.title}
                        </p>
                        {/* Selo em tom mais suave que os outros do arquivo — era
                            o `/15` de sempre, mas texto+fundo na mesma família
                            de cor sobre vidro competia com o "Fin"/"RH" que é
                            a informação real da pílula. */}
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                          note.category === 'financeiro' ? 'bg-emerald-500/10 text-emerald-500' :
                          note.category === 'rh' ? 'bg-blue-500/10 text-blue-500' :
                          note.category === 'administrativo' ? 'bg-amber-500/10 text-amber-500' :
                          'bg-muted/60 text-muted-foreground'
                        }`}>
                          {note.category === 'financeiro' ? 'Fin' : note.category === 'rh' ? 'RH' : note.category === 'administrativo' ? 'Adm' : 'Ger'}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{note.content}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </GlassCard>
      </div>

      {/* ── Chart + Devices ── */}
      <div className="grid gap-4 md:grid-cols-7">
        <GlassCard className="md:col-span-5">
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
        </GlassCard>

        {/* Devices panel */}
        <GlassCard className="md:col-span-2 flex flex-col">
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
                    // Offline perde opacidade e a foto vai para cinza — a lista
                    // inteira precisa se ler num relance, sem ter que caçar o
                    // ponto vermelho/verde linha por linha.
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-foreground/5 transition-colors text-left ${!isOnline ? 'opacity-60' : ''}`}
                  >
                    <div className="relative flex-shrink-0">
                      {/* `SmartAvatar` cobre os dois ramos que existiam antes
                          (`<img>` cru e o `<div><Smartphone/></div>` de
                          fallback): mostra a foto real quando ela existe e
                          carrega, e busca de novo sozinha se a URL (da CDN do
                          WhatsApp) tiver expirado. */}
                      <SmartAvatar
                        isInstance
                        deviceRecord={device}
                        name={device.name}
                        className={`h-8 w-8 ${!isOnline ? 'grayscale' : ''}`}
                      />
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
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
                      // Selo âmbar suave — igual aos outros selos do arquivo,
                      // no lugar do `bg-amber-500 text-amber-950` chapado.
                      <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500/15 text-amber-500 text-[10px] font-bold flex items-center justify-center">
                        {device.unread_count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </CardContent>
        </GlassCard>
      </div>

      {/* ── Bottom row ── */}
      <div className="grid gap-4 md:grid-cols-7">
        {/* Top conversations */}
        <GlassCard className="md:col-span-4">
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
                {/* Sem coluna `#n`: a ordem da lista já é o ranking — o número
                    era redundante com a própria posição. */}
                {topConvos.map((conv) => {
                  const pct = topConvos[0]?.total > 0 ? Math.round((conv.total / topConvos[0].total) * 100) : 0
                  const name = conv.sender_name || conv.remote_sender.split('@')[0] || conv.remote_sender
                  return (
                    <button
                      key={`${conv.device_id}|${conv.remote_sender}`}
                      onClick={() => navigate(`/chat?device=${conv.device_id}`)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-foreground/5 transition-colors text-left"
                    >
                      {/* Foto real do WhatsApp no lugar do círculo com a
                          inicial — a instância vem do mapa `deviceInstanceMap`
                          (mesmo padrão do `deviceNameMap` já existente aqui). */}
                      <SmartAvatar
                        jid={conv.remote_sender}
                        name={name}
                        instanceKey={deviceInstanceMap[conv.device_id]}
                        className="h-7 w-7 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-medium text-foreground truncate">{name}</p>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500">{conv.inbound}↓</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-500">{conv.outbound}↑</span>
                            <span className="text-[10px] font-semibold text-foreground">{conv.total}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all"
                              style={{ width: `${pct}%` }}
                            />
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
        </GlassCard>

        {/* Right column */}
        <div className="md:col-span-3 flex flex-col gap-4">
          {/* Volume by device */}
          <GlassCard>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-foreground">Volume por aparelho</CardTitle>
                {/* Legenda única no topo — antes cada linha repetia a mesma
                    cor/rótulo, e a barra virou empilhada (recebidas + enviadas
                    no mesmo segmento), então a legenda por linha não fazia
                    mais sentido individualmente. */}
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-shrink-0">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />Recebidas</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />Enviadas</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {volumePorAparelho.linhas.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">Sem dados</p>
              ) : (
                <div className="space-y-2.5">
                  {volumePorAparelho.linhas.map((d) => {
                    const pctIn = Math.round((d.inbound / volumePorAparelho.maxTotal) * 100)
                    const pctOut = Math.round((d.outbound / volumePorAparelho.maxTotal) * 100)
                    return (
                      <div key={d.id} className="flex items-center gap-2">
                        {/* Mini-avatar amarra visualmente esta linha ao card
                            "Aparelhos" acima — mesmo aparelho, mesma foto. */}
                        <SmartAvatar isInstance deviceRecord={d} name={d.name} className="h-5 w-5 flex-shrink-0" />
                        <p className="text-[11px] text-muted-foreground w-20 truncate flex-shrink-0">{d.name}</p>
                        <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden flex">
                          <div className="h-full bg-blue-500 transition-all" style={{ width: `${pctIn}%` }} />
                          <div className="h-full bg-violet-500 transition-all" style={{ width: `${pctOut}%` }} />
                        </div>
                        <span className="text-[11px] font-semibold text-foreground w-8 text-right flex-shrink-0">{d.total}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </GlassCard>

          {/* Pending scheduled */}
          <GlassCard className="flex-1">
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
                <div className="space-y-0.5">
                  {pendingScheduled.slice(0, 4).map((msg) => {
                    const when = new Date(msg.scheduled_at)
                    const isToday = when.toDateString() === new Date().toDateString()
                    return (
                      <div key={msg.id} className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-foreground/5 transition-colors">
                        <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isToday ? 'bg-amber-500' : 'bg-slate-400'}`} aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {msg.contact_name || msg.remote_sender.split('@')[0]}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">{msg.content}</p>
                        </div>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${isToday ? 'bg-amber-500/15 text-amber-500' : 'bg-muted text-muted-foreground'}`}>
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
          </GlassCard>
        </div>
      </div>

      {/*
        Quem você pegou no período e ainda não finalizou. O número sozinho dizia
        que havia fila, mas não quem estava nela — e chegar até a pessoa exigia
        procurar na mão, conversa por conversa.

        A hora mostrada é a de QUANDO A CONVERSA FOI PEGA (`assigned_at`), não a
        da última mensagem: é esse instante que decide se ela entra ou não na
        janela do filtro, então mostrar outro faria a lista parecer errada.
      */}
      <Dialog open={painelNaoFinalizados} onOpenChange={setPainelNaoFinalizados}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Chat não finalizado — {periodLabel}</DialogTitle>
            <DialogDescription>
              {convMetrics.naoFinalizadosPeriodo === 1
                ? `1 conversa que você pegou ${periodoNaFrase} e ainda não finalizou.`
                : `${convMetrics.naoFinalizadosPeriodo} conversas que você pegou ${periodoNaFrase} e ainda não finalizou.`}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto space-y-1.5 -mx-1 px-1">
            {convMetrics.naoFinalizadosList.map((p) => (
              <button
                key={`${p.device_id}:${p.remote_sender}`}
                onClick={() => {
                  // `device` junto do `jid`: sem ele o chat abriria a conversa no
                  // aparelho que estivesse selecionado, que pode não ser o desta
                  // mensagem.
                  navigate(`/chat?device=${p.device_id}&jid=${encodeURIComponent(p.remote_sender)}`)
                }}
                className="w-full text-left p-2.5 rounded-xl hover:bg-accent/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {p.sender_name || p.remote_sender}
                  </p>
                  <span className="text-[11px] text-muted-foreground flex-shrink-0 tabular-nums">
                    {new Date(p.assigned_at).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className="text-xs text-muted-foreground truncate flex-1">
                    pega por você, ainda em aberto
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

      {/*
        Clone do painel de pendentes, mas sem recorte de hoje — segue a mesma
        regra do card: mensagem não lida de ontem continua aparecendo aqui.
      */}
      <Dialog open={painelNaoLidas} onOpenChange={setPainelNaoLidas}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Conversas com mensagens não lidas</DialogTitle>
            <DialogDescription>
              {convMetrics.unreadConversations === 1
                ? '1 conversa tem mensagem não lida.'
                : `${convMetrics.unreadConversations} conversas têm mensagens não lidas.`}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto space-y-1.5 -mx-1 px-1">
            {convMetrics.unreadList.map((p) => (
              <button
                key={`${p.device_id}:${p.remote_sender}`}
                onClick={() => {
                  navigate(`/chat?device=${p.device_id}&jid=${encodeURIComponent(p.remote_sender)}`)
                }}
                className="w-full text-left p-2.5 rounded-xl hover:bg-accent/60 transition-colors"
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
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Contagem por conversa — o dado extra que esta lista tem em relação à de pendentes. */}
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500">
                      {p.unread_count}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70">
                      {deviceNameMap[p.device_id] ?? ''}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
