import supabase from '@/lib/supabase/client'
import type { Device } from '@/lib/supabase/types'

export interface EvolutionInstance {
  instanceName: string
  status: string
  normalizedStatus: 'connected' | 'disconnected' | 'connecting' | 'unknown'
  profileName: string | null
  ownerJid: string | null
  profilePicUrl: string | null
  device: Pick<Device, 'id' | 'name' | 'instance_key' | 'department' | 'status' | 'avatar_url'> | null
  alreadyImported: boolean
}

export interface QrCodeData {
  base64?: string
  code?: string
  pairingCode?: string
}

export class EvolutionApiError extends Error {
  details: unknown
  diagnostics: unknown

  constructor(message: string, details?: unknown, diagnostics?: unknown) {
    super(message)
    this.name = 'EvolutionApiError'
    this.details = details
    this.diagnostics = diagnostics
  }
}

const invoke = async <T>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke<T>('evolution-instances', {
    method: 'POST',
    body,
  })
  if (error) {
    const ctx = (error as any).context
    const ctxData = typeof ctx === 'object' && ctx ? ctx : {}
    const message = (ctxData as any).error || error.message
    const details = (ctxData as any).details
    const diagnostics = (ctxData as any).diagnostics
    throw new EvolutionApiError(message, details, diagnostics)
  }
  return data as T
}

export const listEvolutionInstances = () =>
  invoke<{ instances: EvolutionInstance[] }>({ action: 'list' })

export const createEvolutionInstance = (params: {
  instanceName: string
  displayName?: string
  department?: string
}) =>
  invoke<{ instanceName: string; deviceId: string | null; status: string; qrcode: QrCodeData | null }>({
    action: 'create', ...params,
  })

export const connectEvolutionInstance = (instanceName: string) =>
  invoke<{ instanceName: string; qrcode: QrCodeData | null }>({
    action: 'connect', instanceName,
  })

export const disconnectEvolutionInstance = (instanceName: string) =>
  invoke<{ instanceName: string; status: string }>({
    action: 'disconnect', instanceName,
  })

export const deleteEvolutionInstance = (instanceName: string) =>
  invoke<{ instanceName: string; softDeleted: boolean }>({
    action: 'delete', instanceName,
  })

export const renameEvolutionDisplay = (instanceName: string, displayName: string) =>
  invoke<{ instanceName: string; displayName: string; updated: boolean }>({
    action: 'rename_display', instanceName, displayName,
  })

export const configureInstanceWebhook = (instanceName: string) =>
  invoke<{ instanceName: string; configured: boolean }>({
    action: 'configure_webhook', instanceName,
  })
