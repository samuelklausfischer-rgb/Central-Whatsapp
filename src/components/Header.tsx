import {
  LogOut,
  Settings,
  Sun,
  Moon,
  LayoutGrid,
  ListTodo,
  StickyNote,
  Zap,
  CalendarClock,
  ChevronDown,
  LayoutDashboard,
  MessageSquare,
  Mail,
  ShieldAlert,
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
  Bell,
  BarChart3,
  Percent,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState, useRef, useEffect } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/hooks/use-auth'
import { canAccessFinanceiroTools } from '@/lib/permissions'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { ReleaseNotesDialog } from '@/components/ReleaseNotesDialog'
import { ReportarProblemaDialog } from '@/components/ReportarProblemaDialog'
import { NotificationsDialog } from '@/components/NotificationsDialog'
import { useUpdater } from '@/hooks/use-updater'
import logoUrl from '/logo.png'

type FerramentaItem =
  | { title: string; description: string; icon: React.ElementType; url: string; action?: never }
  | { title: string; description: string; icon: React.ElementType; action: string; url?: never }

const ferramentas: FerramentaItem[] = [
  { title: 'Tarefas', description: 'Kanban interno', icon: ListTodo, url: '/crm' },
  { title: 'Anotações', description: 'Notas rápidas', icon: StickyNote, url: '/notes' },
  { title: 'Gatilhos', description: 'Mensagens auto', icon: Zap, url: '/triggers' },
  { title: 'Agendamentos', description: 'Envios futuros', icon: CalendarClock, url: '/scheduled-messages' },
  { title: 'Notificações', description: 'Som e alertas', icon: Bell, action: 'notifications' },
]

const prnItem: FerramentaItem = {
  title: 'Análise PRN',
  description: 'Cockpit financeiro',
  icon: BarChart3,
  url: '/ferramentas/analise-prn',
}

const rateioItem: FerramentaItem = {
  title: 'Rateio Mobilemed',
  description: 'Rateio PRN/MedImagem',
  icon: Percent,
  url: '/ferramentas/rateio-mobilemed',
}

