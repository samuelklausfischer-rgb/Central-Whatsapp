import { ExternalLink, FolderOpen, FolderX } from 'lucide-react'
import { FOCO, cn } from './cn'

/** Cor da marca SharePoint (#038387). `grande` = destaque do topo; `medio` = atalho em cartão; `link` = texto pequeno. */
export function BotaoSharePoint({ url, tamanho = 'grande' }: { url: string | null | undefined; tamanho?: 'grande' | 'medio' | 'link' }) {
  if (tamanho === 'link') {
    if (!url) return <span className="text-xs text-slate-600">Sem pasta no SharePoint</span>
    return (
      <a href={encodeURI(url)} target="_blank" rel="noreferrer"
        className={cn('inline-flex items-center gap-1.5 rounded-md bg-[#038387]/10 px-2 py-1 text-xs font-semibold text-[#026d70] hover:bg-[#038387]/20', FOCO)}>
        <FolderOpen className="size-4" aria-hidden="true" />Pasta no SharePoint
      </a>
    )
  }
  if (!url) {
    return (
      <span aria-disabled="true" className={cn('inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-slate-200 text-slate-600',
        tamanho === 'grande' ? 'px-4 py-3 text-sm font-semibold' : 'px-3 py-2 text-sm font-medium')}>
        <FolderX className="size-5" aria-hidden="true" />Sem pasta no SharePoint
      </span>
    )
  }
  return (
    <a href={encodeURI(url)} target="_blank" rel="noreferrer"
      className={cn('inline-flex items-center gap-2.5 rounded-lg bg-[#038387] text-white shadow-md transition-colors hover:bg-[#026d70] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#026d70]',
        tamanho === 'grande' ? 'px-5 py-3' : 'px-3.5 py-2')}>
      <FolderOpen className={tamanho === 'grande' ? 'size-6' : 'size-5'} aria-hidden="true" />
      <span className="text-left leading-tight">
        <span className="block text-sm font-semibold">Abrir pasta no SharePoint</span>
        {tamanho === 'grande' && <span className="block text-xs text-teal-50">contratos, aditivos e documentos</span>}
      </span>
      <ExternalLink className="size-4 opacity-80" aria-hidden="true" />
    </a>
  )
}
