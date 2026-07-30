import { useState, useMemo, useCallback } from 'react'
import { Search, Loader2 } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
import { cn } from '@/lib/utils'
import { podeCompartilhar, paraCartao, type ContatoParaCompartilhar } from '@/services/contact_share'
import type { Contact } from '@/lib/supabase/types'

/**
 * Escolher QUAIS contatos compartilhar.
 *
 * Só lista quem tem telefone válido (ver `podeCompartilhar`): grupo não é cartão
 * de contato e chave `@lid` não é telefone. Contato sem telefone simplesmente não
 * aparece — mostrar 161 linhas desabilitadas não ajuda ninguém.
 *
 * Seleção múltipla porque a Evolution aceita vários cartões numa chamada só, e o
 * balão do chat já renderiza um por anexo: 3 contatos viram UMA mensagem com três
 * balões, não três mensagens.
 */
interface Props {
  aberto: boolean
  onFechar: () => void
  contacts: Contact[]
  instanceKey?: string
  /** Nome da conversa de destino, só para o texto do botão. */
  destinoLabel?: string
  onEnviar: (contatos: ContatoParaCompartilhar[]) => Promise<void>
}

const MAX_ITENS = 80

export function ContactPickerDialog({
  aberto,
  onFechar,
  contacts,
  instanceKey,
  destinoLabel,
  onEnviar,
}: Props) {
  const [busca, setBusca] = useState('')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState(false)

  const compartilhaveis = useMemo(() => contacts.filter(podeCompartilhar), [contacts])

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const comNome = compartilhaveis.map((c) => ({
      c,
      nome: c.nickname || c.name || `+${c.remote_jid}`,
    }))
    const ordenados = comNome.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    if (!termo) return ordenados.slice(0, MAX_ITENS)
    return ordenados
      .filter((x) => x.nome.toLowerCase().includes(termo) || x.c.remote_jid.includes(termo))
      .slice(0, MAX_ITENS)
  }, [compartilhaveis, busca])

  const alternar = useCallback((jid: string) => {
    setMarcados((prev) => {
      const proximo = new Set(prev)
      if (proximo.has(jid)) proximo.delete(jid)
      else proximo.add(jid)
      return proximo
    })
  }, [])

  /**
   * Fechar SEMPRE limpa a seleção e a busca.
   *
   * Este diálogo não desmonta junto com a conversa (o ChatWindow do desktop é
   * montado sem `key`), então cancelar sem limpar deixava o contato marcado
   * pendurado. Ao reabrir em OUTRA conversa ele vinha marcado, podendo estar
   * fora da área visível da rolagem ou escondido pelo filtro — e ia junto no
   * envio, para a pessoa errada.
   */
  const fechar = useCallback(() => {
    if (enviando) return
    setMarcados(new Set())
    setBusca('')
    onFechar()
  }, [enviando, onFechar])

  const enviar = useCallback(async () => {
    if (marcados.size === 0 || enviando) return
    const escolhidos = compartilhaveis.filter((c) => marcados.has(c.remote_jid)).map(paraCartao)
    setEnviando(true)
    try {
      await onEnviar(escolhidos)
      setMarcados(new Set())
      setBusca('')
      onFechar()
    } finally {
      setEnviando(false)
    }
  }, [marcados, enviando, compartilhaveis, onEnviar, onFechar])

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-[440px] bg-chat-panel border-chat-border">
        <DialogHeader>
          <DialogTitle className="text-chat-text">
            Compartilhar contato{destinoLabel ? ` com ${destinoLabel}` : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chat-muted" />
          <Input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar contato..."
            className="pl-9 bg-chat-hover border-chat-border"
          />
        </div>

        <ScrollArea className="h-[320px] -mx-2 px-2">
          <div className="flex flex-col gap-0.5 py-1">
            {filtrados.length === 0 && (
              <p className="text-center text-sm text-chat-muted py-8">Nenhum contato encontrado.</p>
            )}
            {filtrados.map(({ c, nome }) => {
              const marcado = marcados.has(c.remote_jid)
              return (
                <button
                  key={c.remote_jid}
                  type="button"
                  disabled={enviando}
                  onClick={() => alternar(c.remote_jid)}
                  className={cn(
                    'flex items-center gap-3 rounded px-2 py-2 text-left transition-colors',
                    marcado ? 'bg-chat-hover' : 'hover:bg-chat-hover',
                    enviando && 'opacity-50',
                  )}
                >
                  <Checkbox checked={marcado} className="shrink-0" tabIndex={-1} />
                  <SmartAvatar
                    jid={c.remote_jid}
                    name={nome}
                    instanceKey={instanceKey}
                    contactRecord={c}
                    className="h-9 w-9 shrink-0"
                    fallbackClassName="text-xs bg-chat-hover text-chat-text"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-sm text-chat-text">{nome}</span>
                    <span className="block truncate text-xs text-chat-muted">+{c.remote_jid}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={marcados.size === 0 || enviando}>
            {enviando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enviar{marcados.size > 0 ? ` (${marcados.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
