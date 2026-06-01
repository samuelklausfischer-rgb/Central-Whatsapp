import { Bell, Search, LogOut, Settings, Sun, Moon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Input } from '@/components/ui/input'
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
import { Link } from 'react-router-dom'

export function Header() {
  const { user, signOut } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()

  const avatarUrl = user?.avatar_url || undefined

  const userInitials = (user?.name?.[0] || user?.username?.[0] || 'U').toUpperCase()

  const isDark = resolvedTheme === 'dark'

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
      <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />

      <div className="flex flex-1 items-center gap-4 md:gap-8">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar conversas, tarefas ou anotações..."
            className="w-full rounded-full bg-accent pl-10 border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:bg-accent/80 transition-all duration-200 h-10"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="relative rounded-full text-muted-foreground hover:text-foreground"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-500 animate-pulse-ring"></span>
          </Button>

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
              className="w-56 bg-popover backdrop-blur-xl border-border"
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
              <DropdownMenuItem
                asChild
                className="focus:bg-accent focus:text-accent-foreground cursor-pointer"
              >
                <Link to="/settings/general">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Perfil e Configurações</span>
                </Link>
              </DropdownMenuItem>
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
      </div>
    </header>
  )
}
