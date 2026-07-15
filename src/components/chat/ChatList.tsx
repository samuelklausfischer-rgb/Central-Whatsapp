import { useState, useMemo, useCallback, useDeferredValue, memo } from 'react'
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
import { format, startOfDay, differenceInCalendarDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Check, CheckCheck, BadgeCheck, Smartphone, Search, X, MessageCircle, Pin, RefreshCw } from 'lucide-react'
import { ContactNoteIcon } from '@/components/ui/ContactNoteIcon'
import { toggleResponded } from '@/services/conversation_states'
import { ConversationActionsMenu } from '@/components/chat/ConversationActionsMenu'
import { ConversationActionsContent } from '@/components/chat/ConversationActionsContent'
import ConversationFilters from '@/components/chat/ConversationFilters'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
} from '@/components/ui/context-menu'
import type { ConversationUserState } from '@/services/conversation_states'
import type { ConversationAssignment } from '@/lib/supabase/types'
import { buildContactIndex, findContactByIdentifier, resolveContactDisplayName } from '@/lib/contacts/normalize'

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
  onStateChange?: () => void
  noteJids?: Set<string>
  assignments?: Map<string, ConversationAssignment>
  currentUserId?: string
  onRefreshAll?: () => void
  isRefreshingAll?: boolean
}

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

function previewLabel(content: string | null | undefined): string {
  if (!content) return ''
  const cleaned = content.replace(/[\u0080-\u009F]/g, '')
  const labels: Record<string, string> = {
    '[Áudio]': 'Voz',
    '[Ãudio]': 'Voz',
    '[Anexo]': 'Anexo',
    '[Imagem]': 'Imagem',
    '[Vídeo]': 'Vídeo',
    '[VÃ­deo]': 'Vídeo',
    '[Música]': 'Música',
    '[Figurinha]': 'Figurinha',
    '[Mensagem de mídia]': 'Mídia',
    '[Documento]': 'Documento',
    '[Mídia]': 'Mídia',
    '[Contato]': 'Contato',
  }
  if (cleaned.startsWith('[Documento:')) return 'Documento'
  if (cleaned.startsWith('[Contato:')) return 'Contato'
  return labels[cleaned] || content
}

const ChatRow = memo(function ChatRow({
  conv,
  contact,
  convState,
  isSelected,
  selectedDevice,
  selectedDeviceId,
  resolvedLocally,
  handleResolve,
  onSelectContact,
  onOpenInfo,
  isMobile,
  onStateChange,
  contactIndex,
  hasNote,
  assignment,
  currentUserId,
}: {
  conv: any
  contact: any
  convState: ConversationUserState | undefined
  isSelected: boolean
  selectedDevice: any
  selectedDeviceId: string | null
  resolvedLocally: Set<string>
  handleResolve: (deviceId: string, remoteSender: string) => void
  onSelectContact: (id: string) => void
  onOpenInfo: (deviceId: string, remoteSender: string) => void
  isMobile: boolean
  onStateChange?: () => void
  contactIndex: Map<string, any>
  hasNote?: boolean
  assignment?: ConversationAssignment
  currentUserId?: string
}) {
  const name = resolveContactDisplayName(conv.remote_sender, contactIndex, {
    sender_name: conv.sender_name
  })
  const conversationDeviceId = selectedDeviceId || conv.lastMessage?.device_id
  const isPendingReply = conv.pendingReply && !resolvedLocally.has(`${conversationDeviceId || ''}:${conv.remote_sender}`)
  const isUnread = conv.unread_count > 0
  const unreadBadgeCount = Math.max(1, conv.unread_count)

  return (
    <ContextMenu>
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
      <SmartAvatar
        jid={conv.remote_sender}
        name={name}
        instanceKey={selectedDevice?.instance_key}
        contactRecord={contact}
        className="h-11 w-11 border border-chat-border bg-chat-sidebar"
        fallbackClassName="text-chat-muted"
      />

      <div className="min-w-0 overflow-hidden">
        <h3 className="font-medium text-chat-text truncate flex items-center gap-1.5">
          <span className="truncate">{name}</span>
          {hasNote && (
            <span title="Possui anotação">
              <ContactNoteIcon className="h-3.5 w-3.5 text-purple-400 flex-shrink-0 opacity-80" />
            </span>
          )}
        </h3>
        {assignment && assignment.status === 'finished' && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 self-start mt-0.5">
            Finalizado
          </span>
        )}
        {assignment && (assignment.status === 'taken' || assignment.status === 'assigned') && (
          assignment.assigned_to === currentUserId ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400 self-start mt-0.5">
              Atribuída a você
            </span>
          ) : (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400 self-start mt-0.5">
              Atendido: {assignment.assigned_to_name?.split(' ')[0] ?? '—'}
            </span>
          )
        )}
        {assignment && assignment.status === 'invited' && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400 self-start mt-0.5">
            {assignment.invited_to === currentUserId ? 'Convite para você' : `Convite: ${assignment.invited_to_name?.split(' ')[0] ?? '—'}`}
          </span>
        )}
        {assignment && assignment.status === 'waiting' && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400 self-start mt-0.5">
            Aguardando
          </span>
        )}
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
              isUnread ? 'text-chat-text font-medium' : 'text-chat-muted',
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
          {conv.pinned && (
            <Pin className="h-3 w-3 text-chat-muted shrink-0 fill-chat-muted/30" />
          )}
          {isUnread ? (
            <div className="h-5 min-w-5 rounded-full bg-primary flex items-center justify-center px-1.5 shrink-0">
              <span className="text-[10px] font-bold text-primary-foreground">
                {unreadBadgeCount}
              </span>
            </div>
          ) : isPendingReply ? (
            <div
              onClick={(e) => {
                e.stopPropagation()
                handleResolve(conversationDeviceId || '', conv.remote_sender)
              }}
              className="relative h-7 w-7 rounded-full bg-emerald-500 flex items-center justify-center hover:bg-emerald-600 shrink-0 cursor-pointer transition-all shadow-sm"
              title="Finalizar conversa"
            >
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-25 pointer-events-none" />
              <BadgeCheck className="h-4 w-4 text-white relative z-10" />
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
              isPendingReply={isPendingReply}
              onStateChange={onStateChange}
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
            isPendingReply={isPendingReply}
            onStateChange={onStateChange}
          />
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
})

