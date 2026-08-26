import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  AlertTriangle,
  ClipboardPaste,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { getDevices } from '@/services/devices'
import {
  acrescentarMembros,
  apagarLista,
  contatosDaEtiqueta,
  criarDisparo,
  criarLista,
  listarAlvos,
  listarDisparos,
  listarEtiquetas,
  listarListas,
  listarMembros,
  mudarStatusDoDisparo,
  normalizarColagem,
  PERFIS_DE_RITMO,
  preverDuracaoSegundos,
  removerMembro,
  verificarWhatsApp,
  workerEstaVivo,
  type AlvoDoDisparo,
  type Campanha,
  type ListaDeTransmissao,
  type MembroDaLista,
  type NomeDoPerfil,
  type ProgressoDaCampanha,
} from '@/services/disparador'

/**
 * Disparador em massa.
 *
 * Duas abas: as LISTAS DE TRANSMISSÃO (reutilizáveis, compartilhadas pela equipe)
 * e os DISPAROS (a campanha em si, com fila e acompanhamento).
 *
 * ── A TELA NÃO ENVIA NADA ────────────────────────────────────────────────────
 * Ela só materializa a fila. Quem envia é o worker (`worker/`), que consome
 * `disparo_alvos` no ritmo configurado. Isso é o que permite um disparo de 13
 * horas sobreviver a fechar o navegador.
 *
 * ── POR QUE A PREVISÃO DE TÉRMINO É OBRIGATÓRIA ──────────────────────────────
 * No ritmo seguro (3–13 min entre mensagens, herdado do `prn-vigilante`), 100
 * contatos levam ~13 h e 500 levam quase 3 dias. Descobrir isso depois de apertar
 * o botão é a pior forma de descobrir, então a previsão aparece ao lado do botão
 * de confirmar, antes do clique.
 */

type Aba = 'listas' | 'disparos'

