import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { downloadFile } from '@/lib/download'

export type ViewerMedia = { url: string; type: 'image' | 'video'; name?: string }

const MIN_SCALE = 1
const MAX_SCALE = 5
const STEP = 0.25

const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(v * 100) / 100))

/**
 * Visualizador in-app de imagem/vídeo (lightbox).
 * - Imagem: zoom (roda do mouse + botões +/−, duplo-clique alterna) e pan (arrastar quando zoom > 1).
 * - Vídeo: player com controles + autoplay.
 * - Fechar (X / clique no fundo / ESC) e baixar.
 */
export function MediaViewer({ media, onClose }: { media: ViewerMedia | null; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const draggingRef = useRef(false)
  const lastRef = useRef({ x: 0, y: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)

  const isImage = media?.type === 'image'
  const url = media?.url

  // Reseta o transform sempre que a mídia muda.
  useEffect(() => {
    setScale(1)
    setTx(0)
    setTy(0)
  }, [url])

  // ESC fecha.
  useEffect(() => {
    if (!media) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [media, onClose])

  // Zoom pela roda do mouse (listener não-passivo p/ permitir preventDefault).
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !isImage) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? STEP : -STEP
      setScale((s) => {
        const ns = clamp(s + delta)
        if (ns === MIN_SCALE) {
          setTx(0)
          setTy(0)
        }
        return ns
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [isImage, url])

  if (!media) return null

  const zoomBy = (delta: number) =>
    setScale((s) => {
      const ns = clamp(s + delta)
      if (ns === MIN_SCALE) {
        setTx(0)
        setTy(0)
      }
      return ns
    })

  const resetZoom = () => {
    setScale(1)
    setTx(0)
    setTy(0)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isImage || scale <= 1) return
    draggingRef.current = true
    lastRef.current = { x: e.clientX, y: e.clientY }
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    setTx((v) => v + (e.clientX - lastRef.current.x))
    setTy((v) => v + (e.clientY - lastRef.current.y))
    lastRef.current = { x: e.clientX, y: e.clientY }
  }
  const endDrag = () => {
    draggingRef.current = false
  }

  const toolBtn =
    'flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white ring-1 ring-white/25 hover:bg-black/70 transition-colors'

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/90 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div className="flex items-center justify-end gap-1.5 p-3" onClick={(e) => e.stopPropagation()}>
        {isImage && (
          <>
            <button type="button" onClick={() => zoomBy(-STEP)} title="Diminuir zoom" className={toolBtn}>
              <ZoomOut className="h-5 w-5" />
            </button>
            <span className="min-w-[3.5rem] text-center text-sm font-medium tabular-nums text-white/90">
              {Math.round(scale * 100)}%
            </span>
            <button type="button" onClick={() => zoomBy(STEP)} title="Aumentar zoom" className={toolBtn}>
              <ZoomIn className="h-5 w-5" />
            </button>
            <button type="button" onClick={resetZoom} title="Resetar zoom" className={toolBtn}>
              <RotateCcw className="h-5 w-5" />
            </button>
            <span className="mx-1 h-6 w-px bg-white/20" />
          </>
        )}
        <button
          type="button"
          onClick={() => downloadFile(media.url, media.name || 'arquivo')}
          title="Baixar"
          className={toolBtn}
        >
          <Download className="h-5 w-5" />
        </button>
        <button type="button" onClick={onClose} title="Fechar" className={toolBtn}>
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        ref={wrapRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {isImage ? (
          <img
            src={media.url}
            alt={media.name || 'Imagem'}
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => (scale > 1 ? resetZoom() : zoomBy(1))}
            style={{
              transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
              cursor: scale > 1 ? 'grab' : 'zoom-in',
              transition: draggingRef.current ? 'none' : 'transform 150ms ease-out',
            }}
            className="max-h-full max-w-full select-none object-contain"
          />
        ) : (
          <video src={media.url} controls autoPlay className="max-h-full max-w-full rounded object-contain" />
        )}
      </div>
    </div>,
    document.body,
  )
}
