import supabase from '@/lib/supabase/client'
import type { Task, Contact } from '@/lib/supabase/types'

export interface TaskAssignee {
  id: string
  name: string | null
  avatar_url: string | null
  department: string | null
}

export interface TaskWithRelations extends Task {
  assignee: TaskAssignee | null
  creator: TaskAssignee | null
  contact: Contact | null
}

// A RLS de `tasks` (select_tasks) já entrega só o que este usuário pode ver —
// as próprias tarefas, as direcionadas a ele e, se admin, tudo. Aqui só junta
// responsável, criador e contato para o Kanban não precisar de mais buscas.
export async function getTasks(): Promise<TaskWithRelations[]> {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })

  // Propaga em vez de devolver lista vazia: falha de rede que vira `[]` aparece
  // na tela como "você não tem tarefas", que é a mensagem errada e some com o
  // problema. Quem chama já tem try/catch (CRM e Dashboard) e sabe distinguir
  // vazio de erro.
  if (error) throw new Error(error.message)

  const rows = (tasks as Task[]) || []
  if (rows.length === 0) return []

  const profileIds = [
    ...new Set(rows.flatMap((t) => [t.assigned_to, t.user_id]).filter((id): id is string => !!id)),
  ]
  const contactIds = [...new Set(rows.map((t) => t.contact_id).filter((id): id is string => !!id))]

  const [profilesResult, contactsResult] = await Promise.all([
    profileIds.length
      ? supabase.from('profiles').select('id, name, avatar_url, department').in('id', profileIds)
      : Promise.resolve({ data: [] as TaskAssignee[] }),
    contactIds.length
      ? supabase.from('contacts').select('*').in('id', contactIds)
      : Promise.resolve({ data: [] as Contact[] }),
  ])

  const profileMap = new Map<string, TaskAssignee>(
    ((profilesResult.data as TaskAssignee[]) || []).map((p) => [p.id, p]),
  )
  const contactMap = new Map<string, Contact>(
    ((contactsResult.data as Contact[]) || []).map((c) => [c.id, c]),
  )

  return rows.map((t) => ({
    ...t,
    assignee: t.assigned_to ? profileMap.get(t.assigned_to) ?? null : null,
    creator: profileMap.get(t.user_id) ?? null,
    contact: t.contact_id ? contactMap.get(t.contact_id) ?? null : null,
  }))
}

export interface CreateTaskInput {
  title: string
  description?: string | null
  user_id: string
  /** Ausente = tarefa para si mesmo. A policy insert_tasks só deixa admin gravar outro id. */
  assigned_to?: string | null
  due_date?: string | null
  contact_id?: string | null
  status?: Task['status']
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'pending',
      contact_id: input.contact_id ?? null,
      user_id: input.user_id,
      assigned_to: input.assigned_to ?? input.user_id,
      due_date: input.due_date ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating task:', error)
    throw error
  }
  return data as Task
}

export async function updateTaskStatus(id: string, status: Task['status']): Promise<void> {
  const { error } = await supabase.from('tasks').update({ status }).eq('id', id)
  if (error) {
    console.error('Error updating task status:', error)
    throw error
  }
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, 'title' | 'description' | 'status' | 'assigned_to' | 'due_date' | 'contact_id'>>,
): Promise<void> {
  const { error } = await supabase.from('tasks').update(patch).eq('id', id)
  if (error) {
    console.error('Error updating task:', error)
    throw error
  }
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) {
    console.error('Error deleting task:', error)
    throw error
  }
}

// Admin recebe a equipe inteira; os demais, só a si mesmos (mesma regra da
// policy insert_tasks) — o seletor de responsável fica sempre coerente com o
// que a gravação vai aceitar.
export async function getTaskAssignees(): Promise<TaskAssignee[]> {
  const { data, error } = await supabase.rpc('get_task_assignees')
  if (error) {
    console.error('Error fetching task assignees:', error)
    return []
  }
  return (data as TaskAssignee[]) || []
}
