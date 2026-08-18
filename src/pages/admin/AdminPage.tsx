import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CheckCircle2,
  DownloadCloud,
  Edit,
  Gavel,
  Mail,
  Plus,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Trash,
  User as UserIcon,
} from 'lucide-react'
import { getUsers, createUser, updateUser, deleteUser, type ManagedUser } from '@/services/users'
import { getToolUserIds, setToolAccess } from '@/services/tool_access'
import { getDevices, updateDevice } from '@/services/devices'
import {
  configureEvolutionWebhooks,
  fetchConnectedInstances,
  importEvolutionInstances,
  type EvolutionSyncInstance,
} from '@/services/instances'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { Badge } from '@/components/ui/badge'
import { extractFieldErrors } from '@/lib/errors'
import { SuperAdminPanel } from '@/components/admin/SuperAdminPanel'
import { FINANCEIRO_DEPARTMENT } from '@/lib/permissions'

const DEFAULT_DEPARTMENTS = [FINANCEIRO_DEPARTMENT, 'Administrativo', 'RH', 'Comercial']
const NO_DEPARTMENT = '__none__'

const getDepartmentLabel = (department?: string | null) => department || 'Sem setor'

export default function AdminPage() {
  const { user: currentUser, refreshProfile } = useAuth()
  const { toast } = useToast()

  const [users, setUsers] = useState<ManagedUser[]>([])
  const [devices, setDevices] = useState<any[]>([])
  const devicesMap = useMemo(() => new Map(devices.map((d: any) => [d.id, d])), [devices])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null)
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null)
  const [syncInstances, setSyncInstances] = useState<EvolutionSyncInstance[]>([])
  const [selectedSyncInstances, setSelectedSyncInstances] = useState<string[]>([])
  const [isSyncLoading, setIsSyncLoading] = useState(false)
  const [isImportingInstances, setIsImportingInstances] = useState(false)
  const [isConfiguringWebhooks, setIsConfiguringWebhooks] = useState(false)

  // Liberações que vivem em public.tool_access, e não em profiles: uma coluna em
  // profiles seria auto-atribuível — a policy users_update_own_profile só trava
  // `is_admin` no WITH CHECK.
  const [licitacaoUserIds, setLicitacaoUserIds] = useState<Set<string>>(new Set())
  const [propostaUserIds, setPropostaUserIds] = useState<Set<string>>(new Set())

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    username: '',
    password: '',
    department: '',
    is_admin: false,
    licitacoes_access: false,
    proposta_comercial_access: false,
    allowed_devices: [] as string[],
  })

  const departments = useMemo(() => {
    const values = new Set(DEFAULT_DEPARTMENTS)
    devices.forEach((device) => {
      if (device.department) values.add(device.department)
    })
    users.forEach((user) => {
      if (user.department) values.add(user.department)
    })
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [devices, users])

  const groupedUsers = useMemo(() => {
    const groups = new Map<string, ManagedUser[]>()
    ;[...users]
      .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''))
      .forEach((user) => {
        const key = getDepartmentLabel(user.department)
        groups.set(key, [...(groups.get(key) || []), user])
      })

    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'Sem setor') return 1
      if (b === 'Sem setor') return -1
      return a.localeCompare(b)
    })
  }, [users])

  const newSyncInstances = useMemo(
    () => syncInstances.filter((instance) => !instance.alreadyImported),
    [syncInstances],
  )

  const loadData = useCallback(async () => {
    try {
      const [uData, dData, licitacaoIds, propostaIds] = await Promise.all([
        getUsers(),
        getDevices(),
        getToolUserIds('licitacoes'),
        getToolUserIds('proposta-comercial'),
      ])
      setUsers(uData)
      setDevices(dData)
      setLicitacaoUserIds(new Set(licitacaoIds))
      setPropostaUserIds(new Set(propostaIds))
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar equipe', variant: 'destructive' })
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const getDevicesForDepartment = useCallback((department: string) => {
    if (!department) return []
    return devices.filter((device) => device.department === department).map((device) => device.id)
  }, [devices])

  const openCreateDialog = () => {
    setEditingUser(null)
    setFormData({
      name: '',
      email: '',
      username: '',
      password: '',
      department: '',
      is_admin: false,
      licitacoes_access: false,
      proposta_comercial_access: false,
      allowed_devices: [],
    })
    setIsDialogOpen(true)
  }

  const openEditDialog = (user: ManagedUser) => {
    setEditingUser(user)
    setFormData({
      name: user.name || '',
      email: user.email || '',
      username: user.username || '',
      password: '',
      department: user.department || '',
      is_admin: user.is_admin || false,
      licitacoes_access: licitacaoUserIds.has(user.id),
      proposta_comercial_access: propostaUserIds.has(user.id),
      allowed_devices: user.allowed_devices || [],
    })
    setIsDialogOpen(true)
  }

  const handleDepartmentChange = (value: string) => {
    const department = value === NO_DEPARTMENT ? '' : value
    setFormData((prev) => ({
      ...prev,
      department,
      allowed_devices: prev.is_admin ? [] : getDevicesForDepartment(department),
    }))
  }

  const handleDeviceToggle = (deviceId: string) => {
    setFormData((prev) => ({
      ...prev,
      allowed_devices: prev.allowed_devices.includes(deviceId)
        ? prev.allowed_devices.filter((id) => id !== deviceId)
        : [...prev.allowed_devices, deviceId],
    }))
  }

  const handleDeviceDepartmentChange = async (deviceId: string, value: string) => {
    const department = value === NO_DEPARTMENT ? null : value
    setSavingDeviceId(deviceId)
    try {
      await updateDevice(deviceId, { department })
      toast({ title: 'Setor do celular atualizado' })
      await loadData()
      await refreshProfile()
    } catch (err: any) {
      toast({ title: 'Erro ao atualizar celular', description: err.message, variant: 'destructive' })
    } finally {
      setSavingDeviceId(null)
    }
  }

  const openSyncDialog = async () => {
    setIsSyncDialogOpen(true)
    setIsSyncLoading(true)
    setSelectedSyncInstances([])

    try {
      const instances = await fetchConnectedInstances()
      setSyncInstances(instances)
      setSelectedSyncInstances(
        instances.filter((instance) => !instance.alreadyImported).map((instance) => instance.instanceName),
      )
    } catch (err: any) {
      toast({
        title: 'Erro ao buscar instâncias',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setIsSyncLoading(false)
    }
  }

  const toggleSyncInstance = (instanceName: string) => {
    setSelectedSyncInstances((prev) =>
      prev.includes(instanceName)
        ? prev.filter((name) => name !== instanceName)
        : [...prev, instanceName],
    )
  }

  const handleImportInstances = async () => {
    if (selectedSyncInstances.length === 0) {
      toast({ title: 'Selecione ao menos uma instância', variant: 'destructive' })
      return
    }

    setIsImportingInstances(true)
    try {
      const result = await importEvolutionInstances(selectedSyncInstances)
      toast({
        title: 'Instâncias sincronizadas',
        description: `${result.created.length} aparelho(s) importado(s).`,
      })
      setSelectedSyncInstances([])
      await loadData()
      await refreshProfile()
      const instances = await fetchConnectedInstances()
      setSyncInstances(instances)
    } catch (err: any) {
      toast({
        title: 'Erro ao importar instâncias',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setIsImportingInstances(false)
    }
  }

  const handleConfigureWebhooks = async () => {
    const instanceNames = syncInstances.map((instance) => instance.instanceName)
    if (instanceNames.length === 0) {
      toast({ title: 'Nenhuma instância conectada para configurar', variant: 'destructive' })
      return
    }

    setIsConfiguringWebhooks(true)
    try {
      const result = await configureEvolutionWebhooks(instanceNames)
      const failedCount = result.failed?.length || 0
      toast({
        title: failedCount > 0 ? 'Webhooks configurados parcialmente' : 'Webhooks configurados',
        description: `${instanceNames.length - failedCount} de ${instanceNames.length} instância(s) atualizada(s).`,
        variant: failedCount > 0 ? 'destructive' : 'default',
      })
    } catch (err: any) {
      toast({
        title: 'Erro ao configurar webhooks',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setIsConfiguringWebhooks(false)
    }
  }

  const handleSave = async () => {
    if (!formData.email.trim()) {
      toast({ title: 'E-mail de login é obrigatório', variant: 'destructive' })
      return
    }

    if (!editingUser && !formData.password) {
      toast({ title: 'A senha é obrigatória', variant: 'destructive' })
      return
    }

    try {
      const username = formData.username.trim() || formData.email.split('@')[0]
      const dataToSave: any = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        username,
        department: formData.department || null,
        is_admin: formData.is_admin,
        allowed_devices: formData.is_admin ? [] : formData.allowed_devices,
      }

      if (formData.password) dataToSave.password = formData.password

      if (editingUser) {
        await updateUser(editingUser.id, dataToSave)
        await setToolAccess(editingUser.id, 'licitacoes', formData.licitacoes_access)
        await setToolAccess(editingUser.id, 'proposta-comercial', formData.proposta_comercial_access)
        toast({ title: 'Usuário atualizado com sucesso' })
      } else {
        const created = await createUser(dataToSave)
        // As liberações são gravadas depois do usuário existir: tool_access.user_id
        // tem FK para auth.users, então antes disso o insert seria rejeitado.
        if (created?.id) {
          if (formData.licitacoes_access) await setToolAccess(created.id, 'licitacoes', true)
          if (formData.proposta_comercial_access) {
            await setToolAccess(created.id, 'proposta-comercial', true)
          }
        }
        toast({ title: 'Usuário criado com sucesso' })
      }

      setIsDialogOpen(false)
      await loadData()
      await refreshProfile()
    } catch (err: any) {
      const fieldErrors = extractFieldErrors(err)
      if (Object.keys(fieldErrors).length > 0) {
        const errorMsg = Object.entries(fieldErrors)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')
        toast({ title: 'Erro de validação', description: errorMsg, variant: 'destructive' })
      } else {
        toast({ title: 'Erro', description: err.message, variant: 'destructive' })
      }
    }
  }

  const handleDelete = async (id: string) => {
    if (id === currentUser?.id) {
      toast({ title: 'Você não pode remover a própria conta', variant: 'destructive' })
      return
    }
    if (!window.confirm('Tem certeza que deseja remover este usuário?')) return
    try {
      await deleteUser(id)
      toast({ title: 'Usuário removido' })
      await loadData()
    } catch (err: any) {
      toast({ title: 'Erro ao remover', description: err.message, variant: 'destructive' })
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestão de Equipe</h1>
          <p className="text-muted-foreground">
            Gerencie usuários, setores e permissões de acesso aos celulares.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={openSyncDialog} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Atualizar Instâncias
          </Button>
          <Button onClick={openCreateDialog} className="gap-2">
            <Plus className="h-4 w-4" /> Novo Usuário
          </Button>
        </div>
      </div>

      {currentUser?.is_super_admin && <SuperAdminPanel />}

      <Card className="bg-muted backdrop-blur-sm border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" /> Gerenciar Celulares por Setor
          </CardTitle>
          <CardDescription>
            Defina a qual setor cada WhatsApp pertence. Isso facilita atribuir permissões ao criar usuários.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {devices.map((device) => (
              <div key={device.id} className="rounded-lg border border-border bg-card p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{device.name}</p>
                    <p className="text-xs text-muted-foreground">{device.instance_key || device.id}</p>
                  </div>
                  <Badge variant="secondary">{getDepartmentLabel(device.department)}</Badge>
                </div>
                <Select
                  value={device.department || NO_DEPARTMENT}
                  onValueChange={(value) => handleDeviceDepartmentChange(device.id, value)}
                  disabled={savingDeviceId === device.id}
                >
                  <SelectTrigger className="bg-muted">
                    <SelectValue placeholder="Selecione o setor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DEPARTMENT}>Sem setor</SelectItem>
                    {departments.map((department) => (
                      <SelectItem key={department} value={department}>
                        {department}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {devices.length === 0 && (
              <div className="col-span-full py-8 text-center text-muted-foreground border border-dashed border-border rounded-xl">
                Nenhum celular cadastrado.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {groupedUsers.map(([department, departmentUsers]) => (
          <section key={department} className="space-y-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">{department}</h2>
              <Badge variant="outline">{departmentUsers.length}</Badge>
            </div>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {departmentUsers.map((user) => (
                <Card key={user.id} className="bg-muted backdrop-blur-sm border-border">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-blue-500/20 text-blue-400 rounded-full shrink-0">
                          <UserIcon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-lg truncate">
                            {user.name || user.username || user.email || 'Sem Nome'}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3" /> {user.email || user.username}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 items-end shrink-0">
                        {user.id === currentUser?.id && <Badge variant="secondary">Você</Badge>}
                        {user.is_admin && (
                          <Badge
                            variant="outline"
                            className="border-blue-500/30 text-blue-400 bg-blue-500/10 gap-1"
                          >
                            <ShieldAlert className="h-3 w-3" /> Admin
                          </Badge>
                        )}
                        {licitacaoUserIds.has(user.id) && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/30 text-amber-500 bg-amber-500/10 gap-1"
                          >
                            <Gavel className="h-3 w-3" /> Licitações
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                          <Building2 className="h-4 w-4" /> Setor
                        </p>
                        <Badge variant="secondary" className="bg-accent">
                          {getDepartmentLabel(user.department)}
                        </Badge>
                      </div>

                      <div>
                        <p className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                          <Smartphone className="h-4 w-4" /> Aparelhos Permitidos
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {user.is_admin ? (
                            <Badge variant="secondary" className="bg-accent">
                              Todos os aparelhos
                            </Badge>
                          ) : user.allowed_devices?.length > 0 ? (
                            user.allowed_devices.map((deviceId) => {
                              const device = devicesMap.get(deviceId)
                              return (
                                <Badge key={deviceId} variant="secondary" className="bg-accent">
                                  {device ? device.name : 'Desconhecido'}
                                </Badge>
                              )
                            })
                          ) : (
                            <span className="text-sm text-muted-foreground italic">Nenhum</span>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-border">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(user)}
                          className="h-8"
                        >
                          <Edit className="h-4 w-4 mr-2" /> Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(user.id)}
                          disabled={user.id === currentUser?.id}
                          className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash className="h-4 w-4 mr-2" /> Remover
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
        {users.length === 0 && (
          <div className="py-12 text-center text-muted-foreground border border-dashed border-border rounded-xl">
            Nenhum usuário cadastrado no sistema.
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</DialogTitle>
            <DialogDescription>
              {editingUser
                ? 'Altere as informações, setor e permissões do usuário.'
                : 'Crie um novo usuário para acessar o sistema.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: João Silva"
                  className="bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">Usuário interno</Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
                  placeholder="Ex: joaosilva"
                  className="bg-muted"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">E-mail de login</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="usuario@empresa.com"
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                Senha{' '}
                {editingUser && (
                  <span className="text-muted-foreground font-normal">
                    (Deixe em branco para não alterar)
                  </span>
                )}
              </Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="********"
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <Label>Setor</Label>
              <Select
                value={formData.department || NO_DEPARTMENT}
                onValueChange={handleDepartmentChange}
              >
                <SelectTrigger className="bg-muted">
                  <SelectValue placeholder="Selecione o setor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>Sem setor</SelectItem>
                  {departments.map((department) => (
                    <SelectItem key={department} value={department}>
                      {department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Ao escolher um setor, os celulares do mesmo setor são marcados automaticamente.
              </p>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Checkbox
                id="is_admin"
                checked={formData.is_admin}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({
                    ...prev,
                    is_admin: checked as boolean,
                    allowed_devices: checked ? [] : prev.allowed_devices,
                  }))
                }
              />
              <Label htmlFor="is_admin" className="font-medium">
                Privilégios de Administrador
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="licitacoes_access"
                checked={formData.licitacoes_access}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, licitacoes_access: checked as boolean }))
                }
              />
              <Label htmlFor="licitacoes_access" className="font-medium">
                Acesso ao Licitações
              </Label>
            </div>
            <p className="-mt-1 text-xs text-muted-foreground">
              Libera a ferramenta Licitações e cria a conta da pessoa lá no primeiro acesso. Não
              depende de ser administrador.
            </p>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="proposta_comercial_access"
                checked={formData.proposta_comercial_access}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, proposta_comercial_access: checked as boolean }))
                }
              />
              <Label htmlFor="proposta_comercial_access" className="font-medium">
                Acesso à Proposta Comercial
              </Label>
            </div>
            <p className="-mt-1 text-xs text-muted-foreground">
              Libera o gerador de proposta comercial em PDF. O histórico é da equipe: quem tem
              acesso enxerga e reaproveita as propostas de todo mundo.
            </p>

            {!formData.is_admin && (
              <div className="pt-4 border-t border-border">
                <Label className="mb-3 block">Acesso aos Celulares</Label>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-2">
                  {devices.map((device) => (
                    <div
                      key={device.id}
                      className="flex items-center gap-2 bg-accent p-2 rounded-md"
                    >
                      <Checkbox
                        id={`device-${device.id}`}
                        checked={formData.allowed_devices.includes(device.id)}
                        onCheckedChange={() => handleDeviceToggle(device.id)}
                      />
                      <Label htmlFor={`device-${device.id}`} className="flex-1 cursor-pointer">
                        {device.name}
                      </Label>
                      <Badge variant="outline" className="shrink-0">
                        {getDepartmentLabel(device.department)}
                      </Badge>
                    </div>
                  ))}
                  {devices.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nenhum aparelho cadastrado.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
        <DialogContent className="sm:max-w-3xl bg-card border-border">
          <DialogHeader>
            <DialogTitle>Atualizar Instâncias da Evolution</DialogTitle>
            <DialogDescription>
              Instâncias conectadas são comparadas com os celulares já cadastrados no sistema.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-muted p-3">
                <p className="text-xs text-muted-foreground">Conectadas</p>
                <p className="text-2xl font-semibold">{syncInstances.length}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted p-3">
                <p className="text-xs text-muted-foreground">Novas</p>
                <p className="text-2xl font-semibold">{newSyncInstances.length}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted p-3">
                <p className="text-xs text-muted-foreground">Selecionadas</p>
                <p className="text-2xl font-semibold">{selectedSyncInstances.length}</p>
              </div>
            </div>

            {isSyncLoading ? (
              <div className="py-10 flex flex-col items-center justify-center gap-3 text-muted-foreground border border-dashed border-border rounded-xl">
                <RefreshCw className="h-6 w-6 animate-spin" />
                Buscando instâncias conectadas...
              </div>
            ) : syncInstances.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground border border-dashed border-border rounded-xl">
                Nenhuma instância conectada encontrada na Evolution API.
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="grid grid-cols-[40px_1fr_auto] gap-3 px-3 py-2 bg-muted text-xs font-medium text-muted-foreground">
                  <span />
                  <span>Instância</span>
                  <span>Status</span>
                </div>
                <div className="divide-y divide-border max-h-96 overflow-y-auto">
                  {syncInstances.map((instance) => (
                    <div
                      key={instance.instanceName}
                      className="grid grid-cols-[40px_1fr_auto] gap-3 px-3 py-3 items-center"
                    >
                      <Checkbox
                        checked={selectedSyncInstances.includes(instance.instanceName)}
                        disabled={instance.alreadyImported}
                        onCheckedChange={() => toggleSyncInstance(instance.instanceName)}
                        aria-label={`Selecionar ${instance.instanceName}`}
                      />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{instance.instanceName}</p>
                        <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                          {instance.profileName && <span>Perfil: {instance.profileName}</span>}
                          {instance.ownerJid && <span>{instance.ownerJid}</span>}
                          {instance.alreadyImported ? (
                            <Badge variant="secondary" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Já importado
                              {instance.device?.name ? ` como ${instance.device.name}` : ''}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              <DownloadCloud className="h-3 w-3" /> Novo aparelho
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20">
                        Conectado
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsSyncDialogOpen(false)}
              disabled={isImportingInstances || isConfiguringWebhooks}
            >
              Fechar
            </Button>
            <Button
              variant="outline"
              onClick={handleConfigureWebhooks}
              disabled={isSyncLoading || isImportingInstances || isConfiguringWebhooks || syncInstances.length === 0}
              className="gap-2"
            >
              {isConfiguringWebhooks && <RefreshCw className="h-4 w-4 animate-spin" />}
              Reconfigurar Webhooks
            </Button>
            <Button
              onClick={handleImportInstances}
              disabled={
                isSyncLoading ||
                isImportingInstances ||
                isConfiguringWebhooks ||
                selectedSyncInstances.length === 0
              }
              className="gap-2"
            >
              {isImportingInstances && <RefreshCw className="h-4 w-4 animate-spin" />}
              Importar Selecionadas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
