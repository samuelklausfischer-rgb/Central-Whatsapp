import { Outlet, useLocation } from 'react-router-dom'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/AppSidebar'
import { Header } from '@/components/Header'
import { GridBackground } from '@/components/ui/grid-background'

export default function Layout() {
  const location = useLocation()
  const isChat = location.pathname.startsWith('/chat')

  return (
    <SidebarProvider>
      <div className="relative flex h-screen w-full overflow-hidden text-foreground">
        <GridBackground />
        <AppSidebar />
        <div className="relative z-10 flex flex-col w-full flex-1 overflow-hidden transition-all duration-300 ease-in-out bg-background backdrop-blur-md">
          <Header />
          <main
            className={`flex-1 animate-fade-in-up flex flex-col ${isChat ? 'overflow-hidden' : 'overflow-y-auto p-4 md:p-6 lg:p-8'}`}
          >
            <div className={`mx-auto w-full ${isChat ? 'h-full max-w-none' : 'max-w-7xl'}`}>
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  )
}
