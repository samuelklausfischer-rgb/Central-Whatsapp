import { useEffect, useState, useCallback } from 'react'
import { ImageOff, LinkIcon, Loader2, ExternalLink, Play } from 'lucide-react'
import { getFileTypeMeta } from '@/lib/file-type'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  getFotosDaConversa,
  getDocumentosDaConversa,
  getLinksDaConversa,
  type ItemDeGaleria,
  type LinkDeGaleria,
} from '@/services/gallery'

/**
 * Galeria da conversa: Fotos, Documentos e Links.
 *
 * DUAS DECISÕES QUE DEFINEM ESTA TELA
 *
 * 1. Os dados vêm do BANCO, não das mensagens em memória — ver o comentário em
 *    services/gallery.ts. Resumindo: 15,3% dos anexos ficam fora das 500
 *    carregadas, e usar a memória daria uma galeria incompleta sem erro visível.
 *
 * 2. A lista de documentos NÃO reaproveita o DocumentBubble. Ele baixa o PDF
 *    inteiro para gerar a miniatura; numa conversa com 234 documentos seriam 234
 *    downloads ao abrir a aba, travando o app da clínica. Aqui a linha usa só
 *    `getFileTypeMeta` (ícone por extensão, zero rede).
 */

type Aba = 'fotos' | 'documentos' | 'links'

interface Props {
  deviceId: string
  remoteSender: string
  /** Abre o item no visualizador existente (MediaViewer). */
  onAbrirMidia: (itens: ItemDeGaleria[], index: number) => void
}

const formatarData = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

/** Cabeçalho de mês, como no WhatsApp. */
const chaveDoMes = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

export function ConversationGallery({ deviceId, remoteSender, onAbrirMidia }: Props) {
  const [aba, setAba] = useState<Aba>('fotos')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(false)
  const [fotos, setFotos] = useState<ItemDeGaleria[]>([])
  const [documentos, setDocumentos] = useState<ItemDeGaleria[]>([])
  const [links, setLinks] = useState<LinkDeGaleria[]>([])

  const carregar = useCallback(() => {
    if (!deviceId || !remoteSender) return
    let cancelado = false
    setCarregando(true)
    setErro(false)
    Promise.all([
      getFotosDaConversa(deviceId, remoteSender),
      getDocumentosDaConversa(deviceId, remoteSender),
      getLinksDaConversa(deviceId, remoteSender),
    ])
      .then(([f, d, l]) => {
        if (cancelado) return
        setFotos(f)
        setDocumentos(d)
        setLinks(l)
        setCarregando(false)
      })
      .catch(() => {
        if (cancelado) return
        // Nunca mostrar "nenhuma mídia" quando na verdade a busca falhou — foi
        // esse tipo de mentira na tela que já custou caro neste app.
        setErro(true)
        setCarregando(false)
      })
    return () => {
      cancelado = true
    }
  }, [deviceId, remoteSender])

  useEffect(() => {
    const limpar = carregar()
    return limpar
  }, [carregar])

  const abas: { id: Aba; rotulo: string; total: number }[] = [
    { id: 'fotos', rotulo: 'Fotos', total: fotos.length },
    { id: 'documentos', rotulo: 'Documentos', total: documentos.length },
    { id: 'links', rotulo: 'Links', total: links.length },
  ]

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex gap-1 border-b border-chat-border px-1">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            className={cn(
              'flex-1 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              aba === a.id
                ? 'border-primary text-chat-text'
                : 'border-transparent text-chat-muted hover:text-chat-text',
            )}
          >
            {a.rotulo}
            {!carregando && a.total > 0 && (
              <span className="ml-1.5 text-xs text-chat-muted/70">{a.total}</span>
            )}
          </button>
        ))}
      </div>

      <div className="py-3">
        {carregando ? (
          <div className="flex items-center justify-center py-10 text-chat-muted gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Carregando…</span>
          </div>
        ) : erro ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <p className="text-chat-muted text-sm">Não foi possível carregar.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={carregar}>
              Tentar novamente
            </Button>
          </div>
        ) : aba === 'fotos' ? (
          <GradeDeFotos itens={fotos} onAbrir={onAbrirMidia} />
        ) : aba === 'documentos' ? (
          <ListaDeDocumentos itens={documentos} />
        ) : (
          <ListaDeLinks itens={links} />
        )}
      </div>
    </div>
  )
}

