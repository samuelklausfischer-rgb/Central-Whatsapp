import { useEffect, useMemo, useState } from 'react'
import { GripVertical, Trash2, Plus, Loader2 } from 'lucide-react'
import type { Task } from '@/lib/supabase/types'
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
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { ListRow, ListRowPill } from '@/components/ui/list-row'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { useIsMobile } from '@/hooks/use-mobile'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  getTasks,
  createTask,
  updateTaskStatus,
  updateTask,
  deleteTask,
  getTaskAssignees,
  SITUACOES_COM_MOTIVO,
  type TaskWithRelations,
  type TaskAssignee,
} from '@/services/tasks'
import {
  getColunas,
  salvarColunas,
  restaurarColunasPadrao,
  getChecklist,
  adicionarItem,
  marcarItem,
  removerItem,
  COLUNAS_PADRAO,
  CLASSES_DE_COR,
  CORES_DISPONIVEIS,
  type ColunaDoQuadro,
} from '@/services/task_board'
import type { TaskChecklistItem } from '@/lib/supabase/types'
import { Checkbox } from '@/components/ui/checkbox'
import { Eye, EyeOff, ArrowUp, ArrowDown, RotateCcw, Settings2 } from 'lucide-react'

type TabKey = 'minhas' | 'direcionadas' | 'todas'

/** Datas do banco são `date` (sem hora). Formatar sem passar por `Date` evita
 * que o fuso local empurre "2026-08-07" para o dia anterior na tela. */
function formatDueDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
}

