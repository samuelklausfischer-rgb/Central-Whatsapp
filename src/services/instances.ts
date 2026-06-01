import supabase from '@/lib/supabase/client'
import type { Device } from '@/lib/supabase/types'

export interface EvolutionSyncInstance {
  instanceName: string
  status: string
  profileName: string | null
  ownerJid: string | null
  profilePicUrl: string | null
  alreadyImported: boolean
  device: Pick<Device, 'id' | 'name' | 'instance_key' | 'department' | 'status' | 'avatar_url'> | null
}

export interface ImportInstancesResult {
  created: Device[]
  skipped: Array<{ instanceName: string; reason: string }>
  webhooks?: WebhookConfigurationResult[]
}

export interface WebhookConfigurationResult {
  instanceName: string
  configured: boolean
  status?: number
  error?: unknown
}

export interface ConfigureWebhooksResult {
  configured: WebhookConfigurationResult[]
  failed: WebhookConfigurationResult[]
}

export const fetchConnectedInstances = async () => {
  const { data, error } = await supabase.functions.invoke<{ instances: EvolutionSyncInstance[] }>(
    'sync-instances',
    { method: 'GET' },
  )

  if (error) throw new Error(error.message)
  return data?.instances || []
}

export const importEvolutionInstances = async (instanceNames: string[]) => {
  const { data, error } = await supabase.functions.invoke<ImportInstancesResult>('sync-instances', {
    method: 'POST',
    body: {
      instances: instanceNames.map((instanceName) => ({ instanceName })),
    },
  })

  if (error) throw new Error(error.message)
  return data || { created: [], skipped: [] }
}

export const configureEvolutionWebhooks = async (instanceNames: string[]) => {
  const { data, error } = await supabase.functions.invoke<ConfigureWebhooksResult>('sync-instances', {
    method: 'POST',
    body: {
      action: 'configure_webhooks',
      instances: instanceNames.map((instanceName) => ({ instanceName })),
    },
  })

  if (error) throw new Error(error.message)
  return data || { configured: [], failed: [] }
}
