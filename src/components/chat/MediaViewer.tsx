import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, ZoomIn, ZoomOut, RotateCcw, Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { downloadFile, nomeParaDownload, type TipoArquivoDownload } from '@/lib/download'

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

/** Prende um deslocamento ao intervalo [-limite, +limite]. */
const prender = (v: number, limite: number) => Math.max(-limite, Math.min(limite, v))

/**
 * Estado do transform da imagem, num objeto só.
 *
 * Zoom e deslocamento mudam JUNTOS — ampliar num ponto exige recalcular o
 * deslocamento na mesma passada. Com três estados separados era preciso chamar
 * `setTx` de dentro do updater do `setScale`, o que faz efeito colateral dentro
 * de reducer e roda duas vezes em modo estrito.
 */
type Vista = { scale: number; tx: number; ty: number }

const VISTA_INICIAL: Vista = { scale: MIN_SCALE, tx: 0, ty: 0 }

/** Mapeia o tipo do visualizador para a categoria usada no nome padrão de download. */
function tipoParaDownload(tipo: ViewerMedia['type']): TipoArquivoDownload {
  if (tipo === 'video') return 'video'
  if (tipo === 'image') return 'imagem'
  return 'documento'
}

/**
 * Visualizador in-app de imagem/vídeo (lightbox).
 * - Imagem: zoom (roda do mouse + botões +/−, duplo-clique alterna) e pan (arrastar quando zoom > 1).
 * - Vídeo: player com controles + autoplay.
 * - Fechar (X / clique no fundo / ESC) e baixar.
 */
