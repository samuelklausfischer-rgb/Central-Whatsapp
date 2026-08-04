import { useCallback, useMemo, useRef, useState } from 'react'
import { MAX_SELECIONADAS } from '@/lib/selection-actions'

/**
 * Estado do modo de seleção de mensagens.
 *
 * Fica num hook, e não no `ChatWindow`, por causa das três regras abaixo: elas
 * têm de valer para TODA forma de marcar (menu, segurar pressionado, clique,
 * shift+clique), e espalhá-las por quatro handlers no JSX é como uma delas
 * acabaria valendo só para metade dos caminhos.
 */

const VAZIO: ReadonlySet<string> = new Set()

/**
 * Um `[]` novo a cada render faria os quatro `useMemo` de "o que dá para fazer
 * com a seleção" recalcularem em TODO render do ChatWindow — inclusive a cada
 * tecla digitada no compositor, com nada selecionado. A lista de mensagens deste
 * componente já é conhecida por ser sensível a isso.
 */
const VAZIO_MSGS: any[] = []

interface Opcoes {
  /** Mensagens na ordem em que aparecem na tela. */
  messages: any[]
  /**
   * `${device.id}:${contact}`. Trocou de valor, a seleção zera.
   *
   * ⚠️ NÃO É ZELO. O `ChatWindow` é renderizado sem `key` no `ChatHub` e
   * **não desmonta** ao trocar de conversa (o mesmo detalhe que já causou o
   * bug do ✓ preso no `ForwardDialog` e o do scroll pulando para o fim). Sem
   * este reset, os ids marcados numa conversa continuariam marcados na
   * próxima — e "Apagar" agiria sobre mensagens que o atendente não está nem
   * vendo.
   */
  chaveConversa: string | null
  /** Chamado quando uma marcação foi recusada por bater no teto. */
  onTeto?: () => void
}

export function useMessageSelection({ messages, chaveConversa, onTeto }: Opcoes) {
  const [ids, setIds] = useState<ReadonlySet<string>>(VAZIO)
  const [modoSelecao, setModoSelecao] = useState(false)
  const ancoraRef = useRef<number | null>(null)

  // Reset DURANTE a renderização, não num efeito. Um efeito rodaria depois do
  // primeiro quadro da conversa nova, e a barra de seleção da conversa anterior
  // apareceria piscando sobre ela com o contador errado.
  const [chaveAnterior, setChaveAnterior] = useState(chaveConversa)
  if (chaveConversa !== chaveAnterior) {
    setChaveAnterior(chaveConversa)
    setIds(VAZIO)
    setModoSelecao(false)
    ancoraRef.current = null
  }

  /**
   * As mensagens marcadas, na ordem do array — nunca na ordem de clique.
   *
   * Encaminhar fora de ordem cronológica entregaria a conversa embaralhada do
   * outro lado. E derivar de `messages` também poda sozinho o id que sumiu da
   * lista (mensagem apagada, refetch): o contador não fica preso num número
   * maior do que o que está na tela.
   */
  const selecionadas = useMemo(
    () => (ids.size === 0 ? VAZIO_MSGS : messages.filter((m: any) => ids.has(m.id))),
    [messages, ids],
  )

  const estaSelecionada = useCallback((id: string) => ids.has(id), [ids])

  const limpar = useCallback(() => {
    setIds(VAZIO)
    setModoSelecao(false)
    ancoraRef.current = null
  }, [])

  const iniciarCom = useCallback(
    (msg: any) => {
      if (!msg?.id) return
      setModoSelecao(true)
      setIds(new Set([msg.id]))
      const i = messages.findIndex((m: any) => m.id === msg.id)
      ancoraRef.current = i >= 0 ? i : null
    },
    [messages],
  )

  /**
   * Marca/desmarca. Com shift, estende do último ponto marcado até aqui.
   *
   * O shift SEMPRE adiciona (nunca inverte item a item): é o que a pessoa espera
   * de "selecionar deste até aqui", e inverter no meio de um intervalo grande
   * produziria um resultado que ninguém consegue prever olhando a tela.
   */
  const alternar = useCallback(
    (msg: any, index: number, comShift = false) => {
      if (!msg?.id) return

      setIds((anterior) => {
        const proximo = new Set(anterior)

        if (comShift && ancoraRef.current !== null) {
          const inicio = Math.min(ancoraRef.current, index)
          const fim = Math.max(ancoraRef.current, index)
          let estourou = false
          for (let i = inicio; i <= fim; i++) {
            const alvo = messages[i]
            if (!alvo?.id || proximo.has(alvo.id)) continue
            if (proximo.size >= MAX_SELECIONADAS) {
              estourou = true
              break
            }
            proximo.add(alvo.id)
          }
          if (estourou) onTeto?.()
          return proximo
        }

        if (proximo.has(msg.id)) {
          proximo.delete(msg.id)
        } else {
          if (proximo.size >= MAX_SELECIONADAS) {
            onTeto?.()
            return anterior
          }
          proximo.add(msg.id)
        }
        return proximo
      })

      ancoraRef.current = index
    },
    [messages, onTeto],
  )

  // Desmarcar a última sai do modo, como no WhatsApp. Decidido aqui e não dentro
  // do `alternar` porque lá o tamanho novo só existe dentro do `setIds`
  // funcional — `ids.size` naquele ponto ainda é o do render anterior.
  // `iniciarCom` liga o modo e marca a mensagem no mesmo lote, então nunca
  // existe um quadro com modo ligado e conjunto vazio por acidente.
  if (modoSelecao && ids.size === 0) {
    setModoSelecao(false)
    ancoraRef.current = null
  }

  return {
    modoSelecao,
    selecionadas,
    quantidade: selecionadas.length,
    estaSelecionada,
    iniciarCom,
    alternar,
    limpar,
  }
}
