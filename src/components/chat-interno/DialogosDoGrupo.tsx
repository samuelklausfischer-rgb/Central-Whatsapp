import { useEffect, useMemo, useState } from 'react'
import { Crown, Loader2, LogOut, MoreVertical, UserMinus, UserPlus } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AvatarInterno } from '@/components/chat-interno/AvatarInterno'
import { SeletorDePessoas } from '@/components/chat-interno/SeletorDePessoas'
import { useToast } from '@/hooks/use-toast'
import type { ConversaResumo, MembroDaConversa } from '@/lib/supabase/chat-interno-types'
import {
  adicionarMembros,
  definirPapel,
  mensagemDoErro,
  removerMembro,
  renomearGrupo,
} from '@/services/chat_interno'
import {
  carregarDiretorio,
  carregarMembros,
  carregarResumo,
  definirNomeLocal,
  invalidarMembros,
  removerConversaDaLista,
  useChatInternoStore,
} from '@/stores/chatInterno'
import { cn } from '@/lib/utils'

/** Membros da conversa, do cache da store; relê quando o cache falta ou ficou obsoleto. */
function useMembros(conversaId: string, ativo: boolean) {
  const entrada = useChatInternoStore((e) => e.membros[conversaId])
  useEffect(() => {
    // Erro NÃO relê sozinho (o botão "Tentar de novo" faz): reler a cada publicação viraria laço.
    if (ativo && (!entrada || entrada.obsoleto)) void carregarMembros(conversaId).catch(() => {})
  }, [ativo, conversaId, entrada])
  return entrada
}

const SEM_MEMBROS: MembroDaConversa[] = []

type AcaoPendente = { tipo: 'remover'; membro: MembroDaConversa } | null

/**
 * Participantes do grupo: quem está, quem administra, e — para administradores —
 * adicionar, remover e promover. Qualquer um pode sair.
 *
 * Toda mudança gera uma mensagem de sistema no banco ("X adicionou Y"), que chega
 * pelo Realtime e invalida o cache de membros sozinha; mesmo assim relemos aqui
 * logo depois da ação, para a lista não esperar o canal.
 */
