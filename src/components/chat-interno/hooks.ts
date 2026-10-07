import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { janelaEmPrimeiroPlano } from '@/lib/notificacao-do-sistema'
import {
  TAMANHO_MINIMO_DO_AUDIO,
  aoMudarUrlsAssinadas,
  garantirUrlsAssinadas,
  urlAssinadaEmCache,
} from '@/services/chat_interno'

/** A janela está mesmo à frente (visível E com foco)? Reage a Alt-Tab e a trocar de aba. */
export function useJanelaEmPrimeiroPlano(): boolean {
  const [frente, setFrente] = useState(() => janelaEmPrimeiroPlano())
  useEffect(() => {
    const atualizar = () => setFrente(janelaEmPrimeiroPlano())
    window.addEventListener('focus', atualizar)
    window.addEventListener('blur', atualizar)
    document.addEventListener('visibilitychange', atualizar)
    atualizar()
    return () => {
      window.removeEventListener('focus', atualizar)
      window.removeEventListener('blur', atualizar)
      document.removeEventListener('visibilitychange', atualizar)
    }
  }, [])
  return frente
}

/**
 * URLs assinadas dos anexos visíveis, em lote e com cache.
 *
 * Devolve uma função `urlDe(caminho)`. O re-render acontece UMA vez quando o
 * lote chega, e de novo só quando uma URL é renovada (a cada ~3h40) — nunca por
 * render. Antes de vencer (`MARGEM_DE_RENOVACAO_MS`) a URL é trocada por uma
 * nova em segundo plano, para a imagem de quem deixou a conversa aberta o dia
 * todo não quebrar.
 *
 * Quem redesenha é a INSCRIÇÃO no cache, não o `.then` de cada pedido. Antes, o
 * efeito de um pedido virava "morto" (`vivo = false`) assim que a lista de anexos
 * mudava, e o pedido seguinte pulava os caminhos que o anterior ainda estava
 * assinando: o anterior terminava sem ninguém para redesenhar e a imagem ficava
 * em branco. Redesenhar após o desmonte é inofensivo (e a inscrição é cancelada).
 */
export function useUrlsDosAnexos(caminhos: string[]): (caminho: string | null | undefined) => string | undefined {
  const [, redesenhar] = useReducer((n: number) => n + 1, 0)
  const chave = caminhos.join('|')
  const caminhosRef = useRef(caminhos)
  caminhosRef.current = caminhos

  useEffect(() => aoMudarUrlsAssinadas(redesenhar), [])

  useEffect(() => {
    void garantirUrlsAssinadas(caminhosRef.current)
  }, [chave])

  const temAnexos = caminhos.length > 0
  useEffect(() => {
    if (!temAnexos) return
    const timer = setInterval(() => {
      void garantirUrlsAssinadas(caminhosRef.current, true)
    }, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [temAnexos])

  return urlAssinadaEmCache
}

// ─── Gravação de áudio ───────────────────────────────────────────────────────

export interface AudioGravado {
  blob: Blob
  /** Tipo sem o `;codecs=...` — é o que vai como `contentType` do upload. */
  mime: string
  extensao: string
  duracaoSeg: number
}

function escolherMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  )
}

function extensaoDoMime(mime: string): string {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

/**
 * Gravador de voz (MediaRecorder).
 *
 * `parar()` entrega o áudio; `cancelar()` descarta. Os dois soltam o microfone —
 * a luzinha do navegador não pode ficar acesa depois que a pessoa desistiu.
 * `parar()` recusa (devolve `erro`) gravação sem som: o cabeçalho WebM sozinho
 * (~110 bytes) é aceito pelo Storage e chega mudo do outro lado; o banco também
 * barra, mas melhor avisar antes de subir.
 */
export function useGravadorDeAudio() {
  const [gravando, setGravando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const gravadorRef = useRef<MediaRecorder | null>(null)
  const fluxoRef = useRef<MediaStream | null>(null)
  const pedacosRef = useRef<Blob[]>([])
  const inicioRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const descartarRef = useRef(false)
  const aoTerminarRef = useRef<((r: { audio?: AudioGravado; erro?: string } | null) => void) | null>(null)

  const soltarMicrofone = useCallback(() => {
    fluxoRef.current?.getTracks().forEach((t) => t.stop())
    fluxoRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const iniciar = useCallback(async (): Promise<string | null> => {
    if (gravadorRef.current) return null
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return 'Este navegador não permite gravar áudio.'
    }
    let fluxo: MediaStream
    try {
      fluxo = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      return 'Não foi possível acessar o microfone. Confira a permissão do navegador.'
    }
    try {
      const mimeEscolhido = escolherMime()
      const gravador = new MediaRecorder(fluxo, mimeEscolhido ? { mimeType: mimeEscolhido } : undefined)
      pedacosRef.current = []
      descartarRef.current = false
      gravador.ondataavailable = (e) => {
        if (e.data.size > 0) pedacosRef.current.push(e.data)
      }
      gravador.onstop = () => {
        const duracaoSeg = Math.max(1, Math.round((performance.now() - inicioRef.current) / 1000))
        const tipoBruto = gravador.mimeType || mimeEscolhido || 'audio/webm'
        const mime = tipoBruto.split(';')[0]
        const blob = new Blob(pedacosRef.current, { type: mime })
        pedacosRef.current = []
        gravadorRef.current = null
        soltarMicrofone()
        setGravando(false)
        setSegundos(0)
        const aoTerminar = aoTerminarRef.current
        aoTerminarRef.current = null
        if (descartarRef.current) {
          descartarRef.current = false
          aoTerminar?.(null)
          return
        }
        if (blob.size < TAMANHO_MINIMO_DO_AUDIO) {
          aoTerminar?.({ erro: 'A gravação ficou sem som. Fale um pouco mais e tente de novo.' })
          return
        }
        aoTerminar?.({ audio: { blob, mime, extensao: extensaoDoMime(mime), duracaoSeg } })
      }
      fluxoRef.current = fluxo
      gravadorRef.current = gravador
      inicioRef.current = performance.now()
      gravador.start()
      setSegundos(0)
      setGravando(true)
      timerRef.current = setInterval(() => setSegundos(Math.floor((performance.now() - inicioRef.current) / 1000)), 500)
      return null
    } catch {
      fluxo.getTracks().forEach((t) => t.stop())
      return 'Não foi possível iniciar a gravação.'
    }
  }, [soltarMicrofone])

  const parar = useCallback(
    () =>
      new Promise<{ audio?: AudioGravado; erro?: string } | null>((resolve) => {
        const g = gravadorRef.current
        if (!g || g.state === 'inactive') {
          resolve(null)
          return
        }
        aoTerminarRef.current = resolve
        g.stop()
      }),
    [],
  )

  const cancelar = useCallback(() => {
    const g = gravadorRef.current
    if (!g || g.state === 'inactive') {
      soltarMicrofone()
      return
    }
    descartarRef.current = true
    g.stop()
  }, [soltarMicrofone])

  // Sair da conversa com a gravação aberta: descarta e solta o microfone.
  useEffect(
    () => () => {
      descartarRef.current = true
      const g = gravadorRef.current
      if (g && g.state !== 'inactive') {
        g.onstop = null
        g.stop()
      }
      soltarMicrofone()
    },
    [soltarMicrofone],
  )

  return { gravando, segundos, iniciar, parar, cancelar }
}
