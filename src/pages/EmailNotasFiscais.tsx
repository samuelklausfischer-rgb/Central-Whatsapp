import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldAlert, ChevronLeft, Plus, Pencil, Check, X, Loader2, Upload, Trash2,
  Send, FlaskConical, AlertTriangle, History, Users, Mail as MailIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { getAllEmailAccounts } from '@/services/email_accounts'
import { sendEmail } from '@/services/emails'
import type { EmailAccount } from '@/lib/supabase/email-types'
import {
  getDestinatarios, criarDestinatario, atualizarDestinatario,
  getConfig, salvarConfig, CONFIG_PADRAO, substituirMarcadores,
  criarLote, criarEnvios, dispararLote, atualizarStatusLote,
  getLotes, getEnviosDoLote,
  calcularSha256, lerComoBase64, formatarBytes, LIMITE_ANEXO_BYTES,
  sugerirDestinatario,
  type NfDestinatario, type NfLote, type NfEnvio,
} from '@/services/nf'

/**
 * Notas Fiscais — Item 4 da fila de 25/09/2026.
 *
 * O PROBLEMA QUE ORIGINOU ESTA TELA: uma nota fiscal foi enviada para o e-mail
 * errado por confusão na hora de casar o PDF com o cliente. Por isso, aqui:
 *
 *  - o pareamento arquivo→destinatário NUNCA é automático (só sugerido);
 *  - existe uma tela de conferência OBRIGATÓRIA antes do botão de enviar
 *    aparecer de verdade;
 *  - o e-mail que recebeu cada nota fica gravado por extenso em `nf_envios`,
 *    então "para onde essa nota foi?" tem resposta no mês seguinte.
 *
 * Rota irmã de `/email/campanhas`, atrás do mesmo porteiro que a Caixa de
 * Entrada (`FerramentaRoute slug="tela-email"`, ver `App.tsx`) — a proteção
 * que realmente importa é a RLS de `pode_enviar_nf()` no banco, não a rota.
 */

function referenciaDoMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Um PDF escolhido na tela, ainda não gravado em `nf_envios`. */
interface ArquivoDoLote {
  chave: string
  arquivo: File
  base64: string
  sha256: string
  /** Só isto é o que vale para o disparo. Preenchido por escolha da pessoa — nunca sozinho. */
  destinatarioId: string | null
  /** Candidato encontrado pelo nome do arquivo. Vira `destinatarioId` só se alguém clicar "Usar". */
  sugestaoId: string | null
}

