import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useDeferredValue, Fragment } from 'react'
import {
  conversationDraftKey,
  saveDraft,
  getDraft,
  clearDraft,
  EMPTY_DRAFT,
  type ConversationDraft,
} from '@/stores/conversationDrafts'
import logoUrl from '/logo.png'
import {
  ArrowLeft,
  Plus,
  Send,
  Paperclip,
  Smile,
  MoreVertical,
  StickyNote,
  MessageSquare,
  Info,
  Tags,
  Check,
  CalendarClock,
  X,
  File as FileIcon,
  Download,
  ChevronDown,
  Image as ImageIcon,
  Pencil,
  Wand2,
  Sparkles,
  Loader2,
  ClipboardList,
  Mic,
  Square,
  Trash2,
  Copy,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Play,
  Eye,
  UserCheck,
  Users,
  Share2,
  User,
  CheckCircle,
  Search,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createScheduledMessage, type CreateScheduledMessageInput } from '@/services/scheduled_messages'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
import { MessageActionsMenu } from '@/components/chat/MessageActionsMenu'
import { ConversationGallery } from '@/components/chat/ConversationGallery'
import { ForwardDialog } from '@/components/chat/ForwardDialog'
import { GroupMembersPanel } from '@/components/chat/GroupMembersPanel'
import { ContactPickerDialog } from '@/components/chat/ContactPickerDialog'
import { ShareThisContactDialog } from '@/components/chat/ShareThisContactDialog'
import { MentionAutocomplete } from '@/components/chat/MentionAutocomplete'
import { UnavailableAttachmentBubble } from '@/components/chat/UnavailableAttachmentBubble'
import { ChatImage } from '@/components/chat/ChatImage'
import { anexoEstaVivo } from '@/services/gallery'
import {
  mencaoEmDigitacao,
  aplicarMencao,
  extrairMencionados,
  ehMencao,
  PADRAO_MENCAO,
} from '@/lib/mentions'
import { compartilharContatos, podeCompartilhar, paraCartao } from '@/services/contact_share'
import { getParticipantesDoGrupo, escolherConversaDoParticipante } from '@/services/groups'
import { AudioMessage } from '@/components/chat/AudioMessage'
import { MediaViewer, type ViewerMedia } from '@/components/chat/MediaViewer'
import { downloadFile } from '@/lib/download'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getTriggers } from '@/services/message_triggers'
import { getLabels } from '@/services/labels'
import { getContactTags, toggleContactTag } from '@/services/contact_tags'
import { useRealtime } from '@/hooks/use-realtime'
import { useAuth } from '@/hooks/use-auth'
import { sendMessage, reactToMessage, deleteMessage, editMessage } from '@/services/messages'
import { updateContactByJid } from '@/services/contacts'
import { createNote, getNotesByContact, deleteNote } from '@/services/notes'
import type { Note, ConversationAssignment } from '@/lib/supabase/types'
import { ContactNoteIcon } from '@/components/ui/ContactNoteIcon'
import { TeamAssignDialog } from '@/components/chat/TeamAssignDialog'
import { markConversationRead, markConversationReadGlobal, getConversationViewers, getConversationAssignment, getConversationRecentViewers, type ConversationViewer, type ConversationRecentViewer } from '@/services/conversation_states'
import { buildContactIndex, resolveContactDisplayName, findContactByIdentifier, isGroupJid, normalizeToDigits } from '@/lib/contacts/normalize'
import { isPdfFile, isExcelFile } from '@/lib/file-type'
import { DocumentBubble } from '@/components/chat/DocumentBubble'
import { ContactShareBubble } from '@/components/chat/ContactShareBubble'
import { ListMessageBubble } from '@/components/chat/ListMessageBubble'
import { MessageSearchBar } from '@/components/chat/MessageSearchBar'
import { TOP_EMOJIS, getEmojiImageUrl } from '@/lib/emojis'
import supabase from '@/lib/supabase/client'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'

// Barra de atendimento (Pegar / Designar / Não posso / Finalizar) escondida a
// pedido do usuário em 28/07/2026 — ninguém estava usando e ela poluía o topo
// da conversa. Escondida por flag, e não removida, porque o estado que ela
// grava continua sendo LIDO em vários lugares (selos da lista, fixação
// automática, supressão de notificação, filtro de pendente de resposta), e
// porque a feature recebeu manutenção até 27/07 — se alguém sentir falta,
// basta voltar para `true`.
const BARRA_ATENDIMENTO_VISIVEL = false

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
  offset: number = 0,
  ranges: HighlightRange[] = EMPTY_RANGES,
): React.ReactNode[] {
  const segments: React.ReactNode[] = []
  let lastIndex = 0
  for (const match of Array.from(text.matchAll(PHONE_REGEX))) {
    const idx = match.index ?? 0
    if (idx > lastIndex) {
      segments.push(renderHighlightRuns(text.slice(lastIndex, idx), offset + lastIndex, ranges))
    }
    const jid = normalizePhoneNumber(match[0])
    if (jid) {
      segments.push(
        <PhoneNumberTrigger
          key={idx}
          display={match[0]}
          jid={jid}
          onOpenConversation={onOpenConversation}
          textOffset={offset + idx}
          highlightRanges={ranges}
        />,
      )
    } else {
      segments.push(renderHighlightRuns(match[0], offset + idx, ranges))
    }
    lastIndex = idx + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push(renderHighlightRuns(text.slice(lastIndex), offset + lastIndex, ranges))
  }
  return segments.length > 0 ? segments : [renderHighlightRuns(text, offset, ranges)]
}

function PhoneNumberTrigger({
  display,
  jid,
  onOpenConversation,
  textOffset = 0,
  highlightRanges = EMPTY_RANGES,
}: {
  display: string
  jid: string
  onOpenConversation?: (jid: string) => void
  textOffset?: number
  highlightRanges?: HighlightRange[]
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
          {renderHighlightRuns(display, textOffset, highlightRanges)}
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

const formatInline = (
  text: string,
  isMe: boolean,
  onOpenConversation?: (jid: string) => void,
  offset: number = 0,
  ranges: HighlightRange[] = EMPTY_RANGES,
  resolveMention?: (phone: string) => string,
): React.ReactNode => {
  // A menção (@ + 10-15 dígitos) entra aqui para ser tratada ANTES do
  // `splitByPhoneNumbers`: sem isso o número viraria link de telefone e sobraria
  // um "@" solto na frente — que é exatamente como as menções recebidas aparecem
  // hoje no app.
  const regex = new RegExp(
    `(https?://[^\\s]+|${PADRAO_MENCAO}|\`[^\`]+\`|\\*[^*]+\\*|_[^_]+_|~[^~]+~)`,
    'g',
  )
  const parts = text.split(regex)

  let cursor = offset
  return parts.map((part, i) => {
    const partOffset = cursor
    cursor += part.length
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
          {renderHighlightRuns(part, partOffset, ranges)}
        </a>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="bg-foreground/10 px-1.5 py-0.5 rounded text-[13px] font-mono text-foreground/90"
        >
          {formatInline(part.slice(1, -1), isMe, onOpenConversation, partOffset + 1, ranges, resolveMention)}
        </code>
      )
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <strong key={i} className="font-bold">
          {formatInline(part.slice(1, -1), isMe, onOpenConversation, partOffset + 1, ranges, resolveMention)}
        </strong>
      )
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return (
        <em key={i} className="italic">
          {formatInline(part.slice(1, -1), isMe, onOpenConversation, partOffset + 1, ranges, resolveMention)}
        </em>
      )
    }
    if (part.startsWith('~') && part.endsWith('~')) {
      return (
        <del key={i} className="line-through">
          {formatInline(part.slice(1, -1), isMe, onOpenConversation, partOffset + 1, ranges, resolveMention)}
        </del>
      )
    }

    // Menção: o texto guarda o NÚMERO (é ele que o WhatsApp usa para notificar),
    // e aqui trocamos por nome só na exibição — igual ao WhatsApp, que mostra
    // @Fulano sobre um texto que por baixo tem o número. Sem o resolvedor, cai
    // no comportamento antigo.
    if (ehMencao(part)) {
      const fone = part.slice(1)
      const rotulo = resolveMention ? resolveMention(fone) : fone
      return (
        <span
          key={i}
          title={`+${fone}`}
          className={`font-medium rounded px-0.5 ${isMe ? 'bg-primary-foreground/15' : 'text-primary'}`}
        >
          @{rotulo}
        </span>
      )
    }

    const phoneSegments = splitByPhoneNumbers(part, onOpenConversation, partOffset, ranges)
    return <Fragment key={i}>{phoneSegments}</Fragment>
  })
}