function FerramentasMenu() {
  const [open, setOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { user } = useAuth()

  const items = canAccessFinanceiroTools(user) ? [...ferramentas, prnItem, rateioItem] : ferramentas

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleItem(item: FerramentaItem) {
    setOpen(false)
    if (item.url) {
      navigate(item.url)
    } else if (item.action === 'notifications') {
      setNotifOpen(true)
    }
  }

  return (
    <>
      <div ref={ref} className="relative">
        <Button
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          className={`gap-1.5 rounded-full h-9 px-4 border border-border transition-all duration-200 ${open ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="text-sm font-medium hidden sm:block">Ferramentas</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </Button>

        {open && (
          <div className="absolute left-0 top-full mt-2 w-72 rounded-xl border border-border bg-popover shadow-xl z-50 overflow-hidden">
            <div className="px-3 pt-3 pb-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Ferramentas
              </p>
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-2">
              {items.map((item) => (
                <button
                  key={item.title}
                  onClick={() => handleItem(item)}
                  className="flex flex-col items-start gap-1.5 p-3 rounded-lg hover:bg-accent transition-colors duration-150 text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-accent group-hover:bg-background flex items-center justify-center transition-colors duration-150">
                    <item.icon className="h-4 w-4 text-foreground/70 group-hover:text-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground leading-tight">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{item.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <NotificationsDialog open={notifOpen} onOpenChange={setNotifOpen} />
    </>
  )
}

export function Header() {
  const { user, signOut } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const location = useLocation()
  const { isElectron, status, version, checkForUpdates, installUpdate } = useUpdater()

  const avatarUrl = user?.avatar_url || undefined
  const userInitials = (user?.name?.[0] || user?.username?.[0] || 'U').toUpperCase()
  const isDark = resolvedTheme === 'dark'

  const navLinks = [
    { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
    { title: 'Chat', url: '/chat', icon: MessageSquare },
    { title: 'Email', url: '/email', icon: Mail },
  ]

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
      {/* Logo */}
      <Link to="/dashboard" className="flex items-center shrink-0 mr-2">
        <img src={logoUrl} alt="Logo" className="h-12 w-auto object-contain" />
      </Link>

      {/* Nav links */}
      <nav className="flex items-center gap-1">
        {navLinks.map((item) => {
          const isActive = location.pathname.startsWith(item.url)
          return (
            <Link
              key={item.url}
              to={item.url}
              className={`flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-all duration-200 ${isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
            >
              <item.icon className="h-4 w-4" />
              <span className="hidden sm:block">{item.title}</span>
            </Link>
          )
        })}
        <FerramentasMenu />
      </nav>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2">
        <ReleaseNotesDialog />
        <ReportarProblemaDialog />

        {isElectron &&
          (status.type === 'available' || status.type === 'downloading' || status.type === 'ready') && (
            <button
              type="button"
              onClick={() => {
                if (status.type === 'ready') installUpdate()
              }}
              title={
                status.type === 'ready'
                  ? `Clique para instalar v${status.version} e reiniciar`
                  : status.type === 'downloading'
                    ? `Baixando atualização: ${Math.round(status.percent)}%`
                    : 'Nova versão disponível — baixando...'
              }
              className={`flex items-center gap-1.5 rounded-full border px-3 h-8 text-xs font-medium transition-all duration-200 select-none ${
                status.type === 'ready'
                  ? 'border-green-500/40 text-green-500 hover:bg-green-500/10 cursor-pointer'
                  : 'border-blue-500/40 text-blue-400 cursor-default'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full flex-shrink-0 animate-pulse ${status.type === 'ready' ? 'bg-green-500' : 'bg-blue-400'}`}
              />
              <span className="hidden sm:inline">
                {status.type === 'ready'
                  ? `Instalar v${status.version}`
                  : status.type === 'downloading'
                    ? `Baixando ${Math.round(status.percent)}%`
                    : 'Nova versão'}
              </span>
            </button>
          )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          className="rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
          title={isDark ? 'Modo claro' : 'Modo escuro'}
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="rounded-full h-10 pl-2 pr-4 gap-2 hover:bg-accent border border-border transition-all duration-200"
            >
              <Avatar className="h-7 w-7 border-2 border-border">
                <AvatarImage src={avatarUrl} alt={user?.name || 'User'} />
                <AvatarFallback className="bg-primary/20 text-primary text-xs font-medium">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground hidden sm:block">
                {user?.name || user?.username || 'Admin'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-64 bg-popover backdrop-blur-xl border-border"
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none text-foreground">
                  {user?.name || 'Admin'}
                </p>
                <p className="text-xs leading-none text-muted-foreground">@{user?.username}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border" />

            {user?.is_admin && (
              <DropdownMenuItem
                asChild
                className="focus:bg-accent focus:text-accent-foreground cursor-pointer"
              >
                <Link to="/admin">
                  <ShieldAlert className="mr-2 h-4 w-4" />
                  <span>Gestão de Equipe</span>
                </Link>
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              asChild
              className="focus:bg-accent focus:text-accent-foreground cursor-pointer"
            >
              <Link to="/settings/general">
                <Settings className="mr-2 h-4 w-4" />
                <span>Configurações</span>
              </Link>
            </DropdownMenuItem>

            {isElectron && (
              <>
                <DropdownMenuSeparator className="bg-border" />
                {status.type === 'ready' ? (
                  <DropdownMenuItem
                    onClick={installUpdate}
                    className="focus:bg-blue-600/20 focus:text-blue-400 cursor-pointer text-blue-400"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    <span>Instalar v{status.version} e reiniciar</span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={checkForUpdates}
                    disabled={status.type === 'checking' || status.type === 'downloading'}
                    className="focus:bg-accent focus:text-accent-foreground cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {status.type === 'checking' || status.type === 'downloading' ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : status.type === 'up-to-date' ? (
                      <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                    ) : status.type === 'error' ? (
                      <AlertCircle className="mr-2 h-4 w-4 text-red-400" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    <span>
                      {status.type === 'idle' && `v${version ?? '...'} · Verificar atualização`}
                      {status.type === 'checking' && 'Verificando...'}
                      {status.type === 'up-to-date' && 'Você está atualizado'}
                      {status.type === 'available' && `Baixando v${status.version}...`}
                      {status.type === 'downloading' && `Baixando... ${status.percent}%`}
                      {status.type === 'error' && 'Erro ao verificar'}
                    </span>
                  </DropdownMenuItem>
                )}
              </>
            )}

            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={signOut}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sair</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
