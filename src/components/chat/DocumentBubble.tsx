import { useEffect, useState } from 'react'
import { Download, File } from 'lucide-react'
import { downloadFile, nomeParaDownload } from '@/lib/download'
import { getFileTypeMeta, getFileExtension, isPdfFile, isExcelFile } from '@/lib/file-type'
import { getPdfPreview } from '@/lib/pdf-thumbnail'
import { getExcelPreview, type ExcelPreview } from '@/lib/excel-preview'
import { getFileSize, formatFileSize } from '@/lib/file-size'

/**
 * Balão de documento no chat, estilo WhatsApp: cartão um tom mais escuro que o
 * próprio balão (sem sombra, borda nem fundo branco), largura fixa de 330px,
 * com prévia real do conteúdo (primeira página do PDF, recorte da planilha do
 * Excel) + barra com ícone cinza (sigla do tipo), nome, "EXT • tamanho" e
 * download. Outros tipos (Word, ZIP etc.) mostram só a barra.
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
  // Sigla do tipo (ZIP, PDF, XLSX…), no máximo 4 letras: vai escrita no ícone e
  // no subtítulo. O rótulo amigável ("Compactado") não aparece mais aqui.
  const sigla = getFileExtension(name).slice(0, 4).toUpperCase()
  const isPdf = isPdfFile(name)
  const isExcel = isExcelFile(name)

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

  const metaParts: string[] = []
  if (isPdf && pageCount) metaParts.push(`${pageCount} página${pageCount > 1 ? 's' : ''}`)
  metaParts.push(sigla || meta.label)
  if (sizeLabel) metaParts.push(sizeLabel)

  return (
    <button
      type="button"
      onClick={() => (onOpenPreview ? onOpenPreview() : downloadFile(url, nomeParaDownload(name, 'documento')))}
      className="block w-[330px] max-w-full overflow-hidden rounded-[6px] bg-black/[0.04] text-left transition-opacity hover:opacity-90 dark:bg-white/[0.05]"
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
      <div className="flex items-center gap-2.5 p-2.5">
        {/* Documento cinza com a sigla escrita embaixo, sem o quadrado colorido. */}
        <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center text-chat-muted">
          <File className="h-8 w-8" strokeWidth={1.5} />
          <span className="absolute bottom-[5px] text-[8px] font-bold leading-none">{sigla}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-all text-[14.2px] leading-[19px] text-chat-text" title={name}>
            {name}
          </span>
          <span className="block truncate text-[12px] text-chat-muted">{metaParts.join(' • ')}</span>
        </span>
        <Download
          className="h-[22px] w-[22px] flex-shrink-0 text-chat-muted"
          onClick={(e) => {
            e.stopPropagation()
            downloadFile(url, nomeParaDownload(name, 'documento'))
          }}
        />
      </div>
    </button>
  )
}
