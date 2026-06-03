import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useState } from 'react'
import { Pin, PinOff, Check, Mail, Info, Archive, ArchiveRestore, ChevronDown } from 'lucide-react'
import { togglePin, toggleArchive, markConversationRead, markConversationUnread } from '@/services/conversation_states'
import type { ConversationUserState } from '@/services/conversation_states'
import { cn } from '@/lib/utils'
interface ConversationActionsMenuProps {
  deviceId: string
  remoteSender: string
  state: ConversationUserState | undefined
  unreadCount: number
  onOpenInfo: (deviceId: string, remoteSender: string) => void
  isSelected?: boolean
  isMobile?: boolean
}

export function ConversationActionsMenu({
  deviceId,
  remoteSender,
  state,
  unreadCount,
  onOpenInfo,
  isSelected,
  isMobile,
}: ConversationActionsMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'h-6 w-6 rounded-full flex items-center justify-center hover:bg-chat-hover shrink-0 transition-colors',
            isMobile ? 'opacity-100' : (isSelected || open) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          )}
          title="Menu da conversa"
        >
          <ChevronDown className="h-3.5 w-3.5 text-chat-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="z-[80] bg-chat-panel border-chat-border shadow-chat text-chat-text min-w-[190px]">
        {state?.pinned ? (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text"
            onClick={(e) => {
              e.stopPropagation()
              togglePin(deviceId, remoteSender)
            }}
          >
            <PinOff className="h-4 w-4 mr-2" /> Desafixar conversa
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text"
            onClick={(e) => {
              e.stopPropagation()
              togglePin(deviceId, remoteSender)
            }}
          >
            <Pin className="h-4 w-4 mr-2" /> Fixar conversa
          </DropdownMenuItem>
        )}

        {(unreadCount > 0 || state?.manual_unread) ? (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text"
            onClick={(e) => {
              e.stopPropagation()
              markConversationRead(deviceId, remoteSender)
            }}
          >
            <Check className="h-4 w-4 mr-2" /> Marcar como lida
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text"
            onClick={(e) => {
              e.stopPropagation()
              markConversationUnread(deviceId, remoteSender)
            }}
          >
            <Mail className="h-4 w-4 mr-2" /> Marcar como não lida
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator className="bg-chat-border" />

        <DropdownMenuItem
          className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text"
          onClick={(e) => {
            e.stopPropagation()
            onOpenInfo(deviceId, remoteSender)
          }}
        >
          <Info className="h-4 w-4 mr-2" /> Dados da conversa
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-chat-border" />

        {state?.archived ? (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text"
            onClick={(e) => {
              e.stopPropagation()
              toggleArchive(deviceId, remoteSender)
            }}
          >
            <ArchiveRestore className="h-4 w-4 mr-2" /> Desarquivar conversa
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text"
            onClick={(e) => {
              e.stopPropagation()
              toggleArchive(deviceId, remoteSender)
            }}
          >
            <Archive className="h-4 w-4 mr-2" /> Arquivar conversa
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
