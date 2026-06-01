import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import {
  getAiPrompts,
  createAiPrompt,
  updateAiPrompt,
  deleteAiPrompt,
  type AiPrompt,
} from '@/services/ai_prompts'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Pencil, Trash2, Plus, Loader2 } from 'lucide-react'
import { extractFieldErrors } from '@/lib/errors'

export default function AiAssistantSettings() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [prompts, setPrompts] = useState<AiPrompt[]>([])
  const [loading, setLoading] = useState(true)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    label: '',
    action_key: '',
    system_prompt: '',
    is_active: true,
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const loadPrompts = async () => {
    try {
      setLoading(true)
      const data = await getAiPrompts()
      setPrompts(data)
    } catch (err) {
      toast({ title: 'Erro ao carregar ações', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPrompts()
  }, [])

  const handleOpenModal = (p?: AiPrompt) => {
    setFormErrors({})
    if (p) {
      setEditingId(p.id)
      setFormData({
        label: p.label,
        action_key: p.action_key,
        system_prompt: p.system_prompt,
        is_active: p.is_active,
      })
    } else {
      setEditingId(null)
      setFormData({ label: '', action_key: '', system_prompt: '', is_active: true })
    }
    setIsModalOpen(true)
  }

  const handleSave = async () => {
    if (!user) return
    setFormErrors({})
    try {
      if (editingId) {
        await updateAiPrompt(editingId, formData)
        toast({ title: 'Ação atualizada com sucesso' })
      } else {
        await createAiPrompt({ ...formData, user_id: user.id })
        toast({ title: 'Ação criada com sucesso' })
      }
      setIsModalOpen(false)
      loadPrompts()
    } catch (err) {
      setFormErrors(extractFieldErrors(err))
      toast({ title: 'Erro ao salvar', variant: 'destructive' })
    }
  }

  const confirmDelete = async () => {
    if (!editingId) return
    try {
      await deleteAiPrompt(editingId)
      toast({ title: 'Ação excluída com sucesso' })
      setIsDeleteDialogOpen(false)
      loadPrompts()
    } catch (err) {
      toast({ title: 'Erro ao excluir', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Ações do Assistente IA</h2>
          <p className="text-sm text-muted-foreground">
            Configure os prompts de sistema e as opções do menu de Inteligência Artificial.
          </p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Ação
        </Button>
      </div>

      <div className="border border-border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label (Exibição)</TableHead>
              <TableHead>Chave (Técnica)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[120px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : prompts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  Nenhuma ação configurada.
                </TableCell>
              </TableRow>
            ) : (
              prompts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.label}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.action_key}</code>
                  </TableCell>
                  <TableCell>
                    {p.is_active ? (
                      <span className="text-green-500 text-xs font-medium">Ativo</span>
                    ) : (
                      <span className="text-red-500 text-xs font-medium">Inativo</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenModal(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingId(p.id)
                          setIsDeleteDialogOpen(true)
                        }}
                        className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Ação de IA' : 'Nova Ação de IA'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nome de Exibição (Label)</Label>
              <Input
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                placeholder="Ex: Formalizar texto"
              />
              {formErrors.label && <span className="text-xs text-red-500">{formErrors.label}</span>}
            </div>
            <div className="grid gap-2">
              <Label>Chave Técnica (Action Key)</Label>
              <Input
                value={formData.action_key}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    action_key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
                  })
                }
                placeholder="Ex: formalize"
                disabled={!!editingId && formData.action_key === 'suggest_reply'}
              />
              <span className="text-[11px] text-muted-foreground">
                Sem espaços ou caracteres especiais (apenas a-z, 0-9, - e _).
              </span>
              {formErrors.action_key && (
                <span className="text-xs text-red-500">{formErrors.action_key}</span>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Instrução para a IA (System Prompt)</Label>
              <textarea
                className="flex min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 custom-scrollbar"
                value={formData.system_prompt}
                onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                placeholder="Ex: Você é um assistente de escrita. Formate o texto para um tom mais profissional..."
              />
              {formErrors.system_prompt && (
                <span className="text-xs text-red-500">{formErrors.system_prompt}</span>
              )}
            </div>
            <div className="flex items-center justify-between mt-2 p-3 bg-muted/30 rounded-lg border border-border">
              <div className="space-y-0.5">
                <Label>Ação Ativada</Label>
                <p className="text-[12px] text-muted-foreground">
                  Exibir esta opção no menu do ChatHub.
                </p>
              </div>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Ação?</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir esta ação do assistente? Esta operação não pode ser
              desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
