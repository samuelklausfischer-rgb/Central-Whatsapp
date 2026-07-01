import React, { useState, useEffect, useRef, useMemo, Fragment } from 'react'
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
  CheckCircle,
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
import { AudioMessage } from '@/components/chat/AudioMessage'
import { MediaViewer, type ViewerMedia } from '@/components/chat/MediaViewer'
import { downloadFile } from '@/lib/download'
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
import { markConversationReadGlobal, getConversationViewers, getConversationAssignment, getConversationRecentViewers, type ConversationViewer, type ConversationRecentViewer } from '@/services/conversation_states'
import { buildContactIndex, resolveContactDisplayName, findContactByIdentifier, isGroupJid, normalizeToDigits } from '@/lib/contacts/normalize'
import { isPdfFile, isExcelFile } from '@/lib/file-type'
import { DocumentBubble } from '@/components/chat/DocumentBubble'
import supabase from '@/lib/supabase/client'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'

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
    ].includes(cleaned) || cleaned.startsWith('[Documento:')
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

const renderMessage = (content: string, isMe: boolean, onOpenConversation?: (jid: string) => void) => {
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

export function ChatWindow({ device, contact, conversation, contacts, onBack, isMobile, sheetOpen, onSheetOpenChange, onStartConversation, onOpenConversationByJid, onOptimisticSend, onOptimisticConfirm, onOptimisticFail }: any) {
  const { user } = useAuth()
  const { toast } = useToast()

  const [msgText, setMsgText] = useState('')
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [isSavingTask, setIsSavingTask] = useState(false)
  const [isNicknameOpen, setIsNicknameOpen] = useState(false)
  const [nicknameInput, setNicknameInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

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
  const [viewers, setViewers] = useState<ConversationViewer[]>([])
  const [assignment, setAssignment] = useState<ConversationAssignment | null>(null)
  const [recentViewers, setRecentViewers] = useState<ConversationRecentViewer[]>([])
  const [teamAssignOpen, setTeamAssignOpen] = useState(false)
  const [loadingAction, setLoadingAction] = useState<'take' | 'waiting' | 'finish' | 'invite_accept' | 'invite_decline' | null>(null)
  const dismissedRef = useRef(false)
  const [mediaView, setMediaView] = useState<ViewerMedia | null>(null)

  const messages = conversation?.messages || []

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

  useRealtime(
    'conversation_assignments',
    () => {
      if (device && contact) {
        getConversationAssignment(device.id, contact).then(setAssignment)
      }
    },
    true,
    `device_id=eq.${device?.id}`,
  )

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    if (conversation && conversation.unread_count > 0 && device && contact) {
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
      await markConversationReadGlobal(device.id, contact)
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!msgText.trim() && attachments.length === 0 && !audioBlob) || !device || !user || !contact) return

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
      setMsgText('')
      setReplyingTo(null)
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

    setIsSending(true)
    try {
      if (editingMessageId) {
        await editMessage(editingMessageId, device.id, content)
        setEditingMessageId(null)
        setMsgText('')
        setReplyingTo(null)
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
        discardAudio()
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
          await sendMessage({
            content: i === 0 && content !== '[Anexo]' ? content : `[${att.type === 'image' ? 'Imagem' : att.type === 'video' ? 'Vídeo' : 'Documento'}]`,
            device_id: device.id,
            sender_id: user.id,
            is_read: true,
            remote_sender: contact,
            mediaUrl: att.url,
            mediaType: att.type,
            mediaName: att.name,
            reply_to_id: replyingTo?.id,
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
        })
      }
      setMsgText('')
      setAttachments([])
      setReplyingTo(null)
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
      setMsgText('')
      setAttachments([])
      discardAudio()
      setIsScheduleOpen(false)
      setScheduleDate('')
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

  const displayName = resolveContactDisplayName(contact, contactIndex, {
    sender_name: conversation?.sender_name
  })

  const handleEditNickname = () => {
    setNicknameInput(contactRecord?.nickname || '')
    setIsNicknameOpen(true)
  }

  const handleSaveNickname = async () => {
    try {
      await updateContactByJid(contact, { nickname: nicknameInput })
      setIsNicknameOpen(false)
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
          {assignment && (assignment.status === 'open' || assignment.status === 'waiting') && (
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
          {assignment && (assignment.status === 'taken' || assignment.status === 'assigned') && assignment.assigned_to === user?.id && (
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
          className="relative z-10 h-full overflow-y-auto px-5 sm:px-10 lg:px-12 py-4 space-y-3 custom-scrollbar"
          ref={scrollRef}
        >
        {messages.length === 0 ? (
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
          const timestamp = new Date(msg.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
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
                <div className="sticky top-2 z-20 flex justify-center py-2">
                  <span className="rounded-full border border-chat-border bg-chat-panel/90 px-3 py-1 text-[12px] font-medium text-chat-muted shadow-chat backdrop-blur">
                    {getDateLabel(msg.created_at)}
                  </span>
                </div>
              )}
            <div
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
                          if (att && typeof att === 'object' && att.url) {
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
                                className="group relative block max-w-[300px] overflow-hidden rounded-xl border border-chat-border bg-black shadow-sm"
                              >
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
                                <img
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
                                <img
                                  src={att.url}
                                  alt={att.name || 'Figurinha'}
                                  className="w-full h-auto object-contain"
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
                        {renderMessage(msg.content, isMe, onOpenConversationByJid)}
                       <span
  className={`inline-flex translate-y-[30%] items-center gap-1 whitespace-nowrap ${
    isMe ? 'float-right ml-3' : 'ml-1'
  }`}>
                         {msg.edited_at && (
                           <span className="text-[10px] text-chat-muted/60">(editado)</span>
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
                           <DropdownMenuContent align="end" className="bg-chat-panel border-chat-border shadow-chat min-w-[170px]">
                             <DropdownMenuItem
                               className="cursor-pointer focus:bg-chat-hover"
                               onClick={(e) => {
                                 e.stopPropagation()
                                 setReplyingTo(msg)
                               }}
                             >
                               <MessageSquare className="h-4 w-4 mr-2" />
                               Responder
                             </DropdownMenuItem>
                             <DropdownMenuItem
                               className="cursor-pointer focus:bg-chat-hover"
                               onClick={async (e) => {
                                 e.stopPropagation()
                                 try {
                                   await navigator.clipboard.writeText(msg.content || '')
                                   toast({ title: 'Mensagem copiada!' })
                                 } catch {
                                   toast({ title: 'Erro ao copiar', variant: 'destructive' })
                                 }
                               }}
                             >
                               <Copy className="h-4 w-4 mr-2" />
                               Copiar
                             </DropdownMenuItem>
                             {isMe && !msg.deleted_at && (
                               <DropdownMenuItem
                                 className="cursor-pointer focus:bg-chat-hover"
                                 onClick={(e) => {
                                   e.stopPropagation()
                                   setEditingMessageId(msg.id)
                                   setMsgText(msg.content)
                                   setReplyingTo(null)
                                 }}
                               >
                                 <Pencil className="h-4 w-4 mr-2" />
                                 Editar
                               </DropdownMenuItem>
                             )}
                             <DropdownMenuSeparator className="bg-chat-border" />
                             {isMe && (
                               <DropdownMenuItem
                                 className="cursor-pointer focus:bg-chat-hover text-red-400"
                                 onClick={(e) => {
                                   e.stopPropagation()
                                   setDeleteConfirmMsg(msg)
                                 }}
                               >
                                 <Trash2 className="h-4 w-4 mr-2" />
                                 Apagar
                               </DropdownMenuItem>
                             )}
                           </DropdownMenuContent>
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
                            <DropdownMenuContent align="end" className="bg-chat-panel border-chat-border shadow-chat min-w-[170px]">
                              <DropdownMenuItem
                                className="cursor-pointer focus:bg-chat-hover"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setReplyingTo(msg)
                                }}
                              >
                                <MessageSquare className="h-4 w-4 mr-2" />
                                Responder
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="cursor-pointer focus:bg-chat-hover"
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  try {
                                    await navigator.clipboard.writeText(msg.content || '')
                                    toast({ title: 'Mensagem copiada!' })
                                  } catch {
                                    toast({ title: 'Erro ao copiar', variant: 'destructive' })
                                  }
                                }}
                              >
                                <Copy className="h-4 w-4 mr-2" />
                                Copiar
                              </DropdownMenuItem>
                              {isMe && !msg.deleted_at && (
                                <DropdownMenuItem
                                  className="cursor-pointer focus:bg-chat-hover"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setEditingMessageId(msg.id)
                                    setMsgText(msg.content)
                                    setReplyingTo(null)
                                  }}
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Editar
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator className="bg-chat-border" />
                              {isMe && (
                                <DropdownMenuItem
                                  className="cursor-pointer focus:bg-chat-hover text-red-400"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setDeleteConfirmMsg(msg)
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Apagar
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
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
              <div className="flex-1 bg-chat-panel border border-chat-border hover:border-chat-border rounded-2xl flex items-end focus-within:ring-1 focus-within:ring-blue-400/30 focus-within:border-blue-400/30 transition-all duration-300 overflow-hidden shadow-inner group">
                <textarea
                  className="flex-1 bg-transparent border-none min-h-[44px] max-h-[120px] px-4 py-2.5 text-[15px] text-chat-text placeholder:text-chat-muted focus-visible:outline-none resize-none leading-relaxed custom-scrollbar pt-3"
                  placeholder="Digite uma mensagem..."
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
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
                      disabled={isAiLoading}
                      className="text-chat-muted hover:text-blue-400 hover:bg-transparent h-11 w-11 flex-shrink-0 transition-all duration-300 hover:scale-110 active:scale-95"
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-chat-muted hover:text-chat-text hover:bg-transparent h-11 w-11 flex-shrink-0 transition-all duration-300 hover:scale-110 active:scale-95"
                >
                  <Smile className="h-5 w-5" />
                </Button>
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
      </div>
    </div>
  )
}