export function MediaViewer({ media, onClose }: { media: ViewerMedia | null; onClose: () => void }) {
  const [vista, setVista] = useState<Vista>(VISTA_INICIAL)
  /** Verdadeiro enquanto há dedo/botão pressionado — desliga a transição. */
  const [interagindo, setInteragindo] = useState(false)
  const arrastandoRef = useRef(false)
  const ultimoRef = useRef({ x: 0, y: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  /** Ponteiros ativos por id: é o que permite reconhecer a pinça de dois dedos. */
  const ponteirosRef = useRef(new Map<number, { x: number; y: number }>())
  /** Distância e escala no instante em que a pinça começou. */
  const pincaRef = useRef<{ distancia: number; escala: number } | null>(null)

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
    setVista(VISTA_INICIAL)
  }, [url])

  /**
   * Até onde dá para arrastar: metade do que a imagem ESCALADA sobra para fora
   * do contêiner (o transform tem origem no centro). Quando a imagem cabe
   * inteira, o limite é zero e o arrasto simplesmente não sai do lugar.
   *
   * Sem isso o arrasto era ilimitado — bastava puxar um pouco com zoom baixo
   * para a foto sumir da tela e não haver como trazê-la de volta.
   */
  const limitesDoPan = useCallback((escala: number) => {
    const img = imgRef.current
    const wrap = wrapRef.current
    if (!img || !wrap) return { x: 0, y: 0 }
    return {
      x: Math.max(0, (img.clientWidth * escala - wrap.clientWidth) / 2),
      y: Math.max(0, (img.clientHeight * escala - wrap.clientHeight) / 2),
    }
  }, [])

  /**
   * Novo zoom mantendo fixo o ponto (px, py) da TELA — o que está sob o cursor,
   * ou no meio dos dois dedos, continua ali depois de ampliar.
   *
   * A conta sai de `tela - centro = imagem * escala + deslocamento`: isolando o
   * ponto da imagem antes e depois, o deslocamento novo é
   * `(P - c) - (P - c - t) * (escala nova / escala velha)`.
   *
   * Antes só a escala mudava e o deslocamento ficava parado: o trecho que a
   * pessoa queria ver fugia do cursor, e ao reduzir o zoom a imagem saltava
   * para longe porque o deslocamento seguia com a magnitude do zoom anterior.
   * Agora o clamp cuida disso sozinho — em escala 1 o limite é 0 e o
   * deslocamento volta ao centro sem precisar de caso especial.
   */
  const zoomAncorado = useCallback(
    (alvo: number | ((atual: number) => number), px?: number, py?: number) => {
      setVista((v) => {
        const escala = clamp(typeof alvo === 'function' ? alvo(v.scale) : alvo)
        if (escala === v.scale) return v
        const wrap = wrapRef.current
        if (!wrap) return { scale: escala, tx: 0, ty: 0 }
        const r = wrap.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const ax = px ?? cx
        const ay = py ?? cy
        const fator = escala / v.scale
        const lim = limitesDoPan(escala)
        return {
          scale: escala,
          tx: prender(ax - cx - (ax - cx - v.tx) * fator, lim.x),
          ty: prender(ay - cy - (ay - cy - v.ty) * fator, lim.y),
        }
      })
    },
    [limitesDoPan],
  )

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
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then((buffer) => {
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
  // Ancorado no cursor: a roda amplia o que está debaixo do ponteiro.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !isImage) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? STEP : -STEP
      zoomAncorado((s) => s + delta, e.clientX, e.clientY)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [isImage, url, zoomAncorado])

  if (!media) return null

  /** Botões +/− do topo: sem ponto de âncora, ampliam pelo centro. */
  const zoomBy = (delta: number) => zoomAncorado((s) => s + delta)

  const resetZoom = () => setVista(VISTA_INICIAL)

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isImage) return
    ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setInteragindo(true)
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }

    // Dois dedos: começa pinça e cancela qualquer arrasto em curso. Guardamos a
    // distância e a escala do INÍCIO do gesto, para o zoom acompanhar a razão
    // entre as distâncias em vez de acumular incrementos.
    if (ponteirosRef.current.size === 2) {
      const [a, b] = [...ponteirosRef.current.values()]
      pincaRef.current = { distancia: Math.hypot(a.x - b.x, a.y - b.y), escala: vista.scale }
      arrastandoRef.current = false
      return
    }

    if (vista.scale > MIN_SCALE) {
      arrastandoRef.current = true
      ultimoRef.current = { x: e.clientX, y: e.clientY }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isImage) return
    if (!ponteirosRef.current.has(e.pointerId)) return
    ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const pinca = pincaRef.current
    if (ponteirosRef.current.size >= 2 && pinca && pinca.distancia > 0) {
      const [a, b] = [...ponteirosRef.current.values()]
      const distancia = Math.hypot(a.x - b.x, a.y - b.y)
      zoomAncorado(pinca.escala * (distancia / pinca.distancia), (a.x + b.x) / 2, (a.y + b.y) / 2)
      return
    }

    if (!arrastandoRef.current) return
    const dx = e.clientX - ultimoRef.current.x
    const dy = e.clientY - ultimoRef.current.y
    ultimoRef.current = { x: e.clientX, y: e.clientY }
    setVista((v) => {
      const lim = limitesDoPan(v.scale)
      return { ...v, tx: prender(v.tx + dx, lim.x), ty: prender(v.ty + dy, lim.y) }
    })
  }

  const encerrarPonteiro = (e: React.PointerEvent) => {
    ponteirosRef.current.delete(e.pointerId)
    // Sobrando menos de dois dedos não há mais pinça. O dedo que ficou NÃO
    // vira arrasto no meio do gesto: quem quiser arrastar levanta e toca de novo.
    if (ponteirosRef.current.size < 2) pincaRef.current = null
    if (ponteirosRef.current.size === 0) {
      arrastandoRef.current = false
      setInteragindo(false)
    }
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
              {Math.round(vista.scale * 100)}%
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
          onClick={() => downloadFile(media.url, nomeParaDownload(media.name, tipoParaDownload(media.type)))}
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
            ref={imgRef}
            src={media.url}
            alt={media.name || 'Imagem'}
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={encerrarPonteiro}
            onPointerCancel={encerrarPonteiro}
            onDoubleClick={(e) =>
              zoomAncorado(vista.scale > MIN_SCALE ? MIN_SCALE : 2, e.clientX, e.clientY)
            }
            style={{
              transform: `translate(${vista.tx}px, ${vista.ty}px) scale(${vista.scale})`,
              cursor: vista.scale > MIN_SCALE ? 'grab' : 'zoom-in',
              // `interagindo` é estado, e não ref: a transição precisa sumir no
              // MESMO render em que o arrasto começa, senão cada quadro do gesto
              // ficaria perseguindo uma animação de 150ms e o arrasto vira borracha.
              transition: interagindo ? 'none' : 'transform 150ms ease-out',
              // Sem isto o navegador trata pinça e arrasto como gesto da página
              // (rolar, dar zoom no documento) e o visualizador nunca recebe os
              // eventos de ponteiro.
              touchAction: 'none',
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
