import { useEffect, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { CardContent } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { EstadoPainel } from '@/components/ui/estado-painel'
import { ListRow, ListRowPill } from '@/components/ui/list-row'
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
import { useIsMobile } from '@/hooks/use-mobile'

// Mesmo mapa de categoria do card "Anotações" na home (Index.tsx), com o
// `/10` mais suave em vez do `/15` padrão do `ListRowPill` — comentário lá
// explica o porquê: aqui o selo compete com texto de categoria, não só um
// número, então o padrão mais forte destoava.
const CATEGORIA_PILL: Record<Note['category'], string> = {
  financeiro: 'bg-emerald-500/10 text-emerald-500',
  rh: 'bg-blue-500/10 text-blue-500',
  administrativo: 'bg-amber-500/10 text-amber-500',
  geral: 'bg-muted/60 text-muted-foreground',
}
const CATEGORIA_LABEL: Record<Note['category'], string> = {
  financeiro: 'Fin',
  rh: 'RH',
  administrativo: 'Adm',
  geral: 'Ger',
}

export default function Notes() {
  const { toast } = useToast()
  const { user } = useAuth()
  const [notes, setNotes] = useState<Note[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')

  // Carregando e erro SEPARADOS de "lista vazia" — o bug aprovado pelo
  // usuário. Antes, `catch { /* ignore */ }` engolia qualquer falha de rede
  // sem tocar em nenhum estado, e a lista simplesmente ficava vazia: uma
  // queda de conexão se lia como "nenhuma anotação encontrada", a leitura
  // oposta da verdade. Mesmo padrão que a home já usa (`EstadoPainel`).
  const [carregando, setCarregando] = useState(true)
  const [erroNotas, setErroNotas] = useState(false)

  // Sem hover no APK Android (Capacitor): um controle só visível em hover é,
  // na prática, um controle que não existe no toque. No celular ele fica
  // sempre visível.
  const noCelular = useIsMobile()

  const loadNotes = async () => {
    try {
      const data = await getNotes()
      setNotes(data)
      setErroNotas(false)
    } catch (error) {
      setErroNotas(true)
    } finally {
      setCarregando(false)
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

  const classesBotaoExcluir = noCelular
    ? 'h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-red-400 opacity-100'
    : 'h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'

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

      {/*
        Mesmo idioma de linha do card "Anotações" na home: um `GlassCard` só
        (em vez da grade de cards isolados com borda que existia aqui antes),
        linha sem borda, `rounded-xl`, pílula de categoria à direita, hover
        sutil. `EstadoPainel` separa carregando / erro / vazio — é o que
        corrige o bug: rede fora do ar agora mostra "Não deu para carregar
        agora" com "Tentar de novo", não "Nenhuma anotação ainda".
      */}
      <GlassCard>
        <CardContent className="p-2">
          <EstadoPainel
            carregando={carregando}
            erro={erroNotas}
            vazio={filteredNotes.length === 0}
            mensagemVazio={searchTerm ? 'Nenhuma anotação encontrada.' : 'Nenhuma anotação ainda.'}
            aoTentarDeNovo={() => {
              setErroNotas(false)
              setCarregando(true)
              loadNotes()
            }}
          />
          {!carregando && !erroNotas && filteredNotes.length > 0 && (
            <div className="space-y-0.5">
              {filteredNotes.map((note) => (
                // Sem `onClick`: vira `<div>`, não `<button>` — não existe
                // tela de detalhe de anotação para navegar. Só o ícone de
                // lixeira, dentro da linha, é clicável.
                <ListRow key={note.id} className="items-start">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-foreground truncate flex-1">{note.title}</p>
                      <ListRowPill className={CATEGORIA_PILL[note.category]}>
                        {CATEGORIA_LABEL[note.category]}
                      </ListRowPill>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 whitespace-pre-wrap mt-0.5">
                      {note.content}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      {note.contact_name ? `${note.contact_name} · ` : ''}
                      {new Date(note.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={classesBotaoExcluir}
                    onClick={() => handleDelete(note.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </ListRow>
              ))}
            </div>
          )}
        </CardContent>
      </GlassCard>
    </div>
  )
}
