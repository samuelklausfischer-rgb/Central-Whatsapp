import { useEffect, useRef, useState } from 'react'
import { Loader2, Download, RefreshCw, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUpdater } from '@/hooks/use-updater'

/**
 * Tela de atualização exibida ANTES do login (só no Electron).
 * Ao abrir o app: checa update; se houver, baixa mostrando progresso e EXIGE
 * instalar antes de liberar o login. Sem update / offline / erro → libera.
 */
export function UpdateGate({ children }: { children: React.ReactNode }) {
  const { isElectron, status, version, checkForUpdates, installUpdate } = useUpdater()
  const [released, setReleased] = useState(!isElectron)
  const startedRef = useRef(false)
  const statusRef = useRef(status)
  statusRef.current = status

  // Dispara a checagem imediatamente ao montar (não espera os 4s do main).
  useEffect(() => {
    if (!isElectron || startedRef.current) return
    startedRef.current = true
    checkForUpdates()
  }, [isElectron, checkForUpdates])

  // Libera quando não há update (ou o updater falhou — não dá pra travar por infra quebrada).
  useEffect(() => {
    if (released) return
    if (status.type === 'up-to-date' || status.type === 'error') setReleased(true)
  }, [status, released])

  // Rede de segurança: se ficar preso em idle/checking (offline/sem resposta),
  // libera após 10s — mas NÃO libera se um update já está em andamento.
  useEffect(() => {
    if (!isElectron) return
    const t = setTimeout(() => {
      const s = statusRef.current.type
      if (s !== 'available' && s !== 'downloading' && s !== 'ready') setReleased(true)
    }, 10000)
    return () => clearTimeout(t)
  }, [isElectron])

  if (released) return <>{children}</>

  const percent = status.type === 'downloading' ? status.percent : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background text-foreground">
      <div className="flex flex-col items-center gap-2">
        <span className="text-2xl font-semibold tracking-tight">PRN Hub</span>
        <span className="text-sm text-muted-foreground">Mantendo você na versão mais recente</span>
      </div>

      <div className="flex w-80 max-w-[80vw] flex-col items-center gap-4">
        {(status.type === 'checking' || status.type === 'idle') && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Verificando atualizações…</span>
          </div>
        )}

        {status.type === 'available' && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Download className="h-5 w-5" />
            <span>Atualização encontrada{status.version ? ` (v${status.version})` : ''}. Preparando…</span>
          </div>
        )}

        {status.type === 'downloading' && (
          <div className="w-full">
            <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Download className="h-4 w-4" /> Baixando atualização…
              </span>
              <span className="tabular-nums">{percent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {status.type === 'ready' && (
          <div className="flex w-full flex-col items-center gap-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
              <CheckCircle2 className="h-5 w-5" />
              <span>Atualização{status.version ? ` v${status.version}` : ''} pronta para instalar</span>
            </div>
            <Button className="w-full" size="lg" onClick={installUpdate}>
              <RefreshCw className="mr-2 h-4 w-4" /> Instalar e reiniciar
            </Button>
            <span className="text-xs text-muted-foreground">
              O app vai fechar, instalar e abrir de novo automaticamente.
            </span>
          </div>
        )}
      </div>

      {version && (
        <span className="absolute bottom-4 text-xs text-muted-foreground">Versão atual: v{version}</span>
      )}
    </div>
  )
}
