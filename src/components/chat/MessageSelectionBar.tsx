import { X, Forward, Copy, Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Cabeçalho da conversa enquanto o modo de seleção está ativo.
 *
 * SUBSTITUI o cabeçalho normal em vez de aparecer acima dele, como no WhatsApp:
 * empilhar as duas barras empurraria a conversa para baixo e faria a lista pular
 * a cada entrada e saída do modo — justamente o tipo de salto de scroll que já
 * foi corrigido neste chat uma vez.
 *
 * Só apresentação. Quem sabe o que pode ser encaminhado, copiado, baixado ou
 * apagado é `lib/selection-actions.ts`; aqui só chegam os booleanos prontos, com
 * o motivo para mostrar quando a ação está fora de alcance. Ação impossível fica
 * **desabilitada com explicação**, e não escondida: sumir com o ícone faria o
 * atendente procurar um botão que ele jura ter visto antes.
 */
interface AcaoProps {
  titulo: string
  desabilitado?: boolean
  /** Some no lugar do título quando desabilitado, dizendo por quê. */
  motivo?: string
  onClick: () => void
  children: React.ReactNode
  className?: string
}

function Acao({ titulo, desabilitado, motivo, onClick, children, className }: AcaoProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={desabilitado}
      title={desabilitado ? (motivo ?? titulo) : titulo}
      aria-label={titulo}
      className={`text-chat-text/80 hover:text-chat-text disabled:opacity-40 ${className ?? ''}`}
    >
      {children}
    </Button>
  )
}

interface Props {
  quantidade: number
  onFechar: () => void
  onEncaminhar: () => void
  onCopiar: () => void
  onBaixar: () => void
  onApagar: () => void
  podeEncaminhar: boolean
  podeCopiar: boolean
  podeBaixar: boolean
  podeApagar: boolean
  /** Por que "Baixar" está fora de alcance (no Android o motivo é outro). */
  motivoBaixar?: string
}

export function MessageSelectionBar({
  quantidade,
  onFechar,
  onEncaminhar,
  onCopiar,
  onBaixar,
  onApagar,
  podeEncaminhar,
  podeCopiar,
  podeBaixar,
  podeApagar,
  motivoBaixar,
}: Props) {
  return (
    <div className="h-[64px] border-b border-chat-border bg-chat-header shadow-chat flex items-center justify-between px-4 sm:px-5 sticky top-0 z-10 flex-shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={onFechar}
          aria-label="Sair da seleção"
          title="Sair da seleção (Esc)"
          className="-ml-2 text-chat-text/80 hover:text-chat-text flex-shrink-0"
        >
          <X className="h-5 w-5" />
        </Button>
        <span className="font-semibold text-[16px] text-chat-text tracking-tight truncate">
          {quantidade === 1 ? '1 selecionada' : `${quantidade} selecionadas`}
        </span>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <Acao
          titulo="Encaminhar"
          onClick={onEncaminhar}
          desabilitado={!podeEncaminhar}
          motivo="Nenhuma das mensagens marcadas pode ser encaminhada"
        >
          <Forward className="h-5 w-5" />
        </Acao>
        <Acao
          titulo="Copiar"
          onClick={onCopiar}
          desabilitado={!podeCopiar}
          motivo="Nenhuma das mensagens marcadas tem texto para copiar"
        >
          <Copy className="h-5 w-5" />
        </Acao>
        <Acao
          titulo="Baixar"
          onClick={onBaixar}
          desabilitado={!podeBaixar}
          motivo={motivoBaixar ?? 'Nenhuma das mensagens marcadas tem arquivo disponível'}
        >
          <Download className="h-5 w-5" />
        </Acao>
        <Acao
          titulo="Apagar"
          onClick={onApagar}
          desabilitado={!podeApagar}
          motivo="Só é possível apagar as mensagens enviadas por você"
          className="text-red-400 hover:text-red-300"
        >
          <Trash2 className="h-5 w-5" />
        </Acao>
      </div>
    </div>
  )
}
