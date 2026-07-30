import { useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConversationPicker, type ConversaSelecionavel } from '@/components/chat/ConversationPicker'

/**
 * Compartilhar o contato da conversa ABERTA com outras conversas.
 *
 * Destino múltiplo: marca vários e confirma. O envio é **sequencial**, um destino
 * por vez — a função de envio no banco faz chamada HTTP bloqueante segurando a
 * conexão, e disparar vários em paralelo poderia prender várias das 100 conexões
 * se a Evolution travar. O contador mostra o progresso real.
 *
 * A lista de conversas é a mesma do encaminhar (`ConversationPicker`), para não
 * existirem duas cópias da mesma lista divergindo com o tempo.
 */
interface Props {
  aberto: boolean
  onFechar: () => void
  /** Nome do contato que está sendo compartilhado, para o título. */
  contatoLabel: string
  conversas: ConversaSelecionavel[]
  contactIndex: Map<string, any>
  instanceKey?: string
  onEnviarPara: (remoteSender: string) => Promise<void>
}

export function ShareThisContactDialog({
  aberto,
  onFechar,
  contatoLabel,
  conversas,
  contactIndex,
  instanceKey,
  onEnviarPara,
}: Props) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [concluidos, setConcluidos] = useState<Set<string>>(new Set())
  const [emAndamento, setEmAndamento] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [falhas, setFalhas] = useState<string[]>([])

  const alternar = useCallback((jid: string) => {
    setMarcados((prev) => {
      const proximo = new Set(prev)
      if (proximo.has(jid)) proximo.delete(jid)
      else proximo.add(jid)
      return proximo
    })
  }, [])

  const fechar = useCallback(() => {
    if (enviando) return
    setMarcados(new Set())
    setConcluidos(new Set())
    setFalhas([])
    onFechar()
  }, [enviando, onFechar])

  const enviar = useCallback(async () => {
    if (marcados.size === 0 || enviando) return
    setEnviando(true)
    setFalhas([])
    const destinos = [...marcados]
    const erros: string[] = []
    for (const destino of destinos) {
      setEmAndamento(destino)
      try {
        await onEnviarPara(destino)
        setConcluidos((prev) => new Set(prev).add(destino))
      } catch {
        // Um destino que falha não interrompe os demais — mas é registrado, para
        // o atendente não sair achando que todos foram.
        erros.push(destino)
      }
    }
    setEmAndamento(null)
    setEnviando(false)
    setFalhas(erros)
    if (erros.length === 0) fechar()
  }, [marcados, enviando, onEnviarPara, fechar])

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-[440px] bg-chat-panel border-chat-border">
        <DialogHeader>
          <DialogTitle className="text-chat-text">Compartilhar {contatoLabel}</DialogTitle>
        </DialogHeader>

        <ConversationPicker
          conversas={conversas}
          contactIndex={contactIndex}
          instanceKey={instanceKey}
          multi
          selecionados={marcados}
          onAlternar={alternar}
          concluidos={concluidos}
          emAndamento={emAndamento}
          travado={enviando}
        />

        {falhas.length > 0 && (
          <p className="text-xs text-destructive">
            {falhas.length === 1
              ? 'Não foi possível enviar para 1 conversa.'
              : `Não foi possível enviar para ${falhas.length} conversas.`}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={marcados.size === 0 || enviando}>
            {enviando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {enviando
              ? `Enviando ${concluidos.size + 1}/${marcados.size}`
              : `Enviar${marcados.size > 0 ? ` (${marcados.size})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
