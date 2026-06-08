import { useState, useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { format, startOfDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Check, CheckCheck, Smartphone, Search, X, MessageCircle, Pin, Archive } from 'lucide-react'
import { resolveContact } from '@/services/contacts'
import { ConversationActionsMenu } from '@/components/chat/ConversationActionsMenu'
import { ConversationActionsContent } from '@/components/chat/ConversationActionsContent'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
} from '@/components/ui/context-menu'
import type { ConversationUserState } from '@/services/conversation_states'

export interface ChatListProps {
  devices: any[]
  selectedDeviceId: string | null
  onSelectDevice: (id: string) => void
  conversations: any[]
  contacts: any[]
  selectedContact: string | null
  onSelectContact: (id: string) => void
  isMobile: boolean
  conversationStates: ConversationUserState[]
  onOpenInfo: (deviceId: string, remoteSender: string) => void
  showArchived: boolean
  onToggleArchived: () => void
}

const isGroupJid = (jid?: string) => Boolean(jid?.includes('@g.us'))

function formatChatTimestamp(dateString: string | undefined | null): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return ''
  const now = new Date()
  const todayStart = startOfDay(now)
  const yesterdayStart = startOfDay(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const dateStart = startOfDay(date)

  if (dateStart.getTime() === todayStart.getTime()) {
    // Hoje: mostra apenas a hora (HH:mm)
    return format(date, 'HH:mm')
  }

  if (dateStart.getTime() === yesterdayStart.getTime()) {
    // Ontem: mostra "Ontem"
    return 'Ontem'
  }

  const diffDays = Math.floor((todayStart.getTime() - dateStart.getTime()) / (24 * 60 * 60 * 1000))

  if (diffDays <= 6) {
    // Últimos 6 dias: mostra dia da semana abreviado
    return format(date, 'EEE', { locale: ptBR })
  }

  if (date.getFullYear() === now.getFullYear()) {
    // Mesmo ano: mostra DD/MM
    return format(date, 'dd/MM')
  }

  // Ano anterior: mostra DD/MM/YY
  return format(date, 'dd/MM/yy')
}

const getConversationName = (conv: any, contact: any) => {
  if (isGroupJid(conv.remote_sender)) {
    return contact?.nickname || contact?.name || conv.remote_sender
  }

  return contact?.nickname || contact?.name || conv.sender_name || conv.remote_sender
}

function previewLabel(content: string): string {
  const cleaned = content.replace(/[\u0080-\u009F]/g, '')
  const labels: Record<string, string> = {
    '[Áudio]': 'Voz',
    '[Ãudio]': 'Voz',
    '[Anexo]': 'Anexo',
    '[Imagem]': 'Imagem',
    '[Vídeo]': 'Vídeo',
    '[Música]': 'Música',
    '[Figurinha]': 'Figurinha',
    '[Mensagem de mídia]': 'Mídia',
  }
  if (cleaned.startsWith('[Documento:')) return 'Documento'
  return labels[cleaned] || content
}

