import { useEffect, useRef } from 'react'
import { supabaseFinanceiro } from '@/lib/supabase/client-financeiro'

export function useRealtime(
  tableName: string,
  callback: (data: any) => void,
  enabled: boolean = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled) return

    const channel = supabaseFinanceiro
      .channel(`realtime:${tableName}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tableName },
        (payload) => {
          callbackRef.current(payload)
        },
      )
      .subscribe()

    return () => {
      void supabaseFinanceiro.removeChannel(channel)
    }
  }, [tableName, enabled])
}
