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
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { CardContent } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { EstadoPainel } from '@/components/ui/estado-painel'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { extractFieldErrors } from '@/lib/errors'

export default function AiAssistantSettings() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [prompts, setPrompts] = useState<AiPrompt[]>([])
  const [loading, setLoading] = useState(true)
  // Antes o erro só virava um `toast` — que some sozinho — e a tabela ficava
  // com "Nenhuma ação configurada.", igual a uma lista realmente vazia. Erro
  // separado permite `EstadoPainel` mostrar a mensagem certa e um "Tentar de
  // novo".
  const [erroPrompts, setErroPrompts] = useState(false)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const isAdmin = user?.is_admin ?? false

  const [formData, setFormData] = useState({
    label: '',
    action_key: '',
    system_prompt: '',
    is_active: true,
    is_global: false,
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const loadPrompts = async () => {
    try {
      setLoading(true)
      const data = await getAiPrompts()
      setPrompts(data)
      setErroPrompts(false)
    } catch (err) {
      setErroPrompts(true)
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
        is_global: p.is_global,
      })
    } else {
      setEditingId(null)
      setFormData({ label: '', action_key: '', system_prompt: '', is_active: true, is_global: isAdmin ? true : false })
    }
    setIsModalOpen(true)
  }

  const handleSave = async () => {
    if (!user) return
    setFormErrors({})
    try {
      if (editingId) {
        const updateData = isAdmin ? formData : Object.fromEntries(Object.entries(formData).filter(([k]) => k !== 'is_global'))
        await updateAiPrompt(editingId, updateData)
        toast({ title: 'Ação atualizada com sucesso' })
      } else {
        await createAiPrompt({ ...formData, user_id: user.id, is_global: isAdmin ? formData.is_global : undefined })
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

      {/*
        A tabela ficava "nua" na página, sem a pele de vidro do resto do app.
        `GlassCard` por fora — sem `backdrop-blur` em nada dentro dela, é
        regra dura do kit (blur aninhado trava a rolagem no Electron).
        O `<thead>` do shadcn (`table.tsx`) não recebe `sticky` aqui: a tabela
        não vive dentro de um contêiner de altura fixa com rolagem própria,
        então não há cabeçalho flutuando sobre linha nenhuma — não precisou de
        fundo opaco extra.
      */}
      <GlassCard>
        <CardContent className="p-0">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label (Exibição)</TableHead>
              <TableHead>Chave (Técnica)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Tipo</TableHead>
              <TableHead className="w-[120px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading || erroPrompts || prompts.length === 0 ? (
              // Carregando/erro/vazio via `EstadoPainel`, dentro de uma única
              // célula que ocupa a tabela inteira — a diferença real de
              // antes é a mensagem de erro deixar de ser só um `toast` que
              // some sozinho, com um "Tentar de novo" que chama `loadPrompts`.
              <TableRow>
                <TableCell colSpan={5} className="py-2">
                  <EstadoPainel
                    carregando={loading}
                    erro={erroPrompts}
                    vazio={prompts.length === 0}
                    mensagemVazio="Nenhuma ação configurada."
                    aoTentarDeNovo={loadPrompts}
                  />
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
                  <TableCell className="hidden sm:table-cell">
                    {p.is_global ? (
                      <span className="text-xs font-medium text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">Global</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Pessoal</span>
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
        </CardContent>
      </GlassCard>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <GlassDialogContent className="sm:max-w-[600px]">
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
            {isAdmin && (
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border border-blue-500/20">
                <div className="space-y-0.5">
                  <Label>Disponível para toda equipe</Label>
                  <p className="text-[12px] text-muted-foreground">
                    Usuários de todos os setores poderão usar esta ação.
                  </p>
                </div>
                <Switch
                  checked={formData.is_global}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_global: checked })}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </GlassDialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <GlassDialogContent>
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
        </GlassDialogContent>
      </Dialog>
    </div>
  )
}
