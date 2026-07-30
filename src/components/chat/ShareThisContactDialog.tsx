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
  /**
   * Progresso da RODADA em curso, não o total de sucessos.
   *
   * O contador usava `concluidos.size + 1`, que conta sucessos: uma falha no
   * meio fazia o número travar (falha no 2º e o 3º destino ainda exibia "2/5").
   */
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null)

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
    setProgresso(null)
    onFechar()
  }, [enviando, onFechar])

  const enviar = useCallback(async () => {
    if (marcados.size === 0 || enviando) return
    setEnviando(true)
    setFalhas([])
    // Só quem AINDA NÃO recebeu. Depois de uma falha parcial, o botão "Enviar" é
    // a única ação óbvia para tentar de novo — e percorrer `marcados` inteiro
    // mandava o cartão uma segunda vez para todos os que já tinham dado certo.
    const destinos = [...marcados].filter((d) => !concluidos.has(d))
    if (destinos.length === 0) {
      setEnviando(false)
      fechar()
      return
    }
    const erros: string[] = []
    let feitos = 0
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
      feitos++
      setProgresso({ feitos, total: destinos.length })
    }
    setEmAndamento(null)
    setEnviando(false)
    setProgresso(null)
    setFalhas(erros)
    // Sobraram só as falhas na seleção: clicar em "Enviar" de novo tenta
    // exatamente elas, e o rótulo do botão passa a contar só o que falta.
    setMarcados(new Set(erros))
    if (erros.length === 0) fechar()
  }, [marcados, concluidos, enviando, onEnviarPara, fechar])

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
              ? `Enviando ${Math.min((progresso?.feitos ?? 0) + 1, progresso?.total ?? marcados.size)}/${progresso?.total ?? marcados.size}`
              : `Enviar${marcados.size > 0 ? ` (${marcados.size})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
