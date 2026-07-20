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

/**
 * Liga/desliga a restrição de acesso de um usuário (inclusive admins). Só super-admin.
 * restricted=true → o usuário passa a respeitar user_allowed_devices mesmo sendo admin.
 * restricted=false → admin volta a ter acesso a tudo.
 */
export const setUserDevicesRestricted = async (userId: string, restricted: boolean) => {
  const { error } = await supabase.rpc('set_user_devices_restricted', {
    p_user_id: userId,
    p_restricted: restricted,
  })
  if (error) throw new Error(error.message)
}
