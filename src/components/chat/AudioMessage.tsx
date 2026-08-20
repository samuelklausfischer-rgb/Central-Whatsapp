import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, Download, Captions } from 'lucide-react'

interface AudioMessageProps {
  src: string
  isMe: boolean
  msgId?: string
  showDownload?: boolean
  compact?: boolean
  downloadName?: string
  /**
   * ITEM 12: transcrição automática do áudio RECEBIDO. Os três só existem
   * juntos nos balões de conversa — o preview de composição (áudio ainda não
   * enviado) nunca passa essas props, e o componente já lida bem com elas
   * ausentes (não renderiza nada extra).
   */
  transcription?: string | null
  transcriptionStatus?: 'pending' | 'ready' | 'failed' | null
  createdAt?: string
}

// Tempo máximo que um "transcrevendo..." fica visível sem virar `ready`/
// `failed`. Existe para nunca virar um carregando eterno: se por qualquer
// motivo a edge function nunca respondeu (deploy pendente, fila travada), o
// indicador some sozinho em vez de mentir para sempre que "já já sai".
const TRANSCRICAO_TRAVADA_MS = 3 * 60 * 1000

// Ponto de corte para "ver mais": abaixo disso o texto cabe folgado num
// balão de áudio sem precisar de recolher/expandir.
const TRANSCRICAO_TRUNCA_EM = 180

function TranscriptionBlock({
  transcription,
  transcriptionStatus,
  createdAt,
}: {
  transcription?: string | null
  transcriptionStatus?: 'pending' | 'ready' | 'failed' | null
  createdAt?: string
}) {
  const [expanded, setExpanded] = useState(false)

  if (transcriptionStatus === 'ready' && transcription) {
    const longo = transcription.length > TRANSCRICAO_TRUNCA_EM
    const textoExibido = longo && !expanded ? `${transcription.slice(0, TRANSCRICAO_TRUNCA_EM).trimEnd()}…` : transcription
    return (
      <div className="mt-1.5 pt-1.5 border-t border-chat-text/10 flex items-start gap-1.5">
        <Captions className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-chat-muted/60" />
        <div className="min-w-0 flex-1 text-[12.5px] leading-snug text-chat-muted/85 whitespace-pre-wrap break-words">
          {textoExibido}
          {longo && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-1 font-medium text-blue-500 hover:text-blue-400 whitespace-nowrap"
            >
              {expanded ? 'ver menos' : 'ver mais'}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (transcriptionStatus === 'pending') {
    // Passou do teto de espera: melhor sumir do que prometer para sempre um
    // resultado que pode nunca chegar (ver `TRANSCRICAO_TRAVADA_MS`).
    const travada = createdAt ? Date.now() - new Date(createdAt).getTime() > TRANSCRICAO_TRAVADA_MS : false
    if (travada) return null
    return (
      <div className="mt-1.5 pt-1.5 border-t border-chat-text/10 flex items-center gap-1.5 text-[12px] text-chat-muted/60 italic">
        <Captions className="h-3.5 w-3.5 flex-shrink-0 animate-pulse" />
        Transcrevendo áudio…
      </div>
    )
  }

  // 'failed' ou status desconhecido: nada de balão vazio, nada de "não deu"
  // permanente no meio da conversa — o áudio continua tocável normalmente.
  return null
}

let currentPlayingAudio: { pause: () => void; msgId?: string } | null = null
const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AudioMessage({
  src,
  isMe,
  msgId,
  showDownload = true,
  compact = false,
  downloadName = 'audio-message.webm',
  transcription,
  transcriptionStatus,
  createdAt,
}: AudioMessageProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState<(typeof PLAYBACK_RATES)[number]>(1)
  const [timelineFocused, setTimelineFocused] = useState(false)

  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
    } else {
      if (audio.ended) {
        audio.currentTime = 0
        setCurrentTime(0)
      }
      if (currentPlayingAudio && currentPlayingAudio.msgId !== msgId) {
        currentPlayingAudio.pause()
      }
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {
        setIsPlaying(false)
      })
      currentPlayingAudio = { pause: () => audio.pause(), msgId }
    }
  }, [isPlaying, msgId, playbackRate])

  const handleSeek = (value: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(duration) || duration <= 0) return
    audio.currentTime = value
    setCurrentTime(value)
  }

  const cyclePlaybackRate = () => {
    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate)
    const nextRate = PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length]
    setPlaybackRate(nextRate)
    if (audioRef.current) audioRef.current.playbackRate = nextRate
  }

  const handleDownload = async () => {
    try {
      const response = await fetch(src)
      if (!response.ok) throw new Error('Download indisponivel')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = downloadName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      const opened = window.open(src, '_blank', 'noopener,noreferrer')
      if (opened) opened.opener = null
    }
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(Number.isFinite(audio.duration) ? audio.duration : 0)
      if (currentPlayingAudio?.msgId === msgId) currentPlayingAudio = null
    }
    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('durationchange', onLoadedMetadata)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('durationchange', onLoadedMetadata)
    }
  }, [msgId, src])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  const progress = duration > 0 ? currentTime / duration : 0
  const progressPercent = Math.min(Math.max(progress * 100, 0), 100)
  const widthClass = compact
    ? 'w-full min-w-0'
    : 'w-[min(340px,64vw)] min-w-[210px] max-w-full'
  const playButtonClass = isMe
    ? 'bg-blue-500/20 text-blue-500 hover:bg-blue-500/30'
    : 'bg-blue-500/15 text-blue-500 hover:bg-blue-500/25'
  const railClass = isMe ? 'bg-chat-text/15' : 'bg-chat-muted/20'

  return (
    <div className={`select-none ${widthClass}`}>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <div className="flex items-center gap-2 w-full">
        <button
          type="button"
          onClick={handlePlayPause}
          className={`rounded-full w-9 h-9 flex items-center justify-center flex-shrink-0 transition-all duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${playButtonClass}`}
          aria-label={isPlaying ? 'Pausar áudio' : 'Tocar áudio'}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div
            className={`relative h-6 flex items-center rounded-full transition-all ${
              timelineFocused ? 'ring-2 ring-blue-500/30' : ''
            }`}
          >
            <div className={`absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full ${railClass}`}>
              <div
                className="h-full rounded-full bg-blue-500/75 transition-[width] duration-100"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div
              className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 shadow-sm transition-[left] duration-100"
              style={{ left: `${progressPercent}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => handleSeek(Number(event.currentTarget.value))}
              onFocus={() => setTimelineFocused(true)}
              onBlur={() => setTimelineFocused(false)}
              disabled={!duration}
              aria-label="Linha do tempo do áudio"
              aria-valuetext={`${formatTime(currentTime)} de ${formatTime(duration)}`}
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={cyclePlaybackRate}
          className="h-7 min-w-9 rounded-full px-1.5 text-[10px] font-semibold tabular-nums text-chat-muted hover:text-chat-text hover:bg-chat-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
          aria-label={`Velocidade atual ${playbackRate}x`}
          title="Alterar velocidade"
        >
          {playbackRate}x
        </button>

        {showDownload && (
          <button
            type="button"
            onClick={handleDownload}
            className="h-7 w-7 rounded-full flex items-center justify-center text-chat-muted hover:text-chat-text hover:bg-chat-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
            aria-label="Baixar áudio"
            title="Baixar áudio"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-chat-muted/70">
        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
      </div>
      <TranscriptionBlock
        transcription={transcription}
        transcriptionStatus={transcriptionStatus}
        createdAt={createdAt}
      />
    </div>
  )
}
