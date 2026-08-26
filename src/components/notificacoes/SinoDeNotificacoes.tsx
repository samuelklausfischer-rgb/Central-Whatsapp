import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Bell, CalendarDays, CheckCheck, Trash2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCaixaDeNotificacoes } from '@/hooks/use-notificacoes'
import type { Notificacao } from '@/services/notificacoes'

/**
 * O sino do cabeçalho.
 *
 * Só DESENHA — quem carrega e escuta é o `useNotificacoes()` montado no
 * `Layout`. Este componente aparece duas vezes (no `Header` do desktop e no
 * `MobileHeader`), e os dois leem a mesma store.
 */

/** Ícone por tipo. Hoje só agenda; tarefa e hub entram sem mexer no resto. */
function iconeDoTipo(tipo: string) {
  if (tipo === 'agenda') return CalendarDays
  return Bell
}

function Item({
  n,
  aoClicar,
}: {
  n: Notificacao
  aoClicar: (n: Notificacao) => void
}) {
  const Icone = iconeDoTipo(n.tipo)
  const naoLida = !n.lida_em
  return (
    <button
      type="button"
      onClick={() => aoClicar(n)}
      className={cn(
        'flex w-full items-start gap-2.5 border-b border-border/40 p-3 text-left last:border-b-0',
        naoLida ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-accent/50',
      )}
    >
      <span className="relative mt-0.5 shrink-0">
        <Icone className="h-4 w-4 text-muted-foreground" />
        {/* O ponto marca a não lida sem depender de cor de fundo — que muda
            entre os temas e entre as regiões da foto atrás do vidro. */}
        {naoLida && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm leading-snug', naoLida && 'font-medium')}>
          {n.titulo}
        </span>
        {n.corpo && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{n.corpo}</span>
        )}
        <span className="mt-1 block text-[11px] text-muted-foreground">
          {formatDistanceToNow(new Date(n.criada_em), { addSuffix: true, locale: ptBR })}
        </span>
      </span>
    </button>
  )
}

export function SinoDeNotificacoes({ className }: { className?: string }) {
  const navigate = useNavigate()
  const [aberto, setAberto] = useState(false)
  const { lista, naoLidas, lerUma, lerTodas, limpar } = useCaixaDeNotificacoes()

  const abrir = (n: Notificacao) => {
    void lerUma(n.id)
    setAberto(false)
    if (n.link) navigate(n.link)
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative', className)}
          aria-label={naoLidas > 0 ? `Notificações (${naoLidas} não lidas)` : 'Notificações'}
        >
          <Bell className="h-4.5 w-4.5" />
          {naoLidas > 0 && (
            /*
              `bg-red-600` e não `red-500`: medido, o branco sobre red-500 dá
              3,76:1 e sobre red-600 dá 4,83:1 — o mínimo legível é 4,5:1. Fundo
              sólido, então serve nos dois temas sem variante `dark:`.
            */
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
              {naoLidas > 99 ? '99+' : naoLidas}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border/60 p-3">
          <span className="text-sm font-medium">Notificações</span>
          {lista.length > 0 && (
            <div className="flex items-center gap-1">
              {naoLidas > 0 && (
                <button
                  type="button"
                  onClick={() => void lerTodas()}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  title="Marcar todas como lidas"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Marcar lidas
                </button>
              )}
              {lista.some((n) => n.lida_em) && (
                <button
                  type="button"
                  onClick={() => void limpar()}
                  className="ml-2 text-muted-foreground hover:text-foreground"
                  title="Limpar as já lidas"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="max-h-96 overflow-auto">
          {lista.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nada por aqui.
              <span className="mt-1 block text-xs">
                Você é avisado quando alguém marca um compromisso do seu setor, de um grupo seu
                ou designado a você.
              </span>
            </p>
          ) : (
            lista.map((n) => <Item key={n.id} n={n} aoClicar={abrir} />)
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
