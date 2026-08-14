import { Link } from 'react-router-dom'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/hooks/use-auth'
import { BrandLogo } from '@/components/BrandLogo'

/**
 * Barra de cima do celular: logo e avatar, só.
 *
 * A barra do desktop empilha logo + 3 links + menu de ferramentas + 4 controles
 * numa linha sem quebra. Em 360px isso estoura, e o que sai da tela é o fim da
 * fila — justamente o menu do usuário. Aqui os destinos moram nas abas de baixo
 * e na folha "Mais"; esta barra guarda só identidade e o atalho da conta.
 *
 * O avatar abre a MESMA folha do botão "Mais". São duas portas para o mesmo
 * lugar de propósito: uma onde o polegar alcança, outra onde a pessoa procura
 * conta e sair.
 */
export function MobileHeader({ onAbrirMais }: { onAbrirMais: () => void }) {
  const { user } = useAuth()
  const iniciais = (user?.name?.[0] || user?.username?.[0] || 'U').toUpperCase()

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur-xl">
      <Link to="/dashboard" className="flex shrink-0 items-center">
        <BrandLogo className="h-7 w-auto object-contain" />
      </Link>

      <div className="ml-auto">
        <button
          type="button"
          onClick={onAbrirMais}
          aria-label="Conta e mais opções"
          className="flex h-10 w-10 items-center justify-center rounded-full active:bg-accent"
        >
          <Avatar className="h-8 w-8 border border-border">
            <AvatarImage src={user?.avatar_url || undefined} alt={user?.name || 'Usuário'} />
            <AvatarFallback className="bg-primary/20 text-xs text-primary">{iniciais}</AvatarFallback>
          </Avatar>
        </button>
      </div>
    </header>
  )
}
