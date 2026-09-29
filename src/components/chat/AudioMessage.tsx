import { memo, useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { Play, Pause, Download, Captions, Copy, Check, Mic } from 'lucide-react'
import { obterOnda, ondaEmCache, type OndaDeAudio } from '@/lib/ondaDeAudio'
import { TextoComLerMais } from '@/components/chat/TextoComLerMais'

interface AudioMessageProps {
  src: string
  isMe: boolean
  msgId?: string
  showDownload?: boolean
  compact?: boolean
  downloadName?: string
  /**
   * Foto de perfil JÁ renderizada pelo pai (48px, redonda). Sem avatar o bloco
   * some e o player fica no modo enxuto.
   */
  avatar?: ReactNode
  /**
   * Horário/status já montados pelo pai. Vai alinhado à direita, na mesma linha
   * da duração — é o que deixa o balão baixo como no WhatsApp.
   */
  rodape?: ReactNode
  /**
   * Quando `false` a onda não faz seek (nem por ponteiro nem por teclado). O
   * pai passa `!modoSelecao`: no modo de seleção o clique tem que selecionar a
   * mensagem, não pular no áudio. Padrão `true`.
   */
  interativo?: boolean
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

function TranscriptionBlock({
  transcription,
  transcriptionStatus,
  createdAt,
}: {
  transcription?: string | null
  transcriptionStatus?: 'pending' | 'ready' | 'failed' | null
  createdAt?: string
}) {
  const [copiado, setCopiado] = useState(false)
  const timerCopiado = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Evita setState depois de o balão desmontar (troca de conversa).
  useEffect(
    () => () => {
      if (timerCopiado.current) clearTimeout(timerCopiado.current)
    },
    [],
  )

  const copiar = (event: React.MouseEvent) => {
    // O balão tem clique próprio (menu, seleção): copiar não pode disparar isso.
    event.stopPropagation()
    if (!transcription) return
    void navigator.clipboard
      ?.writeText(transcription)
      .then(() => {
        setCopiado(true)
        if (timerCopiado.current) clearTimeout(timerCopiado.current)
        timerCopiado.current = setTimeout(() => setCopiado(false), 1500)
      })
      .catch(() => {
        // Sem permissão de clipboard: o texto continua selecionável à mão (`select-text`).
      })
  }

  if (transcriptionStatus === 'ready' && transcription) {
    return (
      <div className="group/transcricao mt-2 border-t border-chat-text/10 pt-2">
        <div className="mb-1 flex items-center gap-1.5">
          <Captions className="h-[13px] w-[13px] flex-shrink-0 text-chat-muted" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-chat-muted">Transcrição</span>
          <button
            type="button"
            onClick={copiar}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="ml-auto flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-chat-muted opacity-0 transition-opacity hover:text-chat-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 group-hover/transcricao:opacity-100 [@media(hover:none)]:opacity-100"
            aria-label={copiado ? 'Transcrição copiada' : 'Copiar transcrição'}
            title="Copiar transcrição"
          >
            {copiado ? <Check className="h-[13px] w-[13px] text-emerald-600" /> : <Copy className="h-[13px] w-[13px]" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <div className="select-text whitespace-pre-wrap break-words text-[14.2px] leading-[19px] text-chat-text">
          {/* Mesmo corte de 14 linhas e o mesmo "Ler mais" verde do texto comum. */}
          <TextoComLerMais>{transcription}</TextoComLerMais>
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
      <div className="mt-2 border-t border-chat-text/10 pt-2" role="status" aria-live="polite">
        <div className="space-y-1.5">
          <div className="h-2.5 w-[90%] animate-pulse rounded-full bg-chat-muted/15" />
          <div className="h-2.5 w-[60%] animate-pulse rounded-full bg-chat-muted/15" />
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-chat-muted">
          <Captions className="h-[13px] w-[13px] flex-shrink-0" />
          Transcrevendo áudio…
        </div>
      </div>
    )
  }

  // 'failed' ou status desconhecido: nada de balão vazio, nada de "não deu"
  // permanente no meio da conversa — o áudio continua tocável normalmente.
  return null
}

let currentPlayingAudio: { pause: () => void; msgId?: string } | null = null
const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const

// Áudios já tocados nesta sessão. Fica no módulo (não no estado) porque a lista
// de mensagens desmonta e remonta balões ao rolar/trocar de conversa — o
// microfone azul não pode voltar a verde por causa disso.
const tocadosNaSessao = new Set<string>()

// Barras da onda: 40 no balão normal; o preview de composição é mais estreito.
const BARRAS_NORMAL = 40
const BARRAS_COMPACTO = 28
const ALTURA_MIN_BARRA_PX = 3
const ALTURA_MAX_BARRA_PX = 26
// Placeholder enquanto a onda real não existe (ou não pôde ser calculada):
// barras baixas e iguais. Nunca uma onda aleatória, que fingiria um conteúdo.
const ALTURA_PLACEHOLDER_PX = 4

// Limiar de movimento (px) para separar "toque", "rolagem" e "arrasto" no celular.
const LIMIAR_ARRASTO_PX = 8

/**
 * As barras ficam num componente memoizado que só recebe a onda, QUANTAS já
 * foram tocadas e a cor. Assim, a lista de mensagens recalculando (chega
 * mensagem, digita-se) não redesenha 40 barras x N áudios; e durante a
 * reprodução só redesenha quando uma barra muda de estado.
 */
const BarrasDaOnda = memo(function BarrasDaOnda({
  onda,
  total,
  tocadas,
  corTocada,
}: {
  onda: number[] | null
  total: number
  tocadas: number
  corTocada: string
}) {
  return (
    <>
      {Array.from({ length: total }, (_, i) => {
        const valor = onda ? (onda[i] ?? 0) : null
        const altura =
          valor == null
            ? ALTURA_PLACEHOLDER_PX
            : ALTURA_MIN_BARRA_PX + valor * (ALTURA_MAX_BARRA_PX - ALTURA_MIN_BARRA_PX)
        return (
          <span
            key={i}
            className={`max-w-[3px] min-w-[1px] flex-1 rounded-full ${i < tocadas ? corTocada : 'bg-chat-muted/40'}`}
            style={{ height: `${altura}px` }}
          />
        )
      })}
    </>
  )
})

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
  avatar,
  rodape,
  interativo = true,
  transcription,
  transcriptionStatus,
  createdAt,
}: AudioMessageProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const raizRef = useRef<HTMLDivElement | null>(null)
  const ondaRef = useRef<HTMLDivElement | null>(null)
  const playRef = useRef<HTMLButtonElement | null>(null)
  const pilulaRef = useRef<HTMLButtonElement | null>(null)
  // Gesto em andamento na onda. No toque, `ativo` só liga depois de um arrasto
  // horizontal; antes disso o movimento pode ser rolagem da conversa.
  const gestoRef = useRef<{ toque: boolean; x0: number; y0: number; ativo: boolean; cancelado: boolean } | null>(null)
  const chaveTocado = msgId ?? src
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState<(typeof PLAYBACK_RATES)[number]>(1)
  const [arrastando, setArrastando] = useState(false)
  const [jaTocou, setJaTocou] = useState(() => tocadosNaSessao.has(chaveTocado))
  const [visivel, setVisivel] = useState(false)
  const [ondaPronta, setOnda] = useState<OndaDeAudio | null>(() =>
    ondaEmCache(src, compact ? BARRAS_COMPACTO : BARRAS_NORMAL),
  )

  const totalBarras = compact ? BARRAS_COMPACTO : BARRAS_NORMAL
  const temAvatar = !compact && avatar != null

  // Sobe o DOM até o primeiro ancestral rolável: é ele (a lista de mensagens) o
  // "viewport" que importa. Com `root` nulo o observador olha a janela, e um
  // balão logo abaixo da área visível da lista não seria antecipado pelos 200px.
  useEffect(() => {
    const el = raizRef.current
    if (!el) return
    if (ondaEmCache(src, totalBarras)) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisivel(true)
      return
    }
    let raiz: Element | null = el.parentElement
    while (raiz) {
      const overflowY = getComputedStyle(raiz).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') break
      raiz = raiz.parentElement
    }
    // A onda só é calculada quando o balão chega perto da tela: decodificar exige
    // baixar o áudio inteiro, e uma conversa longa tem centenas de áudios.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisivel(true)
          observer.disconnect()
        }
      },
      { root: raiz, rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [src, totalBarras])

  useEffect(() => {
    // Onda já calculada antes (remontagem): usa na hora, sem esperar visibilidade.
    const pronta = ondaEmCache(src, totalBarras)
    setOnda(pronta)
    if (pronta || !visivel || !src) return
    let cancelado = false
    obterOnda(src, totalBarras).then(
      (resultado) => {
        if (!cancelado) setOnda(resultado)
      },
      () => {
        // CORS, formato não decodificável ou arquivo grande: fica o placeholder.
      },
    )
    return () => {
      cancelado = true
    }
  }, [src, visivel, totalBarras])

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

  // WebM gravado no navegador costuma vir com `audio.duration` infinito (0 aqui);
  // nesse caso vale a duração do áudio decodificado para a onda.
  const duracaoEfetiva = duration > 0 ? duration : (ondaPronta?.duracao ?? 0)
  const onda = ondaPronta?.barras ?? null
  const podeSeek = interativo && duracaoEfetiva > 0

  const handleSeek = (value: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(duracaoEfetiva) || duracaoEfetiva <= 0) return
    const alvo = Math.min(Math.max(value, 0), duracaoEfetiva)
    audio.currentTime = alvo
    setCurrentTime(alvo)
  }

  // Clique/arrasto na onda: a posição horizontal do ponteiro vira o tempo.
  const seekPorPonteiro = (clientX: number) => {
    const el = ondaRef.current
    if (!el || duracaoEfetiva <= 0) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    handleSeek(((clientX - rect.left) / rect.width) * duracaoEfetiva)
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

    const onPlay = () => {
      setIsPlaying(true)
      tocadosNaSessao.add(chaveTocado)
      setJaTocou(true)
    }
    const onPause = () => setIsPlaying(false)
    const onEnded = () => {
      // Como no WhatsApp: ao terminar volta ao início e mostra a duração total.
      setIsPlaying(false)
      setCurrentTime(0)
      if (currentPlayingAudio?.msgId === msgId) currentPlayingAudio = null
      // A pílula some ao voltar ao início: se ela tinha o foco, devolve ao play
      // em vez de deixar o foco cair no body.
      if (document.activeElement === pilulaRef.current) playRef.current?.focus()
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
  }, [msgId, src, chaveTocado])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  const progress = duracaoEfetiva > 0 ? Math.min(Math.max(currentTime / duracaoEfetiva, 0), 1) : 0
  const progressPercent = progress * 100
  // (i + 0.5) / total <= progress  <=>  i < round(progress * total)
  const barrasTocadas = Math.min(totalBarras, Math.floor(progress * totalBarras + 0.5))
  // A pílula fica visível também com o áudio pausado no meio: assim dá para
  // trocar a velocidade sem retomar, e pausar não a faz sumir com o foco nela.
  const mostrarPilula = isPlaying || currentTime > 0
  const widthClass = compact ? 'w-full min-w-0' : 'w-[300px] max-w-full'
  const corTocada = isMe ? 'bg-sky-600' : 'bg-sky-500'
  // Parado no início mostra a duração total; tocando (ou pausado no meio) mostra
  // quanto já passou — igual ao WhatsApp.
  const tempoExibido = isPlaying || currentTime > 0 ? currentTime : duracaoEfetiva

  const pilulaVelocidade = (extra = '') => (
    <button
      ref={pilulaRef}
      type="button"
      onClick={cyclePlaybackRate}
      className={`flex h-7 min-w-10 flex-none items-center justify-center rounded-full bg-chat-text/10 px-2 text-[12px] font-semibold tabular-nums text-chat-text transition-colors hover:bg-chat-text/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${extra}`}
      aria-label={`Velocidade atual ${playbackRate}x. Clique para alterar`}
      title="Alterar velocidade"
    >
      {playbackRate}x
    </button>
  )

  return (
    <div ref={raizRef} className={`select-none ${widthClass}`}>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <div className="flex items-start gap-2">
        {temAvatar && (
          <div className="relative h-12 w-12 flex-none">
            {mostrarPilula ? (
              // Tocando (ou pausado no meio), o lugar da foto vira o controle de velocidade.
              <div className="flex h-full w-full items-center justify-center">{pilulaVelocidade()}</div>
            ) : (
              <>
                <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">{avatar}</div>
                <Mic
                  className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 fill-current drop-shadow-sm ${
                    jaTocou ? 'text-sky-500' : 'text-emerald-600'
                  }`}
                  aria-hidden="true"
                />
              </>
            )}
          </div>
        )}

        <button
          ref={playRef}
          type="button"
          onClick={handlePlayPause}
          className="mt-0.5 flex h-[26px] w-[26px] flex-none items-center justify-center text-chat-muted transition-colors hover:text-chat-text active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
          aria-label={isPlaying ? 'Pausar áudio' : 'Tocar áudio'}
        >
          {isPlaying ? <Pause className="h-[26px] w-[26px] fill-current" /> : <Play className="h-[26px] w-[26px] fill-current" />}
        </button>

        <div className="min-w-0 flex-1 pt-0.5">
          <div
            ref={ondaRef}
            role="slider"
            tabIndex={podeSeek ? 0 : -1}
            aria-label="Linha do tempo do áudio"
            aria-valuemin={0}
            aria-valuemax={Math.round(duracaoEfetiva)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={`${formatTime(currentTime)} de ${formatTime(duracaoEfetiva)}`}
            aria-disabled={!podeSeek}
            onPointerDown={(event) => {
              // Só o botão principal; e, em modo de seleção, o clique segue para o balão.
              if (event.button !== 0 || !podeSeek) return
              event.stopPropagation()
              const toque = event.pointerType === 'touch'
              gestoRef.current = { toque, x0: event.clientX, y0: event.clientY, ativo: !toque, cancelado: false }
              if (!toque) {
                event.currentTarget.setPointerCapture(event.pointerId)
                setArrastando(true)
                seekPorPonteiro(event.clientX)
              }
            }}
            onPointerMove={(event) => {
              const gesto = gestoRef.current
              if (!gesto || gesto.cancelado || event.buttons === 0) return
              if (gesto.toque && !gesto.ativo) {
                // Toque: só vira arrasto se for claramente horizontal. Vertical
                // é rolagem da conversa (`touch-pan-y`) e não pode mexer no áudio.
                const dx = event.clientX - gesto.x0
                const dy = event.clientY - gesto.y0
                if (Math.abs(dx) <= LIMIAR_ARRASTO_PX && Math.abs(dy) <= LIMIAR_ARRASTO_PX) return
                if (Math.abs(dx) > Math.abs(dy)) {
                  gesto.ativo = true
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setArrastando(true)
                } else {
                  gesto.cancelado = true
                  return
                }
              }
              if (gesto.ativo) seekPorPonteiro(event.clientX)
            }}
            onPointerUp={(event) => {
              const gesto = gestoRef.current
              gestoRef.current = null
              setArrastando(false)
              if (!gesto || !gesto.toque || gesto.ativo || gesto.cancelado) return
              // Toque simples (sem movimento relevante): o seek acontece ao soltar.
              const dx = Math.abs(event.clientX - gesto.x0)
              const dy = Math.abs(event.clientY - gesto.y0)
              if (dx <= LIMIAR_ARRASTO_PX && dy <= LIMIAR_ARRASTO_PX) seekPorPonteiro(event.clientX)
            }}
            onPointerCancel={() => {
              gestoRef.current = null
              setArrastando(false)
            }}
            onLostPointerCapture={() => {
              gestoRef.current = null
              setArrastando(false)
            }}
            onKeyDown={(event) => {
              if (!podeSeek) return
              if (event.key === 'ArrowRight') {
                event.preventDefault()
                handleSeek(currentTime + 5)
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault()
                handleSeek(currentTime - 5)
              } else if (event.key === 'Home') {
                event.preventDefault()
                handleSeek(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                handleSeek(duracaoEfetiva)
              }
            }}
            // `touch-pan-y`: a rolagem vertical da conversa continua funcionando
            // por cima da onda. `mr-7` reserva o canto do ⌄ do balão (só na onda;
            // a linha de tempo/rodapé usa a largura toda).
            className={`relative flex h-[26px] touch-pan-y items-center justify-between gap-[2px] rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 ${
              compact ? '' : 'mr-7'
            } ${podeSeek ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <BarrasDaOnda onda={onda} total={totalBarras} tocadas={barrasTocadas} corTocada={corTocada} />
            <span
              className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm ${corTocada} ${
                arrastando ? '' : 'transition-[left] duration-100'
              }`}
              style={{ left: `${progressPercent}%` }}
            />
          </div>

          <div className="mt-0.5 flex h-4 items-center gap-1 text-[12px] tabular-nums text-chat-muted">
            <span>{formatTime(tempoExibido)}</span>
            {showDownload && (
              // Só aparece ao passar o mouse no balão (o pai tem `group`); em
              // tela de toque não existe hover, então fica sempre visível e
              // discreto. Fica ao lado da duração para não colidir com o ⌄ do
              // balão (canto superior) nem com o horário (canto inferior direito).
              <button
                type="button"
                onClick={handleDownload}
                className="flex h-4 w-4 items-center justify-center rounded text-chat-muted opacity-0 transition-opacity hover:text-chat-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 group-hover:opacity-100 [@media(hover:none)]:opacity-60"
                aria-label="Baixar áudio"
                title="Baixar áudio"
              >
                <Download className="h-3 w-3" />
              </button>
            )}
            {rodape != null && <div className="ml-auto flex flex-shrink-0 items-center">{rodape}</div>}
          </div>
        </div>

        {/* Sem avatar (preview de composição ou pai ainda não migrado) não há
            onde trocar a foto pela pílula: ela fica sempre à direita. */}
        {!temAvatar && pilulaVelocidade('mt-0')}
      </div>
      <TranscriptionBlock
        transcription={transcription}
        transcriptionStatus={transcriptionStatus}
        createdAt={createdAt}
      />
    </div>
  )
}
