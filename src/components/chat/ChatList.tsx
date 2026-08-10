import { useState, useMemo, useCallback, useDeferredValue, useSyncExternalStore, memo } from 'react'
import {
  conversationDraftKey,
  getDraft,
  subscribeDraftKeys,
  getDraftKeysSnapshot,
} from '@/stores/conversationDrafts'
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
import { Check, CheckCheck, Smartphone, Search, X, MessageCircle, Pin, RefreshCw, UserCheck, UsersRound } from 'lucide-react'
import { ContactNoteIcon } from '@/components/ui/ContactNoteIcon'
import { ConversationActionsMenu } from '@/components/chat/ConversationActionsMenu'
import { ConversationActionsContent } from '@/components/chat/ConversationActionsContent'
import ConversationFilters from '@/components/chat/ConversationFilters'
import { CreateGroupDialog } from '@/components/chat/CreateGroupDialog'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
} from '@/components/ui/context-menu'
import { useAuth } from '@/hooks/use-auth'
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
  /**
   * Aparelho ainda nunca carregado nesta sessão. Sem esta flag, `conversations`
   * vazio era indistinguível de "aparelho sem nenhuma conversa", e a tela de
   * carregamento aparecia como "Nenhuma conversa por aqui".
   */
  carregandoConversas?: boolean
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
  onSelectContact,
  onOpenInfo,
  isMobile,
  onStateChange,
  contactIndex,
  hasNote,
  assignment,
  currentUserId,
  hasDraft,
  draftPreview,
}: {
  conv: any
  contact: any
  convState: ConversationUserState | undefined
  isSelected: boolean
  selectedDevice: any
  selectedDeviceId: string | null
  onSelectContact: (id: string) => void
  onOpenInfo: (deviceId: string, remoteSender: string) => void
  isMobile: boolean
  onStateChange?: () => void
  contactIndex: Map<string, any>
  hasNote?: boolean
  assignment?: ConversationAssignment
  currentUserId?: string
  hasDraft?: boolean
  draftPreview?: string
}) {
  const name = resolveContactDisplayName(conv.remote_sender, contactIndex, {
    sender_name: conv.sender_name
  })
  const conversationDeviceId = selectedDeviceId || conv.lastMessage?.device_id
  // Sem supressão local: ela existia para o botão verde sumir na hora do clique.
  // O menu ⋮ já chama `onStateChange`, que rebusca e atualiza sozinho.
  const isPendingReply = conv.pendingReply
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
          {/* Com rascunho, o check de entrega da última mensagem enviada dá lugar
              ao aviso — é a mesma escolha do WhatsApp. */}
          {!hasDraft && conv.lastMessage.direction === 'outbound' &&
            (conv.lastMessage.is_read ? (
              <CheckCheck className="h-3 w-3 text-blue-400 shrink-0" />
            ) : (
              <Check className="h-3 w-3 text-chat-muted shrink-0" />
            ))}
          {hasDraft && (
            <span className="text-sm text-emerald-500 shrink-0">Rascunho:</span>
          )}
          <p
            className={cn(
              'text-sm truncate',
              // O destaque de não-lida é preservado mesmo com rascunho: são sinais
              // independentes, e apagar um por causa do outro esconderia mensagem
              // que ainda não foi vista.
              isUnread ? 'text-chat-text font-medium' : 'text-chat-muted',
            )}
          >
            {hasDraft ? draftPreview : previewLabel(conv.lastMessage.content)}
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
          ) : null}
          {/*
            A bolinha verde pulsante saiu daqui. Ela dizia "Finalizar conversa" no
            title mas chamava `toggleResponded` — marcar como respondida, que é
            outra coisa. A função continua a um clique de distância, no menu ⋮ ao
            lado ("Marcar como respondido").
          */}
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
  carregandoConversas = false,
}: ChatListProps) {
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearch = useDeferredValue(searchQuery)
  const [activePeriodFilter, setActivePeriodFilter] = useState<'all' | 'today' | 'yesterday' | 'last3' | 'last7'>('all')
  const [activeStatusFilter, setActiveStatusFilter] = useState<'all' | 'unread' | 'pinned'>('all')
  const [showUnrespondedOnly, setShowUnrespondedOnly] = useState(false)
  // Criar grupo é ação restrita — decisão do usuário: para quem não é admin o
  // ponto de entrada fica OCULTO (não desabilitado), então nem o estado do
  // diálogo precisa existir para o não-admin ver botão nenhum.
  const [criarGrupoAberto, setCriarGrupoAberto] = useState(false)

  /**
   * Geral = tudo do aparelho. Minhas = o que está sob minha responsabilidade.
   *
   * Deliberadamente FORA do `activeFilterCount` e do "Remover": o contador existe
   * para avisar de filtro escondido dentro do popover, e a aba está sempre à
   * vista. Entrar ali faria "Remover" pular de aba sem o usuário pedir.
   */
  const [escopoLista, setEscopoLista] = useState<'geral' | 'minhas'>('geral')

  // Conjunto de conversas com rascunho. A store só troca a referência do snapshot
  // quando o CONJUNTO muda — digitar dentro de uma conversa que já tem rascunho
  // não re-renderiza a lista inteira a cada tecla.
  const draftKeys = useSyncExternalStore(subscribeDraftKeys, getDraftKeysSnapshot)

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

  /**
   * "Minha" é a conversa que eu peguei ou que me designaram, mais convite
   * pendente para mim. O convite só nasce se alguém reativar o fluxo antigo de
   * aceite — hoje Designar atribui direto —, mas continua contando aqui para
   * não sumir da lista de quem tiver um convite antigo em aberto.
   */
  const ehMinha = useCallback(
    (remoteSender: string) => {
      if (!currentUserId) return false
      const a = assignments?.get(remoteSender)
      if (!a) return false
      if (a.status === 'finished') return false
      return a.assigned_to === currentUserId || a.invited_to === currentUserId
    },
    [assignments, currentUserId],
  )

  const totalMinhas = useMemo(
    () => conversations.filter((conv) => ehMinha(conv.remote_sender)).length,
    [conversations, ehMinha],
  )

  const filteredConversations = useMemo(() => {
    let filtered = conversations
    if (escopoLista === 'minhas') {
      filtered = filtered.filter((conv) => ehMinha(conv.remote_sender))
    }
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
  }, [deferredSearch, showUnrespondedOnly, showArchived, conversations, contactIndex, statesByKey, selectedDeviceId, activePeriodFilter, activeStatusFilter, escopoLista, ehMinha])

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
          <div className="flex items-center gap-3">
            {user?.is_admin && (
              <button
                onClick={() => setCriarGrupoAberto(true)}
                className="text-chat-muted hover:text-chat-text transition-colors"
                title="Criar grupo"
              >
                <UsersRound className="h-4 w-4" />
              </button>
            )}
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

        {/*
          Duas listas do mesmo aparelho. Fica ACIMA da busca porque troca o
          conjunto sobre o qual a busca e os filtros trabalham — o inverso
          confundiria quem procura alguém e não acha porque estava em "Minhas".
        */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-chat-panel border border-chat-border">
          {([
            { id: 'geral' as const, rotulo: 'Geral' },
            { id: 'minhas' as const, rotulo: 'Minhas' },
          ]).map((aba) => (
            <button
              key={aba.id}
              onClick={() => setEscopoLista(aba.id)}
              aria-pressed={escopoLista === aba.id}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                escopoLista === aba.id
                  ? 'bg-chat-hover text-chat-text'
                  : 'text-chat-muted hover:text-chat-text',
              )}
            >
              {aba.rotulo}
              {aba.id === 'minhas' && totalMinhas > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400">
                  {totalMinhas}
                </span>
              )}
            </button>
          ))}
        </div>

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
            const draftKey = conversationDraftKey(selectedDeviceId, conv.remote_sender)
            const hasDraft = draftKey ? draftKeys.has(draftKey) : false

            return (
              <ChatRow
                key={conv.remote_sender}
                conv={conv}
                contact={contact}
                convState={convState}
                isSelected={isSelected}
                selectedDevice={selectedDevice}
                selectedDeviceId={selectedDeviceId}
                onSelectContact={onSelectContact}
                onOpenInfo={onOpenInfo}
                isMobile={isMobile}
                onStateChange={onStateChange}
                contactIndex={contactIndex}
                hasNote={noteJids ? noteJids.has(conv.remote_sender) : false}
                assignment={assignments?.get(conv.remote_sender)}
                currentUserId={currentUserId}
                hasDraft={hasDraft}
                draftPreview={hasDraft ? getDraft(draftKey)?.text ?? '' : undefined}
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
          {/* "Minhas" vazia não é erro nem lista sem dados: é o estado normal de
              quem ainda não pegou nenhuma conversa. Sem este recado a aba parece
              quebrada no primeiro uso, quando ninguém pegou nada ainda. */}
          {escopoLista === 'minhas' && filteredConversations.length === 0 && !deferredSearch && conversations.length > 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <UserCheck className="h-8 w-8 text-chat-muted/30 mb-3" />
              <p className="text-chat-muted text-sm leading-relaxed">
                Nenhuma conversa sob sua responsabilidade.
              </p>
              <p className="text-chat-muted/60 text-xs mt-1">
                Abra uma conversa na aba Geral e toque em Pegar para ela vir para cá.
              </p>
            </div>
          )}
          {/* Carregando: linhas fantasma no lugar do estado vazio. A altura imita
              a do ChatRow para a lista não dar um salto quando os dados chegam. */}
          {conversations.length === 0 && !deferredSearch && selectedDeviceId && carregandoConversas && (
            <div className="flex flex-col gap-0.5" aria-busy="true" aria-label="Carregando conversas">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <div className="h-10 w-10 shrink-0 rounded-full bg-chat-muted/10 animate-pulse" />
                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div
                      className="h-3 rounded bg-chat-muted/10 animate-pulse"
                      style={{ width: `${55 + ((i * 7) % 30)}%` }}
                    />
                    <div
                      className="h-2.5 rounded bg-chat-muted/10 animate-pulse"
                      style={{ width: `${35 + ((i * 11) % 40)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          {conversations.length === 0 && !deferredSearch && selectedDeviceId && !carregandoConversas && (
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

      {user?.is_admin && (
        <CreateGroupDialog
          aberto={criarGrupoAberto}
          onFechar={() => setCriarGrupoAberto(false)}
          deviceId={selectedDeviceId}
          contacts={contacts}
          instanceKey={selectedDevice?.instance_key}
          onCriado={() => onRefreshAll?.()}
        />
      )}
    </div>
  )
}
