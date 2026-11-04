import { useEffect, useRef, useState } from 'react'
import { CalendarSearch, CheckCircle2, RefreshCw, Search, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  cancelHistoryImport,
  getHistoryImportStatus,
  iniciarSincronizacaoDoPeriodo,
  runHistoryImport,
  verificarPeriodo,
  EvolutionHistoryImportError,
  type BuscaPorPeriodoPreview,
  type EvolutionHistoryImportJob,
} from '@/services/evolution_history_import'
import {
  formatarMomento,
  montarPeriodo,
  paraInputData,
  type PeriodoBusca,
  type PresetPeriodo,
} from '@/lib/periodo-busca'

/**
 * Buscar mensagens — substitui o antigo "Importar histórico" por lotes.
 *
 * O atendente escolhe QUANDO (hoje, ontem, 7 dias ou de/até) e o sistema:
 *   1. Verificar: conta quantas mensagens a Evolution e o sistema têm no período;
 *   2. Sincronizar: lê o período inteiro na Evolution e grava SÓ o que falta.
 *
 * Não duplica por construção: cada mensagem é comparada pelo id do WhatsApp
 * antes de gravar, e o banco ainda recusa id repetido no mesmo aparelho
 * (`idx_messages_external_id_device`). Rodar duas vezes o mesmo período é seguro
 * — a segunda volta "0 recuperadas".
 *
 * Quem empurra o trabalho é este laço no navegador, uma página (50 mensagens)
 * por chamada, com respiro entre elas. É o ritmo que estabilizou o worker da
 * edge function em agosto: ele morria com `memory limit reached` (log de 14/08)
 * porque é reaproveitado entre chamadas e a memória acumulava quando uma
 * chamada emendava na outra. Uma página por vez + pausa deixa o runtime
 * reciclar. Subir esses números "para ir mais rápido" traz o problema de volta.
 */

/** Respiro entre chamadas (era 250 ms antes de agosto, e o worker morria). */
const INTERVALO_MS = 1500
/** Dias de mídia real (foto/áudio/documento baixado). Mais antiga entra como rótulo. */
const DIAS_DE_MIDIA = 7

const PRESETS: { valor: PresetPeriodo; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'ontem', rotulo: 'Ontem' },
  { valor: '7dias', rotulo: 'Últimos 7 dias' },
  { valor: 'personalizado', rotulo: 'Escolher datas' },
]

const ativo = (job: EvolutionHistoryImportJob | null) =>
  Boolean(job && ['pending', 'running', 'paused'].includes(job.status))

function mensagemDeErro(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro desconhecido'
}

function contagem(job: EvolutionHistoryImportJob | null) {
  const recuperadas = job?.inserted_count ?? 0
  const jaExistiam = job?.skipped_count ?? 0
  const falhas = job?.failed_count ?? 0
  const total = job?.total_messages ?? 0
  const analisadas = recuperadas + jaExistiam + falhas
  const pct = total > 0 ? Math.min(100, Math.round((analisadas / total) * 100)) : 0
  return { recuperadas, jaExistiam, falhas, total, analisadas, pct }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Nome técnico da instância na Evolution (`devices.instance_key`). */
  instanceName: string
  /** Nome que a equipe reconhece ("Financeiro PRN"). */
  nomeExibido: string
}

