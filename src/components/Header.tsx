import {
  LogOut,
  Sun,
  Moon,
  LayoutGrid,
  ChevronDown,
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState } from 'react'
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
import { useToolAccess } from '@/hooks/use-tool-access'
import { DESTINOS_PRINCIPAIS, gruposDeFerramentas, itensDeConta, ehAcao } from '@/lib/navegacao'
import { cn } from '@/lib/utils'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { ReleaseNotesDialog } from '@/components/ReleaseNotesDialog'
import { ReportarProblemaDialog } from '@/components/ReportarProblemaDialog'
import { NotificationsDialog } from '@/components/NotificationsDialog'
import { useUpdater } from '@/hooks/use-updater'
import { BrandLogo } from '@/components/BrandLogo'

/**
 * O menu era um painel próprio, fechado por um listener de `mousedown` no
 * documento. Virou `DropdownMenu` (Radix) quando ganhou duas colunas: com 520px
 * de largura, ancorado num botão que fica a ~430px da esquerda, o painel saía
 * pela direita em janela estreita — e a casca de desktop vai até 768px. O Radix
 * reposiciona sozinho quando não cabe; o listener manual não fazia nada disso.
 *
 * De brinde vieram o fechar com `Esc` e a navegação por setas.
 */
function FerramentasMenu() {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Mesmos grupos (e mesmos gates) que a folha "Mais" do celular usa.
  const grupos = gruposDeFerramentas(user, useToolAccess())

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="group gap-1.5 rounded-full h-9 px-4 border border-border text-muted-foreground transition-all duration-200 hover:text-foreground hover:bg-accent data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="text-sm font-medium hidden sm:block">Ferramentas</span>
          <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className={cn(
          'p-0 rounded-xl bg-popover backdrop-blur-xl border-border',
          // Uma coluna por grupo. Quem não tem nenhum sistema liberado recebe um
          // grupo só, e aí o painel volta à largura estreita de antes.
          grupos.length > 1 ? 'w-[520px] grid grid-cols-2' : 'w-72',
        )}
      >
        {grupos.map((grupo, i) => (
          <div key={grupo.titulo} className={cn('p-2', i > 0 && 'border-l border-border')}>
            <DropdownMenuLabel className="px-2 pt-1 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              {grupo.titulo}
            </DropdownMenuLabel>
            {grupo.itens.map((item) => (
              <DropdownMenuItem
                key={item.url}
                onSelect={() => navigate(item.url)}
                // `group/item`: o quadrado do ícone precisa clarear quando a
                // linha inteira escurece, senão ele some dentro do destaque.
                className="group/item cursor-pointer gap-2.5 rounded-lg px-2 py-2"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent transition-colors duration-150 group-focus/item:bg-background">
                  <item.icon className="h-4 w-4 text-foreground/70 group-focus/item:text-foreground" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground leading-tight">
                    {item.title}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground leading-tight mt-0.5">
                    {item.description}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Header() {
  const { user, signOut } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const location = useLocation()
  const { isElectron, status, version, checkForUpdates, installUpdate } = useUpdater()
  // Notificações saiu do menu de ferramentas e virou item de conta, então o
  // diálogo passa a ser aberto daqui.
  const [notifOpen, setNotifOpen] = useState(false)

  const avatarUrl = user?.avatar_url || undefined
  const userInitials = (user?.name?.[0] || user?.username?.[0] || 'U').toUpperCase()
  const isDark = resolvedTheme === 'dark'

  // Mesmos destinos que viram as abas do rodapé no celular.
  const navLinks = DESTINOS_PRINCIPAIS

  return (
    <>
      <header className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
        {/* Logo */}
        <Link to="/dashboard" className="flex items-center shrink-0 mr-2">
          <BrandLogo className="h-10 w-auto object-contain" />
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
            (status.type === 'available' ||
              status.type === 'downloading' ||
              status.type === 'ready') && (
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

              {/*
              Os itens vinham escritos à mão aqui e de novo em `lib/navegacao`,
              que a folha do celular usa. Passar a ler a mesma lista é o que faz
              "Notificações" aparecer nos dois lugares sem ser adicionada duas
              vezes — e o gate de admin ser uma decisão só.
            */}
              {itensDeConta(user).map((item) =>
                ehAcao(item) ? (
                  <DropdownMenuItem
                    key={item.title}
                    // `preventDefault` segura o foco: sem ele o menu devolve o foco
                    // ao avatar no mesmo instante em que o diálogo tenta pegá-lo, e
                    // o diálogo abre sem foco.
                    onSelect={(e) => {
                      e.preventDefault()
                      setNotifOpen(true)
                    }}
                    className="focus:bg-accent focus:text-accent-foreground cursor-pointer"
                  >
                    <item.icon className="mr-2 h-4 w-4" />
                    <span>{item.title}</span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    key={item.title}
                    asChild
                    className="focus:bg-accent focus:text-accent-foreground cursor-pointer"
                  >
                    <Link to={item.url}>
                      <item.icon className="mr-2 h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </DropdownMenuItem>
                ),
              )}

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

      <NotificationsDialog open={notifOpen} onOpenChange={setNotifOpen} />
    </>
  )
}
