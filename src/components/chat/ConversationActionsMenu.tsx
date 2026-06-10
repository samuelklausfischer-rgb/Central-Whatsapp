import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ConversationUserState } from '@/services/conversation_states'
import { cn } from '@/lib/utils'
import { ConversationActionsContent } from './ConversationActionsContent'

interface ConversationActionsMenuProps {
  deviceId: string
  remoteSender: string
  state: ConversationUserState | undefined
  unreadCount: number
  onOpenInfo: (deviceId: string, remoteSender: string) => void
  isSelected?: boolean
  isMobile?: boolean
  isPendingReply?: boolean
  onStateChange?: () => void
}

export function ConversationActionsMenu({
  deviceId,
  remoteSender,
  state,
  unreadCount,
  onOpenInfo,
  isSelected,
  isMobile,
  isPendingReply,
  onStateChange,
}: ConversationActionsMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
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
        <ConversationActionsContent
          deviceId={deviceId}
          remoteSender={remoteSender}
          state={state}
          unreadCount={unreadCount}
          onOpenInfo={onOpenInfo}
          mode="dropdown"
          isPendingReply={isPendingReply}
          onStateChange={onStateChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
