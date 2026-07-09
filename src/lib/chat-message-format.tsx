import React, { Fragment, useState } from 'react'
import { MessageSquare, Copy } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'

// Faixa de caracteres de controle C1 (code points 128-159) que aparecem em
// conteúdo com encoding quebrado (mojibake) — construída via fromCharCode
// para evitar caracteres de controle literais no arquivo-fonte.
const C1_CONTROL_CHARS_REGEX = new RegExp(
  `[${String.fromCharCode(128)}-${String.fromCharCode(159)}]`,
  'g',
)

// Extraído de ChatWindow.tsx (item C5/C6 do plano de otimização) para ser
// compartilhado entre ChatWindow.tsx e MessageBubble.tsx sem duplicação.

const PHONE_REGEX = /(?:\+55\s?)?(?:\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}|\d{10,13})/g

function normalizePhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 13) return ''
  if (digits.startsWith('55')) return digits
  return `55${digits}`
}

function splitByPhoneNumbers(
  text: string,
  onOpenConversation?: (jid: string) => void,
): React.ReactNode[] {
  const segments: React.ReactNode[] = []
  let lastIndex = 0
  for (const match of Array.from(text.matchAll(PHONE_REGEX))) {
    const idx = match.index ?? 0
    if (idx > lastIndex) {
      segments.push(text.slice(lastIndex, idx))
    }
    const jid = normalizePhoneNumber(match[0])
    if (jid) {
      segments.push(
        <PhoneNumberTrigger
          key={idx}
          display={match[0]}
          jid={jid}
          onOpenConversation={onOpenConversation}
        />,
      )
    } else {
      segments.push(match[0])
    }
    lastIndex = idx + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex))
  }
  return segments.length > 0 ? segments : [text]
}