/** Seletor buscável (nome, e-mail ou documento) — nunca vem pré-marcado. */
function SeletorDestinatario({
  value,
  onChange,
  destinatarios,
}: {
  value: string | null
  onChange: (id: string) => void
  destinatarios: NfDestinatario[]
}) {
  const [aberto, setAberto] = useState(false)
  const selecionado = destinatarios.find((d) => d.id === value) ?? null
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-start truncate font-normal">
          {selecionado ? `${selecionado.nome} — ${selecionado.email}` : 'Escolher destinatário…'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar por nome, e-mail ou documento…" />
          <CommandList>
            <CommandEmpty>Ninguém encontrado.</CommandEmpty>
            <CommandGroup>
              {destinatarios.map((d) => (
                <CommandItem
                  key={d.id}
                  value={`${d.nome} ${d.email} ${d.documento ?? ''}`}
                  onSelect={() => { onChange(d.id); setAberto(false) }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{d.nome}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {d.email}{d.documento ? ` · ${d.documento}` : ''}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default function EmailNotasFiscais() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [contas, setContas] = useState<EmailAccount[]>([])
  const [contaId, setContaId] = useState('')
  const [carregando, setCarregando] = useState(true)

  const [destinatarios, setDestinatarios] = useState<NfDestinatario[]>([])
  const [config, setConfig] = useState<{ assunto: string; corpo_html: string }>(CONFIG_PADRAO)
  const [lotes, setLotes] = useState<NfLote[]>([])

  const erro = useCallback((t: string, e: unknown) =>
    toast({ title: t, description: e instanceof Error ? e.message : undefined, variant: 'destructive' }),
  [toast])

  const carregarConta = useCallback(async (id: string) => {
    try {
      const [d, c, l] = await Promise.all([getDestinatarios(id), getConfig(id), getLotes(id)])
      setDestinatarios(d)
      setConfig(c ? { assunto: c.assunto, corpo_html: c.corpo_html } : CONFIG_PADRAO)
      setLotes(l)
    } catch (e) {
      erro('Não deu para carregar', e)
    }
  }, [erro])

  useEffect(() => {
    getAllEmailAccounts()
      .then((cs) => {
        setContas(cs)
        setContaId((atual) => atual || cs[0]?.id || '')
      })
      .catch((e) => erro('Não deu para carregar as caixas', e))
      .finally(() => setCarregando(false))
  }, [erro])

  useEffect(() => {
    if (contaId) carregarConta(contaId)
  }, [contaId, carregarConta])

  const destinatariosAtivos = useMemo(() => destinatarios.filter((d) => d.ativo), [destinatarios])

  // ——— Destinatários ———
  const [filtroDestinatarios, setFiltroDestinatarios] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [novoEmail, setNovoEmail] = useState('')
  const [novoDocumento, setNovoDocumento] = useState('')
  const [novaObs, setNovaObs] = useState('')
  const [salvandoDestinatario, setSalvandoDestinatario] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [edicao, setEdicao] = useState({ nome: '', email: '', documento: '', observacao: '' })

  const destinatariosFiltrados = useMemo(() => {
    const q = filtroDestinatarios.trim().toLowerCase()
    if (!q) return destinatarios
    return destinatarios.filter((d) =>
      d.nome.toLowerCase().includes(q) ||
      d.email.toLowerCase().includes(q) ||
      (d.documento ?? '').toLowerCase().includes(q))
  }, [destinatarios, filtroDestinatarios])

  async function adicionarDestinatario(ev: React.FormEvent) {
    ev.preventDefault()
    if (!novoNome.trim() || !novoEmail.trim()) return
    setSalvandoDestinatario(true)
    try {
      await criarDestinatario({
        account_id: contaId,
        nome: novoNome.trim(),
        email: novoEmail.trim(),
        documento: novoDocumento.trim() || null,
        observacao: novaObs.trim() || null,
      })
      setNovoNome(''); setNovoEmail(''); setNovoDocumento(''); setNovaObs('')
      toast({ title: 'Destinatário cadastrado' })
      await carregarConta(contaId)
    } catch (e) {
      erro('Não deu para cadastrar', e)
    } finally {
      setSalvandoDestinatario(false)
    }
  }

  function iniciarEdicao(d: NfDestinatario) {
    setEditandoId(d.id)
    setEdicao({ nome: d.nome, email: d.email, documento: d.documento ?? '', observacao: d.observacao ?? '' })
  }

  async function salvarEdicao(id: string) {
    try {
      await atualizarDestinatario(id, {
        nome: edicao.nome.trim(),
        email: edicao.email.trim(),
        documento: edicao.documento.trim() || null,
        observacao: edicao.observacao.trim() || null,
      })
      setEditandoId(null)
      toast({ title: 'Destinatário atualizado' })
      await carregarConta(contaId)
    } catch (e) {
      erro('Não deu para salvar', e)
    }
  }

  async function alternarAtivo(d: NfDestinatario) {
    try {
      await atualizarDestinatario(d.id, { ativo: !d.ativo })
      await carregarConta(contaId)
    } catch (e) {
      erro('Não deu para atualizar', e)
    }
  }

  // ——— Mensagem padrão ———
  const [salvandoConfig, setSalvandoConfig] = useState(false)
  const [previaDestinatarioId, setPreviaDestinatarioId] = useState('')
  const previaDestinatario = destinatariosAtivos.find((d) => d.id === previaDestinatarioId)
    ?? destinatariosAtivos[0] ?? null

  async function salvarConfigHandler() {
    setSalvandoConfig(true)
    try {
      await salvarConfig(contaId, config)
      toast({ title: 'Mensagem padrão salva' })
    } catch (e) {
      erro('Não deu para salvar a mensagem', e)
    } finally {
      setSalvandoConfig(false)
    }
  }

  // ——— Disparo do mês ———
  const inputArquivoRef = useRef<HTMLInputElement>(null)
  const [referencia, setReferencia] = useState(referenciaDoMes)
  const [arquivosDoLote, setArquivosDoLote] = useState<ArquivoDoLote[]>([])
  const [processandoArquivos, setProcessandoArquivos] = useState(false)
  const [dialogConferenciaAberto, setDialogConferenciaAberto] = useState(false)
  const [disparando, setDisparando] = useState(false)
  const [progressoDisparo, setProgressoDisparo] = useState<{ feitos: number; total: number } | null>(null)
  const [resumoUltimoDisparo, setResumoUltimoDisparo] =
    useState<{ ok: number; falhas: { para: string; motivo: string }[] } | null>(null)
  const [testando, setTestando] = useState(false)

  async function escolherArquivos(lista: FileList | null) {
    if (!lista?.length) return
    setProcessandoArquivos(true)
    setResumoUltimoDisparo(null)
    try {
      const ativos = destinatariosAtivos
      const novos: ArquivoDoLote[] = []
      for (const arquivo of Array.from(lista)) {
        const [base64, sha256] = await Promise.all([lerComoBase64(arquivo), calcularSha256(arquivo)])
        const sugestao = sugerirDestinatario(arquivo.name, ativos)
        novos.push({
          chave: crypto.randomUUID(),
          arquivo,
          base64,
          sha256,
          destinatarioId: null,
          sugestaoId: sugestao?.id ?? null,
        })
      }
      setArquivosDoLote((atuais) => [...atuais, ...novos])
    } catch (e) {
      erro('Não consegui ler um dos arquivos', e)
    } finally {
      setProcessandoArquivos(false)
    }
  }

  function removerArquivo(chave: string) {
    setArquivosDoLote((atuais) => atuais.filter((a) => a.chave !== chave))
  }

  function escolherDestinatario(chave: string, destinatarioId: string) {
    setArquivosDoLote((atuais) => atuais.map((a) => (a.chave === chave ? { ...a, destinatarioId } : a)))
  }

  const contagemPorDestinatario = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const a of arquivosDoLote) {
      if (!a.destinatarioId) continue
      mapa.set(a.destinatarioId, (mapa.get(a.destinatarioId) ?? 0) + 1)
    }
    return mapa
  }, [arquivosDoLote])

  const arquivosSemDono = arquivosDoLote.filter((a) => !a.destinatarioId)
  const arquivosGrandesDemais = arquivosDoLote.filter((a) => a.arquivo.size > LIMITE_ANEXO_BYTES)
  const destinatariosDuplicados = destinatariosAtivos.filter((d) => (contagemPorDestinatario.get(d.id) ?? 0) > 1)
  const destinatariosSemArquivo = arquivosDoLote.length > 0
    ? destinatariosAtivos.filter((d) => !(contagemPorDestinatario.get(d.id) ?? 0))
    : []

  const podeConferir = arquivosDoLote.length > 0
    && arquivosSemDono.length === 0
    && arquivosGrandesDemais.length === 0
    && config.assunto.trim() !== ''
    && config.corpo_html.trim() !== ''
    && Boolean(contaId)

  /**
   * Manda UM e-mail real para o PRÓPRIO endereço de quem está logado, usando o
   * primeiro par arquivo/destinatário já escolhido na tela. Existe para
   * conferir a mensagem e o anexo ANTES de qualquer coisa sair para cliente —
   * por isso não grava nada em `nf_envios`: não é um envio de produção.
   */
  async function enviarTesteParaMim() {
    if (!user?.email) return erro('Sem endereço para o teste', new Error('Seu perfil não tem e-mail.'))
    const alvo = arquivosDoLote.find((a) => a.destinatarioId)
    if (!alvo) return erro('Escolha um destinatário primeiro', new Error('Pareie ao menos um arquivo antes de testar.'))
    const dest = destinatarios.find((d) => d.id === alvo.destinatarioId)
    if (!dest) return
    setTestando(true)
    try {
      await sendEmail({
        account_id: contaId,
        to: [user.email],
        subject: `[TESTE] ${substituirMarcadores(config.assunto, dest)}`,
        body_html: substituirMarcadores(config.corpo_html, dest),
        anexos: [{ nome: alvo.arquivo.name, tipo: alvo.arquivo.type || 'application/pdf', base64: alvo.base64 }],
      })
      toast({
        title: `Teste enviado para ${user.email}`,
        description: `Usando "${alvo.arquivo.name}" com os dados de ${dest.nome}.`,
      })
    } catch (e) {
      erro('O teste falhou', e)
    } finally {
      setTestando(false)
    }
  }

  /**
   * Cria o lote, grava um `nf_envios` "pendente" por arquivo e só DEPOIS
   * dispara. Gravar antes é o que garante que fechar a aba no meio do envio
   * ainda deixe rastro de quem estava na fila.
   *
   * O casamento entre a linha gravada (que ganhou `id` no banco) e o arquivo em
   * memória é feito por uma CHAVE DE CONTEÚDO (destinatário+arquivo+hash), não
   * pela ordem de retorno do insert — a ordem de um `insert(...).select()` em
   * lote não é garantia da API, só coincidência de implementação.
   */
  async function confirmarEDisparar() {
    if (!podeConferir) return
    setDisparando(true)
    try {
      const lote = await criarLote(contaId, {
        referencia: referencia.trim() || null,
        assunto: config.assunto,
        corpo_html: config.corpo_html,
      })

      const chaveDe = (destinatarioId: string | null, nome: string, sha: string) => `${destinatarioId}__${nome}__${sha}`

      const itensParaGravar = arquivosDoLote.map((a) => {
        const dest = destinatarios.find((d) => d.id === a.destinatarioId)!
        return {
          destinatario_id: dest.id,
          para_email: dest.email,
          para_nome: dest.nome,
          arquivo_nome: a.arquivo.name,
          arquivo_tamanho: a.arquivo.size,
          arquivo_sha256: a.sha256,
        }
      })
      const enviosGravados = await criarEnvios(lote.id, contaId, itensParaGravar)
      await atualizarStatusLote(lote.id, 'enviando')

      const enviosPorChave = new Map(
        enviosGravados.map((e) => [chaveDe(e.destinatario_id, e.arquivo_nome, e.arquivo_sha256 ?? ''), e]),
      )

      const itensParaDisparar = arquivosDoLote.flatMap((a) => {
        const dest = destinatarios.find((d) => d.id === a.destinatarioId)
        const envio = enviosPorChave.get(chaveDe(a.destinatarioId, a.arquivo.name, a.sha256))
        if (!dest || !envio) return []
        return [{
          envioId: envio.id,
          destinatario: { nome: dest.nome, email: dest.email, documento: dest.documento },
          anexo: { nome: a.arquivo.name, tipo: a.arquivo.type || 'application/pdf', base64: a.base64 },
        }]
      })

      setProgressoDisparo({ feitos: 0, total: itensParaDisparar.length })
      const resultado = await dispararLote(
        contaId,
        { assunto: config.assunto, corpo_html: config.corpo_html },
        itensParaDisparar,
        (feitos, total) => setProgressoDisparo({ feitos, total }),
      )

      const statusFinal = resultado.ok === itensParaDisparar.length ? 'enviado' : 'parcial'
      await atualizarStatusLote(lote.id, statusFinal, new Date().toISOString())

      setResumoUltimoDisparo({
        ok: resultado.ok,
        falhas: resultado.falhas.map((f) => ({
          para: itensParaDisparar.find((i) => i.envioId === f.envioId)?.destinatario.email ?? '?',
          motivo: f.motivo,
        })),
      })

      if (resultado.falhas.length === 0) {
        toast({ title: `${resultado.ok} nota(s) enviada(s)`, description: 'Todo mundo desta leva recebeu.' })
      } else {
        // ⚠️ NUNCA "pronto" quando sobrou gente de fora — ver a regra igual em `marcarEmailsEmLote`.
        toast({
          title: `${resultado.ok} de ${itensParaDisparar.length} enviadas`,
          description: `${resultado.falhas.length} falharam. Veja o resumo e o Histórico antes de considerar concluído.`,
          variant: 'destructive',
        })
      }

      setArquivosDoLote([])
      setDialogConferenciaAberto(false)
      await carregarConta(contaId)
    } catch (e) {
      erro('O disparo não terminou', e)
    } finally {
      setDisparando(false)
      setProgressoDisparo(null)
    }
  }

  // ——— Histórico ———
  const [loteAberto, setLoteAberto] = useState<NfLote | null>(null)
  const [enviosDoLoteAberto, setEnviosDoLoteAberto] = useState<NfEnvio[]>([])
  const [carregandoEnvios, setCarregandoEnvios] = useState(false)

  async function abrirLote(l: NfLote) {
    setLoteAberto(l)
    setCarregandoEnvios(true)
    try {
      setEnviosDoLoteAberto(await getEnviosDoLote(l.id))
    } catch (e) {
      erro('Não deu para abrir o lote', e)
    } finally {
      setCarregandoEnvios(false)
    }
  }

  const corDoStatusLote = (s: NfLote['status']) =>
    s === 'enviado' ? 'default' : s === 'parcial' ? 'destructive' : s === 'cancelado' ? 'outline' : 'secondary'

  return (
    /*
      `h-full overflow-y-auto` não é enfeite: sem os dois esta tela não rola.
      O `Layout` liga `overflow-hidden` no `<main>` para TODA rota que começa
      com `/email` (`Layout.tsx:45-48`), porque a Caixa de Entrada é de altura
      fixa e cuida da própria rolagem, como o chat. `/email/notas-fiscais`
      entra nessa regra por tabela, mas é uma página COMPRIDA e comum.

      Resolvido aqui, e não no `Layout`: ele é arquivo de fronteira,
      compartilhado com outras janelas, e mudar a regra dele afetaria a Caixa
      de Entrada e as ferramentas embutidas. Assumir a própria rolagem é
      exatamente o que o `isFullBleed` espera da página.
    */
    <div className="mx-auto h-full max-w-5xl space-y-6 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notas Fiscais</h1>
          <p className="mt-1 text-muted-foreground">
            Lista de quem recebe nota, mensagem padrão e o disparo do mês.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/email"><ChevronLeft className="mr-1 h-4 w-4" />Voltar ao e-mail</Link>
        </Button>
      </div>

      {/* Aviso permanente — a razão da tela inteira existir. */}
      <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <strong>Esta ferramenta nasceu de uma nota fiscal enviada ao e-mail errado.</strong> Por isso o
          pareamento arquivo→cliente nunca acontece sozinho, e todo disparo passa por uma conferência
          antes de o botão de enviar existir de verdade.
        </div>
      </div>

      {contas.length > 1 && (
        <div className="max-w-xs space-y-1.5">
          <Label>Caixa</Label>
          <Select value={contaId} onValueChange={setContaId}>
            <SelectTrigger><SelectValue placeholder="Escolha a caixa" /></SelectTrigger>
            <SelectContent>
              {contas.map((a) => <SelectItem key={a.id} value={a.id}>{a.email}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !contaId ? (
        <p className="text-sm text-muted-foreground">Nenhuma caixa de e-mail cadastrada.</p>
      ) : (
        <Tabs defaultValue="destinatarios">
          <TabsList>
            <TabsTrigger value="destinatarios">Destinatários</TabsTrigger>
            <TabsTrigger value="mensagem">Mensagem padrão</TabsTrigger>
            <TabsTrigger value="disparo">Disparo do mês</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          {/* ——— (a) Destinatários ——— */}
          <TabsContent value="destinatarios" className="space-y-4">
            <GlassCard>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5" />Quem recebe nota
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Buscar por nome, e-mail ou documento…"
                  value={filtroDestinatarios}
                  onChange={(e) => setFiltroDestinatarios(e.target.value)}
                  className="max-w-sm"
                />

                <div className="space-y-2">
                  {destinatariosFiltrados.map((d) => (
                    editandoId === d.id ? (
                      <div key={d.id} className="grid gap-2 rounded-lg border p-3 md:grid-cols-4">
                        <Input value={edicao.nome} onChange={(e) => setEdicao((v) => ({ ...v, nome: e.target.value }))} placeholder="Nome" />
                        <Input value={edicao.email} onChange={(e) => setEdicao((v) => ({ ...v, email: e.target.value }))} placeholder="E-mail" />
                        <Input value={edicao.documento} onChange={(e) => setEdicao((v) => ({ ...v, documento: e.target.value }))} placeholder="CNPJ/CPF (opcional)" />
                        <Input value={edicao.observacao} onChange={(e) => setEdicao((v) => ({ ...v, observacao: e.target.value }))} placeholder="Observação" />
                        <div className="flex gap-2 md:col-span-4">
                          <Button size="sm" onClick={() => salvarEdicao(d.id)}><Check className="mr-1 h-4 w-4" />Salvar</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditandoId(null)}><X className="mr-1 h-4 w-4" />Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{d.nome}</span>
                            {!d.ativo && <Badge variant="outline">Inativo</Badge>}
                          </div>
                          <p className="truncate text-sm text-muted-foreground">
                            {d.email}{d.documento ? ` · ${d.documento}` : ''}
                          </p>
                          {d.observacao && <p className="truncate text-xs text-muted-foreground">{d.observacao}</p>}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => iniciarEdicao(d)}>
                            <Pencil className="mr-1 h-4 w-4" />Editar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => alternarAtivo(d)}>
                            {d.ativo ? 'Desativar' : 'Reativar'}
                          </Button>
                        </div>
                      </div>
                    )
                  ))}
                  {destinatariosFiltrados.length === 0 && (
                    <p className="text-sm text-muted-foreground">Ninguém encontrado.</p>
                  )}
                </div>

                <form onSubmit={adicionarDestinatario} className="grid gap-2 border-t pt-4 md:grid-cols-4">
                  <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome" required />
                  <Input value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} placeholder="E-mail" type="email" required />
                  <Input value={novoDocumento} onChange={(e) => setNovoDocumento(e.target.value)} placeholder="CNPJ/CPF (opcional)" />
                  <Input value={novaObs} onChange={(e) => setNovaObs(e.target.value)} placeholder="Observação (opcional)" />
                  <Button type="submit" className="md:col-span-4" disabled={salvandoDestinatario}>
                    <Plus className="mr-2 h-4 w-4" />{salvandoDestinatario ? 'Salvando…' : 'Adicionar destinatário'}
                  </Button>
                </form>
              </CardContent>
            </GlassCard>
          </TabsContent>

          {/* ——— (b) Mensagem padrão ——— */}
          <TabsContent value="mensagem" className="space-y-4">
            <GlassCard>
              <CardHeader><CardTitle className="text-lg">Mensagem padrão</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="nf-assunto">Assunto</Label>
                  <Input id="nf-assunto" value={config.assunto} onChange={(e) => setConfig((v) => ({ ...v, assunto: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nf-corpo">Corpo (HTML)</Label>
                  <Textarea id="nf-corpo" rows={8} value={config.corpo_html} onChange={(e) => setConfig((v) => ({ ...v, corpo_html: e.target.value }))} />
                  <p className="text-xs text-muted-foreground">
                    Marcadores aceitos: <code>{'{{nome}}'}</code> e <code>{'{{documento}}'}</code> — trocados
                    pelos dados de CADA destinatário na hora do envio.
                  </p>
                </div>
                <Button onClick={salvarConfigHandler} disabled={salvandoConfig}>
                  {salvandoConfig ? 'Salvando…' : 'Salvar mensagem padrão'}
                </Button>
              </CardContent>
            </GlassCard>

            <GlassCard>
              <CardHeader><CardTitle className="text-lg">Prévia</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="max-w-sm space-y-1.5">
                  <Label>Ver como ficaria para</Label>
                  <Select value={previaDestinatarioId} onValueChange={setPreviaDestinatarioId}>
                    <SelectTrigger><SelectValue placeholder="Escolha um destinatário real" /></SelectTrigger>
                    <SelectContent>
                      {destinatariosAtivos.map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {previaDestinatario ? (
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm"><strong>Assunto:</strong> {substituirMarcadores(config.assunto, previaDestinatario)}</p>
                    {/*
                      `dangerouslySetInnerHTML` aceitável pelo mesmo motivo do `EmailComposer`
                      (assinatura): é HTML do PRÓPRIO usuário, gravado em `nf_config` sob a RLS de
                      `pode_enviar_nf`, nunca conteúdo de terceiro.
                    */}
                    <div
                      className="overflow-x-auto rounded bg-white p-3 text-sm text-neutral-900"
                      dangerouslySetInnerHTML={{ __html: substituirMarcadores(config.corpo_html, previaDestinatario) }}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Cadastre ao menos um destinatário ativo para ver a prévia.</p>
                )}
              </CardContent>
            </GlassCard>
          </TabsContent>

          {/* ——— (c) Disparo do mês ——— */}
          <TabsContent value="disparo" className="space-y-4">
            <GlassCard>
              <CardHeader><CardTitle className="text-lg">1. Escolha os PDFs</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="nf-referencia">Referência do lote</Label>
                    <Input id="nf-referencia" className="w-40" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="2026-09" />
                  </div>
                  <input
                    ref={inputArquivoRef}
                    type="file"
                    accept="application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => { escolherArquivos(e.target.files); e.target.value = '' }}
                  />
                  <Button variant="outline" onClick={() => inputArquivoRef.current?.click()} disabled={processandoArquivos}>
                    {processandoArquivos ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    {processandoArquivos ? 'Lendo…' : 'Escolher PDFs'}
                  </Button>
                </div>

                {arquivosDoLote.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">2. Diga a quem pertence cada um</p>
                    {arquivosDoLote.map((a) => {
                      const grande = a.arquivo.size > LIMITE_ANEXO_BYTES
                      const sugestao = a.sugestaoId ? destinatarios.find((d) => d.id === a.sugestaoId) : null
                      return (
                        <div key={a.chave} className="space-y-2 rounded-lg border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{a.arquivo.name}</p>
                              <p className={grande ? 'text-xs font-semibold text-destructive' : 'text-xs text-muted-foreground'}>
                                {formatarBytes(a.arquivo.size)}
                                {grande ? ` — acima do limite de ${formatarBytes(LIMITE_ANEXO_BYTES)}, não pode ir` : ''}
                              </p>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => removerArquivo(a.chave)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <SeletorDestinatario
                            value={a.destinatarioId}
                            onChange={(id) => escolherDestinatario(a.chave, id)}
                            destinatarios={destinatariosAtivos}
                          />
                          {/*
                            A sugestão NUNCA pré-marca o seletor acima — ela só aparece como um
                            convite explícito. Enquanto ninguém clicar em "Usar", o arquivo continua
                            "sem dono" e bloqueia o envio. Ver `sugerirDestinatario` em `services/nf.ts`.
                          */}
                          {!a.destinatarioId && sugestao && (
                            <div className="flex flex-wrap items-center gap-2 rounded bg-muted px-2 py-1 text-xs">
                              <span>Sugestão: <strong>{sugestao.nome}</strong> — bate com o nome do arquivo.</span>
                              <Button type="button" size="sm" variant="secondary" className="h-6 px-2"
                                      onClick={() => escolherDestinatario(a.chave, sugestao.id)}>
                                Usar esta sugestão
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {arquivosDoLote.length > 0 && (
                  arquivosSemDono.length > 0 || arquivosGrandesDemais.length > 0
                  || destinatariosDuplicados.length > 0 || destinatariosSemArquivo.length > 0
                ) && (
                  <Alert variant={arquivosSemDono.length > 0 || arquivosGrandesDemais.length > 0 ? 'destructive' : 'default'}>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Antes de conferir</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc space-y-1 pl-4">
                        {arquivosSemDono.length > 0 && (
                          <li>{arquivosSemDono.length} arquivo(s) ainda sem destinatário escolhido.</li>
                        )}
                        {arquivosGrandesDemais.length > 0 && (
                          <li>{arquivosGrandesDemais.length} arquivo(s) acima de {formatarBytes(LIMITE_ANEXO_BYTES)} — remova ou comprima.</li>
                        )}
                        {destinatariosDuplicados.length > 0 && (
                          <li>{destinatariosDuplicados.map((d) => d.nome).join(', ')} receberia mais de um arquivo neste disparo — confira se é intencional.</li>
                        )}
                        {destinatariosSemArquivo.length > 0 && (
                          <li>{destinatariosSemArquivo.length} destinatário(s) ativo(s) não têm arquivo nesta leva (pode ser normal — é só um lembrete).</li>
                        )}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {arquivosDoLote.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    <Button variant="outline" onClick={enviarTesteParaMim} disabled={testando || !arquivosDoLote.some((a) => a.destinatarioId)}>
                      {testando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
                      Enviar teste para mim
                    </Button>
                    <Button onClick={() => setDialogConferenciaAberto(true)} disabled={!podeConferir}>
                      <Send className="mr-2 h-4 w-4" />Conferir e enviar ({arquivosDoLote.length})
                    </Button>
                  </div>
                )}

                {resumoUltimoDisparo && (
                  <Alert variant={resumoUltimoDisparo.falhas.length > 0 ? 'destructive' : 'default'}>
                    <AlertTitle>
                      {resumoUltimoDisparo.falhas.length === 0 ? 'Disparo concluído' : 'Disparo terminou com falhas'}
                    </AlertTitle>
                    <AlertDescription>
                      {resumoUltimoDisparo.ok} enviada(s){resumoUltimoDisparo.falhas.length > 0 ? ', e as que falharam:' : '.'}
                      {resumoUltimoDisparo.falhas.length > 0 && (
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          {resumoUltimoDisparo.falhas.map((f, i) => <li key={i}>{f.para}: {f.motivo}</li>)}
                        </ul>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </GlassCard>
          </TabsContent>

          {/* ——— Histórico ——— */}
          <TabsContent value="historico" className="space-y-4">
            <GlassCard>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <History className="h-5 w-5" />Disparos anteriores
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {lotes.length === 0 && <p className="text-sm text-muted-foreground">Nenhum disparo ainda.</p>}
                {lotes.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{l.referencia || new Date(l.criado_em).toLocaleDateString('pt-BR')}</span>
                        <Badge variant={corDoStatusLote(l.status)}>{l.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Criado em {new Date(l.criado_em).toLocaleString('pt-BR')}
                        {l.enviado_em ? ` · concluído em ${new Date(l.enviado_em).toLocaleString('pt-BR')}` : ''}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => abrirLote(l)}>
                      <MailIcon className="mr-1 h-4 w-4" />Ver para quem foi
                    </Button>
                  </div>
                ))}
              </CardContent>
            </GlassCard>
          </TabsContent>
        </Tabs>
      )}

      {/* ——— Diálogo de conferência: única porta para o envio de verdade ——— */}
      <Dialog open={dialogConferenciaAberto} onOpenChange={(a) => !disparando && setDialogConferenciaAberto(a)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Conferir antes de enviar</DialogTitle>
            <DialogDescription>
              {arquivosDoLote.length} nota(s). Esta é a última chance de notar um destinatário trocado.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {arquivosDoLote.map((a) => {
              const dest = destinatarios.find((d) => d.id === a.destinatarioId)
              return (
                <div key={a.chave} className="rounded-lg border p-2 text-sm">
                  <p className="truncate font-medium">{a.arquivo.name}</p>
                  <p className="truncate text-muted-foreground">
                    → {dest?.nome ?? '?'} → <span className="font-mono">{dest?.email ?? '?'}</span>
                  </p>
                </div>
              )
            })}
          </div>

          {destinatariosDuplicados.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Repetição</AlertTitle>
              <AlertDescription>
                {destinatariosDuplicados.map((d) => d.nome).join(', ')} vai receber mais de uma nota neste disparo.
              </AlertDescription>
            </Alert>
          )}

          {progressoDisparo && (
            <div className="space-y-1">
              <Progress value={(progressoDisparo.feitos / Math.max(progressoDisparo.total, 1)) * 100} />
              <p className="text-xs text-muted-foreground">{progressoDisparo.feitos} de {progressoDisparo.total}</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogConferenciaAberto(false)} disabled={disparando}>Cancelar</Button>
            <Button onClick={confirmarEDisparar} disabled={disparando || !podeConferir}>
              {disparando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {disparando ? 'Enviando…' : `Confirmar e enviar ${arquivosDoLote.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ——— Diálogo do histórico: "para onde essa nota foi?" ——— */}
      <Dialog open={loteAberto !== null} onOpenChange={(a) => !a && setLoteAberto(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{loteAberto?.referencia || 'Disparo'}</DialogTitle>
            <DialogDescription className="truncate">Assunto usado: {loteAberto?.assunto}</DialogDescription>
          </DialogHeader>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {carregandoEnvios && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
            {enviosDoLoteAberto.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {e.para_nome || '(sem nome)'} — <span className="font-mono">{e.para_email}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.arquivo_nome}{e.erro ? ` · ${e.erro}` : ''}
                  </p>
                </div>
                <Badge variant={e.status === 'enviado' ? 'default' : e.status === 'falhou' ? 'destructive' : 'outline'}>
                  {e.status}
                </Badge>
              </div>
            ))}
            {!carregandoEnvios && enviosDoLoteAberto.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum envio registrado neste lote.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
