import { useState, useEffect } from 'react'

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
