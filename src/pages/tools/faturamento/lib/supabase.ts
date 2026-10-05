// Acesso ao schema `faturamento_unidades` com o cliente do Central Whats: vai com
// o login de quem está usando, e o banco só deixa passar quem
// faturamento_unidades._pode_usar() aprova (admin, Financeiro ou tool_access 'faturamento').
import supabase from '@/lib/supabase/client'

export const db = supabase.schema('faturamento_unidades')
