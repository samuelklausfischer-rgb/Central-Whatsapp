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
/**
 * As sete do fim entraram em 09/09/2026, quando TODA ferramenta passou a aceitar
 * exceção pessoa a pessoa. Nelas a linha não quer dizer "tem acesso" e sim "o
 * padrão foi contrariado" — ver a coluna `permitido` logo abaixo.
 *
 * As três últimas nem porteiro tinham: `relatorios` saía do cadastro em outro
 * sistema, e Disparador e Assinaturas eram de todo mundo. Continuam sendo o
 * padrão delas; a novidade é poder abrir exceção.
 */
export type ToolName =
  | 'licitacoes'
  | 'proposta-comercial'
  | 'prn-hub'
  | 'controle-mensagens'
  | 'analise-prn'
  | 'rateio-mobilemed'
  | 'gestao-medica'
  | 'relatorio-app'
  | 'relatorios'
  | 'disparador-em-massa'
  | 'assinaturas'
  /*
    AS TELAS DO PRÓPRIO APP entraram em 09/09/2026: Whats, Email, Agenda e as
    internas passaram a poder ser escondidas de uma pessoa, como as ferramentas.
    O prefixo `tela-` não é enfeite — sem ele uma chave de tela poderia colidir
    com o slug de uma ferramenta, hoje ou quando alguém criar a próxima.
    O Painel não está aqui de propósito: é a âncora, para onde todo bloqueio
    redireciona. Dar porteiro a ele criaria laço.
  */
  | 'tela-chat'
  | 'tela-email'
  | 'tela-email-campanhas'
  | 'tela-agenda'
  | 'tela-crm'
  | 'tela-notes'
  | 'tela-triggers'
  | 'tela-scheduled-messages'

/**
 * Uma linha de `tool_access`.
 *
 * `permitido = false` é BLOQUEIO explícito, e vence o setor e o `is_admin`.
 * Ausência de linha significa "vale o padrão da ferramenta". Quem interpreta os
 * três casos é `podeUsarFerramenta`, em `lib/ferramentas/catalogo.ts`.
 */
export interface AcessoDeFerramenta {
  tool: ToolName
  permitido: boolean
}

/**
 * Ferramentas liberadas para o usuário logado.
 *
 * O filtro por `user_id` é obrigatório, não redundante: a policy
 * `tool_access_select_own_or_admin` é `user_id = auth.uid() OR _is_admin()`,
 * então um admin enxerga as linhas da equipe inteira. Sem o filtro, qualquer
 * admin veria o menu Licitações por causa da liberação de outra pessoa — e só
 * descobriria o engano ao tomar 403 da `licitacao-bridge`, que confere direito.
 */
export const getMyTools = async (userId: string): Promise<AcessoDeFerramenta[]> => {
  const { data, error } = await supabase
    .from('tool_access')
    .select('tool, permitido')
    .eq('user_id', userId)
  if (error) throw error
  return (data as AcessoDeFerramenta[]) || []
}

/**
 * As exceções gravadas numa ferramenta (Gestão de Equipe — só admin enxerga).
 *
 * Devolve liberados E bloqueados: a tela precisa dos dois para desenhar o estado
 * certo. Antes devolvia só ids, quando a presença da linha bastava para dizer
 * "tem acesso".
 */
export const getAcessoDaFerramenta = async (
  tool: ToolName,
): Promise<Map<string, boolean>> => {
  const { data, error } = await supabase
    .from('tool_access')
    .select('user_id, permitido')
    .eq('tool', tool)
  if (error) throw error
  return new Map(
    ((data as { user_id: string; permitido: boolean }[]) || []).map((r) => [r.user_id, r.permitido]),
  )
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

/**
 * Grava o estado de uma pessoa numa ferramenta.
 *
 * `'padrao'` APAGA a linha — é a diferença que importa: nas ferramentas de
 * setor, apagar devolve a pessoa à regra do setor, enquanto `'bloquear'` grava
 * uma linha que contraria essa regra. Nas ferramentas sem padrão os dois dão no
 * mesmo resultado, e a tela oferece só sim/não.
 */
export const setToolAccess = async (
  userId: string,
  tool: ToolName,
  estado: 'padrao' | 'liberar' | 'bloquear',
) => {
  if (estado === 'padrao') {
    const { error } = await supabase
      .from('tool_access')
      .delete()
      .eq('user_id', userId)
      .eq('tool', tool)
    if (error) throw error
    return
  }

  const { error } = await supabase
    .from('tool_access')
    .upsert({ user_id: userId, tool, permitido: estado === 'liberar' })
  if (error) throw error
}
