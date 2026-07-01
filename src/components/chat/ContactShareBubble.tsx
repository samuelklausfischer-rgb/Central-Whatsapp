import { useState } from 'react'
import { User, MessageCircle, UserPlus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateContactByJid } from '@/services/contacts'
import { useToast } from '@/hooks/use-toast'

/**
 * Balão de contato compartilhado (vCard) no chat, estilo WhatsApp: avatar
 * genérico + nome/telefone, com botões "Mensagem" (abre conversa com o
 * número) e "Salvar contato" (popup pra nomear e salvar).
 */
export function ContactShareBubble({
  name,
  phone,
  onOpenConversation,
}: {
  name: string
  phone: string | null
  onOpenConversation: (jid: string) => void
}) {
  const { toast } = useToast()
  const [isSaveOpen, setIsSaveOpen] = useState(false)
  const [saveNameInput, setSaveNameInput] = useState(name)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!phone) return
    setSaving(true)
    try {
      await updateContactByJid(phone, { name: saveNameInput.trim() || name })
      toast({ title: 'Contato salvo' })
      setIsSaveOpen(false)
    } catch {
      toast({ title: 'Erro ao salvar contato', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="w-full max-w-[280px] overflow-hidden rounded-xl border border-chat-border bg-chat-panel/60">
        <div className="flex items-center gap-3 p-3">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-chat-hover text-chat-muted">
            <User className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-chat-text" title={name}>
              {name}
            </span>
            {phone && <span className="block truncate text-xs text-chat-muted">{phone}</span>}
          </span>
        </div>
        <div className="flex border-t border-chat-border">
          <button
            type="button"
            disabled={!phone}
            onClick={() => phone && onOpenConversation(phone)}
            className="flex flex-1 items-center justify-center gap-1.5 py-2 text-sm font-medium text-blue-400 hover:bg-chat-hover transition-colors disabled:opacity-40"
          >
            <MessageCircle className="h-4 w-4" /> Mensagem
          </button>
          <div className="w-px bg-chat-border" />
          <button
            type="button"
            disabled={!phone}
            onClick={() => {
              setSaveNameInput(name)
              setIsSaveOpen(true)
            }}
            className="flex flex-1 items-center justify-center gap-1.5 py-2 text-sm font-medium text-blue-400 hover:bg-chat-hover transition-colors disabled:opacity-40"
          >
            <UserPlus className="h-4 w-4" /> Salvar contato
          </button>
        </div>
      </div>

      <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
        <DialogContent className="sm:max-w-[400px] bg-chat-panel border-chat-border">
          <DialogHeader>
            <DialogTitle>Salvar contato</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="save-contact-name">Nome</Label>
              <Input
                id="save-contact-name"
                value={saveNameInput}
                onChange={(e) => setSaveNameInput(e.target.value)}
                className="bg-chat-panel border-chat-border"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSave()
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !saveNameInput.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