function PhoneNumberTrigger({
  display,
  jid,
  onOpenConversation,
}: {
  display: string
  jid: string
  onOpenConversation?: (jid: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const { toast } = useToast()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jid)
      toast({ title: 'Número copiado!' })
    } catch {
      toast({ title: 'Erro ao copiar', variant: 'destructive' })
    }
    setIsOpen(false)
  }

  const handleOpen = () => {
    if (onOpenConversation) {
      onOpenConversation(jid)
    }
    setIsOpen(false)
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="text-blue-400 hover:text-blue-500 underline underline-offset-2 decoration-blue-400/50 hover:decoration-blue-500 transition-colors cursor-pointer"
          onClick={(e) => { e.stopPropagation(); setIsOpen(true) }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setIsOpen(true) } }}
        >
          {display}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bg-chat-panel border-chat-border min-w-[200px]">
        <DropdownMenuItem
          className="cursor-pointer focus:bg-chat-hover"
          onClick={(e) => { e.stopPropagation(); handleOpen() }}
        >
          <MessageSquare className="h-4 w-4 mr-2" />
          Abrir conversa com esse número
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer focus:bg-chat-hover"
          onClick={(e) => { e.stopPropagation(); handleCopy() }}
        >
          <Copy className="h-4 w-4 mr-2" />
          Copiar número
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const formatInline = (text: string, isMe: boolean, onOpenConversation?: (jid: string) => void): React.ReactNode => {
  const regex = /(https?:\/\/[^\s]+|`[^`]+`|\*[^*]+\*|_[^_]+_|~[^~]+~)/g
  const parts = text.split(regex)

  return parts.map((part, i) => {
    if (!part) return null

    if (part.match(/^https?:\/\/[^\s]+$/)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline break-all font-medium transition-colors text-chat-text/80 hover:text-chat-text"
        >
          {part}
        </a>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="bg-foreground/10 px-1.5 py-0.5 rounded text-[13px] font-mono text-foreground/90"
        >
          {formatInline(part.slice(1, -1), isMe, onOpenConversation)}
        </code>
      )
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <strong key={i} className="font-bold">
          {formatInline(part.slice(1, -1), isMe, onOpenConversation)}
        </strong>
      )
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return (
        <em key={i} className="italic">
          {formatInline(part.slice(1, -1), isMe, onOpenConversation)}
        </em>
      )
    }
    if (part.startsWith('~') && part.endsWith('~')) {
      return (
        <del key={i} className="line-through">
          {formatInline(part.slice(1, -1), isMe, onOpenConversation)}
        </del>
      )
    }

    const phoneSegments = splitByPhoneNumbers(part, onOpenConversation)
    return <Fragment key={i}>{phoneSegments}</Fragment>
  })
}

const isMediaPlaceholder = (content?: string) => {
  if (!content) return false
  const cleaned = content.trim().replace(C1_CONTROL_CHARS_REGEX, '')
  return (
    [
      '[Anexo]',
      '[Imagem]',
      '[Vídeo]',
      '[VÃ­deo]',
      '[Áudio]',
      '[Ãudio]',
      '[Música]',
      '[Figurinha]',
      '[Mensagem de mídia]',
      '[Documento]',
      '[Mídia]',
      '[Contato]',
    ].includes(cleaned) ||
    cleaned.startsWith('[Documento:') ||
    cleaned.startsWith('[Contato:') ||
    cleaned.startsWith('[Lista:')
  )
}

export const isTechnicalPlaceholder = (content?: string) => {
  if (!content) return false
  const trimmed = content.trim()
  if (isMediaPlaceholder(trimmed)) return true
  const normalized = trimmed.toLowerCase().replace(C1_CONTROL_CHARS_REGEX, '')
  return (
    ['[audio]', '[áudio]', '[ãudio]', 'audio', 'áudio', 'ãudio', 'mensagem de audio', 'mensagem de áudio'].includes(
      normalized,
    )
  )
}

export const renderMessage = (content: string, isMe: boolean, onOpenConversation?: (jid: string) => void) => {
  if (!content) return null
  const parts = content.split(/(```[\s\S]*?```)/g)

  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      return (
        <pre
          key={i}
          className="bg-foreground/10 p-3 rounded-md my-2 text-[13px] overflow-x-auto font-mono text-foreground/90 border border-chat-border whitespace-pre-wrap"
        >
          <code>{part.slice(3, -3)}</code>
        </pre>
      )
    }

    const lines = part.split('\n')
    const result: React.ReactNode[] = []
    let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null

    const flushList = () => {
      if (currentList) {
        if (currentList.type === 'ul') {
          result.push(
            <ul
              key={`ul-${result.length}`}
              className="list-disc pl-5 my-2 space-y-1 marker:text-foreground/50"
            >
              {currentList.items.map((item, idx) => (
                <li key={idx}>{formatInline(item, isMe, onOpenConversation)}</li>
              ))}
            </ul>,
          )
        } else {
          result.push(
            <ol
              key={`ol-${result.length}`}
              className="list-decimal pl-5 my-2 space-y-1 marker:text-foreground/50"
            >
              {currentList.items.map((item, idx) => (
                <li key={idx}>{formatInline(item, isMe, onOpenConversation)}</li>
              ))}
            </ol>,
          )
        }
        currentList = null
      }
    }

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j]
      const isUl = line.match(/^[-*]\s+(.*)$/)
      const isOl = line.match(/^\d+\.\s+(.*)$/)
      const isQuote = line.match(/^>\s+(.*)$/)

      if (isUl) {
        if (currentList && currentList.type !== 'ul') flushList()
        if (!currentList) currentList = { type: 'ul', items: [] }
        currentList.items.push(isUl[1])
      } else if (isOl) {
        if (currentList && currentList.type !== 'ol') flushList()
        if (!currentList) currentList = { type: 'ol', items: [] }
        currentList.items.push(isOl[1])
      } else {
        flushList()
        if (isQuote) {
          result.push(
            <blockquote
              key={`quote-${j}`}
              className={`border-l-4 pl-3 py-1 my-2 italic rounded-r ${
                isMe
                  ? 'border-primary-foreground/40 bg-primary-foreground/10 text-primary-foreground'
                  : 'border-secondary-foreground/40 bg-secondary-foreground/10 text-secondary-foreground'
              }`}
            >
              {formatInline(isQuote[1], isMe, onOpenConversation)}
            </blockquote>,
          )
        } else {
          const nextLine = lines[j + 1]
          const isNextBlock =
            nextLine !== undefined &&
            (nextLine.match(/^[-*]\s+/) || nextLine.match(/^\d+\.\s+/) || nextLine.match(/^>\s+/))

          result.push(
            <Fragment key={`line-${j}`}>
              {formatInline(line, isMe, onOpenConversation)}
              {j < lines.length - 1 && !isNextBlock && <br />}
            </Fragment>,
          )
        }
      }
    }
    flushList()

    return <Fragment key={i}>{result}</Fragment>
  })
}

export const getDateKey = (value: string) => {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export const getDateLabel = (value: string) => {
  if (!value) return ''
  const date = new Date(value)
  if (isNaN(date.getTime())) return ''
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (getDateKey(value) === getDateKey(today.toISOString())) return 'Hoje'
  if (getDateKey(value) === getDateKey(yesterday.toISOString())) return 'Ontem'

  return format(date, 'dd/MM/yyyy')
}
