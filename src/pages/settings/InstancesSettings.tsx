import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RefreshCw,
  Plus,
  Link,
  Unlink,
  Trash2,
  Edit,
  DownloadCloud,
  CheckCircle2,
  Clock,
  AlertCircle,
  Smartphone,
  QrCode,
  History,
  Play,
  Square,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import {
  listEvolutionInstances,
  createEvolutionInstance,
  connectEvolutionInstance,
  disconnectEvolutionInstance,
  deleteEvolutionInstance,
  renameEvolutionDisplay,
  configureInstanceWebhook,
  EvolutionApiError,
  type EvolutionInstance,
  type QrCodeData,
} from '@/services/evolution_instances'
import {
  FINANCEIRO_MEDIMAGEM_INSTANCE,
  ALLOWED_HISTORY_INSTANCES,
  previewHistoryImport,
  startHistoryImport,
  runHistoryImport,
  getHistoryImportStatus,
  cancelHistoryImport,
  EvolutionHistoryImportError,
  type EvolutionHistoryImportJob,
  type EvolutionHistoryPreview,
} from '@/services/evolution_history_import'

const statusBadge = (normalizedStatus: string) => {
  switch (normalizedStatus) {
    case 'connected':
      return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Conectado</Badge>
    case 'disconnected':
      return <Badge variant="secondary">Desconectado</Badge>
    case 'connecting':
      return (
        <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 gap-1">
          <Clock className="h-3 w-3 animate-spin" /> Conectando
        </Badge>
      )
    default:
      return <Badge variant="outline" className="gap-1"><AlertCircle className="h-3 w-3" /> {normalizedStatus}</Badge>
  }
}

function formatError(err: unknown): string {
  if (err instanceof EvolutionHistoryImportError) {
    let msg = err.message
    if (err.details) {
      const detailStr = typeof err.details === 'string' ? err.details
        : JSON.stringify(err.details).slice(0, 300)
      msg += `\nDetalhes: ${detailStr}`
    }
    if (err.job?.error_message) msg += `\nJob: ${err.job.error_message}`
    return msg
  }

  if (err instanceof EvolutionApiError) {
    let msg = err.message
    if (err.details) {
      const detailStr = typeof err.details === 'string' ? err.details
        : JSON.stringify(err.details).slice(0, 300)
      msg += `\nDetalhes: ${detailStr}`
    }
    if (err.diagnostics) {
      const diagStr = typeof err.diagnostics === 'string' ? err.diagnostics
        : JSON.stringify(err.diagnostics).slice(0, 400)
      msg += `\nDiagnóstico: ${diagStr}`
    }
    return msg
  }
  return err instanceof Error ? err.message : 'Erro desconhecido'
}

const historyStatusLabel = (status?: string | null) => {
  switch (status) {
    case 'pending': return 'Pendente'
    case 'running': return 'Rodando'
    case 'paused': return 'Pausado'
    case 'completed': return 'Concluído'
    case 'failed': return 'Falhou'
    case 'cancelled': return 'Cancelado'
    default: return 'Sem job'
  }
}

const isActiveHistoryJob = (job: EvolutionHistoryImportJob | null) =>
  Boolean(job && ['pending', 'running', 'paused'].includes(job.status))