function duracao(segundos: number): string {
  if (segundos < 60) return `${segundos}s`
  const m = Math.round(segundos / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const resto = m % 60
  if (h < 24) return resto ? `${h}h ${resto}min` : `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

const COR_DO_STATUS: Record<string, string> = {
  rascunho: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  agendado: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  enviando: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  pausado: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  concluido: 'bg-green-500/15 text-green-400 border-green-500/30',
  cancelado: 'bg-red-500/15 text-red-400 border-red-500/30',
}

export default function DisparadorEmMassa() {
  const [aba, setAba] = useState<Aba>('listas')

  const [listas, setListas] = useState<ListaDeTransmissao[]>([])
  const [disparos, setDisparos] = useState<(Campanha & { progresso: ProgressoDaCampanha })[]>([])
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([])
  const [etiquetas, setEtiquetas] = useState<{ id: string; name: string }[]>([])
  const [worker, setWorker] = useState<{ vivo: boolean; visto_em: string | null } | null>(null)

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [listaAberta, setListaAberta] = useState<ListaDeTransmissao | null>(null)
  const [novoDisparoAberto, setNovoDisparoAberto] = useState(false)
  const [disparoAberto, setDisparoAberto] = useState<Campanha | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const [l, d, w] = await Promise.all([listarListas(), listarDisparos(), workerEstaVivo()])
      setListas(l)
      setDisparos(d)
      setWorker(w)
    } catch (e: any) {
      setErro(e?.message ?? 'Falha ao carregar')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
    getDevices()
      .then((lista) => setDevices(lista.map((x: any) => ({ id: x.id, name: x.name }))))
      .catch(() => {})
    listarEtiquetas().then(setEtiquetas).catch(() => {})
  }, [carregar])

  // Disparo é coisa de horas: sem isto o progresso na tela congela no que era
  // quando a pessoa abriu.
  useEffect(() => {
    const t = setInterval(() => void carregar(), 20_000)
    return () => clearInterval(t)
  }, [carregar])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Disparador em massa</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Listas de transmissão e envio em massa pelo WhatsApp
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void carregar()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {erro && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {erro}
        </div>
      )}

      {/* Worker caído = campanha agendada que simplesmente não sai. Sem este aviso,
          ninguém descobre até o cliente reclamar que não recebeu. */}
      {worker && !worker.vivo && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>O disparador está fora do ar.</strong> Nenhum envio vai sair enquanto isso —
            criar um disparo agora é seguro, ele fica esperando.{' '}
            {worker.visto_em
              ? `Último sinal em ${format(new Date(worker.visto_em), "dd/MM 'às' HH:mm")}.`
              : 'Nunca deu sinal de vida.'}
          </div>
        </div>
      )}

      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList>
          <TabsTrigger value="listas">
            <Users className="h-3.5 w-3.5 mr-1.5" /> Listas de transmissão
          </TabsTrigger>
          <TabsTrigger value="disparos">
            <Send className="h-3.5 w-3.5 mr-1.5" /> Disparos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="listas" className="mt-4">
          <PainelDeListas
            listas={listas}
            carregando={carregando}
            onAbrir={setListaAberta}
            onMudou={carregar}
          />
        </TabsContent>

        <TabsContent value="disparos" className="mt-4">
          <PainelDeDisparos
            disparos={disparos}
            carregando={carregando}
            devices={devices}
            onNovo={() => setNovoDisparoAberto(true)}
            onAbrir={setDisparoAberto}
            onMudou={carregar}
          />
        </TabsContent>
      </Tabs>

      {listaAberta && (
        <DialogoDaLista
          lista={listaAberta}
          etiquetas={etiquetas}
          devices={devices}
          onFechar={() => {
            setListaAberta(null)
            void carregar()
          }}
        />
      )}

      {novoDisparoAberto && (
        <DialogoDeNovoDisparo
          listas={listas}
          devices={devices}
          onFechar={(criou) => {
            setNovoDisparoAberto(false)
            if (criou) void carregar()
          }}
        />
      )}

      {disparoAberto && (
        <DialogoDoDisparo campanha={disparoAberto} onFechar={() => setDisparoAberto(null)} />
      )}
    </div>
  )
}

// ── Aba: listas ─────────────────────────────────────────────────────────────

function PainelDeListas({
  listas,
  carregando,
  onAbrir,
  onMudou,
}: {
  listas: ListaDeTransmissao[]
  carregando: boolean
  onAbrir: (l: ListaDeTransmissao) => void
  onMudou: () => void
}) {
  const { toast } = useToast()
  const [nome, setNome] = useState('')
  const [criando, setCriando] = useState(false)

  async function criar() {
    const limpo = nome.trim()
    if (!limpo) return
    setCriando(true)
    try {
      await criarLista(limpo)
      setNome('')
      onMudou()
      toast({ title: 'Lista criada.' })
    } catch (e: any) {
      toast({ title: 'Não foi possível criar', description: e?.message, variant: 'destructive' })
    } finally {
      setCriando(false)
    }
  }

  async function apagar(l: ListaDeTransmissao) {
    if (!confirm(`Apagar a lista "${l.nome}"? Os contatos dela saem junto.`)) return
    try {
      await apagarLista(l.id)
      onMudou()
      toast({ title: 'Lista removida.' })
    } catch (e: any) {
      toast({ title: 'Não foi possível apagar', description: e?.message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4">
        <div className="flex-1 min-w-[220px]">
          <Label htmlFor="nova-lista" className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Nova lista
          </Label>
          <Input
            id="nova-lista"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void criar() }}
            placeholder="Ex.: Clientes Unimed"
          />
        </div>
        <Button onClick={() => void criar()} disabled={criando || !nome.trim()}>
          {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Criar lista
        </Button>
      </div>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        {listas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {carregando ? 'Carregando…' : 'Nenhuma lista ainda. Crie a primeira acima.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lista</TableHead>
                <TableHead>Contatos</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {listas.map((l) => (
                <TableRow key={l.id} className="cursor-pointer" onClick={() => onAbrir(l)}>
                  <TableCell className="font-medium">
                    {l.nome}
                    {l.descricao && (
                      <span className="block text-[11px] text-muted-foreground">{l.descricao}</span>
                    )}
                  </TableCell>
                  <TableCell>{l.total_membros ?? 0}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(l.created_at), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); void apagar(l) }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  )
}

// ── Diálogo: editar uma lista ───────────────────────────────────────────────

function DialogoDaLista({
  lista,
  etiquetas,
  devices,
  onFechar,
}: {
  lista: ListaDeTransmissao
  etiquetas: { id: string; name: string }[]
  devices: { id: string; name: string }[]
  onFechar: () => void
}) {
  const { toast } = useToast()
  const [membros, setMembros] = useState<MembroDaLista[]>([])
  const [carregando, setCarregando] = useState(true)
  const [colagem, setColagem] = useState('')
  const [recusados, setRecusados] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [verificando, setVerificando] = useState<string | null>(null)

  const recarregar = useCallback(async () => {
    setCarregando(true)
    try {
      setMembros(await listarMembros(lista.id))
    } finally {
      setCarregando(false)
    }
  }, [lista.id])

  useEffect(() => { void recarregar() }, [recarregar])

  async function colar() {
    if (!colagem.trim()) return
    setOcupado(true)
    try {
      const { validos, invalidos } = await normalizarColagem(colagem)
      setRecusados(invalidos)
      if (validos.length) {
        const n = await acrescentarMembros(
          lista.id,
          validos.map((v) => ({ remote_sender: v })),
          'colado',
        )
        toast({ title: `${n} contato(s) acrescentado(s).` })
        setColagem('')
        await recarregar()
      } else {
        toast({ title: 'Nenhum número válido na colagem.', variant: 'destructive' })
      }
    } catch (e: any) {
      toast({ title: 'Falhou ao processar', description: e?.message, variant: 'destructive' })
    } finally {
      setOcupado(false)
    }
  }

  async function importarEtiqueta(labelId: string) {
    if (!labelId) return
    setOcupado(true)
    try {
      const contatos = await contatosDaEtiqueta(labelId)
      if (contatos.length === 0) {
        toast({ title: 'Essa etiqueta não tem contato privado.' })
        return
      }
      const n = await acrescentarMembros(lista.id, contatos, 'etiqueta')
      toast({ title: `${n} contato(s) acrescentado(s) da etiqueta.` })
      await recarregar()
    } catch (e: any) {
      toast({ title: 'Falhou ao importar', description: e?.message, variant: 'destructive' })
    } finally {
      setOcupado(false)
    }
  }

  /**
   * Pergunta à Evolution quais números existem no WhatsApp.
   *
   * Precisa de uma instância para perguntar por, mas a resposta não depende de
   * qual: ou o número tem WhatsApp, ou não tem. Por isso usa a primeira
   * disponível em vez de mais um seletor na tela.
   */
  async function verificar() {
    const deviceId = devices[0]?.id
    if (!deviceId) {
      toast({ title: 'Nenhuma instância disponível para consultar.', variant: 'destructive' })
      return
    }
    setVerificando('iniciando…')
    try {
      const r = await verificarWhatsApp(lista.id, deviceId, (feitos, restantes) =>
        setVerificando(`${feitos} verificados, ${restantes} restantes…`),
      )
      toast({
        title: `${r.verificados} número(s) verificado(s).`,
        description: `${r.comWhatsApp} com WhatsApp, ${r.verificados - r.comWhatsApp} sem.`,
      })
      await recarregar()
    } catch (e: any) {
      toast({ title: 'Falhou ao verificar', description: e?.message, variant: 'destructive' })
    } finally {
      setVerificando(null)
    }
  }

  const naoVerificados = membros.filter((m) => m.verificado_em == null).length
  const semWhatsApp = membros.filter((m) => m.tem_whatsapp === false).length

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lista.nome}</DialogTitle>
          <DialogDescription>
            {membros.length} contato(s). Importar por etiqueta grava os contatos de agora — a lista
            não muda sozinha depois.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <ClipboardPaste className="h-3 w-3 inline mr-1" /> Colar números
            </Label>
            <Textarea
              rows={3}
              value={colagem}
              onChange={(e) => setColagem(e.target.value)}
              placeholder={'Um por linha, ou separados por vírgula:\n(11) 98888-7777\n5511999998888'}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void colar()} disabled={ocupado || !colagem.trim()}>
                Acrescentar
              </Button>
              {recusados.length > 0 && (
                <span className="text-[11px] text-red-400">
                  {recusados.length} recusado(s): {recusados.slice(0, 3).join(', ')}
                  {recusados.length > 3 ? '…' : ''}
                </span>
              )}
            </div>
          </div>

          {etiquetas.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <Tag className="h-3 w-3 inline mr-1" /> Importar de uma etiqueta
              </Label>
              <select
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                defaultValue=""
                disabled={ocupado}
                onChange={(e) => { void importarEtiqueta(e.target.value); e.currentTarget.value = '' }}
              >
                <option value="">Escolher etiqueta…</option>
                {etiquetas.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* O raio-X evita queimar um slot de até 13 min com número morto — e
              número inexistente em série é sinal de spam para o WhatsApp. */}
          {membros.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
              <Button size="sm" variant="outline" onClick={() => void verificar()}
                      disabled={!!verificando || naoVerificados === 0}>
                {verificando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Verificar WhatsApp
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {verificando
                  ? verificando
                  : naoVerificados > 0
                    ? `${naoVerificados} sem verificar`
                    : 'todos verificados'}
                {semWhatsApp > 0 && (
                  <span className="text-red-400"> · {semWhatsApp} sem WhatsApp, não entram no disparo</span>
                )}
              </span>
            </div>
          )}

          <div className="rounded-lg border border-border max-h-[280px] overflow-y-auto">
            {carregando ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Carregando…</p>
            ) : membros.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Lista vazia. Acrescente contatos acima.
              </p>
            ) : (
              <Table>
                <TableBody>
                  {membros.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        {m.nome_exibicao || m.remote_sender}
                        {m.nome_exibicao && (
                          <span className="block text-[11px] text-muted-foreground">
                            {m.remote_sender}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {m.tem_whatsapp === false ? (
                          <span className="text-red-400">sem WhatsApp</span>
                        ) : (
                          <span className="text-muted-foreground">{m.origem}</span>
                        )}
                      </TableCell>
                      <TableCell className="w-[1%]">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => { await removerMembro(m.id); await recarregar() }}
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Aba: disparos ───────────────────────────────────────────────────────────

function PainelDeDisparos({
  disparos,
  carregando,
  devices,
  onNovo,
  onAbrir,
  onMudou,
}: {
  disparos: (Campanha & { progresso: ProgressoDaCampanha })[]
  carregando: boolean
  devices: { id: string; name: string }[]
  onNovo: () => void
  onAbrir: (c: Campanha) => void
  onMudou: () => void
}) {
  const { toast } = useToast()
  const nomeDoAparelho = useMemo(
    () => new Map(devices.map((d) => [d.id, d.name])),
    [devices],
  )

  async function acao(id: string, a: 'pausar' | 'retomar' | 'cancelar') {
    if (a === 'cancelar' && !confirm('Cancelar este disparo? Quem ainda não recebeu não recebe.')) return
    try {
      await mudarStatusDoDisparo(id, a)
      onMudou()
    } catch (e: any) {
      toast({ title: 'Não foi possível', description: e?.message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={onNovo}>
          <Plus className="h-4 w-4" /> Novo disparo em massa
        </Button>
      </div>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        {disparos.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {carregando ? 'Carregando…' : 'Nenhum disparo ainda.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Disparo</TableHead>
                <TableHead>Instância</TableHead>
                <TableHead>Início</TableHead>
                <TableHead className="w-[220px]">Progresso</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {disparos.map((c) => {
                const p = c.progresso
                const feitos = p.enviados + p.falhas + p.pulados
                const pct = p.total ? Math.round((feitos / p.total) * 100) : 0
                return (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => onAbrir(c)}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {nomeDoAparelho.get(c.device_id) ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {format(new Date(c.iniciar_em), 'dd/MM HH:mm')}
                    </TableCell>
                    <TableCell>
                      <Progress value={pct} className="h-1.5" />
                      <span className="text-[11px] text-muted-foreground">
                        {p.enviados} enviados · {p.pendentes} na fila
                        {p.falhas > 0 && <span className="text-red-400"> · {p.falhas} falha(s)</span>}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={COR_DO_STATUS[c.status]}>{c.status}</Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        {(c.status === 'agendado' || c.status === 'enviando') && (
                          <Button size="sm" variant="ghost" onClick={() => void acao(c.id, 'pausar')}>
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {c.status === 'pausado' && (
                          <Button size="sm" variant="ghost" onClick={() => void acao(c.id, 'retomar')}>
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {['agendado', 'enviando', 'pausado'].includes(c.status) && (
                          <Button size="sm" variant="ghost" onClick={() => void acao(c.id, 'cancelar')}>
                            <X className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  )
}

// ── Diálogo: novo disparo ───────────────────────────────────────────────────

function DialogoDeNovoDisparo({
  listas,
  devices,
  onFechar,
}: {
  listas: ListaDeTransmissao[]
  devices: { id: string; name: string }[]
  onFechar: (criou: boolean) => void
}) {
  const { toast } = useToast()
  const [nome, setNome] = useState('')
  const [listId, setListId] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [avulsosTexto, setAvulsosTexto] = useState('')
  const [avulsos, setAvulsos] = useState<string[]>([])
  const [recusados, setRecusados] = useState<string[]>([])
  const [perfil, setPerfil] = useState<NomeDoPerfil>('seguro')
  const [inicio, setInicio] = useState(() => {
    const d = new Date(Date.now() + 5 * 60_000)
    d.setSeconds(0, 0)
    // `datetime-local` quer horário local sem fuso; `toISOString` daria UTC e o
    // disparo sairia 3 h fora do que a pessoa escolheu.
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  })
  const [enviando, setEnviando] = useState(false)

  const lista = listas.find((l) => l.id === listId)
  const ritmo = PERFIS_DE_RITMO[perfil]
  const quantidade = (lista?.total_membros ?? 0) + avulsos.length
  const previsao = preverDuracaoSegundos(quantidade, ritmo)

  async function processarAvulsos(texto: string) {
    setAvulsosTexto(texto)
    if (!texto.trim()) {
      setAvulsos([])
      setRecusados([])
      return
    }
    try {
      const { validos, invalidos } = await normalizarColagem(texto)
      setAvulsos(validos)
      setRecusados(invalidos)
    } catch { /* silencioso: a validação final é do banco */ }
  }

  async function confirmar() {
    if (!nome.trim() || !deviceId || !mensagem.trim() || quantidade === 0) return
    setEnviando(true)
    try {
      await criarDisparo({
        nome: nome.trim(),
        deviceId,
        mensagem: mensagem.trim(),
        iniciarEm: new Date(inicio).toISOString(),
        listId: listId || null,
        avulsos,
        ritmo,
      })
      toast({ title: 'Disparo agendado.', description: `${quantidade} destinatário(s).` })
      onFechar(true)
    } catch (e: any) {
      toast({ title: 'Não foi possível criar', description: e?.message, variant: 'destructive' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(false) }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo disparo em massa</DialogTitle>
          <DialogDescription>
            A mensagem sai uma a uma, no ritmo escolhido. Você pode fechar a tela: quem envia é o
            disparador, no servidor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="d-nome">Nome do disparo</Label>
            <Input id="d-nome" value={nome} onChange={(e) => setNome(e.target.value)}
                   placeholder="Ex.: Aviso de reajuste — setembro" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Lista de transmissão</Label>
              <select className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                      value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">Nenhuma (só avulsos)</option>
                {listas.map((l) => (
                  <option key={l.id} value={l.id}>{l.nome} ({l.total_membros ?? 0})</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Instância que vai enviar</Label>
              <select className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                      value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">Escolher…</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="d-avulsos">
              Contatos avulsos <span className="text-muted-foreground">(entram só neste disparo)</span>
            </Label>
            <Textarea id="d-avulsos" rows={2} value={avulsosTexto}
                      onChange={(e) => void processarAvulsos(e.target.value)}
                      placeholder="Um por linha ou separados por vírgula" />
            <span className="text-[11px] text-muted-foreground">
              {avulsos.length} válido(s)
              {recusados.length > 0 && (
                <span className="text-red-400"> · {recusados.length} recusado(s): {recusados.slice(0, 3).join(', ')}</span>
              )}
            </span>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="d-msg">Mensagem</Label>
            <Textarea id="d-msg" rows={4} value={mensagem} onChange={(e) => setMensagem(e.target.value)}
                      placeholder="Olá {nome}, tudo bem?" />
            <span className="text-[11px] text-muted-foreground">
              <code>{'{nome}'}</code> é trocado pelo nome do contato. Mensagem idêntica para todo mundo
              é mais fácil de o WhatsApp marcar como spam.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="d-inicio">Começar em</Label>
              <Input id="d-inicio" type="datetime-local" value={inicio}
                     onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Ritmo</Label>
              <select className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                      value={perfil} onChange={(e) => setPerfil(e.target.value as NomeDoPerfil)}>
                {(Object.keys(PERFIS_DE_RITMO) as NomeDoPerfil[]).map((k) => (
                  <option key={k} value={k}>
                    {PERFIS_DE_RITMO[k].rotulo} ({Math.round(PERFIS_DE_RITMO[k].delay_min_ms / 1000)}–
                    {Math.round(PERFIS_DE_RITMO[k].delay_max_ms / 1000)}s)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* A previsão fica colada no botão de propósito: no ritmo seguro, 500
              contatos levam quase 3 dias, e isso precisa ser sabido ANTES do clique. */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>
                <strong>{quantidade}</strong> destinatário(s) ·{' '}
                {quantidade > 0
                  ? <>termina em cerca de <strong>{duracao(previsao)}</strong></>
                  : 'escolha uma lista ou cole números'}
              </span>
            </div>
            <Button
              onClick={() => void confirmar()}
              disabled={enviando || !nome.trim() || !deviceId || !mensagem.trim() || quantidade === 0}
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Agendar disparo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Diálogo: acompanhar um disparo ──────────────────────────────────────────

function DialogoDoDisparo({ campanha, onFechar }: { campanha: Campanha; onFechar: () => void }) {
  const [alvos, setAlvos] = useState<AlvoDoDisparo[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    listarAlvos(campanha.id)
      .then(setAlvos)
      .finally(() => setCarregando(false))
  }, [campanha.id])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campanha.nome}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">{campanha.mensagem}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border max-h-[420px] overflow-y-auto">
          {carregando ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enviado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alvos.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      {a.nome_exibicao || a.remote_sender}
                      {a.avulso && <Badge variant="outline" className="ml-2 text-[10px]">avulso</Badge>}
                    </TableCell>
                    <TableCell>
                      <span className={a.status === 'falhou' ? 'text-red-400' : ''}>{a.status}</span>
                      {a.erro && <span className="block text-[11px] text-red-400">{a.erro}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {a.enviado_em ? format(new Date(a.enviado_em), 'dd/MM HH:mm') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
