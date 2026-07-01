import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { downloadFile } from '@/lib/download'
import { getFileTypeMeta, isPdfFile, isExcelFile } from '@/lib/file-type'
import { getPdfPreview } from '@/lib/pdf-thumbnail'
import { getExcelPreview, type ExcelPreview } from '@/lib/excel-preview'
import { getFileSize, formatFileSize } from '@/lib/file-size'

/**
 * Balão de documento no chat, estilo WhatsApp: card branco com prévia real do
 * conteúdo (primeira página do PDF, recorte da planilha do Excel) + barra com
 * ícone/nome/tamanho por baixo. Outros tipos (Word, ZIP etc.) mostram só a
 * barra com ícone.
 */
export function DocumentBubble({
  url,
  name,
  onOpenPreview,
}: {
  url: string
  name: string
  onOpenPreview: (() => void) | null
}) {
  const meta = getFileTypeMeta(name)
  const Icon = meta.icon
  const isPdf = isPdfFile(name)
  const isExcel = isExcelFile(name)
  const hasThumbnailArea = isPdf || isExcel

  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [excelPreview, setExcelPreview] = useState<ExcelPreview>(null)
  const [sizeLabel, setSizeLabel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (isPdf) {
      getPdfPreview(url).then((preview) => {
        if (cancelled) return
        setThumbnail(preview.thumbnail)
        setPageCount(preview.pageCount)
      })
    }
    if (isExcel) {
      getExcelPreview(url).then((preview) => {
        if (cancelled) return
        setExcelPreview(preview)
      })
    }
    getFileSize(url).then((bytes) => {
      if (cancelled || bytes === null) return
      setSizeLabel(formatFileSize(bytes))
    })
    return () => {
      cancelled = true
    }
  }, [url, isPdf, isExcel])

  const metaParts = [meta.label]
  if (isPdf && pageCount) metaParts.push(`${pageCount} página${pageCount > 1 ? 's' : ''}`)
  if (sizeLabel) metaParts.push(sizeLabel)
  if (!hasThumbnailArea && onOpenPreview) metaParts.push('toque para visualizar')

  return (
    <button
      type="button"
      onClick={() => (onOpenPreview ? onOpenPreview() : downloadFile(url, name))}
      className="block w-full max-w-[280px] overflow-hidden rounded-xl border border-black/10 bg-white text-left shadow-sm transition-opacity hover:opacity-90"
    >
      {isPdf && (
        <div className="flex h-[170px] w-full items-center justify-center overflow-hidden bg-gray-100">
          {thumbnail ? (
            <img src={thumbnail} alt={name} className="h-full w-full object-cover object-top" />
          ) : (
            <Icon className={`h-10 w-10 ${meta.iconClass}`} />
          )}
        </div>
      )}
      {isExcel && (
        <div className="flex h-[170px] w-full items-center justify-center overflow-hidden bg-white p-2">
          {excelPreview && excelPreview.rows.length > 0 ? (
            <table className="w-full table-fixed border-collapse text-left text-[9px] leading-tight text-gray-700">
              <tbody>
                {excelPreview.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className={rowIdx === 0 ? 'font-semibold text-gray-900' : ''}>
                    {row.map((cell, cellIdx) => (
                      <td key={cellIdx} className="truncate border border-gray-100 px-1 py-0.5">
                        {cell === null || cell === undefined ? '' : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Icon className={`h-10 w-10 ${meta.iconClass}`} />
          )}
        </div>
      )}
      <div className={`flex items-center gap-2.5 p-2.5 ${hasThumbnailArea ? 'border-t border-gray-200' : ''}`}>
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${meta.bgClass}`}>
          <Icon className={`h-5 w-5 ${meta.iconClass}`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900" title={name}>
            {name}
          </span>
          <span className="block truncate text-xs text-gray-500">{metaParts.join(' · ')}</span>
        </span>
        <Download
          className="h-4 w-4 flex-shrink-0 text-gray-400"
          onClick={(e) => {
            e.stopPropagation()
            downloadFile(url, name)
          }}
        />
      </div>
    </button>
  )
}
