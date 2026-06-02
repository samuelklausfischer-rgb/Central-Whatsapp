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
import { format } from 'date-fns'
import { Check, CheckCheck, Smartphone, Search, X, MessageCircle } from 'lucide-react'
import { resolveContact } from '@/services/contacts'

export interface ChatListProps {
  devices: any[]
  selectedDeviceId: string | null
  onSelectDevice: (id: string) => void
  conversations: any[]
  contacts: any[]
  selectedContact: string | null
  onSelectContact: (id: string) => void
  isMobile: boolean
}

const isGroupJid = (jid?: string) => Boolean(jid?.includes('@g.us'))

const getConversationName = (conv: any, contact: any) => {
  if (isGroupJid(conv.remote_sender)) {
    return contact?.nickname || contact?.name || conv.remote_sender
  }

  return contact?.nickname || conv.sender_name || contact?.name || conv.remote_sender
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
}: ChatListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showUnrespondedOnly, setShowUnrespondedOnly] = useState(false)
  const [resolvedLocally, setResolvedLocally] = useState<Set<string>>(new Set())

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedDeviceId),
    [devices, selectedDeviceId],
  )

  const filteredConversations = useMemo(() => {
    let filtered = conversations
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
  }, [searchQuery, showUnrespondedOnly, conversations, contacts])

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
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 py-1 flex flex-col gap-0.5">
          {filteredConversations.map((conv) => {
            const contact = contacts.find((c) => c.remote_jid === conv.remote_sender)
            const isSelected = selectedContact === conv.remote_sender
            const name = getConversationName(conv, contact)
            const isPendingReply = conv.pendingReply && !resolvedLocally.has(conv.remote_sender)

            return (
              <button
                key={conv.remote_sender}
                onClick={() => onSelectContact(conv.remote_sender)}
                className={cn(
                  'flex items-center gap-3 px-2.5 py-2.5 rounded-md transition-colors duration-150 text-left w-full hover:bg-chat-hover',
                  isSelected ? 'bg-chat-active' : '',
                  isPendingReply ? 'border-l-2 border-chat-text/10' : '',
                )}
              >
                <SmartAvatar
                  jid={conv.remote_sender}
                  name={name}
                  instanceKey={selectedDevice?.instance_key}
                  contactRecord={contact}
                  className="h-11 w-11 border border-chat-border bg-chat-sidebar"
                  fallbackClassName="text-chat-muted"
                />

                <div className="flex-1 overflow-hidden">
                  <div className="flex justify-between items-baseline mb-1">
                    <h3 className="font-medium text-chat-text truncate pr-2">{name}</h3>
                    <span className="text-xs text-chat-muted whitespace-nowrap">
                      {format(new Date(conv.lastMessage.created_at), 'HH:mm')}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
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

                {isPendingReply ? (
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      handleResolve(conv.remote_sender)
                    }}
                    className="h-8 w-8 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center hover:bg-green-500/30 shrink-0 cursor-pointer transition-colors"
                    title="Marcar como respondido"
                  >
                    <CheckCheck className="h-4 w-4 text-green-500" />
                  </div>
                ) : null}

                {!isPendingReply && conv.unread_count > 0 && (
                  <div className="h-5 min-w-5 rounded-full bg-primary flex items-center justify-center px-1.5 shrink-0">
                    <span className="text-[10px] font-bold text-primary-foreground">
                      {conv.unread_count}
                    </span>
                  </div>
                )}
              </button>
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