export default function InstancesSettings() {
  const { toast } = useToast()
  const [instances, setInstances] = useState<EvolutionInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDisplay, setCreateDisplay] = useState('')
  const [creating, setCreating] = useState(false)

  // QR modal
  const [qrOpen, setQrOpen] = useState(false)
  const [qrData, setQrData] = useState<QrCodeData | null>(null)
  const [qrInstance, setQrInstance] = useState('')

  // Rename modal
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameInstance, setRenameInstance] = useState('')
  const [renameDisplay, setRenameDisplay] = useState('')
  const [renaming, setRenaming] = useState(false)

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<EvolutionInstance | null>(null)
  const [deleting, setDeleting] = useState(false)

  // History import modal
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyInstance, setHistoryInstance] = useState(FINANCEIRO_MEDIMAGEM_INSTANCE)
  const [historyPreview, setHistoryPreview] = useState<EvolutionHistoryPreview | null>(null)
  const [historyJob, setHistoryJob] = useState<EvolutionHistoryImportJob | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRunning, setHistoryRunning] = useState(false)
  const [historyAutoRunning, setHistoryAutoRunning] = useState(false)
  const historyAutoStopRef = useRef(false)

  const loadInstances = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listEvolutionInstances()
      setInstances(result.instances)
    } catch (err: unknown) {
      toast({ title: 'Erro ao carregar instâncias', description: formatError(err), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadInstances()
  }, [loadInstances])

  const stats = useMemo(() => {
    const total = instances.length
    const connected = instances.filter((i) => i.normalizedStatus === 'connected').length
    const disconnected = instances.filter((i) => i.normalizedStatus === 'disconnected').length
    const notImported = instances.filter((i) => !i.alreadyImported).length
    return { total, connected, disconnected, notImported }
  }, [instances])

  const handleCreate = async () => {
    const name = createName.trim()
    if (!name) {
      toast({ title: 'Nome técnico é obrigatório', variant: 'destructive' })
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      toast({ title: 'Nome técnico: apenas letras, números, hífen e sublinhado', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const result = await createEvolutionInstance({
        instanceName: name,
        displayName: createDisplay.trim() || undefined,
      })
      toast({ title: 'Instância criada', description: `${result.instanceName} criada com sucesso.` })
      setCreateOpen(false)
      setCreateName('')
      setCreateDisplay('')
      if (result.qrcode) {
        setQrData(result.qrcode)
        setQrInstance(name)
        setQrOpen(true)
      }
      await loadInstances()
    } catch (err: unknown) {
      toast({ title: 'Erro ao criar', description: formatError(err), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const handleConnect = async (instanceName: string) => {
    setActionLoading(instanceName)
    try {
      const result = await connectEvolutionInstance(instanceName)
      if (result.qrcode) {
        setQrData(result.qrcode)
        setQrInstance(instanceName)
        setQrOpen(true)
      } else {
        toast({ title: 'QR Code não retornado pela Evolution API', variant: 'destructive' })
      }
    } catch (err: unknown) {
      toast({ title: 'Erro ao conectar', description: formatError(err), variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleDisconnect = async (instanceName: string) => {
    setActionLoading(instanceName)
    try {
      await disconnectEvolutionInstance(instanceName)
      toast({ title: 'Instância desconectada', description: instanceName })
      await loadInstances()
    } catch (err: unknown) {
      toast({ title: 'Erro ao desconectar', description: formatError(err), variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setDeleting(true)
    try {
      await deleteEvolutionInstance(deleteConfirm.instanceName)
      toast({ title: 'Instância deletada', description: `${deleteConfirm.instanceName} removida com soft delete.` })
      setDeleteConfirm(null)
      await loadInstances()
    } catch (err: unknown) {
      toast({ title: 'Erro ao deletar', description: formatError(err), variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const handleRename = async () => {
    const name = renameDisplay.trim()
    if (!name) {
      toast({ title: 'Nome exibido é obrigatório', variant: 'destructive' })
      return
    }
    setRenaming(true)
    try {
      await renameEvolutionDisplay(renameInstance, name)
      toast({ title: 'Nome atualizado', description: `Agora exibe "${name}"` })
      setRenameOpen(false)
      await loadInstances()
    } catch (err: unknown) {
      toast({ title: 'Erro ao renomear', description: formatError(err), variant: 'destructive' })
    } finally {
      setRenaming(false)
    }
  }

  const handleConfigureWebhook = async (instanceName: string) => {
    setActionLoading(instanceName)
    try {
      const result = await configureInstanceWebhook(instanceName)
      toast({
        title: result.configured ? 'Webhook configurado' : 'Falha ao configurar webhook',
        variant: result.configured ? 'default' : 'destructive',
      })
    } catch (err: unknown) {
      toast({ title: 'Erro no webhook', description: formatError(err), variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const refreshQr = async () => {
    if (!qrInstance) return
    setActionLoading(qrInstance)
    try {
      const result = await connectEvolutionInstance(qrInstance)
      if (result.qrcode) {
        setQrData(result.qrcode)
      } else {
        toast({ title: 'Evolution API não retornou QR', variant: 'destructive' })
      }
    } catch (err: unknown) {
      toast({ title: 'Erro ao atualizar QR', description: formatError(err), variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const openHistoryImport = async (instanceName: string) => {
    setHistoryInstance(instanceName)
    setHistoryOpen(true)
    setHistoryLoading(true)
    setHistoryPreview(null)
    setHistoryJob(null)
    try {
      const [preview, status] = await Promise.all([
        previewHistoryImport(instanceName),
        getHistoryImportStatus({ instanceName }),
      ])
      setHistoryPreview(preview)
      setHistoryJob(status.job || preview.latestJob)
    } catch (err: unknown) {
      toast({ title: 'Erro ao carregar preview', description: formatError(err), variant: 'destructive' })
    } finally {
      setHistoryLoading(false)
    }
  }

  const refreshHistory = async () => {
    setHistoryLoading(true)
    try {
      const [preview, status] = await Promise.all([
        previewHistoryImport(historyInstance),
        getHistoryImportStatus({ instanceName: historyInstance, jobId: historyJob?.id }),
      ])
      setHistoryPreview(preview)
      setHistoryJob(status.job || preview.latestJob)
    } catch (err: unknown) {
      toast({ title: 'Erro ao atualizar histórico', description: formatError(err), variant: 'destructive' })
    } finally {
      setHistoryLoading(false)
    }
  }

  const startHistory = async (mode: 'test' | 'last_1000' | 'all') => {
    historyAutoStopRef.current = true
    setHistoryRunning(true)
    try {
      const result = await startHistoryImport({
        instanceName: historyInstance,
        mode,
        pageSize: 50,
        recentMediaDays: 7,
      })
      setHistoryJob(result.job)
      toast({ title: 'Importação criada', description: `${historyStatusLabel(result.job.status)} - página ${result.job.current_page}` })
    } catch (err: unknown) {
      if (err instanceof EvolutionHistoryImportError && err.job) setHistoryJob(err.job)
      toast({ title: 'Erro ao iniciar importação', description: formatError(err), variant: 'destructive' })
    } finally {
      setHistoryRunning(false)
    }
  }

  const processHistoryBatch = async () => {
    if (!historyJob) return
    historyAutoStopRef.current = true
    setHistoryRunning(true)
    try {
      const result = await runHistoryImport({
        instanceName: historyInstance,
        jobId: historyJob.id,
        pagesPerRun: 2,
      })
      setHistoryJob(result.job)
      toast({
        title: result.done ? 'Importação concluída' : 'Lote processado',
        description: `Inseridas: ${result.inserted} | Duplicadas: ${result.skipped} | Falhas: ${result.failed}`,
      })
      if (result.done) await refreshHistory()
    } catch (err: unknown) {
      if (err instanceof EvolutionHistoryImportError && err.job) setHistoryJob(err.job)
      toast({ title: 'Erro ao processar lote', description: formatError(err), variant: 'destructive' })
    } finally {
      setHistoryRunning(false)
    }
  }

  const processHistoryUntilDone = async () => {
    if (!historyJob) return
    historyAutoStopRef.current = false
    setHistoryAutoRunning(true)
    setHistoryRunning(true)

    let currentJob = historyJob
    let totalInserted = 0
    let totalSkipped = 0
    let totalFailed = 0

    try {
      while (!historyAutoStopRef.current && isActiveHistoryJob(currentJob) && currentJob.current_page <= currentJob.target_pages) {
        const result = await runHistoryImport({
          instanceName: historyInstance,
          jobId: currentJob.id,
          pagesPerRun: 2,
        })

        totalInserted += result.inserted
        totalSkipped += result.skipped
        totalFailed += result.failed
        currentJob = result.job
        setHistoryJob(result.job)

        if (result.failed > 0 || result.job.failed_count > 0 || result.job.status === 'failed') {
          toast({
            title: 'Processamento pausado por falha',
            description: `Inseridas: ${totalInserted} | Duplicadas: ${totalSkipped} | Falhas: ${totalFailed}`,
            variant: 'destructive',
          })
          return
        }

        if (result.done || result.job.status === 'completed') {
          await refreshHistory()
          toast({
            title: 'Importação concluída',
            description: `Inseridas: ${totalInserted} | Duplicadas: ${totalSkipped} | Falhas: ${totalFailed}`,
          })
          return
        }

        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      if (historyAutoStopRef.current) {
        toast({ title: 'Processamento automático interrompido' })
      }
    } catch (err: unknown) {
      if (err instanceof EvolutionHistoryImportError && err.job) setHistoryJob(err.job)
      toast({ title: 'Erro ao processar automaticamente', description: formatError(err), variant: 'destructive' })
    } finally {
      historyAutoStopRef.current = true
      setHistoryAutoRunning(false)
      setHistoryRunning(false)
    }
  }

  const cancelHistory = async () => {
    if (!historyJob) return
    historyAutoStopRef.current = true
    setHistoryRunning(true)
    try {
      const result = await cancelHistoryImport({ instanceName: historyInstance, jobId: historyJob.id })
      setHistoryJob(result.job)
      toast({ title: 'Importação cancelada' })
    } catch (err: unknown) {
      toast({ title: 'Erro ao cancelar importação', description: formatError(err), variant: 'destructive' })
    } finally {
      setHistoryRunning(false)
    }
  }

  const historyDerived = useMemo(() => {
    const targetPages = historyJob?.target_pages || historyPreview?.totalPages || 0
    const processedPages = historyJob ? Math.max(0, Math.min(targetPages, historyJob.current_page - 1)) : 0
    const progress = targetPages > 0 ? Math.round((processedPages / targetPages) * 100) : 0
    const canStart = !isActiveHistoryJob(historyJob)
    const canProcess = Boolean(historyJob && isActiveHistoryJob(historyJob) && historyJob.current_page <= historyJob.target_pages)
    return { targetPages, processedPages, progress, canStart, canProcess }
  }, [historyJob, historyPreview])
  const { targetPages: historyTargetPages, processedPages: historyProcessedPages, progress: historyProgress, canStart: canStartHistory, canProcess: canProcessHistory } = historyDerived

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Instâncias Evolution</h1>
          <p className="text-muted-foreground">
            Gerencie criação, conexão e status das instâncias da Evolution API.
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={loadInstances} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button onClick={() => { setCreateName(''); setCreateDisplay(''); setCreateOpen(true) }} className="gap-2">
            <Plus className="h-4 w-4" /> Criar Instância
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Card className="bg-muted backdrop-blur-sm border-border">
          <CardHeader className="pb-2"><CardTitle className="text-2xl">{stats.total}</CardTitle></CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">Total na Evolution</p></CardContent>
        </Card>
        <Card className="bg-muted backdrop-blur-sm border-border">
          <CardHeader className="pb-2"><CardTitle className="text-2xl text-green-500">{stats.connected}</CardTitle></CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">Conectadas</p></CardContent>
        </Card>
        <Card className="bg-muted backdrop-blur-sm border-border">
          <CardHeader className="pb-2"><CardTitle className="text-2xl">{stats.disconnected}</CardTitle></CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">Desconectadas</p></CardContent>
        </Card>
        <Card className="bg-muted backdrop-blur-sm border-border">
          <CardHeader className="pb-2"><CardTitle className="text-2xl text-yellow-500">{stats.notImported}</CardTitle></CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">Não importadas</p></CardContent>
        </Card>
      </div>

      <Card className="bg-muted backdrop-blur-sm border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" /> Instâncias Cadastradas
          </CardTitle>
          <CardDescription>Instâncias encontradas na Evolution API.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 flex flex-col items-center gap-3 text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin" />
              Buscando instâncias...
            </div>
          ) : instances.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground border border-dashed border-border rounded-xl">
              Nenhuma instância encontrada na Evolution API.
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_auto_auto_auto] gap-3 px-3 py-2 bg-muted text-xs font-medium text-muted-foreground border-b border-border">
                <span>Instância</span>
                <span>Status</span>
                <span>Sistema</span>
                <span className="text-right">Ações</span>
                <span />
              </div>
              <div className="divide-y divide-border">
                {instances.map((instance, index) => {
                  const name = instance.instanceName
                  const displayName = instance.device?.name || name || 'Desconhecida'
                  const isActionLoading = actionLoading === name
                  const isInvalid = !name
                  return (
                    <div key={name || `invalid-${index}`} className={`grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto_auto] gap-2 px-3 py-3 items-start sm:items-center ${isInvalid ? 'opacity-50' : ''}`}>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{displayName}</p>
                        <div className="flex flex-wrap gap-1 mt-1 text-xs text-muted-foreground">
                          {name ? (
                            <Badge variant="outline" className="text-[10px]">{name}</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px]">Sem nome técnico</Badge>
                          )}
                          {instance.profileName && <span>Perfil: {instance.profileName}</span>}
                          {instance.ownerJid && <span>{instance.ownerJid}</span>}
                        </div>
                      </div>
                      <div>{statusBadge(instance.normalizedStatus)}</div>
                      <div>
                        {instance.alreadyImported ? (
                          <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Importado
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <DownloadCloud className="h-3 w-3" /> Novo
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 justify-end">
                        {instance.normalizedStatus === 'connected' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={!name || isActionLoading}
                            onClick={() => name && handleDisconnect(name)}
                          >
                            {isActionLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                            <span className="hidden sm:inline">Desconectar</span>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={!name || isActionLoading}
                            onClick={() => name && handleConnect(name)}
                          >
                            {isActionLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Link className="h-3 w-3" />}
                            <span className="hidden sm:inline">Conectar</span>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={!name}
                          onClick={() => {
                            if (!name) return
                            setRenameInstance(name)
                            setRenameDisplay(instance.device?.name || name)
                            setRenameOpen(true)
                          }}
                        >
                          <Edit className="h-3 w-3" />
                          <span className="hidden sm:inline">Renomear</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={!name || isActionLoading}
                          onClick={() => name && handleConfigureWebhook(name)}
                        >
                          {isActionLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <QrCode className="h-3 w-3" />}
                          <span className="hidden sm:inline">Webhook</span>
                        </Button>
                        {name && ALLOWED_HISTORY_INSTANCES.includes(name) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={!name || isActionLoading}
                            onClick={() => openHistoryImport(name)}
                          >
                            <History className="h-3 w-3" />
                            <span className="hidden sm:inline">Histórico</span>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1 text-red-400 hover:text-red-400"
                          disabled={!name}
                          onClick={() => name && setDeleteConfirm(instance)}
                        >
                          <Trash2 className="h-3 w-3" />
                          <span className="hidden sm:inline">Deletar</span>
                        </Button>
                      </div>
                      <div />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle>Criar Instância</DialogTitle>
            <DialogDescription>
              Crie uma nova instância na Evolution API e vincule ao sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="instanceName">Nome técnico</Label>
              <Input
                id="instanceName"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Ex: comercial-01"
                className="bg-muted font-mono"
              />
              <p className="text-xs text-muted-foreground">Apenas letras, números, hífen e sublinhado. Não pode ser alterado depois.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Nome exibido (opcional)</Label>
              <Input
                id="displayName"
                value={createDisplay}
                onChange={(e) => setCreateDisplay(e.target.value)}
                placeholder="Ex: Comercial 01"
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">Se não informado, usa o nome técnico.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating} className="gap-2">
              {creating && <RefreshCw className="h-4 w-4 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Modal */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle>Conectar WhatsApp</DialogTitle>
            <DialogDescription>
              Instância: <strong>{qrInstance}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrData?.base64 ? (
              <img
                src={qrData.base64.startsWith('data:') ? qrData.base64 : `data:image/png;base64,${qrData.base64}`}
                alt="QR Code"
                className="w-56 h-56 rounded-lg border border-border"
              />
            ) : qrData?.pairingCode ? (
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">Código de pareamento:</p>
                <p className="text-2xl font-mono font-bold tracking-widest bg-muted px-4 py-3 rounded-lg border border-border">
                  {qrData.pairingCode}
                </p>
              </div>
            ) : qrData?.code ? (
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">Código:</p>
                <p className="text-xl font-mono font-bold bg-muted px-4 py-3 rounded-lg border border-border">
                  {qrData.code}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">Nenhum QR Code retornado pela Evolution API.</p>
            )}
            <p className="text-xs text-muted-foreground text-center">
              Abra o WhatsApp no celular &gt; Aparelhos conectados &gt; Conectar aparelho.
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="gap-2 w-full sm:w-auto"
              onClick={refreshQr}
              disabled={actionLoading === qrInstance}
            >
              <RefreshCw className={`h-4 w-4 ${actionLoading === qrInstance ? 'animate-spin' : ''}`} />
              Atualizar QR
            </Button>
            <Button variant="outline" onClick={() => setQrOpen(false)} className="w-full sm:w-auto">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Import Modal */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle>Importar histórico</DialogTitle>
            <DialogDescription>
              Instância: <strong>{historyInstance}</strong>. Mensagens serão sincronizadas; mídia real somente dos últimos 7 dias.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {historyLoading ? (
              <div className="py-8 flex flex-col items-center gap-3 text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin" />
                Carregando dados do histórico...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-border bg-muted p-3">
                    <p className="text-xs text-muted-foreground">Evolution</p>
                    <p className="text-xl font-semibold">{historyPreview?.totalEvolution ?? '-'}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted p-3">
                    <p className="text-xs text-muted-foreground">Sistema</p>
                    <p className="text-xl font-semibold">{historyPreview?.totalLocal ?? '-'}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted p-3">
                    <p className="text-xs text-muted-foreground">Faltantes</p>
                    <p className="text-xl font-semibold">{historyPreview?.estimatedMissing ?? '-'}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted p-3">
                    <p className="text-xs text-muted-foreground">Páginas</p>
                    <p className="text-xl font-semibold">{historyPreview?.totalPages ?? '-'}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <p className="font-medium">Status do job</p>
                      <p className="text-sm text-muted-foreground">
                        {historyStatusLabel(historyJob?.status)}
                        {historyJob ? ` - página ${historyProcessedPages}/${historyTargetPages}` : ''}
                      </p>
                    </div>
                    <Badge variant={historyJob?.status === 'completed' ? 'default' : historyJob?.status === 'failed' ? 'destructive' : 'outline'}>
                      {historyStatusLabel(historyJob?.status)}
                    </Badge>
                  </div>

                  <Progress value={historyProgress} />

                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">Inseridas</p>
                      <p className="font-medium">{historyJob?.inserted_count ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Duplicadas</p>
                      <p className="font-medium">{historyJob?.skipped_count ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Falhas</p>
                      <p className="font-medium">{historyJob?.failed_count ?? 0}</p>
                    </div>
                  </div>

                  {historyJob?.error_message && (
                    <p className="rounded-md border border-red-500/20 bg-red-500/10 p-2 text-sm text-red-400">
                      {historyJob.error_message}
                    </p>
                  )}

                  {historyAutoRunning && (
                    <p className="rounded-md border border-blue-500/20 bg-blue-500/10 p-2 text-sm text-blue-400">
                      Processando automaticamente. Pode fazer outras coisas, mas mantenha esta aba aberta.
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm text-muted-foreground">
                  Mensagens históricas entram como lidas, sem notificação e sem incrementar não-lidas. Arquivos de mídia antigos ficam como placeholder.
                </div>
              </>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row sm:flex-wrap gap-2">
            <Button variant="outline" onClick={refreshHistory} disabled={historyLoading || historyRunning || historyAutoRunning} className="gap-2 w-full sm:w-auto">
              <RefreshCw className={`h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Button variant="outline" onClick={() => startHistory('test')} disabled={!canStartHistory || historyLoading || historyRunning || historyAutoRunning} className="gap-2 w-full sm:w-auto">
              <Play className="h-4 w-4" />
              Testar 2 páginas
            </Button>
            <Button variant="outline" onClick={() => startHistory('last_1000')} disabled={!canStartHistory || historyLoading || historyRunning || historyAutoRunning} className="gap-2 w-full sm:w-auto">
              <Play className="h-4 w-4" />
              Importar 1000
            </Button>
            <Button variant="outline" onClick={() => startHistory('all')} disabled={!canStartHistory || historyLoading || historyRunning || historyAutoRunning} className="gap-2 w-full sm:w-auto">
              <Play className="h-4 w-4" />
              Importar tudo
            </Button>
            <Button variant="outline" onClick={processHistoryBatch} disabled={!canProcessHistory || historyLoading || historyRunning || historyAutoRunning} className="gap-2 w-full sm:w-auto">
              {historyRunning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Processar lote
            </Button>
            <Button onClick={processHistoryUntilDone} disabled={!canProcessHistory || historyLoading || historyRunning || historyAutoRunning} className="gap-2 w-full sm:w-auto">
              {historyAutoRunning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Processar até concluir
            </Button>
            <Button variant="destructive" onClick={cancelHistory} disabled={!isActiveHistoryJob(historyJob) || historyLoading} className="gap-2 w-full sm:w-auto">
              <Square className="h-4 w-4" />
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Modal */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle>Renomear Instância</DialogTitle>
            <DialogDescription>
              Altere apenas o nome exibido no sistema. O nome técnico permanece inalterado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <Label>Nome técnico</Label>
              <p className="text-sm font-mono text-muted-foreground bg-muted px-3 py-2 rounded-md border border-border">{renameInstance}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="renameDisplay">Nome exibido</Label>
              <Input
                id="renameDisplay"
                value={renameDisplay}
                onChange={(e) => setRenameDisplay(e.target.value)}
                className="bg-muted"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={renaming}>Cancelar</Button>
            <Button onClick={handleRename} disabled={renaming} className="gap-2">
              {renaming && <RefreshCw className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar Instância</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação irá:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
            <li>Remover/desativar a instância na Evolution API.</li>
            <li>Marcar o aparelho como deletado no sistema (soft delete).</li>
            <li>Preservar o histórico de mensagens.</li>
          </ul>
          {deleteConfirm && (
            <p className="text-sm font-medium">
              Instância: <strong>{deleteConfirm.instanceName}</strong>
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white gap-2"
            >
              {deleting && <RefreshCw className="h-4 w-4 animate-spin" />}
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
