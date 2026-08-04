import { useState, useMemo, useCallback, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConversationPicker } from '@/components/chat/ConversationPicker'
import { legendaParaEncaminhar } from '@/lib/forward'
import { separarEncaminhaveis, resumirMotivos } from '@/lib/selection-actions'

/**
 * Escolha do destino para encaminhar uma ou várias mensagens.
 *
 * DESTINO RESTRITO AO MESMO APARELHO, de propósito. Encaminhar para conversa de
 * outro aparelho enviaria pelo número errado, e a paciente receberia a mensagem
 * de um número desconhecido da clínica. A lista já vem escopada por aparelho do
 * ChatHub, que valida o acesso.
 *
 * POR QUE MARCAR E CONFIRMAR, E NÃO ENVIAR NO CLIQUE
 * A versão anterior disparava o envio no clique de cada destino, o que fazia
 * sentido com uma mensagem só. Com várias, um clique distraído viraria uma fila
 * de dezenas de envios reais, sem confirmação e sem volta. Agora o diálogo marca
 * destinos e envia no botão — o mesmo desenho do `ShareThisContactDialog` e do
 * WhatsApp oficial.
 */
interface Props {
  aberto: boolean
  onFechar: () => void
  /** Mensagens a encaminhar, já em ordem cronológica. Uma só entra como lista de uma. */
  msgs: any[]
  /** Conversas do aparelho atual: { remote_sender, sender_name }. */
  conversas: any[]
  contacts: any[]
  contactIndex: Map<string, any>
  instanceKey?: string
  /** Envia UMA mensagem para UM destino. */
  onEncaminhar: (remoteSender: string, texto: string, anexo?: { url: string; type: string; name: string }) => Promise<void>
  /**
   * Só quando TUDO foi entregue — serve para o ChatWindow sair do modo de
   * seleção. Separado do `onFechar` de propósito: cancelar não pode custar ao
   * atendente a seleção de 20 mensagens que ele acabou de montar.
   */
  onTudoEnviado?: () => void
}

/** Chave de um par destino↔mensagem já entregue. */
const par = (destino: string, msgId: string) => `${destino}|${msgId}`

