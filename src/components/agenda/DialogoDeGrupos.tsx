import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarOff, Check, Plus, Search, Trash2, Users } from 'lucide-react'
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  atualizarMembros,
  contarCompromissosDoGrupo,
  criarGrupo,
  excluirGrupo,
  getColegas,
  getGrupos,
  getMembrosDoGrupo,
  renomearGrupo,
  type Colega,
} from '@/services/agenda'
import type { AgendaGroup } from '@/lib/supabase/types'
import { COR_ACAO_EXCLUIR, COR_AVISO } from './cores'

/**
 * Criar e manter os grupos da Agenda.
 *
 * Duas telas dentro do mesmo diálogo: a LISTA dos meus grupos e a EDIÇÃO de um
 * deles. Um diálogo sobre outro empilharia dois vidros e o segundo ficaria
 * ilegível — e, no celular, sem espaço para voltar.
 */
export function DialogoDeGrupos({
  aberto,
  aoFechar,
  meuId,
  souAdmin,
  aoMudarGrupos,
}: {
  aberto: boolean
  aoFechar: () => void
  meuId: string
  souAdmin: boolean
  /** A página recarrega a lista do seletor de escopo. */
  aoMudarGrupos: () => void
}) {
  const { toast } = useToast()

  const [grupos, setGrupos] = useState<AgendaGroup[]>([])
  const [colegas, setColegas] = useState<Colega[]>([])
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)

  /** null = lista. 'novo' = criando. AgendaGroup = editando aquele. */
  const [editando, setEditando] = useState<AgendaGroup | 'novo' | null>(null)
  const [nome, setNome] = useState('')
  const [membros, setMembros] = useState<string[]>([])
  const [busca, setBusca] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const [g, c] = await Promise.all([getGrupos(), getColegas()])
      setGrupos(g)
      setColegas(c)
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : 'Não foi possível carregar os grupos',
        variant: 'destructive',
      })
    } finally {
      setCarregando(false)
    }
  }, [toast])

  useEffect(() => {
    if (aberto) void carregar()
  }, [aberto, carregar])

  const porId = useMemo(() => new Map(colegas.map((c) => [c.id, c])), [colegas])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return colegas
    return colegas.filter(
      (c) => c.nome.toLowerCase().includes(t) || (c.setor ?? '').toLowerCase().includes(t),
    )
  }, [colegas, busca])

  /** Quantos do grupo ficariam de fora do convite do Outlook. */
  const semOutlook = membros.filter((id) => porId.get(id)?.tem_outlook === false).length

  const abrirNovo = () => {
    setEditando('novo')
    setNome('')
    // Quem cria já entra: sem isso o criador não veria em "Grupos" o
    // compromisso que ele mesmo marcou.
    setMembros([meuId])
    setBusca('')
  }

  const abrirEdicao = async (g: AgendaGroup) => {
    setEditando(g)
    setNome(g.nome)
    setBusca('')
    try {
      setMembros(await getMembrosDoGrupo(g.id))
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : 'Não foi possível carregar os membros',
        variant: 'destructive',
      })
      setMembros([])
    }
  }

  const alternar = (id: string) =>
    setMembros((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))

  const salvar = async () => {
    if (!nome.trim()) {
      toast({ title: 'Dê um nome ao grupo', variant: 'destructive' })
      return
    }
    if (membros.length === 0) {
      toast({ title: 'Escolha pelo menos uma pessoa', variant: 'destructive' })
      return
    }

    setSalvando(true)
    try {
      if (editando === 'novo') {
        await criarGrupo(nome.trim(), meuId, membros)
        toast({ title: 'Grupo criado' })
      } else if (editando) {
        if (nome.trim() !== editando.nome) await renomearGrupo(editando.id, nome.trim())
        await atualizarMembros(editando.id, membros)
        toast({ title: 'Grupo atualizado' })
      }
      setEditando(null)
      await carregar()
      aoMudarGrupos()
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : 'Não foi possível salvar o grupo',
        variant: 'destructive',
      })
    } finally {
      setSalvando(false)
    }
  }

  /**
   * Apagar o grupo apaga OS COMPROMISSOS DELE — `agenda_events.group_id` é
   * `ON DELETE CASCADE`. Por isso a pergunta traz o número na frente: uma coisa
   * é tirar o grupo da lista, outra é apagar quarenta compromissos.
   */
  const remover = async (g: AgendaGroup) => {
    let quantos = 0
    try {
      quantos = await contarCompromissosDoGrupo(g.id)
    } catch {
      // Não deu para contar: pergunta mesmo assim, sem o número, em vez de
      // travar a exclusão por causa do aviso.
      quantos = -1
    }

    const aviso =
      quantos > 0
        ? `Excluir o grupo "${g.nome}"?\n\nIsto também APAGA ${quantos} compromisso(s) marcados nele. Não tem como desfazer.`
        : quantos === 0
          ? `Excluir o grupo "${g.nome}"?`
          : `Excluir o grupo "${g.nome}"?\n\nOs compromissos marcados nele são apagados junto.`

    if (!window.confirm(aviso)) return

    try {
      await excluirGrupo(g.id)
      toast({ title: 'Grupo excluído' })
      await carregar()
      aoMudarGrupos()
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : 'Não foi possível excluir',
        variant: 'destructive',
      })
    }
  }

  const podeMexer = (g: AgendaGroup) => g.created_by === meuId || souAdmin

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) {
          setEditando(null)
          aoFechar()
        }
      }}
    >
      <GlassDialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editando && (
              <button
                type="button"
                onClick={() => setEditando(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Voltar para a lista"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <Users className="h-4 w-4" />
            {editando === 'novo' ? 'Novo grupo' : editando ? 'Editar grupo' : 'Grupos'}
          </DialogTitle>
        </DialogHeader>

        {/* ---------------- lista ---------------- */}
        {!editando && (
          <div className="grid gap-2 py-2">
            {carregando ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : grupos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum grupo ainda. Um grupo junta pessoas sob um nome — o que for marcado nele
                aparece para todas elas.
              </p>
            ) : (
              grupos.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-accent/30 p-3"
                >
                  <button
                    type="button"
                    onClick={() => podeMexer(g) && void abrirEdicao(g)}
                    disabled={!podeMexer(g)}
                    className={cn(
                      'min-w-0 flex-1 text-left text-sm font-medium',
                      podeMexer(g) ? 'hover:text-primary' : 'cursor-default',
                    )}
                  >
                    {g.nome}
                    {!podeMexer(g) && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        Você participa; quem criou é que edita
                      </span>
                    )}
                  </button>
                  {podeMexer(g) && (
                    <button
                      type="button"
                      onClick={() => void remover(g)}
                      className={cn('shrink-0', COR_ACAO_EXCLUIR)}
                      aria-label={`Excluir ${g.nome}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))
            )}

            <Button onClick={abrirNovo} className="mt-2 gap-1.5">
              <Plus className="h-4 w-4" /> Novo grupo
            </Button>
          </div>
        )}

        {/* ---------------- criar / editar ---------------- */}
        {editando && (
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="grupo-nome">Nome do grupo</Label>
              <Input
                id="grupo-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Fechamento mensal"
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Pessoas ({membros.length})</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome ou setor"
                  className="pl-8"
                />
              </div>

              <div className="max-h-64 overflow-auto rounded-lg border border-border/60">
                {visiveis.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Ninguém com esse nome.</p>
                ) : (
                  visiveis.map((c) => {
                    const dentro = membros.includes(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => alternar(c.id)}
                        className={cn(
                          'flex w-full items-center gap-2.5 border-b border-border/40 p-2.5 text-left last:border-b-0',
                          dentro ? 'bg-primary/10' : 'hover:bg-accent/50',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                            dentro ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                          )}
                        >
                          {dentro && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{c.nome || '(sem nome)'}</span>
                          {c.setor && (
                            <span className="block text-xs text-muted-foreground">{c.setor}</span>
                          )}
                        </span>
                        {/* Quem não conectou o Outlook não recebe convite. Dizer
                            isso AQUI, na hora de escolher, evita a descoberta
                            depois — quando a pessoa já acha que convidou. */}
                        {!c.tem_outlook && (
                          <span
                            className="shrink-0 text-muted-foreground"
                            title="Ainda não conectou o Outlook — vê no Central Whats, mas não recebe convite"
                          >
                            <CalendarOff className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {semOutlook > 0 && (
              <p className={cn('rounded-lg border p-2.5 text-xs', COR_AVISO)}>
                {semOutlook === 1
                  ? '1 pessoa do grupo ainda não conectou o Outlook.'
                  : `${semOutlook} pessoas do grupo ainda não conectaram o Outlook.`}{' '}
                Elas veem o compromisso no Central Whats, mas não recebem o convite na agenda.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {editando ? (
            <>
              <Button variant="ghost" onClick={() => setEditando(null)} disabled={salvando}>
                Cancelar
              </Button>
              <Button onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : editando === 'novo' ? 'Criar grupo' : 'Salvar'}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={aoFechar}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </GlassDialogContent>
    </Dialog>
  )
}
