import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Smartphone,
  MessageSquare,
  ListTodo,
  StickyNote,
  Settings,
  ChevronRight,
  User,
  Zap,
  ShieldAlert,
  CalendarClock,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import {
  Sidebar,
  SidebarContent,
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
  { title: 'Tarefas Internas', url: '/crm', icon: ListTodo },
  { title: 'Anotações', url: '/notes', icon: StickyNote },
  { title: 'Gatilhos', url: '/triggers', icon: Zap },
  { title: 'Agendamentos', url: '/scheduled-messages', icon: CalendarClock },
]

export function AppSidebar() {
  const location = useLocation()
  const { user } = useAuth()
  const isSettingsActive = location.pathname.startsWith('/settings')

  return (
    <Sidebar className="border-r border-border bg-sidebar backdrop-blur-2xl">
      <SidebarHeader className="px-4 py-0 border-b border-border h-16 flex flex-col justify-center">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shadow-[inset_0_0_10px_rgba(30,64,175,0.4)]">
            <Smartphone className="h-5 w-5 text-blue-400" />
          </div>
          <span className="text-xl font-display font-bold tracking-tight text-sidebar-foreground">
            CentralCell
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
    </Sidebar>
  )
}
