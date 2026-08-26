import type { Profile } from './supabase/types'

export const FINANCEIRO_DEPARTMENT = 'Financeiro'
export const ADMINISTRATIVO_DEPARTMENT = 'Administrativo'

export function canAccessFinanceiroTools(
  user: Pick<Profile, 'is_admin' | 'department'> | null | undefined,
) {
  return Boolean(user?.is_admin || user?.department === FINANCEIRO_DEPARTMENT)
}

/**
 * Gestão Médica: o setor Administrativo, e mais o super-admin.
 *
 * `is_super_admin` e NÃO `is_admin`, ao contrário do financeiro logo acima — a
 * diferença foi deliberada em 26/08/2026. Com `is_admin` entravam junto três
 * pessoas de fora do setor (Kezia, do Financeiro, e Dr. Paulo e Patricia, sem
 * setor), porque ser admin não diz nada sobre cuidar de cadastro médico. O
 * super-admin fica como escotilha: hoje ele é do Administrativo e entraria de
 * qualquer forma, mas se mudar de setor amanhã continua entrando.
 *
 * Esta regra é um ESPELHO de `gestao_medica._pode_usar()` no banco, que é a que
 * vale de verdade — a RLS de lá não deixa passar nada nem para quem digitar a
 * rota na mão. O gate daqui existe só para não oferecer no menu uma porta que
 * bate na cara.
 *
 * Se um dia divergirem, a do banco ganha; mudar uma exige mudar a outra.
 */
export function canAccessGestaoMedica(
  user:
    | (Pick<Profile, 'department'> & { is_super_admin?: boolean | null })
    | null
    | undefined,
) {
  return Boolean(user?.is_super_admin || user?.department === ADMINISTRATIVO_DEPARTMENT)
}
