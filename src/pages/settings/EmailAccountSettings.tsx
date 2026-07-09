import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Wifi, WifiOff, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import {
  getAllEmailAccounts,
  createEmailAccount,
  updateEmailAccount,
  deleteEmailAccount,
  setEmailAccountActive,
} from '@/services/email_accounts'
import { createSystemFolders } from '@/services/email_folders'
import type { EmailAccount } from '@/lib/supabase/email-types'

type Provider = 'imap' | 'gmail' | 'outlook'

interface FormData {
  label: string
  email: string
  provider: Provider
  department: string
  imap_host: string
  imap_port: string
  smtp_host: string
  smtp_port: string
  imap_password_enc: string
  signature: string
  reply_to: string
}

const DEFAULT_FORM: FormData = {
  label: '',
  email: '',
  provider: 'imap',
  department: '',
  imap_host: '',
  imap_port: '993',
  smtp_host: '',
  smtp_port: '587',
  imap_password_enc: '',
  signature: '',
  reply_to: '',
}

const PROVIDER_PRESETS: Record<Provider, Partial<FormData>> = {
  gmail: { imap_host: 'imap.gmail.com', imap_port: '993', smtp_host: 'smtp.gmail.com', smtp_port: '587' },
  outlook: { imap_host: 'outlook.office365.com', imap_port: '993', smtp_host: 'smtp.office365.com', smtp_port: '587' },
  imap: {},
}

