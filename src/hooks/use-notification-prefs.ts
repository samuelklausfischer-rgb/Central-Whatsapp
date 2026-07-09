import { useState } from 'react'

const KEY_PREFIX = 'notif_prefs_'

export type DevicePrefs = { sound: boolean; background: boolean }
type AllPrefs = Record<string, DevicePrefs>

const DEFAULT: DevicePrefs = { sound: true, background: true }

function load(userId: string): AllPrefs {
  try {
    return JSON.parse(localStorage.getItem(KEY_PREFIX + userId) || '{}')
  } catch {
    return {}
  }
}

function persist(userId: string, prefs: AllPrefs) {
  localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(prefs))
}

// Leitura direta do localStorage — usar em callbacks Realtime (fora do ciclo React)
export function getRawDevicePrefs(userId: string, deviceId: string): DevicePrefs {
  return load(userId)[deviceId] ?? DEFAULT
}

export function useNotificationPrefs(userId: string | undefined) {
  const [prefs, setPrefs] = useState<AllPrefs>(() => (userId ? load(userId) : {}))

  function getPrefs(deviceId: string): DevicePrefs {
    return prefs[deviceId] ?? DEFAULT
  }

  function update(deviceId: string, patch: Partial<DevicePrefs>) {
    setPrefs((prev) => {
      const next: AllPrefs = {
        ...prev,
        [deviceId]: { ...(prev[deviceId] ?? DEFAULT), ...patch },
      }
      if (userId) persist(userId, next)
      return next
    })
  }

  function toggleSound(deviceId: string) {
    update(deviceId, { sound: !getPrefs(deviceId).sound })
  }

  function toggleBackground(deviceId: string) {
    update(deviceId, { background: !getPrefs(deviceId).background })
  }

  function setAllSound(enabled: boolean, deviceIds: string[]) {
    setPrefs((prev) => {
      const next: AllPrefs = { ...prev }
      deviceIds.forEach((id) => {
        next[id] = { ...(next[id] ?? DEFAULT), sound: enabled }
      })
      if (userId) persist(userId, next)
      return next
    })
  }

  function setAllBackground(enabled: boolean, deviceIds: string[]) {
    setPrefs((prev) => {
      const next: AllPrefs = { ...prev }
      deviceIds.forEach((id) => {
        next[id] = { ...(next[id] ?? DEFAULT), background: enabled }
      })
      if (userId) persist(userId, next)
      return next
    })
  }

  return { getPrefs, toggleSound, toggleBackground, setAllSound, setAllBackground }
}
