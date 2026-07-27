import { Link, useLocation } from 'react-router-dom'
import logoUrl from '/logo.png'
import {
  LayoutDashboard,
  Smartphone,
  MessageSquare,
  Settings,
  ChevronRight,
  User,
  ShieldAlert,
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
  Wrench,
  BarChart3,
  Percent,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useUpdater } from '@/hooks/use-updater'
import { canAccessFinanceiroTools } from '@/lib/permissions'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from '@/components/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const navItems = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Chat', url: '/chat', icon: MessageSquare },
]

export function AppSidebar() {
  const location = useLocation()
  const { user } = useAuth()
  const isSettingsActive = location.pathname.startsWith('/settings')
  const isToolsActive = location.pathname.startsWith('/ferramentas')
  const { isElectron, status, version, checkForUpdates, installUpdate } = useUpdater()

  return (
    <Sidebar className="border-r border-border bg-sidebar">
      <SidebarHeader className="px-4 py-0 border-b border-border h-16 flex flex-col justify-center">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="Logo" className="h-9 w-9 object-contain" />
          <span className="text-xl font-display font-bold tracking-tight text-sidebar-foreground">
            Central Whats
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-3 mt-6">
        <SidebarMenu className="gap-2">
          {navItems.map((item) => {
            const isActive = location.pathname === item.url
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={item.title}
                  className={`py-5 transition-all duration-300 relative group ${isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent'}`}
                >
                  <Link to={item.url} className="flex items-center gap-3 w-full">
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-blue-500 rounded-r-full shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
                    )}
                    <item.icon
                      className={`h-5 w-5 transition-transform duration-300 group-hover:scale-110 ${isActive ? 'text-blue-400' : 'text-muted-foreground group-hover:text-foreground'}`}
                    />
                    <span className="text-sm font-medium">{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}

          {user?.is_admin && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={location.pathname === '/admin'}
                tooltip="Gestão de Equipe"
                className={`py-5 transition-all duration-300 relative group ${location.pathname === '/admin' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent'}`}
              >
                <Link to="/admin" className="flex items-center gap-3 w-full">
                  {location.pathname === '/admin' && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-blue-500 rounded-r-full shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
                  )}
                  <ShieldAlert
                    className={`h-5 w-5 transition-transform duration-300 group-hover:scale-110 ${location.pathname === '/admin' ? 'text-blue-400' : 'text-muted-foreground group-hover:text-foreground'}`}
                  />
                  <span className="text-sm font-medium">Gestão de Equipe</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {canAccessFinanceiroTools(user) && (
            <>
              <div className="my-4 mx-2 h-px bg-sidebar-accent" />
              <Collapsible defaultOpen={isToolsActive} className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip="Ferramentas"
                      isActive={isToolsActive}
                      className="py-5"
                    >
                      <Wrench className="h-5 w-5" />
                      <span className="text-sm">Ferramentas</span>
                      <ChevronRight className="ml-auto h-4 w-4 text-sidebar-foreground/60 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-1">
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={location.pathname === '/ferramentas/analise-prn'}
                        >
                          <Link to="/ferramentas/analise-prn" className="py-4">
                            <BarChart3 className="h-4 w-4" />
                            <span>Análise PRN</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={location.pathname === '/ferramentas/rateio-mobilemed'}
                        >
                          <Link to="/ferramentas/rateio-mobilemed" className="py-4">
                            <Percent className="h-4 w-4" />
                            <span>Rateio Mobilemed</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </>
          )}

          <div className="my-4 mx-2 h-px bg-sidebar-accent" />

          <Collapsible defaultOpen={isSettingsActive} className="group/collapsible">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  tooltip="Configurações"
                  isActive={isSettingsActive}
                  className="py-5"
                >
                  <Settings className="h-5 w-5" />
                  <span className="text-sm">Configurações</span>
                  <ChevronRight className="ml-auto h-4 w-4 text-sidebar-foreground/60 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1">
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      asChild
                      isActive={location.pathname === '/settings/devices'}
                    >
                      <Link to="/settings/devices" className="py-4">
                        <Smartphone className="h-4 w-4" />
                        <span>Aparelhos</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  {user?.is_admin && (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        asChild
                        isActive={location.pathname === '/settings/instances'}
                      >
                        <Link to="/settings/instances" className="py-4">
                          <Smartphone className="h-4 w-4" />
                          <span>Instâncias Evolution</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  )}
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      asChild
                      isActive={location.pathname === '/settings/general'}
                    >
                      <Link to="/settings/general" className="py-4">
                        <User className="h-4 w-4" />
                        <span>Perfil e Geral</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        </SidebarMenu>
      </SidebarContent>

      {isElectron && (
        <SidebarFooter className="px-3 py-3 border-t border-border">
          {status.type === 'ready' ? (
            <button
              onClick={installUpdate}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span>Instalar v{status.version} e reiniciar</span>
            </button>
          ) : (
            <button
              onClick={checkForUpdates}
              disabled={status.type === 'checking' || status.type === 'downloading'}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {status.type === 'checking' && (
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
              )}
              {status.type === 'downloading' && (
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
              )}
              {status.type === 'up-to-date' && (
                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
              )}
              {status.type === 'error' && (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
              )}
              {(status.type === 'idle' || status.type === 'available') && (
                <RefreshCw className="h-3.5 w-3.5 shrink-0" />
              )}
              <span>
                {status.type === 'idle' && `v${version ?? '...'} · Verificar atualização`}
                {status.type === 'checking' && 'Verificando...'}
                {status.type === 'up-to-date' && 'Você está atualizado'}
                {status.type === 'available' && `Baixando v${status.version}...`}
                {status.type === 'downloading' && `Baixando... ${status.percent}%`}
                {status.type === 'error' && 'Erro ao verificar'}
              </span>
            </button>
          )}
        </SidebarFooter>
      )}
    </Sidebar>
  )
}
