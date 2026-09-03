import { useState, useEffect } from 'react'
import { Plus, Search, Trash2, Edit2, Zap } from 'lucide-react'
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
import { CardContent } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { EstadoPainel } from '@/components/ui/estado-painel'
import { ListRow } from '@/components/ui/list-row'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useRealtime } from '@/hooks/use-realtime'
import { extractFieldErrors } from '@/lib/errors'
import { useIsMobile } from '@/hooks/use-mobile'

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

  // Sem hover no APK Android (Capacitor): um controle só visível em hover é,
  // na prática, um controle que não existe no toque. No celular ele fica
  // sempre visível.
  const noCelular = useIsMobile()

  const loadData = async () => {
    try {
      const data = await getTriggers()
      setTriggers(data)
    } catch (err) {
      toast({ title: 'Erro ao carregar atalhos de mensagem', variant: 'destructive' })
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
        toast({ title: 'Atalho atualizado com sucesso' })
      } else {
        await createTrigger({ title, content, user_id: user.id })
        toast({ title: 'Atalho criado com sucesso' })
      }
      setIsDialogOpen(false)
    } catch (err) {
      setErrors(extractFieldErrors(err))
      toast({ title: 'Verifique os dados informados', variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja realmente excluir este atalho?')) return
    try {
      await deleteTrigger(id)
      toast({ title: 'Atalho excluído' })
    } catch (err) {
      toast({ title: 'Erro ao excluir o atalho', variant: 'destructive' })
    }
  }

  const filtered = triggers.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))

  const classesAcoesGatilho = noCelular
    ? 'flex items-center gap-1 flex-shrink-0 opacity-100'
    : 'flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                <Zap className="h-5 w-5 text-blue-400" />
              </div>
              Atalhos de Mensagem
            </h1>
            <p className="text-muted-foreground mt-2">
              Gerencie modelos de mensagens rápidas para utilizar no ChatHub.
            </p>
            {/* Pedido da Ketlin: a função existia e ninguém achava. Isto aqui é a
                descoberta que faltava — o gesto físico de como usar, na primeira
                tela que quem cadastra um atalho vai ver. */}
            <p className="text-sm text-blue-400 mt-1">
              Digite <span className="font-mono">/</span> no campo de mensagem do chat para usar
              seus atalhos.
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()} className="bg-blue-600 hover:bg-blue-500">
            <Plus className="mr-2 h-4 w-4" /> Novo Atalho
          </Button>
        </div>

        {/* `bg-muted` já é opaco — o `backdrop-blur-xl` que existia aqui não
            borrava nada por baixo, só custava GPU à toa. Removido. */}
        <div className="flex items-center gap-2 bg-muted border border-border rounded-xl px-4 py-2">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            className="flex-1 bg-transparent border-none text-sm text-foreground focus:outline-none"
            placeholder="Buscar atalho por título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/*
          Mesmo idioma de linha da home: um `GlassCard` só (em vez das caixas
          `bg-muted border` feitas à mão, uma por atalho) e `ListRow` para
          cada linha. `EstadoPainel` cobre carregando/vazio — erro já é
          avisado por toast (comportamento existente, preservado) e por isso
          fica sempre `erro={false}` aqui.
        */}
        <GlassCard>
          <CardContent className="p-2">
            <EstadoPainel
              carregando={loading}
              erro={false}
              vazio={filtered.length === 0}
              mensagemVazio="Nenhum atalho encontrado. Crie o primeiro para enviar mensagens mais rápido."
            />
            {!loading && filtered.length > 0 && (
              <div className="space-y-0.5">
                {filtered.map((t) => (
                  // Sem `onClick` na linha: editar e excluir são dois alvos de
                  // clique distintos, não dá para aninhar `<button>` dentro de
                  // `<button>` — por isso `ListRow` aqui é `<div>`.
                  <ListRow key={t.id} className="items-start">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{t.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-wrap">
                        {t.content}
                      </p>
                    </div>
                    {/* No APK Android não existe hover: sem `useIsMobile()` esses
                        botões ficariam invisíveis e inalcançáveis no toque. */}
                    <div className={classesAcoesGatilho}>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenDialog(t)}
                        className="h-7 w-7 text-blue-400 hover:text-blue-300 hover:bg-blue-400/10"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(t.id)}
                        className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </ListRow>
                ))}
              </div>
            )}
          </CardContent>
        </GlassCard>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Atalho' : 'Novo Atalho'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Título do Atalho</label>
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
              Salvar Atalho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