const FILTER_LABELS: Record<string, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  last3: 'Últimos 3 dias',
  last7: 'Últimos 7 dias',
  unread: 'Não lidos',
  pinned: 'Fixados',
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-chat-active text-chat-text text-xs font-medium border border-chat-border">
      {label}
      <button onClick={onRemove} className="hover:bg-chat-hover rounded-full p-0.5 transition-colors">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

function matchesPeriod(dateStr: string | undefined | null, filter: string): boolean {
  if (!dateStr || filter === 'all') return true
  const diff = differenceInCalendarDays(new Date(), new Date(dateStr))
  switch (filter) {
    case 'today': return diff === 0
    case 'yesterday': return diff === 1
    case 'last3': return diff <= 2
    case 'last7': return diff <= 6
    default: return true
  }
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
  onStateChange,
  noteJids,
  assignments,
  currentUserId,
  onRefreshAll,
  isRefreshingAll,
}: ChatListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearch = useDeferredValue(searchQuery)
  const [activePeriodFilter, setActivePeriodFilter] = useState<'all' | 'today' | 'yesterday' | 'last3' | 'last7'>('all')
  const [activeStatusFilter, setActiveStatusFilter] = useState<'all' | 'unread' | 'pinned'>('all')
  const [showUnrespondedOnly, setShowUnrespondedOnly] = useState(false)
  const [resolvedLocally, setResolvedLocally] = useState<Set<string>>(new Set())

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (activePeriodFilter !== 'all') count++
    if (activeStatusFilter !== 'all') count++
    if (showUnrespondedOnly) count++
    if (showArchived) count++
    if (searchQuery.trim()) count++
    return count
  }, [activePeriodFilter, activeStatusFilter, showUnrespondedOnly, showArchived, searchQuery])

  const handleClearAllFilters = useCallback(() => {
    setActivePeriodFilter('all')
    setActiveStatusFilter('all')
    setShowUnrespondedOnly(false)
    if (showArchived) onToggleArchived()
    setSearchQuery('')
  }, [showArchived, onToggleArchived])

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedDeviceId),
    [devices, selectedDeviceId],
  )

  const contactIndex = useMemo(() => {
    return buildContactIndex(contacts)
  }, [contacts])

  const statesByKey = useMemo(() => {
    const map = new Map<string, ConversationUserState>()
    conversationStates.forEach((s) => {
      map.set(`${s.device_id}:${s.remote_sender}`, s)
    })
    return map
  }, [conversationStates])

  const filteredConversations = useMemo(() => {
    let filtered = conversations
    if (activePeriodFilter !== 'all') {
      filtered = filtered.filter((conv) => matchesPeriod(conv.lastMessage?.created_at, activePeriodFilter))
    }
    if (activeStatusFilter === 'unread') {
      filtered = filtered.filter((conv) => conv.unread_count > 0)
    }
    if (activeStatusFilter === 'pinned') {
      filtered = filtered.filter((conv) => conv.pinned)
    }
    if (!showArchived) {
      filtered = filtered.filter((conv) => {
        const state = selectedDeviceId ? statesByKey.get(`${selectedDeviceId}:${conv.remote_sender}`) : undefined
        return !state?.archived
      })
    }
    if (showUnrespondedOnly) {
      filtered = filtered.filter((conv) => conv.pendingReply)
    }
    if (deferredSearch.trim()) {
      const lowerQuery = deferredSearch.toLowerCase()
      filtered = filtered.filter((conv) => {
        const name = resolveContactDisplayName(conv.remote_sender, contactIndex, {
          sender_name: conv.sender_name
        })
        return name.toLowerCase().includes(lowerQuery)
      })
    }
    return filtered
  }, [deferredSearch, showUnrespondedOnly, showArchived, conversations, contactIndex, statesByKey, selectedDeviceId, activePeriodFilter, activeStatusFilter])

  const handleResolve = useCallback((deviceId: string, remoteSender: string) => {
    const key = `${deviceId}:${remoteSender}`
    setResolvedLocally((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    toggleResponded(deviceId, remoteSender)
    onStateChange?.()
  }, [onStateChange])

  const isSearching = deferredSearch !== searchQuery

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-chat-sidebar',
        isMobile ? 'w-full border-r border-chat-border' : 'w-full',
      )}
    >
      <div className="px-3.5 py-3 border-b border-chat-border flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-chat-text">Mensagens</h2>
          {onRefreshAll && (
            <button
              onClick={onRefreshAll}
              disabled={isRefreshingAll}
              className="text-chat-muted hover:text-chat-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Atualizar conversas"
            >
              <RefreshCw className={cn('h-4 w-4', isRefreshingAll && 'animate-spin')} />
            </button>
          )}
        </div>
        <Select value={selectedDeviceId ?? ''} onValueChange={onSelectDevice}>
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

        <div className="flex items-center gap-2 px-1 flex-wrap">
          <ConversationFilters
            periodFilter={activePeriodFilter}
            statusFilter={activeStatusFilter}
            showUnresponded={showUnrespondedOnly}
            showArchived={showArchived}
            onPeriodFilterChange={setActivePeriodFilter}
            onStatusFilterChange={setActiveStatusFilter}
            onUnrespondedChange={setShowUnrespondedOnly}
            onArchivedChange={(v) => { if (v !== showArchived) onToggleArchived() }}
            onClearAll={handleClearAllFilters}
            isMobile={isMobile}
            filterCount={activeFilterCount}
          />
          <button
            onClick={handleClearAllFilters}
            disabled={activeFilterCount === 0}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
              activeFilterCount > 0
                ? 'text-chat-muted border-chat-border hover:bg-chat-hover hover:text-chat-text'
                : 'text-chat-muted/40 border-transparent cursor-not-allowed',
            )}
          >
            <X className="h-3.5 w-3.5" />
            Remover
          </button>
        </div>
        {activeFilterCount > 0 && (
          <div className="flex items-center gap-1.5 px-1 flex-wrap">
            {activePeriodFilter !== 'all' && (
              <FilterChip label={FILTER_LABELS[activePeriodFilter]} onRemove={() => setActivePeriodFilter('all')} />
            )}
            {activeStatusFilter !== 'all' && (
              <FilterChip label={FILTER_LABELS[activeStatusFilter]} onRemove={() => setActiveStatusFilter('all')} />
            )}
            {showUnrespondedOnly && (
              <FilterChip label="Não respondidas" onRemove={() => setShowUnrespondedOnly(false)} />
            )}
            {showArchived && (
              <FilterChip label="Arquivadas" onRemove={() => onToggleArchived()} />
            )}
            {searchQuery.trim() && (
              <FilterChip label={`Busca: "${searchQuery}"`} onRemove={() => setSearchQuery('')} />
            )}
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className={cn('pl-2 pr-3 py-1 flex flex-col gap-0.5', isSearching && 'opacity-60 transition-opacity')}>
          {filteredConversations.map((conv) => {
            const contact = findContactByIdentifier(conv.remote_sender, contactIndex) || null
            const isSelected = selectedContact === conv.remote_sender
            const convState = selectedDeviceId
              ? statesByKey.get(`${selectedDeviceId}:${conv.remote_sender}`)
              : undefined

            return (
              <ChatRow
                key={conv.remote_sender}
                conv={conv}
                contact={contact}
                convState={convState}
                isSelected={isSelected}
                selectedDevice={selectedDevice}
                selectedDeviceId={selectedDeviceId}
                resolvedLocally={resolvedLocally}
                handleResolve={handleResolve}
                onSelectContact={onSelectContact}
                onOpenInfo={onOpenInfo}
                isMobile={isMobile}
                onStateChange={onStateChange}
                contactIndex={contactIndex}
                hasNote={noteJids ? noteJids.has(conv.remote_sender) : false}
                assignment={assignments?.get(conv.remote_sender)}
                currentUserId={currentUserId}
              />
            )
          })}
          {filteredConversations.length === 0 && deferredSearch && (
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
          {conversations.length === 0 && !deferredSearch && selectedDeviceId && (
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
          {conversations.length === 0 && !deferredSearch && !selectedDeviceId && (
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
