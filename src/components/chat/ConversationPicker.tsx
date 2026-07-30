import { useState, useMemo } from 'react'
import { Search, Loader2, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
import { cn } from '@/lib/utils'
import { findContactByIdentifier, resolveContactDisplayName } from '@/lib/contacts/normalize'

/**
 * Lista de conversas com busca, para escolher destino.
 *
 * Existe para ser usada por MAIS DE UM diálogo (encaminhar mensagem e
 * compartilhar contato). Sem isso a mesma lista seria escrita duas vezes — a
 * duplicação que já causou estrago no menu de contexto da mensagem, onde um item
 * novo adicionado em só um dos blocos não existia para metade dos casos.
 *
 * Dois modos:
 * - `multi = false`: clicar num destino dispara a ação na hora e marca com ✓
 *   (comportamento de encaminhar, preservado exatamente como estava)
 * - `multi = true`: caixinhas de seleção; quem confirma é o diálogo de fora
 */
export interface ConversaSelecionavel {
  remote_sender: string
  sender_name?: string | null
}

interface Props {
  conversas: ConversaSelecionavel[]
  contactIndex: Map<string, any>
  instanceKey?: string
  multi?: boolean
  /** Modo único: chamado ao clicar. */
  onEscolher?: (remoteSender: string) => void
  /** Modo múltiplo: seleção controlada pelo diálogo de fora. */
  selecionados?: Set<string>
  onAlternar?: (remoteSender: string) => void
  /** Destinos já concluídos, marcados com ✓. */
  concluidos?: Set<string>
  /** Destino em envio no momento, com spinner. */
  emAndamento?: string | null
  /** Trava a lista enquanto um envio está em voo. */
  travado?: boolean
  altura?: string
}

// Teto de itens renderizados: a lista pode ter centenas de conversas e a busca
// existe justamente para chegar no destino sem rolar tudo.
const MAX_ITENS = 80

export function ConversationPicker({
  conversas,
  contactIndex,
  instanceKey,
  multi = false,
  onEscolher,
  selecionados,
  onAlternar,
  concluidos,
  emAndamento,
  travado = false,
  altura = 'h-[320px]',
}: Props) {
  const [busca, setBusca] = useState('')

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const lista = conversas.filter((c) => c.remote_sender && c.remote_sender !== 'Unknown Sender')
    if (!termo) return lista.slice(0, MAX_ITENS)
    return lista
      .filter((c) => {
        const nome = resolveContactDisplayName(c.remote_sender, contactIndex, { sender_name: c.sender_name })
        return nome.toLowerCase().includes(termo) || c.remote_sender.toLowerCase().includes(termo)
      })
      .slice(0, MAX_ITENS)
  }, [conversas, busca, contactIndex])

  return (
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

      <ScrollArea className={cn(altura, '-mx-2 px-2')}>
        <div className="flex flex-col gap-0.5 py-1">
          {filtradas.length === 0 && (
            <p className="text-center text-sm text-chat-muted py-8">Nenhuma conversa encontrada.</p>
          )}
          {filtradas.map((c) => {
            const contato = findContactByIdentifier(c.remote_sender, contactIndex)
            const nome = resolveContactDisplayName(c.remote_sender, contactIndex, {
              sender_name: c.sender_name,
            })
            const concluido = concluidos?.has(c.remote_sender) ?? false
            const enviando = emAndamento === c.remote_sender
            const marcado = selecionados?.has(c.remote_sender) ?? false

            const conteudo = (
              <>
                {multi && <Checkbox checked={marcado} className="shrink-0" tabIndex={-1} />}
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
                {concluido && <Check className="h-4 w-4 text-green-500" />}
              </>
            )

            return (
              <button
                key={c.remote_sender}
                type="button"
                disabled={travado || (!multi && concluido)}
                onClick={() => (multi ? onAlternar?.(c.remote_sender) : onEscolher?.(c.remote_sender))}
                className={cn(
                  'flex items-center gap-3 rounded px-2 py-2 text-left transition-colors',
                  concluido ? 'opacity-60' : 'hover:bg-chat-hover',
                  travado && !enviando && 'opacity-50',
                )}
              >
                {conteudo}
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </>
  )
}
