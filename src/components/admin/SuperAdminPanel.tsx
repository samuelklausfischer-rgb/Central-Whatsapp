import { useCallback, useEffect, useMemo, useState } from 'react'
import { Megaphone, Send, ShieldAlert, Check, X, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { useToast } from '@/hooks/use-toast'
import { getUsers, type ManagedUser } from '@/services/users'
import { getDevices } from '@/services/devices'
import type { Device } from '@/lib/supabase/types'
import {
  sendBroadcast,
  getBroadcastReadStatus,
  type BroadcastReadStatus,
} from '@/services/broadcasts'
import { setUserDeviceAccess, setUserDevicesRestricted } from '@/services/superadmin'
import { useAuth } from '@/hooks/use-auth'

const userLabel = (u: { name: string | null; email: string | null }) => u.name || u.email || 'usuário'

export function SuperAdminPanel() {
  const { toast } = useToast()

  // ── Broadcast ────────────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [statuses, setStatuses] = useState<BroadcastReadStatus[]>([])

  const loadStatuses = useCallback(() => {
    getBroadcastReadStatus().then(setStatuses).catch(() => {})
  }, [])

  useEffect(() => { loadStatuses() }, [loadStatuses])

  const handleSend = async () => {
    if (!message.trim()) return
    setSending(true)
    try {
      await sendBroadcast(message.trim(), title.trim() || undefined)
      setTitle('')
      setMessage('')
      toast({ title: 'Mensagem enviada', description: 'Todos os usuários conectados vão receber o aviso.' })
      loadStatuses()
    } catch (e) {
      toast({ title: 'Falha ao enviar', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  // ── Revogar acesso por instância ─────────────────────────────────────────
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [savingCell, setSavingCell] = useState<string | null>(null)

  const loadAccess = useCallback(() => {
    Promise.all([getUsers(), getDevices()])
      .then(([u, d]) => { setUsers(u); setDevices(d) })
      .catch(() => {})
  }, [])

  useEffect(() => { loadAccess() }, [loadAccess])

  const { user: currentUser } = useAuth()
  // Gerenciáveis: todos menos o próprio super-admin (para não se auto-trancar).
  const manageableUsers = useMemo(
    () => users.filter((u) => u.id !== currentUser?.id),
    [users, currentUser?.id],
  )

  const toggleRestricted = async (u: ManagedUser, restricted: boolean) => {
    const cell = `${u.id}:restrict`
    setSavingCell(cell)
    try {
      await setUserDevicesRestricted(u.id, restricted)
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, devices_restricted: restricted } : x)))
    } catch (e) {
      toast({ title: 'Falha ao atualizar', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSavingCell(null)
    }
  }

  const toggleAccess = async (u: ManagedUser, device: Device, allowed: boolean) => {
    const cell = `${u.id}:${device.id}`
    setSavingCell(cell)
    try {
      await setUserDeviceAccess(u.id, device.id, allowed)
      setUsers((prev) =>
        prev.map((x) =>
          x.id === u.id
            ? {
                ...x,
                allowed_devices: allowed
                  ? [...new Set([...x.allowed_devices, device.id])]
                  : x.allowed_devices.filter((id) => id !== device.id),
              }
            : x,
        ),
      )
    } catch (e) {
      toast({ title: 'Falha ao atualizar acesso', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSavingCell(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Enviar mensagem para todos */}
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" /> Enviar mensagem para todos
          </CardTitle>
          <CardDescription>
            Um aviso em popup para todos os usuários conectados. Você acompanha quem viu e quem não viu abaixo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Título (opcional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />
          <Textarea
            placeholder="Escreva o aviso que todos vão receber…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
          />
          <div className="flex justify-end">
            <Button onClick={handleSend} disabled={sending || !message.trim()}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Enviar para todos
            </Button>
          </div>

          {statuses.length > 0 && (
            <Accordion type="single" collapsible className="mt-2">
              {statuses.map((s) => (
                <AccordionItem key={s.broadcast.id} value={s.broadcast.id}>
                  <AccordionTrigger className="text-sm">
                    <span className="flex flex-1 items-center justify-between gap-2 pr-2">
                      <span className="truncate">
                        {s.broadcast.title || s.broadcast.message.slice(0, 40)}
                      </span>
                      <Badge variant={s.seen === s.total ? 'default' : 'secondary'}>
                        {s.seen} de {s.total} viram
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="mb-3 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">
                      {s.broadcast.message}
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs font-medium text-green-600 dark:text-green-500">
                          Viram ({s.seenUsers.length})
                        </p>
                        <ul className="space-y-1 text-sm">
                          {s.seenUsers.map((u) => (
                            <li key={u.id} className="flex items-center gap-1.5">
                              <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
                              {userLabel(u)}
                            </li>
                          ))}
                          {s.seenUsers.length === 0 && <li className="text-muted-foreground">Ninguém ainda</li>}
                        </ul>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Não viram ({s.unseenUsers.length})
                        </p>
                        <ul className="space-y-1 text-sm">
                          {s.unseenUsers.map((u) => (
                            <li key={u.id} className="flex items-center gap-1.5 text-muted-foreground">
                              <X className="h-3.5 w-3.5" />
                              {userLabel(u)}
                            </li>
                          ))}
                          {s.unseenUsers.length === 0 && <li className="text-green-600 dark:text-green-500">Todos viram ✓</li>}
                        </ul>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      {/* Revogar acesso por instância */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" /> Acesso ao WhatsApp por usuário
          </CardTitle>
          <CardDescription>
            Ligue/desligue o acesso de cada usuário a cada instância. Admins têm acesso a tudo por padrão —
            desligue "Acesso total" para restringir um admin a instâncias específicas. (Só você, super-admin, controla isto.)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {manageableUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum usuário para gerenciar.</p>
          ) : (
            <div className="space-y-4">
              {manageableUsers.map((u) => {
                // Mostra a grade de instâncias quando: não-admin (sempre) OU admin restrito.
                const showGrid = !u.is_admin || !!u.devices_restricted
                return (
                  <div key={u.id} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {userLabel(u)}
                        {u.is_admin && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">admin</Badge>
                        )}
                      </span>
                      {u.is_admin && (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          Acesso total
                          {savingCell === `${u.id}:restrict` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Switch
                              checked={!u.devices_restricted}
                              onCheckedChange={(v) => toggleRestricted(u, !v)}
                            />
                          )}
                        </label>
                      )}
                    </div>
                    {showGrid ? (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {devices.map((d) => {
                          const allowed = u.allowed_devices.includes(d.id)
                          const cell = `${u.id}:${d.id}`
                          return (
                            <label
                              key={d.id}
                              className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm"
                            >
                              <span className="truncate">{d.name}</span>
                              {savingCell === cell ? (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              ) : (
                                <Switch
                                  checked={allowed}
                                  onCheckedChange={(v) => toggleAccess(u, d, v)}
                                />
                              )}
                            </label>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Acesso a todas as instâncias. Desligue "Acesso total" para escolher instâncias específicas.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