export function ChatList({
  devices,
  selectedDeviceId,
  onSelectDevice,
  conversations,
  contacts,
  selectedContact,
  onSelectContact,
  isMobile,
  conversationStates,
  onOpenInfo,
  showArchived,
  onToggleArchived,
}: ChatListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showUnrespondedOnly, setShowUnrespondedOnly] = useState(false)
  const [resolvedLocally, setResolvedLocally] = useState<Set<string>>(new Set())

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedDeviceId),
    [devices, selectedDeviceId],
  )

  const statesByKey = useMemo(() => {
    const map = new Map<string, ConversationUserState>()
    conversationStates.forEach((s) => {
      map.set(`${s.device_id}:${s.remote_sender}`, s)
    })
    return map
  }, [conversationStates])

  const filteredConversations = useMemo(() => {
    let filtered = conversations
    if (!showArchived) {
      filtered = filtered.filter((conv) => {
        const state = selectedDeviceId ? statesByKey.get(`${selectedDeviceId}:${conv.remote_sender}`) : undefined
        return !state?.archived
      })
    }
    if (showUnrespondedOnly) {
      filtered = filtered.filter((conv) => conv.pendingReply)
    }
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase()
      filtered = filtered.filter((conv) => {
        const contact = contacts.find((c) => c.remote_jid === conv.remote_sender)
        const name = getConversationName(conv, contact)
        return name.toLowerCase().includes(lowerQuery)
      })
    }
    return filtered
  }, [searchQuery, showUnrespondedOnly, showArchived, conversations, contacts, statesByKey, selectedDeviceId])

  const handleResolve = (jid: string) => {
    setResolvedLocally((prev) => new Set(prev).add(jid))
    resolveContact(jid)
  }

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-chat-sidebar',
        isMobile ? 'w-full border-r border-chat-border' : 'w-full',
      )}
    >
      <div className="px-3.5 py-3 border-b border-chat-border flex flex-col gap-3 shrink-0">
        <h2 className="text-xl font-semibold text-chat-text">Mensagens</h2>
        <Select value={selectedDeviceId || undefined} onValueChange={onSelectDevice}>
          <SelectTrigger className="w-full bg-chat-sidebar border-chat-border h-12">
            <SelectValue placeholder="Selecione um dispositivo..." />
          </SelectTrigger>
          <SelectContent>
            {devices.map((device) => (
              <SelectItem key={device.id} value={device.id} className="py-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8 bg-chat-panel">
                    <AvatarImage src={device.avatar_url} />
                    <AvatarFallback>
                      <Smartphone className="h-4 w-4 text-chat-muted" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col text-left">
                    <span className="text-sm font-medium leading-none text-chat-text">
                      {device.name}
                    </span>
                    {device.department && (
                      <span className="text-xs text-chat-muted mt-1.5">
                        {device.department}
                      </span>
                    )}
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chat-muted" />
          <Input
            placeholder="Procurar contatos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9 bg-chat-panel border-chat-border text-chat-text placeholder:text-chat-muted h-10"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-chat-muted hover:text-chat-text transition-colors"
              title="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 px-1">
          <button
            onClick={() => setShowUnrespondedOnly(!showUnrespondedOnly)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              showUnrespondedOnly
                ? 'bg-chat-active text-chat-text border border-chat-border'
                : 'text-chat-muted border border-transparent hover:bg-chat-hover',
            )}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Não respondidas
          </button>
          <button
            onClick={onToggleArchived}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              showArchived
                ? 'bg-chat-active text-chat-text border border-chat-border'
                : 'text-chat-muted border border-transparent hover:bg-chat-hover',
            )}
          >
            <Archive className="h-3.5 w-3.5" />
            Arquivadas
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="pl-2 pr-3 py-1 flex flex-col gap-0.5">
          {filteredConversations.map((conv) => {
            const contact = contacts.find((c) => c.remote_jid === conv.remote_sender)
            const isSelected = selectedContact === conv.remote_sender
            const name = getConversationName(conv, contact)
            const isPendingReply = conv.pendingReply && !resolvedLocally.has(conv.remote_sender)
            const convState = selectedDeviceId
              ? statesByKey.get(`${selectedDeviceId}:${conv.remote_sender}`)
              : undefined
            const conversationDeviceId = selectedDeviceId || conv.lastMessage?.device_id

            return (
              <ContextMenu key={conv.remote_sender}>
                <ContextMenuTrigger asChild>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectContact(conv.remote_sender)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectContact(conv.remote_sender)
                      }
                    }}
                    className={cn(
                      'group relative grid grid-cols-[auto_1fr_auto] items-center gap-2.5 px-2.5 py-2.5 rounded-md transition-colors duration-150 text-left w-full hover:bg-chat-hover cursor-pointer',
                      isSelected ? 'bg-chat-active' : '',
                      isPendingReply ? 'border-l-2 border-chat-text/10' : '',
                    )}
                  >
                {convState?.pinned && (
                  <Pin className="h-3.5 w-3.5 text-chat-muted shrink-0 fill-chat-muted/30" />
                )}
                <SmartAvatar
                  jid={conv.remote_sender}
                  name={name}
                  instanceKey={selectedDevice?.instance_key}
                  contactRecord={contact}
                  className="h-11 w-11 border border-chat-border bg-chat-sidebar"
                  fallbackClassName="text-chat-muted"
                />

                <div className="min-w-0 overflow-hidden">
                  <h3 className="font-medium text-chat-text truncate">{name}</h3>
                  <div className="flex items-center gap-1 mt-0.5">
                    {conv.lastMessage.direction === 'outbound' &&
                      (conv.lastMessage.is_read ? (
                        <CheckCheck className="h-3 w-3 text-blue-400 shrink-0" />
                      ) : (
                        <Check className="h-3 w-3 text-chat-muted shrink-0" />
                      ))}
                    <p
                      className={cn(
                        'text-sm truncate',
                        conv.unread_count > 0 ? 'text-chat-text font-medium' : 'text-chat-muted',
                      )}
                    >
                      {previewLabel(conv.lastMessage.content)}
                    </p>
                    {isPendingReply && (
                      <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shrink-0 inline-block" />
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-0.5 min-w-0 w-[72px] overflow-hidden">
                  <span className="text-[11px] text-chat-muted tabular-nums whitespace-nowrap leading-none pt-0.5">
                    {formatChatTimestamp(conv.lastMessage?.created_at)}
                  </span>
                  <div className="flex items-center justify-end gap-0.5 h-7">
                    {isPendingReply ? (
                      <div
                        onClick={(e) => {
                          e.stopPropagation()
                          handleResolve(conv.remote_sender)
                        }}
                        className="h-7 w-7 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center hover:bg-green-500/30 shrink-0 cursor-pointer transition-colors"
                        title="Marcar como respondido"
                      >
                        <CheckCheck className="h-3.5 w-3.5 text-green-500" />
                      </div>
                    ) : conv.unread_count > 0 ? (
                      <div className="h-5 min-w-5 rounded-full bg-primary flex items-center justify-center px-1.5 shrink-0">
                        <span className="text-[10px] font-bold text-primary-foreground">
                          {conv.unread_count}
                        </span>
                      </div>
                    ) : null}
                    {conversationDeviceId && (
                      <ConversationActionsMenu
                        deviceId={conversationDeviceId}
                        remoteSender={conv.remote_sender}
                        state={convState}
                        unreadCount={conv.unread_count}
                        onOpenInfo={onOpenInfo}
                        isSelected={isSelected}
                        isMobile={isMobile}
                      />
                    )}
                  </div>
                </div>
              </div>
                </ContextMenuTrigger>
                {conversationDeviceId && (
                  <ContextMenuContent className="z-[80] bg-chat-panel border-chat-border shadow-chat text-chat-text min-w-[160px] rounded-lg py-1 overflow-hidden">
                    <ConversationActionsContent
                      deviceId={conversationDeviceId}
                      remoteSender={conv.remote_sender}
                      state={convState}
                      unreadCount={conv.unread_count}
                      onOpenInfo={onOpenInfo}
                      mode="context-menu"
                    />
                  </ContextMenuContent>
                )}
              </ContextMenu>
            )
          })}
          {filteredConversations.length === 0 && searchQuery && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <Search className="h-8 w-8 text-chat-muted/30 mb-3" />
              <p className="text-chat-muted text-sm leading-relaxed">
                Não encontramos conversas com esse termo.
              </p>
              <p className="text-chat-muted/60 text-xs mt-1">
                Tente buscar por nome, número ou mensagem.
              </p>
            </div>
          )}
          {conversations.length === 0 && !searchQuery && selectedDeviceId && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <MessageCircle className="h-8 w-8 text-chat-muted/30 mb-3" />
              <p className="text-chat-muted text-sm leading-relaxed">
                Nenhuma conversa por aqui.
              </p>
              <p className="text-chat-muted/60 text-xs mt-1">
                As mensagens aparecerão automaticamente.
              </p>
            </div>
          )}
          {conversations.length === 0 && !searchQuery && !selectedDeviceId && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <Smartphone className="h-8 w-8 text-chat-muted/30 mb-3" />
              <p className="text-chat-muted text-sm leading-relaxed">
                Selecione um dispositivo para começar.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
