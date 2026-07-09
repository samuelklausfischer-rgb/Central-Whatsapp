import { Mail, ChevronDown, Wifi, WifiOff, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { EmailAccount } from '@/lib/supabase/email-types'
import { useNavigate } from 'react-router-dom'

interface Props {
  accounts: EmailAccount[]
  selectedAccountId: string | null
  onSelect: (id: string) => void
  unreadCounts?: Record<string, number>
}

const providerLabel: Record<string, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  imap: 'IMAP',
}

export function AccountSwitcher({ accounts, selectedAccountId, onSelect, unreadCounts = {} }: Props) {
  const navigate = useNavigate()
  const selected = accounts.find((a) => a.id === selectedAccountId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between h-auto px-3 py-2.5 hover:bg-accent rounded-lg"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Mail className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 text-left">
              <p className="text-sm font-medium truncate">
                {selected ? selected.label : 'Selecionar conta'}
              </p>
              {selected && (
                <p className="text-xs text-muted-foreground truncate">{selected.email}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {selected && unreadCounts[selected.id] > 0 && (
              <Badge variant="destructive" className="text-xs px-1.5 py-0 min-w-[1.25rem] h-5">
                {unreadCounts[selected.id] > 99 ? '99+' : unreadCounts[selected.id]}
              </Badge>
            )}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </div>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Contas de email
        </DropdownMenuLabel>

        {accounts.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma conta configurada</p>
          </div>
        ) : (
          accounts.map((account) => (
            <DropdownMenuItem
              key={account.id}
              onClick={() => onSelect(account.id)}
              className="flex items-center gap-3 py-2.5 cursor-pointer"
            >
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Mail className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{account.label}</p>
                  <span className="text-xs text-muted-foreground">
                    {providerLabel[account.provider] ?? account.provider}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{account.email}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {unreadCounts[account.id] > 0 && (
                  <Badge variant="destructive" className="text-xs px-1.5 py-0 min-w-[1.25rem] h-5">
                    {unreadCounts[account.id] > 99 ? '99+' : unreadCounts[account.id]}
                  </Badge>
                )}
                {account.is_active ? (
                  <Wifi className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigate('/settings/email-accounts')}
          className="cursor-pointer text-muted-foreground"
        >
          <Plus className="mr-2 h-4 w-4" />
          Adicionar conta de email
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
