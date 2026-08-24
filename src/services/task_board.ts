import supabase from '@/lib/supabase/client'
import type { TaskBoardPreference, TaskChecklistItem, TaskStatus } from '@/lib/supabase/types'

/**
 * ITENS 9 e 11: o quadro de tarefas.
 *
 * A decisão que governa este arquivo: a SITUAÇÃO da tarefa é compartilhada e a
 * EXIBIÇÃO é pessoal. Quem confere precisa ver a mesma situação que o
 * responsável marcou (item 9); o arranjo do quadro é de cada um (item 11).
 *
 * Por isso "criar coluna" aqui significa escolher quais das situações aparecem,
 * em que ordem, com que nome e cor — e não inventar um balde privado. Uma
 * tarefa numa coluna que só existe para uma pessoa é uma tarefa que ninguém
 * mais consegue conferir.
 */

export interface ColunaDoQuadro {
  status: TaskStatus
  titulo: string
  cor: string
  visivel: boolean
  ordem: number
}

/**
 * O quadro padrão, para quem nunca personalizou nada. É também a lista completa
 * de situações — as preferências só sobrescrevem estes valores, nunca criam
 * situação nova (o CHECK do banco recusaria).
 */
export const COLUNAS_PADRAO: ColunaDoQuadro[] = [
  { status: 'pending', titulo: 'Pendente', cor: 'amber', visivel: true, ordem: 0 },
  { status: 'in_progress', titulo: 'Em andamento', cor: 'blue', visivel: true, ordem: 1 },
  { status: 'waiting', titulo: 'Aguardando', cor: 'purple', visivel: true, ordem: 2 },
  { status: 'in_review', titulo: 'Em validação', cor: 'teal', visivel: true, ordem: 3 },
  { status: 'completed', titulo: 'Concluída', cor: 'green', visivel: true, ordem: 4 },
]

/** Classes por cor. Nome curto no banco, Tailwind aqui — trocar a paleta não vira migration. */
export const CLASSES_DE_COR: Record<string, string> = {
  amber: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500',
  blue: 'bg-blue-500/10 border-blue-500/20 text-blue-500',
  purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
  teal: 'bg-teal-500/10 border-teal-500/20 text-teal-400',
  green: 'bg-green-500/10 border-green-500/20 text-green-500',
  slate: 'bg-slate-500/10 border-slate-500/20 text-slate-400',
  red: 'bg-red-500/10 border-red-500/20 text-red-400',
}

export const CORES_DISPONIVEIS = Object.keys(CLASSES_DE_COR)

/**
 * O quadro DESTA pessoa: o padrão com as preferências dela por cima.
 *
 * Falhar aqui não pode esconder as tarefas — sem preferência a pessoa ainda tem
 * um quadro utilizável. Por isso o erro devolve o padrão em vez de propagar.
 */
export async function getColunas(userId: string): Promise<ColunaDoQuadro[]> {
  const { data, error } = await supabase
    .from('task_board_preferences')
    .select('*')
    .eq('user_id', userId)

  if (error) {
    console.error('Erro ao ler preferências do quadro:', error)
    return COLUNAS_PADRAO
  }

  const porStatus = new Map<string, TaskBoardPreference>()
  for (const p of (data as TaskBoardPreference[]) || []) porStatus.set(p.status, p)

  return COLUNAS_PADRAO.map((padrao) => {
    const pref = porStatus.get(padrao.status)
    if (!pref) return padrao
    return {
      status: padrao.status,
      titulo: pref.titulo || padrao.titulo,
      cor: pref.cor || padrao.cor,
      visivel: pref.visivel,
      ordem: pref.ordem,
    }
  }).sort((a, b) => a.ordem - b.ordem)
}

/** Grava a personalização inteira de uma vez — é sempre o quadro completo. */
export async function salvarColunas(userId: string, colunas: ColunaDoQuadro[]): Promise<void> {
  const linhas = colunas.map((c, i) => ({
    user_id: userId,
    status: c.status,
    visivel: c.visivel,
    ordem: i,
    titulo: c.titulo,
    cor: c.cor,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await supabase.from('task_board_preferences').upsert(linhas)
  if (error) throw new Error(error.message)
}

/** Volta ao padrão apagando as preferências — a ausência de linha JÁ é o padrão. */
export async function restaurarColunasPadrao(userId: string): Promise<void> {
  const { error } = await supabase.from('task_board_preferences').delete().eq('user_id', userId)
  if (error) throw new Error(error.message)
}

// ——— Checklist (ITEM 11) ———

export async function getChecklist(taskId: string): Promise<TaskChecklistItem[]> {
  const { data, error } = await supabase
    .from('task_checklist_items')
    .select('*')
    .eq('task_id', taskId)
    .order('ordem', { ascending: true })
  if (error) throw new Error(error.message)
  return (data as TaskChecklistItem[]) || []
}

export async function adicionarItem(taskId: string, texto: string, ordem: number): Promise<TaskChecklistItem> {
  const { data, error } = await supabase
    .from('task_checklist_items')
    .insert({ task_id: taskId, texto, ordem })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as TaskChecklistItem
}

export async function marcarItem(id: string, feito: boolean): Promise<void> {
  const { error } = await supabase.from('task_checklist_items').update({ feito }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function removerItem(id: string): Promise<void> {
  const { error } = await supabase.from('task_checklist_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
