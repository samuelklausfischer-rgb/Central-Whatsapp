/* Use Mobile Hook - A hook that checks if the screen is mobile - from shadcn/ui (exposes useIsMobile) */
import * as React from 'react'

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  /**
   * O valor inicial é medido AGORA, e não `undefined`.
   *
   * Começando indefinido, o primeiro quadro sempre dizia "não é celular": o app
   * desenhava a casca de desktop e só trocava no efeito seguinte. Num celular
   * isso é uma piscada com a barra do desktop estourando a tela, e um salto de
   * layout logo depois. A leitura é síncrona e barata; o `typeof window`
   * protege qualquer render fora do navegador.
   */
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() =>
    typeof window === 'undefined' ? undefined : window.innerWidth < MOBILE_BREAKPOINT,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return !!isMobile
}
