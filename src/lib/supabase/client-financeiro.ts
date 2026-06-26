import { createClient } from '@supabase/supabase-js'

export const supabaseFinanceiro = createClient(
  import.meta.env.VITE_FINANCEIRO_SUPABASE_URL,
  import.meta.env.VITE_FINANCEIRO_SUPABASE_ANON_KEY,
)
