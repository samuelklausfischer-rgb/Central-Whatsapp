import supabase from '@/lib/supabase/client'

/**
 * Ferramentas liberadas pessoa a pessoa (tabela public.tool_access).
 *
 * A coluna `tool` é texto livre, sem CHECK: incluir um nome novo aqui não pede
 * migration. Quem entra nesta lista precisa aparecer também em
 * `use-tool-access.tsx` (para o app saber consultar) e na Gestão de Equipe
 * (para alguém conseguir liberar).
 */
/**
 * `disparador-em-massa` SAIU desta união em 26/08/2026: a ferramenta passou a
 * ser de todo mundo, então não há o que liberar. A linha que sobrou no banco
 * para o Samuel é inofensiva — ninguém mais a consulta.
 *
 * `controle-mensagens` ENTROU no mesmo dia. Ela era de super-admin (só o
 * Samuel), e o conjunto pedido — Raphaela, Renata, Kezia e Samuel — não é nenhum
 * setor nem "todo admin": deixa de fora dois dos seis admins. Só liberação
 * pessoa a pessoa descreve isso.
 */
export type ToolName =
  | 'licitacoes'
  | 'proposta-comercial'
  | 'prn-hub'
  | 'controle-mensagens'

/**
 * Ferramentas liberadas para o usuário logado.
 *
 * O filtro por `user_id` é obrigatório, não redundante: a policy
 * `tool_access_select_own_or_admin` é `user_id = auth.uid() OR _is_admin()`,
 * então um admin enxerga as linhas da equipe inteira. Sem o filtro, qualquer
 * admin veria o menu Licitações por causa da liberação de outra pessoa — e só
 * descobriria o engano ao tomar 403 da `licitacao-bridge`, que confere direito.
 */
export const getMyTools = async (userId: string): Promise<ToolName[]> => {
  const { data, error } = await supabase.from('tool_access').select('tool').eq('user_id', userId)
  if (error) throw error
  return ((data as { tool: ToolName }[]) || []).map((row) => row.tool)
}

/** Usuários liberados para uma ferramenta (Gestão de Equipe — só admin enxerga). */
export const getToolUserIds = async (tool: ToolName): Promise<string[]> => {
  const { data, error } = await supabase.from('tool_access').select('user_id').eq('tool', tool)
  if (error) throw error
  return ((data as { user_id: string }[]) || []).map((row) => row.user_id)
}

/**
 * O Relatórios não usa `tool_access`: quem tem perfil lá é quem entra. As tabelas
 * dele vivem no schema `relatorios` do MESMO projeto Supabase, então dá para
 * perguntar direto — sem segunda conexão e sem duplicar a lista de liberados.
 */
export const hasRelatoriosProfile = async (userId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .schema('relatorios')
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data != null
}

export const setToolAccess = async (userId: string, tool: ToolName, enabled: boolean) => {
  if (enabled) {
    const { error } = await supabase.from('tool_access').upsert({ user_id: userId, tool })
    if (error) throw error
    return
  }

  const { error } = await supabase.from('tool_access').delete().eq('user_id', userId).eq('tool', tool)
  if (error) throw error
}
