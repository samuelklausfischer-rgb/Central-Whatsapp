import { Link, useLocation } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DESTINOS_PRINCIPAIS } from '@/lib/navegacao'

/**
 * Abas fixas no rodapé.
 *
 * Ficam embaixo, e não em cima, porque é onde o polegar alcança sem trocar a
 * mão de posição — o mesmo motivo pelo qual WhatsApp e Instagram fazem assim.
 *
 * O espaço da barra de navegação do Android já é reservado pelo
 * `.app-safe-areas` no `Layout`, então as abas não nascem embaixo dela.
 */
export function MobileTabBar({ onAbrirMais }: { onAbrirMais: () => void }) {
  const location = useLocation()

  return (
    <nav className="relative z-30 flex shrink-0 items-stretch border-t border-border bg-background/95 backdrop-blur-xl">
      {DESTINOS_PRINCIPAIS.map((item) => {
        const ativo = location.pathname.startsWith(item.url)
        return (
          <Link
            key={item.url}
            to={item.url}
            aria-current={ativo ? 'page' : undefined}
            // ITEM 5: mesma âncora do Header — ver o comentário lá.
            data-tour={item.url}
            // `min-h-[56px]`: alvo de toque confortável.
            className={cn(
              'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors',
              ativo ? 'text-primary' : 'text-muted-foreground active:bg-accent',
            )}
          >
            <item.icon className="h-[22px] w-[22px]" />
            <span className="text-[11px] font-medium leading-none">{item.title}</span>
          </Link>
        )
      })}

      <button
        type="button"
        onClick={onAbrirMais}
        // ITEM 5: no celular é este botão que guarda ferramentas, notificações e
        // configurações — o equivalente ao menu do avatar no computador. Os dois
        // levam o mesmo `data-tour`, então o tour tem um passo só para os dois.
        data-tour="conta"
        className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-muted-foreground transition-colors active:bg-accent"
      >
        <MoreHorizontal className="h-[22px] w-[22px]" />
        <span className="text-[11px] font-medium leading-none">Mais</span>
      </button>
    </nav>
  )
}