export default function CRM() {
  const { user } = useAuth()
  const { toast } = useToast()
  const isAdmin = !!user?.is_admin

  const [tasks, setTasks] = useState<TaskWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('minhas')

  const [assignees, setAssignees] = useState<TaskAssignee[]>([])
  const [loadingAssignees, setLoadingAssignees] = useState(true)

  // ITEM 11: quadro pessoal. Nasce no padrão para a tela nunca ficar sem
  // colunas enquanto a preferência não chega do banco.
  const [colunas, setColunas] = useState<ColunaDoQuadro[]>(COLUNAS_PADRAO)
  const [painelColunasAberto, setPainelColunasAberto] = useState(false)

  // ITEM 11: tarefa aberta no detalhe, com checklist.
  const [tarefaAberta, setTarefaAberta] = useState<TaskWithRelations | null>(null)
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([])
  const [novoItem, setNovoItem] = useState('')

  // ITEM 9: quando a nova situação pede justificativa, ela é perguntada ANTES
  // de gravar — senão a tarefa fica "aguardando" sem ninguém saber o quê.
  const [pedindoMotivo, setPedindoMotivo] = useState<{ taskId: string; status: Task['status'] } | null>(null)
  const [motivo, setMotivo] = useState('')

  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [isSavingNewTask, setIsSavingNewTask] = useState(false)

  // Sem hover no APK Android (Capacitor): um controle só visível em hover é,
  // na prática, um controle que não existe no toque. No celular ele fica
  // sempre visível.
  const noCelular = useIsMobile()

  const fetchTasks = async () => {
    try {
      const data = await getTasks()
      setTasks(data)
    } catch (err) {
      console.error(err)
      toast({ title: 'Erro ao carregar tarefas', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const fetchAssignees = async () => {
    setLoadingAssignees(true)
    try {
      const data = await getTaskAssignees()
      // Falha na RPC (ou lista vazia por perfil sem nome) não pode travar a
      // criação de tarefa: cai para "só eu mesmo", que é o que a policy de
      // INSERT sempre permite.
      const list = data.length
        ? data
        : user
          ? [{ id: user.id, name: user.name, avatar_url: user.avatar_url, department: user.department }]
          : []
      setAssignees(list)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingAssignees(false)
    }
  }

  useEffect(() => {
    if (user) {
      fetchTasks()
      fetchAssignees()
      getColunas(user.id).then(setColunas)
    }
  }, [user])

  // Checklist carrega ao abrir a tarefa, e não junto da lista: seriam N idas ao
  // banco para desenhar um quadro onde nenhum checklist aparece.
  useEffect(() => {
    if (!tarefaAberta) {
      setChecklist([])
      return
    }
    getChecklist(tarefaAberta.id)
      .then(setChecklist)
      .catch(() => setChecklist([]))
  }, [tarefaAberta])

  useRealtime('tasks', () => {
    fetchTasks()
  })

  const openNewTaskDialog = () => {
    setNewTitle('')
    setNewDescription('')
    setNewDueDate('')
    setNewAssignee(user?.id || '')
    setIsNewTaskOpen(true)
  }

  const handleCreateTask = async () => {
    if (!user || !newTitle.trim()) return
    setIsSavingNewTask(true)
    try {
      await createTask({
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        user_id: user.id,
        assigned_to: newAssignee || user.id,
        due_date: newDueDate || null,
        contact_id: null,
      })
      toast({ title: 'Tarefa criada com sucesso!' })
      setIsNewTaskOpen(false)
      fetchTasks()
    } catch (err) {
      toast({ title: 'Erro ao criar tarefa. Tente novamente.', variant: 'destructive' })
    } finally {
      setIsSavingNewTask(false)
    }
  }

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return
    const id = taskToDelete
    setTaskToDelete(null)
    try {
      await deleteTask(id)
      setTasks((prev) => prev.filter((t) => t.id !== id))
      toast({ title: 'Tarefa apagada com sucesso' })
    } catch (err) {
      toast({ title: 'Falha ao apagar tarefa. Tente novamente.', variant: 'destructive' })
    }
  }

  const handleUpdateStatus = async (
    taskId: string,
    newStatus: Task['status'],
    novoMotivo: string | null = null,
  ) => {
    try {
      await updateTaskStatus(taskId, newStatus, novoMotivo)
    } catch (err) {
      toast({ title: 'Erro ao mover tarefa', variant: 'destructive' })
      fetchTasks()
    }
  }

  /** ITEM 9: confirma o motivo e só então move a tarefa. */
  const confirmarMotivo = async () => {
    if (!pedindoMotivo) return
    const { taskId, status } = pedindoMotivo
    const texto = motivo.trim()
    setPedindoMotivo(null)
    setMotivo('')
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status, status_reason: texto || null } : t)),
    )
    await handleUpdateStatus(taskId, status, texto || null)
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
    if (!task || task.status === status) return

    // ITEM 9: "aguardando" e "em validação" existem para EXPLICAR a parada.
    // Move só depois de saber o motivo — caso contrário quem confere abre e não
    // encontra nada, que é exatamente a queixa original.
    if (SITUACOES_COM_MOTIVO.includes(status)) {
      setMotivo(task.status_reason || '')
      setPedindoMotivo({ taskId, status })
      return
    }

    // Saindo para uma situação que não pede motivo, o antigo é apagado junto
    // (o serviço grava `status_reason: null`).
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status, status_reason: null } : t)))
    handleUpdateStatus(taskId, status)
  }

  /*
    ITEM 11: as colunas deixam de ser uma constante e passam a vir da
    personalização DESTA pessoa. A forma ({id, title, color}) é a mesma de
    antes de propósito — assim o laço de renderização e o arrastar-e-soltar,
    que estão presos a esses nomes, seguem intactos.

    Só as visíveis entram. Esconder uma coluna não some com as tarefas dela: o
    filtro é de exibição, e a situação continua valendo para todo mundo.
  */
  const columns = useMemo(
    () =>
      colunas
        .filter((c) => c.visivel)
        .map((c) => ({
          id: c.status,
          title: c.titulo,
          color: CLASSES_DE_COR[c.cor] || CLASSES_DE_COR.slate,
        })),
    [colunas],
  )

  // "Direcionadas por mim" só faz sentido para quem já direcionou (na prática,
  // admin — a policy só deixa outro dono em assigned_to se quem grava é admin).
  // Mesmo assim a aba fica visível para todos: um dia um não-admin pode ganhar
  // essa permissão e a tela já está pronta.
  const visibleTasks = useMemo(() => {
    if (!user) return []
    if (activeTab === 'minhas') return tasks.filter((t) => t.assigned_to === user.id)
    if (activeTab === 'direcionadas') return tasks.filter((t) => t.user_id === user.id && t.assigned_to !== user.id)
    return tasks
  }, [tasks, activeTab, user])

  const today = todayIso()

  const classesAcoesTarefa = noCelular
    ? 'flex items-center gap-1 opacity-100 flex-shrink-0'
    : 'flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex-shrink-0'

  return (
    <div className="flex-1 h-full flex flex-col min-w-0 relative overflow-hidden">
      <div className="p-6 pb-2 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Tarefas e Kanban
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Arraste e solte as tarefas para alterar o status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* ITEM 11: personalizar o quadro. Só muda o SEU — ver o aviso dentro. */}
          <Button variant="outline" onClick={() => setPainelColunasAberto(true)} className="gap-1.5">
            <Settings2 className="h-4 w-4" />
            Colunas
          </Button>
          <Button onClick={openNewTaskDialog} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nova tarefa
          </Button>
        </div>
      </div>

      <div className="px-6">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="minhas">Minhas</TabsTrigger>
            <TabsTrigger value="direcionadas">Direcionadas por mim</TabsTrigger>
            {isAdmin && <TabsTrigger value="todas">Todas</TabsTrigger>}
          </TabsList>
        </Tabs>
      </div>

      {/*
        Quadro kanban: arrastar-e-soltar é HTML5 nativo (draggable + onDragStart/
        onDragOver/onDrop), sem lib — nada aqui depende de ref, classe ou
        estrutura de um DnD framework, então dava para trocar bg/borda à vontade
        sem risco de quebrar o arrasto. O que preservamos ao pé da letra: os três
        handlers (`handleDragStart/End/Over`, `handleDrop`) seguem presos aos
        mesmos elementos DOM de antes — coluna recebe `onDragOver`/`onDrop`,
        cartão recebe `draggable`/`onDragStart`/`onDragEnd`.
      */}
      <div className="flex-1 overflow-x-auto p-6 flex gap-6">
        {columns.map((col) => {
          const columnTasks = visibleTasks.filter((t) => t.status === col.id)
          return (
            <div
              key={col.id}
              // `.superficie-vidro` na COLUNA (painel), não no cartão — é o
              // quadro que precisa se ler como quadro (referência de onde
              // soltar), não a linha de tarefa. Colunas são vizinhas com
              // respiro (`gap-6`) entre si, não um bloco só cobrindo 100% da
              // largura como os painéis do EmailHub — por isso cada uma pode
              // ter a própria camada de vidro sem o custo de blur empilhado:
              // não há sobreposição, e o cartão por dentro não tem blur
              // nenhum (seria o vidro aninhado que a regra dura proíbe).
              className="flex-shrink-0 w-80 superficie-vidro rounded-xl flex flex-col overflow-hidden"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              <div
                className={`px-4 py-3 border-b border-border/60 flex items-center justify-between ${col.color.split(' ')[0]}`}
              >
                <h3 className={`font-semibold text-sm ${col.color.split(' ')[2]}`}>{col.title}</h3>
                <span className="text-xs bg-foreground/10 px-2 py-0.5 rounded-full text-foreground/70">
                  {columnTasks.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
                {columnTasks.map((task) => {
                  const contactName = task.contact
                    ? task.contact.nickname || task.contact.name || `+${task.contact.remote_jid}`
                    : null
                  const assigneeName = task.assignee?.name || 'Sem responsável'
                  const isOverdue = !!task.due_date && task.due_date < today && task.status !== 'completed'
                  // Mesmo vocabulário de ponto/pílula do card "Minhas tarefas"
                  // da home: rosa = atrasada, âmbar = vence hoje, ardósia =
                  // futura ou sem prazo.
                  const venceHoje = !!task.due_date && task.due_date === today
                  const tom = isOverdue ? 'rosa' : venceHoje ? 'ambar' : 'ardosia'
                  return (
                    // Cartão vira linha (`ListRow`): sem borda própria, hover
                    // sutil (`hover:bg-foreground/5`), ponto de status no
                    // lugar da barra colorida antiga. `draggable`/`onDrag*`
                    // passam direto pelo `...resto` do `ListRow` — o mesmo
                    // elemento DOM que já tinha esses handlers antes.
                    <ListRow
                      key={task.id}
                      status={tom}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onDragEnd={handleDragEnd}
                      className="items-start cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          {/*
                            ITEM 11: abrir a tarefa. É um botão, e não um clique
                            no cartão inteiro, porque o cartão é a alça do
                            arrastar — clique na área toda dispararia a abertura
                            em toda tentativa de mover.
                          */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setTarefaAberta(task)
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="text-xs font-medium text-foreground line-clamp-2 hover:underline">
                              {task.title}
                            </p>
                          </button>
                          {/* No APK Android não existe hover: sem `useIsMobile()` esse
                              botão ficaria invisível e inalcançável no toque. */}
                          <div className={classesAcoesTarefa}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setTaskToDelete(task.id)
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="p-1 hover:bg-rose-500/15 rounded text-muted-foreground hover:text-rose-500 transition-colors"
                              title="Apagar tarefa"
                              type="button"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </div>
                        {task.description && (
                          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 break-words">
                            {task.description}
                          </p>
                        )}
                        {/*
                          ITEM 9: o motivo aparece NO CARTÃO, e não só ao abrir.
                          O pedido era justamente que quem confere não precisasse
                          entrar em cada tarefa para descobrir o que está travando.
                        */}
                        {task.status_reason && (
                          <p className="mt-1 rounded border border-purple-500/25 bg-purple-500/10 px-1.5 py-0.5 text-[11px] leading-snug text-purple-300 break-words">
                            {task.status_reason}
                          </p>
                        )}
                        {contactName && (
                          <div className="flex items-center gap-1.5 mt-1.5 max-w-full">
                            <Avatar className="h-4 w-4 flex-shrink-0">
                              <AvatarImage src={task.contact?.avatar_url || ''} />
                              <AvatarFallback className="text-[8px] bg-blue-500/15 text-blue-500">
                                {contactName.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-[11px] text-muted-foreground truncate" title={contactName}>
                              {contactName}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 mt-1.5">
                          <div className="flex items-center gap-1.5 min-w-0 max-w-[60%]">
                            <Avatar className="h-4 w-4 flex-shrink-0">
                              <AvatarImage src={task.assignee?.avatar_url || ''} />
                              <AvatarFallback className="text-[8px] bg-violet-500/15 text-violet-500">
                                {getInitials(task.assignee?.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-[11px] text-muted-foreground truncate" title={assigneeName}>
                              {assigneeName}
                            </span>
                          </div>
                          {task.due_date && (
                            <ListRowPill tom={isOverdue ? 'rosa' : 'ardosia'}>
                              {formatDueDate(task.due_date)}
                            </ListRowPill>
                          )}
                        </div>
                      </div>
                    </ListRow>
                  )
                })}
                {columnTasks.length === 0 && !loading && (
                  <div className="h-24 flex items-center justify-center text-sm text-muted-foreground/50 border border-dashed border-border/60 rounded-lg">
                    Vazio
                  </div>
                )}
                {loading && columnTasks.length === 0 && (
                  <div className="h-24 flex items-center justify-center text-sm text-muted-foreground/50">
                    <Loader2 className="h-4 w-4 animate-spin" />
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
            <AlertDialogTitle>Tem certeza que deseja apagar esta tarefa?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Esta ação não pode ser desfeita. A tarefa será apagada permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-border text-foreground hover:bg-accent hover:text-accent-foreground">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteTask}
              className="bg-red-500 text-foreground hover:bg-red-600"
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isNewTaskOpen} onOpenChange={setIsNewTaskOpen}>
        <GlassDialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Nova tarefa</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="newTaskTitle">Nome da tarefa</Label>
              <Input
                id="newTaskTitle"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ex: Organizar planilha de rateio..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="newTaskDesc">Descrição</Label>
              <Textarea
                id="newTaskDesc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Detalhes da tarefa..."
                className="resize-none"
              />
            </div>
            <div className="grid gap-2">
              <Label>Responsável</Label>
              <Select value={newAssignee} onValueChange={setNewAssignee} disabled={loadingAssignees}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingAssignees ? 'Carregando...' : 'Selecione'} />
                </SelectTrigger>
                <SelectContent>
                  {assignees.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name || 'Sem nome'}
                      {a.id === user?.id ? ' (eu)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="newTaskDueDate">Prazo</Label>
              <Input
                id="newTaskDueDate"
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsNewTaskOpen(false)}
            >
              Cancelar
            </Button>
            <Button onClick={handleCreateTask} disabled={isSavingNewTask || !newTitle.trim()}>
              {isSavingNewTask ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Criar tarefa
            </Button>
          </DialogFooter>
        </GlassDialogContent>
      </Dialog>

      {/* ITEM 9: o motivo da parada, perguntado antes de mover. */}
      <Dialog open={!!pedindoMotivo} onOpenChange={(v) => !v && setPedindoMotivo(null)}>
        <GlassDialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pedindoMotivo?.status === 'waiting' ? 'O que está aguardando?' : 'O que falta validar?'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="motivo-tarefa">Motivo</Label>
            <Textarea
              id="motivo-tarefa"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: aguardando a assinatura do documento pela diretoria"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Isto fica visível para todo mundo que enxerga a tarefa — é o que a pessoa que confere vai ler.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPedindoMotivo(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarMotivo}>Mover tarefa</Button>
          </DialogFooter>
        </GlassDialogContent>
      </Dialog>

      {/* ITEM 11: detalhe da tarefa, com checklist. */}
      <Dialog open={!!tarefaAberta} onOpenChange={(v) => !v && setTarefaAberta(null)}>
        <GlassDialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="pr-6">{tarefaAberta?.title}</DialogTitle>
          </DialogHeader>

          {tarefaAberta && (
            <div className="grid gap-4 py-2">
              {tarefaAberta.description && (
                <p className="text-sm leading-relaxed text-muted-foreground">{tarefaAberta.description}</p>
              )}

              <div className="grid gap-1.5">
                <Label>Situação</Label>
                <Select
                  value={tarefaAberta.status}
                  onValueChange={(v) => {
                    const novo = v as Task['status']
                    if (SITUACOES_COM_MOTIVO.includes(novo)) {
                      setMotivo(tarefaAberta.status_reason || '')
                      setPedindoMotivo({ taskId: tarefaAberta.id, status: novo })
                      setTarefaAberta(null)
                      return
                    }
                    setTasks((prev) =>
                      prev.map((t) =>
                        t.id === tarefaAberta.id ? { ...t, status: novo, status_reason: null } : t,
                      ),
                    )
                    setTarefaAberta({ ...tarefaAberta, status: novo, status_reason: null })
                    void handleUpdateStatus(tarefaAberta.id, novo)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUNAS_PADRAO.map((c) => (
                      <SelectItem key={c.status} value={c.status}>
                        {c.titulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {tarefaAberta.status_reason && (
                <p className="rounded-lg border border-purple-500/25 bg-purple-500/10 p-2 text-sm text-purple-300">
                  {tarefaAberta.status_reason}
                </p>
              )}

              <div className="grid gap-2">
                <Label>Checklist</Label>
                {checklist.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum item ainda.</p>
                )}
                {checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={item.feito}
                      onCheckedChange={(v) => {
                        const feito = v === true
                        setChecklist((prev) =>
                          prev.map((i) => (i.id === item.id ? { ...i, feito } : i)),
                        )
                        marcarItem(item.id, feito).catch(() => {
                          setChecklist((prev) =>
                            prev.map((i) => (i.id === item.id ? { ...i, feito: !feito } : i)),
                          )
                          toast({ title: 'Não foi possível marcar o item', variant: 'destructive' })
                        })
                      }}
                    />
                    <span
                      className={
                        item.feito
                          ? 'flex-1 text-sm text-muted-foreground line-through'
                          : 'flex-1 text-sm'
                      }
                    >
                      {item.texto}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setChecklist((prev) => prev.filter((i) => i.id !== item.id))
                        removerItem(item.id).catch(() => {
                          toast({ title: 'Não foi possível remover', variant: 'destructive' })
                          void getChecklist(tarefaAberta.id).then(setChecklist)
                        })
                      }}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-rose-500"
                      title="Remover item"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                <div className="flex items-center gap-2">
                  <Input
                    value={novoItem}
                    onChange={(e) => setNovoItem(e.target.value)}
                    placeholder="Novo item do checklist"
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      const texto = novoItem.trim()
                      if (!texto) return
                      setNovoItem('')
                      adicionarItem(tarefaAberta.id, texto, checklist.length)
                        .then((criado) => setChecklist((prev) => [...prev, criado]))
                        .catch(() =>
                          toast({ title: 'Não foi possível adicionar', variant: 'destructive' }),
                        )
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarefaAberta(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </GlassDialogContent>
      </Dialog>

      {/* ITEM 11: personalização do quadro. */}
      <Dialog open={painelColunasAberto} onOpenChange={setPainelColunasAberto}>
        <GlassDialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Suas colunas</DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            Vale só para o seu quadro. A situação de cada tarefa continua a mesma para toda a equipe —
            é o que permite outra pessoa conferir o que você marcou.
          </p>

          <div className="grid gap-2 py-2">
            {colunas.map((c, i) => (
              <div key={c.status} className="flex items-center gap-2 rounded-lg border border-border/60 p-2">
                <button
                  type="button"
                  title={c.visivel ? 'Esconder do meu quadro' : 'Mostrar no meu quadro'}
                  onClick={() =>
                    setColunas((prev) =>
                      prev.map((x) => (x.status === c.status ? { ...x, visivel: !x.visivel } : x)),
                    )
                  }
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {c.visivel ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>

                <Input
                  value={c.titulo}
                  onChange={(e) =>
                    setColunas((prev) =>
                      prev.map((x) => (x.status === c.status ? { ...x, titulo: e.target.value } : x)),
                    )
                  }
                  className="h-8 flex-1"
                />

                <Select
                  value={c.cor}
                  onValueChange={(v) =>
                    setColunas((prev) => prev.map((x) => (x.status === c.status ? { ...x, cor: v } : x)))
                  }
                >
                  <SelectTrigger className="h-8 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CORES_DISPONIVEIS.map((cor) => (
                      <SelectItem key={cor} value={cor}>
                        {cor}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <button
                  type="button"
                  disabled={i === 0}
                  title="Subir"
                  onClick={() =>
                    setColunas((prev) => {
                      const copia = [...prev]
                      ;[copia[i - 1], copia[i]] = [copia[i], copia[i - 1]]
                      return copia
                    })
                  }
                  className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={i === colunas.length - 1}
                  title="Descer"
                  onClick={() =>
                    setColunas((prev) => {
                      const copia = [...prev]
                      ;[copia[i], copia[i + 1]] = [copia[i + 1], copia[i]]
                      return copia
                    })
                  }
                  className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="gap-1.5"
              onClick={async () => {
                if (!user) return
                try {
                  await restaurarColunasPadrao(user.id)
                  setColunas(COLUNAS_PADRAO)
                  toast({ title: 'Quadro de volta ao padrão' })
                } catch {
                  toast({ title: 'Não foi possível restaurar', variant: 'destructive' })
                }
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Padrão
            </Button>
            <Button
              onClick={async () => {
                if (!user) return
                try {
                  await salvarColunas(user.id, colunas)
                  setPainelColunasAberto(false)
                  toast({ title: 'Colunas salvas' })
                } catch {
                  toast({ title: 'Não foi possível salvar as colunas', variant: 'destructive' })
                }
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </GlassDialogContent>
      </Dialog>
    </div>
  )
}