export function ForwardDialog({
  aberto,
  onFechar,
  msgs,
  conversas,
  contactIndex,
  instanceKey,
  onEncaminhar,
  onTudoEnviado,
}: Props) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  /**
   * Pares destino↔mensagem já entregues — não "destinos concluídos".
   *
   * Uma falha no meio de um lote de 10 mensagens não pode obrigar a reenviar as
   * 10: a paciente receberia nove mensagens repetidas. Guardando o par, o botão
   * "Enviar" depois de uma falha parcial retoma exatamente de onde parou.
   */
  const [paresEnviados, setParesEnviados] = useState<Set<string>>(new Set())
  const [emAndamento, setEmAndamento] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [destinosComFalha, setDestinosComFalha] = useState<string[]>([])
  /** Progresso da RODADA em curso (envios feitos / envios previstos). */
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null)

  const chaveMsgs = useMemo(() => msgs.map((m: any) => m?.id).join(','), [msgs])

  const { ok, bloqueadas } = useMemo(() => separarEncaminhaveis(msgs), [msgs])

  /**
   * Zera o histórico a cada abertura e a cada seleção nova.
   *
   * Este diálogo NÃO desmonta: no desktop o ChatWindow é montado sem `key` e
   * sobrevive à troca de conversa. Sem este reset, o ✓ de um destino já usado
   * ficava colado nele — a linha aparecia concluída e `disabled` para todos os
   * encaminhamentos seguintes da sessão, inclusive de outras conversas.
   */
  useEffect(() => {
    setMarcados(new Set())
    setParesEnviados(new Set())
    setDestinosComFalha([])
    setEmAndamento(null)
    setProgresso(null)
  }, [aberto, chaveMsgs])

  /** Destino que já recebeu TODAS as mensagens encaminháveis. */
  const concluidos = useMemo(() => {
    const feitos = new Set<string>()
    if (ok.length === 0) return feitos
    for (const destino of marcados) {
      if (ok.every(({ msg }) => paresEnviados.has(par(destino, msg.id)))) feitos.add(destino)
    }
    return feitos
  }, [marcados, paresEnviados, ok])

  const alternar = useCallback((jid: string) => {
    setMarcados((anterior) => {
      const proximo = new Set(anterior)
      if (proximo.has(jid)) proximo.delete(jid)
      else proximo.add(jid)
      return proximo
    })
  }, [])

  const fechar = useCallback(() => {
    if (enviando) return
    onFechar()
  }, [enviando, onFechar])

  const enviar = useCallback(async () => {
    if (marcados.size === 0 || ok.length === 0 || enviando) return
    setEnviando(true)
    setDestinosComFalha([])

    // Pares que ainda faltam. Depois de uma falha parcial, "Enviar" é a única
    // ação óbvia para tentar de novo — e refazer a lista inteira duplicaria
    // tudo que já tinha dado certo.
    const pendentes: { destino: string; msg: any; anexo?: { url: string; type: string; name: string } }[] = []
    // ORDEM DESTINO-MAIOR: todas as mensagens para o destino 1, depois para o 2.
    // Intercalar entregaria os trechos picotados entre as conversas.
    for (const destino of marcados) {
      for (const { msg, anexo } of ok) {
        if (!paresEnviados.has(par(destino, msg.id))) pendentes.push({ destino, msg, anexo })
      }
    }

    const concluir = () => {
      onTudoEnviado?.()
      onFechar()
    }

    if (pendentes.length === 0) {
      setEnviando(false)
      concluir()
      return
    }

    const comFalha = new Set<string>()
    let feitos = 0

    // Envio ESTRITAMENTE SEQUENCIAL: a função de envio no banco faz chamada HTTP
    // bloqueante segurando a conexão, e disparar vários em paralelo poderia
    // prender várias das 100 conexões se a Evolution travar.
    for (const { destino, msg, anexo } of pendentes) {
      setEmAndamento(destino)
      try {
        await onEncaminhar(destino, legendaParaEncaminhar(msg), anexo)
        setParesEnviados((anterior) => new Set(anterior).add(par(destino, msg.id)))
      } catch {
        // Uma mensagem que falha não interrompe as demais — mas o destino fica
        // registrado, para o atendente não sair achando que tudo chegou.
        comFalha.add(destino)
      }
      feitos++
      setProgresso({ feitos, total: pendentes.length })
    }

    setEmAndamento(null)
    setEnviando(false)
    setProgresso(null)
    setDestinosComFalha([...comFalha])
    // Sobraram só as falhas na seleção: clicar em "Enviar" de novo retoma
    // exatamente os pares que faltam.
    if (comFalha.size === 0) concluir()
    else setMarcados(comFalha)
  }, [marcados, ok, paresEnviados, enviando, onEncaminhar, onFechar, onTudoEnviado])

  const total = msgs.length
  const titulo = total === 1 ? 'Encaminhar mensagem' : `Encaminhar ${total} mensagens`
  const previstos = marcados.size * ok.length

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-[440px] bg-chat-panel border-chat-border">
        <DialogHeader>
          <DialogTitle className="text-chat-text">{titulo}</DialogTitle>
        </DialogHeader>

        {ok.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-chat-muted">
              {total === 1
                ? (bloqueadas[0]?.motivo ?? 'Esta mensagem não pode ser encaminhada.')
                : `Nenhuma das ${total} mensagens pode ser encaminhada. ${resumirMotivos(bloqueadas)}`}
            </p>
          </div>
        ) : (
          <>
            {bloqueadas.length > 0 && (
              <p className="text-xs text-amber-500/90">
                {ok.length} de {total} podem ser encaminhadas — {bloqueadas.length}{' '}
                {bloqueadas.length === 1 ? 'será ignorada' : 'serão ignoradas'}.{' '}
                {resumirMotivos(bloqueadas)}
              </p>
            )}

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

            {destinosComFalha.length > 0 && (
              <p className="text-xs text-destructive">
                {destinosComFalha.length === 1
                  ? 'Não foi possível encaminhar tudo para 1 conversa. Toque em Enviar para retomar de onde parou.'
                  : `Não foi possível encaminhar tudo para ${destinosComFalha.length} conversas. Toque em Enviar para retomar de onde parou.`}
              </p>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={enviando}>
            {paresEnviados.size > 0 ? 'Concluir' : 'Cancelar'}
          </Button>
          {ok.length > 0 && (
            <Button onClick={enviar} disabled={marcados.size === 0 || enviando}>
              {enviando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {enviando
                ? `Enviando ${Math.min((progresso?.feitos ?? 0) + 1, progresso?.total ?? previstos)}/${progresso?.total ?? previstos}`
                : `Enviar${previstos > 0 ? ` (${previstos})` : ''}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
