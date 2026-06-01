import { useEffect, useState } from 'react'
import { GripVertical, Trash2 } from 'lucide-react'
import supabase from '@/lib/supabase/client'
import type { Task, Contact } from '@/lib/supabase/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface TaskWithContact extends Task {
  contact?: Contact
}

export default function CRM() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [tasks, setTasks] = useState<TaskWithContact[]>([])
  const [loading, setLoading] = useState(true)
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null)

  const fetchTasks = async () => {
    try {
      const { data: taskData } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false })

      if (!taskData) {
        setTasks([])
        return
      }

      // Fetch contacts separately
      const contactIds = [...new Set(taskData.map((t: Task) => t.contact_id))]
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('*')
        .in('id', contactIds)

      const contactMap = new Map<string, Contact>()
      if (contactsData) {
        (contactsData as Contact[]).forEach((c) => contactMap.set(c.id, c))
      }

      const tasksWithContacts = (taskData as Task[]).map((t) => ({
        ...t,
        contact: contactMap.get(t.contact_id),
      }))
      setTasks(tasksWithContacts)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) {
      fetchTasks()
    }
  }, [user])

  useRealtime('tasks', () => {
    fetchTasks()
  })

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return
    const id = taskToDelete
    setTaskToDelete(null)
    try {
      await supabase.from('tasks').delete().eq('id', id)
      setTasks((prev) => prev.filter((t) => t.id !== id))
      toast({ title: 'Task deleted successfully' })
    } catch (err) {
      toast({ title: 'Failed to delete task. Please try again.', variant: 'destructive' })
    }
  }

  const updateTaskStatus = async (taskId: string, newStatus: Task['status']) => {
    try {
      await supabase.from('tasks').update({ status: newStatus }).eq('id', taskId)
    } catch (err) {
      toast({ title: 'Erro ao mover tarefa', variant: 'destructive' })
      fetchTasks()
    }
  }

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId)
    e.currentTarget.classList.add('opacity-50')
  }

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-50')
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent, status: Task['status']) => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('taskId')
    if (!taskId) return

    const task = tasks.find((t) => t.id === taskId)
    if (task && task.status !== status) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)))
      updateTaskStatus(taskId, status)
    }
  }

  const columns = [
    {
      id: 'pending',
      title: 'Pendente',
      color: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500',
    },
    {
      id: 'in_progress',
      title: 'Em Andamento',
      color: 'bg-blue-500/10 border-blue-500/20 text-blue-500',
    },
    {
      id: 'completed',
      title: 'Concluído',
      color: 'bg-green-500/10 border-green-500/20 text-green-500',
    },
  ] as const

  return (
    <div className="flex-1 h-full flex flex-col min-w-0 bg-card relative overflow-hidden">
      <div className="p-6 pb-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          Tarefas e Kanban
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Arraste e solte as tarefas para alterar o status.
        </p>
      </div>

      <div className="flex-1 overflow-x-auto p-6 flex gap-6">
        {columns.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.id)
          return (
            <div
              key={col.id}
              className="flex-shrink-0 w-80 bg-muted border border-border rounded-xl flex flex-col overflow-hidden"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              <div
                className={`px-4 py-3 border-b border-border flex items-center justify-between ${col.color.split(' ')[0]}`}
              >
                <h3 className={`font-semibold text-sm ${col.color.split(' ')[2]}`}>{col.title}</h3>
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-foreground/70">
                  {columnTasks.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                {columnTasks.map((task) => {
                  const contactName =
                    task.contact?.nickname ||
                    task.contact?.name ||
                    `+${task.contact?.remote_jid}`
                  const avatarUrl = task.contact?.avatar_url
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onDragEnd={handleDragEnd}
                      className="bg-accent border border-border p-3 rounded-lg cursor-grab active:cursor-grabbing hover:bg-accent transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h4 className="font-medium text-sm text-foreground/90 leading-tight">
                          {task.title}
                        </h4>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setTaskToDelete(task.id)
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="p-1 hover:bg-red-500/20 rounded text-red-400 hover:text-red-500 transition-colors"
                            title="Delete task"
                            type="button"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                      {task.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-3 break-words">
                          {task.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
                        <div className="flex items-center gap-2 max-w-[70%]">
                          <Avatar className="h-5 w-5 border border-border">
                            <AvatarImage src={avatarUrl || ''} />
                            <AvatarFallback className="text-[9px] bg-blue-500/20 text-blue-400">
                              {contactName?.charAt(0)?.toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span
                            className="text-[11px] text-muted-foreground truncate"
                            title={contactName}
                          >
                            {contactName}
                          </span>
                        </div>
                        <span
                          className="text-[10px] text-muted-foreground/60"
                          title={new Date(task.created_at).toLocaleString()}
                        >
                          {new Date(task.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {columnTasks.length === 0 && !loading && (
                  <div className="h-24 flex items-center justify-center text-sm text-muted-foreground/50 border border-dashed border-border rounded-lg">
                    Vazio
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this task?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This action cannot be undone. This will permanently delete the task.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-border text-foreground hover:bg-accent hover:text-accent-foreground">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteTask}
              className="bg-red-500 text-foreground hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
