import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  Clock,
  Flame,
  Gauge,
  RefreshCw,
  Smartphone,
  Timer,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getFila,
  getMetricasPorAtendente,
  getMetricasPorContato,
  getMetricasPorSetor,
  getPendencias,
  getResumo,
  getSerie,
  listarSetoresDisponiveis,
  type FaixaDaFila,
  type MetricaPorAtendente,
  type MetricaPorContato,
  type MetricaPorSetor,
  type PendenciaRecente,
  type PontoDaSerie,
  type ResumoDoAtendimento,
} from '@/services/response_metrics'
import { getDevices } from '@/services/devices'

/**
 * Controle de Mensagens — a janela para o que o motor de medição vem gravando.
 *
 * Restrita a super-admin em TRÊS lugares que precisam concordar: a rota
 * (`SuperAdminRoute` em App.tsx), o item de menu (`navegacao.ts`) e o registro em
 * `ToolHost`. Nada aqui repete a checagem: uma quarta cópia da regra seria mais
 * uma coisa para sair de sincronia.
 *
 * ── NENHUM NÚMERO É CALCULADO AQUI ───────────────────────────────────────────
 * Toda métrica vem pronta das RPCs. A versão anterior somava os quatro cartões no
 * navegador a partir das 200 linhas mais recentes, então "média do período" em 30
 * dias era a média de 200 registros — e ainda por cima sobre um recorte
 * (`inbound_at`) diferente do das tabelas de baixo (`responded_at`), o que fazia
 * números da mesma tela não fecharem entre si.
 *
 * ── CORRIDO vs INTEGRAL ──────────────────────────────────────────────────────
 * O seletor no topo troca a pergunta da tela inteira de uma vez. **Integral**
 * desconta a madrugada (00:00–06:59): mensagem das 22 h respondida às 8 h marcava
 * 10 h de demora para um time que não estava trabalhando. São poucos casos, mas
 * derrubavam a média de 42 min para 28 min. **Corrido** é o relógio de parede, e
 * continua acessível porque é ele que o cliente sentiu esperando.
 */

type Preset = 'hoje' | '7dias' | '30dias'
type Modo = 'integral' | 'corrido'
type Granularidade = 'hora' | 'dia_semana'

/** Mesma razão do `RelatorioApp`: `toISOString()` devolveria a data em UTC, e
 *  depois das 21h BRT "hoje" viraria amanhã — a tela zeraria no fim do expediente. */
function janelaDoPreset(preset: Preset): { desde: string; ate: string } {
  const agora = new Date()
  const inicio = new Date(agora)
  inicio.setHours(0, 0, 0, 0)
  if (preset === '7dias') inicio.setTime(subDays(inicio, 6).getTime())
  if (preset === '30dias') inicio.setTime(subDays(inicio, 29).getTime())
  return { desde: inicio.toISOString(), ate: agora.toISOString() }
}

