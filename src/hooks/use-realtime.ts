import { useEffect, useRef } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import supabase from '@/lib/supabase/client'

export interface RecordSubscription<T> {
  action: 'create' | 'update' | 'delete'
  record: T
}

export function useRealtime<T extends Record<string, unknown>>(
  tableName: string,
  callback: (data: RecordSubscription<T>) => void,
  enabled: boolean = true,
  filter?: string,
  // Opcional e por isso retrocompatível com todo call site existente que só
  // passa (tableName, callback[, enabled[, filter]]). Disparado toda vez que
  // o canal fica SUBSCRIBED (mount inicial e reconexões) — serve pra quem
  // precisa reconciliar um fetch inicial com o handshake assíncrono do
  // websocket, fechando a janela em que uma mudança chegaria entre os dois e
  // seria perdida em silêncio.
  onSubscribed?: () => void,
  // Também opcional e retrocompatível pelo mesmo motivo. Diferente de
  // `onSubscribed` (que dispara em toda inscrição, inclusive o mount),
  // `aoReconectar` SÓ dispara quando o canal volta a SUBSCRIBED depois de
  // ter caído (CHANNEL_ERROR, TIMED_OUT ou CLOSED) — nunca na primeira
  // inscrição. Motivo: `postgres_changes` não tem replay. Tudo que mudou no
  // banco enquanto o WebSocket estava fora do ar (o backoff do
  // `scheduleResubscribe` abaixo chega a 15s) nunca vira evento — some sem
  // erro nenhum. Reconectar e seguir como se nada tivesse acontecido deixa
  // esse intervalo como um buraco silencioso na tela; quem passa
  // `aoReconectar` normalmente usa o gancho para refazer a leitura por REST
  // e fechar essa janela.
  aoReconectar?: () => void,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const onSubscribedRef = useRef(onSubscribed)
  onSubscribedRef.current = onSubscribed
  const aoReconectarRef = useRef(aoReconectar)
  aoReconectarRef.current = aoReconectar

  useEffect(() => {
    if (!enabled) return

    let channel: ReturnType<typeof supabase.channel> | null = null
    let retry = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    let joined = false
    // Local ao ciclo de vida deste efeito (mount → unmount), igual a `joined`
    // e `retry` — não precisa ser um useRef de verdade porque o efeito
    // inteiro é recriado do zero se `tableName`/`enabled`/`filter` mudarem.
    // Marca se o canal já passou por CHANNEL_ERROR/TIMED_OUT/CLOSED desde a
    // última vez que ficou SUBSCRIBED, para `aoReconectar` distinguir
    // "primeira inscrição" de "voltou depois de cair".
    let jaCaiu = false

    const handlePayload = (payload: RealtimePostgresChangesPayload<T>) => {
      const eventMap: Record<string, 'create' | 'update' | 'delete'> = {
        INSERT: 'create',
        UPDATE: 'update',
        DELETE: 'delete',
      }
      callbackRef.current({
        action: eventMap[payload.eventType] || 'update',
        record: (payload.new || payload.old) as T,
      })
    }

    const subscribe = () => {
      if (disposed) return
      const channelName = `${tableName}-changes-${Math.random().toString(36).slice(2)}`
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: tableName,
            ...(filter ? { filter } : {}),
          },
          handlePayload,
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            joined = true
            retry = 0
            onSubscribedRef.current?.()
            // Só conta como reconexão se já tinha caído antes — o mount
            // inicial nunca dispara `aoReconectar`.
            if (jaCaiu) {
              jaCaiu = false
              aoReconectarRef.current?.()
            }
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            joined = false
            jaCaiu = true
            scheduleResubscribe()
          }
        })
    }

    const scheduleResubscribe = () => {
      if (disposed || retryTimer) return
      const delay = Math.min(1000 * 2 ** retry, 15000)
      retry++
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (disposed) return
        if (channel) {
          supabase.removeChannel(channel)
          channel = null
        }
        subscribe()
      }, delay)
    }

    // Quando a janela volta ao foco / a rede reconecta, só re-inscreve se o
    // canal não estiver saudável — evita churn de canais a cada foco.
    const reconnectIfStale = () => {
      if (disposed || joined) return
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      retry = 0
      if (channel) {
        supabase.removeChannel(channel)
        channel = null
      }
      subscribe()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconnectIfStale()
    }

    subscribe()
    window.addEventListener('online', reconnectIfStale)
    window.addEventListener('focus', reconnectIfStale)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      window.removeEventListener('online', reconnectIfStale)
      window.removeEventListener('focus', reconnectIfStale)
      document.removeEventListener('visibilitychange', onVisibility)
      if (channel) supabase.removeChannel(channel)
    }
  }, [tableName, enabled, filter])
}

export default useRealtime
