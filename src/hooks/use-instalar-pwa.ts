import { useCallback, useEffect, useRef, useState } from 'react'
import { getAppPlatform } from '@/lib/app-info'

/**
 * O Chrome (e outros Chromium) não expõe nenhum jeito de "abrir o diálogo de
 * instalação" sob demanda — quem decide se e quando o app é instalável é o
 * próprio navegador, e ele avisa via `beforeinstallprompt`. Esse evento não
 * está no `lib.dom` padrão do TypeScript, então a interface é declarada aqui
 * mesmo, no único lugar do projeto que precisa dela.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

/**
 * Hook do botão "Instalar app": guarda o convite de instalação do navegador,
 * detecta se o app já está instalado (para sumir sozinho) e cobre o caso do
 * iOS, que não tem convite nenhum para guardar.
 *
 * `getAppPlatform() === 'web'` é o portão de tudo: dentro do Electron ou do
 * APK o app já É o instalado, então nenhum dos efeitos abaixo tem por que
 * rodar — os listeners nem são registrados.
 */
export function useInstalarPwa() {
  const ehWeb = getAppPlatform() === 'web'

  // `beforeinstallprompt` só chega UMA VEZ por carregamento de página — não
  // existe "pedir de novo" depois que ele passou. Por isso ele vai para uma
  // ref (sobrevive a re-renders sem disparar novos) e só é descartado quando
  // efetivamente usado ou quando a instalação já aconteceu.
  const eventoRef = useRef<BeforeInstallPromptEvent | null>(null)
  const [podeInstalar, setPodeInstalar] = useState(false)
  const [jaInstalado, setJaInstalado] = useState<boolean>(() => detectaInstalado())

  useEffect(() => {
    if (!ehWeb) return

    function aoOferecerInstalacao(evento: Event) {
      // Sem `preventDefault` o navegador mostra o próprio mini-infobar (que
      // some sozinho e não combina com o resto da UI). Ele devolve o controle
      // pra gente: guardamos o evento e decidimos quando mostrar o convite —
      // no clique do botão "Instalar app".
      evento.preventDefault()
      eventoRef.current = evento as BeforeInstallPromptEvent
      setPodeInstalar(true)
    }

    function aoInstalar() {
      // `appinstalled` cobre o caso de o usuário instalar por outro caminho
      // que não o nosso botão (ex.: ícone de instalação da barra de endereço).
      eventoRef.current = null
      setPodeInstalar(false)
      setJaInstalado(true)
    }

    window.addEventListener('beforeinstallprompt', aoOferecerInstalacao)
    window.addEventListener('appinstalled', aoInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', aoOferecerInstalacao)
      window.removeEventListener('appinstalled', aoInstalar)
    }
  }, [ehWeb])

  useEffect(() => {
    if (!ehWeb || typeof window.matchMedia !== 'function') return

    // `display-mode: standalone` muda no instante em que a instalação termina
    // — é o que faz o botão sumir na hora, sem precisar de reload nem de
    // esperar o evento `appinstalled` (que em alguns navegadores atrasa).
    const consulta = window.matchMedia('(display-mode: standalone)')
    function aoMudarModoExibicao(evento: MediaQueryListEvent) {
      if (evento.matches) setJaInstalado(true)
    }
    consulta.addEventListener('change', aoMudarModoExibicao)
    return () => consulta.removeEventListener('change', aoMudarModoExibicao)
  }, [ehWeb])

  const instalar = useCallback(async () => {
    const evento = eventoRef.current
    if (!evento) return
    await evento.prompt()
    // Aceito ou recusado, o evento não serve mais para nada — descarta e tira
    // o botão da tela; se o usuário recusou, ele só volta a ver o convite se
    // recarregar a página e o navegador decidir oferecer de novo.
    eventoRef.current = null
    setPodeInstalar(false)
    await evento.userChoice
  }, [])

  return {
    podeInstalar: ehWeb && podeInstalar,
    jaInstalado,
    ehIOS: ehWeb && detectaIOS(),
    instalar,
  }
}

function detectaInstalado(): boolean {
  if (typeof window === 'undefined') return false
  const emStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  // `navigator.standalone` é a propriedade proprietária que o Safari expõe
  // desde sempre para dizer "este site está rodando a partir da Tela de
  // Início" — no iOS `display-mode: standalone` nem sempre é confiável.
  const emStandaloneIOS = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return emStandalone || emStandaloneIOS
}

function detectaIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPod/.test(ua)) return true
  // Desde o iOS 13 o iPad se apresenta como "Macintosh" no userAgent (para
  // sites que faziam layout "modo desktop" em telas grandes) — a Apple não
  // deixa diferenciar isso pelo userAgent sozinho. `maxTouchPoints > 1` é o
  // jeito usual de separar: um Mac de verdade não tem multitoque, um iPad tem.
  const pareceMac = /Macintosh/.test(ua)
  const temMultitoque = navigator.maxTouchPoints > 1
  return pareceMac && temMultitoque
}
