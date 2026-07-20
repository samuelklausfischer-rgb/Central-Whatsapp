import { Outlet, useLocation } from 'react-router-dom'
import { Header } from '@/components/Header'
import { GridBackground } from '@/components/ui/grid-background'
import { BroadcastListener } from '@/components/BroadcastListener'

export default function Layout() {
  const location = useLocation()
  const isChat = location.pathname.startsWith('/chat')

  return (
    <div className="relative flex flex-col h-screen w-full overflow-hidden text-foreground">
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
