import { useState, useMemo, useCallback } from 'react'
import { Search, Loader2, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
import { cn } from '@/lib/utils'
import { findContactByIdentifier, resolveContactDisplayName } from '@/lib/contacts/normalize'
import { podeEncaminhar, legendaParaEncaminhar } from '@/lib/forward'

/**
 * Escolha do destino para encaminhar uma mensagem.
 *
 * DESTINO RESTRITO AO MESMO APARELHO, de propósito. Encaminhar para conversa de
 * outro aparelho enviaria pelo número errado, e a paciente receberia a mensagem
 * de um número desconhecido da clínica. A lista já vem escopada por aparelho do
 * ChatHub, que valida o acesso.
 */
interface Props {
  aberto: boolean
  onFechar: () => void
  /** Mensagem sendo encaminhada. */
  msg: any
  /** Conversas do aparelho atual: { remote_sender, sender_name }. */
  conversas: any[]
  contacts: any[]
  contactIndex: Map<string, any>
  instanceKey?: string
  /** Envia para um destino. Deve resolver com a linha real criada. */
  onEncaminhar: (remoteSender: string, texto: string, anexo?: { url: string; type: string; name: string }) => Promise<void>
}

export function ForwardDialog({
  aberto,
  onFechar,
  msg,
  conversas,
  contactIndex,
  instanceKey,
  onEncaminhar,
}: Props) {
  const [busca, setBusca] = useState('')
  const [enviandoPara, setEnviandoPara] = useState<string | null>(null)
  const [enviados, setEnviados] = useState<Set<string>>(new Set())

  const verificacao = useMemo(() => podeEncaminhar(msg), [msg])

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const lista = conversas.filter((c) => c.remote_sender && c.remote_sender !== 'Unknown Sender')
    if (!termo) return lista.slice(0, 80)
    return lista
      .filter((c) => {
        const nome = resolveContactDisplayName(c.remote_sender, contactIndex, { sender_name: c.sender_name })
        return nome.toLowerCase().includes(termo) || c.remote_sender.toLowerCase().includes(termo)
      })
      .slice(0, 80)
  }, [conversas, busca, contactIndex])

  const encaminhar = useCallback(
    async (remoteSender: string) => {
      if (enviandoPara || !verificacao.pode) return
      // Envio ESTRITAMENTE SEQUENCIAL (um de cada vez): a função de envio no
      // banco faz chamada HTTP bloqueante segurando a conexão, e disparar vários
      // em paralelo poderia prender várias das 100 conexões se a Evolution travar.
      setEnviandoPara(remoteSender)
      try {
        await onEncaminhar(remoteSender, legendaParaEncaminhar(msg), verificacao.anexo)
        setEnviados((prev) => new Set(prev).add(remoteSender))
      } finally {
        setEnviandoPara(null)
      }
    },
    [enviandoPara, verificacao, msg, onEncaminhar],
  )

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-[440px] bg-chat-panel border-chat-border">
        <DialogHeader>
          <DialogTitle className="text-chat-text">Encaminhar mensagem</DialogTitle>
        </DialogHeader>

        {!verificacao.pode ? (
          <div className="py-6 text-center">
            <p className="text-sm text-chat-muted">{verificacao.motivo}</p>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chat-muted" />
              <Input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Procurar conversa..."
                className="pl-9 bg-chat-hover border-chat-border"
              />
            </div>

            <ScrollArea className="h-[320px] -mx-2 px-2">
              <div className="flex flex-col gap-0.5 py-1">
                {filtradas.length === 0 && (
                  <p className="text-center text-sm text-chat-muted py-8">Nenhuma conversa encontrada.</p>
                )}
                {filtradas.map((c) => {
                  const contato = findContactByIdentifier(c.remote_sender, contactIndex)
                  const nome = resolveContactDisplayName(c.remote_sender, contactIndex, {
                    sender_name: c.sender_name,
                  })
                  const jaEnviado = enviados.has(c.remote_sender)
                  const enviando = enviandoPara === c.remote_sender
                  return (
                    <button
                      key={c.remote_sender}
                      type="button"
                      disabled={!!enviandoPara || jaEnviado}
                      onClick={() => encaminhar(c.remote_sender)}
                      className={cn(
                        'flex items-center gap-3 rounded px-2 py-2 text-left transition-colors',
                        jaEnviado ? 'opacity-60' : 'hover:bg-chat-hover',
                        enviandoPara && !enviando && 'opacity-50',
                      )}
                    >
                      <SmartAvatar
                        jid={c.remote_sender}
                        name={nome}
                        instanceKey={instanceKey}
                        contactRecord={contato}
                        className="h-9 w-9 shrink-0"
                        fallbackClassName="text-xs bg-chat-hover text-chat-text"
                      />
                      <span className="flex-1 min-w-0 truncate text-sm text-chat-text">{nome}</span>
                      {enviando && <Loader2 className="h-4 w-4 animate-spin text-chat-muted" />}
                      {jaEnviado && <Check className="h-4 w-4 text-green-500" />}
                    </button>
                  )
                })}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={!!enviandoPara}>
            {enviados.size > 0 ? 'Concluir' : 'Cancelar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
