import { useState, useEffect } from 'react'
import { Plus, Search, Trash2, Edit2, Zap, MessageSquare } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import {
  getTriggers,
  createTrigger,
  updateTrigger,
  deleteTrigger,
  type MessageTrigger,
} from '@/services/message_triggers'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useRealtime } from '@/hooks/use-realtime'
import { extractFieldErrors } from '@/lib/errors'

export default function Triggers() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [triggers, setTriggers] = useState<MessageTrigger[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const loadData = async () => {
    try {
      const data = await getTriggers()
      setTriggers(data)
    } catch (err) {
      toast({ title: 'Erro ao carregar gatilhos', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useRealtime('message_triggers', () => {
    loadData()
  })

  const handleOpenDialog = (trigger?: MessageTrigger) => {
    if (trigger) {
      setEditingId(trigger.id)
      setTitle(trigger.title)
      setContent(trigger.content)
    } else {
      setEditingId(null)
      setTitle('')
      setContent('')
    }
    setErrors({})
    setIsDialogOpen(true)
  }

  const handleSave = async () => {
    try {
      setErrors({})
      if (!user) return

      if (editingId) {
        await updateTrigger(editingId, { title, content })
        toast({ title: 'Gatilho atualizado com sucesso' })
      } else {
        await createTrigger({ title, content, user_id: user.id })
        toast({ title: 'Gatilho criado com sucesso' })
      }
      setIsDialogOpen(false)
    } catch (err) {
      setErrors(extractFieldErrors(err))
      toast({ title: 'Verifique os dados informados', variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja realmente excluir este gatilho?')) return
    try {
      await deleteTrigger(id)
      toast({ title: 'Gatilho excluído' })
    } catch (err) {
      toast({ title: 'Erro ao excluir o gatilho', variant: 'destructive' })
    }
  }

  const filtered = triggers.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                <Zap className="h-5 w-5 text-blue-400" />
              </div>
              Gatilhos de Mensagem
            </h1>
            <p className="text-muted-foreground mt-2">
              Gerencie modelos de mensagens rápidas para utilizar no ChatHub.
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()} className="bg-blue-600 hover:bg-blue-500">
            <Plus className="mr-2 h-4 w-4" /> Novo Gatilho
          </Button>
        </div>

        <div className="flex items-center gap-2 bg-muted border border-border rounded-xl px-4 py-2 backdrop-blur-xl">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            className="flex-1 bg-transparent border-none text-sm text-foreground focus:outline-none"
            placeholder="Buscar gatilho por título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="text-center py-10 text-muted-foreground">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 bg-muted border border-border rounded-2xl">
            <MessageSquare className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground">Nenhum gatilho encontrado</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Crie seu primeiro gatilho para enviar mensagens mais rápido.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filtered.map((t) => (
              <div
                key={t.id}
                className="bg-muted border border-border rounded-xl p-5 backdrop-blur-sm flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between group hover:border-ring/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg text-foreground truncate">{t.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
                    {t.content}
                  </p>
                </div>
                <div className="flex items-center gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenDialog(t)}
                    className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(t.id)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Gatilho' : 'Novo Gatilho'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Título do Gatilho</label>
              <Input
                placeholder="Ex: Saudação Inicial"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-muted border-border"
              />
              {errors.title && <p className="text-xs text-red-500">{errors.title}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Conteúdo da Mensagem</label>
              <Textarea
                placeholder="Escreva a mensagem (suporta formatação do WhatsApp como *negrito*, _itálico_...)"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[150px] bg-muted border-border resize-none leading-relaxed"
              />
              {errors.content && <p className="text-xs text-red-500">{errors.content}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              className="bg-blue-600 hover:bg-blue-500"
              disabled={!title || !content}
            >
              Salvar Gatilho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
