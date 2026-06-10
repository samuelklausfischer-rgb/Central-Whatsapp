import { createContext, useContext, useState, useCallback, useMemo, createElement, ReactNode } from 'react'

export interface Device {
  id: string
  name: string
  department: string
  model: string
  battery: number
  signal: number
  status: 'online' | 'offline' | 'syncing'
}

export interface Message {
  id: string
  text: string
  sender: 'me' | 'them'
  timestamp: string
}

export interface ChatThread {
  id: string
  deviceId: string
  contactName: string
  contactNumber: string
  avatar?: string
  messages: Message[]
  unread: boolean
}

export interface Task {
  id: string
  title: string
  status: 'pendente' | 'em_andamento' | 'revisao' | 'concluido'
  deviceId: string
  description: string
}

export interface Note {
  id: string
  title: string
  content: string
  date: string
  pinned: boolean
}

interface AppContextType {
  devices: Device[]
  threads: ChatThread[]
  tasks: Task[]
  notes: Note[]
  addMessage: (threadId: string, text: string) => void
  addNote: (note: Omit<Note, 'id' | 'date'>) => void
  addTask: (task: Omit<Task, 'id'>) => void
  updateTaskStatus: (taskId: string, status: Task['status']) => void
  syncDevice: (name: string, department: string) => void
  markThreadRead: (threadId: string) => void
  userSignature: string
  setUserSignature: (signature: string) => void
}

const AppContext = createContext<AppContextType | null>(null)

const initialDevices: Device[] = []

const initialThreads: ChatThread[] = []

const initialTasks: Task[] = [
  {
    id: 'l1',
    title: 'Verificar NF Fornecedor Alpha',
    status: 'pendente',
    deviceId: 'd1',
    description: 'Cobrar envio da nota fiscal referente a março.',
  },
  {
    id: 'l2',
    title: 'Aprovação de Orçamento TI',
    status: 'em_andamento',
    deviceId: 'd3',
    description: 'Revisar orçamento trimestral enviado pelo suporte.',
  },
  {
    id: 'l3',
    title: 'Renovação Contrato Logística',
    status: 'revisao',
    deviceId: 'd2',
    description: 'Analisar novas cláusulas antes de assinar.',
  },
  {
    id: 'l4',
    title: 'Acesso Bancário',
    status: 'concluido',
    deviceId: 'd1',
    description: 'Liberar acessos para o novo analista financeiro.',
  },
]

const initialNotes: Note[] = [
  {
    id: 'n1',
    title: 'Lembrete: Fechamento Mensal',
    content: 'Enviar todos os relatórios de despesas até o dia 5.',
    date: '20 Mai, 14:00',
    pinned: true,
  },
  {
    id: 'n2',
    title: 'Contato Terceirizada',
    content: 'O novo gerente da terceirizada de limpeza se chama Marcos (Ramal 402).',
    date: '19 Mai, 10:15',
    pinned: false,
  },
]

export function AppProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<Device[]>(initialDevices)
  const [threads, setThreads] = useState<ChatThread[]>(initialThreads)
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [notes, setNotes] = useState<Note[]>(initialNotes)
  const [userSignature, setUserSignature] = useState('')

  const addMessage = useCallback((threadId: string, text: string) => {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === threadId) {
          return {
            ...t,
            messages: [
              ...t.messages,
              {
                id: Math.random().toString(),
                text,
                sender: 'me',
                timestamp: new Date().toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              },
            ],
          }
        }
        return t
      }),
    )
  }, [])

  const markThreadRead = useCallback((threadId: string) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread: false } : t)))
  }, [])

  const addNote = useCallback((note: Omit<Note, 'id' | 'date'>) => {
    setNotes((prev) => [
      {
        ...note,
        id: Math.random().toString(),
        date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
      },
      ...prev,
    ])
  }, [])

  const addTask = useCallback((task: Omit<Task, 'id'>) => {
    setTasks((prev) => [{ ...task, id: Math.random().toString() }, ...prev])
  }, [])

  const updateTaskStatus = useCallback((taskId: string, status: Task['status']) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)))
  }, [])

  const syncDevice = useCallback((name: string, department: string) => {
    setDevices((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        name,
        department,
        model: 'Unknown Device',
        battery: 100,
        signal: 5,
        status: 'online',
      },
    ])
  }, [])

  const value = useMemo(() => ({
    devices,
    threads,
    tasks,
    notes,
    userSignature,
    addMessage,
    addNote,
    addTask,
    updateTaskStatus,
    syncDevice,
    markThreadRead,
    setUserSignature,
  }), [devices, threads, tasks, notes, userSignature, addMessage, addNote, addTask, updateTaskStatus, syncDevice, markThreadRead, setUserSignature])

  return createElement(AppContext.Provider, { value }, children)
}

export default function useAppStore() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useAppStore must be used within AppProvider')
  return context
}
