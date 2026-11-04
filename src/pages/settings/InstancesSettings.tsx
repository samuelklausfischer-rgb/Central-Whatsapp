import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RefreshCw,
  Plus,
  Link,
  Unlink,
  Trash2,
  Edit,
  DownloadCloud,
  CheckCircle2,
  Smartphone,
  QrCode,
  CalendarSearch,
  RotateCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { StatBlock } from '@/components/ui/stat-block'
import { ListRow, ListRowPill } from '@/components/ui/list-row'
import { EstadoPainel } from '@/components/ui/estado-painel'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
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
import { useToast } from '@/hooks/use-toast'
import {
  listEvolutionInstances,
  createEvolutionInstance,
  connectEvolutionInstance,
  disconnectEvolutionInstance,
  restartEvolutionInstance,
  deleteEvolutionInstance,
  renameEvolutionDisplay,
  configureInstanceWebhook,
  EvolutionApiError,
  type EvolutionInstance,
  type QrCodeData,
} from '@/services/evolution_instances'
import { EvolutionHistoryImportError } from '@/services/evolution_history_import'
import { BuscadorDeMensagensDialog } from '@/components/conexao/BuscadorDeMensagensDialog'

// Rótulo em texto puro do status da instância — antes vinha dentro de um
// `Badge` colorido (`statusBadge`, removido); agora a cor já é o ponto de
// `ListRow` (`status={tomStatus}` na linha), então só falta o texto por
// extenso ao lado, inclusive para quem lê a tela por leitor de tela.
const instanceStatusLabel = (normalizedStatus: string) => {
  switch (normalizedStatus) {
    case 'connected':
      return 'Conectado'
    case 'disconnected':
      return 'Desconectado'
    case 'connecting':
      return 'Conectando'
    default:
      return normalizedStatus
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

export default function InstancesSettings() {
  const { toast } = useToast()
  const [instances, setInstances] = useState<EvolutionInstance[]>([])
  const [loading, setLoading] = useState(true)
  // Erro separado de "lista vazia": antes, uma falha ao buscar na Evolution
  // deixava `instances` como estava (vazio no primeiro load) e a tela dizia
  // "Nenhuma instância encontrada" — a mesma leitura errada que o Dashboard
  // tinha antes do `EstadoPainel` existir.
  const [erroInstances, setErroInstances] = useState(false)
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

  // Buscar mensagens (substitui o antigo "Importar histórico" por lotes)
  const [buscaAlvo, setBuscaAlvo] = useState<{ instanceName: string; nomeExibido: string } | null>(null)

  const loadInstances = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listEvolutionInstances()
      setInstances(result.instances)
      setErroInstances(false)
    } catch (err: unknown) {
      setErroInstances(true)
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

  /**
   * Reiniciar = o "Restart" do painel da Evolution: mesma sessão, sem QR. Para o
   * número que aparece "Conectado" mas parou de receber (Financeiro PRN em
   * 04/11/2026). Depois, vale abrir "Buscar mensagens" em "Hoje" para trazer o
   * que ficou preso.
   */
  const handleRestart = async (instanceName: string) => {
    setActionLoading(instanceName)
    try {
      await restartEvolutionInstance(instanceName)
      toast({
        title: 'Conexão reiniciada',
        description: `${instanceName}: mande uma mensagem de teste e, se faltar algo, use "Buscar mensagens".`,
      })
      await loadInstances()
    } catch (err: unknown) {
      toast({ title: 'Erro ao reiniciar', description: formatError(err), variant: 'destructive' })
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Conexão WhatsApp</h1>
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

      {/*
        Eram 4 `Card` irmãos, cada um com `bg-muted backdrop-blur-sm` (opaco +
        blur morto, igual aos outros pontos deste arquivo) — quatro vidros
        colados por quatro números é ruído visual e um blur repetido à toa.
        `StatBlock` é UM `GlassCard` com os 4 números lado a lado, divisores
        finos entre colunas.
      */}
      <StatBlock
        itens={[
          { label: 'Total na Evolution', value: stats.total },
          { label: 'Conectadas', value: stats.connected, acento: 'esmeralda' },
          { label: 'Desconectadas', value: stats.disconnected },
          { label: 'Não importadas', value: stats.notImported, acento: 'ambar' },
        ]}
      />

      {/*
        Era `bg-muted backdrop-blur-sm` — mesmo blur morto de sempre. Este é
        o único `GlassCard` de verdade da tela, com as linhas em `ListRow` por
        dentro (nada de vidro aninhado).
      */}
      <GlassCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" /> Instâncias Cadastradas
          </CardTitle>
          <CardDescription>Instâncias encontradas na Evolution API.</CardDescription>
        </CardHeader>
        <CardContent>
          <EstadoPainel
            carregando={loading}
            erro={erroInstances}
            vazio={instances.length === 0}
            mensagemVazio="Nenhuma instância encontrada na Evolution API."
            aoTentarDeNovo={loadInstances}
          />
          {!loading && !erroInstances && instances.length > 0 && (
            // `divide-y divide-border` (idioma antigo) virou uma lista de
            // `ListRow`. O cabeçalho de colunas old-school (Instância/Status/
            // Sistema/Ações) saiu junto: `ListRow` é uma linha flexível, não
            // uma grade com colunas fixas — um cabeçalho alinhado por coluna
            // não fazia mais sentido em cima dela.
            <div className="space-y-1">
              {instances.map((instance, index) => {
                const name = instance.instanceName
                const displayName = instance.device?.name || name || 'Desconhecida'
                const isActionLoading = actionLoading === name
                const isInvalid = !name
                // Ponto de status no lugar do `Badge` colorido de sempre — a
                // cor já entrega "conectado/desconectado/conectando" de
                // relance; o rótulo por extenso continua ao lado para quem
                // precisar do texto (leitor de tela incluso).
                const tomStatus =
                  instance.normalizedStatus === 'connected' ? 'esmeralda'
                  : instance.normalizedStatus === 'connecting' ? 'ambar'
                  : instance.normalizedStatus === 'disconnected' ? 'ardosia'
                  : 'rosa'
                return (
                  <ListRow
                    key={name || `invalid-${index}`}
                    status={tomStatus}
                    className={`items-start sm:items-center flex-wrap sm:flex-nowrap ${isInvalid ? 'opacity-50' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{displayName}</p>
                      <div className="flex flex-wrap gap-1 mt-1 text-xs text-muted-foreground items-center">
                        {name ? (
                          <Badge variant="outline" className="text-[10px]">{name}</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">Sem nome técnico</Badge>
                        )}
                        <span>{instanceStatusLabel(instance.normalizedStatus)}</span>
                        {instance.profileName && <span>Perfil: {instance.profileName}</span>}
                        {instance.ownerJid && <span>{instance.ownerJid}</span>}
                      </div>
                    </div>
                    {instance.alreadyImported ? (
                      <ListRowPill tom="azul">
                        <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Importado</span>
                      </ListRowPill>
                    ) : (
                      <ListRowPill tom="ardosia">
                        <span className="inline-flex items-center gap-1"><DownloadCloud className="h-3 w-3" /> Novo</span>
                      </ListRowPill>
                    )}
                    <div className="flex flex-wrap gap-1 justify-end flex-shrink-0">
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
                      {name && instance.normalizedStatus !== 'disconnected' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={isActionLoading}
                          onClick={() => handleRestart(name)}
                          title="Reinicia a conexão sem pedir QR (o Restart da Evolution)"
                        >
                          {isActionLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                          <span className="hidden sm:inline">Reiniciar</span>
                        </Button>
                      )}
                      {name && instance.device && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={isActionLoading}
                          onClick={() => setBuscaAlvo({ instanceName: name, nomeExibido: displayName })}
                          title="Busca as mensagens de um período e grava só as que faltam"
                        >
                          <CalendarSearch className="h-3 w-3" />
                          <span className="hidden sm:inline">Buscar mensagens</span>
                        </Button>
                      )}
                    </div>
                  </ListRow>
                )
              })}
            </div>
          )}
        </CardContent>
      </GlassCard>

      {/* Create Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <GlassDialogContent className="sm:max-w-md">
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
        </GlassDialogContent>
      </Dialog>

      {/* QR Modal */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <GlassDialogContent className="sm:max-w-sm">
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
        </GlassDialogContent>
      </Dialog>

      {buscaAlvo && (
        <BuscadorDeMensagensDialog
          open={!!buscaAlvo}
          onOpenChange={(aberto) => !aberto && setBuscaAlvo(null)}
          instanceName={buscaAlvo.instanceName}
          nomeExibido={buscaAlvo.nomeExibido}
        />
      )}

      {/* Rename Modal */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <GlassDialogContent className="sm:max-w-md">
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
        </GlassDialogContent>
      </Dialog>

      {/* Delete Confirmation — `AlertDialogContent` vem de
          `@/components/ui/alert-dialog`, componente diferente do
          `Dialog`/`DialogContent` que o resto do arquivo usa. Não force o
          kit de vidro num componente que não é o dele: fica sólido mesmo,
          como pedido. */}
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