function Vazio({ texto }: { texto: string }) {
  return <p className="text-center text-sm text-chat-muted py-10">{texto}</p>
}

function GradeDeFotos({
  itens,
  onAbrir,
}: {
  itens: ItemDeGaleria[]
  onAbrir: (itens: ItemDeGaleria[], index: number) => void
}) {
  if (itens.length === 0) return <Vazio texto="Nenhuma foto ou vídeo nesta conversa." />

  // Só os disponíveis entram na navegação do visualizador — abrir um arquivo
  // morto e ficar preso nele seria pior que não deixar abrir.
  const navegaveis = itens.filter((i) => i.disponivel)

  return (
    <div className="grid grid-cols-3 gap-1">
      {itens.map((item) => {
        if (!item.disponivel) {
          return (
            <div
              key={item.messageId + item.url}
              title="Arquivo não está mais disponível"
              className="aspect-square flex flex-col items-center justify-center gap-1 rounded bg-chat-muted/5 border border-dashed border-chat-border text-chat-muted/50"
            >
              <ImageOff className="h-5 w-5" />
              <span className="text-[10px] px-1 text-center leading-tight">indisponível</span>
            </div>
          )
        }
        const indice = navegaveis.findIndex((n) => n.messageId === item.messageId && n.url === item.url)
        return (
          <button
            key={item.messageId + item.url}
            type="button"
            onClick={() => onAbrir(navegaveis, Math.max(0, indice))}
            className="relative aspect-square overflow-hidden rounded bg-chat-muted/10 group"
            title={`${formatarData(item.createdAt)}${item.legenda ? ' — ' + item.legenda : ''}`}
          >
            {item.tipo === 'video' ? (
              <>
                <video src={item.url} className="h-full w-full object-cover" preload="metadata" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                  <Play className="h-6 w-6 text-white drop-shadow" />
                </span>
              </>
            ) : (
              <img
                src={item.url}
                alt={item.legenda || item.nome}
                loading="lazy"
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

function ListaDeDocumentos({ itens }: { itens: ItemDeGaleria[] }) {
  if (itens.length === 0) return <Vazio texto="Nenhum documento nesta conversa." />

  let mesAtual = ''
  return (
    <div className="flex flex-col gap-0.5">
      {itens.map((item) => {
        const meta = getFileTypeMeta(item.nome)
        const IconeDoArquivo = meta.icon
        const mes = chaveDoMes(item.createdAt)
        const mostrarMes = mes !== mesAtual
        if (mostrarMes) mesAtual = mes
        const conteudo = (
          <>
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded', meta.bgClass)}>
              <IconeDoArquivo className={cn('h-4 w-4', meta.iconClass)} />
            </span>
            <span className="flex-1 min-w-0 text-left">
              <span className="block truncate text-sm text-chat-text">{item.nome}</span>
              <span className="block text-xs text-chat-muted">
                {formatarData(item.createdAt)}
                {!item.disponivel && ' · arquivo indisponível'}
              </span>
            </span>
          </>
        )
        return (
          <div key={item.messageId + item.url}>
            {mostrarMes && (
              <p className="px-1 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-chat-muted/70">
                {mes}
              </p>
            )}
            {item.disponivel ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded px-1 py-2 hover:bg-chat-hover"
              >
                {conteudo}
              </a>
            ) : (
              <div className="flex items-center gap-3 rounded px-1 py-2 opacity-50" title="Arquivo não está mais disponível">
                {conteudo}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ListaDeLinks({ itens }: { itens: LinkDeGaleria[] }) {
  if (itens.length === 0) return <Vazio texto="Nenhum link nesta conversa." />

  return (
    <div className="flex flex-col gap-0.5">
      {itens.map((item, i) => (
        <a
          key={item.messageId + i}
          href={item.url.startsWith('http') ? item.url : `https://${item.url}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 rounded px-1 py-2 hover:bg-chat-hover"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-chat-muted/10">
            <LinkIcon className="h-4 w-4 text-chat-muted" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-1 text-sm text-primary">
              <span className="truncate">{item.url}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
            </span>
            <span className="block truncate text-xs text-chat-muted">{item.trecho}</span>
            <span className="block text-xs text-chat-muted/70">{formatarData(item.createdAt)}</span>
          </span>
        </a>
      ))}
    </div>
  )
}
