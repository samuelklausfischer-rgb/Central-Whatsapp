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
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled) return

    let channel: ReturnType<typeof supabase.channel> | null = null
    let retry = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    let joined = false

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
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            joined = false
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
