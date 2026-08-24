import { MessageSquare, Copy, Pencil, Trash2, Forward, Reply, ListChecks, Info } from 'lucide-react'
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
  /**
   * ITENS 8 e 14: se a edição tem como chegar ao WhatsApp. Não basta ser
   * mensagem própria — o WhatsApp só aceita editar até 15 minutos depois do
   * envio, e só mensagem que ele conhece. Quem calcula é o ChatWindow, que tem
   * o relógio; aqui só se obedece.
   */
  podeEditar: boolean
  onReply: (msg: any) => void
  onCopy: (msg: any) => void
  onEdit: (msg: any) => void
  onDelete: (msg: any) => void
  onForward: (msg: any) => void
  /**
   * Entra no modo de seleção já com esta mensagem marcada — o caminho de
   * teclado/mouse para o que no celular se faz segurando pressionado.
   */
  onSelecionar: (msg: any) => void
  /**
   * Só aparece em grupo, e só para mensagem de OUTRA pessoa: responder no
   * privado a quem escreveu no grupo, sem nada acontecer no grupo.
   */
  onReplyPrivately?: (msg: any) => void
  podeResponderPrivadamente?: boolean
  /**
   * Abre o painel de recibos ("quem viu esta mensagem e quando"). Vale para
   * QUALQUER mensagem, própria ou não — diferente de Editar/Apagar.
   */
  onInfo: (msg: any) => void
}

export function MessageActionsMenu({
  msg,
  isMe,
  podeEditar,
  onReply,
  onCopy,
  onEdit,
  onDelete,
  onForward,
  onSelecionar,
  onReplyPrivately,
  podeResponderPrivadamente = false,
  onInfo,
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
      {podeResponderPrivadamente && onReplyPrivately && (
        <DropdownMenuItem
          className="cursor-pointer focus:bg-chat-hover"
          onClick={(e) => {
            e.stopPropagation()
            onReplyPrivately(msg)
          }}
        >
          <Reply className="h-4 w-4 mr-2" />
          Responder privadamente
        </DropdownMenuItem>
      )}
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
      <DropdownMenuItem
        className="cursor-pointer focus:bg-chat-hover"
        onClick={(e) => {
          e.stopPropagation()
          onSelecionar(msg)
        }}
      >
        <ListChecks className="h-4 w-4 mr-2" />
        Selecionar mensagens
      </DropdownMenuItem>
      <DropdownMenuItem
        className="cursor-pointer focus:bg-chat-hover"
        onClick={(e) => {
          e.stopPropagation()
          onInfo(msg)
        }}
      >
        <Info className="h-4 w-4 mr-2" />
        Informações da mensagem
      </DropdownMenuItem>
      {podeEditar && (
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
