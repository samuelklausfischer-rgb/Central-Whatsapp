import { useEffect, useState, useCallback, useMemo } from 'react'
import { Loader2, Pencil, MessageSquare, Search, ShieldCheck, ShieldMinus, UserX, AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
import { cn } from '@/lib/utils'
import { findContactByIdentifier } from '@/lib/contacts/normalize'
import { useToast } from '@/hooks/use-toast'
import { EvolutionApiError } from '@/services/evolution_instances'
import {
  getParticipantesDoGrupo,
  escolherConversaDoParticipante,
  promoverParticipante,
  rebaixarParticipante,
  removerParticipante,
  type Participante,
} from '@/services/groups'

/**
 * Mesma tradução de código de erro usada em `GroupActionsDialog` — duplicada
 * (e não importada de lá) porque é uma função de 6 linhas e os dois
 * componentes não têm nenhuma outra razão para se acoplar.
 */
function mensagemDeErro(err: unknown): string {
  if (err instanceof EvolutionApiError) {
    const code = (err.details as any)?.code
    if (code === 'group_unavailable') {
      return 'Este número não está mais nesse grupo — a ação não pode ser executada.'
    }
    if (code === 'not_group_admin') {
      return 'O número conectado não é administrador deste grupo.'
    }
    return err.message || 'Erro ao executar a ação.'
  }
  return err instanceof Error ? err.message : 'Erro inesperado.'
}

/**
 * Lista de membros do grupo.
 *
 * RESOLUÇÃO DE NOME — a Evolution não manda nome nenhum, só telefone. A ordem de
 * precedência espelha a de `resolveContactDisplayName`, para o participante
 * aparecer com o mesmo nome que já aparece no resto do app:
 *   apelido > nome do contato > pushName mais recente > telefone formatado.
 *
 * O pushName vem do celular da própria pessoa e às vezes é lixo ("-", ".",
 * "T-FITNESS"), por isso fica depois do que a clínica cadastrou.
 *
 * NUNCA indexa por `@lid`: `normalizeContactId` trata LID como telefone e prefixa
 * "55", e 2 dos 181 LIDs em produção resolvem para um contato REAL que não é
 * aquela pessoa. A identidade aqui é sempre o telefone vindo da Evolution.
 */
interface Props {
  deviceId: string
  instanceName: string
  groupJid: string
  contactIndex: Map<string, any>
  onEditarApelido: (jid: string, nomeAtual: string) => void
  onAbrirConversa: (jid: string) => void
  /**
   * Promover/rebaixar admin é liberado pra qualquer um com acesso ao aparelho.
   * Remover participante é destrutivo — gate de admin decidido pelo usuário,
   * o botão fica OCULTO (não desabilitado) pra quem não é admin.
   */
  isAdmin: boolean
}

function formatarTelefone(digits: string): string {
  if (!digits) return ''
  const d = digits.replace(/\D/g, '')
  const semPais = d.startsWith('55') ? d.slice(2) : d
  if (semPais.length === 11) return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 7)}-${semPais.slice(7)}`
  if (semPais.length === 10) return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 6)}-${semPais.slice(6)}`
  return `+${d}`
}

