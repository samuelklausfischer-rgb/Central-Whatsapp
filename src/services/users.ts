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

export type AdminAuditEntry = {
  id: number
  occurred_at: string
  actor_id: string | null
  actor_label: string | null
  target_user_id: string | null
  target_label: string | null
  entity: string
  action: string
  changes: Record<string, unknown> | null
  source: string | null
}

/**
 * Histórico de alterações de cadastro e permissão. A RLS já limita a leitura a
 * admin — para quem não é, a consulta volta vazia em vez de dar erro.
 */
export const getAdminAuditLog = async (limit = 100) => {
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching admin audit log:', error)
    return []
  }

  return (data as AdminAuditEntry[]) || []
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
  data: Partial<
    Profile & {
      password?: string
      allowed_devices: string[]
      /** Marca a lista como escolha deliberada — sem isso a edge function se
       * recusa a esvaziar os aparelhos de alguém. Ver o comentário em
       * `manage-user/index.ts`. */
      devices_explicit?: boolean
    }
  >,
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

/**
 * Desativa a pessoa sem apagá-la: o login é bloqueado, os aparelhos saem e as
 * conversas que estavam com ela voltam para a Geral. O histórico fica.
 *
 * Vai direto na RPC (e não pela edge function `manage-user`) porque o
 * banimento é feito em SQL: a RPC é SECURITY DEFINER de um dono que escreve em
 * `auth.users`. Quem não é admin leva `forbidden` — a checagem é do banco, o
 * botão escondido na tela é só conforto.
 */
export const desativarUsuario = async (id: string, motivo?: string) => {
  const { error } = await supabase.rpc('desativar_usuario', {
    p_user_id: id,
    p_motivo: motivo?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

/**
 * Libera o login de novo. As conversas NÃO voltam para a pessoa e os aparelhos
 * NÃO são restaurados — quem reativa escolhe de novo pelo cadastro.
 */
export const reativarUsuario = async (id: string) => {
  const { error } = await supabase.rpc('reativar_usuario', { p_user_id: id })
  if (error) throw new Error(error.message)
}

/**
 * Ids das pessoas desativadas, para o selo da tela de Equipe.
 *
 * Não lança: se a leitura falhar (rede, ou a migration ainda não aplicada), a
 * tela de Equipe precisa continuar abrindo. O pior caso é um selo faltando — e
 * desativar quem já está desativado devolve um erro claro do banco.
 */
export const listarDesativados = async (): Promise<Set<string>> => {
  const { data, error } = await supabase.rpc('usuarios_desativados_ids')

  if (error) {
    console.error('Error fetching deactivated users:', error)
    return new Set()
  }

  return new Set((data as string[] | null) ?? [])
}
