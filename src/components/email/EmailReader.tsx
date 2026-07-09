import { useEffect, useRef } from 'react'
import { Paperclip, Download, User } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { EmailActionsBar } from './EmailActionsBar'
import { CrossChannelPanel } from './CrossChannelPanel'
import { AiSuggestionPanel } from './AiSuggestionPanel'
import type { Email, EmailState } from '@/lib/supabase/email-types'
import type { Contact, AiPrompt } from '@/lib/supabase/types'

function sanitizeHtml(html: string): string {
  // Remove scripts e elementos potencialmente perigosos, mantém layout
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '')
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function bytesToHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Props {
  email: Email
  state: EmailState | null
  contact: Contact | null
  aiPrompts: AiPrompt[]
  onReply: (email: Email) => void
  onForward: (email: Email) => void
  onClose: (emailId: string) => void
  onArchive: (emailId: string) => void
  onToggleStar: (emailId: string) => void
  onSetWaiting: (emailId: string) => void
  onUseSuggestion: (text: string) => void
}

export function EmailReader({
  email,
  state,
  contact,
  aiPrompts,
  onReply,
  onForward,
  onClose,
  onArchive,
  onToggleStar,
  onSetWaiting,
  onUseSuggestion,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Injetar HTML sanitizado no iframe
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !email.body_html) return

    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) return

    const sanitized = sanitizeHtml(email.body_html)
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              font-size: 14px;
              line-height: 1.6;
              color: #1a1a1a;
              margin: 0;
              padding: 16px;
              word-break: break-word;
            }
            img { max-width: 100%; height: auto; }
            a { color: #3B82F6; }
            table { max-width: 100%; }
            pre { white-space: pre-wrap; }
          </style>
        </head>
        <body>${sanitized}</body>
      </html>
    `
    doc.open()
    doc.write(html)
    doc.close()

    // Ajustar altura dinamicamente
    const resize = () => {
      if (iframe.contentDocument?.body) {
        iframe.style.height = iframe.contentDocument.body.scrollHeight + 32 + 'px'
      }
    }
    iframe.onload = resize
    setTimeout(resize, 200)
  }, [email.body_html])

  return (
    <ScrollArea className="flex-1 h-full">
      <div className="p-6 space-y-4 max-w-3xl mx-auto">

        {/* Cabeçalho do email */}
        <div className="space-y-3">
          <h2 className="text-xl font-semibold leading-tight text-foreground">
            {email.subject || '(sem assunto)'}
          </h2>

          {/* Barra de ações */}
          <EmailActionsBar
            email={email}
            state={state}
            onReply={() => onReply(email)}
            onForward={() => onForward(email)}
            onClose={() => onClose(email.id)}
            onArchive={() => onArchive(email.id)}
            onToggleStar={() => onToggleStar(email.id)}
            onSetWaiting={() => onSetWaiting(email.id)}
          />

          {/* Remetente */}
          <div className="flex items-start gap-3 pt-1">
            <Avatar className="h-9 w-9 flex-shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {(email.from_name || email.from_email).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-semibold">{email.from_name || email.from_email}</span>
                {email.from_name && (
                  <span className="text-xs text-muted-foreground">&lt;{email.from_email}&gt;</span>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatDateTime(email.received_at)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Para: {email.to_emails.join(', ')}
                {email.cc_emails?.length > 0 && ` · CC: ${email.cc_emails.join(', ')}`}
              </div>
            </div>
          </div>
        </div>

        {/* Classificação IA */}
        {(email.ai_category || email.ai_sentiment || email.ai_summary) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {email.ai_category && (
              <span className="px-2 py-1 rounded-full bg-muted text-muted-foreground capitalize">
                {email.ai_category}
              </span>
            )}
            {email.ai_sentiment && (
              <span
                className={`px-2 py-1 rounded-full font-medium ${
                  email.ai_sentiment === 'urgente'
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : email.ai_sentiment === 'reclamacao'
                      ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                      : email.ai_sentiment === 'positivo'
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'bg-muted text-muted-foreground'
                }`}
              >
                {email.ai_sentiment}
              </span>
            )}
            {email.ai_summary && (
              <span className="text-muted-foreground italic">{email.ai_summary}</span>
            )}
          </div>
        )}

        {/* Contexto cross-canal */}
        {contact && <CrossChannelPanel contact={contact} />}

        {/* Corpo do email */}
        <div className="border border-border rounded-lg overflow-hidden">
          {email.body_html ? (
            <iframe
              ref={iframeRef}
              sandbox="allow-same-origin"
              className="w-full min-h-[200px] block"
              title="Conteúdo do email"
            />
          ) : (
            <div className="p-4 text-sm text-foreground whitespace-pre-wrap font-mono">
              {email.body_text || '(sem conteúdo)'}
            </div>
          )}
        </div>

        {/* Anexos */}
        {email.attachments && email.attachments.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Anexos ({email.attachments.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {email.attachments.map((att, i) => (
                <a
                  key={i}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition-colors text-sm"
                >
                  <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate max-w-[160px]">{att.name}</span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {bytesToHuman(att.size)}
                  </span>
                  <Download className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Sugestão IA */}
        {aiPrompts.length > 0 && (
          <AiSuggestionPanel
            email={email}
            prompts={aiPrompts}
            onUseSuggestion={onUseSuggestion}
          />
        )}
      </div>
    </ScrollArea>
  )
}