export function DialogoParticipantes({
  aberto,
  onFechar,
  conversa,
  meuId,
  aoSair,
}: {
  aberto: boolean
  onFechar: () => void
  conversa: ConversaResumo
  meuId: string
  /** Saí do grupo: a janela fecha a conversa. */
  aoSair: () => void
}) {
  const { toast } = useToast()
  const entrada = useMembros(conversa.id, aberto)
  const diretorio = useChatInternoStore((e) => e.diretorio)
  const estadoDoDiretorio = useChatInternoStore((e) => e.diretorioEstado)
  const [adicionando, setAdicionando] = useState(false)
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [acao, setAcao] = useState<AcaoPendente>(null)
  const [saindo, setSaindo] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const souAdmin = conversa.meu_papel === 'admin'
  const membros = entrada?.lista ?? SEM_MEMBROS
  const idsAtuais = useMemo(() => new Set(membros.map((m) => m.user_id)), [membros])

  useEffect(() => {
    if (!aberto) {
      setAdicionando(false)
      setEscolhidos(new Set())
      setAcao(null)
      setSaindo(false)
    }
  }, [aberto])

  useEffect(() => {
    if (aberto && adicionando) void carregarDiretorio(true)
  }, [aberto, adicionando])

  const candidatos = useMemo(() => (diretorio ?? []).filter((p) => !idsAtuais.has(p.id)), [diretorio, idsAtuais])

  const atualizar = async () => {
    invalidarMembros(conversa.id)
    await Promise.all([carregarMembros(conversa.id).catch(() => []), carregarResumo({ forcar: true })])
  }

  const alternar = (id: string) =>
    setEscolhidos((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })

  const adicionar = async () => {
    if (escolhidos.size === 0) return
    setSalvando(true)
    try {
      const entraram = await adicionarMembros(conversa.id, [...escolhidos])
      toast({ title: entraram === 1 ? '1 pessoa adicionada' : `${entraram} pessoas adicionadas` })
      setAdicionando(false)
      setEscolhidos(new Set())
      await atualizar()
    } catch (e) {
      toast({ title: mensagemDoErro(e, 'Não foi possível adicionar'), variant: 'destructive' })
    } finally {
      setSalvando(false)
    }
  }

  const mudarPapel = async (m: MembroDaConversa) => {
    setOcupado(m.user_id)
    try {
      await definirPapel(conversa.id, m.user_id, m.papel === 'admin' ? 'membro' : 'admin')
      await atualizar()
    } catch (e) {
      toast({ title: mensagemDoErro(e, 'Não foi possível mudar o papel'), variant: 'destructive' })
    } finally {
      setOcupado(null)
    }
  }

  const confirmarRemocao = async () => {
    if (!acao) return
    setSalvando(true)
    try {
      await removerMembro(conversa.id, acao.membro.user_id)
      toast({ title: `${acao.membro.nome} foi removido(a) do grupo` })
      setAcao(null)
      await atualizar()
    } catch (e) {
      toast({ title: mensagemDoErro(e, 'Não foi possível remover'), variant: 'destructive' })
      setAcao(null)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <Dialog open={aberto} onOpenChange={(v) => !v && !salvando && onFechar()}>
        <DialogContent className="gap-4 border-chat-border bg-chat-panel sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{conversa.nome}</DialogTitle>
            <DialogDescription>
              {conversa.membros_count} participante{conversa.membros_count === 1 ? '' : 's'}
            </DialogDescription>
          </DialogHeader>

          {adicionando ? (
            <div className="grid gap-2">
              <Label>Quem entra no grupo</Label>
              <SeletorDePessoas
                pessoas={candidatos}
                carregando={estadoDoDiretorio === 'carregando' || estadoDoDiretorio === 'inicial'}
                erro={estadoDoDiretorio === 'erro'}
                onTentarDeNovo={() => void carregarDiretorio(true)}
                modo="multiplo"
                selecionados={escolhidos}
                onAlternar={alternar}
                textoVazio="Todos já estão no grupo."
                alturaMaxima="max-h-[260px]"
              />
              <DialogFooter className="mt-1 gap-2 sm:gap-0">
                <Button type="button" variant="outline" disabled={salvando} onClick={() => setAdicionando(false)} className="border-chat-border bg-transparent hover:bg-chat-hover">
                  Voltar
                </Button>
                <Button type="button" disabled={salvando || escolhidos.size === 0} onClick={() => void adicionar()}>
                  {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Adicionar{escolhidos.size > 0 ? ` (${escolhidos.size})` : ''}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="max-h-[340px] overflow-y-auto rounded-lg border border-chat-border bg-chat-sidebar custom-scrollbar">
                {!entrada || (entrada.estado === 'carregando' && membros.length === 0) ? (
                  <div className="flex flex-col gap-0.5 p-1" aria-busy="true" aria-label="Carregando participantes">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
                        <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-chat-muted/10" />
                        <div className="h-3 flex-1 animate-pulse rounded bg-chat-muted/10" style={{ maxWidth: `${45 + ((i * 17) % 30)}%` }} />
                      </div>
                    ))}
                  </div>
                ) : entrada.estado === 'erro' && membros.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                    <p className="text-sm text-chat-muted">Não foi possível carregar os participantes.</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void carregarMembros(conversa.id).catch(() => {})}>
                      Tentar de novo
                    </Button>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-0.5 p-1">
                    {membros.map((m) => {
                      const sou = m.user_id === meuId
                      return (
                        <li key={m.user_id} className={cn('flex items-center gap-3 rounded-md px-2.5 py-2', ocupado === m.user_id && 'opacity-60')}>
                          <AvatarInterno nome={m.nome} url={m.avatar_url} className="h-9 w-9" fallbackClassName="text-xs" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 truncate text-sm font-medium text-chat-text">
                              <span className="truncate">{m.nome}</span>
                              {sou && <span className="shrink-0 text-xs font-normal text-chat-muted">(você)</span>}
                            </span>
                            <span className="block truncate text-xs text-chat-muted">
                              {m.desativado ? 'Usuário desativado' : (m.setor ?? '')}
                            </span>
                          </span>
                          {m.papel === 'admin' && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                              <Crown className="h-3 w-3" /> Admin
                            </span>
                          )}
                          {souAdmin && !sou && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={`Opções de ${m.nome}`}
                                  className="shrink-0 rounded-full p-1.5 text-chat-muted transition-colors hover:bg-chat-hover hover:text-chat-text"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="border-chat-border bg-chat-panel text-chat-text">
                                <DropdownMenuItem className="cursor-pointer" onSelect={() => void mudarPapel(m)}>
                                  <Crown className="mr-2 h-4 w-4" />
                                  {m.papel === 'admin' ? 'Remover administração' : 'Tornar administrador'}
                                </DropdownMenuItem>
                                <DropdownMenuItem className="cursor-pointer text-red-500 focus:text-red-500" onSelect={() => setAcao({ tipo: 'remover', membro: m })}>
                                  <UserMinus className="mr-2 h-4 w-4" /> Remover do grupo
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSaindo(true)}
                  className="border-red-500/40 bg-transparent text-red-500 hover:bg-red-500/10 hover:text-red-500"
                >
                  <LogOut className="mr-2 h-4 w-4" /> Sair do grupo
                </Button>
                {souAdmin && (
                  <Button type="button" onClick={() => setAdicionando(true)}>
                    <UserPlus className="mr-2 h-4 w-4" /> Adicionar pessoas
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!acao} onOpenChange={(v) => !v && !salvando && setAcao(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover do grupo?</AlertDialogTitle>
            <AlertDialogDescription>
              {acao ? `${acao.membro.nome} deixa de receber as mensagens de "${conversa.nome}".` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={salvando}
              onClick={(e) => {
                // O AlertDialogAction fecha sozinho; quem decide é o resultado da chamada.
                e.preventDefault()
                void confirmarRemocao()
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {salvando ? 'Aguarde...' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmarSaidaDoGrupo
        aberto={saindo}
        onFechar={() => setSaindo(false)}
        conversa={conversa}
        meuId={meuId}
        aoSair={() => {
          onFechar()
          aoSair()
        }}
      />
    </>
  )
}

/** "Sair do grupo?" — usado pelo menu da conversa e pela lista de participantes. */
export function ConfirmarSaidaDoGrupo({
  aberto,
  onFechar,
  conversa,
  meuId,
  aoSair,
}: {
  aberto: boolean
  onFechar: () => void
  conversa: ConversaResumo
  meuId: string
  /** Já saí: quem chama fecha a janela da conversa. */
  aoSair: () => void
}) {
  const { toast } = useToast()
  const [saindo, setSaindo] = useState(false)

  const sair = async () => {
    setSaindo(true)
    try {
      await removerMembro(conversa.id, meuId)
      toast({ title: 'Você saiu do grupo' })
      onFechar()
      // Primeiro fecha a janela: se a conversa sumisse da lista com ela ainda
      // aberta, a janela avisaria "você não participa mais" por cima deste toast.
      aoSair()
      removerConversaDaLista(conversa.id)
      void carregarResumo({ forcar: true })
    } catch (e) {
      toast({ title: mensagemDoErro(e, 'Não foi possível sair do grupo'), variant: 'destructive' })
      onFechar()
    } finally {
      setSaindo(false)
    }
  }

  return (
    <AlertDialog open={aberto} onOpenChange={(v) => !v && !saindo && onFechar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sair do grupo?</AlertDialogTitle>
          <AlertDialogDescription>
            {`Você deixa de receber as mensagens de "${conversa.nome}" e perde o acesso ao histórico. Para voltar, um administrador precisa adicionar você de novo.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saindo}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={saindo}
            onClick={(e) => {
              e.preventDefault()
              void sair()
            }}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {saindo ? 'Saindo...' : 'Sair do grupo'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Renomear o grupo (só administrador — o botão nem aparece para os demais). */
export function DialogoRenomearGrupo({
  aberto,
  onFechar,
  conversa,
}: {
  aberto: boolean
  onFechar: () => void
  conversa: ConversaResumo
}) {
  const { toast } = useToast()
  const [nome, setNome] = useState(conversa.nome)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (aberto) setNome(conversa.nome)
  }, [aberto, conversa.nome])

  const limpo = nome.trim().replace(/\s+/g, ' ')
  const podeSalvar = limpo.length >= 1 && limpo !== conversa.nome && !salvando

  const salvar = async () => {
    if (!podeSalvar) return
    setSalvando(true)
    try {
      await renomearGrupo(conversa.id, limpo)
      definirNomeLocal(conversa.id, limpo)
      toast({ title: 'Nome do grupo atualizado' })
      onFechar()
    } catch (e) {
      toast({ title: mensagemDoErro(e, 'Não foi possível renomear'), variant: 'destructive' })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !salvando && onFechar()}>
      <DialogContent className="border-chat-border bg-chat-panel sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Renomear grupo</DialogTitle>
          <DialogDescription>Todos os participantes veem o nome novo.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="chat-interno-renomear">Nome do grupo</Label>
          <Input
            id="chat-interno-renomear"
            value={nome}
            maxLength={80}
            onChange={(e) => setNome(e.target.value)}
            className="border-chat-border bg-chat-sidebar text-chat-text"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void salvar()
              }
            }}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={salvando} onClick={onFechar} className="border-chat-border bg-transparent hover:bg-chat-hover">
            Cancelar
          </Button>
          <Button type="button" disabled={!podeSalvar} onClick={() => void salvar()}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
