import { useState, useEffect } from 'react'
import { Plus, Trash2, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { getLabels, createLabel, deleteLabel } from '@/services/labels'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'

export default function LabelsSettings() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [labels, setLabels] = useState<any[]>([])
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState('#3b82f6')
  const [loading, setLoading] = useState(false)

  const loadLabels = async () => {
    try {
      const data = await getLabels()
      setLabels(data)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadLabels()
  }, [])

  useRealtime('labels', () => {
    loadLabels()
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newLabelName.trim() || !user) return
    setLoading(true)
    try {
      await createLabel({ name: newLabelName, color: newLabelColor, user_id: user.id })
      setNewLabelName('')
      toast({ title: 'Etiqueta criada com sucesso!' })
    } catch (err) {
      toast({ title: 'Erro ao criar etiqueta', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja realmente remover esta etiqueta?')) return
    try {
      await deleteLabel(id)
      toast({ title: 'Etiqueta removida!' })
    } catch (err) {
      toast({ title: 'Erro ao remover', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Era um `<div>` manual tentando imitar vidro (`bg-muted` opaco +
          `backdrop-blur-xl` morto por cima — `bg-muted` não tem alpha, então
          o blur não tinha nada translúcido para borrar). `GlassCard` é o
          vidro de verdade do kit. */}
      <GlassCard>
        <CardHeader className="pb-3">
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <Tag className="w-5 h-5 text-blue-400" /> Nova Etiqueta
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <form onSubmit={handleCreate} className="flex gap-4 items-end">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium text-foreground/80">Nome da Etiqueta</label>
              <Input
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                placeholder="Ex: Pausa, Atendimento..."
                className="bg-muted border-border"
                required
              />
            </div>
            <div className="w-24 space-y-2">
              <label className="text-sm font-medium text-foreground/80">Cor</label>
              <div className="relative h-10 w-full rounded-md border border-border overflow-hidden">
                <input
                  type="color"
                  value={newLabelColor}
                  onChange={(e) => setNewLabelColor(e.target.value)}
                  className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={loading || !newLabelName.trim()}
              className="bg-blue-600 hover:bg-blue-500"
            >
              <Plus className="w-4 h-4 mr-2" /> Adicionar
            </Button>
          </form>
        </CardContent>
      </GlassCard>

      <GlassCard>
        <CardHeader className="pb-3">
          <CardTitle className="text-xl font-semibold">Etiquetas Cadastradas</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {labels.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma etiqueta cadastrada.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {labels.map((label) => (
                <div
                  key={label.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-accent"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full shadow-sm"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="font-medium text-sm">{label.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-red-400 hover:bg-accent h-8 w-8"
                    onClick={() => handleDelete(label.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </GlassCard>
    </div>
  )
}
