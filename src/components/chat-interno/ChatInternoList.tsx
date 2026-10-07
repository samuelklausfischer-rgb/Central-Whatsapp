import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  BellOff,
  Ban,
  Image as IconeImagem,
  MessageSquarePlus,
  MessagesSquare,
  Mic,
  Paperclip,
  RefreshCw,
  Search,
  Users,
  UsersRound,
  X,
} from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
import { AvatarInterno } from '@/components/chat-interno/AvatarInterno'
import { DialogoNovaConversa, DialogoNovoGrupo } from '@/components/chat-interno/DialogosDeCriacao'
import { useAuth } from '@/hooks/use-auth'
import { horaDaLista, normalizarParaBusca, VALOR_CHAT_INTERNO } from '@/lib/chat-interno'
import type { ConversaResumo } from '@/lib/supabase/chat-interno-types'
import { cn } from '@/lib/utils'
import { carregarDiretorio, carregarResumo, totalDeNaoLidas, useChatInternoStore } from '@/stores/chatInterno'

/** Selo vermelho/azul de contagem — o mesmo desenho do `ChatRow` do WhatsApp. */
export function SeloDeNaoLidas({ total, mudo = false, className }: { total: number; mudo?: boolean; className?: string }) {
  if (total <= 0) return null
  return (
    <span
      className={cn(
        'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
        mudo ? 'bg-chat-muted/40 text-chat-text' : 'bg-primary text-primary-foreground',
        className,
      )}
      aria-label={`${total} não lida${total > 1 ? 's' : ''}`}
    >
      {total > 99 ? '99+' : total}
    </span>
  )
}

function primeiroNome(nome: string | null | undefined) {
  return (nome ?? '').trim().split(/\s+/)[0] ?? ''
}

function PreviaDaConversa({ conversa, meuId, nomeDoAutor }: { conversa: ConversaResumo; meuId?: string; nomeDoAutor?: string | null }) {
  if (!conversa.ultima_mensagem_em && !conversa.ultima_mensagem_preview) {
    return <span className="italic">Nenhuma mensagem ainda</span>
  }
  const tipo = conversa.ultima_mensagem_tipo
  const apagada = conversa.ultima_mensagem_preview === 'Mensagem apagada'
  let prefixo = ''
  if (tipo !== 'sistema' && !apagada) {
    if (conversa.ultima_mensagem_autor_id && conversa.ultima_mensagem_autor_id === meuId) prefixo = 'Você: '
    else if (conversa.tipo === 'grupo' && (conversa.ultima_mensagem_autor_nome ?? nomeDoAutor)) {
      prefixo = `${primeiroNome(conversa.ultima_mensagem_autor_nome ?? nomeDoAutor)}: `
    }
  }
  const Icone = apagada ? Ban : tipo === 'imagem' ? IconeImagem : tipo === 'audio' ? Mic : tipo === 'arquivo' ? Paperclip : null
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1', apagada && 'italic')}>
      {Icone && <Icone className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">
        {prefixo}
        {conversa.ultima_mensagem_preview ?? ''}
      </span>
    </span>
  )
}

const LinhaDaConversa = memo(function LinhaDaConversa({
  conversa,
  selecionada,
  meuId,
  nomeDoAutor,
  avatarUrl,
  onSelecionar,
}: {
  conversa: ConversaResumo
  selecionada: boolean
  meuId?: string
  nomeDoAutor?: string | null
  avatarUrl?: string | null
  onSelecionar: (id: string) => void
}) {
  const naoLida = conversa.nao_lidas > 0
  const ehGrupo = conversa.tipo === 'grupo'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelecionar(conversa.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelecionar(conversa.id)
        }
      }}
      aria-current={selecionada ? 'true' : undefined}
      className={cn(
        'group relative grid w-full cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-colors duration-150 hover:bg-chat-hover',
        selecionada && 'bg-chat-active',
      )}
    >
      <AvatarInterno nome={conversa.nome} url={avatarUrl} grupo={ehGrupo} className="h-11 w-11" />
      <div className="min-w-0 overflow-hidden">
        <h3 className="flex items-center gap-1.5 truncate font-medium text-chat-text">
          {ehGrupo && <Users className="h-3.5 w-3.5 shrink-0 text-chat-muted" aria-label="Grupo" />}
          <span className="truncate">{conversa.nome}</span>
          {conversa.outro_desativado && (
            <span className="shrink-0 rounded-full bg-chat-muted/15 px-1.5 py-0.5 text-[10px] font-medium text-chat-muted">Desativado</span>
          )}
        </h3>
        <p className={cn('mt-0.5 flex items-center gap-1 text-sm', naoLida ? 'font-medium text-chat-text' : 'text-chat-muted')}>
          <PreviaDaConversa conversa={conversa} meuId={meuId} nomeDoAutor={nomeDoAutor} />
        </p>
      </div>
      <div className="flex w-[56px] min-w-0 flex-col items-end gap-0.5 overflow-hidden">
        <span className={cn('whitespace-nowrap pt-0.5 text-[11px] leading-none tabular-nums', naoLida && !conversa.silenciada ? 'text-primary' : 'text-chat-muted')}>
          {horaDaLista(conversa.ultima_mensagem_em ?? conversa.criado_em)}
        </span>
        <div className="flex h-7 items-center justify-end gap-1">
          {conversa.silenciada && <BellOff className="h-3.5 w-3.5 shrink-0 text-chat-muted" aria-label="Som desligado" />}
          <SeloDeNaoLidas total={conversa.nao_lidas} mudo={conversa.silenciada} />
        </div>
      </div>
    </div>
  )
})

