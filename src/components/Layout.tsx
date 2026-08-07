import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Header } from '@/components/Header'
import { MobileHeader } from '@/components/mobile/MobileHeader'
import { MobileTabBar } from '@/components/mobile/MobileTabBar'
import { MobileMoreSheet } from '@/components/mobile/MobileMoreSheet'
import { GridBackground } from '@/components/ui/grid-background'
import { BroadcastListener } from '@/components/BroadcastListener'
import { ToolHost } from '@/components/tools/ToolHost'
import { useAppHeartbeat } from '@/hooks/use-app-heartbeat'
import { useAndroidBack } from '@/hooks/use-android-back'
import { useAndroidShell } from '@/hooks/use-android-shell'
import { useIsMobile } from '@/hooks/use-mobile'
import { useConversaAberta } from '@/stores/mobileChrome'
import { isNativeAndroid } from '@/lib/app-info'
import { cn } from '@/lib/utils'

const naAndroid = isNativeAndroid()

export default function Layout() {
  const location = useLocation()
  // Telas que gerenciam a própria rolagem e precisam da altura toda. As
  // ferramentas embutidas entram aqui porque o iframe herda a altura do pai:
  // dentro do container com padding e max-w-7xl o app filho ficaria espremido
  // e com barra de rolagem dupla.
  //
  // TODAS as ferramentas entram aqui, e não só as embutidas: o `ToolHost`
  // precisa de uma altura definida para dar a cada ferramenta a sua PRÓPRIA área
  // de rolagem. Sem isso a rolagem seria a do `<main>`, compartilhada, e voltar
  // de outra tela cairia sempre no topo. O respiro e a largura máxima que o
  // Layout dava passam a ser aplicados dentro do host, por ferramenta.
  const isFullBleed =
    location.pathname.startsWith('/chat') ||
    location.pathname.startsWith('/ferramentas/')

  /**
   * A casca é escolhida por LARGURA, não por "é o APK". Uma janela estreita no
   * Windows tem o mesmo problema que o celular — a barra do desktop corta os
   * controles do fim da fila —, e uma regra só evita manter dois layouts.
   */
  const noCelular = useIsMobile()
  const conversaAberta = useConversaAberta()
  const [maisAberto, setMaisAberto] = useState(false)

  /**
   * Conversa aberta no celular ocupa a tela INTEIRA: as duas barras somem, como
   * no WhatsApp. É seguro porque o `ChatWindow` tem cabeçalho próprio com botão
   * de voltar, e o voltar do Android também sai da conversa para a lista.
   */
  const semCasca = noCelular && conversaAberta

  // Layout só é montado dentro de ProtectedRoute, então aqui já há sessão.
  useAppHeartbeat(true)
  // Botão voltar do Android. Fora do APK, não faz nada.
  useAndroidBack()
  // Barra de status e teclado. Idem.
  useAndroidShell()

  return (
    <div
      className={cn(
        'relative flex flex-col h-screen w-full overflow-hidden text-foreground',
        // `h-screen` no Android usa a altura da JANELA, que não encolhe quando o
        // teclado abre — o compositor ficaria atrás dele. `100dvh` acompanha a
        // área realmente visível.
        naAndroid && 'app-safe-areas app-android h-[100dvh]',
      )}
    >
      <GridBackground />
      <BroadcastListener />

      {!semCasca && (noCelular ? <MobileHeader onAbrirMais={() => setMaisAberto(true)} /> : <Header />)}

      <main
        className={cn(
          'relative z-10 flex-1 animate-fade-in-up flex flex-col',
          isFullBleed ? 'overflow-hidden' : 'overflow-y-auto p-4 md:p-6 lg:p-8',
          // No celular o respiro lateral do painel é menor: 32px de padding em
          // 360px de tela é quase 10% da largura só de margem.
          !isFullBleed && noCelular && 'p-3',
        )}
      >
        <div className={`mx-auto w-full ${isFullBleed ? 'h-full max-w-none' : 'max-w-7xl'}`}>
          <Outlet />
        </div>
        {/*
          Filho DIRETO do `<main>`, e fora do container de largura máxima: o host
          se posiciona por `absolute inset-0` e o `<main>` é o elemento `relative`
          de referência. Estar fora da troca de rotas é o que faz as ferramentas
          abertas sobreviverem a uma ida ao WhatsApp; estar fora do container de
          largura é o que dá a elas a área inteira, sem depender do `max-w-7xl`
          que só vale para as páginas comuns.
        */}
        <ToolHost />
      </main>

      {noCelular && !semCasca && <MobileTabBar onAbrirMais={() => setMaisAberto(true)} />}
      {noCelular && <MobileMoreSheet aberta={maisAberto} onAbrirChange={setMaisAberto} />}
    </div>
  )
}
