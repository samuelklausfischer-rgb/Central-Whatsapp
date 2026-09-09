import { useCallback, useEffect, useState } from 'react'
import { Megaphone, Send, Check, X, Loader2 } from 'lucide-react'
import { CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { useToast } from '@/hooks/use-toast'
import {
  sendBroadcast,
  getBroadcastReadStatus,
  type BroadcastReadStatus,
} from '@/services/broadcasts'

const userLabel = (u: { name: string | null; email: string | null }) => u.name || u.email || 'usuário'

/**
 * O que só o super-admin vê na Gestão de Equipe.
 *
 * Teve um segundo card até 09/09/2026 — "Acesso ao WhatsApp por usuário", uma
 * grade de todo usuário × todo aparelho. Ele duplicava a lista de aparelhos do
 * popup de cadastro, e a chave "Acesso total" que só existia aqui foi para lá
 * junto (`AdminPage.tsx`, seção "Acesso aos Celulares"). Decisão do Samuel: uma
 * função, um lugar.
 */
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

  return (
    <div className="space-y-6">
      {/*
        Enviar mensagem para todos. Sem o `border-primary/30` que existia
        antes: `GlassCard` já força `border-0` (a borda visível é a do
        próprio `.superficie-vidro`) — um `border-<cor>` por cima não tem
        largura para aparecer, então era um destaque morto.
      */}
      <GlassCard>
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
      </GlassCard>

    </div>
  )
}
