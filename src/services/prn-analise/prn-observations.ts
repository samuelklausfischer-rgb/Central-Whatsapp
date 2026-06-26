import { supabaseFinanceiro } from '@/lib/supabase/client-financeiro'

export interface PrnRowObservation {
  id: string
  run_id: string
  row_key: string
  observation: string
  created_at: string
  created_by: string | null
}

async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabaseFinanceiro.auth.getUser()
  return user?.id || null
}

export function makeRowKey(unidade: string, favorecido: string, categoria: string): string {
  return `${unidade}|||${favorecido}|||${categoria}`
}

export async function getObservationsByRunId(runId: string): Promise<PrnRowObservation[]> {
  const { data, error } = await supabaseFinanceiro
    .from('prn_row_observations')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

export async function saveObservation(
  runId: string,
  rowKey: string,
  observation: string,
  existingId?: string,
): Promise<PrnRowObservation> {
  const userId = await getCurrentUserId()

  if (existingId) {
    const { data, error } = await supabaseFinanceiro
      .from('prn_row_observations')
      .update({ observation })
      .eq('id', existingId)
      .select()
      .single()
    if (error) throw error
    return data
  }

  const { data, error } = await supabaseFinanceiro
    .from('prn_row_observations')
    .insert({ run_id: runId, row_key: rowKey, observation, created_by: userId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteObservation(id: string): Promise<void> {
  const { error } = await supabaseFinanceiro.from('prn_row_observations').delete().eq('id', id)
  if (error) throw error
}
