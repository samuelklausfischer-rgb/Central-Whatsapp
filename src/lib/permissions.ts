import type { Profile } from './supabase/types'

export const FINANCEIRO_DEPARTMENT = 'Financeiro'

export function canAccessFinanceiroTools(
  user: Pick<Profile, 'is_admin' | 'department'> | null | undefined,
) {
  return Boolean(user?.is_admin || user?.department === FINANCEIRO_DEPARTMENT)
}
