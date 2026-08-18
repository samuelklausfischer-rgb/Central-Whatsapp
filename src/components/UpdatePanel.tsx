/* Conteúdo do splash de atualização — puramente apresentacional, sem IPC nem
   timers próprios. Quem decide QUANDO mostrar cada estado é o UpdateGate; este
   componente só sabe DESENHAR o estado que recebe. Isolado assim para o
   harness de dev conseguir montar e alternar os 5 estados sem Electron.
   Renderiza só o interior do GlassPanel (o próprio GlassPanel com o conteúdo
   dentro) — o AuthShell (fundo/foto/scrim) é responsabilidade do UpdateGate. */
import { CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { GlassPanel } from '@/components/ui/glass-panel'
import { Progress } from '@/components/ui/progress'
import type { UpdateStatus } from '@/hooks/use-updater'
import { cn } from '@/lib/utils'

/** Raio e perímetro do anel de progresso (SVG `stroke-dasharray`). */
const RAIO_DO_ANEL = 40
const PERIMETRO_DO_ANEL = 2 * Math.PI * RAIO_DO_ANEL

export function UpdatePanel({
  status,
  version,
  progressoDaVerificacao,
  onInstall,
}: {
  status: UpdateStatus
  /** Versão atual instalada do app; vai no rodapé discreto. */
  version: string | null
  /** 0-100: avanço do piso de 5s, usado no estado `checking`. */
  progressoDaVerificacao: number
  onInstall: () => void
}) {
  return (
    <GlassPanel className="flex flex-col items-center gap-6 text-center">
      <div className="flex flex-col items-center gap-1">
        <span className="text-2xl font-semibold tracking-tight">PRN Hub</span>
        <span className="text-sm text-muted-foreground">Mantendo você na versão mais recente</span>
      </div>

      {/* `role="status"` + `aria-live="polite"`: o conteúdo daqui troca sozinho
          (verificando → encontrada → baixando → pronta) sem nenhuma ação do
          usuário. Sem isso, quem usa leitor de tela não fica sabendo que a
          atualização terminou de baixar nem que apareceu um botão de instalar. */}
      <div className="flex w-full flex-col items-center gap-4" role="status" aria-live="polite">
        {(status.type === 'checking' || status.type === 'idle') && (
          <AnelDeVerificacao progresso={progressoDaVerificacao} />
        )}

        {status.type === 'available' && (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Download className="h-8 w-8" />
            <span className="text-foreground">
              Atualização encontrada{status.version ? ` (v${status.version})` : ''}
            </span>
            {/* autoDownload é true no main — este estado é só uma passagem
                curta até `downloading` começar a reportar progresso real. */}
            <span className="text-xs">O download já começou. Preparando…</span>
          </div>
        )}

        {status.type === 'downloading' && (
          <div className="w-full">
            <div className="mb-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Download className="h-4 w-4" /> Baixando atualização…
            </div>
            <div className="mb-3 text-center text-5xl font-semibold tabular-nums">
              {status.percent}%
            </div>
            {/* Só temos `percent` vindo do main (electron-updater). NÃO
                inventamos MB/s nem bytes transferidos: o payload de progresso
                do IPC não carrega essa informação, e exibir um número
                inventado seria mentir para o usuário. */}
            <Progress value={status.percent} />
          </div>
        )}

        {status.type === 'ready' && (
          <div className="flex w-full flex-col items-center gap-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
              <CheckCircle2 className="h-5 w-5" />
              <span>Atualização{status.version ? ` v${status.version}` : ''} pronta para instalar</span>
            </div>
            <Button className="w-full" size="lg" onClick={onInstall}>
              <RefreshCw className="mr-2 h-4 w-4" /> Instalar e reiniciar
            </Button>
            <span className="text-xs text-muted-foreground">
              O app vai fechar, instalar e abrir de novo automaticamente.
            </span>
          </div>
        )}

        {status.type !== 'checking' &&
          status.type !== 'idle' &&
          status.type !== 'available' &&
          status.type !== 'downloading' &&
          status.type !== 'ready' && (
            // `error` (e qualquer estado futuro não mapeado): discreto e
            // curto de propósito — o UpdateGate libera o app quase junto,
            // então isso só aparece por instantes. Nada de tela de erro
            // dramática por um problema que nem trava o usuário.
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Só um instante…</span>
            </div>
          )}
      </div>

      {version && (
        <span className="text-xs text-muted-foreground">Versão atual: v{version}</span>
      )}
    </GlassPanel>
  )
}

function AnelDeVerificacao({ progresso }: { progresso: number }) {
  // Honestidade obrigatória: `progresso` é o avanço do PISO artificial de 5s
  // do UpdateGate, não da verificação real. Se a verificação real demorar mais
  // que 5s, `progresso` chega a 100 mas o status continua `checking` — nesse
  // caso o anel trava em ~95% e ganha um pulso, em vez de fingir 100% (o que
  // pareceria "concluído" para algo que ainda está rodando).
  const estagnado = progresso >= 100
  const progressoExibido = estagnado ? 95 : progresso
  const offset = PERIMETRO_DO_ANEL * (1 - progressoExibido / 100)

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={cn('relative h-24 w-24', estagnado && 'animate-pulse')}>
        {/* O anel é puramente decorativo: o texto "Verificando atualizações…"
            logo abaixo já é o que o leitor de tela anuncia. */}
        <svg viewBox="0 0 96 96" className="h-24 w-24 -rotate-90" aria-hidden="true">
          <circle
            cx="48"
            cy="48"
            r={RAIO_DO_ANEL}
            className="fill-none stroke-muted"
            strokeWidth="6"
          />
          <circle
            cx="48"
            cy="48"
            r={RAIO_DO_ANEL}
            className="fill-none stroke-primary transition-[stroke-dashoffset] duration-100 ease-linear"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={PERIMETRO_DO_ANEL}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
      <span className="text-muted-foreground">Verificando atualizações…</span>
    </div>
  )
}