/**
 * Seletor de origem no topo da lista interna: "Chat interno" selecionado, mais os
 * aparelhos do WhatsApp para voltar. É o espelho do seletor do `ChatList`, com o
 * mesmo visual — escolher um aparelho devolve a tela ao modo WhatsApp.
 */
function SeletorDeOrigem({ devices, onSelectDevice }: { devices: any[]; onSelectDevice: (id: string) => void }) {
  return (
    <Select
      value={VALOR_CHAT_INTERNO}
      onValueChange={(v) => {
        if (v !== VALOR_CHAT_INTERNO) onSelectDevice(v)
      }}
    >
      <SelectTrigger className="h-12 w-full border-chat-border bg-chat-sidebar" aria-label="Trocar entre Chat interno e aparelhos do WhatsApp">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={VALOR_CHAT_INTERNO} className="py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
              <MessagesSquare className="h-4 w-4" />
            </span>
            <div className="flex flex-col text-left">
              <span className="text-sm font-medium leading-none text-chat-text">Chat interno</span>
              <span className="mt-1.5 text-xs text-chat-muted">Conversas com a equipe</span>
            </div>
          </div>
        </SelectItem>
        {devices.map((device) => (
          <SelectItem key={device.id} value={device.id} className="py-3">
            <div className="flex items-center gap-3">
              <SmartAvatar isInstance deviceRecord={device} name={device.name} className="h-8 w-8 bg-chat-panel" />
              <div className="flex flex-col text-left">
                <span className="text-sm font-medium leading-none text-chat-text">{device.name}</span>
                {device.department && <span className="mt-1.5 text-xs text-chat-muted">{device.department}</span>}
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Lista de conversas do Chat interno (coluna da esquerda).
 *
 * Mesma casca do `ChatList` (cabeçalho, seletor de origem, busca, lista) para a
 * tela parecer uma só. Os dados vêm da store — quem a alimenta é o hook montado
 * no `Layout`, então esta tela nunca assina Realtime por conta própria.
 */
export function ChatInternoList({
  devices,
  onSelectDevice,
  conversaId,
  onSelecionar,
  isMobile,
}: {
  devices: any[]
  onSelectDevice: (deviceId: string) => void
  conversaId: string | null
  onSelecionar: (conversaId: string) => void
  isMobile: boolean
}) {
  const { user } = useAuth()
  const resumo = useChatInternoStore((e) => e.resumo)
  const estado = useChatInternoStore((e) => e.resumoEstado)
  const erro = useChatInternoStore((e) => e.resumoErro)
  const pessoas = useChatInternoStore((e) => e.pessoas)
  const total = useChatInternoStore(totalDeNaoLidas)

  const [busca, setBusca] = useState('')
  const buscaAdiada = useDeferredValue(busca)
  const [novaConversaAberta, setNovaConversaAberta] = useState(false)
  const [novoGrupoAberto, setNovoGrupoAberto] = useState(false)
  const [atualizando, setAtualizando] = useState(false)

  // As fotos dos colegas só vêm do diretório (o resumo não traz avatar). Carrega uma
  // vez ao entrar no modo interno — `forcar` falso: reabrir a lista não repete a chamada.
  useEffect(() => {
    void carregarDiretorio()
  }, [])

  const visiveis = useMemo(() => {
    const termo = normalizarParaBusca(buscaAdiada.trim())
    if (!termo) return resumo
    return resumo.filter((c) => normalizarParaBusca(c.nome).includes(termo))
  }, [resumo, buscaAdiada])

  const atualizar = async () => {
    setAtualizando(true)
    try {
      await carregarResumo({ forcar: true })
    } finally {
      setAtualizando(false)
    }
  }

  const carregando = estado === 'inicial' || estado === 'carregando'

  return (
    <div className={cn('flex h-full flex-col bg-chat-sidebar', isMobile ? 'w-full border-r border-chat-border' : 'w-full')}>
      <div className="flex shrink-0 flex-col gap-3 border-b border-chat-border px-3.5 py-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-chat-text">
            Chat interno
            <SeloDeNaoLidas total={total} />
          </h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setNovaConversaAberta(true)}
              className="text-chat-muted transition-colors hover:text-chat-text"
              title="Nova conversa"
              aria-label="Nova conversa"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setNovoGrupoAberto(true)}
              className="text-chat-muted transition-colors hover:text-chat-text"
              title="Novo grupo"
              aria-label="Novo grupo"
            >
              <UsersRound className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void atualizar()}
              disabled={atualizando}
              className="text-chat-muted transition-colors hover:text-chat-text disabled:cursor-not-allowed disabled:opacity-40"
              title="Atualizar conversas"
              aria-label="Atualizar conversas"
            >
              <RefreshCw className={cn('h-4 w-4', atualizando && 'animate-spin')} />
            </button>
          </div>
        </div>

        <SeletorDeOrigem devices={devices} onSelectDevice={onSelectDevice} />

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chat-muted" />
          <Input
            placeholder="Procurar conversas..."
            aria-label="Procurar conversas"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-10 border-chat-border bg-chat-panel pl-9 pr-9 text-chat-text placeholder:text-chat-muted"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-chat-muted transition-colors hover:text-chat-text"
              title="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className={cn('flex flex-col gap-0.5 py-1 pl-2 pr-3', busca !== buscaAdiada && 'opacity-60 transition-opacity')}>
          {visiveis.map((c) => (
            <LinhaDaConversa
              key={c.id}
              conversa={c}
              selecionada={c.id === conversaId}
              meuId={user?.id}
              nomeDoAutor={c.ultima_mensagem_autor_id ? pessoas[c.ultima_mensagem_autor_id]?.nome : undefined}
              avatarUrl={c.tipo === 'direta' && c.outro_user_id ? pessoas[c.outro_user_id]?.avatar_url : null}
              onSelecionar={onSelecionar}
            />
          ))}

          {carregando && resumo.length === 0 && (
            <div className="flex flex-col gap-0.5" aria-busy="true" aria-label="Carregando conversas">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-chat-muted/10" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="h-3 animate-pulse rounded bg-chat-muted/10" style={{ width: `${55 + ((i * 7) % 30)}%` }} />
                    <div className="h-2.5 animate-pulse rounded bg-chat-muted/10" style={{ width: `${35 + ((i * 11) % 40)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {estado === 'erro' && resumo.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <MessagesSquare className="h-8 w-8 text-destructive/40" />
              <p className="text-sm leading-relaxed text-chat-muted">{erro ?? 'Não foi possível carregar as conversas.'}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void atualizar()} disabled={atualizando}>
                Tentar novamente
              </Button>
            </div>
          )}

          {estado === 'pronto' && resumo.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <MessagesSquare className="mb-3 h-8 w-8 text-chat-muted/30" />
              <p className="text-sm leading-relaxed text-chat-muted">Nenhuma conversa ainda — comece uma.</p>
              <p className="mt-1 text-xs text-chat-muted/60">Converse com um colega ou crie um grupo da equipe.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button type="button" size="sm" onClick={() => setNovaConversaAberta(true)}>
                  <MessageSquarePlus className="mr-1.5 h-4 w-4" />
                  Nova conversa
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setNovoGrupoAberto(true)} className="border-chat-border bg-transparent hover:bg-chat-hover">
                  <UsersRound className="mr-1.5 h-4 w-4" />
                  Novo grupo
                </Button>
              </div>
            </div>
          )}

          {resumo.length > 0 && visiveis.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <Search className="mb-3 h-8 w-8 text-chat-muted/30" />
              <p className="text-sm leading-relaxed text-chat-muted">Não encontramos conversas com esse termo.</p>
            </div>
          )}
        </div>
      </ScrollArea>

      <DialogoNovaConversa aberto={novaConversaAberta} onFechar={() => setNovaConversaAberta(false)} onAbrirConversa={onSelecionar} />
      <DialogoNovoGrupo aberto={novoGrupoAberto} onFechar={() => setNovoGrupoAberto(false)} onAbrirConversa={onSelecionar} />
    </div>
  )
}

export default ChatInternoList
