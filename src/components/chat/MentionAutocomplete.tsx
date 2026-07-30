import { useEffect, useMemo, useState } from 'react'
import { AtSign, Users } from 'lucide-react'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
import { cn } from '@/lib/utils'
import { findContactByIdentifier } from '@/lib/contacts/normalize'
import { getParticipantesDoGrupo, type Participante } from '@/services/groups'

/**
 * Lista que aparece ao digitar `@` no compositor, em grupo.
 *
 * A fonte é `getParticipantesDoGrupo` — o mesmo serviço do painel de membros,
 * com cache de 10 min. Reaproveitar significa que o autocomplete não faz
 * nenhuma chamada nova quando o painel já foi aberto.
 *
 * Só participante COM TELEFONE entra: a Evolution manda o `@lid` e o telefone
 * separados, e é o telefone que o WhatsApp espera no campo de menção. Participante
 * que só apareceu no banco (grupo em que a instância saiu) vem sem telefone e não
 * pode ser mencionado — melhor não listar do que listar e a menção não funcionar.
 */
interface Props {
  deviceId: string
  instanceName: string
  groupJid: string
  contactIndex: Map<string, any>
  /** Texto digitado depois do `@`, para filtrar. */
  termo: string
  onEscolher: (telefone: string) => void
  onMencionarTodos: () => void
  onFechar: () => void
}

const MAX_ITENS = 8

export function MentionAutocomplete({
  deviceId,
  instanceName,
  groupJid,
  contactIndex,
  termo,
  onEscolher,
  onMencionarTodos,
  onFechar,
}: Props) {
  const [participantes, setParticipantes] = useState<Participante[]>([])
  const [indiceAtivo, setIndiceAtivo] = useState(0)

  useEffect(() => {
    let cancelado = false
    getParticipantesDoGrupo(deviceId, instanceName, groupJid)
      .then((info) => {
        if (!cancelado) setParticipantes(info.participantes.filter((p) => !!p.phone))
      })
      .catch(() => {
        if (!cancelado) setParticipantes([])
      })
    return () => {
      cancelado = true
    }
  }, [deviceId, instanceName, groupJid])

  const opcoes = useMemo(() => {
    const t = termo.trim().toLowerCase()
    const comNome = participantes.map((p) => {
      const contato = findContactByIdentifier(p.phone, contactIndex)
      const nome = contato?.nickname || contato?.name || p.senderName || `+${p.phone}`
      return { p, contato, nome }
    })
    const filtrados = t
      ? comNome.filter((x) => x.nome.toLowerCase().includes(t) || x.p.phone.includes(t))
      : comNome
    return filtrados.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, MAX_ITENS)
  }, [participantes, termo, contactIndex])

  // "todos" só aparece quando o termo digitado é compatível, para não ocupar a
  // primeira posição enquanto a pessoa procura alguém específico.
  const mostrarTodos = useMemo(() => {
    const t = termo.trim().toLowerCase()
    return t === '' || 'todos'.startsWith(t) || 'everyone'.startsWith(t) || 'all'.startsWith(t)
  }, [termo])

  const total = (mostrarTodos ? 1 : 0) + opcoes.length

  useEffect(() => {
    setIndiceAtivo(0)
  }, [termo])

  // Navegação por teclado. Registrado em `keydown` com captura para chegar antes
  // do textarea, que usa Enter para enviar a mensagem — sem isso, escolher pelo
  // Enter enviaria o texto com a menção pela metade.
  useEffect(() => {
    if (total === 0) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIndiceAtivo((i) => (i + 1) % total)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIndiceAtivo((i) => (i - 1 + total) % total)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        if (mostrarTodos && indiceAtivo === 0) {
          onMencionarTodos()
        } else {
          const escolhido = opcoes[indiceAtivo - (mostrarTodos ? 1 : 0)]
          if (escolhido) onEscolher(escolhido.p.phone)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onFechar()
      }
    }
    window.addEventListener('keydown', aoTeclar, true)
    return () => window.removeEventListener('keydown', aoTeclar, true)
  }, [total, indiceAtivo, opcoes, mostrarTodos, onEscolher, onMencionarTodos, onFechar])

  if (total === 0) return null

  return (
    <div className="absolute bottom-full left-0 mb-2 w-72 max-h-64 overflow-y-auto rounded-lg border border-chat-border bg-chat-panel shadow-chat z-50">
      {mostrarTodos && (
        <button
          type="button"
          onMouseEnter={() => setIndiceAtivo(0)}
          onClick={onMencionarTodos}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 text-left text-sm',
            indiceAtivo === 0 ? 'bg-chat-hover' : 'hover:bg-chat-hover',
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <Users className="h-4 w-4 text-primary" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-chat-text">Todos</span>
            <span className="block text-xs text-chat-muted">Notifica o grupo inteiro</span>
          </span>
        </button>
      )}

      {opcoes.map(({ p, contato, nome }, i) => {
        const idx = i + (mostrarTodos ? 1 : 0)
        return (
          <button
            key={p.phone}
            type="button"
            onMouseEnter={() => setIndiceAtivo(idx)}
            onClick={() => onEscolher(p.phone)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 text-left text-sm',
              indiceAtivo === idx ? 'bg-chat-hover' : 'hover:bg-chat-hover',
            )}
          >
            <SmartAvatar
              jid={p.phone}
              name={nome}
              instanceKey={instanceName}
              contactRecord={contato}
              className="h-8 w-8 shrink-0"
              fallbackClassName="text-[10px] bg-chat-hover text-chat-text"
            />
            <span className="flex-1 min-w-0">
              <span className="block truncate text-chat-text">{nome}</span>
              <span className="block truncate text-xs text-chat-muted">+{p.phone}</span>
            </span>
            <AtSign className="h-3.5 w-3.5 text-chat-muted/50 shrink-0" />
          </button>
        )
      })}
    </div>
  )
}
