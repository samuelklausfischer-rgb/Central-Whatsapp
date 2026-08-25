import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { AlertTriangle, Clock, Flame, RefreshCw, Timer, Users } from 'lucide-react'
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
  getMetricasPorAtendente,
  getMetricasPorContato,
  getPendencias,
  type MetricaPorAtendente,
  type MetricaPorContato,
  type PendenciaRecente,
} from '@/services/response_metrics'
import { getDevices } from '@/services/devices'

/**
 * Controle de Mensagens — a janela para o que o motor de medição vem gravando.
 *
 * Restrita a super-admin em TRÊS lugares que precisam concordar: a rota
 * (`SuperAdminRoute` em App.tsx), o item de menu (`navegacao.ts`) e o registro em
 * `ToolHost`. Nada aqui repete a checagem: uma quarta cópia da regra seria mais
 * uma coisa para sair de sincronia.
 */

type Preset = 'hoje' | '7dias' | '30dias'

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

function Cartao({
  icone: Icone,
  titulo,
  valor,
  detalhe,
}: {
  icone: typeof Clock
  titulo: string
  valor: string
  detalhe?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icone className="h-3.5 w-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wide">{titulo}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{valor}</p>
      {detalhe && <p className="text-[11px] text-muted-foreground mt-0.5">{detalhe}</p>}
    </div>
  )
}

export default function ControleMensagens() {
  const [preset, setPreset] = useState<Preset>('hoje')
  const [deviceId, setDeviceId] = useState<string>('')
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([])

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
  }, [])

  const janela = useMemo(() => janelaDoPreset(preset), [preset])

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const filtro = { ...janela, deviceId: deviceId || null }
      const [a, r, u, c] = await Promise.all([
        getPendencias({ ...filtro, apenasAbertas: true, limite: 200 }),
        getPendencias({ ...filtro, limite: 200 }),
        getMetricasPorAtendente(filtro),
        getMetricasPorContato(filtro),
      ])
      setAbertas(a)
      setRegistros(r)
      setPorAtendente(u)
      setPorContato(c)
    } catch (e: any) {
      setErro(e?.message ?? 'Falha ao carregar')
    } finally {
      setCarregando(false)
    }
  }, [janela, deviceId])

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

  const resumo = useMemo(() => {
    const fechadas = registros.filter((r) => r.response_seconds != null)
    const tempos = fechadas.map((r) => r.response_seconds as number).sort((x, y) => x - y)
    const media = tempos.length ? tempos.reduce((s, n) => s + n, 0) / tempos.length : null
    const mediana = tempos.length ? tempos[Math.floor(tempos.length / 2)] : null
    return {
      media,
      mediana,
      estouros: fechadas.filter((r) => (r.response_seconds ?? 0) > 300).length,
      dezMin: registros.filter((r) => r.alerta_10m_at).length,
    }
  }, [registros])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
          <Button size="sm" variant="outline" onClick={() => void carregar()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {erro && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {erro}
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Cartao
          icone={Clock}
          titulo="Esperando agora"
          valor={String(abertas.length)}
          detalhe={abertas.length ? `mais antiga: ${duracao(Math.floor((agora - new Date(abertas[0].inbound_at).getTime()) / 1000))}` : 'ninguém na fila'}
        />
        <Cartao icone={Timer} titulo="Média no período" valor={duracao(resumo.media)} detalhe={`mediana ${duracao(resumo.mediana)}`} />
        <Cartao icone={AlertTriangle} titulo="Passaram de 5 min" valor={String(resumo.estouros)} detalhe="já respondidas" />
        <Cartao icone={Flame} titulo="Escalaram (10 min)" valor={String(resumo.dezMin)} detalhe="no período" />
      </div>

      {/* ── Fila viva ── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Esperando agora</h2>
          <span className="text-[11px] text-muted-foreground">
            — independe do filtro de período: quem espera desde ontem ainda espera
          </span>
        </header>
        {abertas.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {carregando ? 'Carregando…' : 'Nada esperando resposta.'}
          </p>
        ) : (
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
        )}
      </section>

      {/* ── Por atendente ── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Por atendente</h2>
          <span className="text-[11px] text-muted-foreground">
            — a mediana ao lado da média: uma conversa esquecida por horas distorce a média
          </span>
        </header>
        {porAtendente.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Sem respostas no período.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Atendente</TableHead>
                <TableHead>Respondidas</TableHead>
                <TableHead>Média</TableHead>
                <TableHead>Mediana</TableHead>
                <TableHead>Passou de 5 min</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porAtendente.map((m) => (
                <TableRow key={m.user_id ?? m.user_name}>
                  <TableCell className="font-medium">{m.user_name}</TableCell>
                  <TableCell>{m.respondidas}</TableCell>
                  <TableCell>{duracao(m.media_segundos)}</TableCell>
                  <TableCell>{duracao(m.mediana_segundos)}</TableCell>
                  <TableCell className={m.estouros_5min > 0 ? 'text-orange-400' : ''}>
                    {m.estouros_5min}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {/* ── Por contato ── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Por contato</h2>
          <span className="text-[11px] text-muted-foreground">
            Ordenado por quem mais esperou — serve para achar quem está sendo mal atendido
          </span>
        </header>
        {porContato.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Sem respostas no período.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contato</TableHead>
                <TableHead>Respondidas</TableHead>
                <TableHead>Média</TableHead>
                <TableHead>Passou de 5 min</TableHead>
                <TableHead>Pior caso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porContato.map((c) => (
                <TableRow key={`${c.device_id}|${c.remote_sender}`}>
                  <TableCell className="font-medium">{c.contato}</TableCell>
                  <TableCell>{c.respondidas}</TableCell>
                  <TableCell>{duracao(c.media_segundos)}</TableCell>
                  <TableCell className={c.estouros_5min > 0 ? 'text-orange-400' : ''}>
                    {c.estouros_5min}
                  </TableCell>
                  <TableCell>{duracao(c.pior_segundos)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {/* ── Registros crus ── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Últimos registros</h2>
          <span className="text-[11px] text-muted-foreground">
            O que está sendo gravado, linha a linha
          </span>
        </header>
        {registros.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {carregando ? 'Carregando…' : 'Nada no período.'}
          </p>
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
                  <TableHead>Classificação</TableHead>
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
                      <TableCell>{p.respondido_por ?? (p.responded_at ? '—' : 'aguardando')}</TableCell>
                      <TableCell>{duracao(p.response_seconds)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {/* Vazio enquanto a IA da Etapa 3 não estiver implantada. */}
                        {p.classification ?? '—'}
                      </TableCell>
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
      </section>
    </div>
  )
}
