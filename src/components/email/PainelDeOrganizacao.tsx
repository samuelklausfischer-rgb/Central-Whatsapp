import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Loader2, Star, Eye, Tag, Plus, Pencil, UserPlus, RotateCw, Users } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { listarPessoas, listarSetores, type Pessoa } from '@/services/setores'
import {
  getClassificacoes, getEtiquetas, criarEtiqueta, getOrganizacao,
  salvarTriagem, definirResponsaveis, definirEtiquetas,
  type Classificacao, type Etiqueta, type OrganizacaoDoEmail,
} from '@/services/email_organizacao'

/**
 * O que a equipe registra sobre um e-mail: classificação, quem cuida, etiquetas
 * e uma descrição livre.
 *
 * Fica visível no leitor sem precisar clicar — quem só está lendo tem que ver a
 * decisão de quem organizou. O diálogo é só para editar.
 *
 * O formato do diálogo segue `chat/ContactPickerDialog`, que é o de escolher
 * pessoas que já existe no app: busca no topo, linha inteira clicável com
 * avatar, rolagem de ALTURA FIXA e rodapé com contagem.
 */

const ALTURA_DA_LISTA = 'h-[280px]'

function iniciais(texto: string): string {
  const partes = texto.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

const nomeDaPessoa = (p: Pessoa) => p.name || p.email || 'sem nome'

export function PainelDeOrganizacao({
  emailId,
  /** Setor da caixa. As pessoas dele aparecem primeiro no seletor. */
  setorDaCaixa,
}: {
  emailId: string
  setorDaCaixa: string | null
}) {
  const { toast } = useToast()

  const [org, setOrg] = useState<OrganizacaoDoEmail | null>(null)
  const [falhou, setFalhou] = useState(false)
  const [classificacoes, setClassificacoes] = useState<Classificacao[]>([])
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [doSetor, setDoSetor] = useState<Set<string>>(new Set())

  const [aberto, setAberto] = useState(false)
  const [salvando, setSalvando] = useState(false)

  // Rascunho do diálogo — só vai para o banco no "Salvar".
  const [busca, setBusca] = useState('')
  const [rClassificacao, setRClassificacao] = useState<string | null>(null)
  const [rDescricao, setRDescricao] = useState('')
  const [rPessoas, setRPessoas] = useState<Map<string, 'responsavel' | 'acompanhando'>>(new Map())
  const [rEtiquetas, setREtiquetas] = useState<Set<string>>(new Set())
  const [novaEtiqueta, setNovaEtiqueta] = useState('')

  const erro = useCallback(
    (t: string, e: unknown) =>
      toast({
        title: t,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      }),
    [toast],
  )

  const carregar = useCallback(async () => {
    setFalhou(false)
    try {
      const [o, c, e, p, s] = await Promise.all([
        getOrganizacao(emailId), getClassificacoes(), getEtiquetas(),
        listarPessoas().catch(() => [] as Pessoa[]),
        listarSetores().catch(() => []),
      ])
      setOrg(o)
      setClassificacoes(c)
      setEtiquetas(e)
      setPessoas(p)
      setDoSetor(new Set(setorDaCaixa ? s.find((x) => x.nome === setorDaCaixa)?.membros ?? [] : []))
    } catch (e) {
      /*
        Falha VISÍVEL. Antes o erro ia só para o console e `org` ficava `null` —
        e como o botão depende dele, ele ficava desabilitado para sempre, sem
        ninguém entender por quê.
      */
      setFalhou(true)
      erro('Não deu para carregar a organização', e)
    }
  }, [emailId, setorDaCaixa, erro])

  useEffect(() => {
    setOrg(null)
    carregar()
  }, [carregar])

  const abrir = () => {
    if (!org) return
    setRClassificacao(org.classificacao)
    setRDescricao(org.descricao ?? '')
    setRPessoas(new Map(org.responsaveis.map((r) => [r.user_id, r.papel])))
    setREtiquetas(new Set(org.etiquetas.map((e) => e.id)))
    setNovaEtiqueta('')
    setBusca('')
    setAberto(true)
  }

  /**
   * Fechar SEMPRE limpa o rascunho e a busca.
   *
   * O componente não desmonta ao fechar o diálogo, então cancelar sem limpar
   * deixava as marcações penduradas — e ao reabrir elas voltavam como se
   * tivessem sido salvas. Mesmo cuidado do `ContactPickerDialog`.
   */
  const fechar = useCallback(() => {
    if (salvando) return
    setAberto(false)
    setBusca('')
    setNovaEtiqueta('')
  }, [salvando])

  const salvar = async () => {
    setSalvando(true)
    try {
      await Promise.all([
        salvarTriagem(emailId, {
          classificacao: rClassificacao,
          descricao: rDescricao.trim() || null,
        }),
        definirResponsaveis(
          emailId,
          [...rPessoas.entries()].map(([user_id, papel]) => ({ user_id, papel })),
        ),
        definirEtiquetas(emailId, [...rEtiquetas]),
      ])
      toast({ title: 'Organização salva' })
      setAberto(false)
      setBusca('')
      await carregar()
    } catch (e) {
      erro('Não deu para salvar', e)
    } finally {
      setSalvando(false)
    }
  }

  const alternarPessoa = (id: string) =>
    setRPessoas((antes) => {
      const novo = new Map(antes)
      if (novo.has(id)) novo.delete(id)
      else novo.set(id, 'responsavel')
      return novo
    })

  const trocarPapel = (id: string) =>
    setRPessoas((antes) => {
      const novo = new Map(antes)
      novo.set(id, novo.get(id) === 'responsavel' ? 'acompanhando' : 'responsavel')
      return novo
    })

  /*
    Seções de gente: a do setor da caixa primeiro.

    Quando a caixa é `financeiro@`, é do Financeiro que se escolhe em quase toda
    vez — procurar entre 13 nomes toda hora é atrito à toa. As seções vazias são
    filtradas: antes o cabeçalho "Outras pessoas" aparecia sozinho quando todo
    mundo era do setor.
  */
  const secoes = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const cabe = (p: Pessoa) =>
      !termo ||
      nomeDaPessoa(p).toLowerCase().includes(termo) ||
      (p.email ?? '').toLowerCase().includes(termo)

    const ordenar = (a: Pessoa, b: Pessoa) =>
      nomeDaPessoa(a).localeCompare(nomeDaPessoa(b), 'pt-BR')

    const visiveis = pessoas.filter(cabe)
    return [
      { titulo: setorDaCaixa ?? '', pessoas: visiveis.filter((p) => doSetor.has(p.id)).sort(ordenar) },
      { titulo: 'Outras pessoas', pessoas: visiveis.filter((p) => !doSetor.has(p.id)).sort(ordenar) },
    ].filter((s) => s.pessoas.length > 0 && s.titulo)
  }, [pessoas, doSetor, setorDaCaixa, busca])

  const nenhumaPessoa = secoes.every((s) => s.pessoas.length === 0)

  const classAtual = classificacoes.find((c) => c.chave === org?.classificacao) ?? null
  const nomeDe = (id: string) => {
    const p = pessoas.find((x) => x.id === id)
    return p ? nomeDaPessoa(p) : 'alguém'
  }

  const criarEAplicar = async () => {
    const nome = novaEtiqueta.trim()
    if (!nome) return
    try {
      const e = await criarEtiqueta(nome, '#3b82f6')
      setEtiquetas((a) => [...a, e].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR')))
      setREtiquetas((a) => new Set(a).add(e.id))
      setNovaEtiqueta('')
    } catch (err) {
      erro('Não deu para criar a etiqueta', err)
    }
  }

  const temAlgo = Boolean(
    org && (org.classificacao || org.responsaveis.length || org.etiquetas.length || org.descricao),
  )

  return (
    <>
      {/* Resumo — o que já foi decidido, visível sem clicar em nada. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/60 px-3 py-2">
        {falhou ? (
          <>
            <span className="text-sm text-muted-foreground">
              Não deu para carregar a organização.
            </span>
            <Button variant="ghost" size="sm" className="ml-auto gap-1.5" onClick={carregar}>
              <RotateCw className="h-3.5 w-3.5" />
              Tentar de novo
            </Button>
          </>
        ) : (
          <>
            {classAtual && (
              <Badge
                className="border-transparent text-white hover:opacity-90"
                style={{ backgroundColor: classAtual.cor }}
              >
                {classAtual.rotulo}
              </Badge>
            )}

            {org?.responsaveis.map((r) => (
              <Badge
                key={r.user_id}
                variant={r.papel === 'responsavel' ? 'secondary' : 'outline'}
                className="gap-1"
              >
                {r.papel === 'responsavel'
                  ? <Star className="h-3 w-3 fill-current" />
                  : <Eye className="h-3 w-3" />}
                {nomeDe(r.user_id)}
              </Badge>
            ))}

            {org?.etiquetas.map((e) => (
              <Badge key={e.id} variant="outline" style={{ borderColor: e.cor, color: e.cor }}>
                {e.nome}
              </Badge>
            ))}

            {!temAlgo && org && (
              <span className="text-sm text-muted-foreground">
                Nada registrado sobre este e-mail.
              </span>
            )}
            {!org && <span className="text-sm text-muted-foreground">Carregando…</span>}

            <Button
              variant="ghost"
              size="sm"
              className="ml-auto gap-1.5"
              onClick={abrir}
              disabled={!org}
            >
              {temAlgo ? <Pencil className="h-3.5 w-3.5" /> : <UserPlus className="h-4 w-4" />}
              {temAlgo ? 'Editar' : 'Organizar'}
            </Button>
          </>
        )}
      </div>

      {org?.descricao && (
        <p className="rounded-lg border bg-card/40 px-3 py-2 text-sm text-muted-foreground">
          {org.descricao}
        </p>
      )}

      <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Organizar este e-mail</DialogTitle>
            <DialogDescription>
              Fica guardado para a equipe e serve de base para as automações.
            </DialogDescription>
          </DialogHeader>

          {/* Classificação — valor único */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Classificação</p>
            <div className="flex flex-wrap gap-2">
              {classificacoes.map((c) => {
                const ativa = rClassificacao === c.chave
                return (
                  <button
                    key={c.chave}
                    type="button"
                    onClick={() => setRClassificacao(ativa ? null : c.chave)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                      ativa ? 'text-white' : 'bg-transparent hover:bg-accent/50',
                    )}
                    /* A cor vem do BANCO (`email_classificacoes.cor`), não é um
                       token de design — por isso entra por `style`. */
                    style={
                      ativa
                        ? { backgroundColor: c.cor, borderColor: c.cor }
                        : { borderColor: c.cor, color: c.cor }
                    }
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: ativa ? '#fff' : c.cor }}
                    />
                    {c.rotulo}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Quem cuida */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Users className="h-4 w-4" />
              Quem cuida
            </p>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Procurar pessoa..."
                className="pl-9"
              />
            </div>

            {/*
              ALTURA FIXA, não `max-h`. O ScrollArea do Radix monta um viewport
              interno que só rola com altura definida — com `max-h` a lista
              crescia livre e estourava o diálogo. Foi a falha relatada.
            */}
            <ScrollArea className={cn(ALTURA_DA_LISTA, '-mx-2 rounded-md border px-2')}>
              <div className="flex flex-col gap-0.5 py-1">
                {nenhumaPessoa && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Ninguém encontrado.
                  </p>
                )}

                {secoes.map((secao) => (
                  <div key={secao.titulo}>
                    <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                      {secao.titulo}
                    </p>
                    {secao.pessoas.map((p) => {
                      const papel = rPessoas.get(p.id)
                      const marcado = papel !== undefined
                      return (
                        <div
                          key={p.id}
                          className={cn(
                            'flex items-center gap-3 rounded px-2 py-2 transition-colors',
                            marcado ? 'bg-accent/60' : 'hover:bg-accent/40',
                          )}
                        >
                          {/* Linha inteira clicável, com o checkbox fora da
                              ordem de tabulação — padrão do ContactPickerDialog. */}
                          <button
                            type="button"
                            onClick={() => alternarPessoa(p.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <Checkbox checked={marcado} className="shrink-0" tabIndex={-1} />
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                                {iniciais(nomeDaPessoa(p))}
                              </AvatarFallback>
                            </Avatar>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{nomeDaPessoa(p)}</span>
                              {p.email && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {p.email}
                                </span>
                              )}
                            </span>
                          </button>

                          {marcado && (
                            <button
                              type="button"
                              onClick={() => trocarPapel(p.id)}
                              title={
                                papel === 'responsavel'
                                  ? 'Responsável — clique para virar acompanhando'
                                  : 'Acompanhando — clique para virar responsável'
                              }
                              className="flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                            >
                              {papel === 'responsavel' ? (
                                <><Star className="h-3 w-3 fill-current" />responsável</>
                              ) : (
                                <><Eye className="h-3 w-3" />acompanha</>
                              )}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </ScrollArea>

            <p className="text-xs text-muted-foreground">
              <strong>Responsável</strong> tem que resolver. <strong>Acompanhando</strong> só
              precisa saber.
            </p>
          </div>

          {/* Etiquetas */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Tag className="h-4 w-4" />
              Etiquetas
            </p>
            <div className="flex flex-wrap gap-2">
              {etiquetas.map((e) => {
                const ativa = rEtiquetas.has(e.id)
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() =>
                      setREtiquetas((a) => {
                        const n = new Set(a)
                        if (n.has(e.id)) n.delete(e.id)
                        else n.add(e.id)
                        return n
                      })
                    }
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm transition-colors',
                      ativa ? 'text-white' : 'bg-transparent hover:bg-accent/50',
                    )}
                    style={
                      ativa
                        ? { backgroundColor: e.cor, borderColor: e.cor }
                        : { borderColor: e.cor, color: e.cor }
                    }
                  >
                    {e.nome}
                  </button>
                )
              })}
              {etiquetas.length === 0 && (
                <span className="text-sm text-muted-foreground">Nenhuma etiqueta ainda.</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={novaEtiqueta}
                onChange={(e) => setNovaEtiqueta(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    criarEAplicar()
                  }
                }}
                placeholder="Criar etiqueta nova"
                className="h-9"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={criarEAplicar}
                disabled={!novaEtiqueta.trim()}
                aria-label="Criar etiqueta"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Descrição <span className="font-normal text-muted-foreground">(opcional)</span>
            </p>
            <Textarea
              value={rDescricao}
              onChange={(e) => setRDescricao(e.target.value)}
              rows={3}
              placeholder="O que a equipe precisa saber sobre este e-mail"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar{rPessoas.size > 0 ? ` (${rPessoas.size})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
