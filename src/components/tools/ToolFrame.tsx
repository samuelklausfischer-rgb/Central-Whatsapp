import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Download, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  buildEmbedUrl,
  isEmbedMessage,
  EMBED_PROTOCOL,
  type EmbedCredential,
} from '@/lib/tool-embed'
import { useToolVersion } from '@/hooks/use-tool-version'

interface ToolFrameProps {
  /** Nome da ferramenta, usado no título do iframe e nas mensagens de erro. */
  title: string
  /** URL do app publicado (vem de env). */
  baseUrl: string
  /** Nome da variável de ambiente, citado no aviso quando a URL não está configurada. */
  envVarName: string
  /** Produz a credencial que o filho vai usar para abrir a sessão dele. */
  getCredential: () => Promise<EmbedCredential>
  /**
   * Opcional: reenvia credencial depois do handshake (o Relatórios usa para
   * repassar o access token a cada TOKEN_REFRESHED). Recebe o `send` e devolve
   * a função de limpeza.
   */
  watch?: (send: (credential: EmbedCredential) => void) => () => void
  /**
   * Intervalo entre checagens de `version.json`, em ms. Default: 5 minutos.
   * Exposto como prop (em vez de constante) para permitir ajuste por
   * ferramenta sem tocar no hook — ex.: um app que publica com mais frequência.
   */
  versionCheckIntervalMs?: number
}

type Status = 'connecting' | 'ready' | 'error'

export function ToolFrame({
  title,
  baseUrl,
  envVarName,
  getCredential,
  watch,
  versionCheckIntervalMs,
}: ToolFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // Um nonce por montagem (e por retry): reaproveitar entre sessões daria a uma
  // aba antiga a chance de injetar credencial numa nova.
  const [nonce, setNonce] = useState(() => crypto.randomUUID())

  // Versão usada como cache-busting do documento do iframe. Só é preenchida
  // quando o usuário aceita a faixa de atualização (ver `applyUpdate` abaixo)
  // — nunca sozinho, senão um retry de erro comum já forçaria reload com `v`
  // antes de qualquer atualização real existir.
  const [iframeVersion, setIframeVersion] = useState<string | undefined>(undefined)

  // useMemo não é cosmético aqui: `buildEmbedUrl` devolve objeto novo a cada
  // render, o que trocaria a identidade de `send` e remontaria o efeito abaixo.
  // O `setStatus('ready')` do handshake já causa um render — o efeito seria
  // limpo, a inscrição do `watch` cairia junto, e o filho nunca receberia o
  // token renovado (o `ready` é uma vez só). Resultado: Relatórios expirando
  // depois de ~1h dentro do iframe.
  const target = useMemo(() => buildEmbedUrl(baseUrl, nonce, iframeVersion), [baseUrl, nonce, iframeVersion])

  // Detecção de versão do app publicado — genérica, então Licitações herda de
  // graça. Degrada em silêncio quando `version.json` não existe (ver o hook).
  const { updateVersion, dismiss, applied } = useToolVersion({ baseUrl, intervalMs: versionCheckIntervalMs })

  // Refs para não recriar o listener a cada render — o handshake precisa
  // sobreviver a re-renders, senão um `ready` chega com o listener já removido.
  const getCredentialRef = useRef(getCredential)
  getCredentialRef.current = getCredential
  const watchRef = useRef(watch)
  watchRef.current = watch

  const send = useCallback(
    (credential: EmbedCredential) => {
      const frame = iframeRef.current?.contentWindow
      if (!frame || !target) return
      frame.postMessage(
        { source: EMBED_PROTOCOL, type: 'credential', nonce, credential },
        target.origin, // nunca '*': o token não pode vazar para outra origem
      )
    },
    [nonce, target],
  )

  useEffect(() => {
    if (!target) return
    let mounted = true
    let stopWatching: (() => void) | undefined
    // O filho repete o `ready` até receber a credencial (ver `embed.ts` lá).
    // Esta trava evita que cada repetição vire uma chamada nova a
    // `getCredential()` — no Licitações isso é uma ida à ponte e um OTP a mais.
    // De propósito ela NÃO é permanente: se o app filho recarregar, ele manda
    // `ready` de novo e precisa ser atendido, senão fica preso em "Conectando…".
    let entregando = false

    const onMessage = async (event: MessageEvent) => {
      // Checagem mais forte que comparar origem: garante que a mensagem veio
      // deste iframe, e funciona igual no Electron (onde a origem é "null").
      if (event.source !== iframeRef.current?.contentWindow) return
      if (!isEmbedMessage(event.data)) return

      if (event.data.type === 'error') {
        if (!mounted) return
        setError(event.data.message || `Falha ao abrir ${title}.`)
        setStatus('error')
        return
      }

      if (event.data.type !== 'ready') return
      if (entregando) return
      entregando = true

      try {
        const credential = await getCredentialRef.current()
        if (!mounted) return
        send(credential)
        setStatus('ready')
        setError(null)
        stopWatching?.()
        stopWatching = watchRef.current?.(send)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : `Não foi possível liberar seu acesso a ${title}.`)
        setStatus('error')
      } finally {
        entregando = false
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      mounted = false
      stopWatching?.()
      window.removeEventListener('message', onMessage)
    }
  }, [send, target, title])

  const retry = () => {
    setError(null)
    setStatus('connecting')
    setNonce(crypto.randomUUID())
    setRetryNonce((n) => n + 1)
  }

  // Clique na faixa de atualização: NUNCA automático — o gestor pode estar no
  // meio de um relatório. Reusa o mesmo mecanismo do `retry` (nonce novo +
  // `key` do iframe) e só adiciona o cache-busting `?v=` da versão nova.
  const applyUpdate = () => {
    if (!updateVersion) return
    applied(updateVersion)
    setIframeVersion(updateVersion)
    setError(null)
    setStatus('connecting')
    setNonce(crypto.randomUUID())
    setRetryNonce((n) => n + 1)
  }

  if (!target) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md space-y-2 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto h-6 w-6 text-amber-500" />
          <p className="font-medium text-foreground">{title} não está configurado</p>
          <p className="text-sm text-muted-foreground">
            Defina <code className="rounded bg-muted px-1 py-0.5 text-xs">{envVarName}</code> com a URL do
            app publicado e reinicie o Central Whats.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <iframe
        // key força recarregar o app filho no retry: sem isso ele continuaria
        // esperando um `ready` que já foi consumido e nunca se repetiria.
        key={retryNonce}
        ref={iframeRef}
        src={target.src}
        title={title}
        className="h-full w-full border-0"
        allow="clipboard-write; fullscreen"
      />

      {/* Faixa discreta — mesmo tom do UpdateGate (Electron), mas nunca em tela
          cheia e nunca recarrega sozinha: só aparece com o iframe já pronto,
          pra não empilhar com o overlay de "Conectando..." acima. */}
      {status === 'ready' && updateVersion && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card/95 px-4 py-2 text-sm shadow-sm backdrop-blur">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Download className="h-4 w-4" />
            Nova versão do {title} disponível.
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={applyUpdate}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss} aria-label="Dispensar aviso de atualização">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          {status === 'connecting' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Conectando ao {title}...
            </div>
          ) : (
            <div className="max-w-md space-y-3 rounded-xl border border-destructive/40 bg-card p-6 text-center shadow-sm">
              <AlertCircle className="mx-auto h-6 w-6 text-destructive" />
              <p className="font-medium text-foreground">Não foi possível abrir o {title}</p>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={retry}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ToolFrame
