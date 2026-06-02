import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause } from 'lucide-react'

interface AudioMessageProps {
  src: string
  isMe: boolean
  msgId?: string
}

const waveformCache = new Map<string, number[]>()

let currentPlayingAudio: { pause: () => void; msgId?: string } | null = null

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

async function generateWaveformData(url: string): Promise<number[]> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  const audioCtx = new AudioContext()
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  const channelData = audioBuffer.getChannelData(0)
  const numBars = 40
  const chunkSize = Math.floor(channelData.length / numBars)
  const waveform: number[] = []
  for (let i = 0; i < numBars; i++) {
    let sum = 0
    for (let j = i * chunkSize; j < (i + 1) * chunkSize && j < channelData.length; j++) {
      sum += Math.abs(channelData[j])
    }
    const avg = sum / chunkSize
    waveform.push(avg)
  }
  const max = Math.max(...waveform)
  return waveform.map(v => (v / max) * 0.9 + 0.1)
}

export function AudioMessage({ src, isMe, msgId }: AudioMessageProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [waveform, setWaveform] = useState<number[]>([])
  const [waveformLoading, setWaveformLoading] = useState(true)

  useEffect(() => {
    if (waveformCache.has(src)) {
      setWaveform(waveformCache.get(src)!)
      setWaveformLoading(false)
    } else {
      generateWaveformData(src)
        .then(data => {
          waveformCache.set(src, data)
          setWaveform(data)
          setWaveformLoading(false)
        })
        .catch(() => {
          const fallback = Array.from({ length: 40 }, () => 0.4)
          setWaveform(fallback)
          setWaveformLoading(false)
        })
    }
  }, [src])

  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
    } else {
      if (currentPlayingAudio && currentPlayingAudio.msgId !== msgId) {
        currentPlayingAudio.pause()
      }
      audio.play()
      currentPlayingAudio = { pause: () => audio.pause(), msgId }
    }
  }, [isPlaying, msgId])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }
    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = () => setDuration(audio.duration)

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
    }
  }, [])

  const progress = duration > 0 ? currentTime / duration : 0

  return (
    <div className="flex items-center gap-3 w-full select-none">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={handlePlayPause}
        className="rounded-full w-[38px] h-[38px] flex items-center justify-center flex-shrink-0 transition-all duration-150 active:scale-90 bg-blue-500/20 text-blue-500 hover:bg-blue-500/30"
        aria-label={isPlaying ? 'Pausar' : 'Tocar'}
      >
        {isPlaying ? (
          <Pause className="h-[18px] w-[18px] ml-0" />
        ) : (
          <Play className="h-[18px] w-[18px] ml-0.5" />
        )}
      </button>
      <div className="flex items-center gap-0.5 h-8 flex-1 min-w-0">
        {waveform.map((height, i) => {
          const barProgress = i / waveform.length
          const isPlayed = barProgress <= progress
          return (
            <div
              key={i}
              className="flex-1 rounded-full transition-all duration-75"
              style={{
                height: `${Math.max(height * 28, 3)}px`,
                backgroundColor: isPlayed
                  ? isMe
                    ? 'rgb(59 130 246 / 0.7)'
                    : 'rgb(59 130 246 / 0.7)'
                  : isMe
                    ? 'rgb(59 130 246 / 0.25)'
                    : 'rgb(107 114 128 / 0.3)',
              }}
            />
          )
        })}
      </div>
      <span className="text-xs tabular-nums text-chat-muted/70 flex-shrink-0 w-[36px] text-right">
        {formatTime(currentTime)}
      </span>
    </div>
  )
}
