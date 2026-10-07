import { useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { useToolAccess } from '@/hooks/use-tool-access'
import { destinosPrincipais } from '@/lib/navegacao'
import {
  subscreverFerramentas,
  lerFerramentas,
  fecharFerramenta,
  MAX_FERRAMENTAS_VIVAS,
} from '@/stores/ferramentasVivas'

/** O pouco que a barra precisa saber de cada ferramenta — título e rota. */
export type RegistroDeAbas = Record<string, { titulo: string; url: string }>

/**
 * `true` quando a barra deve aparecer em cima do WhatsApp: desktop, rota `/chat`
 * e ao menos uma ferramenta viva.
 *
 * Sem ferramenta viva o chat fica exatamente como era — sem barra, sem faixa
 * vazia. E no celular nada muda: o `MobileTabBar` já leva ao WhatsApp, e a
 * conversa aberta ocupa a tela inteira (`semCasca` no `Layout`).
 *
 * Vive aqui, ao lado da barra, e não no `Layout`, para que a regra de "quando
 * aparece" e o desenho fiquem num lugar só. O `Layout` precisa saber o resultado
 * porque a altura do chat muda junto (ver o comentário lá).
 */
export function useBarraNoChat(): boolean {
  // O snapshot é um booleano, e não o estado inteiro: o `Layout` usa este hook, e
  // assim ele só re-renderiza quando "há ferramenta viva" vira verdadeiro ou
  // falso — não a cada troca de aba.
  const haViva = useSyncExternalStore(
    subscreverFerramentas,
    () => lerFerramentas().vivas.length > 0,
    () => false,
  )
  const { pathname } = useLocation()
  const noCelular = useIsMobile()
  return !noCelular && pathname.startsWith('/chat') && haViva
}

/**
 * Abas de navegação entre o WhatsApp e as ferramentas abertas.
 *
 * Existe por um pedido da Raphaela (07/10/2026), vindo de /ferramentas/faturamento:
 * "colocar o WhatsApp como opção de aba, para poder navegar entre WhatsApp e demais
 * aplicações". Antes, a barra só existia DENTRO de uma ferramenta, e o WhatsApp só
 * se alcançava pelo menu — e quem estava no chat não via que havia ferramentas
 * abertas esperando por ele.
 *
 * A ABA DO WHATSAPP NÃO É UMA FERRAMENTA
 * Ela é fixa, vem sempre primeiro e não entra em `vivas`: não conta no teto de
 * `MAX_FERRAMENTAS_VIVAS`, não tem ✕ e não participa do descarte. É só um atalho
 * para a rota `/chat`, que continua sendo uma rota comum — o `ChatHub` desmonta ao
 * sair dela e se reconstrói sozinho, com o aparelho e a conversa que estavam
 * abertos, a partir do `sessionStorage` (`activeDeviceId` / `activeContactJid`).
 * Por isso o clique vai para `/chat` puro, sem `?device=&jid=`: a URL velha podia
 * carregar um aparelho e uma conversa de antes, e o que vale é o último estado.
 *
 * Não reordena nada: as abas de ferramenta seguem a ordem de montagem de `vivas`,
 * que não pode mudar (mover um `<iframe>` no DOM o recarrega — ver
 * `stores/ferramentasVivas.ts`). Esta barra só LÊ a lista.
 *
 * O registro das ferramentas chega por prop, e não por import do `ToolHost`, para
 * não criar um ciclo (`ToolHost` desenha esta barra).
 */
export function BarraDeAbas({ ferramentas }: { ferramentas: RegistroDeAbas }) {
  const { vivas, ativa } = useSyncExternalStore(subscreverFerramentas, lerFerramentas, lerFerramentas)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const acesso = useToolAccess()
  const noCelular = useIsMobile()

  // Mesma fonte do menu do topo e do rodapé do celular: o destino só existe aqui
  // se a pessoa enxerga a tela `tela-chat`. Quem não vê nunca ganha a aba.
  const destinoWhats = destinosPrincipais(acesso).find((d) => d.url === '/chat')
  const mostrarWhats = !noCelular && !!destinoWhats
  const whatsAtivo = pathname.startsWith('/chat')

  return (
    <div className="flex items-center gap-1 px-4 pt-3 pb-2 flex-wrap flex-shrink-0">
      {mostrarWhats && destinoWhats && (
        <button
          type="button"
          // Já está no chat: navegar para `/chat` puro apagaria o `?device=` da
          // URL à toa.
          onClick={() => {
            if (!whatsAtivo) navigate('/chat')
          }}
          aria-current={whatsAtivo ? 'page' : undefined}
          className={cn(
            'flex items-center gap-1.5 pl-2.5 pr-3 py-1 rounded-full text-xs font-medium border transition-colors',
            whatsAtivo
              ? 'bg-accent text-foreground border-border'
              : 'text-muted-foreground border-transparent hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <destinoWhats.icon className="h-3.5 w-3.5" />
          WhatsApp
        </button>
      )}
      {vivas.map((slug) => {
        const f = ferramentas[slug]
        if (!f) return null
        const ehAtiva = slug === ativa
        return (
          <div
            key={slug}
            className={cn(
              'flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full text-xs border transition-colors',
              ehAtiva
                ? 'bg-accent text-foreground border-border'
                : 'text-muted-foreground border-transparent hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <button onClick={() => navigate(f.url)} className="font-medium">
              {f.titulo}
            </button>
            <button
              onClick={() => {
                fecharFerramenta(slug)
                // Fechar a que está na tela precisa levar a pessoa a algum
                // lugar — senão sobra um vazio sem explicação. Fechar uma aba
                // estando no WhatsApp não passa por aqui (`ativa` é `null`
                // lá), então a pessoa continua no chat.
                if (ehAtiva) {
                  const proxima = vivas.find((s) => s !== slug)
                  navigate(proxima ? ferramentas[proxima]?.url ?? '/dashboard' : '/dashboard')
                }
              }}
              title={`Fechar ${f.titulo}`}
              aria-label={`Fechar ${f.titulo}`}
              className="p-0.5 rounded-full opacity-50 hover:opacity-100 hover:bg-background/60"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
      {vivas.length >= MAX_FERRAMENTAS_VIVAS && (
        <span className="text-[10px] text-muted-foreground/60 ml-1">
          abrir outra fecha a mais antiga
        </span>
      )}
    </div>
  )
}
