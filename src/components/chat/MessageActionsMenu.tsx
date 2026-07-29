import { MessageSquare, Copy, Pencil, Trash2, Forward } from 'lucide-react'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

/**
 * Itens do menu de contexto de uma mensagem.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * Este menu existia DUPLICADO byte a byte em ChatWindow.tsx: um bloco no ramo de
 * texto e outro no ramo de mídia sem legenda / mensagem apagada. Os quatro itens
 * (Responder / Copiar / Editar / Apagar) estavam escritos duas vezes, e mídia sem
 * legenda cai justamente no segundo — então qualquer item novo adicionado em só
 * um dos blocos simplesmente não existiria para metade das mensagens.
 *
 * Com a extração, adicionar uma ação passa a ser uma mudança em um lugar só.
 *
 * Esta primeira versão é uma extração FIEL: mesmos itens, mesmas condições,
 * mesmas classes. Nenhum comportamento novo — para que a troca possa ser
 * verificada isoladamente antes de qualquer funcionalidade entrar.
 */
export interface MessageActionsMenuProps {
  msg: any
  /** A mensagem é do próprio atendente (habilita Editar e Apagar). */
  isMe: boolean
  onReply: (msg: any) => void
  onCopy: (msg: any) => void
  onEdit: (msg: any) => void
  onDelete: (msg: any) => void
  onForward: (msg: any) => void
}

export function MessageActionsMenu({
  msg,
  isMe,
  onReply,
  onCopy,
  onEdit,
  onDelete,
  onForward,
}: MessageActionsMenuProps) {
  return (
    <DropdownMenuContent align="end" className="bg-chat-panel border-chat-border shadow-chat min-w-[170px]">
      <DropdownMenuItem
        className="cursor-pointer focus:bg-chat-hover"
        onClick={(e) => {
          e.stopPropagation()
          onReply(msg)
        }}
      >
        <MessageSquare className="h-4 w-4 mr-2" />
        Responder
      </DropdownMenuItem>
      <DropdownMenuItem
        className="cursor-pointer focus:bg-chat-hover"
        onClick={(e) => {
          e.stopPropagation()
          onForward(msg)
        }}
      >
        <Forward className="h-4 w-4 mr-2" />
        Encaminhar
      </DropdownMenuItem>
      <DropdownMenuItem
        className="cursor-pointer focus:bg-chat-hover"
        onClick={(e) => {
          e.stopPropagation()
          onCopy(msg)
        }}
      >
        <Copy className="h-4 w-4 mr-2" />
        Copiar
      </DropdownMenuItem>
      {isMe && !msg.deleted_at && (
        <DropdownMenuItem
          className="cursor-pointer focus:bg-chat-hover"
          onClick={(e) => {
            e.stopPropagation()
            onEdit(msg)
          }}
        >
          <Pencil className="h-4 w-4 mr-2" />
          Editar
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator className="bg-chat-border" />
      {isMe && (
        <DropdownMenuItem
          className="cursor-pointer focus:bg-chat-hover text-red-400"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(msg)
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Apagar
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  )
}
