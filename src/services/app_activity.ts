import supabase from '@/lib/supabase/client'
import type { AppPlatform } from '@/lib/app-info'

export interface UserAppDailyActivity {
  user_id: string
  dia: string
  platform: AppPlatform
  active_seconds: number
  open_seconds: number
  app_version: string | null
  first_seen_at: string
  last_seen_at: string
}

export interface UserAppSession {
  user_id: string
  platform: AppPlatform
  app_version: string | null
  started_at: string
  last_seen_at: string
  last_active_at: string | null
}

/** Batida de presença. Silenciosa por design: nunca deve atrapalhar o uso. */
export async function sendHeartbeat(
  platform: AppPlatform,
  version: string | null,
  active: boolean,
): Promise<void> {
  await supabase.rpc('app_heartbeat', {
    p_platform: platform,
    p_version: version,
    p_active: active,
  })
}

/**
 * Atividade no intervalo. `dtInicio`/`dtFim` são datas locais no formato
 * YYYY-MM-DD — precisam vir de `format()` do date-fns, NUNCA de
 * `toISOString().slice(0,10)`, que devolve a data em UTC e depois das 21h BRT
 * já aponta para o dia seguinte.
 */
export async function getDailyActivity(
  dtInicio: string,
  dtFim: string,
): Promise<UserAppDailyActivity[]> {
  const { data, error } = await supabase
    .from('user_app_daily_activity')
    .select('*')
    .gte('dia', dtInicio)
    .lte('dia', dtFim)
    .order('dia', { ascending: false })
  if (error) throw new Error(error.message)
  return (data as UserAppDailyActivity[]) || []
}

/** Último sinal de vida por usuário/plataforma — alimenta a coluna "visto por último". */
export async function getSessions(): Promise<UserAppSession[]> {
  const { data, error } = await supabase.from('user_app_sessions').select('*')
  if (error) throw new Error(error.message)
  return (data as UserAppSession[]) || []
}
