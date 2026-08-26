import type { Profile } from './supabase/types'

export const FINANCEIRO_DEPARTMENT = 'Financeiro'
export const ADMINISTRATIVO_DEPARTMENT = 'Administrativo'

export function canAccessFinanceiroTools(
  user: Pick<Profile, 'is_admin' | 'department'> | null | undefined,
) {
  return Boolean(user?.is_admin || user?.department === FINANCEIRO_DEPARTMENT)
}

/**
 * Gestão Médica: liberado para o setor Administrativo, que é como o item do Hub
 * pediu ("para o setor adm").
 *
 * Esta regra é um ESPELHO de `gestao_medica._pode_usar()` no banco, que já está
 * aplicada e é a que vale de verdade — a RLS de lá não deixa passar nada nem
 * para quem digitar a rota na mão. O gate daqui existe só para não oferecer no
 * menu uma porta que bate na cara.
 *
 * Se um dia divergirem, a do banco ganha; mudar uma exige mudar a outra.
 */
export function canAccessGestaoMedica(
  user: Pick<Profile, 'is_admin' | 'department'> | null | undefined,
) {
  return Boolean(user?.is_admin || user?.department === ADMINISTRATIVO_DEPARTMENT)
}
