import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'

export type UpdateStatus =
  | { type: 'idle' }
  | { type: 'checking' }
  | { type: 'up-to-date' }
  | { type: 'available'; version: string }
  | { type: 'downloading'; percent: number }
  | { type: 'ready'; version: string }
  | { type: 'error'; message: string }

const api = (window as any).electronAPI as {
  getAppVersion: () => Promise<string>
  checkForUpdates: () => void
  installUpdate: () => void
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => () => void
} | undefined

export function useUpdater() {
  const isElectron = !!api
  const [status, setStatus] = useState<UpdateStatus>({ type: 'idle' })
  const [version, setVersion] = useState<string | null>(null)

  // Listener IPC do electron-updater (progresso, ready, etc.)
  useEffect(() => {
    if (!api) return
    api.getAppVersion().then(setVersion)
    const unsub = api.onUpdateStatus((s) => {
      setStatus(s)
      if (s.type === 'up-to-date' || s.type === 'error') {
        setTimeout(() => setStatus({ type: 'idle' }), 4000)
      }
    })
    return unsub
  }, [])

  // Push via Supabase Realtime: dispara checkForUpdates imediatamente quando
  // um novo publish insere em app_releases — sem esperar o poll de 4h.
  useEffect(() => {
    if (!api) return
    const channel = supabase
      .channel('app-version-push')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'app_releases' }, () => {
        api.checkForUpdates()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  function checkForUpdates() {
    if (!api) return
    setStatus({ type: 'checking' })
    api.checkForUpdates()
  }

  function installUpdate() {
    api?.installUpdate()
  }

  return { isElectron, status, version, checkForUpdates, installUpdate }
}
