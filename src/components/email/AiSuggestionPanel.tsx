import { useState } from 'react'
import { Sparkles, ChevronDown, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { supabase } from '@/lib/supabase/client'
import type { AiPrompt } from '@/lib/supabase/types'
import type { Email } from '@/lib/supabase/email-types'

interface Props {
  email: Email
  prompts: AiPrompt[]
  onUseSuggestion: (text: string) => void
}

export function AiSuggestionPanel({ email, prompts, onUseSuggestion }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [suggestion, setSuggestion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  async function handleGenerate() {
    if (!selectedPromptId) {
      toast({ title: 'Selecione um prompt de IA', variant: 'destructive' })
      return
    }

    setIsLoading(true)
    setSuggestion('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Não autenticado')

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const resp = await fetch(`${supabaseUrl}/functions/v1/ai-message-assist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action_key: selectedPromptId,
          // Passa assunto + corpo como "histórico" para a edge function existente
          conversation_history: [
            {
              role: 'user',
              content: `Assunto: ${email.subject || '(sem assunto)'}\n\n${email.body_text || ''}`,
            },
          ],
        }),
      })

      const result = await resp.json()
      if (!resp.ok) throw new Error(result.error || 'Erro ao gerar sugestão')

      setSuggestion(result.reply || result.content || '')
    } catch (err) {
      toast({
        title: 'Erro ao gerar sugestão',
        description: err instanceof Error ? err.message : 'Tente novamente',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(suggestion)
    toast({ title: 'Copiado para a área de transferência' })
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="border border-border rounded-lg overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Sugestão IA
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-3 border-t border-border space-y-3">
            <Select value={selectedPromptId} onValueChange={setSelectedPromptId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Selecionar prompt..." />
              </SelectTrigger>
              <SelectContent>
                {prompts.map((p) => (
                  <SelectItem key={p.action_key} value={p.action_key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              className="w-full"
              onClick={handleGenerate}
              disabled={isLoading || !selectedPromptId}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Gerando...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5" />
                  Sugerir resposta
                </span>
              )}
            </Button>

            {suggestion && (
              <div className="space-y-2">
                <Textarea
                  value={suggestion}
                  onChange={(e) => setSuggestion(e.target.value)}
                  rows={5}
                  className="text-sm resize-none"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={handleCopy} className="flex-1">
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                    Copiar
                  </Button>
                  <Button size="sm" onClick={() => onUseSuggestion(suggestion)} className="flex-1">
                    Usar resposta
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
