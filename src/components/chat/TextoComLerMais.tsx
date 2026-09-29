import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Linha do texto do balão (leading-[19px]). */
const ALTURA_DA_LINHA_PX = 19
/** 14 linhas: o mesmo corte do WhatsApp antes do "Ler mais". */
const ALTURA_MAXIMA_PX = 14 * ALTURA_DA_LINHA_PX

/**
 * Limita o texto do balão a ~14 linhas e oferece "Ler mais" só quando o
 * conteúdo realmente passa disso.
 *
 * O corte é por ALTURA (`max-height` + `overflow-hidden`), não por caracteres:
 * cortar a string quebraria negrito, link, menção e o destaque da busca no meio.
 *
 * Só há corte quando sobra MAIS DE UMA linha além do limite. Com uma linha a
 * mais o "Ler mais" só revelaria essa linha (e o horário) — melhor mostrar tudo.
 * Por isso o corte só entra depois da medição, que roda antes da pintura.
 *
 * `reserva` é a cópia invisível do rodapé (horário): precisa ficar DENTRO da área
 * medida para continuar empurrando a última linha quando o texto está expandido
 * ou cabe inteiro. Cortado, o horário (absoluto no canto do balão) passa a cair
 * na linha do próprio "Ler mais", como no WhatsApp — por isso o botão reserva
 * espaço à direita.
 *
 * O estado mora aqui (um por balão) e não em um Set no ChatWindow: as mensagens
 * têm chave própria, então ao trocar de conversa os balões desmontam e o
 * "expandido" volta sozinho para fechado, sem reset manual nem dependência nova
 * no `useMemo` da lista.
 *
 * `abrirExpandido`: o balão tem ocorrência da busca — abre expandido para o
 * destaque não cair no trecho cortado.
 */
export function TextoComLerMais({
  children,
  reserva,
  abrirExpandido = false,
}: {
  children: ReactNode
  reserva?: ReactNode
  abrirExpandido?: boolean
}) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [expandido, setExpandido] = useState(abrirExpandido)
  const [transborda, setTransborda] = useState(false)

  // A busca pode passar a apontar para este balão depois de montado.
  useEffect(() => {
    if (abrirExpandido) setExpandido(true)
  }, [abrirExpandido])

  // `scrollHeight` é a altura do conteúdo inteiro, cortado ou não. Mede quando o
  // texto muda (edição, destaque da busca).
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el || expandido) return
    setTransborda(el.scrollHeight - ALTURA_MAXIMA_PX > ALTURA_DA_LINHA_PX)
    // `children` e `reserva` são elementos novos a cada render: listá-los é o que
    // faz a medição rodar quando o texto muda, sem loop (o estado só troca de valor
    // quando a medida muda de fato).
  }, [children, reserva, expandido])

  // Largura mudou (janela, painel lateral) → o número de linhas muda. O
  // observador é criado uma vez por estado de expansão, não a cada render.
  useEffect(() => {
    const el = areaRef.current
    if (!el || expandido) return
    const observer = new ResizeObserver(() =>
      setTransborda(el.scrollHeight - ALTURA_MAXIMA_PX > ALTURA_DA_LINHA_PX),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [expandido])

  const cortado = transborda && !expandido

  return (
    <>
      <div
        ref={areaRef}
        className={cortado ? 'overflow-hidden' : undefined}
        style={cortado ? { maxHeight: ALTURA_MAXIMA_PX } : undefined}
      >
        {children}
        {reserva}
      </div>
      {cortado && (
        <button
          type="button"
          aria-expanded={false}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setExpandido(true)
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="block pr-14 text-left text-[14.2px] font-medium leading-[19px] text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Ler mais
        </button>
      )}
    </>
  )
}
