import supabase from '@/lib/supabase/client'
import type { AgendaEvent, AgendaGroup } from '@/lib/supabase/types'

/**
 * ITEM 1: acesso à agenda.
 *
 * Não há filtro de "quem pode ver" aqui de propósito — quem decide é a RLS
 * (`agenda_events_ver`). Repetir a regra no cliente criaria duas verdades sobre
 * a mesma coisa, e a do cliente é a que envelhece sem ninguém notar. O que este
 * arquivo faz é filtrar por PERÍODO e por MODO de visualização, que são
 * escolhas de tela, não de permissão.
 */

export type ModoDaAgenda = 'meus' | 'setor' | 'grupos' | 'tudo'

export interface EventoComPessoas extends AgendaEvent {
  criador_nome?: string | null
  designado_nome?: string | null
  grupo_nome?: string | null
}

/**
 * Compromissos que cruzam o intervalo pedido.
 *
 * A condição é `starts_at < fim AND ends_at >= inicio`, e não
 * `starts_at BETWEEN ...`: um compromisso que começou ontem e termina amanhã
 * precisa aparecer hoje. Com `BETWEEN` no início, ele sumiria justamente do dia
 * em que está acontecendo.
 */
export async function getEventos(
  inicioIso: string,
  fimIso: string,
  modo: ModoDaAgenda,
  userId: string,
): Promise<EventoComPessoas[]> {
  let q = supabase
    .from('agenda_events')
    .select('*')
    .lt('starts_at', fimIso)
    .gte('ends_at', inicioIso)
    .order('starts_at', { ascending: true })

  // 'tudo' não filtra nada: mostra tudo que a RLS já deixou passar.
  if (modo === 'meus') {
    q = q.or(`created_by.eq.${userId},assigned_to.eq.${userId}`)
  } else if (modo === 'setor') {
    q = q.eq('escopo', 'setor')
  } else if (modo === 'grupos') {
    q = q.eq('escopo', 'grupo')
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data as EventoComPessoas[]) || []
}

export type NovoEvento = Omit<AgendaEvent, 'id' | 'created_at' | 'updated_at'>

export async function criarEvento(evento: NovoEvento): Promise<AgendaEvent> {
  const { data, error } = await supabase.from('agenda_events').insert(evento).select().single()
  // O gatilho `agenda_events_designacao` recusa designar para fora do setor com
  // uma exceção de texto legível — repassar a mensagem do banco é melhor que
  // traduzir aqui, onde a regra não mora.
  if (error) throw new Error(error.message)
  return data as AgendaEvent
}

export async function atualizarEvento(id: string, mudancas: Partial<NovoEvento>): Promise<AgendaEvent> {
  const { data, error } = await supabase
    .from('agenda_events')
    .update({ ...mudancas, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as AgendaEvent
}

export async function excluirEvento(id: string): Promise<void> {
  const { error } = await supabase.from('agenda_events').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getGrupos(): Promise<AgendaGroup[]> {
  const { data, error } = await supabase.from('agenda_groups').select('*').order('nome')
  if (error) throw new Error(error.message)
  return (data as AgendaGroup[]) || []
}

export async function criarGrupo(nome: string, createdBy: string, membros: string[]): Promise<AgendaGroup> {
  const { data, error } = await supabase
    .from('agenda_groups')
    .insert({ nome, created_by: createdBy })
    .select()
    .single()
  if (error) throw new Error(error.message)

  const grupo = data as AgendaGroup
  // Quem cria entra no próprio grupo: sem isso o criador não apareceria em
  // "Grupos" e não veria os compromissos que ele mesmo criou por ali.
  const todos = Array.from(new Set([createdBy, ...membros]))
  const { error: erroMembros } = await supabase
    .from('agenda_group_members')
    .insert(todos.map((user_id) => ({ group_id: grupo.id, user_id })))
  if (erroMembros) throw new Error(erroMembros.message)

  return grupo
}

export async function getMembrosDoGrupo(groupId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('agenda_group_members')
    .select('user_id')
    .eq('group_id', groupId)
  if (error) throw new Error(error.message)
  return ((data as { user_id: string }[]) || []).map((r) => r.user_id)
}

export interface Colega {
  id: string
  nome: string
  setor: string | null
  /** Já conectou o Outlook? Quem não conectou não pode ser convidado. */
  tem_outlook: boolean
}

/**
 * As pessoas que podem entrar num grupo.
 *
 * Vem de uma RPC e não de `select` em `profiles` porque a policy de lá
 * (`users_read_own_profile`) só deixa ver o PRÓPRIO cadastro — ninguém
 * conseguiria escolher gente para montar um grupo.
 *
 * A função `colegas()` é SECURITY DEFINER e devolve o mínimo: nome, setor e se
 * a pessoa já conectou o Outlook. Sem e-mail, sem `is_admin`, sem telefone. A
 * lista de convite é resolvida no servidor na hora de convidar, justamente para
 * o e-mail nunca precisar sair daqui.
 */
export async function getColegas(): Promise<Colega[]> {
  const { data, error } = await supabase.rpc('colegas')
  if (error) throw new Error(error.message)
  return (data as Colega[]) || []
}

/**
 * Troca a lista de membros por outra.
 *
 * Apaga e reinsere em vez de calcular a diferença: a tabela é (group_id,
 * user_id) sem coluna nenhuma além disso, então não há o que preservar numa
 * linha que ficou. Menos código para o mesmo resultado.
 *
 * Quem pode mexer é o dono do grupo ou um admin — a policy
 * `agenda_membros_mexer` decide, e recusa qualquer outro.
 */
export async function atualizarMembros(groupId: string, membros: string[]): Promise<void> {
  const { error: erroApagar } = await supabase
    .from('agenda_group_members')
    .delete()
    .eq('group_id', groupId)
  if (erroApagar) throw new Error(erroApagar.message)

  if (membros.length === 0) return

  const { error } = await supabase
    .from('agenda_group_members')
    .insert(Array.from(new Set(membros)).map((user_id) => ({ group_id: groupId, user_id })))
  if (error) throw new Error(error.message)
}

export async function renomearGrupo(groupId: string, nome: string): Promise<void> {
  const { error } = await supabase.from('agenda_groups').update({ nome }).eq('id', groupId)
  if (error) throw new Error(error.message)
}

/**
 * Quantos compromissos SERIAM APAGADOS junto com o grupo.
 *
 * `agenda_events.group_id` é `ON DELETE CASCADE` — apagar o grupo apaga TODOS
 * os compromissos dele, não só o acesso coletivo. Como isso não tem volta, a
 * tela pergunta antes, com o número na frente.
 */
export async function contarCompromissosDoGrupo(groupId: string): Promise<number> {
  const { count, error } = await supabase
    .from('agenda_events')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * Apaga o grupo — e, POR CASCATA, os compromissos dele.
 *
 * As duas FKs são `ON DELETE CASCADE`: os membros vão junto (esperado) e os
 * compromissos também (destrutivo). Chamar `contarCompromissosDoGrupo()` antes
 * e confirmar com a pessoa não é zelo excessivo: é a diferença entre "tirei o
 * grupo da lista" e "apaguei quarenta compromissos".
 */
export async function excluirGrupo(groupId: string): Promise<void> {
  const { error } = await supabase.from('agenda_groups').delete().eq('id', groupId)
  if (error) throw new Error(error.message)
}
