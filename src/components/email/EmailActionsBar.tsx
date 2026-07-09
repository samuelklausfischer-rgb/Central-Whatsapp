import {
  Reply, Forward, UserPlus, CalendarClock, X, Archive,
  Tag, MoreHorizontal, Star, StarOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Email, EmailState } from '@/lib/supabase/email-types'

interface Props {
  email: Email
  state: EmailState | null
  onReply: () => void
  onForward: () => void
  onClose: () => void
  onArchive: () => void
  onToggleStar: () => void
  onSetWaiting: () => void
}

export function EmailActionsBar({
  email,
  state,
  onReply,
  onForward,
  onClose,
  onArchive,
  onToggleStar,
  onSetWaiting,
}: Props) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Ações primárias */}
      <Button size="sm" onClick={onReply} className="gap-1.5">
        <Reply className="h-4 w-4" />
        Responder
      </Button>

      <Button size="sm" variant="outline" onClick={onForward} className="gap-1.5">
        <Forward className="h-4 w-4" />
        Encaminhar
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={onToggleStar}
        className="gap-1.5"
        title={email.is_starred ? 'Remover estrela' : 'Marcar com estrela'}
      >
        {email.is_starred ? (
          <StarOff className="h-4 w-4 text-yellow-500" />
        ) : (
          <Star className="h-4 w-4" />
        )}
      </Button>

      {/* Ações secundárias */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onSetWaiting} className="cursor-pointer">
            <CalendarClock className="mr-2 h-4 w-4" />
            Marcar como aguardando
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onArchive} className="cursor-pointer">
            <Archive className="mr-2 h-4 w-4" />
            Arquivar
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onClose}
            className="cursor-pointer text-muted-foreground"
          >
            <X className="mr-2 h-4 w-4" />
            Fechar conversa
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Status badge */}
      {state && (
        <span
          className={`ml-auto text-xs px-2 py-1 rounded-full font-medium ${
            state.status === 'open'
              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
              : state.status === 'replied'
                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                : state.status === 'waiting'
                  ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                  : 'bg-muted text-muted-foreground'
          }`}
        >
          {state.status === 'open' && 'Aberto'}
          {state.status === 'replied' && 'Respondido'}
          {state.status === 'waiting' && 'Aguardando'}
          {state.status === 'closed' && 'Fechado'}
        </span>
      )}
    </div>
  )
}
