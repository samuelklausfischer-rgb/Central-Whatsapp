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

    const channelName = `${tableName}-changes-${Math.random().toString(36).slice(2)}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName,
          ...(filter ? { filter } : {}),
        },
        (payload: RealtimePostgresChangesPayload<T>) => {
          const eventMap: Record<string, 'create' | 'update' | 'delete'> = {
            INSERT: 'create',
            UPDATE: 'update',
            DELETE: 'delete',
          }
          callbackRef.current({
            action: eventMap[payload.eventType] || 'update',
            record: (payload.new || payload.old) as T,
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tableName, enabled, filter])
}

export default useRealtime