function duracao(segundos: number | null | undefined): string {
  if (segundos == null) return '—'
  if (segundos < 60) return `${Math.round(segundos)}s`
  const m = Math.floor(segundos / 60)
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}min`
}

/** O marco mais grave já atingido decide a cor. Nada de somar avisos. */
function marco(p: PendenciaRecente): { rotulo: string; classe: string } | null {
  if (p.alerta_10m_at) return { rotulo: '+10 min', classe: 'bg-red-500/15 text-red-400 border-red-500/30' }
  if (p.alerta_5m_at) return { rotulo: '+5 min', classe: 'bg-orange-500/15 text-orange-400 border-orange-500/30' }
  if (p.alerta_2m_at) return { rotulo: '+2 min', classe: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
  return null
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Quanto mais escura a faixa, mais grave a espera. Mesma escala dos marcos. */
const COR_DA_FAIXA = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#b91c1c']

function Cartao({
  icone: Icone,
  titulo,
  valor,
  detalhe,
  destaque,
}: {
  icone: typeof Clock
  titulo: string
  valor: string
  detalhe?: string
  destaque?: boolean
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-4 ${
        destaque ? 'border-primary/40 ring-1 ring-primary/10' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icone className="h-3.5 w-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wide">{titulo}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{valor}</p>
      {detalhe && <p className="text-[11px] text-muted-foreground mt-0.5">{detalhe}</p>}
    </div>
  )
}

function Secao({
  icone: Icone,
  titulo,
  nota,
  children,
}: {
  icone?: typeof Clock
  titulo: string
  nota?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
        {Icone && <Icone className="h-4 w-4 text-muted-foreground" />}
        <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
        {nota && <span className="text-[11px] text-muted-foreground">— {nota}</span>}
      </header>
      {children}
    </section>
  )
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}

/** Tooltip com os mesmos tokens de tema do resto do app. */
function DicaDoGrafico({ active, payload, label, formatar }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md">
      <p className="text-[11px] font-medium text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-[11px] text-muted-foreground">
          <span style={{ color: p.color }}>■</span> {p.name}:{' '}
          <span className="text-foreground">
            {formatar?.(p.dataKey, p.value) ?? p.value}
          </span>
        </p>
      ))}
    </div>
  )
}

export default function ControleMensagens() {
  const [preset, setPreset] = useState<Preset>('hoje')
  const [deviceId, setDeviceId] = useState<string>('')
  const [setor, setSetor] = useState<string>('')
  const [modo, setModo] = useState<Modo>('integral')
  const [granularidade, setGranularidade] = useState<Granularidade>('hora')

  const [devices, setDevices] = useState<{ id: string; name: string }[]>([])
  const [setores, setSetores] = useState<string[]>([])

  const [resumo, setResumo] = useState<ResumoDoAtendimento | null>(null)
  const [fila, setFila] = useState<FaixaDaFila[]>([])
  const [serie, setSerie] = useState<PontoDaSerie[]>([])
  const [porSetor, setPorSetor] = useState<MetricaPorSetor[]>([])
  const [abertas, setAbertas] = useState<PendenciaRecente[]>([])
  const [registros, setRegistros] = useState<PendenciaRecente[]>([])
  const [porAtendente, setPorAtendente] = useState<MetricaPorAtendente[]>([])
  const [porContato, setPorContato] = useState<MetricaPorContato[]>([])

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  /** Relógio próprio: sem ele o "esperando há X" congela até a próxima busca. */
  const [agora, setAgora] = useState(() => Date.now())

  useEffect(() => {
    getDevices()
      .then((lista) => setDevices(lista.map((d: any) => ({ id: d.id, name: d.name }))))
      .catch(() => {})
    listarSetoresDisponiveis()
      .then(setSetores)
      .catch(() => {})
  }, [])

  const janela = useMemo(() => janelaDoPreset(preset), [preset])

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const filtro = { ...janela, deviceId: deviceId || null }
      const [res, f, s, st, a, r, u, c] = await Promise.all([
        getResumo({ ...filtro, setor: setor || null }),
        getFila(deviceId || null),
        getSerie({ ...filtro, granularidade }),
        getMetricasPorSetor(filtro),
        getPendencias({ ...filtro, apenasAbertas: true, limite: 200 }),
        getPendencias({ ...filtro, limite: 200 }),
        getMetricasPorAtendente(filtro),
        getMetricasPorContato(filtro),
      ])
      setResumo(res)
      setFila(f)
      setSerie(s)
      setPorSetor(st)
      setAbertas(a)
      setRegistros(r)
      setPorAtendente(u)
      setPorContato(c)
    } catch (e: any) {
      setErro(e?.message ?? 'Falha ao carregar')
    } finally {
      setCarregando(false)
    }
  }, [janela, deviceId, setor, granularidade])

  useEffect(() => {
    setCarregando(true)
    void carregar()
  }, [carregar])

  // A fila viva envelhece sozinha: 30s para rebuscar, 10s só para o relógio andar.
  useEffect(() => {
    const busca = setInterval(() => void carregar(), 30_000)
    const relogio = setInterval(() => setAgora(Date.now()), 10_000)
    return () => {
      clearInterval(busca)
      clearInterval(relogio)
    }
  }, [carregar])

  const integral = modo === 'integral'

  /** Um lugar só decide de qual coluna cada número sai. */
  const tempo = useMemo(() => {
    if (!resumo) return { p50: null, media: null, p90: null, p95: null }
    return integral
      ? {
          p50: resumo.p50_integral,
          media: resumo.media_integral,
          p90: resumo.p90_integral,
          p95: resumo.p95_integral,
        }
      : {
          p50: resumo.p50_corrido,
          media: resumo.media_corrido,
          p90: resumo.p90_corrido,
          p95: resumo.p95_corrido,
        }
  }, [resumo, integral])

  const dadosDaSerie = useMemo(
    () =>
      serie.map((p) => ({
        label: granularidade === 'hora' ? `${String(p.balde).padStart(2, '0')}h` : DIAS[p.balde] ?? String(p.balde),
        recebidas: p.recebidas,
        respondidas: p.respondidas,
        tempo: integral ? p.p50_integral : p.p50_corrido,
      })),
    [serie, granularidade, integral],
  )

  const dadosDaFila = useMemo(
    () => fila.map((f) => ({ label: f.faixa, ordem: f.ordem, n: f.n, contatos: f.contatos })),
    [fila],
  )

  /** Percentis lado a lado: é o desenho que mostra que o problema é cauda. */
  const dadosDosPercentis = useMemo(() => {
    if (!resumo) return []
    return [
      { label: 'Mediana', corrido: resumo.p50_corrido, integral: resumo.p50_integral },
      { label: 'p90', corrido: resumo.p90_corrido, integral: resumo.p90_integral },
      { label: 'p95', corrido: resumo.p95_corrido, integral: resumo.p95_integral },
      { label: 'Média', corrido: resumo.media_corrido, integral: resumo.media_integral },
    ]
  }, [resumo])

  const medindoDesde = resumo?.medindo_desde ? new Date(resumo.medindo_desde) : null
  const periodoAntesDaMedicao =
    medindoDesde != null && new Date(janela.desde) < medindoDesde

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Controle de Mensagens</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tempo de resposta do time e quem está esperando agora
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['hoje', '7dias', '30dias'] as Preset[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={preset === p ? 'default' : 'outline'}
              onClick={() => setPreset(p)}
            >
              {p === 'hoje' ? 'Hoje' : p === '7dias' ? '7 dias' : '30 dias'}
            </Button>
          ))}
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            <option value="">Todos os aparelhos</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select
            value={setor}
            onChange={(e) => setSetor(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            <option value="">Todos os setores</option>
            {setores.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => void carregar()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Como o tempo é contado ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Contagem
        </span>
        <Button size="sm" variant={integral ? 'default' : 'outline'} onClick={() => setModo('integral')}>
          Tempo integral
        </Button>
        <Button size="sm" variant={!integral ? 'default' : 'outline'} onClick={() => setModo('corrido')}>
          Tempo corrido
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {integral
            ? 'Conta só a espera entre 07:00 e 23:59 — a madrugada não é tempo de atendimento.'
            : 'Relógio de parede: conta tudo, inclusive a madrugada. É o que o cliente sentiu esperando.'}
        </span>
      </div>

      {erro && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {erro}
        </div>
      )}

      {periodoAntesDaMedicao && medindoDesde && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[12px] text-amber-400">
          O motor de medição começa em <strong>{format(medindoDesde, "dd/MM/yyyy 'às' HH:mm")}</strong>.
          O período escolhido é mais longo que isso — o que aparece vazio antes dessa data é ausência
          de histórico, não ausência de atendimento.
        </div>
      )}

      {/* ── Cartões ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Cartao
          icone={Clock}
          titulo="Esperando agora"
          valor={String(resumo?.abertas ?? 0)}
          detalhe={
            abertas.length
              ? `mais antiga: ${duracao(Math.floor((agora - new Date(abertas[0].inbound_at).getTime()) / 1000))}`
              : 'ninguém na fila'
          }
        />
        <Cartao
          icone={Timer}
          titulo="Mediana"
          valor={duracao(tempo.p50)}
          detalhe="metade é respondida antes disso"
          destaque
        />
        <Cartao
          icone={Gauge}
          titulo="p90"
          valor={duracao(tempo.p90)}
          detalhe={`p95 ${duracao(tempo.p95)}`}
        />
        <Cartao
          icone={Timer}
          titulo="Média"
          valor={duracao(tempo.media)}
          detalhe="puxada por poucos casos extremos"
        />
        <Cartao
          icone={AlertTriangle}
          titulo="Passaram de 5 min"
          valor={String(resumo?.estouros_5min ?? 0)}
          detalhe={`de ${resumo?.respondidas ?? 0} respondidas`}
        />
        <Cartao
          icone={Smartphone}
          titulo="Fora do app"
          valor={resumo?.pct_fora_do_app != null ? `${resumo.pct_fora_do_app}%` : '—'}
          detalhe={`${resumo?.fora_do_app ?? 0} respostas pelo celular`}
        />
      </div>

      {/* ── Distribuição ── */}
      <Secao
        icone={Gauge}
        titulo="Distribuição dos tempos"
        nota="a distância entre mediana e média é o tamanho da cauda"
      >
        {!resumo || resumo.respondidas === 0 ? (
          <Vazio>{carregando ? 'Carregando…' : 'Sem respostas no período.'}</Vazio>
        ) : (
          <div className="h-[220px] w-full p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dadosDosPercentis} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  tickFormatter={(v) => duracao(v)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={64}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                />
                <Tooltip content={<DicaDoGrafico formatar={(_: string, v: number) => duracao(v)} />} />
                <Bar dataKey="integral" name="Integral" fill="#3b82f6" radius={[0, 3, 3, 0]} />
                <Bar dataKey="corrido" name="Corrido" fill="#8b5cf6" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Secao>

      {/* ── Fila por idade ── */}
      <Secao
        icone={Clock}
        titulo="Fila por tempo de espera"
        nota="independe do filtro de período: quem espera desde ontem ainda espera"
      >
        {dadosDaFila.length === 0 ? (
          <Vazio>{carregando ? 'Carregando…' : 'Nada esperando resposta.'}</Vazio>
        ) : (
          <div className="h-[200px] w-full p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dadosDaFila} margin={{ left: -14, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                />
                <Tooltip content={<DicaDoGrafico />} />
                <Bar dataKey="n" name="Mensagens" radius={[3, 3, 0, 0]}>
                  {dadosDaFila.map((f) => (
                    <Cell key={f.label} fill={COR_DA_FAIXA[f.ordem - 1] ?? '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Secao>

      {/* ── Curva ── */}
      <Secao icone={Timer} titulo="Quando o atendimento piora">
        <div className="px-4 pt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant={granularidade === 'hora' ? 'default' : 'outline'}
            onClick={() => setGranularidade('hora')}
          >
            Por hora
          </Button>
          <Button
            size="sm"
            variant={granularidade === 'dia_semana' ? 'default' : 'outline'}
            onClick={() => setGranularidade('dia_semana')}
          >
            Por dia da semana
          </Button>
          <span className="text-[11px] text-muted-foreground">
            volume recebido contra a mediana de resposta
          </span>
        </div>
        {dadosDaSerie.length === 0 ? (
          <Vazio>{carregando ? 'Carregando…' : 'Sem dados no período.'}</Vazio>
        ) : (
          <div className="h-[260px] w-full p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dadosDaSerie} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRecebidas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradTempo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  dy={6}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="esq"
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                />
                <YAxis
                  yAxisId="dir"
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  width={54}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  tickFormatter={(v) => duracao(v)}
                />
                <Tooltip
                  content={
                    <DicaDoGrafico
                      formatar={(chave: string, v: number) => (chave === 'tempo' ? duracao(v) : v)}
                    />
                  }
                />
                <Area
                  yAxisId="esq"
                  type="monotone"
                  dataKey="recebidas"
                  name="Recebidas"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#gradRecebidas)"
                  dot={false}
                />
                <Area
                  yAxisId="dir"
                  type="monotone"
                  dataKey="tempo"
                  name="Mediana"
                  stroke="#f97316"
                  strokeWidth={2}
                  fill="url(#gradTempo)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Secao>

      {/* ── Por setor ── */}
      <Secao
        icone={Users}
        titulo="Por setor"
        nota="quem cobre dois setores conta nos dois, então a soma não fecha com o total"
      >
        {porSetor.length === 0 ? (
          <Vazio>{carregando ? 'Carregando…' : 'Sem respostas no período.'}</Vazio>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Setor</TableHead>
                <TableHead>Respondidas</TableHead>
                <TableHead>Mediana</TableHead>
                <TableHead>p90</TableHead>
                <TableHead>Média</TableHead>
                <TableHead>Passou de 5 min</TableHead>
                <TableHead>Pior caso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porSetor.map((s) => (
                <TableRow key={s.setor}>
                  <TableCell className="font-medium">
                    {s.setor}
                    {s.setor === 'Sem setor' && (
                      <span className="block text-[11px] text-muted-foreground">
                        respondido pelo celular, fora do app
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{s.respondidas}</TableCell>
                  <TableCell>{duracao(integral ? s.p50_integral : s.p50_corrido)}</TableCell>
                  <TableCell>{duracao(s.p90_corrido)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {duracao(integral ? s.media_integral : s.media_corrido)}
                  </TableCell>
                  <TableCell className={s.estouros_5min > 0 ? 'text-orange-400' : ''}>
                    {s.estouros_5min}
                  </TableCell>
                  <TableCell>{duracao(s.pior_corrido)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Secao>

      {/* ── Por atendente ── */}
      <Secao
        icone={Users}
        titulo="Por atendente"
        nota="a mediana ao lado da média: uma conversa esquecida por horas distorce a média"
      >
        {porAtendente.length === 0 ? (
          <Vazio>Sem respostas no período.</Vazio>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Atendente</TableHead>
                <TableHead>Respondidas</TableHead>
                <TableHead>Mediana</TableHead>
                <TableHead>p90</TableHead>
                <TableHead>Média</TableHead>
                <TableHead>Passou de 5 min</TableHead>
                <TableHead>Pior caso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porAtendente.map((m) => (
                <TableRow key={m.user_id ?? m.user_name}>
                  <TableCell className="font-medium">
                    {m.user_name}
                    {m.user_id == null && (
                      <span className="block text-[11px] text-muted-foreground">
                        saiu do celular, sem passar pelo app
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{m.respondidas}</TableCell>
                  <TableCell>{duracao(integral ? m.p50_integral : m.mediana_segundos)}</TableCell>
                  <TableCell>{duracao(m.p90_corrido)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {duracao(integral ? m.media_integral : m.media_segundos)}
                  </TableCell>
                  <TableCell className={m.estouros_5min > 0 ? 'text-orange-400' : ''}>
                    {m.estouros_5min}
                  </TableCell>
                  <TableCell>{duracao(m.pior_corrido)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Secao>

      {/* ── Por contato ── */}
      <Secao
        titulo="Por contato"
        nota="ordenado por quem ficou esperando — serve para achar quem está sendo mal atendido"
      >
        {porContato.length === 0 ? (
          <Vazio>Sem registros no período.</Vazio>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contato</TableHead>
                <TableHead>Sem resposta</TableHead>
                <TableHead>Respondidas</TableHead>
                <TableHead>Mediana</TableHead>
                <TableHead>Média</TableHead>
                <TableHead>Passou de 5 min</TableHead>
                <TableHead>Pior caso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porContato.map((c) => (
                <TableRow key={`${c.device_id}|${c.remote_sender}`}>
                  <TableCell className="font-medium">{c.contato}</TableCell>
                  <TableCell className={c.abertas > 0 ? 'text-red-400 font-medium' : 'text-muted-foreground'}>
                    {c.abertas || '—'}
                  </TableCell>
                  <TableCell>{c.respondidas}</TableCell>
                  <TableCell>{duracao(integral ? c.p50_integral : c.p50_corrido)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {duracao(integral ? c.media_integral : c.media_segundos)}
                  </TableCell>
                  <TableCell className={c.estouros_5min > 0 ? 'text-orange-400' : ''}>
                    {c.estouros_5min}
                  </TableCell>
                  <TableCell>{duracao(c.pior_segundos)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Secao>

      {/* ── Fila viva ── */}
      <Secao icone={Clock} titulo="Esperando agora" nota="linha a linha, o que está em aberto">
        {abertas.length === 0 ? (
          <Vazio>{carregando ? 'Carregando…' : 'Nada esperando resposta.'}</Vazio>
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead>Aparelho</TableHead>
                  <TableHead>Esperando há</TableHead>
                  <TableHead>Marco</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {abertas.map((p) => {
                  const m = marco(p)
                  const segs = Math.floor((agora - new Date(p.inbound_at).getTime()) / 1000)
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.contato}</TableCell>
                      <TableCell className="text-muted-foreground">{p.aparelho}</TableCell>
                      <TableCell>{duracao(segs)}</TableCell>
                      <TableCell>
                        {m ? <Badge variant="outline" className={m.classe}>{m.rotulo}</Badge> : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>

      {/* ── Registros crus ── */}
      <Secao icone={Flame} titulo="Últimos registros" nota="o que está sendo gravado, linha a linha">
        {registros.length === 0 ? (
          <Vazio>{carregando ? 'Carregando…' : 'Nada no período.'}</Vazio>
        ) : (
          <div className="max-h-[520px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chegou</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Aparelho</TableHead>
                  <TableHead>Respondeu</TableHead>
                  <TableHead>Levou</TableHead>
                  <TableHead>Marco</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registros.map((p) => {
                  const m = marco(p)
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {format(new Date(p.inbound_at), 'dd/MM HH:mm')}
                      </TableCell>
                      <TableCell className="font-medium">{p.contato}</TableCell>
                      <TableCell className="text-muted-foreground">{p.aparelho}</TableCell>
                      <TableCell>
                        {p.respondido_por ??
                          (p.responded_at ? 'pelo celular' : 'aguardando')}
                      </TableCell>
                      <TableCell>{duracao(p.response_seconds)}</TableCell>
                      <TableCell>
                        {m ? <Badge variant="outline" className={m.classe}>{m.rotulo}</Badge> : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>
    </div>
  )
}
