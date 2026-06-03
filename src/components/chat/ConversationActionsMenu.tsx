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
              'h-7 w-7 rounded-full flex items-center justify-center hover:bg-chat-hover/70 shrink-0 transition-all duration-150',
              isMobile ? 'opacity-100' : (isSelected || open) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
            )}
            title="Menu da conversa"
          >
            <ChevronDown className="h-3 w-3 text-chat-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" sideOffset={2} className="z-[80] bg-chat-panel border-chat-border shadow-chat text-chat-text min-w-[160px] rounded-lg py-1 overflow-hidden origin-[var(--radix-dropdown-menu-content-transform-origin)]">
        {state?.pinned ? (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text rounded-none px-2.5 py-1.5 text-sm cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              togglePin(deviceId, remoteSender)
            }}
          >
            <PinOff className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Desafixar
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text rounded-none px-2.5 py-1.5 text-sm cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              togglePin(deviceId, remoteSender)
            }}
          >
            <Pin className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Fixar conversa
          </DropdownMenuItem>
        )}

        {(unreadCount > 0 || state?.manual_unread) ? (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text rounded-none px-2.5 py-1.5 text-sm cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              markConversationRead(deviceId, remoteSender)
            }}
          >
            <Check className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Marcar lida
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text rounded-none px-2.5 py-1.5 text-sm cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              markConversationUnread(deviceId, remoteSender)
            }}
          >
            <Mail className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Marcar não lida
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator className="bg-chat-border/60 mx-2 my-1" />

        <DropdownMenuItem
          className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text rounded-none px-2.5 py-1.5 text-sm cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            onOpenInfo(deviceId, remoteSender)
          }}
        >
          <Info className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Dados
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-chat-border/60 mx-2 my-1" />

        {state?.archived ? (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text rounded-none px-2.5 py-1.5 text-sm cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              toggleArchive(deviceId, remoteSender)
            }}
          >
            <ArchiveRestore className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Desarquivar
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text rounded-none px-2.5 py-1.5 text-sm cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              toggleArchive(deviceId, remoteSender)
            }}
          >
            <Archive className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Arquivar
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
