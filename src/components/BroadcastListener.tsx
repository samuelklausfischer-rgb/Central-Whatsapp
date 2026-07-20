import { useEffect, useState, useCallback } from 'react'
import { Megaphone } from 'lucide-react'
import supabase from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { getUnreadBroadcasts, markBroadcastRead, type Broadcast } from '@/services/broadcasts'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'

/**
 * Escuta broadcasts (mensagem para todos) e exibe um popup bloqueante.
 * Mostra os não lidos ao logar (quem estava offline vê ao abrir) e os novos
 * em tempo real. Ao confirmar, registra a leitura (para o "quem viu").
 * Montado no Layout → cobre toda página autenticada (web + Electron).
 */
export function BroadcastListener() {
  const { user, isAuthenticated } = useAuth()
  const [queue, setQueue] = useState<Broadcast[]>([])

  const enqueue = useCallback((b: Broadcast) => {
    setQueue((q) => (q.some((x) => x.id === b.id) ? q : [...q, b]))
  }, [])

  // Não lidos ao logar
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return
    let active = true
    getUnreadBroadcasts(user.id)
      .then((list) => { if (active) list.forEach(enqueue) })
      .catch(() => {})
    return () => { active = false }
  }, [isAuthenticated, user?.id, enqueue])

  // Novos broadcasts em tempo real
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return
    const channel = supabase
      .channel('app-broadcasts-listener')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'app_broadcasts' },
        (payload) => enqueue(payload.new as Broadcast),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isAuthenticated, user?.id, enqueue])

  const current = queue[0]

  const dismiss = useCallback(async () => {
    if (!current) return
    try { await markBroadcastRead(current.id) } catch { /* silencioso */ }
    setQueue((q) => q.slice(1))
  }, [current])

  if (!current) return null

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            {current.title || 'Aviso'}
          </AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-wrap text-foreground">
            {current.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={dismiss}>Ok, entendi</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
