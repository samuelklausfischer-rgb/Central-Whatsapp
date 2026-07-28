import { useEffect, useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { Monitor, Smartphone, RefreshCw, AlertCircle, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDailyActivity, getSessions, type UserAppDailyActivity, type UserAppSession } from '@/services/app_activity'
import { getUsers } from '@/services/users'
import type { Profile } from '@/lib/supabase/types'

type PeriodoPreset = 'hoje' | '7dias' | '30dias' | 'custom'

/**
 * Datas SEMPRE via date-fns `format` (hora local). `toISOString().slice(0,10)`
 * devolveria a data em UTC, e depois das 21h BRT "Hoje" viraria amanhã — a tela
 * mostraria zero justamente no fim do expediente.
 */
const hojeLocal = () => format(new Date(), 'yyyy-MM-dd')

const formatarDuracao = (segundos: number) => {
  if (!segundos || segundos <= 0) return '0min'
  const h = Math.floor(segundos / 3600)
  const m = Math.round((segundos % 3600) / 60)
  if (h === 0) return `${m}min`
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

const formatarUltimoSinal = (iso: string | null) => {
  if (!iso) return '—'
  return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm")
}

/** 3min tolera 1 heartbeat perdido (batida a cada 120s). Decisão do usuário. */
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000

interface LinhaRelatorio {
  usuario: Profile
  activeSeconds: number
  openSeconds: number
  plataformas: Set<string>
  versoes: Set<string>
  ultimoSinal: string | null
  semColeta: boolean
  onlineAgora: boolean
  diasComAtividade: number
  activeSecondsAvg: number
  openSecondsAvg: number
}

export default function RelatorioApp() {
  const [preset, setPreset] = useState<PeriodoPreset>('7dias')
  const [dtInicio, setDtInicio] = useState(() => format(subDays(new Date(), 6), 'yyyy-MM-dd'))
  const [dtFim, setDtFim] = useState(hojeLocal)
  const [atividade, setAtividade] = useState<UserAppDailyActivity[]>([])
  const [sessoes, setSessoes] = useState<UserAppSession[]>([])
  const [usuarios, setUsuarios] = useState<Profile[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  // Congelado a cada carga de dados, nunca lido inline no useMemo: garante que
  // "online agora" só recalcula no clique de Atualizar (ou troca de período),
  // nunca por um re-render qualquer do componente.
  const [momentoCalculo, setMomentoCalculo] = useState(() => Date.now())

  const aplicarPreset = (novo: PeriodoPreset) => {
    setPreset(novo)
    const hoje = new Date()
    if (novo === 'hoje') {
      setDtInicio(format(hoje, 'yyyy-MM-dd'))
      setDtFim(format(hoje, 'yyyy-MM-dd'))
    } else if (novo === '7dias') {
      setDtInicio(format(subDays(hoje, 6), 'yyyy-MM-dd'))
      setDtFim(format(hoje, 'yyyy-MM-dd'))
    } else if (novo === '30dias') {
      setDtInicio(format(subDays(hoje, 29), 'yyyy-MM-dd'))
      setDtFim(format(hoje, 'yyyy-MM-dd'))
    }
  }

  const carregar = async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [ativ, sess, users] = await Promise.all([
        getDailyActivity(dtInicio, dtFim),
        getSessions(),
        getUsers(),
      ])
      setAtividade(ativ)
      setSessoes(sess)
      setUsuarios(users)
      setMomentoCalculo(Date.now())
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar o relatório')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dtInicio, dtFim])

  const linhas = useMemo<LinhaRelatorio[]>(() => {
    const porUsuario = new Map<string, LinhaRelatorio>()
    // Dedup por dia: a tabela tem PK (user_id, dia, platform) — um usuário que
    // usa app e web no mesmo dia gera 2 linhas nesse dia. Contar linhas
    // contaria o dia em dobro na média; um Set garante dia distinto.
    const diasPorUsuario = new Map<string, Set<string>>()

    usuarios.forEach((u) => {
      porUsuario.set(u.id, {
        usuario: u,
        activeSeconds: 0,
        openSeconds: 0,
        plataformas: new Set(),
        versoes: new Set(),
        ultimoSinal: null,
        semColeta: true,
        onlineAgora: false,
        diasComAtividade: 0,
        activeSecondsAvg: 0,
        openSecondsAvg: 0,
      })
      diasPorUsuario.set(u.id, new Set())
    })

    atividade.forEach((a) => {
      const linha = porUsuario.get(a.user_id)
      if (!linha) return
      linha.activeSeconds += a.active_seconds
      linha.openSeconds += a.open_seconds
      linha.plataformas.add(a.platform)
      if (a.app_version) linha.versoes.add(a.app_version)
      diasPorUsuario.get(a.user_id)?.add(a.dia)
    })

    // `semColeta` olha as SESSÕES, não o período filtrado: um usuário pode ter
    // ficado de férias na semana escolhida (0 min é verdade) ou nunca ter
    // atualizado o app (0 min é ausência de dado). Os dois casos precisam ser
    // visualmente diferentes, senão o segundo se lê como "não trabalha".
    sessoes.forEach((s) => {
      const linha = porUsuario.get(s.user_id)
      if (!linha) return
      linha.semColeta = false
      linha.plataformas.add(s.platform)
      if (s.app_version) linha.versoes.add(s.app_version)
      if (!linha.ultimoSinal || new Date(s.last_seen_at) > new Date(linha.ultimoSinal)) {
        linha.ultimoSinal = s.last_seen_at
      }
    })

    // Passo final: médias (só dias com atividade, nunca todos os dias do
    // período) e "online agora" (ignora o filtro de período de propósito —
    // é status "agora", mesmo raciocínio de "visto por último").
    porUsuario.forEach((linha, userId) => {
      const dias = diasPorUsuario.get(userId)?.size ?? 0
      linha.diasComAtividade = dias
      linha.activeSecondsAvg = dias > 0 ? linha.activeSeconds / dias : 0
      linha.openSecondsAvg = dias > 0 ? linha.openSeconds / dias : 0
      linha.onlineAgora = linha.ultimoSinal != null
        && momentoCalculo - new Date(linha.ultimoSinal).getTime() <= ONLINE_THRESHOLD_MS
    })

    return [...porUsuario.values()].sort((a, b) => b.activeSeconds - a.activeSeconds)
  }, [usuarios, atividade, sessoes, momentoCalculo])

  const totalAtivo = linhas.reduce((soma, l) => soma + l.activeSeconds, 0)
  const semColeta = linhas.filter((l) => l.semColeta).length
  const onlineAgoraCount = linhas.filter((l) => l.onlineAgora).length

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 overflow-y-auto p-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Relatório App</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Tempo de uso por usuário, plataforma e versão. Mede apenas app aberto e tempo com
              interação — não registra telas visitadas, teclas nem conteúdo de mensagens.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={carregar} disabled={carregando}>
            <RefreshCw className={`mr-2 h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </header>

        <section className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Período
              </span>
              <div className="grid w-fit grid-cols-3 gap-1 rounded-lg border border-border bg-muted p-0.5">
                {([
                  { key: 'hoje', label: 'Hoje' },
                  { key: '7dias', label: '7 dias' },
                  { key: '30dias', label: '30 dias' },
                ] as const).map((p) => (
                  <button
                    key={p.key}
                    onClick={() => aplicarPreset(p.key)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                      preset === p.key
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                De
              </label>
              <Input
                type="date"
                value={dtInicio}
                max={dtFim}
                onChange={(e) => {
                  setPreset('custom')
                  setDtInicio(e.target.value)
                }}
                className="w-40"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Até
              </label>
              <Input
                type="date"
                value={dtFim}
                min={dtInicio}
                max={hojeLocal()}
                onChange={(e) => {
                  setPreset('custom')
                  setDtFim(e.target.value)
                }}
                className="w-40"
              />
            </div>
          </div>
        </section>

        {erro && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Usuários</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{linhas.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Tempo ativo total</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{formatarDuracao(totalAtivo)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Online agora</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-500">{onlineAgoraCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sem coleta</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{semColeta}</p>
          </div>
        </div>

        <section className="rounded-xl border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Online agora</TableHead>
                <TableHead>Plataforma</TableHead>
                <TableHead>Versão</TableHead>
                <TableHead className="text-right">Tempo ativo</TableHead>
                <TableHead className="text-right">App aberto</TableHead>
                <TableHead>Visto por último</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {carregando && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!carregando && linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Nenhum dado no período.
                  </TableCell>
                </TableRow>
              )}
              {!carregando &&
                linhas.map((l) => (
                  <TableRow key={l.usuario.id}>
                    <TableCell className="font-medium text-foreground">
                      {l.usuario.name || l.usuario.username || l.usuario.email}
                    </TableCell>
                    <TableCell>
                      {l.semColeta ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span
                            className={`h-2 w-2 rounded-full ${l.onlineAgora ? 'bg-emerald-500' : 'bg-slate-400'}`}
                          />
                          {l.onlineAgora ? (
                            <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <WifiOff className="h-3.5 w-3.5 text-slate-400" />
                          )}
                          <span className={l.onlineAgora ? 'text-emerald-600 dark:text-emerald-500' : 'text-muted-foreground'}>
                            {l.onlineAgora ? 'Online' : 'Offline'}
                          </span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.semColeta ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span className="flex items-center gap-2 text-muted-foreground">
                          {l.plataformas.has('app') && (
                            <span className="inline-flex items-center gap-1 text-xs">
                              <Smartphone className="h-3.5 w-3.5" /> App
                            </span>
                          )}
                          {l.plataformas.has('web') && (
                            <span className="inline-flex items-center gap-1 text-xs">
                              <Monitor className="h-3.5 w-3.5" /> Web
                            </span>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.versoes.size > 0 ? [...l.versoes].join(', ') : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">
                      {l.semColeta ? (
                        '—'
                      ) : (
                        <div className="flex flex-col items-end">
                          <span>{formatarDuracao(l.activeSeconds)}</span>
                          {l.diasComAtividade > 0 && (
                            <span className="text-[11px] font-normal text-muted-foreground">
                              média {formatarDuracao(l.activeSecondsAvg)}/dia ({l.diasComAtividade}d)
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {l.semColeta ? (
                        '—'
                      ) : (
                        <div className="flex flex-col items-end">
                          <span>{formatarDuracao(l.openSeconds)}</span>
                          {l.diasComAtividade > 0 && (
                            <span className="text-[11px] font-normal text-muted-foreground">
                              média {formatarDuracao(l.openSecondsAvg)}/dia
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.semColeta ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-500">
                          app desatualizado — sem coleta
                        </span>
                      ) : (
                        formatarUltimoSinal(l.ultimoSinal)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </section>
      </div>
    </div>
  )
}
