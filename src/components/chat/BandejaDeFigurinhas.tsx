/**
 * A bandeja de figurinhas do compositor: mandar uma, e guardar as preferidas.
 *
 * DUAS ABAS, E POR QUÊ
 *   Recentes  — as que apareceram NESTA conversa. É de onde vem o "poder pegar
 *               figurinha" do pedido: a pessoa viu uma boa, quer devolver na
 *               hora, sem precisar guardar antes.
 *   Guardadas — a coleção pessoal, que atravessa conversas. É o "deixar
 *               figurinhas salvas de forma organizada".
 *
 * As recentes saem das mensagens já carregadas (nenhuma consulta a mais), e
 * cada uma tem o botão de guardar no canto — que é o gesto que enche a segunda
 * aba.
 */

import { useEffect, useState } from 'react'
import { Loader2, Smile, Star, Trash2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import {
  enviarFigurinha,
  esquecerFigurinha,
  getFigurinhasSalvas,
  guardarFigurinha,
  type FigurinhaSalva,
} from '@/services/figurinhas'

interface Props {
  deviceId: string
  remoteSender: string
  userId: string
  /** URLs de figurinha vistas nesta conversa, das mais novas para as antigas. */
  recentes: string[]
  aoEnviar?: () => void
}

export function BandejaDeFigurinhas({
  deviceId,
  remoteSender,
  userId,
  recentes,
  aoEnviar,
}: Props) {
  const { toast } = useToast()
  const [aberta, setAberta] = useState(false)
  const [aba, setAba] = useState<'recentes' | 'guardadas'>('recentes')
  const [guardadas, setGuardadas] = useState<FigurinhaSalva[]>([])
  const [enviando, setEnviando] = useState<string | null>(null)

  const recarregar = () => {
    void getFigurinhasSalvas().then(setGuardadas)
  }

  // Só lê as guardadas quando a bandeja abre: quem nunca clica no ícone não
  // paga por uma consulta em toda conversa aberta.
  useEffect(() => {
    if (aberta) recarregar()
  }, [aberta])

  // Sem nenhuma figurinha nesta conversa, a aba útil é a das guardadas.
  useEffect(() => {
    if (aberta && recentes.length === 0) setAba('guardadas')
  }, [aberta, recentes.length])

  const mandar = async (url: string) => {
    setEnviando(url)
    try {
      await enviarFigurinha(deviceId, remoteSender, url, userId)
      setAberta(false)
      aoEnviar?.()
    } catch (e) {
      toast({
        title: 'Não consegui enviar a figurinha',
        description: e instanceof Error ? e.message : 'Erro desconhecido',
        variant: 'destructive',
      })
    } finally {
      setEnviando(null)
    }
  }

  const guardar = async (url: string) => {
    try {
      await guardarFigurinha(userId, url)
      recarregar()
      toast({ title: 'Figurinha guardada' })
    } catch (e) {
      toast({
        title: 'Não consegui guardar',
        description: e instanceof Error ? e.message : 'Erro desconhecido',
        variant: 'destructive',
      })
    }
  }

  const esquecer = async (id: string) => {
    try {
      await esquecerFigurinha(id)
      recarregar()
    } catch (e) {
      toast({
        title: 'Não consegui tirar da coleção',
        description: e instanceof Error ? e.message : 'Erro desconhecido',
        variant: 'destructive',
      })
    }
  }

  const urlsVisiveis = aba === 'recentes' ? recentes : guardadas.map((g) => g.storage_url)

  return (
    <Popover open={aberta} onOpenChange={setAberta}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Figurinhas"
          aria-label="Figurinhas"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-chat-muted transition-colors hover:bg-chat-hover hover:text-chat-text"
        >
          <Smile className="h-5 w-5" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        className="z-[80] w-80 border-chat-border bg-chat-panel p-2 shadow-chat"
      >
        <div className="mb-2 flex gap-1">
          {(['recentes', 'guardadas'] as const).map((qual) => (
            <button
              key={qual}
              type="button"
              onClick={() => setAba(qual)}
              className={
                'flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ' +
                (aba === qual
                  ? 'bg-chat-hover text-chat-text'
                  : 'text-chat-muted hover:bg-chat-hover/60')
              }
            >
              {qual === 'recentes' ? 'Da conversa' : 'Guardadas'}
            </button>
          ))}
        </div>

        {urlsVisiveis.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-chat-muted">
            {aba === 'recentes'
              ? 'Nenhuma figurinha nesta conversa ainda.'
              : 'Você ainda não guardou nenhuma. Passe o mouse numa figurinha da conversa e clique na estrela.'}
          </p>
        ) : (
          <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-auto">
            {urlsVisiveis.map((url) => {
              const salva = guardadas.find((g) => g.storage_url === url)
              return (
                <div key={url} className="group relative">
                  <button
                    type="button"
                    disabled={enviando !== null}
                    onClick={() => void mandar(url)}
                    title="Enviar esta figurinha"
                    className="flex aspect-square w-full items-center justify-center rounded-lg p-1 transition-colors hover:bg-chat-hover disabled:opacity-50"
                  >
                    {enviando === url ? (
                      <Loader2 className="h-4 w-4 animate-spin text-chat-muted" />
                    ) : (
                      <img src={url} alt="figurinha" className="max-h-full max-w-full object-contain" />
                    )}
                  </button>

                  {/* Guardar (na aba da conversa) ou tirar da coleção (na aba
                      das guardadas) — sempre no canto, sempre no hover, para
                      não competir com o alvo principal, que é enviar. */}
                  {aba === 'recentes' && !salva && (
                    <button
                      type="button"
                      onClick={() => void guardar(url)}
                      title="Guardar nas minhas figurinhas"
                      className="absolute -right-0.5 -top-0.5 hidden rounded-full bg-chat-panel p-1 text-chat-muted shadow-chat hover:text-amber-500 group-hover:block"
                    >
                      <Star className="h-3 w-3" />
                    </button>
                  )}
                  {aba === 'guardadas' && salva && (
                    <button
                      type="button"
                      onClick={() => void esquecer(salva.id)}
                      title="Tirar da coleção"
                      className="absolute -right-0.5 -top-0.5 hidden rounded-full bg-chat-panel p-1 text-chat-muted shadow-chat hover:text-red-500 group-hover:block"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
