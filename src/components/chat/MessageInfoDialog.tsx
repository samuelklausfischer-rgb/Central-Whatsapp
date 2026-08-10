import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { getRecibosDaMensagem, type MessageReadReceipt } from '@/services/conversation_states'

interface MessageInfoDialogProps {
  open: boolean
  deviceId: string
  remoteSender: string
  /** Mensagem cujos recibos estão sendo consultados. */
  message: { id: string; created_at: string } | null
  onClose: () => void
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
}

/**
 * "Informações da mensagem": quem já viu ESTA mensagem específica, com data e
 * hora, e quem ainda não viu. Consome `getRecibosDaMensagem`
 * (services/conversation_states.ts), que já resolve "viu" e "quando" a partir
 * do log `conversation_read_progress` — este componente só separa em duas
 * listas e desenha.
 */
export function MessageInfoDialog({ open, deviceId, remoteSender, message, onClose }: MessageInfoDialogProps) {
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(false)
  const [recibos, setRecibos] = useState<MessageReadReceipt[]>([])

  // Deps propositalmente `message?.id`/`message?.created_at`, e não o objeto
  // `message` inteiro: o chamador (ChatWindow) passa um literal `{ id, ... }`
  // novo a cada render, então usar o objeto como dependência buscaria os
  // recibos de novo a cada nova mensagem chegando/poll enquanto o painel
  // estivesse aberto — os IDs são o que realmente identifica "qual mensagem".
  useEffect(() => {
    if (!open || !message) return
    let cancelado = false
    setLoading(true)
    setErro(false)
    getRecibosDaMensagem(deviceId, remoteSender, message.created_at)
      .then((r) => {
        if (cancelado) return
        setRecibos(r)
      })
      .catch((err) => {
        console.error('Error loading message receipts:', err)
        if (!cancelado) setErro(true)
      })
      .finally(() => {
        if (!cancelado) setLoading(false)
      })
    return () => { cancelado = true }
  }, [open, deviceId, remoteSender, message?.id, message?.created_at])

  // Ordem cronológica de quem viu: quem viu primeiro aparece primeiro, como
  // uma linha do tempo de leitura — e não "mais recente no topo", que mudaria
  // de ordem sozinho a cada vez que alguém novo abre a conversa.
  const vistoPor = recibos
    .filter((r) => r.seen_at)
    .sort((a, b) => new Date(a.seen_at as string).getTime() - new Date(b.seen_at as string).getTime())
  const naoVisto = recibos.filter((r) => !r.seen_at)

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-w-sm w-full">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Informações da mensagem
          </DialogTitle>
          <DialogDescription className="sr-only">
            Mostra quais atendentes já viram esta mensagem, com data e horário, e quem ainda não viu.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col gap-3 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-1">
                <div className="h-9 w-9 rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex flex-col gap-1.5 flex-1">
                  <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : erro ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <AlertTriangle className="h-8 w-8 text-destructive/60 mb-2" />
            <p className="text-sm text-chat-muted">
              Não foi possível carregar quem viu esta mensagem.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                // Reabre o efeito trocando o estado de erro — mesmo caminho da
                // carga inicial, sem duplicar a chamada.
                setErro(false)
                setLoading(true)
                if (message) {
                  getRecibosDaMensagem(deviceId, remoteSender, message.created_at)
                    .then(setRecibos)
                    .catch((err) => {
                      console.error('Error loading message receipts:', err)
                      setErro(true)
                    })
                    .finally(() => setLoading(false))
                }
              }}
            >
              Tentar novamente
            </Button>
          </div>
        ) : recibos.length === 0 ? (
          <p className="py-4 text-center text-sm text-chat-muted">
            Nenhum membro da equipe encontrado para este aparelho.
          </p>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="flex flex-col gap-4 py-1">
              <div>
                <h4 className="text-xs font-semibold text-chat-muted mb-2 flex items-center gap-1.5 px-1">
                  <Eye className="h-3.5 w-3.5" /> Visto por
                </h4>
                {vistoPor.length === 0 ? (
                  <p className="text-xs text-chat-muted px-1">Ninguém viu esta mensagem ainda.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {vistoPor.map((r) => (
                      <div
                        key={r.user_id}
                        className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-chat-hover"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarImage src={r.avatar_url ?? undefined} alt={r.name ?? ''} />
                            <AvatarFallback className="text-xs">{getInitials(r.name)}</AvatarFallback>
                          </Avatar>
                          <span className="truncate text-sm text-chat-text">{r.name ?? '—'}</span>
                        </div>
                        <span className="text-[11px] text-chat-muted shrink-0">
                          {format(new Date(r.seen_at as string), 'dd/MM HH:mm')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-chat-muted mb-2 flex items-center gap-1.5 px-1">
                  <EyeOff className="h-3.5 w-3.5" /> Não visto
                </h4>
                {naoVisto.length === 0 ? (
                  <p className="text-xs text-chat-muted px-1">Todo mundo já viu esta mensagem.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {naoVisto.map((r) => (
                      <div key={r.user_id} className="flex items-center gap-3 rounded-md px-2 py-2 opacity-70">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={r.avatar_url ?? undefined} alt={r.name ?? ''} />
                          <AvatarFallback className="text-xs">{getInitials(r.name)}</AvatarFallback>
                        </Avatar>
                        <span className="truncate text-sm text-chat-text">{r.name ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
