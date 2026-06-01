import supabase from '@/lib/supabase/client'
import type { Device } from '@/lib/supabase/types'

export const getDevices = async () => {
  const { data } = await supabase.from('devices').select('*').order('name')
  return (data as Device[]) || []
}

export const getDevice = async (id: string) => {
  const { data } = await supabase.from('devices').select('*').eq('id', id).single()
  return data as Device | null
}

export const updateDevice = async (id: string, data: Partial<Device>) => {
  const { data: result, error } = await supabase
    .from('devices')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return result as Device | null
}

export const syncDeviceAvatar = async (id: string) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token || ''

  const res = await fetch(
    `${supabaseUrl}/functions/v1/device-avatar?id=${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return res.json()
}