export function BuscadorDeMensagensDialog({ open, onOpenChange, instanceName, nomeExibido }: Props) {
  const hoje = paraInputData(new Date())
  const [preset, setPreset] = useState<PresetPeriodo>('hoje')
  const [de, setDe] = useState(hoje)
  const [ate, setAte] = useState(hoje)

  const [verificando, setVerificando] = useState(false)
  const [preview, setPreview] = useState<BuscaPorPeriodoPreview | null>(null)
  const [job, setJob] = useState<EvolutionHistoryImportJob | null>(null)
  const [rodando, setRodando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const pararRef = useRef(false)

  // Ao abrir: zera a tela e mostra busca que ficou em andamento (aba fechada no
  // meio, por exemplo) para o atendente continuar ou cancelar.
  useEffect(() => {
    if (!open) {
      pararRef.current = true
      return
    }
    pararRef.current = false
    setPreview(null)
    setErro(null)
    setAviso(null)
    setJob(null)
    let vivo = true
    getHistoryImportStatus({ instanceName })
      .then(({ job: ultimo }) => {
        if (vivo && ultimo && ativo(ultimo)) setJob(ultimo)
      })
      .catch(() => { /* sem job anterior não é erro */ })
    return () => { vivo = false }
  }, [open, instanceName])

  const periodoAtual = (): PeriodoBusca | null => {
    // Calculado no CLIQUE: "hoje" vai até o segundo em que o botão foi apertado.
    const p = montarPeriodo(preset, { de, ate })
    if ('erro' in p) {
      setErro(p.erro)
      return null
    }
    return p
  }

  const verificar = async () => {
    const periodo = periodoAtual()
    if (!periodo) return
    setVerificando(true)
    setErro(null)
    setAviso(null)
    try {
      const r = await verificarPeriodo({ instanceName, ...periodo })
      setPreview(r)
      if (r.activeJob) setJob(r.activeJob)
    } catch (err) {
      setErro(mensagemDeErro(err))
    } finally {
      setVerificando(false)
    }
  }

  const processar = async (inicial: EvolutionHistoryImportJob) => {
    pararRef.current = false
    setRodando(true)
    setErro(null)
    let atual = inicial
    try {
      while (!pararRef.current && ativo(atual)) {
        const r = await runHistoryImport({ instanceName, jobId: atual.id, pagesPerRun: 1 })
        atual = r.job
        setJob(r.job)
        if (r.done) break
        await new Promise((ok) => setTimeout(ok, INTERVALO_MS))
      }
    } catch (err) {
      if (err instanceof EvolutionHistoryImportError && err.job) setJob(err.job)
      setErro(mensagemDeErro(err))
    } finally {
      setRodando(false)
    }
  }

  const sincronizar = async () => {
    const periodo = periodoAtual()
    if (!periodo) return
    setRodando(true)
    setErro(null)
    setAviso(null)
    try {
      const r = await iniciarSincronizacaoDoPeriodo({ instanceName, ...periodo, recentMediaDays: DIAS_DE_MIDIA })
      if (!r.job) {
        setRodando(false)
        setAviso('A Evolution não tem nenhuma mensagem deste número nesse período. Nada a sincronizar.')
        return
      }
      setJob(r.job)
      await processar(r.job)
    } catch (err) {
      // 409 = já existe busca ativa nesta instância: mostra para continuar/cancelar.
      if (err instanceof EvolutionHistoryImportError && err.job) setJob(err.job)
      setErro(mensagemDeErro(err))
      setRodando(false)
    }
  }

  const parar = () => {
    pararRef.current = true
  }

  const cancelar = async () => {
    if (!job) return
    pararRef.current = true
    try {
      const r = await cancelHistoryImport({ instanceName, jobId: job.id })
      setJob(r.job)
    } catch (err) {
      setErro(mensagemDeErro(err))
    }
  }

  const c = contagem(job)
  const concluido = job?.status === 'completed'
  const emAndamento = ativo(job)
  const ocupado = verificando || rodando

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <GlassDialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarSearch className="h-5 w-5 text-primary" /> Buscar mensagens
          </DialogTitle>
          <DialogDescription>
            <strong>{nomeExibido}</strong>: busca na Evolution as mensagens do período e grava no sistema só as que
            estiverem faltando. Nunca duplica.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 1. Período */}
          <div className="space-y-2">
            <Label>Período</Label>
            <ToggleGroup
              type="single"
              value={preset}
              onValueChange={(v) => {
                if (!v) return
                setPreset(v as PresetPeriodo)
                setPreview(null)
                setErro(null)
              }}
              className="flex flex-wrap justify-start gap-1"
              disabled={ocupado}
            >
              {PRESETS.map((p) => (
                <ToggleGroupItem key={p.valor} value={p.valor} size="sm" variant="outline" className="text-xs">
                  {p.rotulo}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            {preset === 'personalizado' && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label htmlFor="busca-de" className="text-xs text-muted-foreground">De</Label>
                  <Input
                    id="busca-de"
                    type="date"
                    value={de}
                    max={hoje}
                    onChange={(e) => { setDe(e.target.value); setPreview(null) }}
                    disabled={ocupado}
                    className="bg-muted"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="busca-ate" className="text-xs text-muted-foreground">Até</Label>
                  <Input
                    id="busca-ate"
                    type="date"
                    value={ate}
                    max={hoje}
                    onChange={(e) => { setAte(e.target.value); setPreview(null) }}
                    disabled={ocupado}
                    className="bg-muted"
                  />
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Começa às 00:00:00 do primeiro dia. Se o período termina hoje, vai até o segundo em que você clicar.
            </p>
          </div>

          {/* 2. Verificação */}
          {preview && !emAndamento && !concluido && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                {formatarMomento(preview.from)} até {formatarMomento(preview.to)}
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Na Evolution</p>
                  <p className="text-xl font-semibold">{preview.totalEvolution}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">No sistema</p>
                  <p className="text-xl font-semibold">{preview.totalLocal}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Podem faltar</p>
                  <p className="text-xl font-semibold">~{preview.estimatedMissing}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                "Podem faltar" é uma estimativa. A conta exata sai ao sincronizar, que compara mensagem por mensagem.
              </p>
            </div>
          )}

          {/* 3. Progresso / resultado */}
          {job && (emAndamento || concluido || job.status === 'failed' || job.status === 'cancelled') && (
            <div className="rounded-lg border border-border p-3 space-y-3">
              {job.range_from && job.range_to && (
                <p className="text-xs text-muted-foreground">
                  {formatarMomento(job.range_from)} até {formatarMomento(job.range_to)}
                </p>
              )}
              {concluido ? (
                <p className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Pronto
                </p>
              ) : (
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{rodando ? 'Sincronizando…' : emAndamento ? 'Busca parada no meio' : 'Busca interrompida'}</span>
                    <span className="text-muted-foreground">{c.analisadas} de {c.total}</span>
                  </div>
                  <Progress value={c.pct} />
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Recuperadas</p>
                  <p className="font-semibold">{c.recuperadas}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Já estavam</p>
                  <p className="font-semibold">{c.jaExistiam}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Falhas</p>
                  <p className="font-semibold">{c.falhas}</p>
                </div>
              </div>
              {rodando && (
                <p className="text-xs text-muted-foreground">Mantenha esta janela aberta até terminar.</p>
              )}
              {!job.range_from && emAndamento && (
                <p className="text-xs text-muted-foreground">
                  Esta é uma importação antiga (por páginas). Continue até o fim ou cancele para buscar por período.
                </p>
              )}
            </div>
          )}

          {aviso && (
            <p className="rounded-md border border-border bg-muted p-2 text-sm text-muted-foreground">{aviso}</p>
          )}
          {erro && (
            <p className="rounded-md border border-red-500/20 bg-red-500/10 p-2 text-sm text-red-400 whitespace-pre-line">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {rodando ? (
            <Button variant="outline" onClick={parar} className="gap-2 w-full sm:w-auto">
              <Square className="h-4 w-4" /> Parar
            </Button>
          ) : emAndamento && job ? (
            <>
              <Button variant="destructive" onClick={cancelar} className="gap-2 w-full sm:w-auto">
                <Square className="h-4 w-4" /> Cancelar busca
              </Button>
              <Button onClick={() => processar(job)} className="gap-2 w-full sm:w-auto">
                <RefreshCw className="h-4 w-4" /> Continuar
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={verificar} disabled={ocupado} className="gap-2 w-full sm:w-auto">
                {verificando ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Verificar
              </Button>
              <Button onClick={sincronizar} disabled={ocupado} className="gap-2 w-full sm:w-auto">
                <RefreshCw className="h-4 w-4" />
                {concluido ? 'Sincronizar de novo' : 'Sincronizar'}
              </Button>
            </>
          )}
        </DialogFooter>
      </GlassDialogContent>
    </Dialog>
  )
}