export function GroupMembersPanel({
  deviceId,
  instanceName,
  groupJid,
  contactIndex,
  onEditarApelido,
  onAbrirConversa,
  isAdmin,
}: Props) {
  const { toast } = useToast()
  const [carregando, setCarregando] = useState(true)
  const [parcial, setParcial] = useState(false)
  const [participantes, setParticipantes] = useState<Participante[]>([])
  const [busca, setBusca] = useState('')
  const [abrindo, setAbrindo] = useState<string | null>(null)
  /** `${id-do-participante}:${'promote'|'demote'|'remove'}` da ação em voo — só uma por vez, por item. */
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null)
  const [alvoRemocao, setAlvoRemocao] = useState<{ p: Participante; nome: string } | null>(null)

  const carregar = useCallback(
    (forcar = false) => {
      if (!deviceId || !groupJid) return
      let cancelado = false
      setCarregando(true)
      getParticipantesDoGrupo(deviceId, instanceName, groupJid, { forcar })
        .then((info) => {
          if (cancelado) return
          setParticipantes(info.participantes)
          setParcial(info.parcial)
          setCarregando(false)
        })
        .catch(() => {
          if (cancelado) return
          setParticipantes([])
          setParcial(true)
          setCarregando(false)
        })
      return () => {
        cancelado = true
      }
    },
    [deviceId, instanceName, groupJid],
  )

  useEffect(() => carregar(), [carregar])

  const comNome = useMemo(() => {
    return participantes.map((p) => {
      const contato = p.phone ? findContactByIdentifier(p.phone, contactIndex) : null
      const nome =
        contato?.nickname ||
        contato?.name ||
        p.senderName ||
        formatarTelefone(p.phone) ||
        'Participante'
      return { p, contato, nome }
    })
  }, [participantes, contactIndex])

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const lista = comNome.slice().sort((a, b) => {
      // Admins primeiro, depois alfabético — como no WhatsApp.
      const admA = a.p.admin ? 0 : 1
      const admB = b.p.admin ? 0 : 1
      if (admA !== admB) return admA - admB
      return a.nome.localeCompare(b.nome, 'pt-BR')
    })
    if (!termo) return lista
    return lista.filter((x) => x.nome.toLowerCase().includes(termo) || x.p.phone.includes(termo))
  }, [comNome, busca])

  const abrirConversa = useCallback(
    async (p: Participante) => {
      setAbrindo(p.id || p.phone)
      try {
        const jid = await escolherConversaDoParticipante(deviceId, p)
        if (jid) onAbrirConversa(jid)
      } finally {
        setAbrindo(null)
      }
    },
    [deviceId, onAbrirConversa],
  )

  /**
   * Promove/rebaixa/remove e, se a chamada teve sucesso, recarrega a lista.
   * `promoverParticipante`/`rebaixarParticipante`/`removerParticipante` já
   * invalidam o cache DAQUELE grupo em `services/groups.ts` — sem recarregar
   * aqui, o painel ficaria mostrando o cargo antigo até o atendente fechar e
   * reabrir o painel.
   */
  const executarAcaoParticipante = useCallback(
    async (p: Participante, acao: 'promote' | 'demote' | 'remove') => {
      const chave = `${p.id}:${acao}`
      setAcaoEmCurso(chave)
      try {
        if (acao === 'promote') await promoverParticipante(deviceId, groupJid, p.id)
        else if (acao === 'demote') await rebaixarParticipante(deviceId, groupJid, p.id)
        else await removerParticipante(deviceId, groupJid, p.id)

        toast({
          title:
            acao === 'promote'
              ? 'Participante promovido a admin'
              : acao === 'demote'
                ? 'Participante rebaixado'
                : 'Participante removido do grupo',
        })
        carregar(true)
      } catch (err) {
        toast({ title: mensagemDeErro(err), variant: 'destructive' })
      } finally {
        setAcaoEmCurso(null)
      }
    },
    [deviceId, groupJid, toast, carregar],
  )

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-chat-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando membros…</span>
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-col gap-2">
      {parcial && (
        <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-chat-muted leading-relaxed">
            Não foi possível consultar o grupo no WhatsApp. Mostrando apenas quem já enviou
            mensagem aqui — a lista pode estar incompleta.
          </p>
        </div>
      )}

      {participantes.length > 8 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chat-muted" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar participante..."
            className="pl-9 h-9 bg-chat-hover border-chat-border"
          />
        </div>
      )}

      <p className="text-xs text-chat-muted px-1">
        {participantes.length} {participantes.length === 1 ? 'participante' : 'participantes'}
      </p>

      <div className="flex flex-col gap-0.5">
        {filtrados.length === 0 && (
          <p className="text-center text-sm text-chat-muted py-6">Nenhum participante encontrado.</p>
        )}
        {filtrados.map(({ p, contato, nome }) => {
          const chaveItem = p.id || p.phone
          // Sem telefone (veio só do banco, formato @lid) não dá para abrir a
          // conversa privada nem casar com um contato — desabilita em vez de
          // deixar o clique morrer sem explicação.
          const temTelefone = !!p.phone
          return (
            <div
              key={chaveItem}
              className="flex items-center gap-3 rounded px-2 py-2 hover:bg-chat-hover group"
            >
              <SmartAvatar
                jid={p.phone || p.id}
                name={nome}
                instanceKey={instanceName}
                contactRecord={contato}
                className="h-9 w-9 shrink-0"
                fallbackClassName="text-xs bg-chat-hover text-chat-text"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm text-chat-text">{nome}</span>
                  {p.admin && (
                    <span
                      title={p.admin === 'superadmin' ? 'Criador do grupo' : 'Administrador'}
                      className="flex items-center gap-0.5 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {p.admin === 'superadmin' ? 'Criador' : 'Admin'}
                    </span>
                  )}
                </div>
                {temTelefone && (
                  <span className="block truncate text-xs text-chat-muted">
                    {formatarTelefone(p.phone)}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-chat-muted hover:text-chat-text"
                  title={temTelefone ? 'Editar apelido' : 'Sem telefone: não é possível salvar apelido'}
                  disabled={!temTelefone}
                  onClick={() => onEditarApelido(p.phone, contato?.nickname || contato?.name || '')}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-chat-muted hover:text-chat-text"
                  title={temTelefone ? 'Abrir conversa' : 'Sem telefone: não é possível abrir conversa'}
                  disabled={!temTelefone || abrindo === chaveItem}
                  onClick={() => abrirConversa(p)}
                >
                  {abrindo === chaveItem ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5" />
                  )}
                </Button>

                {/* Promover/rebaixar: liberado a qualquer um com acesso ao
                    aparelho. O criador do grupo (superadmin) não aparece aqui —
                    o próprio WhatsApp não permite rebaixar nem remover quem
                    criou o grupo. */}
                {p.admin !== 'superadmin' && p.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-chat-muted hover:text-chat-text"
                    title={
                      parcial
                        ? 'Grupo indisponível no momento: não é possível alterar cargos'
                        : p.admin === 'admin'
                          ? 'Rebaixar admin'
                          : 'Promover a admin'
                    }
                    disabled={parcial || acaoEmCurso === `${p.id}:${p.admin === 'admin' ? 'demote' : 'promote'}`}
                    onClick={() => executarAcaoParticipante(p, p.admin === 'admin' ? 'demote' : 'promote')}
                  >
                    {acaoEmCurso === `${p.id}:${p.admin === 'admin' ? 'demote' : 'promote'}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : p.admin === 'admin' ? (
                      <ShieldMinus className="h-3.5 w-3.5" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}

                {/* Remover do grupo: destrutivo/irreversível — só admin, e só
                    com confirmação explícita (AlertDialog abaixo). Fica OCULTO
                    pra quem não é admin, nunca só desabilitado. */}
                {isAdmin && p.admin !== 'superadmin' && p.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-chat-muted hover:text-red-400"
                    title={parcial ? 'Grupo indisponível no momento: não é possível remover' : 'Remover do grupo'}
                    disabled={parcial || acaoEmCurso === `${p.id}:remove`}
                    onClick={() => setAlvoRemocao({ p, nome })}
                  >
                    {acaoEmCurso === `${p.id}:remove` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UserX className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <Button variant="ghost" size="sm" className="text-xs text-chat-muted" onClick={() => carregar(true)}>
        Atualizar lista
      </Button>
    </div>

    <AlertDialog open={!!alvoRemocao} onOpenChange={(v) => { if (!v) setAlvoRemocao(null) }}>
      <AlertDialogContent className="bg-chat-panel border-chat-border">
        <AlertDialogHeader>
          <AlertDialogTitle>Remover {alvoRemocao?.nome} do grupo?</AlertDialogTitle>
          <AlertDialogDescription className="text-chat-muted">
            Esta ação é irreversível: a pessoa sai do grupo agora e só volta se alguém do grupo
            adicionar de novo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="bg-transparent border-chat-border hover:bg-chat-hover text-chat-text">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-500 text-white"
            onClick={(e) => {
              e.preventDefault() // fechamento manual: depende do await abaixo
              if (!alvoRemocao) return
              const { p } = alvoRemocao
              setAlvoRemocao(null)
              executarAcaoParticipante(p, 'remove')
            }}
          >
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