const isMediaPlaceholder = (content?: string) => {
  if (!content) return false
  const cleaned = content.trim().replace(/[\u0080-\u009F]/g, '')
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

const isTechnicalPlaceholder = (content?: string) => {
  if (!content) return false
  const trimmed = content.trim()
  if (isMediaPlaceholder(trimmed)) return true
  const normalized = trimmed.toLowerCase().replace(/[\u0080-\u009F]/g, '')
  return (
    ['[audio]', '[áudio]', '[ãudio]', 'audio', 'áudio', 'ãudio', 'mensagem de audio', 'mensagem de áudio'].includes(
      normalized,
    )
  )
}

interface HighlightRange {
  start: number
  end: number
  isCurrent: boolean
}

const EMPTY_RANGES: HighlightRange[] = []

// Busca (Ctrl+F): ocorrências calculadas sobre o content BRUTO de cada
// mensagem, via indexOf simples (nunca RegExp — evita qualquer risco de
// injeção a partir do texto digitado pelo usuário). Essa lista é a única
// fonte de verdade tanto para o contador "X de Y" quanto para o destaque.
interface MessageOccurrence {
  messageId: string
  start: number
  end: number
}

const computeOccurrences = (messages: any[], query: string): MessageOccurrence[] => {
  const trimmed = query.trim()
  if (!trimmed) return []
  const lowerQuery = trimmed.toLowerCase()
  const occurrences: MessageOccurrence[] = []
  for (const msg of messages) {
    if (msg.deleted_at) continue
    if (!msg.content?.trim()) continue
    if (isTechnicalPlaceholder(msg.content)) continue
    const lowerContent = msg.content.toLowerCase()
    let from = 0
    while (true) {
      const idx = lowerContent.indexOf(lowerQuery, from)
      if (idx === -1) break
      occurrences.push({ messageId: msg.id, start: idx, end: idx + lowerQuery.length })
      from = idx + lowerQuery.length
    }
  }
  return occurrences
}

// Recebe um trecho de texto puro (folha) e o offset absoluto desse trecho
// dentro do content original da mensagem, e envolve em <mark> as partes que
// caem dentro de algum intervalo de destaque (busca ativa).
const renderHighlightRuns = (text: string, textOffset: number, ranges: HighlightRange[]): React.ReactNode => {
  if (!text || ranges.length === 0) return text
  const relevant = ranges.filter((r) => r.end > textOffset && r.start < textOffset + text.length)
  if (relevant.length === 0) return text
  const nodes: React.ReactNode[] = []
  let cursor = 0
  relevant.forEach((r, i) => {
    const localStart = Math.max(0, r.start - textOffset)
    const localEnd = Math.min(text.length, r.end - textOffset)
    if (localStart > cursor) nodes.push(text.slice(cursor, localStart))
    nodes.push(
      <mark
        key={`hl-${textOffset}-${i}`}
        className={
          r.isCurrent
            ? 'bg-amber-400 text-black rounded-[2px]'
            : 'bg-yellow-300/50 text-inherit rounded-[2px]'
        }
      >
        {text.slice(localStart, localEnd)}
      </mark>,
    )
    cursor = Math.max(cursor, localEnd)
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

const renderMessage = (
  content: string,
  isMe: boolean,
  onOpenConversation?: (jid: string) => void,
  ranges: HighlightRange[] = EMPTY_RANGES,
  resolveMention?: (phone: string) => string,
) => {
  if (!content) return null
  const parts = content.split(/(```[\s\S]*?```)/g)

  let partCursor = 0
  return parts.map((part, i) => {
    const partOffset = partCursor
    partCursor += part.length

    if (part.startsWith('```') && part.endsWith('```')) {
      return (
        <pre
          key={i}
          className="bg-foreground/10 p-3 rounded-md my-2 text-[13px] overflow-x-auto font-mono text-foreground/90 border border-chat-border whitespace-pre-wrap"
        >
          <code>{renderHighlightRuns(part.slice(3, -3), partOffset + 3, ranges)}</code>
        </pre>
      )
    }

    const lines = part.split('\n')
    const result: React.ReactNode[] = []
    let currentList: { type: 'ul' | 'ol'; items: { text: string; offset: number }[] } | null = null

    const flushList = () => {
      if (currentList) {
        if (currentList.type === 'ul') {
          result.push(
            <ul
              key={`ul-${result.length}`}
              className="list-disc pl-5 my-2 space-y-1 marker:text-foreground/50"
            >
              {currentList.items.map((item, idx) => (
                <li key={idx}>{formatInline(item.text, isMe, onOpenConversation, item.offset, ranges, resolveMention)}</li>
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
                <li key={idx}>{formatInline(item.text, isMe, onOpenConversation, item.offset, ranges, resolveMention)}</li>
              ))}
            </ol>,
          )
        }
        currentList = null
      }
    }

    let lineOffset = partOffset
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j]
      const thisLineOffset = lineOffset
      lineOffset += line.length + 1
      const isUl = line.match(/^[-*]\s+(.*)$/)
      const isOl = line.match(/^\d+\.\s+(.*)$/)
      const isQuote = line.match(/^>\s+(.*)$/)

      if (isUl) {
        if (currentList && currentList.type !== 'ul') flushList()
        if (!currentList) currentList = { type: 'ul', items: [] }
        currentList.items.push({ text: isUl[1], offset: thisLineOffset + (line.length - isUl[1].length) })
      } else if (isOl) {
        if (currentList && currentList.type !== 'ol') flushList()
        if (!currentList) currentList = { type: 'ol', items: [] }
        currentList.items.push({ text: isOl[1], offset: thisLineOffset + (line.length - isOl[1].length) })
      } else {
        flushList()
        if (isQuote) {
          const quoteOffset = thisLineOffset + (line.length - isQuote[1].length)
          result.push(
            <blockquote
              key={`quote-${j}`}
              className={`border-l-4 pl-3 py-1 my-2 italic rounded-r ${
                isMe
                  ? 'border-primary-foreground/40 bg-primary-foreground/10 text-primary-foreground'
                  : 'border-secondary-foreground/40 bg-secondary-foreground/10 text-secondary-foreground'
              }`}
            >
              {formatInline(isQuote[1], isMe, onOpenConversation, quoteOffset, ranges, resolveMention)}
            </blockquote>,
          )
        } else {
          const nextLine = lines[j + 1]
          const isNextBlock =
            nextLine !== undefined &&
            (nextLine.match(/^[-*]\s+/) || nextLine.match(/^\d+\.\s+/) || nextLine.match(/^>\s+/))

          result.push(
            <Fragment key={`line-${j}`}>
              {formatInline(line, isMe, onOpenConversation, thisLineOffset, ranges, resolveMention)}
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

// Formatter de módulo, criado uma vez. Antes, cada balão chamava
// `toLocaleTimeString` — que constrói um Intl.DateTimeFormat novo por chamada.
// Com 500 balões e a lista re-renderizando a cada tecla digitada, era
// tipicamente a operação mais cara do laço.
const timeFormatter = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })

// Só re-executa o parser de markdown/telefone/emoji quando o conteúdo (ou o
// destaque da busca) muda de verdade. React continua reconciliando os 500 nós,
// mas deixa de re-parsear todos eles a cada tecla no compositor.
const MessageBody = React.memo(function MessageBody({
  content,
  isMe,
  onOpenConversation,
  ranges,
  resolveMention,
}: {
  content: string
  isMe: boolean
  onOpenConversation?: (jid: string) => void
  ranges: HighlightRange[]
  resolveMention?: (phone: string) => string
}) {
  return <>{renderMessage(content, isMe, onOpenConversation, ranges, resolveMention)}</>
})

const getDateKey = (value: string) => {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

const getDateLabel = (value: string) => {
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

export function ChatWindow({ device, contact, conversation, assignment: assignmentProp, contacts, onBack, isMobile, sheetOpen, onSheetOpenChange, onStartConversation, onOpenConversationByJid, onOptimisticSend, onOptimisticConfirm, onOptimisticFail, estadoConversa = 'pronto', onRetryMessages, conversas = [], onForwardMessage }: any) {
  const { user } = useAuth()
  const { toast } = useToast()

  const [msgText, setMsgText] = useState('')
  const [isEmojiOpen, setIsEmojiOpen] = useState(false)
  const msgTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [isSavingTask, setIsSavingTask] = useState(false)
  const [isNicknameOpen, setIsNicknameOpen] = useState(false)
  const [nicknameInput, setNicknameInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  /** Conteúdo da conversa. É a altura DELE que cresce quando a mídia carrega. */
  const conteudoRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const prevConvKeyRef = useRef<string | null>(null)

  const [isNoteOpen, setIsNoteOpen] = useState(false)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [noteCategory, setNoteCategory] = useState<'geral' | 'financeiro' | 'rh' | 'administrativo'>('geral')
  const [contactNotes, setContactNotes] = useState<Note[]>([])
  const [savingNote, setSavingNote] = useState(false)

  const [triggers, setTriggers] = useState<any[]>([])
  const [searchTrigger, setSearchTrigger] = useState('')
  const [isPlusOpen, setIsPlusOpen] = useState(false)

  const [labels, setLabels] = useState<any[]>([])
  const [contactTags, setContactTags] = useState<any[]>([])
  const [isLabelsOpen, setIsLabelsOpen] = useState(false)

  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)

  const [isSending, setIsSending] = useState(false)
  const [isScheduling, setIsScheduling] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [isAiLoading, setIsAiLoading] = useState(false)
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiResult, setAiResult] = useState('')
  const [aiActionSelected, setAiActionSelected] = useState('')
  const [aiOriginalText, setAiOriginalText] = useState('')
  const [aiPrompts, setAiPrompts] = useState<any[]>([])
  const [isAiPromptsLoading, setIsAiPromptsLoading] = useState(true)

  const [replyingTo, setReplyingTo] = useState<any>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<any>(null)
  const [reactionPopoverMessageId, setReactionPopoverMessageId] = useState<string | null>(null)
  const [messageMenuOpenId, setMessageMenuOpenId] = useState<string | null>(null)

  // Handlers do menu de contexto da mensagem. Ficam aqui (e não dentro do
  // MessageActionsMenu) porque mexem no estado do compositor — o menu é só
  // apresentação, e assim serve igual aos dois ramos de renderização.
  const handleCopyMessage = useCallback(async (msg: any) => {
    try {
      await navigator.clipboard.writeText(msg.content || '')
      toast({ title: 'Mensagem copiada!' })
    } catch {
      toast({ title: 'Erro ao copiar', variant: 'destructive' })
    }
  }, [toast])

  const handleEditMessage = useCallback((msg: any) => {
    setEditingMessageId(msg.id)
    setMsgText(msg.content)
    setReplyingTo(null)
  }, [])

  /**
   * Responder no privado a quem escreveu no grupo — o grupo não recebe nada.
   *
   * A citação vai como TEXTO (linhas prefixadas com "> "), e não como citação
   * nativa do WhatsApp: para citar nativamente uma mensagem de OUTRA conversa, o
   * `quoted.key` teria de apontar para o JID do grupo enquanto o envio vai para o
   * privado, e a função de envio monta esse campo sempre com o destino. Além
   * disso não foi possível confirmar, sem enviar mensagem real, se a Evolution
   * repassa citação entre conversas diferentes — o risco era a citação sumir em
   * silêncio e a resposta chegar sem contexto nenhum.
   *
   * Abre a conversa privada com o texto já montado no compositor: quem envia é o
   * atendente, depois de ler.
   */
  const handleReplyPrivately = useCallback(
    async (msg: any) => {
      const lid = msg?.group_participant
      if (!lid || !device?.id) return
      const participante = { id: String(lid), phone: '', admin: null }
      // Resolve o telefone pela lista de participantes (a Evolution é a única
      // fonte que liga LID a telefone).
      let jidDestino: string | null = null
      try {
        const info = await getParticipantesDoGrupo(device.id, device.instance_key, contact)
        const achado = info.participantes.find((p) => p.id === String(lid))
        if (achado?.phone) {
          jidDestino = await escolherConversaDoParticipante(device.id, achado)
        }
      } catch {
        jidDestino = null
      }
      if (!jidDestino) {
        jidDestino = await escolherConversaDoParticipante(device.id, participante as any)
      }
      if (!jidDestino) {
        toast({
          title: 'Não foi possível abrir a conversa',
          description: 'Não encontramos o telefone deste participante.',
          variant: 'destructive',
        })
        return
      }

      const autor = msg.sender_name ? `${msg.sender_name}:` : 'No grupo:'
      const trecho = String(msg.content ?? '')
        .split('\n')
        .map((l: string) => `> ${l}`)
        .join('\n')
      // MESCLA no rascunho do destino, não substitui. Com `...EMPTY_DRAFT` a
      // entrada anterior era trocada inteira: quem tinha texto digitado, anexo
      // escolhido ou áudio gravado naquela conversa privada perdia tudo, sem
      // aviso e sem desfazer. A citação entra ANTES do que já estava.
      const chaveDestino = conversationDraftKey(device.id, jidDestino)
      const atual = getDraft(chaveDestino) ?? EMPTY_DRAFT
      const citacao = `${autor}\n${trecho}\n\n`
      saveDraft(chaveDestino, {
        ...atual,
        text: atual.text ? `${citacao}${atual.text}` : citacao,
      })
      onSheetOpenChange?.(false)
      onOpenConversationByJid?.(jidDestino)
    },
    [device?.id, device?.instance_key, contact, onOpenConversationByJid, onSheetOpenChange, toast],
  )
  const [viewers, setViewers] = useState<ConversationViewer[]>([])
  const [assignment, setAssignment] = useState<ConversationAssignment | null>(null)
  const [recentViewers, setRecentViewers] = useState<ConversationRecentViewer[]>([])
  const [teamAssignOpen, setTeamAssignOpen] = useState(false)
  const [loadingAction, setLoadingAction] = useState<'take' | 'waiting' | 'finish' | 'invite_accept' | 'invite_decline' | null>(null)
  const dismissedRef = useRef(false)
  const [mediaView, setMediaView] = useState<ViewerMedia | null>(null)
  const [galeriaAberta, setGaleriaAberta] = useState(false)
  const [encaminhandoMsg, setEncaminhandoMsg] = useState<any>(null)
  const [membrosAbertos, setMembrosAbertos] = useState(false)
  const [seletorContatoAberto, setSeletorContatoAberto] = useState(false)
  const [compartilharEsteAberto, setCompartilharEsteAberto] = useState(false)
  // Menção em curso no compositor: `{ termo, inicio }` enquanto o usuário digita
  // depois de um "@". `null` = autocomplete fechado.
  const [mencaoAtiva, setMencaoAtiva] = useState<{ termo: string; inicio: number } | null>(null)
  // "Todos" fica à parte porque não vira número no texto, e sim a flag
  // `mentionsEveryOne` no envio.
  const [mencionarTodos, setMencionarTodos] = useState(false)

  // Abre um item da galeria no visualizador que já existe. Vídeo e imagem são os
  // dois tipos que a aba Fotos produz.
  const abrirMidiaDaGaleria = useCallback((itens: any[], index: number) => {
    const item = itens[index]
    if (!item) return
    setMediaView({
      url: item.url,
      type: item.tipo === 'video' ? 'video' : 'image',
      name: item.nome,
    })
  }, [])

  // Busca dentro da conversa (Ctrl+F)
  const [isFindOpen, setIsFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const deferredFindQuery = useDeferredValue(findQuery)
  const [matchCursor, setMatchCursor] = useState(0)
  const findInputRef = useRef<HTMLInputElement>(null)
  const messageRefs = useRef(new Map<string, HTMLDivElement>())
  const lastScrolledMatchKeyRef = useRef<string | null>(null)

  const messages = conversation?.messages || []

  const occurrences = useMemo(
    () => computeOccurrences(messages, deferredFindQuery),
    [messages, deferredFindQuery],
  )
  const totalMatches = occurrences.length
  const safeCursor = totalMatches === 0 ? 0 : Math.min(matchCursor, totalMatches - 1)
  const currentOccurrence = totalMatches === 0 ? null : occurrences[safeCursor]

  const rangesByMessageId = useMemo(() => {
    const map = new Map<string, HighlightRange[]>()
    occurrences.forEach((occ, i) => {
      const arr = map.get(occ.messageId) ?? []
      arr.push({ start: occ.start, end: occ.end, isCurrent: i === safeCursor })
      map.set(occ.messageId, arr)
    })
    return map
  }, [occurrences, safeCursor])

  useEffect(() => {
    setMatchCursor(0)
  }, [deferredFindQuery])

  useEffect(() => {
    setIsFindOpen(false)
    setFindQuery('')
    setMatchCursor(0)
    lastScrolledMatchKeyRef.current = null
  }, [device?.id, contact])

  // ───────────────────────── Rascunho por conversa ─────────────────────────
  // Este componente NÃO remonta ao trocar de contato (ChatHub renderiza sem
  // `key`), então tudo que o atendente digitou continua no compositor da próxima
  // conversa. Aqui o estado de composição passa a ficar preso à conversa em que
  // foi digitado.

  const convKey = conversationDraftKey(device?.id, contact)
  const convKeyRef = useRef<string | null>(convKey)
  const draftKeyRef = useRef<string | null>(convKey)
  const liveDraftRef = useRef<ConversationDraft>(EMPTY_DRAFT)

  // Espelha o compositor vivo. Efeito SEM array de deps (roda após todo commit)
  // em vez de escrever no ref durante o render — o render pode ser descartado e
  // a mutação sobreviveria. Como useLayoutEffect roda ANTES deste, o efeito de
  // troca abaixo enxerga os valores do commit anterior, que são exatamente os da
  // conversa que está saindo.
  useEffect(() => {
    convKeyRef.current = convKey
    liveDraftRef.current = {
      text: msgText,
      replyingTo,
      editingMessageId,
      attachments,
      audioBlob,
      scheduleDate,
      mentionEveryone: mencionarTodos,
      noteTitle,
      noteContent,
      noteCategory,
      taskTitle,
      taskDescription,
      nicknameInput,
    }
  })

  // Salva o rascunho da conversa que sai e restaura o da que entra.
  // useLayoutEffect, não useEffect: o efeito de auto-scroll mede a altura do
  // compositor. Restaurar um rascunho materializa banner de resposta, chip de
  // anexo e texto multilinha — o compositor cresce 40-90px DEPOIS da medição e a
  // conversa abriria com as últimas mensagens escondidas atrás dele.
  useLayoutEffect(() => {
    const anterior = draftKeyRef.current
    if (anterior === convKey) return
    draftKeyRef.current = convKey

    if (anterior) saveDraft(anterior, liveDraftRef.current)

    const restaurado = convKey ? getDraft(convKey) : null
    const d = restaurado ?? EMPTY_DRAFT

    setMsgText(d.text)
    setReplyingTo(d.replyingTo)
    setAttachments(d.attachments)
    setScheduleDate(d.scheduleDate)
    // A marcação de "todos" volta JUNTO com o texto que a contém. Zerá-la aqui
    // (e restaurar o texto com `@todos` escrito) fazia o aviso sair sem
    // notificar o grupo, sem nenhum sinal na tela.
    setMencionarTodos(d.mentionEveryone)
    setMencaoAtiva(null)
    setNoteTitle(d.noteTitle)
    setNoteContent(d.noteContent)
    setNoteCategory(d.noteCategory)
    setTaskTitle(d.taskTitle)
    setTaskDescription(d.taskDescription)
    setNicknameInput(d.nicknameInput)

    // `edit_whatsapp_message` é SECURITY DEFINER e não checa `deleted_at` nem o
    // destinatário: um id órfão restaurado editaria com sucesso uma mensagem já
    // apagada, reescrevendo o texto no WhatsApp do contato de forma invisível
    // aqui. Só restaura o modo edição se a mensagem ainda estiver na conversa.
    // Só restaura o modo edição com confirmação positiva. Não confirmou (mensagem
    // apagada, ou lista ainda carregando)? Cai para mensagem normal e PRESERVA o
    // texto — perder o modo edição é inofensivo, perder o que foi digitado não.
    const alvoAindaExiste =
      d.editingMessageId != null &&
      (conversation?.messages || []).some((m: any) => m.id === d.editingMessageId)
    setEditingMessageId(alvoAindaExiste ? d.editingMessageId : null)

    // A objectURL é sempre do componente; o rascunho guarda só o Blob.
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    if (d.audioBlob) {
      const url = URL.createObjectURL(d.audioBlob)
      audioUrlRef.current = url
      setAudioBlob(d.audioBlob)
      setAudioUrl(url)
    } else {
      audioUrlRef.current = null
      setAudioBlob(null)
      setAudioUrl(null)
    }

    // Nada da conversa anterior pode ficar aberto sobre a nova. Os diálogos de
    // anotação, tarefa e apelido são os mais graves: eles gravam no banco usando
    // o contato ATUAL, então salvar um deles depois de trocar de conversa
    // escrevia a anotação/tarefa no prontuário do contato errado, ou renomeava
    // quem não devia. Com os campos já zerados acima, fechar fecha o ciclo.
    setMediaView(null)
    setIsNoteOpen(false)
    setIsTaskModalOpen(false)
    setIsNicknameOpen(false)
    setIsScheduleOpen(false)
    setIsLabelsOpen(false)
    setTeamAssignOpen(false)
    setAiModalOpen(false)
    setIsPlusOpen(false)
    setIsEmojiOpen(false)

    // Depois de restaurar, o compositor tem altura nova: reancorar no fundo.
    if (restaurado) {
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el && isNearBottomRef.current) el.scrollTop = el.scrollHeight
      })
    }
  }, [convKey, conversation?.messages])

  // Ao desmontar (sair do chat, fechar a conversa no mobile), preserva o que
  // estava escrito. Sem isto, fechar e reabrir a conversa perderia o rascunho.
  useEffect(() => {
    return () => {
      saveDraft(draftKeyRef.current, liveDraftRef.current)
    }
  }, [])

  // Se a conversa mudou no meio de um envio longo (upload de até 200MB), a
  // limpeza do compositor tem que cair na conversa ORIGINAL, nunca na nova.
  const limparCompositorAposEnvio = useCallback(
    (chaveEnvio: string | null, limpar: () => void) => {
      if (convKeyRef.current === chaveEnvio) {
        limpar()
      } else {
        // O conteúdo já foi enviado: some com o rascunho da conversa de origem,
        // sem tocar no compositor da conversa que o atendente está vendo agora.
        clearDraft(chaveEnvio)
      }
    },
    [],
  )

  const goToMatch = useCallback((direction: 1 | -1) => {
    if (totalMatches === 0) return
    setMatchCursor((prev) => (prev + direction + totalMatches) % totalMatches)
  }, [totalMatches])

  const openFind = useCallback(() => {
    setIsFindOpen(true)
    requestAnimationFrame(() => findInputRef.current?.focus())
  }, [])

  const closeFind = useCallback(() => {
    setIsFindOpen(false)
    findInputRef.current?.blur()
  }, [])

  // Atalhos da busca (Ctrl+F/Cmd+F, Escape, Enter/Shift+Enter). Registrado em
  // fase de captura: ChatHub.tsx tem seu próprio handler de Escape (fecha a
  // conversa) que checa `e.defaultPrevented` — capture garante que este
  // handler roda primeiro e chama preventDefault antes daquele ser avaliado,
  // independente da ordem em que os efeitos foram montados.
  useEffect(() => {
    if (!device || !contact) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const isFindShortcut = (e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey)
      if (isFindShortcut) {
        e.preventDefault()
        openFind()
        return
      }
      if (!isFindOpen) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeFind()
        return
      }
      if (e.key === 'Enter' && document.activeElement === findInputRef.current) {
        e.preventDefault()
        goToMatch(e.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [device, contact, isFindOpen, goToMatch, openFind, closeFind])

  useEffect(() => {
    getTriggers()
      .then(setTriggers)
      .catch(() => {})
    getLabels()
      .then(setLabels)
      .catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    }
  }, [])

  const loadContactTags = async () => {
    if (device && contact) {
      try {
        const tags = await getContactTags(device.id)
        setContactTags(tags.filter((t: any) => t.remote_sender === contact))
      } catch {
        /* intentionally ignored */
      }
    }
  }

  useEffect(() => {
    loadContactTags()
  }, [device?.id, contact])

  useRealtime('message_triggers', () => {
    getTriggers()
      .then(setTriggers)
      .catch(() => {})
  })
  useRealtime('labels', () => {
    getLabels()
      .then(setLabels)
      .catch(() => {})
  })
  useRealtime('contact_tags', () => {
    loadContactTags()
  })

  const fetchAiPrompts = () => {
    if (!user) return
    setIsAiPromptsLoading(true)
    supabase
      .from('ai_assistant_prompts')
      .select('*')
      .eq('is_active', true)
      .order('created_at')
      .then(({ data }) => setAiPrompts(data || []))
      .catch(() => {})
      .finally(() => setIsAiPromptsLoading(false))
  }

  useEffect(() => {
    fetchAiPrompts()
  }, [user])

  useRealtime('ai_assistant_prompts', () => {
    fetchAiPrompts()
  })

  // Reage à assinatura conversation_assignments já mantida em ChatHub.tsx (via prop)
  // em vez de abrir um segundo canal Realtime pra mesma tabela.
  useEffect(() => {
    if (assignmentProp !== undefined) setAssignment(assignmentProp ?? null)
  }, [assignmentProp])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const convKey = `${device?.id ?? ''}:${contact ?? ''}`
    const conversationChanged = prevConvKeyRef.current !== convKey
    prevConvKeyRef.current = convKey

    if (conversationChanged) {
      // Conversa nova/trocada: sempre abre no fundo e reseta o estado "grudado".
      isNearBottomRef.current = true
      el.scrollTop = el.scrollHeight
      return
    }

    // Mesma conversa, array de mensagens mudou (poll de 25s, realtime, envio
    // otimista): só rola pro fundo se o usuário já estava perto do fundo —
    // evita jogar quem está lendo histórico de volta pro fim da conversa.
    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, device?.id, contact])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const NEAR_BOTTOM_THRESHOLD_PX = 120
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      isNearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX
    }
    handleScroll()
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [device?.id, contact])

  /**
   * Mantém a conversa colada na última mensagem enquanto a mídia carrega.
   *
   * O PROBLEMA: imagem, sticker e vídeo entram na tela com altura ZERO (não há
   * `width`/`height` nem `aspect-ratio`, e o banco não guarda dimensão) e só
   * ganham altura quando o arquivo chega. A rolagem para o fim acontece uma vez
   * só, antes disso — e crescer conteúdo **não dispara evento de scroll**, então
   * nada percebia e nada corrigia. Cada foto que aparecia empurrava a conversa
   * para baixo e a janela do atendente ficava para trás: a conversa abria no fim
   * e escorregava sozinha para o meio do histórico. Medido: 415 conversas com
   * mídia assim, mediana de 3 (≈ uma tela inteira de desvio) e p90 de 26.
   *
   * A SOLUÇÃO: observar a altura do conteúdo e reancorar a cada mudança,
   * enquanto o atendente estiver no fim. É o comportamento do WhatsApp — gruda
   * no fim por mais que a mídia cresça, e solta assim que ele rola para cima de
   * propósito (aí `isNearBottomRef` vira false e este efeito não age mais).
   *
   * Efeito colateral bom: como o desvio fica em ~0, o limiar de 120px do efeito
   * acima nunca é cruzado por crescimento — antes, o primeiro giro da roda do
   * mouse marcava "não está no fundo" e desligava até a recuperação do poll.
   */
  useEffect(() => {
    const el = scrollRef.current
    const conteudo = conteudoRef.current
    if (!el) return

    const reancorar = () => {
      if (!isNearBottomRef.current) return
      el.scrollTop = el.scrollHeight
    }

    // Gatilho 1: qualquer mudança de altura do conteúdo. Pega tudo — foto,
    // vídeo, prévia de PDF que chega, balão que quebra em mais linhas.
    let observador: ResizeObserver | null = null
    if (conteudo && typeof ResizeObserver !== 'undefined') {
      observador = new ResizeObserver(reancorar)
      observador.observe(conteudo)
    }

    // Gatilho 2: `load` de cada <img>/<video> dentro da conversa. Redundante com
    // o observador na maior parte do tempo, e de propósito: `ResizeObserver` é
    // entregue no passo de renderização e NÃO dispara enquanto a janela está
    // oculta ou minimizada — o que deixaria a conversa desancorada justamente
    // quando o atendente volta para o app depois de a mídia ter carregado.
    // `load` não borbulha, por isso a escuta é em fase de captura.
    el.addEventListener('load', reancorar, true)

    return () => {
      observador?.disconnect()
      el.removeEventListener('load', reancorar, true)
    }
  }, [device?.id, contact])

  // Busca (Ctrl+F): rola até a mensagem da ocorrência atual. Roda só quando a
  // ocorrência realmente muda (não a cada refresh de `messages`), e desliga
  // isNearBottomRef antes de rolar pra o auto-scroll-pro-fundo não "puxar" a
  // tela de volta se chegar mensagem nova logo em seguida.
  useEffect(() => {
    if (!isFindOpen || !currentOccurrence) return
    const key = `${currentOccurrence.messageId}:${currentOccurrence.start}`
    if (lastScrolledMatchKeyRef.current === key) return
    lastScrolledMatchKeyRef.current = key
    const el = messageRefs.current.get(currentOccurrence.messageId)
    if (el) {
      isNearBottomRef.current = false
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentOccurrence?.messageId, currentOccurrence?.start, isFindOpen])

  useEffect(() => {
    if (conversation && conversation.unread_count > 0 && device && contact) {
      markConversationRead(device.id, contact)
      markConversationReadGlobal(device.id, contact)
    }
  }, [contact, conversation?.unread_count, device])

  useEffect(() => {
    if (sheetOpen && device && contact) {
      getConversationViewers(device.id, contact).then(setViewers)
    }
  }, [sheetOpen, device, contact])

  useEffect(() => {
    if (!device || !contact) {
      setAssignment(null)
      setRecentViewers([])
      dismissedRef.current = false
      return
    }
    dismissedRef.current = false
    let cancelled = false

    const init = async () => {
      await Promise.all([
        markConversationRead(device.id, contact),
        markConversationReadGlobal(device.id, contact),
      ])
      if (cancelled) return
      const [asgn, viewers] = await Promise.all([
        getConversationAssignment(device.id, contact),
        getConversationRecentViewers(device.id, contact),
      ])
      if (cancelled) return
      setAssignment(asgn)
      setRecentViewers(viewers)
    }
    init()

    return () => { cancelled = true }
  }, [device?.id, contact])

  useEffect(() => {
    if (assignment && assignment.status !== 'open' && assignment.status !== 'waiting') {
      dismissedRef.current = false
    }
  }, [assignment?.status])

  useEffect(() => {
    if (contact) {
      getNotesByContact(contact).then(setContactNotes).catch(() => {})
    } else {
      setContactNotes([])
    }
  }, [contact])

  const handleSaveNote = async () => {
    if (!user || !noteContent.trim()) return
    setSavingNote(true)
    try {
      const created = await createNote({
        title: noteTitle.trim() || displayName,
        content: noteContent.trim(),
        user_id: user.id,
        contact_jid: contact || null,
        contact_name: displayName || null,
        category: noteCategory,
      })
      setContactNotes((prev) => [created, ...prev])
      setIsNoteOpen(false)
      setNoteTitle('')
      setNoteContent('')
      setNoteCategory('geral')
      toast({ title: 'Anotação salva com sucesso!' })
    } catch {
      toast({ title: 'Erro ao salvar anotação.', variant: 'destructive' })
    } finally {
      setSavingNote(false)
    }
  }

  const handleDeleteNote = async (noteId: string) => {
    try {
      await deleteNote(noteId)
      setContactNotes((prev) => prev.filter((n) => n.id !== noteId))
      toast({ title: 'Anotação removida.' })
    } catch {
      toast({ title: 'Erro ao remover anotação.', variant: 'destructive' })
    }
  }

  const handleActionTake = async () => {
    if (!device || !contact || loadingAction) return
    setLoadingAction('take')
    try {
      const { error } = await supabase.rpc('take_conversation', {
        p_device_id: device.id,
        p_remote_sender: contact,
      })
      if (error) throw error
      const asgn = await getConversationAssignment(device.id, contact)
      setAssignment(asgn)
    } catch (e: any) {
      console.error('take_conversation error:', e)
      toast({ title: 'Não foi possível pegar a conversa', description: e?.message, variant: 'destructive' })
    } finally {
      setLoadingAction(null)
    }
  }

  const handleActionWaiting = async () => {
    if (!device || !contact || loadingAction) return
    setLoadingAction('waiting')
    try {
      const { error } = await supabase.rpc('set_conversation_waiting', {
        p_device_id: device.id,
        p_remote_sender: contact,
      })
      if (error) throw error
      // Fecha a conversa (volta à lista) após marcar como aguardando
      onBack?.()
    } catch (e: any) {
      console.error('set_conversation_waiting error:', e)
      toast({ title: 'Não foi possível marcar como "não posso"', description: e?.message, variant: 'destructive' })
    } finally {
      setLoadingAction(null)
    }
  }

  const handleActionFinish = async () => {
    if (!device || !contact || loadingAction) return
    setLoadingAction('finish')
    try {
      const { error } = await supabase.rpc('finish_conversation', {
        p_device_id: device.id,
        p_remote_sender: contact,
      })
      if (error) throw error
      const asgn = await getConversationAssignment(device.id, contact)
      setAssignment(asgn)
    } catch (e: any) {
      console.error('finish_conversation error:', e)
      toast({ title: 'Não foi possível finalizar a conversa', description: e?.message, variant: 'destructive' })
    } finally {
      setLoadingAction(null)
    }
  }

  const handleActionInviteRespond = async (accept: boolean) => {
    if (!device || !contact || loadingAction) return
    setLoadingAction(accept ? 'invite_accept' : 'invite_decline')
    try {
      const { error } = await supabase.rpc('respond_conversation_invite', {
        p_device_id: device.id,
        p_remote_sender: contact,
        p_accept: accept,
      })
      if (error) throw error
      if (accept) {
        const asgn = await getConversationAssignment(device.id, contact)
        setAssignment(asgn)
      } else {
        onBack?.()
      }
    } catch (e: any) {
      console.error('respond_conversation_invite error:', e)
      toast({ title: 'Não foi possível responder ao convite', description: e?.message, variant: 'destructive' })
    } finally {
      setLoadingAction(null)
    }
  }

  const insertEmoji = (emoji: string) => {
    const textarea = msgTextareaRef.current
    if (!textarea) {
      setMsgText((prev) => prev + emoji)
      return
    }
    const start = textarea.selectionStart ?? msgText.length
    const end = textarea.selectionEnd ?? msgText.length
    const next = msgText.slice(0, start) + emoji + msgText.slice(end)
    setMsgText(next)
    requestAnimationFrame(() => {
      textarea.focus()
      const pos = start + emoji.length
      textarea.setSelectionRange(pos, pos)
    })
  }

  // Envia o título da opção escolhida numa lista interativa como uma mensagem de
  // texto normal, citando a lista original — a Evolution API não permite montar
  // uma resposta nativa de seleção (listResponseMessage é gerado pelo próprio
  // celular ao tocar na opção).
  const sendListOptionAsText = async (optionTitle: string, sourceMsg: any) => {
    if (!device || !user || !contact) return
    const signature = device?.signature || user?.signature || ''
    const displayContent = signature ? `${signature}\n\n${optionTitle}` : optionTitle
    const replySnapshot = { content: sourceMsg.content, sender_name: sourceMsg.sender_name, id: sourceMsg.id }
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const tempMsg = {
      id: tempId,
      content: displayContent,
      device_id: device.id,
      remote_sender: contact,
      sender_id: user.id,
      direction: 'outbound',
      created_at: new Date().toISOString(),
      is_read: true,
      status: 'sending',
      reply_to_id: sourceMsg.id,
      reply_to_snapshot: replySnapshot,
      attachments: [],
    }
    onOptimisticSend?.(tempMsg)
    try {
      const res: any = await sendMessage({
        content: optionTitle,
        device_id: device.id,
        sender_id: user.id,
        is_read: true,
        remote_sender: contact,
        reply_to_id: sourceMsg.id,
      })
      onOptimisticConfirm?.(tempId, res?.message)
    } catch (err) {
      onOptimisticFail?.(tempId)
      toast({
        title: err instanceof Error ? err.message : 'Erro ao enviar mensagem',
        variant: 'destructive',
      })
    }
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!msgText.trim() && attachments.length === 0 && !audioBlob) || !device || !user || !contact) return

    /**
     * Menção, calculada UMA vez para todos os caminhos de envio.
     *
     * Ficava dentro do ramo otimista de texto puro, e por isso a legenda de uma
     * foto saía sem os campos de menção: o número chegava escrito na legenda e
     * ninguém era notificado. E como a nossa própria tela resolve o nome pelo
     * texto, o balão aqui mostrava `@Fulano` destacado — quem enviou tinha
     * certeza de que tinha funcionado.
     *
     * Só em grupo. Fora dele, mesmo que o texto tenha um número com arroba, não
     * vai nada no campo de menção — é só texto.
     */
    const emGrupo = isGroupJid(contact)
    const textoParaMencao = msgText.trim()
    const mencionados = emGrupo ? extrairMencionados(textoParaMencao) : []
    // O `@todos` só notifica o grupo se a flag for junto. Reconferir o texto
    // impede que a flag sobreviva a um apagar do `@todos` antes de enviar.
    const marcarTodos = emGrupo && mencionarTodos && /@todos\b/i.test(textoParaMencao)

    // Caminho otimista (texto puro, sem edição/áudio/anexo): mostra o balão na
    // hora e limpa o input, sem esperar o round-trip RPC -> Evolution -> insert.
    if (!editingMessageId && msgText.trim() && attachments.length === 0 && !audioBlob) {
      const content = msgText.trim()
      // A mensagem otimista precisa nascer com EXATAMENTE o conteúdo que o
      // servidor grava: a RPC send_whatsapp_message prepende a assinatura como
      // `assinatura + "\n\n" + texto` (devices.signature, senão profiles.signature).
      // Replicar isso evita o balão sem assinatura que depois era substituído.
      const signature = device?.signature || user?.signature || ''
      const displayContent = signature ? `${signature}\n\n${content}` : content
      const replyId = replyingTo?.id
      const replySnapshot = replyingTo
        ? { content: replyingTo.content, sender_name: replyingTo.sender_name, id: replyingTo.id }
        : null
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const tempMsg = {
        id: tempId,
        content: displayContent,
        device_id: device.id,
        remote_sender: contact,
        sender_id: user.id,
        direction: 'outbound',
        created_at: new Date().toISOString(),
        is_read: true,
        status: 'sending',
        reply_to_id: replyId || null,
        reply_to_snapshot: replySnapshot,
        attachments: [],
      }
      // Caminho otimista limpa de forma síncrona, antes de qualquer await — aqui
      // não há janela para trocar de conversa no meio.
      setMsgText('')
      setReplyingTo(null)
      setMencaoAtiva(null)
      setMencionarTodos(false)
      onOptimisticSend?.(tempMsg)
      try {
        // Envia o texto CRU — o servidor adiciona a assinatura. A RPC retorna a
        // linha real inserida, usada para substituir a temp de forma determinística.
        const res: any = await sendMessage({
          content,
          device_id: device.id,
          sender_id: user.id,
          is_read: true,
          remote_sender: contact,
          reply_to_id: replyId,
          mentioned: mencionados,
          mentionEveryone: marcarTodos,
        })
        onOptimisticConfirm?.(tempId, res?.message)
      } catch (err) {
        onOptimisticFail?.(tempId)
        toast({
          title: err instanceof Error ? err.message : 'Erro ao enviar mensagem',
          variant: 'destructive',
        })
      }
      return
    }

    const content = msgText.trim() ? msgText.trim() : (audioBlob ? '[Áudio]' : attachments.length > 0 ? '[Anexo]' : '')
    // Conversa em que o envio começou. Os caminhos abaixo só limpam o compositor
    // DEPOIS de awaits longos (upload de até 200MB) e nada impede a troca de
    // conversa nesse meio-tempo.
    const chaveEnvio = convKey

    setIsSending(true)
    try {
      if (editingMessageId) {
        await editMessage(editingMessageId, device.id, content)
        limparCompositorAposEnvio(chaveEnvio, () => {
          setEditingMessageId(null)
          setMsgText('')
          setReplyingTo(null)
          setMencaoAtiva(null)
          setMencionarTodos(false)
        })
        toast({ title: 'Mensagem editada' })
        return
      }

      const { uploadAudio, uploadFile } = await import('@/services/storage')

      if (audioBlob) {
        const mediaUrl = await uploadAudio(audioBlob, user.id)
        await sendMessage({
          content,
          device_id: device.id,
          sender_id: user.id,
          is_read: true,
          remote_sender: contact,
          mediaUrl,
          mediaType: 'audio',
          reply_to_id: replyingTo?.id,
        })
        // Áudio não tem legenda no endpoint da Evolution: o texto digitado não
        // viaja com ele, então não existe menção para levar — só limpar.
        limparCompositorAposEnvio(chaveEnvio, () => {
          discardAudio()
          setMencaoAtiva(null)
          setMencionarTodos(false)
        })
      } else if (attachments.length > 0) {
        const uploaded: { url: string; type: string; name: string }[] = []
        for (let fi = 0; fi < attachments.length; fi++) {
          setUploadProgress(0)
          const result = await uploadFile(attachments[fi], user.id, (pct) => {
            setUploadProgress(Math.round((fi / attachments.length) * 100 + pct / attachments.length))
          })
          uploaded.push(result)
        }
        setUploadProgress(null)
        for (let i = 0; i < uploaded.length; i++) {
          const att = uploaded[i]
          // Só a PRIMEIRA mídia leva a legenda; as outras vão com rótulo. A
          // menção acompanha a legenda, então também vale só para a primeira —
          // repetir em todas notificaria a pessoa uma vez por anexo.
          const levaLegenda = i === 0 && content !== '[Anexo]'
          await sendMessage({
            content: levaLegenda ? content : `[${att.type === 'image' ? 'Imagem' : att.type === 'video' ? 'Vídeo' : 'Documento'}]`,
            device_id: device.id,
            sender_id: user.id,
            is_read: true,
            remote_sender: contact,
            mediaUrl: att.url,
            mediaType: att.type,
            mediaName: att.name,
            reply_to_id: replyingTo?.id,
            mentioned: levaLegenda ? mencionados : [],
            mentionEveryone: levaLegenda ? marcarTodos : false,
          })
        }
      } else {
        await sendMessage({
          content,
          device_id: device.id,
          sender_id: user.id,
          is_read: true,
          remote_sender: contact,
          reply_to_id: replyingTo?.id,
          mentioned: mencionados,
          mentionEveryone: marcarTodos,
        })
      }
      limparCompositorAposEnvio(chaveEnvio, () => {
        setMsgText('')
        setAttachments([])
        setReplyingTo(null)
        setMencaoAtiva(null)
        setMencionarTodos(false)
      })
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'Erro ao enviar mensagem',
        variant: 'destructive',
      })
    } finally {
      setIsSending(false)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        const url = URL.createObjectURL(blob)
        audioUrlRef.current = url
        setAudioUrl(url)
        stream.getTracks().forEach((t) => t.stop())
      }

      recorder.start()
      setIsRecording(true)
      setIsPaused(false)
      setRecordingTime(0)
      setAudioBlob(null)
      setAudioUrl(null)

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1)
      }, 1000)
    } catch {
      toast({ title: 'Erro ao acessar microfone', variant: 'destructive' })
    }
  }

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause()
      setIsPaused(true)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume()
      setIsPaused(false)
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1)
      }, 1000)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    setIsPaused(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const discardAudio = () => {
    setAudioBlob(null)
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
    setAudioUrl(null)
    setRecordingTime(0)
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (
      (!msgText.trim() && attachments.length === 0 && !audioBlob) ||
      !device ||
      !user ||
      !contact ||
      !scheduleDate
    )
      return

    const content = msgText.trim() ? msgText.trim() : (audioBlob ? '[Áudio]' : '[Anexo]')
    const chaveEnvio = convKey

    setIsScheduling(true)
    try {
      const { uploadAudio, uploadFile } = await import('@/services/storage')
      const scheduledAttachments: CreateScheduledMessageInput['attachments'] = []

      if (audioBlob) {
        const mediaUrl = await uploadAudio(audioBlob, user.id)
        scheduledAttachments.push({ url: mediaUrl, type: 'audio', name: 'audio.webm' })
      } else if (attachments.length > 0) {
        const uploaded = await Promise.all(
          attachments.map((file) => uploadFile(file, user.id)),
        )
        scheduledAttachments.push(...uploaded)
      }

      await createScheduledMessage({
        content,
        scheduled_at: new Date(scheduleDate).toISOString(),
        status: 'pending',
        device_id: device.id,
        remote_sender: contact,
        user_id: user.id,
        attachments: scheduledAttachments.length > 0 ? scheduledAttachments : null,
      })
      toast({ title: 'Mensagem agendada com sucesso' })
      limparCompositorAposEnvio(chaveEnvio, () => {
        setMsgText('')
        setAttachments([])
        discardAudio()
        setScheduleDate('')
      })
      setIsScheduleOpen(false)
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'Erro ao agendar mensagem',
        variant: 'destructive',
      })
    } finally {
      setIsScheduling(false)
    }
  }

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return
    if (attachments.length + incoming.length > 10) {
      toast({ title: 'Máximo de 10 arquivos permitidos', variant: 'destructive' })
      return
    }
    const validFiles = incoming.filter((f) => {
      if (f.size > 209715200) {
        toast({ title: `Arquivo ${f.name} excede o limite de 200MB`, variant: 'destructive' })
        return false
      }
      return true
    })
    if (validFiles.length > 0) setAttachments((prev) => [...prev, ...validFiles])
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files))
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAiAction = async (action: string, overrideText?: string) => {
    const textToUse = overrideText !== undefined ? overrideText : msgText.trim()

    if (!textToUse && action !== 'suggest_reply') {
      toast({ title: 'Por favor, digite uma mensagem primeiro.', variant: 'destructive' })
      return
    }

    setAiActionSelected(action)
    if (overrideText === undefined) {
      setAiOriginalText(textToUse)
    }

    setIsAiLoading(true)
    try {
      const context = messages.slice(-10).map((m: any) => ({
        role: m.direction === 'outbound' || m.sender_id === user?.id ? 'assistant' : 'user',
        text: m.content,
      }))

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token || ''

      const res = await fetch(`${supabaseUrl}/functions/v1/ai-message-assist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          text: textToUse,
          conversationContext: context,
        }),
      })

      if (!res.ok) throw new Error('AI assist failed')
      const aiResult = await res.json()

      setAiResult(aiResult.result)
      setAiModalOpen(true)
    } catch (err) {
      toast({
        title: 'NÃ£o foi possÃ­vel melhorar o texto agora. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsAiLoading(false)
    }
  }

  const handleSaveTask = async () => {
    if (!contactRecord?.id || !user) {
      toast({ title: 'Erro: Contato nÃ£o salvo no banco.', variant: 'destructive' })
      return
    }
    if (!taskTitle.trim()) {
      toast({ title: 'Nome da tarefa Ã© obrigatÃ³rio.', variant: 'destructive' })
      return
    }

    setIsSavingTask(true)
    try {
      await supabase.from('tasks').insert({
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        status: 'pending',
        contact_id: contactRecord.id,
        user_id: user.id,
      })
      toast({ title: 'Tarefa guardada com sucesso!' })
      setIsTaskModalOpen(false)
      setTaskTitle('')
      setTaskDescription('')
    } catch (err) {
      toast({ title: 'Erro ao guardar tarefa.', variant: 'destructive' })
    } finally {
      setIsSavingTask(false)
    }
  }

  const handleSelectTrigger = (content: string) => {
    setMsgText((prev) => (prev ? prev + '\n\n' + content : content))
    setIsPlusOpen(false)
    setSearchTrigger('')
  }

  const handleToggleLabel = async (labelId: string) => {
    if (!device || !contact) return
    try {
      await toggleContactTag(device.id, contact, labelId)
    } catch (err) {
      toast({ title: 'Erro ao alterar etiqueta', variant: 'destructive' })
    }
  }

  const contactIndex = useMemo(() => {
    return buildContactIndex(contacts || [])
  }, [contacts])

  const contactRecord = findContactByIdentifier(contact, contactIndex)
  const isGroupContact = isGroupJid(contact)

  /**
   * Troca o número por nome ao EXIBIR. O texto guardado e enviado continua com o
   * número — é ele que faz o WhatsApp notificar a pessoa. Mesma precedência do
   * resto do app: apelido > nome > número.
   */
  /**
   * A faixa da menção que está sob o cursor NESTE instante.
   *
   * Existe porque `mencaoAtiva` só é recalculado no `onChange`, e clicar com o
   * mouse dentro do texto (ou Home, ou seta) move o cursor sem disparar
   * `onChange`. Quem for inserir a menção precisa da posição real, não da que
   * estava valendo quando a pessoa parou de digitar.
   */
  const faixaDaMencaoAgora = useCallback(() => {
    const el = msgTextareaRef.current
    const cursor = el?.selectionStart ?? msgText.length
    const faixa = mencaoEmDigitacao(msgText, cursor)
    return faixa ? { ...faixa, cursor } : null
  }, [msgText])

  const resolverNomeDaMencao = useCallback(
    (telefone: string) => {
      const contato = findContactByIdentifier(telefone, contactIndex)
      return contato?.nickname || contato?.name || telefone
    },
    [contactIndex],
  )

  const displayName = resolveContactDisplayName(contact, contactIndex, {
    sender_name: conversation?.sender_name
  })

  // O mesmo diálogo de apelido serve para o contato da conversa e para um
  // participante do grupo — só muda o JID de destino. `null` significa "é o
  // contato da conversa", que é o comportamento antigo.
  const [apelidoDoJid, setApelidoDoJid] = useState<string | null>(null)

  const handleEditNickname = () => {
    setApelidoDoJid(null)
    setNicknameInput(contactRecord?.nickname || '')
    setIsNicknameOpen(true)
  }

  const handleEditNicknameParticipante = useCallback((jid: string, nomeAtual: string) => {
    setApelidoDoJid(jid)
    setNicknameInput(nomeAtual)
    setIsNicknameOpen(true)
  }, [])

  const handleSaveNickname = async () => {
    try {
      // `updateContactByJid` cria o contato se ainda não existir — é o caso comum
      // de participante de grupo que nunca conversou no privado.
      await updateContactByJid(apelidoDoJid ?? contact, { nickname: nicknameInput })
      setIsNicknameOpen(false)
      setApelidoDoJid(null)
      toast({ title: 'Apelido salvo com sucesso' })
    } catch (err) {
      toast({ title: 'Erro ao salvar apelido', variant: 'destructive' })
    }
  }

  const filteredTriggers = triggers.filter((t) =>
    t.title.toLowerCase().includes(searchTrigger.toLowerCase()),
  )

  if (!device || !contact) {
    return (
      <div className="hidden md:flex flex-col items-center justify-center h-full bg-chat-conversation/80 backdrop-blur-sm flex-1 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.04),transparent_70%)]" />
        <div className="relative z-10 flex flex-col items-center text-center px-8 max-w-sm">
          <img src={logoUrl} alt="Logo" className="h-24 w-auto mb-8 object-contain drop-shadow-lg" />
          <p className="text-chat-text/70 text-[15px] leading-relaxed">
            {device
              ? 'Selecione uma conversa para iniciar o atendimento.'
              : 'Selecione uma conversa para iniciar o atendimento.'}
          </p>
          {device && onStartConversation && (
            <Button
              onClick={onStartConversation}
              className="mt-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-6 h-10 font-medium shadow-lg shadow-primary/25 transition-all hover:scale-105 active:scale-95"
            >
              <Plus className="h-4 w-4 mr-2" />
              Adicionar nova conversa
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-transparent flex-1 relative min-w-0">
      <div className="h-[64px] border-b border-chat-border bg-chat-header shadow-chat flex items-center justify-between px-4 sm:px-5 sticky top-0 z-10 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="-ml-2 mr-1 text-chat-text/80 hover:text-chat-text flex-shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <SmartAvatar
            jid={contact}
            name={displayName}
            instanceKey={device?.instance_key}
            contactRecord={contactRecord}
            className="h-10 w-10 border border-chat-border shadow-chat flex-shrink-0 transition-transform duration-300 hover:scale-105"
            fallbackClassName="bg-chat-panel text-chat-text"
          />
          <div className="min-w-0">
            <h3 className="font-semibold text-[16px] text-chat-text tracking-tight truncate flex items-center gap-2">
              {displayName}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleEditNickname}
                className="h-6 w-6 ml-1 opacity-50 hover:opacity-100 flex-shrink-0"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </h3>
            <div className="flex items-center gap-2 mt-0.5 truncate">
              <span className="text-xs text-chat-muted font-medium truncate">
                Canal {device.name}
              </span>
              {(assignment?.status === 'taken' || assignment?.status === 'assigned') && assignment.assigned_to_name && (
                <span className="text-xs text-blue-400 truncate shrink-0">
                  · Com: {assignment.assigned_to_name}
                </span>
              )}
              {assignment?.status === 'waiting' && (
                <span className="text-xs text-amber-400 truncate shrink-0">· Aguardando atendimento</span>
              )}
              {assignment?.status === 'invited' && (
                <span className="text-xs text-blue-400 truncate shrink-0">
                  · Convite {assignment.invited_to === user?.id ? 'para você' : `p/ ${assignment.invited_to_name?.split(' ')[0] ?? '—'}`}
                </span>
              )}
              {assignment?.status === 'finished' && (
                <span className="text-xs text-gray-400 truncate shrink-0">· Finalizado</span>
              )}
              {recentViewers.length > 0 && (
                <span className="text-xs text-chat-muted/70 truncate shrink-0 flex items-center gap-0.5">
                  <Eye className="h-3 w-3" />
                  {recentViewers[0].user_name}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {BARRA_ATENDIMENTO_VISIVEL && assignment && (assignment.status === 'open' || assignment.status === 'waiting') && (
            <>
              <button
                onClick={handleActionTake}
                disabled={!!loadingAction}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 disabled:opacity-50 transition-colors"
              >
                {loadingAction === 'take' ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
                Pegar
              </button>
              <button
                onClick={() => setTeamAssignOpen(true)}
                disabled={!!loadingAction}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-gray-500/15 text-gray-300 hover:bg-gray-500/25 disabled:opacity-50 transition-colors"
              >
                <Users className="h-3 w-3" />
                Designar
              </button>
              <button
                onClick={handleActionWaiting}
                disabled={!!loadingAction}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
              >
                {loadingAction === 'waiting' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                Não posso
              </button>
              <button
                onClick={handleActionFinish}
                disabled={!!loadingAction}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-green-500/15 text-green-300 hover:bg-green-500/25 disabled:opacity-50 transition-colors"
              >
                {loadingAction === 'finish' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                Finalizar
              </button>
            </>
          )}
          {BARRA_ATENDIMENTO_VISIVEL && assignment && (assignment.status === 'taken' || assignment.status === 'assigned') && assignment.assigned_to === user?.id && (
            <>
              <button
                onClick={() => setTeamAssignOpen(true)}
                disabled={!!loadingAction}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-gray-500/15 text-gray-300 hover:bg-gray-500/25 disabled:opacity-50 transition-colors"
              >
                <Users className="h-3 w-3" />
                Designar
              </button>
              <button
                onClick={handleActionWaiting}
                disabled={!!loadingAction}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
              >
                {loadingAction === 'waiting' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                Não posso
              </button>
              <button
                onClick={handleActionFinish}
                disabled={!!loadingAction}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-green-500/15 text-green-300 hover:bg-green-500/25 disabled:opacity-50 transition-colors"
              >
                {loadingAction === 'finish' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                Finalizar
              </button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (isFindOpen ? closeFind() : openFind())}
            title="Buscar na conversa (Ctrl+F)"
            className={`rounded-full flex-shrink-0 transition-all duration-300 hover:scale-105 ${
              isFindOpen
                ? 'text-chat-text bg-chat-hover'
                : 'text-chat-text/80 hover:text-chat-text hover:bg-chat-hover'
            }`}
          >
            <Search className="h-5 w-5" />
          </Button>
          <Popover open={isLabelsOpen} onOpenChange={setIsLabelsOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-chat-text/80 hover:text-chat-text hover:bg-chat-hover rounded-full flex-shrink-0 relative transition-all duration-300 hover:scale-105"
              >
                <Tags className="h-5 w-5" />
                {contactTags.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full border border-background" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-56 p-2 bg-chat-panel border-chat-border"
            >
              <div className="mb-2 px-2 pb-2 pt-1 border-b border-chat-border text-xs font-semibold text-chat-muted">
                Etiquetas do Contato
              </div>
              {labels.length === 0 ? (
                <div className="text-xs text-center text-chat-muted p-2">
                  Nenhuma etiqueta ainda.
                </div>
              ) : (
                <div className="space-y-1">
                  {labels.map((label) => {
                    const isSelected = contactTags.some((t: any) => t.label_id === label.id)
                    return (
                      <button
                        key={label.id}
                        onClick={() => handleToggleLabel(label.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-chat-hover transition-colors"
                      >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: label.color }}
                        />
                        <span className="flex-1 text-left truncate">{label.name}</span>
                        {isSelected && <Check className="w-4 h-4 text-primary" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
          <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full text-chat-text/80 hover:text-chat-text hover:bg-chat-hover flex-shrink-0 ml-1 transition-all duration-300 hover:scale-105"
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent className="bg-chat-panel border-chat-border flex flex-col h-full p-0">
              <SheetHeader className="px-6 pt-6 pb-0 flex-shrink-0">
                <SheetTitle className="text-chat-text">Info do {isGroupContact ? 'Grupo' : 'Contato'}</SheetTitle>
              </SheetHeader>
              <div className="px-6 py-6 flex flex-col items-center border-b border-chat-border flex-shrink-0">
                <SmartAvatar
                  jid={contact}
                  name={displayName}
                  instanceKey={device?.instance_key}
                  contactRecord={contactRecord}
                  className="h-28 w-28 mb-4 border border-chat-border shadow-chat text-4xl"
                  fallbackClassName="text-3xl bg-chat-panel text-chat-text"
                />
                <h3 className="font-bold text-xl text-chat-text tracking-tight text-center">
                  {displayName}
                </h3>
                {!isGroupContact && displayName !== `+${contact}` && contact !== 'Unknown Sender' && (
                  <p className="text-chat-muted mt-1 text-sm">+{contact}</p>
                )}
                <p className="text-chat-muted mt-1 text-sm">Canal {device.name}</p>

                {contactTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-4 justify-center">
                    {contactTags.map(
                      (tag) =>
                        tag.expand?.label_id && (
                          <div
                            key={tag.id}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-chat-hover border border-chat-border text-xs"
                          >
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: tag.expand.label_id.color }}
                            />
                            {tag.expand.label_id.name}
                          </div>
                        ),
                    )}
                  </div>
                )}
              </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="px-6 py-5 space-y-3">
                  {/* Galeria: mesma posição do WhatsApp — primeiro item dos dados
                      do contato. Só monta quando aberta, para não disparar as
                      três consultas toda vez que alguém abre o painel. */}
                  <Button
                    className="w-full justify-start h-12 bg-chat-hover hover:bg-chat-hover border-chat-border text-chat-text transition-all"
                    variant="outline"
                    onClick={() => setGaleriaAberta((v) => !v)}
                  >
                    <ImageIcon className="h-4 w-4 mr-3 text-chat-muted" />
                    Mídia, links e docs
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 ml-auto text-chat-muted transition-transform',
                        galeriaAberta && 'rotate-180',
                      )}
                    />
                  </Button>
                  {galeriaAberta && device?.id && contact && (
                    <ConversationGallery
                      deviceId={device.id}
                      remoteSender={contact}
                      onAbrirMidia={abrirMidiaDaGaleria}
                    />
                  )}

                  {/* Compartilhar ESTE contato com outras conversas. Só aparece
                      quando há telefone de verdade: grupo não é cartão de contato
                      e chave @lid não é telefone. */}
                  {podeCompartilhar({ remote_jid: contact } as any) && (
                    <Button
                      className="w-full justify-start h-12 bg-chat-hover hover:bg-chat-hover border-chat-border text-chat-text transition-all"
                      variant="outline"
                      onClick={() => setCompartilharEsteAberto(true)}
                    >
                      <Share2 className="h-4 w-4 mr-3 text-chat-muted" />
                      Compartilhar contato
                    </Button>
                  )}

                  {isGroupContact && device?.id && contact && (
                    <>
                      <Button
                        className="w-full justify-start h-12 bg-chat-hover hover:bg-chat-hover border-chat-border text-chat-text transition-all"
                        variant="outline"
                        onClick={() => setMembrosAbertos((v) => !v)}
                      >
                        <Users className="h-4 w-4 mr-3 text-chat-muted" />
                        Participantes
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 ml-auto text-chat-muted transition-transform',
                            membrosAbertos && 'rotate-180',
                          )}
                        />
                      </Button>
                      {membrosAbertos && (
                        <GroupMembersPanel
                          deviceId={device.id}
                          instanceName={device.instance_key}
                          groupJid={contact}
                          contactIndex={contactIndex}
                          onEditarApelido={handleEditNicknameParticipante}
                          onAbrirConversa={(jid) => {
                            onSheetOpenChange?.(false)
                            onOpenConversationByJid?.(jid)
                          }}
                        />
                      )}
                    </>
                  )}
                  <Button
                    className="w-full justify-start h-12 bg-chat-hover hover:bg-chat-hover border-chat-border text-chat-text transition-all"
                    variant="outline"
                    onClick={() => setIsTaskModalOpen(true)}
                  >
                    <ClipboardList className="mr-3 h-5 w-5 text-blue-400" /> Guardar tarefa
                  </Button>
                  <Button
                    className="w-full justify-start h-12 bg-chat-hover hover:bg-chat-hover border-chat-border text-chat-text transition-all"
                    variant="outline"
                    onClick={() => {
                      setNoteTitle(displayName)
                      setNoteContent('')
                      setNoteCategory('geral')
                      setIsNoteOpen(true)
                    }}
                  >
                    <ContactNoteIcon className="mr-3 h-5 w-5 text-purple-400" /> Adicionar Anotação
                  </Button>

                  {contactNotes.length > 0 && (
                    <div className="pt-3 border-t border-chat-border">
                      <h4 className="text-sm font-semibold text-chat-text mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <ContactNoteIcon className="h-4 w-4 text-purple-400" />
                          Anotações
                          <span className="text-[11px] font-normal bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded-full">
                            {contactNotes.length}
                          </span>
                        </span>
                        <a
                          href="/notes"
                          className="text-[11px] text-chat-muted hover:text-blue-400 flex items-center gap-0.5 transition-colors"
                        >
                          Ver todas <ChevronRight className="h-3 w-3" />
                        </a>
                      </h4>
                      <div className="space-y-2">
                        {contactNotes.map((note) => (
                          <div
                            key={note.id}
                            className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-chat-hover border border-chat-border group transition-all duration-200"
                          >
                            <ContactNoteIcon className="h-4 w-4 text-purple-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[11px] font-medium text-chat-text truncate">{note.title}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                                  note.category === 'financeiro' ? 'bg-emerald-500/15 text-emerald-400' :
                                  note.category === 'rh' ? 'bg-blue-500/15 text-blue-400' :
                                  note.category === 'administrativo' ? 'bg-amber-500/15 text-amber-400' :
                                  'bg-chat-border text-chat-muted'
                                }`}>
                                  {note.category === 'financeiro' ? 'Fin.' :
                                   note.category === 'rh' ? 'RH' :
                                   note.category === 'administrativo' ? 'Adm.' : 'Geral'}
                                </span>
                              </div>
                              <p className="text-[12px] text-chat-muted leading-relaxed">{note.content}</p>
                              <p className="text-[10px] text-chat-muted/60 mt-1">
                                {new Date(note.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                {' '}
                                {new Date(note.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteNote(note.id)}
                              title="Marcar como concluída"
                              className="opacity-0 group-hover:opacity-100 transition-all duration-150 text-chat-muted hover:text-emerald-400 flex-shrink-0 mt-0.5 hover:scale-110"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {device && contact && (
                    <div className="pt-4 border-t border-chat-border">
                      <h4 className="text-sm font-semibold text-chat-text mb-3 flex items-center gap-2">
                        <Info className="h-4 w-4 text-chat-muted" /> Dados da conversa
                      </h4>
                      {viewers.length === 0 ? (
                        <p className="text-xs text-chat-muted">
                          Nenhum usuário visualizou esta conversa ainda.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {viewers.map((v) => (
                            <div
                              key={v.user_id}
                              className="flex items-center justify-between px-3 py-2 rounded-md bg-chat-hover border border-chat-border"
                            >
                              <span className="text-sm text-chat-text truncate">{v.user_name}</span>
                              <span className="text-[11px] text-chat-muted shrink-0 ml-2">
                                { v.last_opened_at && !isNaN(new Date(v.last_opened_at).getTime())
                                  ? format(new Date(v.last_opened_at), 'dd/MM HH:mm')
                                  : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <div
        className={`overflow-hidden flex-shrink-0 border-b border-chat-border bg-chat-header transition-all duration-300 ${
          isFindOpen ? 'max-h-16 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <MessageSearchBar
          query={findQuery}
          onQueryChange={setFindQuery}
          currentIndex={safeCursor}
          totalMatches={totalMatches}
          onNext={() => goToMatch(1)}
          onPrev={() => goToMatch(-1)}
          onClose={closeFind}
          inputRef={findInputRef}
        />
      </div>

      {/* Convite de designação pendente — só aparece pra quem foi convidado */}
      {assignment && assignment.status === 'invited' && assignment.invited_to === user?.id && (
        <div className="flex items-center justify-between px-4 py-2 bg-blue-950/20 border-b border-blue-800/20 flex-shrink-0">
          <span className="text-xs text-blue-300 font-medium truncate">
            {assignment.invited_by_name?.split(' ')[0] ?? 'Alguém'} designou essa conversa para você
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => handleActionInviteRespond(true)}
              disabled={!!loadingAction}
              className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-green-500/15 text-green-300 hover:bg-green-500/25 disabled:opacity-50 transition-colors"
            >
              {loadingAction === 'invite_accept' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Confirmar
            </button>
            <button
              onClick={() => handleActionInviteRespond(false)}
              disabled={!!loadingAction}
              className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
            >
              {loadingAction === 'invite_decline' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              Não confirmar
            </button>
          </div>
        </div>
      )}
      <div className="relative flex-1 overflow-hidden bg-chat-conversation">
        <div className="pointer-events-none absolute inset-0 z-0 chat-conversation-bg-layer" />
        <div
          className="relative z-10 h-full overflow-y-auto px-5 sm:px-10 lg:px-12 custom-scrollbar"
          ref={scrollRef}
        >
        {/* Wrapper observado pelo ResizeObserver. Precisa existir: observar o
            container de rolagem devolveria o tamanho da JANELA, que não muda
            quando uma foto carrega — é a altura do CONTEÚDO que cresce.
            `py-4 space-y-3` mora aqui porque `space-y` age nos filhos diretos. */}
        <div ref={conteudoRef} className="py-4 space-y-3">
        {messages.length === 0 && estadoConversa === 'carregando' ? (
          // Carregando: bolhas fantasma alternadas. Antes só existiam dois
          // caminhos — "tem mensagem" ou "não tem" —, então enquanto a busca
          // estava em voo o painel AFIRMAVA que a conversa não tinha mensagens.
          <div className="flex flex-col gap-3 py-4" aria-busy="true" aria-label="Carregando mensagens">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
                <div
                  className="h-14 rounded-2xl bg-chat-muted/10 animate-pulse"
                  style={{ width: `${38 + ((i * 13) % 34)}%` }}
                />
              </div>
            ))}
          </div>
        ) : messages.length === 0 && estadoConversa === 'erro' ? (
          // Falha de rede deixava o painel afirmando PARA SEMPRE que a conversa
          // estava vazia, sem retry e sem aviso.
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <MessageSquare className="h-10 w-10 text-destructive/40 mb-3" />
            <p className="text-chat-muted text-sm leading-relaxed">
              Não foi possível carregar as mensagens.
            </p>
            <p className="text-chat-muted/60 text-xs mt-1">
              Verifique a conexão e tente novamente.
            </p>
            {onRetryMessages && (
              <Button variant="outline" size="sm" className="mt-4" onClick={onRetryMessages}>
                Tentar novamente
              </Button>
            )}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <MessageSquare className="h-10 w-10 text-chat-muted/30 mb-3" />
            <p className="text-chat-muted text-sm leading-relaxed">
              Esta conversa está pronta para atendimento.
            </p>
            <p className="text-chat-muted/60 text-xs mt-1">
              As primeiras mensagens aparecerão aqui.
            </p>
          </div>
        ) : (
          messages.map((msg: any, index: number) => {
          const isMe = msg.direction === 'outbound' || msg.sender_id === user?.id
          const messageAttachments = Array.isArray(msg.attachments) ? msg.attachments : []
          const timestamp = timeFormatter.format(new Date(msg.created_at))
          const previousMsg = messages[index - 1]
          const shouldShowDateSeparator =
            !previousMsg || getDateKey(previousMsg.created_at) !== getDateKey(msg.created_at)
          const previousIsMe = previousMsg
            ? previousMsg.direction === 'outbound' || previousMsg.sender_id === user?.id
            : false
          const isGroupContactMsg = contact?.includes('@g.us') || msg.remote_sender?.includes('@g.us')
          const participantContact = msg.group_participant
            ? findContactByIdentifier(msg.group_participant, contactIndex)
            : null
          const fallbackParticipantId = msg.group_participant ? normalizeToDigits(msg.group_participant) : ''
          const thisSender = !isMe && isGroupContactMsg
            ? (msg.sender_name || participantContact?.nickname || participantContact?.name || fallbackParticipantId || 'Participante')
            : null
          const currentAuthorKey = msg.group_participant || msg.sender_name || msg.remote_sender
          const previousAuthorKey = previousMsg && !previousIsMe
            ? (previousMsg.group_participant || previousMsg.sender_name || previousMsg.remote_sender)
            : null
          const shouldShowSenderLabel = !isMe && isGroupContactMsg && !!thisSender && (
            !previousMsg ||
            previousIsMe ||
            shouldShowDateSeparator ||
            currentAuthorKey !== previousAuthorKey
          )
          const shouldShowReceivedAvatar =
            !isMe &&
            !isGroupContactMsg &&
            (
              !previousMsg ||
              previousIsMe ||
              shouldShowDateSeparator ||
              previousMsg.remote_sender !== msg.remote_sender
            )
          return (
            <React.Fragment key={msg.id}>
              {shouldShowDateSeparator && (
                // Separador DENTRO do fluxo, não `sticky`. Como `position: sticky`
                // não reserva espaço ao grudar, a pílula flutuava permanentemente
                // sobre as bolhas — cortava texto no meio ("Samu( Hoje )el - Eng.
                // IA") e, sem `pointer-events-none`, ainda engolia o clique de
                // quem tentava selecionar o que estava embaixo. Em conversa de um
                // dia só ela aparece uma vez, no topo, e some ao rolar.
                <div className="flex justify-center py-2">
                  <span className="rounded-full border border-chat-border bg-chat-panel/90 px-3 py-1 text-[12px] font-medium text-chat-muted shadow-chat backdrop-blur">
                    {getDateLabel(msg.created_at)}
                  </span>
                </div>
              )}
            <div
              ref={(el) => {
                if (el) messageRefs.current.set(msg.id, el)
                else messageRefs.current.delete(msg.id)
              }}
              className={`flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300 ${isMe ? 'items-end' : 'items-start'}`}
            >
              {shouldShowSenderLabel && (
                <div
                  className="text-[12px] leading-none font-semibold mb-1 ml-1 px-1.5 py-0.5 rounded-full bg-chat-text/10 text-chat-text/80 border border-chat-text/10 inline-flex items-center gap-1.5 select-none"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-chat-text/30 flex-shrink-0" />
                  <span>{thisSender}</span>
                </div>
              )}
              <div
                className={`flex gap-2.5 items-end w-full ${isMe ? 'justify-end' : 'justify-start'}`}
              >
              {!isMe && (
                shouldShowReceivedAvatar ? (
                  <SmartAvatar
                    jid={msg.remote_sender}
                    name={resolveContactDisplayName(msg.remote_sender, contactIndex, {
                      sender_name: msg.sender_name
                    })}
                    instanceKey={device?.instance_key}
                    contactRecord={findContactByIdentifier(msg.remote_sender, contactIndex)}
                    className="h-7 w-7 border border-chat-border shadow-sm flex-shrink-0 mb-1 hidden sm:block"
                    fallbackClassName="bg-chat-panel text-chat-muted text-xs"
                  />
                  ) : (
                    <div className="h-7 w-7 flex-shrink-0 mb-1 hidden sm:block" />
                  )
                )}
                <div
                  className={`max-w-[88%] sm:max-w-[78%] rounded-2xl px-3.5 py-2 shadow-chat-bubble relative group transition-all duration-150 ${
                    isMe
                      ? 'bg-chat-bubble-out text-chat-text rounded-br-sm border border-chat-bubble-outline'
                      : 'bg-chat-bubble-in text-chat-text rounded-bl-sm'
                  }`}
                >
                  {!msg.deleted_at && msg.reply_to_snapshot && (
                    <div className="flex items-start gap-2 mb-2 pl-2 border-l-2 border-chat-text/20">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-chat-muted/90">
                          {msg.reply_to_snapshot.sender_name || 'Mensagem original'}
                        </div>
                          <div className="text-[12px] truncate text-chat-muted/70">
                            {isTechnicalPlaceholder(msg.reply_to_snapshot.content) ? 'Voz' : msg.reply_to_snapshot.content || ''}
                          </div>
                      </div>
                    </div>
                  )}
                    {messageAttachments.length > 0 && (
                     <div className="flex flex-col gap-2 mb-2">
                       {messageAttachments.map((att: any, idx: number) => {
                          if (att && typeof att === 'object' && att.type === 'contact') {
                            return (
                              <ContactShareBubble
                                key={idx}
                                name={att.name || 'Contato'}
                                phone={att.phone || null}
                                onOpenConversation={(jid) => onOpenConversationByJid?.(jid)}
                              />
                            )
                          }
                          if (att && typeof att === 'object' && att.type === 'list') {
                            return (
                              <ListMessageBubble
                                key={idx}
                                title={att.title || ''}
                                description={att.description || ''}
                                buttonText={att.buttonText || 'Ver opções'}
                                sections={Array.isArray(att.sections) ? att.sections : []}
                                onSelectOption={(optionTitle) => sendListOptionAsText(optionTitle, msg)}
                              />
                            )
                          }
                          if (att && typeof att === 'object' && att.url) {
                            // Arquivo do servidor antigo, que não existe mais.
                            // Vem ANTES de qualquer ramo de mídia: renderizar o
                            // `<img>`/`<audio>`/documento normal dispararia uma
                            // requisição condenada e a altura mudaria depois que
                            // a conversa já tivesse rolado para o fim.
                            if (!anexoEstaVivo(att.url)) {
                              return <UnavailableAttachmentBubble key={idx} name={att.name} />
                            }
                            if (att.type === 'audio') {
                             return (
                               <div key={idx}>
                                 <AudioMessage src={att.url} isMe={isMe} msgId={msg.id} />
                               </div>
                              )
                            }
                          if (att.type === 'video') {
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setMediaView({ url: att.url, type: 'video', name: att.name })}
                                className="group relative block w-[300px] max-w-full min-h-[180px] overflow-hidden rounded-xl border border-chat-border bg-black shadow-sm"
                              >
                                {/* `min-h` fixo no contêiner, não liberado depois: o
                                    fundo é preto e `object-contain` já letterboxa,
                                    então um vídeo baixo fica com barras em vez de
                                    fazer o balão pular quando os metadados chegam. */}
                                <video
                                  src={att.url}
                                  muted
                                  preload="metadata"
                                  className="w-full max-h-[320px] object-contain pointer-events-none"
                                />
                                <span className="absolute inset-0 flex items-center justify-center">
                                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white transition-colors group-hover:bg-black/70">
                                    <Play className="h-6 w-6 translate-x-0.5" fill="currentColor" />
                                  </span>
                                </span>
                              </button>
                            )
                          }
                           if (att.type === 'image') {
                             return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setMediaView({ url: att.url, type: 'image', name: att.name })}
                                className="block max-w-[240px] overflow-hidden rounded-xl border border-chat-border hover:opacity-90 hover:scale-[1.02] transition-all duration-300 shadow-sm cursor-zoom-in"
                              >
                                <ChatImage
                                  src={att.url}
                                  alt={att.name || 'Imagem'}
                                  className="w-full h-auto object-cover pointer-events-none"
                                />
                              </button>
                             )
                           }
                          if (att.type === 'sticker') {
                            return (
                              <a
                                key={idx}
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block max-w-[160px] overflow-hidden rounded-xl hover:opacity-90 hover:scale-[1.02] transition-all duration-300"
                              >
                                <ChatImage
                                  src={att.url}
                                  alt={att.name || 'Figurinha'}
                                  className="w-full h-auto object-contain"
                                  reservaClassName="w-[160px] min-h-[120px]"
                                />
                              </a>
                            )
                          }
                          {
                            const docName = att.name || att.url
                            const hasPreview = isPdfFile(docName) || isExcelFile(docName)
                            return (
                              <DocumentBubble
                                key={idx}
                                url={att.url}
                                name={docName}
                                onOpenPreview={
                                  hasPreview
                                    ? () => setMediaView({ url: att.url, type: isPdfFile(docName) ? 'pdf' : 'excel', name: att.name })
                                    : null
                                }
                              />
                            )
                          }
                        }
                        const filename = att as string
                        const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/chat-attachments/${msg.id}/${filename}`
                        const isImage = /\.(jpeg|jpg|gif|png|webp)$/i.test(filename)
                        const isVideo = /\.(mp4|webm|mov|m4v|3gp)$/i.test(filename)
                        const isAudio = /\.(mp3|ogg|oga|m4a|aac|wav|webm)$/i.test(filename)
                        const isSticker = /\.(webp)$/i.test(filename)
                        if (isAudio) {
                          return (
                            <div key={idx}>
                              <AudioMessage src={url} isMe={isMe} msgId={msg.id} />
                            </div>
                          )
                        }
                        if (isVideo) {
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setMediaView({ url, type: 'video', name: filename })}
                              className="group relative block max-w-[300px] overflow-hidden rounded-xl border border-chat-border bg-black shadow-sm"
                            >
                              <video
                                src={url}
                                muted
                                preload="metadata"
                                className="w-full max-h-[320px] object-contain pointer-events-none"
                              />
                              <span className="absolute inset-0 flex items-center justify-center">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white transition-colors group-hover:bg-black/70">
                                  <Play className="h-6 w-6 translate-x-0.5" fill="currentColor" />
                                </span>
                              </span>
                            </button>
                          )
                        }
                        if (isImage) {
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setMediaView({ url, type: 'image', name: filename })}
                              className="block max-w-[240px] overflow-hidden rounded-xl border border-chat-border hover:opacity-90 hover:scale-[1.02] transition-all duration-300 shadow-sm cursor-zoom-in"
                            >
                              <img
                                src={url}
                                alt={filename}
                                className="w-full h-auto object-cover pointer-events-none"
                              />
                            </button>
                          )
                        }
                        if (isSticker) {
                          return (
                            <a
                              key={idx}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block max-w-[160px] overflow-hidden rounded-xl hover:opacity-90 hover:scale-[1.02] transition-all duration-300"
                            >
                              <img
                                src={url}
                                alt={filename}
                                className="w-full h-auto object-contain"
                              />
                            </a>
                          )
                        }
                        {
                          const hasPreview = isPdfFile(filename) || isExcelFile(filename)
                          return (
                            <DocumentBubble
                              key={idx}
                              url={url}
                              name={filename}
                              onOpenPreview={
                                hasPreview
                                  ? () => setMediaView({ url, type: isPdfFile(filename) ? 'pdf' : 'excel', name: filename })
                                  : null
                              }
                            />
                          )
                        }
                      })}
                    </div>
                  )}
                    {msg.deleted_at ? (
                     <div className="text-[13px] italic text-chat-muted/60">
                       [Mensagem apagada]
                     </div>
                   ) : msg.content?.trim() && !isTechnicalPlaceholder(msg.content) ? (
                     <div className="text-[15px] leading-relaxed break-words">
                        <MessageBody
                          content={msg.content}
                          isMe={isMe}
                          onOpenConversation={onOpenConversationByJid}
                          ranges={rangesByMessageId.get(msg.id) ?? EMPTY_RANGES}
                          resolveMention={resolverNomeDaMencao}
                        />
                       <span
  className={`inline-flex translate-y-[30%] items-center gap-1 whitespace-nowrap ${
    isMe ? 'float-right ml-3' : 'ml-1'
  }`}>
                         {msg.edited_at && (
                           <span className="text-[10px] text-chat-muted/60">(editado)</span>
                         )}
                         {msg.revoked_at && (
                           <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-400">
                             <Trash2 className="h-3 w-3" /> apagada
                           </span>
                         )}
                         {isMe && msg.status === 'sending' && (
                           <Clock className="h-3 w-3 text-chat-muted/60 shrink-0" />
                         )}
                         {isMe && msg.status === 'failed' && (
                           <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-400">
                             <AlertCircle className="h-3 w-3" /> falhou
                           </span>
                         )}
                         <span className="text-[10px] font-medium text-chat-muted/70">{timestamp}</span>
                         <DropdownMenu
                           open={messageMenuOpenId === msg.id}
                           onOpenChange={(open) => setMessageMenuOpenId(open ? msg.id : null)}
                         >
                           <DropdownMenuTrigger asChild>
                             <button
                               type="button"
                               onClick={(e) => e.stopPropagation()}
                               onMouseDown={(e) => e.stopPropagation()}
                               onPointerDown={(e) => e.stopPropagation()}
                               className={`text-chat-muted/50 hover:text-chat-muted transition-all duration-150 p-0.5 rounded hover:bg-chat-hover ${
                                 messageMenuOpenId === msg.id
                                   ? 'opacity-100 pointer-events-auto'
                                   : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
                               }`}
                             >
                               <MoreVertical className="h-3.5 w-3.5" />
                             </button>
                           </DropdownMenuTrigger>
                           <MessageActionsMenu
                             msg={msg}
                             isMe={isMe}
                             onReply={setReplyingTo}
                             onCopy={handleCopyMessage}
                             onEdit={handleEditMessage}
                             onDelete={setDeleteConfirmMsg}
  onForward={setEncaminhandoMsg}
  onReplyPrivately={handleReplyPrivately}
  podeResponderPrivadamente={isGroupContact && !isMe && !!msg.group_participant}
                           />
                         </DropdownMenu>
                       </span>
                     </div>
                    ) : null}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {Array.from(
                          msg.reactions.reduce((acc: Map<string, number>, r: any) => {
                            acc.set(r.emoji, (acc.get(r.emoji) || 0) + 1)
                            return acc
                          }, new Map())
                        ).map(([emoji, count]) => (
                          <span
                             key={emoji}
                              className="text-[11px] px-1 py-0.5 rounded-full border border-chat-text/10 bg-chat-text/5"
                          >
                            {emoji}{count > 1 ? String(count) : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {(msg.deleted_at || !msg.content?.trim() || isTechnicalPlaceholder(msg.content)) && (
                      <div className="mt-1.5 flex items-center justify-end gap-1">
                        {msg.edited_at && (
                          <span className="text-[10px] text-chat-muted/60">(editado)</span>
                        )}
                        {/* Mídia sem legenda cai neste ramo (o conteúdo vira um
                            rótulo técnico tipo "[Imagem]"), então o badge do ramo
                            de texto nunca aparecia para imagem/áudio/vídeo — era
                            metade da queixa. O `!msg.deleted_at` evita o sinal
                            duplicado: mensagem apagada pelo próprio operador já
                            mostra "[Mensagem apagada]" e não deve ganhar o badge
                            de revoke por cima. */}
                        {!msg.deleted_at && msg.revoked_at && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-400">
                            <Trash2 className="h-3 w-3" /> apagada
                          </span>
                        )}
                        <span className="text-[10px] font-medium text-chat-muted/70 translate-y-[1px]">
                          {timestamp}
                        </span>
                        {!msg.deleted_at && (
                          <DropdownMenu
                            open={messageMenuOpenId === msg.id}
                            onOpenChange={(open) => setMessageMenuOpenId(open ? msg.id : null)}
                          >
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                className={`text-chat-muted/50 hover:text-chat-muted transition-all duration-150 p-0.5 rounded hover:bg-chat-hover ${
                                  messageMenuOpenId === msg.id
                                    ? 'opacity-100 pointer-events-auto'
                                    : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
                                }`}
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <MessageActionsMenu
                              msg={msg}
                              isMe={isMe}
                              onReply={setReplyingTo}
                              onCopy={handleCopyMessage}
                              onEdit={handleEditMessage}
                              onDelete={setDeleteConfirmMsg}
  onForward={setEncaminhandoMsg}
  onReplyPrivately={handleReplyPrivately}
  podeResponderPrivadamente={isGroupContact && !isMe && !!msg.group_participant}
                            />
                          </DropdownMenu>
                        )}
                      </div>
                    )}
                     {!msg.deleted_at && (
                       <Popover
                         open={reactionPopoverMessageId === msg.id}
                         onOpenChange={(open) => setReactionPopoverMessageId(open ? msg.id : null)}
                       >
                         <PopoverTrigger asChild>
                           <button
                             type="button"
                             aria-label="Adicionar reação"
                             title="Adicionar reação"
                             onClick={(e) => e.stopPropagation()}
                             onMouseDown={(e) => e.stopPropagation()}
                             onPointerDown={(e) => e.stopPropagation()}
                             className={`absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-chat-border bg-chat-panel text-chat-muted shadow-chat transition-all duration-150 hover:bg-chat-hover hover:text-chat-text ${isMe ? '-left-8' : '-right-8'} ${
                               reactionPopoverMessageId === msg.id
                                 ? 'opacity-100 pointer-events-auto scale-100'
                                 : 'opacity-0 pointer-events-none scale-95 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-focus-within:scale-100'
                             }`}
                           >
                             <Smile className="h-4 w-4" />
                           </button>
                         </PopoverTrigger>
                         <PopoverContent
                           className="z-[80] w-auto rounded-full border-chat-border bg-chat-panel p-1.5 shadow-chat"
                           side="top"
                           align={isMe ? 'end' : 'start'}
                           sideOffset={6}
                           onClick={(e) => e.stopPropagation()}
                           onMouseDown={(e) => e.stopPropagation()}
                         >
                           <div className="flex gap-1">
                             {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => (
                               <button
                                 key={emoji}
                                 type="button"
                                 className="rounded-full p-1 text-lg transition-transform hover:scale-125 hover:bg-chat-hover"
                                 onClick={async (e) => {
                                   e.preventDefault()
                                   e.stopPropagation()
                                   try {
                                     await reactToMessage(msg.id, emoji, device.id, user.id)
                                     setReactionPopoverMessageId(null)
                                   } catch (err: any) {
                                     toast({ title: err.message || 'Erro ao reagir', variant: 'destructive' })
                                   }
                                 }}
                               >
                                 {emoji}
                               </button>
                             ))}
                           </div>
                         </PopoverContent>
                       </Popover>
                     )}
                 </div>
                {isMe && (
                  <div className="w-7 flex-shrink-0 hidden sm:block" />
                )}
              </div>
            </div>
          </React.Fragment>
          )
        }))}
        </div>
        </div>
      </div>

      <Dialog open={isTaskModalOpen} onOpenChange={setIsTaskModalOpen}>
        <DialogContent className="sm:max-w-[425px] bg-chat-panel border-chat-border">
          <DialogHeader>
            <DialogTitle>Nova Tarefa</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label className="text-chat-muted">Contato</Label>
              <div className="text-sm font-medium text-chat-text bg-chat-hover p-2 rounded-md border border-chat-border">
                {displayName}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="taskTitle">Nome da tarefa</Label>
              <Input
                id="taskTitle"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Ex: Enviar proposta..."
                className="bg-chat-panel border-chat-border text-chat-text placeholder:text-chat-muted"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="taskDesc">Descrição</Label>
              <textarea
                id="taskDesc"
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="Detalhes da tarefa..."
                className="flex min-h-[80px] w-full rounded-md border border-chat-border bg-chat-panel px-3 py-2 text-sm text-chat-text placeholder:text-chat-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 resize-none custom-scrollbar"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsTaskModalOpen(false)}
              className="bg-transparent border-chat-border hover:bg-chat-hover text-chat-text"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveTask}
              disabled={isSavingTask || !taskTitle.trim()}
              className="bg-blue-600 text-white hover:bg-blue-500"
            >
              {isSavingTask ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent className="sm:max-w-[440px] bg-chat-panel border-chat-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ContactNoteIcon className="h-5 w-5 text-purple-400" /> Nova Anotação
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label className="text-chat-muted">Contato</Label>
              <div className="text-sm font-medium text-chat-text bg-chat-hover p-2 rounded-md border border-chat-border">
                {displayName}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="noteTitle">Título</Label>
              <input
                id="noteTitle"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Ex: Pendência financeira, Observação..."
                className="flex h-10 w-full rounded-md border border-chat-border bg-chat-panel px-3 py-2 text-sm text-chat-text placeholder:text-chat-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="noteCategory">Categoria</Label>
              <select
                id="noteCategory"
                value={noteCategory}
                onChange={(e) => setNoteCategory(e.target.value as typeof noteCategory)}
                className="flex h-10 w-full rounded-md border border-chat-border bg-chat-panel px-3 py-2 text-sm text-chat-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                <option value="geral">Geral</option>
                <option value="financeiro">Financeiro</option>
                <option value="rh">RH</option>
                <option value="administrativo">Administrativo</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="noteContent">Anotação</Label>
              <textarea
                id="noteContent"
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Descreva a observação sobre este contato..."
                autoFocus
                className="flex min-h-[100px] w-full rounded-md border border-chat-border bg-chat-panel px-3 py-2 text-sm text-chat-text placeholder:text-chat-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 resize-none custom-scrollbar"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsNoteOpen(false)}
              className="bg-transparent border-chat-border hover:bg-chat-hover text-chat-text"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveNote}
              disabled={savingNote || !noteContent.trim()}
              className="bg-purple-600 text-white hover:bg-purple-500"
            >
              {savingNote ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Salvar Anotação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col bg-chat-composer border-t border-chat-border shadow-chat flex-shrink-0 px-4 py-3 z-10 relative">
        {(device?.signature || user?.signature) && (
          <div className="px-2 pb-2 text-[11px] text-chat-muted/75 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <Info className="h-3 w-3 text-chat-muted/35" />
              <span>
                Enviando como{' '}
                <span className="font-semibold text-chat-text/70">
                  {device?.signature || user?.signature}
                </span>
              </span>
            </div>
          </div>
        )}
        <form onSubmit={handleSend} className="flex flex-col gap-2.5 max-w-4xl mx-auto w-full">
          {uploadProgress !== null && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-xl">
              <div className="flex-1 h-1.5 rounded-full bg-blue-500/20 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <span className="text-xs text-blue-400 font-medium shrink-0">{uploadProgress}%</span>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 py-2 bg-chat-panel border border-chat-border rounded-xl">
              {attachments.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 bg-chat-hover rounded-md px-2.5 py-1.5 text-xs text-chat-text"
                >
                  {file.type.startsWith('image/') ? (
                    <ImageIcon className="h-3 w-3 opacity-70" />
                  ) : (
                    <FileIcon className="h-3 w-3 opacity-70" />
                  )}
                  <span className="truncate max-w-[120px]">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(index)}
                    className="text-chat-muted hover:text-red-400 ml-1 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {(replyingTo || editingMessageId) && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-chat-panel border border-chat-border rounded-xl">
              <div className="flex-1 min-w-0">
                {replyingTo && (
                  <>
                    <div className="text-[11px] font-semibold text-blue-400 mb-0.5">
                      Respondendo a {replyingTo.sender_name || user?.name || 'contato'}
                    </div>
                    <div className="text-[12px] text-chat-muted truncate">
                      {(replyingTo.reply_to_snapshot?.content || replyingTo.content) && isTechnicalPlaceholder(replyingTo.reply_to_snapshot?.content || replyingTo.content) ? 'Voz' : replyingTo.reply_to_snapshot?.content || replyingTo.content || ''}
                    </div>
                  </>
                )}
                {editingMessageId && (
                  <div className="text-[11px] font-semibold text-yellow-400">
                    Editando mensagem
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setReplyingTo(null); setEditingMessageId(null); if (editingMessageId) { setMsgText('') } }}
                className="text-chat-muted hover:text-chat-text transition-colors flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-3 w-full">
            <Popover open={isPlusOpen} onOpenChange={setIsPlusOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-chat-muted hover:text-blue-400 hover:bg-chat-hover h-11 w-11 rounded-full flex-shrink-0 transition-all duration-300 hover:scale-105 active:scale-95"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-64 p-2 mb-2 border-chat-border bg-chat-panel"
                align="start"
                side="top"
                sideOffset={10}
              >
                <div className="text-[11px] font-semibold text-chat-muted uppercase tracking-wider px-2 pb-1.5 pt-0.5">
                  Anexos
                </div>
                <button
                  type="button"
                  onClick={() => { mediaInputRef.current?.click(); setIsPlusOpen(false) }}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-chat-hover transition-colors text-sm text-chat-text"
                >
                  <ImageIcon className="h-4 w-4 text-chat-muted" />
                  Foto ou vídeo
                </button>
                <button
                  type="button"
                  onClick={() => { documentInputRef.current?.click(); setIsPlusOpen(false) }}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-chat-hover transition-colors text-sm text-chat-text"
                >
                  <FileIcon className="h-4 w-4 text-chat-muted" />
                  Documento
                </button>
                <button
                  type="button"
                  onClick={() => { fileInputRef.current?.click(); setIsPlusOpen(false) }}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-chat-hover transition-colors text-sm text-chat-text"
                >
                  <Paperclip className="h-4 w-4 text-chat-muted" />
                  Arquivo
                </button>
                <button
                  type="button"
                  onClick={() => { setSeletorContatoAberto(true); setIsPlusOpen(false) }}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-chat-hover transition-colors text-sm text-chat-text"
                >
                  <User className="h-4 w-4 text-chat-muted" />
                  Contato
                </button>
                <div className="border-t border-chat-border my-2" />
                <div className="text-[11px] font-semibold text-chat-muted uppercase tracking-wider px-2 pb-1.5 pt-0.5">
                  Gatilhos Rápidos
                </div>
                <div className="px-2 pb-1.5">
                  <input
                    className="w-full bg-chat-panel border border-chat-border rounded-md px-2.5 py-1.5 text-sm text-chat-text placeholder:text-chat-muted focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                    placeholder="Buscar gatilho..."
                    value={searchTrigger}
                    onChange={(e) => setSearchTrigger(e.target.value)}
                  />
                </div>
                <div className="max-h-40 overflow-y-auto space-y-0.5 px-1 pb-1">
                  {filteredTriggers.length === 0 ? (
                    <div className="p-2 text-center text-xs text-chat-muted">
                      Nenhum gatilho encontrado.
                    </div>
                  ) : (
                    filteredTriggers.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-chat-hover transition-colors text-sm"
                        onClick={() => { handleSelectTrigger(t.content) }}
                      >
                        <div className="font-medium text-chat-text/90 truncate">
                          {t.title}
                        </div>
                        <div className="text-xs text-chat-muted truncate">
                          {t.content}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
            />
            <input
              type="file"
              ref={mediaInputRef}
              onChange={handleFileSelect}
              className="hidden"
              multiple
              accept="image/*,video/*"
            />
            <input
              type="file"
              ref={documentInputRef}
              onChange={handleFileSelect}
              className="hidden"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            />
            {isRecording || audioUrl ? (
              <div className="flex-1 bg-chat-panel border border-chat-border rounded-2xl flex items-center min-h-[48px] px-4 overflow-hidden">
                {audioUrl ? (
                  <div className="flex items-center gap-3 w-full">
                    <AudioMessage
                      src={audioUrl}
                      isMe={true}
                      msgId="composer-audio-preview"
                      showDownload={false}
                      compact
                    />
                    <button
                      type="button"
                      onClick={discardAudio}
                      className="text-chat-muted hover:text-red-400 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 w-full">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                    <span className="text-sm font-mono text-foreground/80 tabular-nums">
                      {formatTime(recordingTime)}
                    </span>
                    <div className="flex-1" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={isPaused ? resumeRecording : pauseRecording}
                      className="h-8 w-8 text-chat-muted hover:text-chat-text hover:bg-chat-hover rounded-full"
                    >
                      {isPaused ? (
                        <Mic className="h-4 w-4" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-sm bg-yellow-500" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={stopRecording}
                      className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-full"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative flex-1 bg-chat-panel border border-chat-border hover:border-chat-border rounded-2xl flex items-end focus-within:ring-1 focus-within:ring-blue-400/30 focus-within:border-blue-400/30 transition-all duration-300 shadow-inner group">
                {/* Autocomplete de menção. Só em grupo: em conversa privada o
                    WhatsApp não usa menção e oferecer ali só confunde. */}
                {isGroupContact && mencaoAtiva && device?.id && (
                  <MentionAutocomplete
                    deviceId={device.id}
                    instanceName={device.instance_key}
                    groupJid={contact}
                    contactIndex={contactIndex}
                    termo={mencaoAtiva.termo}
                    onEscolher={(telefone) => {
                      // A faixa da menção é RECALCULADA do estado atual, nunca lida
                      // de `mencaoAtiva`: mover o cursor com o mouse não dispara
                      // `onChange`, então o `inicio` guardado pode estar velho — e
                      // com offset velho o recorte duplicava um trecho do texto.
                      const atual = faixaDaMencaoAgora()
                      if (!atual) {
                        setMencaoAtiva(null)
                        return
                      }
                      const { texto, cursor: novoCursor } = aplicarMencao(
                        msgText,
                        atual.inicio,
                        atual.cursor,
                        telefone,
                      )
                      setMsgText(texto)
                      setMencaoAtiva(null)
                      // Reposiciona o cursor depois do React aplicar o valor novo.
                      requestAnimationFrame(() => {
                        const el = msgTextareaRef.current
                        if (el) {
                          el.focus()
                          el.setSelectionRange(novoCursor, novoCursor)
                        }
                      })
                    }}
                    onMencionarTodos={() => {
                      const atual = faixaDaMencaoAgora()
                      if (!atual) {
                        setMencaoAtiva(null)
                        return
                      }
                      // "@todos" é só o rótulo visível; quem notifica é a flag
                      // `mentionsEveryOne` no envio.
                      const insercao = '@todos '
                      setMsgText(
                        msgText.slice(0, atual.inicio) + insercao + msgText.slice(atual.cursor),
                      )
                      setMencionarTodos(true)
                      setMencaoAtiva(null)
                      requestAnimationFrame(() => msgTextareaRef.current?.focus())
                    }}
                    onFechar={() => setMencaoAtiva(null)}
                  />
                )}
                <textarea
                  ref={msgTextareaRef}
                  className="flex-1 bg-transparent border-none min-h-[44px] max-h-[120px] px-4 py-2.5 text-[15px] text-chat-text placeholder:text-chat-muted focus-visible:outline-none resize-none leading-relaxed custom-scrollbar pt-3"
                  placeholder="Digite uma mensagem..."
                  value={msgText}
                  onChange={(e) => {
                    setMsgText(e.target.value)
                    setMencaoAtiva(
                      isGroupContact
                        ? mencaoEmDigitacao(e.target.value, e.target.selectionStart ?? 0)
                        : null,
                    )
                  }}
                  // Clique, Home e setas movem o cursor SEM disparar `onChange`.
                  // Sem isto a lista continuava aberta com o cursor longe da
                  // menção, e o Enter — capturado por ela — não enviava nada.
                  onSelect={(e) => {
                    if (!isGroupContact) return
                    const el = e.currentTarget
                    setMencaoAtiva(mencaoEmDigitacao(el.value, el.selectionStart ?? 0))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend(e)
                    }
                  }}
                  onPaste={(e) => {
                    const items = e.clipboardData?.items
                    if (!items) return
                    const imageFiles: File[] = []
                    for (let i = 0; i < items.length; i++) {
                      const item = items[i]
                      if (item.kind === 'file' && item.type.startsWith('image/')) {
                        const file = item.getAsFile()
                        if (file) imageFiles.push(file)
                      }
                    }
                    if (imageFiles.length > 0) {
                      e.preventDefault()
                      addFiles(imageFiles)
                      toast({ title: imageFiles.length > 1 ? `${imageFiles.length} imagens adicionadas` : 'Imagem adicionada' })
                    }
                  }}
                  rows={1}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={isAiLoading || !msgText.trim()}
                      title={!msgText.trim() ? 'Digite uma mensagem para usar o assistente' : undefined}
                      className="text-chat-muted hover:text-blue-400 hover:bg-transparent h-11 w-11 flex-shrink-0 transition-all duration-300 hover:scale-110 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
                    >
                      {isAiLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                      ) : (
                        <Wand2 className="h-5 w-5" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-56 bg-chat-panel border-chat-border"
                  >
                    <DropdownMenuLabel className="text-xs text-chat-muted font-semibold">
                      Assistente IA
                    </DropdownMenuLabel>
                    {isAiPromptsLoading ? (
                      <div className="p-4 flex justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-chat-muted" />
                      </div>
                    ) : aiPrompts.length === 0 ? (
                      <div className="p-2 text-xs text-chat-muted text-center">
                        Nenhum prompt disponível.
                      </div>
                    ) : (
                      aiPrompts.map((p, idx) => (
                        <React.Fragment key={p.id}>
                          {p.action_key === 'formalize' && idx > 0 && (
                            <DropdownMenuSeparator className="bg-chat-hover" />
                          )}
                          <DropdownMenuItem
                            onClick={() => handleAiAction(p.action_key)}
                            className="cursor-pointer focus:bg-accent"
                          >
                            {p.label}
                          </DropdownMenuItem>
                        </React.Fragment>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Popover open={isEmojiOpen} onOpenChange={setIsEmojiOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-chat-muted hover:text-chat-text hover:bg-transparent h-11 w-11 flex-shrink-0 transition-all duration-300 hover:scale-110 active:scale-95"
                    >
                      <Smile className="h-5 w-5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-72 p-2 bg-chat-panel border-chat-border"
                  >
                    <div className="grid grid-cols-8 gap-0.5">
                      {TOP_EMOJIS.map((emoji, idx) => (
                        <button
                          key={`${emoji}-${idx}`}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          title={emoji}
                          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-chat-hover transition-colors"
                        >
                          <img
                            src={getEmojiImageUrl(emoji)}
                            alt={emoji}
                            draggable={false}
                            className="h-5 w-5 pointer-events-none"
                            onError={(e) => {
                              const span = document.createElement('span')
                              span.textContent = emoji
                              span.className = 'text-xl leading-none'
                              e.currentTarget.replaceWith(span)
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            <Dialog open={isNicknameOpen} onOpenChange={setIsNicknameOpen}>
              <DialogContent className="sm:max-w-[425px] bg-chat-panel border-chat-border">
                <DialogHeader>
                  <DialogTitle>Editar Apelido do Contato</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="nickname">Apelido (visível apenas para você)</Label>
                    <Input
                      id="nickname"
                      value={nicknameInput}
                      onChange={(e) => setNicknameInput(e.target.value)}
                      placeholder="Ex: Cliente VIP, Fornecedor..."
                      className="bg-chat-panel border-chat-border"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleSaveNickname()
                        }
                      }}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsNicknameOpen(false)}
                    className="bg-transparent border-chat-border hover:bg-chat-hover"
                  >
                    Cancelar
                  </Button>
                  <Button onClick={handleSaveNickname}>Salvar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!msgText.trim() && attachments.length === 0 && !audioBlob}
                  className="rounded-full flex-shrink-0 h-11 w-11 bg-transparent text-chat-muted hover:text-chat-text hover:bg-chat-hover transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                >
                  <CalendarClock className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] bg-chat-panel border-chat-border">
                <DialogHeader>
                  <DialogTitle>Agendar Mensagem</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="date">Data e Hora</Label>
                    <input
                      id="date"
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-chat-border bg-chat-panel px-3 py-2 text-sm text-chat-text file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-chat-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Mensagem</Label>
                    <div className="rounded-md border border-chat-border bg-chat-panel px-3 py-2 text-sm text-chat-muted min-h-[60px] max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                      {msgText ||
                        (audioBlob
                          ? '[Áudio gravado]'
                          : attachments.length > 0
                            ? '[Apenas Anexos]'
                            : 'Nenhuma mensagem digitada...')}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Anexos</Label>
                    {audioBlob ? (
                      <div className="text-sm text-chat-muted mb-2">
                        Áudio gravado ({formatTime(recordingTime)})
                      </div>
                    ) : attachments.length > 0 ? (
                      <div className="text-sm text-chat-muted mb-2">
                        {attachments.length} arquivo(s) selecionado(s)
                      </div>
                    ) : (
                      <div className="text-sm text-chat-muted mb-2">Nenhum anexo.</div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full bg-transparent border-chat-border hover:bg-chat-hover"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip className="h-4 w-4 mr-2" />
                      Adicionar Anexo
                    </Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsScheduleOpen(false)}
                    disabled={isScheduling}
                    className="bg-transparent border-chat-border hover:bg-chat-hover"
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleSchedule}
                    disabled={isScheduling || !scheduleDate || (!msgText.trim() && attachments.length === 0 && !audioBlob)}
                  >
                    {isScheduling && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {isScheduling ? 'Agendando...' : 'Confirmar Agendamento'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {audioUrl || msgText.trim() || attachments.length > 0 ? (
              <Button
                type="submit"
                size="icon"
                disabled={isSending || (!msgText.trim() && attachments.length === 0 && !audioBlob)}
                className="rounded-full flex-shrink-0 h-11 w-11 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 hover:shadow-blue-600/50 transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:shadow-none disabled:hover:scale-100"
              >
                {isSending ? (
                  <Loader2 className="h-5 w-5 animate-spin ml-0.5" />
                ) : (
                  <Send className="h-5 w-5 ml-0.5" />
                )}
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                onClick={startRecording}
                disabled={isSending}
                className="rounded-full flex-shrink-0 h-11 w-11 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 hover:shadow-blue-600/50 transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:shadow-none disabled:hover:scale-100"
              >
                <Mic className="h-5 w-5" />
              </Button>
            )}
          </div>

          <Dialog open={aiModalOpen} onOpenChange={setAiModalOpen}>
            <DialogContent className="sm:max-w-[500px] bg-chat-panel border-chat-border">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-blue-400" /> Sugestão da IA
                </DialogTitle>
              </DialogHeader>
              <div className="py-4">
                <div className="p-4 bg-chat-panel border border-chat-border rounded-xl text-sm leading-relaxed text-chat-text min-h-[100px] max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                  {aiResult}
                </div>
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAiModalOpen(false)}
                  className="bg-transparent border-chat-border hover:bg-chat-hover sm:mr-auto"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleAiAction(aiActionSelected, aiOriginalText)}
                  disabled={isAiLoading}
                  className="bg-chat-hover hover:bg-chat-hover text-chat-text"
                >
                  {isAiLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Tentar novamente
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setMsgText(aiResult)
                    setAiModalOpen(false)
                  }}
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                >
                  Usar mensagem
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </form>

        <AlertDialog open={!!deleteConfirmMsg} onOpenChange={(open) => { if (!open) setDeleteConfirmMsg(null) }}>
          <AlertDialogContent className="bg-chat-panel border-chat-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar mensagem</AlertDialogTitle>
              <AlertDialogDescription className="text-chat-muted">
                Tem certeza que deseja apagar esta mensagem? A primeira opção remove apenas para você, a segunda remove para todos os participantes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel className="bg-transparent border-chat-border hover:bg-chat-hover text-chat-text">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border-chat-border"
                onClick={async () => {
                  if (!deleteConfirmMsg || !device || !user) return
                  const msg = deleteConfirmMsg
                  setDeleteConfirmMsg(null)
                  try {
                    await deleteMessage(msg.id, device.id, false)
                    toast({ title: 'Mensagem apagada (apenas para você)' })
                  } catch (err: any) {
                    toast({ title: err.message || 'Erro ao apagar', variant: 'destructive' })
                  }
                }}
              >
                Apagar para mim
              </AlertDialogAction>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-500 text-white"
                onClick={async () => {
                  if (!deleteConfirmMsg || !device || !user) return
                  const msg = deleteConfirmMsg
                  setDeleteConfirmMsg(null)
                  try {
                    await deleteMessage(msg.id, device.id, true)
                    toast({ title: 'Mensagem apagada para todos' })
                  } catch (err: any) {
                    toast({ title: err.message || 'Erro ao apagar', variant: 'destructive' })
                  }
                }}
              >
                Apagar para todos
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <TeamAssignDialog
          open={teamAssignOpen}
          deviceId={device.id}
          remoteSender={contact}
          onClose={() => setTeamAssignOpen(false)}
          onAssigned={() => {
            getConversationAssignment(device.id, contact).then(setAssignment)
          }}
        />
        <MediaViewer media={mediaView} onClose={() => setMediaView(null)} />
        {/* Porta 1: "+" → escolher contato(s) → envia na conversa ABERTA. */}
        <ContactPickerDialog
          aberto={seletorContatoAberto}
          onFechar={() => setSeletorContatoAberto(false)}
          contacts={contacts || []}
          instanceKey={device?.instance_key}
          destinoLabel={displayName}
          onEnviar={async (contatos) => {
            try {
              await compartilharContatos({
                deviceId: device.id,
                remoteSender: contact,
                contatos,
                senderId: user?.id,
              })
              toast({
                title: contatos.length > 1 ? `${contatos.length} contatos enviados` : 'Contato enviado',
              })
            } catch (err: any) {
              toast({
                title: 'Erro ao enviar contato',
                description: err?.message,
                variant: 'destructive',
              })
            }
          }}
        />

        {/* Porta 2: painel de info → compartilhar ESTE contato com outras conversas. */}
        <ShareThisContactDialog
          aberto={compartilharEsteAberto}
          onFechar={() => setCompartilharEsteAberto(false)}
          contatoLabel={displayName}
          conversas={conversas}
          contactIndex={contactIndex}
          instanceKey={device?.instance_key}
          onEnviarPara={async (destino) => {
            await compartilharContatos({
              deviceId: device.id,
              remoteSender: destino,
              contatos: [
                {
                  name: contactRecord?.nickname || contactRecord?.name || displayName,
                  phone: contact,
                },
              ],
              senderId: user?.id,
            })
          }}
        />

        <ForwardDialog
          aberto={!!encaminhandoMsg}
          onFechar={() => setEncaminhandoMsg(null)}
          msg={encaminhandoMsg}
          conversas={conversas}
          contacts={contacts}
          contactIndex={contactIndex}
          instanceKey={device?.instance_key}
          onEncaminhar={onForwardMessage}
        />
      </div>
    </div>
  )
}




