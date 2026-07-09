import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, ZoomIn, ZoomOut, RotateCcw, Loader2 } from 'lucide-react'
import { downloadFile } from '@/lib/download'

export type ViewerMedia = { url: string; type: 'image' | 'video' | 'pdf' | 'excel'; name?: string }

const EXCEL_ROW_LIMIT = 500

type ExcelWorkbookPreview = {
  sheetNames: string[]
  sheets: Record<string, unknown[][]>
}

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
  const isPdf = media?.type === 'pdf'
  const isExcel = media?.type === 'excel'
  const url = media?.url

  const [excelWorkbook, setExcelWorkbook] = useState<ExcelWorkbookPreview | null>(null)
  const [activeSheet, setActiveSheet] = useState<string | null>(null)
  const [excelLoading, setExcelLoading] = useState(false)
  const [excelError, setExcelError] = useState<string | null>(null)

  // Reseta o transform sempre que a mídia muda.
  useEffect(() => {
    setScale(1)
    setTx(0)
    setTy(0)
  }, [url])

  // Busca e faz o parse da planilha quando o preview é de Excel.
  useEffect(() => {
    if (!isExcel || !url) {
      setExcelWorkbook(null)
      setActiveSheet(null)
      setExcelError(null)
      return
    }
    let cancelled = false
    setExcelLoading(true)
    setExcelError(null)
    Promise.all([import('xlsx'), fetch(url)])
      .then(([XLSX, res]) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer().then((buffer) => [XLSX, buffer] as const)
      })
      .then(([XLSX, buffer]) => {
        if (cancelled) return
        const wb = XLSX.read(buffer, { type: 'array' })
        const sheets: Record<string, unknown[][]> = {}
        for (const name of wb.SheetNames) {
          sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true }) as unknown[][]
        }
        setExcelWorkbook({ sheetNames: wb.SheetNames, sheets })
        setActiveSheet(wb.SheetNames[0] ?? null)
      })
      .catch((err) => {
        if (!cancelled) setExcelError(err?.message || 'Não foi possível ler a planilha')
      })
      .finally(() => {
        if (!cancelled) setExcelLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isExcel, url])

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
      <div className="flex items-center justify-between gap-1.5 p-3" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate text-sm font-medium text-white/80">
          {media.name || ''}
        </span>
        <div className="flex items-center gap-1.5">
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
      </div>

      <div
        ref={wrapRef}
        className={
          isPdf || isExcel
            ? 'flex min-h-0 flex-1 overflow-hidden p-2 sm:p-4'
            : 'flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-8'
        }
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
        ) : isPdf ? (
          <iframe
            src={media.url}
            title={media.name || 'PDF'}
            className="h-full w-full rounded bg-white"
          />
        ) : isExcel ? (
          <div className="flex h-full w-full min-h-0 flex-col rounded bg-white">
            {excelLoading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-chat-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando planilha…
              </div>
            ) : excelError ? (
              <div className="flex flex-1 items-center justify-center text-sm text-red-500">
                Não foi possível abrir a planilha: {excelError}
              </div>
            ) : excelWorkbook ? (
              <>
                {excelWorkbook.sheetNames.length > 1 && (
                  <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50 px-2 py-1.5">
                    {excelWorkbook.sheetNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setActiveSheet(name)}
                        className={
                          'flex-shrink-0 rounded px-2.5 py-1 text-xs font-medium transition-colors ' +
                          (activeSheet === name
                            ? 'bg-primary text-primary-foreground'
                            : 'text-gray-600 hover:bg-gray-200')
                        }
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <tbody>
                      {(excelWorkbook.sheets[activeSheet || ''] || [])
                        .slice(0, EXCEL_ROW_LIMIT)
                        .map((row, rowIdx) => (
                          <tr key={rowIdx} className={rowIdx === 0 ? 'bg-gray-100 font-semibold' : 'odd:bg-white even:bg-gray-50'}>
                            {(row as unknown[]).map((cell, cellIdx) => (
                              <td key={cellIdx} className="whitespace-nowrap border border-gray-200 px-2 py-1 text-gray-800">
                                {cell === null || cell === undefined ? '' : String(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {(excelWorkbook.sheets[activeSheet || ''] || []).length > EXCEL_ROW_LIMIT && (
                    <div className="p-2 text-center text-xs text-chat-muted">
                      Mostrando as primeiras {EXCEL_ROW_LIMIT} linhas — baixe o arquivo para ver tudo.
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <video src={media.url} controls autoPlay className="max-h-full max-w-full rounded object-contain" />
        )}
      </div>
    </div>,
    document.body,
  )
}
