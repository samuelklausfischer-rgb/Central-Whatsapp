import {
  Reply, Forward, UserPlus, CalendarClock, X, Archive,
  Tag, MoreHorizontal, Star, StarOff, Pin,
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
import type { Fixado } from '@/services/email_fixados'

/** Cor por etiqueta — mesma paleta do `EmailPinDialog` e da `EmailList`. */
const COR_DA_ETIQUETA: Record<Fixado['etiqueta'], string> = {
  urgente: '#dc2626',
  importante: '#d97706',
  ler_depois: '#6b7280',
}

interface Props {
  email: Email
  state: EmailState | null
  /** O pin visível para este e-mail (meu ou de um colega que compartilhou) — `null` se ninguém fixou. */
  fixado: Fixado | null
  /** O pin acima é MEU? Decide o texto da dica; quem abre o diálogo sempre pode CRIAR um pin próprio, mesmo vendo o de um colega. */
  souMeuPin: boolean
  /** Nome de quem é o dono hoje (`email_states.assigned_to`) — `null` se ninguém. Só para o texto da dica do botão. */
  donoNome: string | null
  onReply: () => void
  onForward: () => void
  onClose: () => void
  onArchive: () => void
  onToggleStar: () => void
  onSetWaiting: () => void
  onFixar: () => void
  onAtribuir: () => void
}

export function EmailActionsBar({
  email,
  state,
  fixado,
  souMeuPin,
  donoNome,
  onReply,
  onForward,
  onClose,
  onArchive,
  onToggleStar,
  onSetWaiting,
  onFixar,
  onAtribuir,
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

      {/*
        Fixar. O ícone ganha a cor da etiqueta quando HÁ pin (meu ou de
        colega compartilhado) — é o mesmo ponto de cor que a lista mostra,
        para a pessoa reconhecer de relance. Clicar sempre abre o diálogo:
        se o pin que aparece aqui não é meu, o diálogo nasce vazio para eu
        criar o MEU (fixar é pessoal — ver `services/email_fixados.ts`).
      */}
      <Button
        size="sm"
        variant="outline"
        onClick={onFixar}
        className="gap-1.5"
        title={
          fixado
            ? souMeuPin
              ? 'Editar seu pin'
              : 'Fixado por um colega — clique para fixar o seu'
            : 'Fixar este e-mail'
        }
      >
        <Pin
          className="h-4 w-4"
          style={fixado ? { color: COR_DA_ETIQUETA[fixado.etiqueta], fill: COR_DA_ETIQUETA[fixado.etiqueta] } : undefined}
        />
      </Button>

      {/*
        Atribuir/grudar (item 3 da fila de 25/09/2026). Fica ao lado do Fixar,
        não dentro do menu "⋯": é uma ação tão comum quanto responder — no
        Whats do PRN Hub, "atribuir" também é botão de primeiro nível, não
        item escondido em menu.
      */}
      <Button
        size="sm"
        variant="outline"
        onClick={onAtribuir}
        className="gap-1.5"
        title={donoNome ? `Atribuído a ${donoNome} — clique para mudar` : 'Atribuir a alguém da equipe'}
      >
        <UserPlus className="h-4 w-4" />
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
