import supabase from '@/lib/supabase/client'
import type { Profile } from '@/lib/supabase/types'

export type ManagedUser = Profile & { allowed_devices: string[] }

export const getUsers = async () => {
  const [{ data: profiles }, { data: links }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('user_allowed_devices').select('user_id, device_id'),
  ])

  const allowedByUser = new Map<string, string[]>()
  ;((links as { user_id: string; device_id: string }[]) || []).forEach((link) => {
    const current = allowedByUser.get(link.user_id) || []
    allowedByUser.set(link.user_id, [...current, link.device_id])
  })

  return (((profiles as Profile[]) || []).map((profile) => ({
    ...profile,
    allowed_devices: allowedByUser.get(profile.id) || [],
  })) as ManagedUser[])
}

export const createUser = async (data: {
  email: string
  password: string
  name?: string
  username?: string
  is_admin?: boolean
  department?: string | null
  allowed_devices?: string[]
}) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token || ''

  const res = await fetch(`${supabaseUrl}/functions/v1/manage-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'create', ...data }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Failed to create user')
  }

  return res.json()
}

export const updateUser = async (
  id: string,
  data: Partial<Profile & { password?: string; allowed_devices: string[] }>,
) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token || ''

  const res = await fetch(`${supabaseUrl}/functions/v1/manage-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'update', id, ...data }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Failed to update user')
  }

  return res.json()
}

export const deleteUser = async (id: string) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token || ''

  const res = await fetch(`${supabaseUrl}/functions/v1/manage-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'delete', id }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Failed to delete user')
  }

  return res.json()
}
