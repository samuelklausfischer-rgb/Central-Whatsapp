import supabase from '@/lib/supabase/client'

/*
 * `setUserDeviceAccess` vivia aqui e foi removida em 09/09/2026, junto com o
 * card "Acesso ao WhatsApp por usuário" que era seu único chamador. Quem grava
 * a lista de aparelhos agora é o popup de cadastro, pela edge function
 * `manage-user` — que tem o sinalizador `devices_explicit`, sem o qual uma
 * lista vazia seria confundida com "não escolhi nada".
 *
 * A RPC `set_user_device_access` continua existindo no banco.
 */

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
