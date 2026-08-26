import supabase from '@/lib/supabase/client'

/**
 * A caixa de notificações da pessoa.
 *
 * Não há função de CRIAR aqui, e é de propósito: `notificacoes` não tem policy
 * de INSERT. Quem insere é o gatilho `agenda_events_notificar`, que roda no
 * banco como SECURITY DEFINER. Se o cliente pudesse inserir, qualquer pessoa
 * logada forjaria um aviso em nome do sistema.
 */

export interface Notificacao {
  id: string
  user_id: string
  tipo: string
  titulo: string
  corpo: string | null
  link: string | null
  origem_id: string | null
  criada_em: string
  lida_em: string | null
}

/**
 * As mais recentes. O teto de 50 é de tela, não de dado: ninguém rola uma
 * caixa de notificação além disso, e trazer tudo cresceria sem limite.
 */
export async function getNotificacoes(limite = 50): Promise<Notificacao[]> {
  const { data, error } = await supabase
    .from('notificacoes')
    .select('*')
    .order('criada_em', { ascending: false })
    .limit(limite)
  if (error) throw new Error(error.message)
  return (data as Notificacao[]) || []
}

/**
 * Só a contagem, sem trazer as linhas — é o que o sino precisa para desenhar a
 * bolinha. `head: true` faz o PostgREST devolver o total no cabeçalho e nenhum
 * corpo; pedir as 50 linhas para contar seria trabalho jogado fora a cada
 * atualização.
 */
export async function contarNaoLidas(): Promise<number> {
  const { count, error } = await supabase
    .from('notificacoes')
    .select('id', { count: 'exact', head: true })
    .is('lida_em', null)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function marcarLida(id: string): Promise<void> {
  const { error } = await supabase
    .from('notificacoes')
    .update({ lida_em: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Marca todas como lidas.
 *
 * O `.is('lida_em', null)` não é enfeite: sem ele o UPDATE reescreveria também
 * as já lidas, mudando a data de leitura de coisa antiga — e a RLS faria o
 * banco varrer o histórico inteiro à toa.
 */
export async function marcarTodasLidas(): Promise<void> {
  const { error } = await supabase
    .from('notificacoes')
    .update({ lida_em: new Date().toISOString() })
    .is('lida_em', null)
  if (error) throw new Error(error.message)
}

export async function limparLidas(): Promise<void> {
  const { error } = await supabase.from('notificacoes').delete().not('lida_em', 'is', null)
  if (error) throw new Error(error.message)
}
