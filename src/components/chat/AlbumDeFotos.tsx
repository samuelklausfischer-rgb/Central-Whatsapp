import type { ReactNode } from 'react'
import { AlertCircle, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ItemDoAlbum = {
  id: string
  url: string
  tipo: 'image' | 'video'
  nome?: string
  /** Horário já formatado da mensagem DESTE quadro. */
  horario: string
  falhou?: boolean
  /** Véu de progresso de envio (só existe enquanto a foto sobe). */
  veu?: ReactNode
}

/**
 * Álbum do WhatsApp: 4 ou mais fotos/vídeos seguidos viram uma grade 2×2 de
 * 330px com fendas de 3px. Mostra os 4 primeiros; havendo mais, o 4º quadro
 * escurece com "+N". Cada quadro leva o horário da sua própria mensagem sobre
 * um degradê no canto, como a mídia sem legenda.
 *
 * Só desenha e avisa qual quadro foi clicado: quem abre o visualizador (com a
 * lista inteira, inclusive os itens além do 4º) é o ChatWindow.
 */
export function AlbumDeFotos({ itens, onAbrir }: { itens: ItemDoAlbum[]; onAbrir: (indice: number) => void }) {
  const visiveis = itens.slice(0, 4)
  const restantes = itens.length - 4

  return (
    <div className="grid w-[330px] max-w-full grid-cols-2 gap-[3px] overflow-hidden rounded-[6px]">
      {visiveis.map((item, i) => {
        const ehMais = i === 3 && restantes > 0
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onAbrir(i)}
            aria-label={ehMais ? `Ver mais ${restantes} itens` : item.nome || (item.tipo === 'video' ? 'Vídeo' : 'Imagem')}
            className="group/quadro relative block aspect-square overflow-hidden bg-chat-muted/10"
          >
            {item.tipo === 'video' ? (
              <video src={item.url} muted preload="metadata" className="pointer-events-none h-full w-full object-cover" />
            ) : (
              <img
                src={item.url}
                alt={item.nome || 'Imagem'}
                loading="lazy"
                className="pointer-events-none h-full w-full object-cover"
              />
            )}
            {item.tipo === 'video' && !ehMais && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white">
                  <Play className="h-5 w-5 translate-x-0.5" fill="currentColor" />
                </span>
              </span>
            )}
            {item.veu}
            {ehMais ? (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 text-[28px] font-medium text-white">
                +{restantes}
              </span>
            ) : (
              <>
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-black/50 to-transparent" />
                <span
                  className={cn(
                    'pointer-events-none absolute bottom-1 right-1.5 flex items-center gap-1 text-[11px] leading-none',
                    item.falhou ? 'text-red-300' : 'text-white',
                  )}
                >
                  {item.falhou && <AlertCircle className="h-3 w-3" />}
                  {item.horario}
                </span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
