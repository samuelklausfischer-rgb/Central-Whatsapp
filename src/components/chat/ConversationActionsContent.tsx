import { Pin, PinOff, Check, Mail, Info, Archive, ArchiveRestore } from 'lucide-react'
import { togglePin, toggleArchive, markConversationRead, markConversationUnread } from '@/services/conversation_states'
import type { ConversationUserState } from '@/services/conversation_states'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { ContextMenuSeparator } from '@/components/ui/context-menu'

interface ConversationActionsContentProps {
  deviceId: string
  remoteSender: string
  state: ConversationUserState | undefined
  unreadCount: number
  onOpenInfo: (deviceId: string, remoteSender: string) => void
  mode: 'dropdown' | 'context-menu'
}

const itemClass = 'text-chat-text hover:bg-chat-hover focus:bg-chat-hover focus:text-chat-text rounded-none px-2.5 py-1.5 text-sm cursor-pointer'
const separatorClass = 'bg-chat-border/60 mx-2 my-1'

export function ConversationActionsContent({
  deviceId,
  remoteSender,
  state,
  unreadCount,
  onOpenInfo,
  mode,
}: ConversationActionsContentProps) {
  const Item = mode === 'context-menu' ? ContextMenuItem : DropdownMenuItem
  const Separator = mode === 'context-menu' ? ContextMenuSeparator : DropdownMenuSeparator

  return (
    <>
      {state?.pinned ? (
        <Item
          className={itemClass}
          onClick={(e) => {
            e.stopPropagation()
            togglePin(deviceId, remoteSender)
          }}
        >
          <PinOff className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Desafixar
        </Item>
      ) : (
        <Item
          className={itemClass}
          onClick={(e) => {
            e.stopPropagation()
            togglePin(deviceId, remoteSender)
          }}
        >
          <Pin className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Fixar conversa
        </Item>
      )}

      {unreadCount > 0 || state?.manual_unread ? (
        <Item
          className={itemClass}
          onClick={(e) => {
            e.stopPropagation()
            markConversationRead(deviceId, remoteSender)
          }}
        >
          <Check className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Marcar lida
        </Item>
      ) : (
        <Item
          className={itemClass}
          onClick={(e) => {
            e.stopPropagation()
            markConversationUnread(deviceId, remoteSender)
          }}
        >
          <Mail className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Marcar não lida
        </Item>
      )}

      <Separator className={separatorClass} />

      <Item
        className={itemClass}
        onClick={(e) => {
          e.stopPropagation()
          onOpenInfo(deviceId, remoteSender)
        }}
      >
        <Info className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Dados
      </Item>

      <Separator className={separatorClass} />

      {state?.archived ? (
        <Item
          className={itemClass}
          onClick={(e) => {
            e.stopPropagation()
            toggleArchive(deviceId, remoteSender)
          }}
        >
          <ArchiveRestore className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Desarquivar
        </Item>
      ) : (
        <Item
          className={itemClass}
          onClick={(e) => {
            e.stopPropagation()
            toggleArchive(deviceId, remoteSender)
          }}
        >
          <Archive className="h-3.5 w-3.5 mr-2.5 text-chat-muted" /> Arquivar
        </Item>
      )}
    </>
  )
}
