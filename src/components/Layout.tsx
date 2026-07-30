import { Outlet, useLocation } from 'react-router-dom'
import { Header } from '@/components/Header'
import { GridBackground } from '@/components/ui/grid-background'
import { BroadcastListener } from '@/components/BroadcastListener'
import { useAppHeartbeat } from '@/hooks/use-app-heartbeat'
import { useAndroidBack } from '@/hooks/use-android-back'
import { useAndroidShell } from '@/hooks/use-android-shell'
import { isNativeAndroid } from '@/lib/app-info'
import { cn } from '@/lib/utils'

const naAndroid = isNativeAndroid()

export default function Layout() {
  const location = useLocation()
  const isChat = location.pathname.startsWith('/chat')

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
      <Header />
      <main
        className={`relative z-10 flex-1 animate-fade-in-up flex flex-col ${isChat ? 'overflow-hidden' : 'overflow-y-auto p-4 md:p-6 lg:p-8'}`}
      >
        <div className={`mx-auto w-full ${isChat ? 'h-full max-w-none' : 'max-w-7xl'}`}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
