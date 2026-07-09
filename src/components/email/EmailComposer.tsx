import { useState, useEffect } from 'react'
import { X, Send, CalendarClock, ChevronDown } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { sendEmail } from '@/services/emails'
import { getEmailTemplates, applyTemplateVariables } from '@/services/email_templates'
import type { EmailAccount, Email, EmailTemplate } from '@/lib/supabase/email-types'

interface Props {
  open: boolean
  onClose: () => void
  account: EmailAccount | null
  replyTo?: Email | null
  forwardFrom?: Email | null
  initialBody?: string
  onSent?: (email: Email) => void
}

export function EmailComposer({
  open,
  onClose,
  account,
  replyTo,
  forwardFrom,
  initialBody = '',
  onSent,
}: Props) {
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [isSending, setIsSending] = useState(false)
  const { toast } = useToast()

  // Preencher campos ao abrir como resposta ou encaminhamento
  useEffect(() => {
    if (!open) return

    if (replyTo) {
      setTo(replyTo.from_email)
      setSubject(replyTo.subject?.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject || ''}`)
      const quote = `\n\n---\n<b>Em ${new Date(replyTo.received_at).toLocaleString('pt-BR')}, ${replyTo.from_name || replyTo.from_email} escreveu:</b>\n${replyTo.body_text?.slice(0, 500) ?? ''}`
      setBody(initialBody || quote)
    } else if (forwardFrom) {
      setTo('')
      setSubject(`Fwd: ${forwardFrom.subject || ''}`)
      const fwd = `\n\n---\n<b>Mensagem encaminhada</b>\nDe: ${forwardFrom.from_name || forwardFrom.from_email}\nAssunto: ${forwardFrom.subject}\n\n${forwardFrom.body_text ?? ''}`
      setBody(fwd)
    } else {
      setTo('')
      setCc('')
      setSubject('')
      setBody(initialBody || '')
    }

    getEmailTemplates().then(setTemplates).catch(() => {})
  }, [open, replyTo, forwardFrom, initialBody])

  function applyTemplate(templateId: string) {
    const t = templates.find((t) => t.id === templateId)
    if (!t) return

    const vars: Record<string, string> = {}
    const applied = applyTemplateVariables(t.body_html, vars)
    setBody(applied)
    if (t.subject_template) {
      setSubject(applyTemplateVariables(t.subject_template, vars))
    }
  }

  async function handleSend() {
    if (!account) {
      toast({ title: 'Selecione uma conta de email', variant: 'destructive' })
      return
    }
    if (!to.trim()) {
      toast({ title: 'Informe pelo menos um destinatário', variant: 'destructive' })
      return
    }
    if (!subject.trim()) {
      toast({ title: 'Informe o assunto', variant: 'destructive' })
      return
    }
    if (!body.trim()) {
      toast({ title: 'Escreva o corpo do email', variant: 'destructive' })
      return
    }

    setIsSending(true)
    try {
      const toList = to.split(/[,;]/).map((e) => e.trim()).filter(Boolean)
      const ccList = cc ? cc.split(/[,;]/).map((e) => e.trim()).filter(Boolean) : []

      const sent = await sendEmail({
        account_id: account.id,
        to: toList,
        cc: ccList.length ? ccList : undefined,
        subject,
        body_html: `<div>${body.replace(/\n/g, '<br>')}</div>`,
        body_text: body,
        reply_to_email_id: replyTo?.id,
      })

      toast({ title: 'Email enviado com sucesso' })
      onSent?.(sent)
      onClose()
    } catch (err) {
      toast({
        title: 'Erro ao enviar email',
        description: err instanceof Error ? err.message : 'Tente novamente',
        variant: 'destructive',
      })
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
          <DialogTitle className="text-base">
            {replyTo ? 'Responder email' : forwardFrom ? 'Encaminhar email' : 'Novo email'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-0 divide-y divide-border">
          {/* De */}
          <div className="flex items-center gap-3 px-6 py-3">
            <Label className="text-xs text-muted-foreground w-12 flex-shrink-0">De</Label>
            <span className="text-sm text-foreground">
              {account ? `${account.label} <${account.email}>` : '— selecione uma conta'}
            </span>
          </div>

          {/* Para */}
          <div className="flex items-center gap-3 px-6 py-3">
            <Label className="text-xs text-muted-foreground w-12 flex-shrink-0">Para</Label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="destinatario@email.com"
              className="border-0 shadow-none focus-visible:ring-0 p-0 h-auto text-sm"
            />
            <button
              onClick={() => setShowCc((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
            >
              CC
            </button>
          </div>

          {/* CC */}
          {showCc && (
            <div className="flex items-center gap-3 px-6 py-3">
              <Label className="text-xs text-muted-foreground w-12 flex-shrink-0">CC</Label>
              <Input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@email.com"
                className="border-0 shadow-none focus-visible:ring-0 p-0 h-auto text-sm"
              />
            </div>
          )}

          {/* Assunto */}
          <div className="flex items-center gap-3 px-6 py-3">
            <Label className="text-xs text-muted-foreground w-12 flex-shrink-0">Assunto</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Assunto do email"
              className="border-0 shadow-none focus-visible:ring-0 p-0 h-auto text-sm font-medium"
            />
          </div>

          {/* Templates */}
          {templates.length > 0 && (
            <div className="flex items-center gap-3 px-6 py-2">
              <Label className="text-xs text-muted-foreground w-12 flex-shrink-0">Template</Label>
              <Select onValueChange={applyTemplate}>
                <SelectTrigger className="h-8 text-xs border-dashed">
                  <SelectValue placeholder="Aplicar template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-sm">
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Corpo */}
          <div className="px-6 py-3">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Escreva sua mensagem..."
              className="min-h-[200px] border-0 shadow-none focus-visible:ring-0 p-0 resize-none text-sm"
            />
          </div>

          {/* Assinatura preview */}
          {account?.signature && (
            <div className="px-6 py-3 bg-muted/20 text-sm text-muted-foreground border-t border-dashed border-border">
              <p className="text-[10px] uppercase tracking-wider mb-1">Assinatura</p>
              <p className="whitespace-pre-line text-xs">{account.signature}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSending}>
            <X className="h-4 w-4 mr-1.5" />
            Cancelar
          </Button>

          <Button onClick={handleSend} disabled={isSending} className="gap-1.5">
            {isSending ? (
              <>
                <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Enviar
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
