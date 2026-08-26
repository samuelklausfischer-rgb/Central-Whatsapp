import { useCallback, useEffect, useState } from 'react'
import {
  Users, Plus, Send, FlaskConical, Ban, Loader2, ShieldAlert, Trash2, ChevronLeft,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { getAllEmailAccounts } from '@/services/email_accounts'
import {
  getListas, criarLista, getMembros, importarMembros, removerMembro, lerColagem,
  getCampanhas, criarCampanha, prepararCampanha, enviarTeste, liberarDisparo,
  cancelarCampanha, getProgresso, getSupressao,
  type EmailLista, type MembroDaLista, type EmailCampanha, type Supressao, type LinhaImportada,
} from '@/services/email_campanhas'
import type { EmailAccount } from '@/lib/supabase/email-types'

/**
 * Disparo de e-mail para listas — médicos e clínicas parceiras.
 *
 * A tela não envia nada. Ela monta a campanha e libera; quem manda é o worker
 * agendado no banco, de minuto em minuto, respeitando o ritmo. Disparar 200
 * e-mails a partir de um clique no navegador perderia tudo se a aba fechasse.
 */
export default function EmailCampanhas() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [contas, setContas] = useState<EmailAccount[]>([])
  const [listas, setListas] = useState<EmailLista[]>([])
  const [campanhas, setCampanhas] = useState<EmailCampanha[]>([])
  const [supressao, setSupressao] = useState<Supressao[]>([])
  const [carregando, setCarregando] = useState(true)

  // Nova lista
  const [novaListaNome, setNovaListaNome] = useState('')
  const [novaListaDesc, setNovaListaDesc] = useState('')

  // Importação
  const [listaAberta, setListaAberta] = useState<EmailLista | null>(null)
  const [membros, setMembros] = useState<MembroDaLista[]>([])
  const [colagem, setColagem] = useState('')
  const [origem, setOrigem] = useState('')
  const [previa, setPrevia] = useState<{ validas: LinhaImportada[]; recusadas: string[] } | null>(null)

  // Nova campanha
  const [cNome, setCNome] = useState('')
  const [cConta, setCConta] = useState('')
  const [cLista, setCLista] = useState('')
  const [cAssunto, setCAssunto] = useState('')
  const [cCorpo, setCCorpo] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Acompanhamento
  const [progresso, setProgresso] = useState<Record<string, { total: number; por_status: Record<string, number> }>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)

  const erro = (t: string, e: unknown) =>
    toast({ title: t, description: e instanceof Error ? e.message : undefined, variant: 'destructive' })

  // `useCallback` sem dependências: a função só chama serviços e `setState`,
  // que o React garante estáveis. Sem isso ela nasceria nova a cada render e
  // os efeitos que a usam rodariam em laço.
  const carregar = useCallback(async () => {
    try {
      const [ct, ls, cp, sp] = await Promise.all([
        getAllEmailAccounts(), getListas(), getCampanhas(), getSupressao(),
      ])
      setContas(ct)
      setListas(ls)
      setCampanhas(cp)
      setSupressao(sp)
      setCConta((atual) => atual || ct[0]?.id || '')
    } catch (e) {
      toast({
        title: 'Não deu para carregar',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setCarregando(false)
    }
  }, [toast])

  useEffect(() => {
    carregar()
  }, [carregar])

  /*
    Enquanto houver campanha enviando, atualiza o progresso sozinho. O worker
    roda no banco de minuto em minuto — sem isso a tela ficaria parada e daria
    a impressão de que travou.
  */
  // Quais campanhas estão em movimento, como texto: é a "impressão digital" que
  // dispara o efeito só quando alguma muda de estado — e não a cada render.
  const emMovimento = campanhas
    .filter((c) => c.status === 'enviando' || c.status === 'preparada')
    .map((c) => c.id)
    .join(',')

  useEffect(() => {
    const ids = emMovimento ? emMovimento.split(',') : []
    if (ids.length === 0) return
    const buscar = async () => {
      for (const id of ids) {
        try {
          const r = await getProgresso(id)
          setProgresso((p) => ({ ...p, [id]: r }))
        } catch { /* silencioso: é atualização de fundo */ }
      }
      await carregar()
    }
    buscar()
    const t = setInterval(buscar, 20_000)
    return () => clearInterval(t)
  }, [emMovimento, carregar])

  const abrirLista = async (l: EmailLista) => {
    setListaAberta(l)
    setColagem('')
    setOrigem('')
    setPrevia(null)
    try {
      setMembros(await getMembros(l.id))
    } catch (e) {
      erro('Não deu para ler a lista', e)
    }
  }

  const importar = async () => {
    if (!listaAberta || !previa || !origem.trim()) return
    try {
      const n = await importarMembros(listaAberta.id, previa.validas, origem.trim())
      toast({ title: `${n} contatos importados` })
      setColagem('')
      setPrevia(null)
      setMembros(await getMembros(listaAberta.id))
    } catch (e) {
      erro('Não deu para importar', e)
    }
  }

  const salvarCampanha = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setSalvando(true)
    try {
      await criarCampanha({
        nome: cNome.trim(),
        account_id: cConta,
        list_id: cLista,
        assunto: cAssunto.trim(),
        corpo_html: cCorpo,
      })
      setCNome(''); setCAssunto(''); setCCorpo('')
      toast({ title: 'Campanha criada como rascunho' })
      await carregar()
    } catch (e) {
      erro('Não deu para criar a campanha', e)
    } finally {
      setSalvando(false)
    }
  }

  const preparar = async (c: EmailCampanha) => {
    setOcupado(c.id)
    try {
      const r = await prepararCampanha(c.id)
      toast({
        title: `${r.preparados} destinatários prontos`,
        description: r.ignorados > 0
          ? `${r.ignorados} ignorados (inválidos, repetidos ou descadastrados)`
          : undefined,
      })
      await carregar()
    } catch (e) {
      erro('Não deu para preparar', e)
    } finally {
      setOcupado(null)
    }
  }

  const testar = async (c: EmailCampanha) => {
    const para = user?.email
    if (!para) return erro('Sem endereço para o teste', new Error('Seu perfil não tem e-mail.'))
    setOcupado(c.id)
    try {
      await enviarTeste(c.id, para)
      toast({ title: `Teste enviado para ${para}`, description: 'Confira onde caiu: entrada ou spam.' })
    } catch (e) {
      erro('O teste falhou', e)
    } finally {
      setOcupado(null)
    }
  }

  const liberar = async (c: EmailCampanha) => {
    const total = progresso[c.id]?.total ?? 0
    if (!confirm(
      `Liberar o disparo de "${c.nome}"?\n\n` +
      `${total} destinatários. O envio começa em até 1 minuto e sai devagar, ` +
      `respeitando o horário comercial.\n\nIsso não tem desfazer para quem já recebeu.`,
    )) return
    setOcupado(c.id)
    try {
      await liberarDisparo(c.id)
      toast({ title: 'Disparo liberado', description: 'O envio começa em até 1 minuto.' })
      await carregar()
    } catch (e) {
      erro('Não deu para liberar', e)
    } finally {
      setOcupado(null)
    }
  }

  const cancelar = async (c: EmailCampanha) => {
    if (!confirm(`Cancelar "${c.nome}"? Quem já recebeu continua tendo recebido.`)) return
    try {
      await cancelarCampanha(c.id)
      toast({ title: 'Campanha cancelada' })
      await carregar()
    } catch (e) {
      erro('Não deu para cancelar', e)
    }
  }

  const corDoStatus = (s: EmailCampanha['status']) =>
    s === 'concluida' ? 'default'
      : s === 'enviando' ? 'secondary'
        : s === 'cancelada' ? 'destructive'
          : 'outline'

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Disparo de e-mail</h1>
          <p className="mt-1 text-muted-foreground">
            Comunicados para médicos e clínicas parceiras, enviados um a um pela caixa da empresa.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/email"><ChevronLeft className="mr-1 h-4 w-4" />Voltar ao e-mail</Link>
        </Button>
      </div>

      {/* Aviso permanente. Não é decoração: quem dispara precisa lembrar disso
          toda vez, porque o estrago de errar aqui é a reputação do domínio. */}
      <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <strong>Cada mensagem sai individualmente</strong>, com o nome de quem recebe e um link
          de descadastro. O envio é lento de propósito e só acontece em horário comercial. Quem
          descadastrar nunca mais recebe, em nenhuma campanha.
        </div>
      </div>

      {/* ——— Listas ——— */}
      <GlassCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />Listas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {listas.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <span className="font-medium">{l.nome}</span>
                {l.descricao && <p className="truncate text-sm text-muted-foreground">{l.descricao}</p>}
              </div>
              <Button variant="outline" size="sm" onClick={() => abrirLista(l)}>Abrir</Button>
            </div>
          ))}
          {listas.length === 0 && !carregando && (
            <p className="text-sm text-muted-foreground">Nenhuma lista ainda.</p>
          )}

          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!novaListaNome.trim()) return
              try {
                await criarLista(novaListaNome.trim(), novaListaDesc.trim())
                setNovaListaNome(''); setNovaListaDesc('')
                await carregar()
              } catch (err) { erro('Não deu para criar a lista', err) }
            }}
            className="flex flex-wrap gap-2 pt-2"
          >
            <Input value={novaListaNome} onChange={(e) => setNovaListaNome(e.target.value)}
                   placeholder="Nome da lista (ex.: Médicos parceiros)" className="max-w-xs" />
            <Input value={novaListaDesc} onChange={(e) => setNovaListaDesc(e.target.value)}
                   placeholder="Descrição (opcional)" className="max-w-xs" />
            <Button type="submit" variant="outline" disabled={!novaListaNome.trim()}>
              <Plus className="mr-2 h-4 w-4" />Criar lista
            </Button>
          </form>
        </CardContent>
      </GlassCard>

      {/* ——— Nova campanha ——— */}
      <GlassCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Send className="h-5 w-5" />Nova campanha
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={salvarCampanha} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-nome">Nome interno</Label>
                <Input id="c-nome" value={cNome} onChange={(e) => setCNome(e.target.value)}
                       placeholder="Comunicado de agosto" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-conta">Enviar por</Label>
                <Select value={cConta} onValueChange={setCConta}>
                  <SelectTrigger id="c-conta"><SelectValue placeholder="Escolha a caixa" /></SelectTrigger>
                  <SelectContent>
                    {contas.map((a) => <SelectItem key={a.id} value={a.id}>{a.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-lista">Para a lista</Label>
                <Select value={cLista} onValueChange={setCLista}>
                  <SelectTrigger id="c-lista"><SelectValue placeholder="Escolha a lista" /></SelectTrigger>
                  <SelectContent>
                    {listas.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-assunto">Assunto</Label>
              <Input id="c-assunto" value={cAssunto} onChange={(e) => setCAssunto(e.target.value)}
                     placeholder="Novidades da PRN para {{nome}}" required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-corpo">Mensagem</Label>
              <Textarea id="c-corpo" value={cCorpo} onChange={(e) => setCCorpo(e.target.value)}
                        rows={8} required
                        placeholder={'<p>Olá, {{nome}}!</p>\n<p>...</p>'} />
              <p className="text-xs text-muted-foreground">
                Aceita HTML. Use <code>{'{{nome}}'}</code>, <code>{'{{organizacao}}'}</code> e{' '}
                <code>{'{{email}}'}</code> — mensagem personalizada é lida como mensagem, não como
                circular. O rodapé com o link de descadastro é acrescentado sozinho.
              </p>
            </div>

            <Button type="submit" disabled={salvando || !cConta || !cLista}>
              {salvando ? 'Salvando…' : 'Criar como rascunho'}
            </Button>
          </form>
        </CardContent>
      </GlassCard>

      {/* ——— Campanhas ——— */}
      <GlassCard>
        <CardHeader>
          <CardTitle className="text-lg">Campanhas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {campanhas.length === 0 && !carregando && (
            <p className="text-sm text-muted-foreground">Nenhuma campanha ainda.</p>
          )}
          {campanhas.map((c) => {
            const p = progresso[c.id]
            const enviados = p?.por_status?.enviado ?? 0
            const total = p?.total ?? 0
            const pct = total > 0 ? Math.round((enviados / total) * 100) : 0
            const trabalhando = ocupado === c.id
            return (
              <div key={c.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.nome}</span>
                  <Badge variant={corDoStatus(c.status)}>{c.status}</Badge>
                  <span className="ml-auto text-sm text-muted-foreground">{c.assunto}</span>
                </div>

                {total > 0 && (
                  <div className="space-y-1">
                    <div className="h-2 overflow-hidden rounded bg-muted">
                      <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {enviados} de {total} enviados
                      {p.por_status.falhou ? ` · ${p.por_status.falhou} falharam` : ''}
                      {p.por_status.suprimido ? ` · ${p.por_status.suprimido} suprimidos` : ''}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {(c.status === 'rascunho' || c.status === 'preparada') && (
                    <Button size="sm" variant="outline" onClick={() => preparar(c)} disabled={trabalhando}>
                      {trabalhando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Preparar destinatários
                    </Button>
                  )}
                  {c.status !== 'concluida' && c.status !== 'cancelada' && (
                    <Button size="sm" variant="outline" onClick={() => testar(c)} disabled={trabalhando}>
                      <FlaskConical className="mr-2 h-4 w-4" />Enviar teste para mim
                    </Button>
                  )}
                  {c.status === 'preparada' && total > 0 && (
                    <Button size="sm" onClick={() => liberar(c)} disabled={trabalhando}>
                      <Send className="mr-2 h-4 w-4" />Liberar disparo
                    </Button>
                  )}
                  {(c.status === 'enviando' || c.status === 'preparada') && (
                    <Button size="sm" variant="ghost" onClick={() => cancelar(c)}>
                      <Ban className="mr-2 h-4 w-4" />Cancelar
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </GlassCard>

      {/* ——— Supressão ——— */}
      <GlassCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Ban className="h-5 w-5" />Quem não recebe mais
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Descadastrou, deu erro permanente ou reclamou. Vale para <strong>todas</strong> as
            listas e campanhas — e é isso que evita a próxima campanha reencontrar quem já pediu
            para parar.
          </p>
          {supressao.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguém suprimido ainda.</p>
          ) : (
            <div className="space-y-1.5">
              {supressao.map((s) => (
                <div key={s.email} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono">{s.email}</span>
                  <Badge variant="outline">{s.motivo}</Badge>
                  {s.detalhe && <span className="text-muted-foreground">{s.detalhe}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </GlassCard>

      {/* ——— Diálogo da lista ——— */}
      <Dialog open={listaAberta !== null} onOpenChange={(a) => !a && setListaAberta(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{listaAberta?.nome}</DialogTitle>
            <DialogDescription>
              {membros.length} contatos. Cole uma coluna de e-mails, ou e-mail e nome separados por
              vírgula — é o que sai de uma planilha copiada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              value={colagem}
              onChange={(e) => { setColagem(e.target.value); setPrevia(null) }}
              rows={6}
              placeholder={'joao@clinica.com, Dr. João, Clínica X\nmaria@hospital.com, Dra. Maria'}
            />
            <div className="space-y-1.5">
              <Label htmlFor="origem">De onde veio esta lista?</Label>
              <Input id="origem" value={origem} onChange={(e) => setOrigem(e.target.value)}
                     placeholder="ex.: cadastro de parceiros 2026, evento X, indicação" />
              {/* Campo obrigatório de propósito: é o que responde "por que vocês
                  estão me escrevendo?" quando alguém reclamar — e a diferença
                  entre uma lista legítima e uma lista comprada. */}
              <p className="text-xs text-muted-foreground">
                Obrigatório. É o que justifica o contato se alguém reclamar.
              </p>
            </div>

            {previa ? (
              <div className="rounded-lg border p-3 text-sm">
                <p><strong>{previa.validas.length}</strong> endereços válidos
                  {previa.recusadas.length > 0 && (
                    <> · <span className="text-destructive">{previa.recusadas.length} recusados</span></>
                  )}
                </p>
                {previa.recusadas.length > 0 && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    Recusados: {previa.recusadas.slice(0, 3).join(' | ')}
                  </p>
                )}
              </div>
            ) : (
              <Button variant="outline" size="sm" disabled={!colagem.trim()}
                      onClick={() => setPrevia(lerColagem(colagem))}>
                Conferir antes de importar
              </Button>
            )}

            {membros.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                {membros.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {m.email}{m.nome ? ` — ${m.nome}` : ''}
                    </span>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={async () => {
                              await removerMembro(m.id)
                              setMembros(await getMembros(listaAberta!.id))
                            }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setListaAberta(null)}>Fechar</Button>
            <Button onClick={importar} disabled={!previa || previa.validas.length === 0 || !origem.trim()}>
              Importar {previa ? previa.validas.length : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
