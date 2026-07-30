import { useState, useMemo, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConversationPicker } from '@/components/chat/ConversationPicker'
import { podeEncaminhar, legendaParaEncaminhar } from '@/lib/forward'

/**
 * Escolha do destino para encaminhar uma mensagem.
 *
 * DESTINO RESTRITO AO MESMO APARELHO, de propósito. Encaminhar para conversa de
 * outro aparelho enviaria pelo número errado, e a paciente receberia a mensagem
 * de um número desconhecido da clínica. A lista já vem escopada por aparelho do
 * ChatHub, que valida o acesso.
 */
interface Props {
  aberto: boolean
  onFechar: () => void
  /** Mensagem sendo encaminhada. */
  msg: any
  /** Conversas do aparelho atual: { remote_sender, sender_name }. */
  conversas: any[]
  contacts: any[]
  contactIndex: Map<string, any>
  instanceKey?: string
  /** Envia para um destino. Deve resolver com a linha real criada. */
  onEncaminhar: (remoteSender: string, texto: string, anexo?: { url: string; type: string; name: string }) => Promise<void>
}

export function ForwardDialog({
  aberto,
  onFechar,
  msg,
  conversas,
  contactIndex,
  instanceKey,
  onEncaminhar,
}: Props) {
  const [enviandoPara, setEnviandoPara] = useState<string | null>(null)
  const [enviados, setEnviados] = useState<Set<string>>(new Set())

  const verificacao = useMemo(() => podeEncaminhar(msg), [msg])

  const encaminhar = useCallback(
    async (remoteSender: string) => {
      if (enviandoPara || !verificacao.pode) return
      // Envio ESTRITAMENTE SEQUENCIAL (um de cada vez): a função de envio no
      // banco faz chamada HTTP bloqueante segurando a conexão, e disparar vários
      // em paralelo poderia prender várias das 100 conexões se a Evolution travar.
      setEnviandoPara(remoteSender)
      try {
        await onEncaminhar(remoteSender, legendaParaEncaminhar(msg), verificacao.anexo)
        setEnviados((prev) => new Set(prev).add(remoteSender))
      } finally {
        setEnviandoPara(null)
      }
    },
    [enviandoPara, verificacao, msg, onEncaminhar],
  )

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-[440px] bg-chat-panel border-chat-border">
        <DialogHeader>
          <DialogTitle className="text-chat-text">Encaminhar mensagem</DialogTitle>
        </DialogHeader>

        {!verificacao.pode ? (
          <div className="py-6 text-center">
            <p className="text-sm text-chat-muted">{verificacao.motivo}</p>
          </div>
        ) : (
          <>
            <ConversationPicker
              conversas={conversas}
              contactIndex={contactIndex}
              instanceKey={instanceKey}
              onEscolher={encaminhar}
              concluidos={enviados}
              emAndamento={enviandoPara}
              travado={!!enviandoPara}
            />
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={!!enviandoPara}>
            {enviados.size > 0 ? 'Concluir' : 'Cancelar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
