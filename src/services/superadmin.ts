import supabase from '@/lib/supabase/client'

/**
 * Concede/revoga o acesso de um usuário a uma instância (device) específica.
 * Só super-admin (a função SQL valida _is_super_admin()).
 */
export const setUserDeviceAccess = async (userId: string, deviceId: string, allowed: boolean) => {
  const { error } = await supabase.rpc('set_user_device_access', {
    p_user_id: userId,
    p_device_id: deviceId,
    p_allowed: allowed,
  })
  if (error) throw new Error(error.message)
}
