import { lazy, Suspense, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import {
  subscreverFerramentas,
  lerFerramentas,
  fecharFerramenta,
  MAX_FERRAMENTAS_VIVAS,
} from '@/stores/ferramentasVivas'

const AnalisePrn = lazy(() => import('@/pages/tools/AnalisePrn'))
const RateioMobilemed = lazy(() => import('@/pages/tools/RateioMobilemed'))
const RelatorioApp = lazy(() => import('@/pages/tools/RelatorioApp'))
const Relatorios = lazy(() => import('@/pages/tools/Relatorios'))
const Licitacoes = lazy(() => import('@/pages/tools/Licitacoes'))
const Assinaturas = lazy(() => import('@/pages/tools/Assinaturas'))
const PropostaComercial = lazy(() => import('@/pages/tools/PropostaComercial'))
const PrnHub = lazy(() => import('@/pages/tools/PrnHub'))

interface FerramentaHospedavel {
  titulo: string
  url: string
  Componente: React.ComponentType
  /**
   * `true` para as embutidas por iframe: elas gerenciam a própria altura e não
   * podem receber o respiro/largura máxima do painel, senão o app filho fica
   * espremido e com barra de rolagem dupla.
   */
  telaCheia?: boolean
}

/**
 * O `slug` é o pedaço final da rota. Ele aparece aqui e no `App.tsx` — se os dois
 * divergirem a ferramenta abre em branco, então ambos usam a mesma string.
 */
export const FERRAMENTAS_HOSPEDADAS: Record<string, FerramentaHospedavel> = {
  'analise-prn': { titulo: 'Análise PRN', url: '/ferramentas/analise-prn', Componente: AnalisePrn },
  'rateio-mobilemed': { titulo: 'Rateio', url: '/ferramentas/rateio-mobilemed', Componente: RateioMobilemed },
  'relatorio-app': { titulo: 'Relatório App', url: '/ferramentas/relatorio-app', Componente: RelatorioApp },
  relatorios: { titulo: 'Relatórios', url: '/ferramentas/relatorios', Componente: Relatorios, telaCheia: true },
  licitacoes: { titulo: 'Licitações', url: '/ferramentas/licitacoes', Componente: Licitacoes, telaCheia: true },
  // ITEM 2. `telaCheia` como as outras embutidas por iframe: o app filho cuida
  // da própria altura, e o respiro do painel daria barra de rolagem dupla.
  'prn-hub': { titulo: 'PRN Hub', url: '/ferramentas/prn-hub', Componente: PrnHub, telaCheia: true },
  assinaturas: { titulo: 'Assinaturas', url: '/ferramentas/assinaturas', Componente: Assinaturas },
  'proposta-comercial': {
    titulo: 'Proposta Comercial',
    url: '/ferramentas/proposta-comercial',
    Componente: PropostaComercial,
  },
}

/**
 * O que aparece no lugar de uma ferramenta que quebrou.
 *
 * Precisa ser CONTIDO: a tela padrão do `ErrorBoundary` é `fixed inset-0`, feita
 * para falha do app inteiro. Usada aqui, ela cobriria tudo — exatamente o que
 * esta barreira existe para evitar.
 */
function FerramentaQuebrou({ titulo }: { titulo: string }) {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="font-medium">A ferramenta {titulo} não abriu</span>
      <p className="max-w-sm text-sm text-muted-foreground">
        O resto do app continua funcionando. Feche a aba da ferramenta e abra de novo; se insistir,
        use o botão "Reportar problema".
      </p>
      <button
        onClick={() => window.location.reload()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Recarregar
      </button>
    </div>
  )
}

/**
 * Mantém as ferramentas abertas montadas, mostrando só a ativa.
 *
 * Vive dentro do `Layout`, que NÃO desmonta ao trocar de rota — é isso que faz o
 * trabalho sobreviver a uma ida ao WhatsApp.
 *
 * POR QUE `invisible` E NÃO `hidden`
 * `hidden` é `display:none`, e isso descola o elemento da árvore de layout. Num
 * iframe o efeito é destrutivo: ao reaparecer, o navegador remonta o layout e a
 * posição interna se perde — foi o que fez Licitações voltar ao topo depois de
 * uma ida ao WhatsApp. `visibility:hidden` mantém a caixa, o tamanho e a rolagem
 * de pé; o navegador só não pinta. Custa layout, e é por isso que existe o teto
 * de ferramentas vivas.
 *
 * POR QUE CADA UMA TEM A SUA ROLAGEM
 * Se a rolagem fosse a do `<main>` do Layout, ela seria compartilhada entre todas
 * as telas: voltar de outra página traria a posição da página anterior, ou zero.
 * Com um contêiner de rolagem por ferramenta, a posição é naturalmente de cada
 * uma — e sobrevive porque a caixa nunca sai do layout.
 */
export function ToolHost() {
  const { vivas, ativa } = useSyncExternalStore(subscreverFerramentas, lerFerramentas, lerFerramentas)
  const navigate = useNavigate()

  // A raiz é SEMPRE `absolute inset-0` (o `<main>` do Layout é `relative`), com
  // ou sem ferramenta ativa. Manter a mesma caixa o tempo todo evita que trocar
  // de tela redimensione os iframes — mudança de tamanho é outra forma de perder
  // a posição de rolagem interna.
  const escondido = ativa === null || vivas.length === 0

  return (
    <div
      aria-hidden={escondido}
      className={cn(
        'absolute inset-0 flex flex-col',
        escondido && 'invisible pointer-events-none -z-10',
      )}
    >
      {/*
        Barra de abas: só com mais de uma ferramenta aberta. Com uma só não
        informaria nada e seria mais uma faixa ocupando o topo — o pedido era
        algo discreto.
      */}
      {!escondido && vivas.length > 1 && (
        <div className="flex items-center gap-1 px-4 pt-3 pb-2 flex-wrap flex-shrink-0">
          {vivas.map((slug) => {
            const f = FERRAMENTAS_HOSPEDADAS[slug]
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
                    // lugar — senão sobra um vazio sem explicação.
                    if (ehAtiva) {
                      const proxima = vivas.find((s) => s !== slug)
                      navigate(proxima ? FERRAMENTAS_HOSPEDADAS[proxima]?.url ?? '/dashboard' : '/dashboard')
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
      )}

      <div className="relative flex-1 min-h-0">
        {vivas.map((slug) => {
          const f = FERRAMENTAS_HOSPEDADAS[slug]
          if (!f) return null
          const { Componente } = f
          const fora = slug !== ativa
          return (
            <div
              key={slug}
              aria-hidden={fora}
              className={cn(
                'absolute inset-0',
                // O respiro e a largura máxima que o Layout dava para as páginas
                // comuns passam a ser aplicados aqui, porque as rotas de
                // ferramenta agora ocupam a altura toda.
                f.telaCheia ? 'overflow-hidden' : 'overflow-y-auto p-4 md:p-6 lg:p-8',
                fora && 'invisible pointer-events-none',
              )}
            >
              <div className={f.telaCheia ? 'h-full' : 'mx-auto w-full max-w-7xl'}>
                {/*
                  Uma barreira POR FERRAMENTA, e não só a do app inteiro.

                  Sem ela, um erro de runtime dentro de uma ferramenta sobe até o
                  `ErrorBoundary` do `App` e apaga a tela toda — a pessoa perde as
                  conversas abertas por causa de um bug numa ferramenta que ela nem
                  estava usando. Com a barreira aqui, o estrago fica dentro do painel
                  da ferramenta e o resto do app continua de pé.
                */}
                <ErrorBoundary
                  label={`ferramenta:${slug}`}
                  fallback={<FerramentaQuebrou titulo={f.titulo} />}
                >
                  <Suspense
                    fallback={
                      <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                        Carregando...
                      </div>
                    }
                  >
                    <Componente />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
