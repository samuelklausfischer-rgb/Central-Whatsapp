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
 * Confirma que o `setAuth()` anterior realmente aplicou o token no socket
 * do Realtime (mesma checagem de `garantirTokenRealtime` em
 * `src/hooks/use-realtime.ts` — ver o comentário lá para o mecanismo
 * completo: `getSession()` pode rejeitar por timeout de lock entre abas, e
 * `RealtimeClient._performAuth` engole essa rejeição em silêncio, fazendo
 * `setAuth()` "resolver com sucesso" sem aplicar nada). Duplicada aqui em
 * vez de importada para manter este componente sem dependência do módulo
 * do hook de canal compartilhado — mesmo client `supabase`, então a
 * comparação é válida.
 */
async function garantirTokenRealtimeBroadcast(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const session = data.session
    // Se chegamos aqui é porque `isAuthenticated` já era true, então
    // sessão nula seria uma corrida rara (deslogou no instante entre o
    // gate do efeito e este await) — sem sessão não há o que comparar.
    if (!session) return
    if (supabase.realtime.accessTokenValue === session.access_token) return

    console.warn(
      '[BroadcastListener] token não aplicado ao socket; canal pode nascer mudo — tentando setAuth() mais uma vez',
    )
    try {
      await supabase.realtime.setAuth()
    } catch (erroRetry) {
      console.error(
        '[BroadcastListener] segunda tentativa de setAuth também falhou; seguindo mesmo assim',
        erroRetry,
      )
    }
  } catch (erro) {
    console.error(
      '[BroadcastListener] não foi possível confirmar a sessão após setAuth; seguindo mesmo assim',
      erro,
    )
  }
}

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

    // Mesmo bug e mesma correção do `src/hooks/use-realtime.ts` (canal
    // Realtime preso em claims_role='anon'): `isAuthenticated` refletir a
    // sessão do Supabase Auth NÃO garante que `supabase.realtime` já tem o
    // JWT — supabase-js só chama `realtime.setAuth(token)` em
    // TOKEN_REFRESHED/SIGNED_IN, nunca em INITIAL_SESSION (o caso comum de
    // quem abre o app com sessão já salva), e `.subscribe()` lê o token de
    // forma síncrona. A policy `bc_select` de `app_broadcasts` é restrita
    // à role `authenticated`, então um join que saia como anon fica
    // SUBSCRIBED e nunca recebe broadcast nenhum. `setAuth()` sem
    // argumento reexecuta o callback que aguarda `getSession()`.
    let cancelado = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    void (async () => {
      // try/catch envolvendo TUDO: `.subscribe()` chama `socket.connect()`
      // por baixo, que pode lançar SÍNCRONO. Sem este catch a exceção
      // escaparia como unhandled promise rejection.
      try {
        try {
          await supabase.realtime.setAuth()
        } catch (erro) {
          // Não pode derrubar a assinatura — degradado é melhor que mudo.
          console.error('[BroadcastListener] setAuth falhou; seguindo mesmo assim', erro)
        }

        // setAuth() pode ter "resolvido com sucesso" sem aplicar nada — ver
        // comentário de garantirTokenRealtimeBroadcast acima.
        await garantirTokenRealtimeBroadcast()

        // Pode ter desmontado (trocou de usuário, deslogou) enquanto
        // esperávamos a sessão resolver.
        if (cancelado) return

        channel = supabase
          .channel('app-broadcasts-listener')
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'app_broadcasts' },
            (payload) => enqueue(payload.new as Broadcast),
          )
          .subscribe()
      } catch (erro) {
        channel = null
        console.error(
          '[BroadcastListener] falha ao abrir canal; sem canal até o próximo mount',
          erro,
        )
      }
    })()

    return () => {
      cancelado = true
      if (channel) supabase.removeChannel(channel)
    }
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
