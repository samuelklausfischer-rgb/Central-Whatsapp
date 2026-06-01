import { useEffect, useState } from 'react'
import { Plus, StickyNote, Search, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { getNotes, createNote, deleteNote, Note } from '@/services/notes'
import { useRealtime } from '@/hooks/use-realtime'

export default function Notes() {
  const { toast } = useToast()
  const { user } = useAuth()
  const [notes, setNotes] = useState<Note[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')

  const loadNotes = async () => {
    try {
      const data = await getNotes()
      setNotes(data)
    } catch (error) {
      // ignore
    }
  }

  useEffect(() => {
    if (user) loadNotes()
  }, [user])

  useRealtime('notes', () => {
    loadNotes()
  })

  const handleCreate = async () => {
    if (!newTitle.trim() || !user) return
    try {
      await createNote({ title: newTitle, content: newContent, user_id: user.id })
      setIsDialogOpen(false)
      setNewTitle('')
      setNewContent('')
      toast({ title: 'Anotação criada', description: 'Sua anotação foi salva com sucesso.' })
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Falha ao salvar anotação.',
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteNote(id)
      toast({ title: 'Anotação excluída', description: 'A anotação foi removida.' })
    } catch (error) {
      toast({ title: 'Erro', description: 'Falha ao excluir.', variant: 'destructive' })
    }
  }

  const filteredNotes = notes.filter(
    (n) =>
      n.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.content.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h1 className="bg-clip-text text-transparent bg-gradient-to-br from-gray-200 to-gray-600 text-3xl font-bold tracking-tight">
            Anotações
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie anotações rápidas e informações importantes.
          </p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar anotações..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 shrink-0">
                <Plus className="h-4 w-4" /> Novo Registro
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border text-foreground">
              <DialogHeader>
                <DialogTitle>Criar Registro Interno</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Título</Label>
                  <Input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Ex: Lembrete de Reunião"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Conteúdo</Label>
                  <Textarea
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder="Descreva detalhes, acompanhamentos ou dados importantes..."
                    className="min-h-[150px]"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreate}>Salvar Registro</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {filteredNotes.map((note) => (
          <Card
            key={note.id}
            className="group relative overflow-hidden transition-all hover:-translate-y-1"
          >
            <CardHeader className="pb-3 pr-10">
              <CardTitle className="text-lg leading-tight">{note.title}</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 h-8 w-8 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDelete(note.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed line-clamp-6">
                {note.content}
              </p>
              <div className="text-[10px] text-muted-foreground pt-2 border-t border-border">
                {new Date(note.created_at).toLocaleDateString('pt-BR')}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredNotes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border border-border border-dashed rounded-xl bg-card backdrop-blur-sm">
          <StickyNote className="h-12 w-12 mb-4 opacity-20" />
          <p>Nenhuma anotação encontrada.</p>
        </div>
      )}
    </div>
  )
}