export default function EmailAccountSettings() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(DEFAULT_FORM)
  const [isSaving, setIsSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    getAllEmailAccounts().then(setAccounts)
  }, [])

  function openNew() {
    setEditingId(null)
    setForm(DEFAULT_FORM)
    setDialogOpen(true)
  }

  function openEdit(account: EmailAccount) {
    setEditingId(account.id)
    setForm({
      label: account.label,
      email: account.email,
      provider: account.provider as Provider,
      department: account.department ?? '',
      imap_host: account.imap_host ?? '',
      imap_port: String(account.imap_port),
      smtp_host: account.smtp_host ?? '',
      smtp_port: String(account.smtp_port),
      imap_password_enc: '',  // não preencher senha ao editar
      signature: account.signature ?? '',
      reply_to: account.reply_to ?? '',
    })
    setDialogOpen(true)
  }

  function handleProviderChange(provider: Provider) {
    const preset = PROVIDER_PRESETS[provider]
    setForm((prev) => ({ ...prev, provider, ...preset }))
  }

  async function handleSave() {
    if (!form.label || !form.email || !form.provider) {
      toast({ title: 'Preencha nome, email e provedor', variant: 'destructive' })
      return
    }
    if (!user) return

    setIsSaving(true)
    try {
      const payload = {
        user_id: user.id,
        label: form.label.trim(),
        email: form.email.trim().toLowerCase(),
        provider: form.provider,
        department: form.department || null,
        imap_host: form.imap_host || null,
        imap_port: parseInt(form.imap_port) || 993,
        imap_use_ssl: true,
        smtp_host: form.smtp_host || null,
        smtp_port: parseInt(form.smtp_port) || 587,
        smtp_use_tls: true,
        imap_password_enc: form.imap_password_enc || null,
        oauth_access_token: null,
        oauth_refresh_token: null,
        oauth_expires_at: null,
        signature: form.signature || null,
        reply_to: form.reply_to || null,
        is_active: true,
        sync_interval: 60,
      }

      if (editingId) {
        const updated = await updateEmailAccount(editingId, payload)
        setAccounts((prev) => prev.map((a) => a.id === editingId ? updated : a))
        toast({ title: 'Conta atualizada com sucesso' })
      } else {
        const created = await createEmailAccount(payload)
        setAccounts((prev) => [...prev, created])
        // Criar pastas padrão para a nova conta
        await createSystemFolders(created.id)
        toast({ title: 'Conta adicionada com sucesso' })
      }

      setDialogOpen(false)
    } catch (err) {
      toast({
        title: 'Erro ao salvar conta',
        description: err instanceof Error ? err.message : 'Tente novamente',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir esta conta de email? Todos os emails armazenados serão apagados.')) return
    try {
      await deleteEmailAccount(id)
      setAccounts((prev) => prev.filter((a) => a.id !== id))
      toast({ title: 'Conta removida' })
    } catch {
      toast({ title: 'Erro ao remover conta', variant: 'destructive' })
    }
  }

  async function handleToggleActive(account: EmailAccount) {
    await setEmailAccountActive(account.id, !account.is_active)
    setAccounts((prev) => prev.map((a) => a.id === account.id ? { ...a, is_active: !a.is_active } : a))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Contas de Email</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure as contas de email que aparecerão no Email Hub.
            A sincronização é feita automaticamente pelo n8n.
          </p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Adicionar conta
        </Button>
      </div>

      {/* Aviso n8n */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-blue-700 dark:text-blue-300">
        <p className="font-medium mb-1">Automação via n8n</p>
        <p className="text-xs opacity-80">
          Após adicionar uma conta, configure as credenciais no workflow <strong>IMAP Email Poller</strong> no n8n
          para iniciar a sincronização automática. Os emails classificados pela IA aparecerão em tempo real no Email Hub.
        </p>
      </div>

      {/* Lista de contas */}
      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          <p className="text-sm">Nenhuma conta de email configurada</p>
          <p className="text-xs mt-1">Clique em "Adicionar conta" para começar</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center gap-4 rounded-lg border border-border p-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{account.label}</span>
                  <Badge variant="outline" className="text-xs capitalize">
                    {account.provider}
                  </Badge>
                  {account.is_active ? (
                    <Wifi className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{account.email}</p>
                {account.department && (
                  <p className="text-xs text-muted-foreground">Setor: {account.department}</p>
                )}
                {account.last_sync_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Última sync: {new Date(account.last_sync_at).toLocaleString('pt-BR')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <Switch
                  checked={account.is_active}
                  onCheckedChange={() => handleToggleActive(account)}
                />
                <Button size="icon" variant="ghost" onClick={() => openEdit(account)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleDelete(account.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog de formulário */}
      <Dialog open={dialogOpen} onOpenChange={(v) => !v && setDialogOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar conta' : 'Nova conta de email'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nome amigável</Label>
                <Input
                  value={form.label}
                  onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
                  placeholder="ex: Financeiro"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Endereço de email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="setor@empresa.com"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Provedor</Label>
                <Select value={form.provider} onValueChange={(v) => handleProviderChange(v as Provider)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="imap">IMAP / SMTP genérico</SelectItem>
                    <SelectItem value="gmail">Gmail</SelectItem>
                    <SelectItem value="outlook">Outlook 365</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Departamento (opcional)</Label>
                <Input
                  value={form.department}
                  onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                  placeholder="ex: financeiro"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Servidor IMAP</Label>
                <Input
                  value={form.imap_host}
                  onChange={(e) => setForm((p) => ({ ...p, imap_host: e.target.value }))}
                  placeholder="imap.empresa.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Porta IMAP</Label>
                <Input
                  value={form.imap_port}
                  onChange={(e) => setForm((p) => ({ ...p, imap_port: e.target.value }))}
                  placeholder="993"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Servidor SMTP</Label>
                <Input
                  value={form.smtp_host}
                  onChange={(e) => setForm((p) => ({ ...p, smtp_host: e.target.value }))}
                  placeholder="smtp.empresa.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Porta SMTP</Label>
                <Input
                  value={form.smtp_port}
                  onChange={(e) => setForm((p) => ({ ...p, smtp_port: e.target.value }))}
                  placeholder="587"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Senha {editingId && <span className="text-muted-foreground text-xs">(deixe em branco para não alterar)</span>}</Label>
              <Input
                type="password"
                value={form.imap_password_enc}
                onChange={(e) => setForm((p) => ({ ...p, imap_password_enc: e.target.value }))}
                placeholder="••••••••"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Assinatura (opcional)</Label>
              <Textarea
                value={form.signature}
                onChange={(e) => setForm((p) => ({ ...p, signature: e.target.value }))}
                placeholder="Nome | Cargo | Empresa | Tel"
                rows={3}
                className="resize-none text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Adicionar conta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
