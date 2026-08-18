import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  AlertTriangle,
  Download,
  FileText,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { ListRow } from '@/components/ui/list-row'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

import {
  MAX_EXAMES_SEM_APERTO,
  nomeDoPdf,
  resolverToken,
  slugDe,
  type Case,
  type DadosProposta,
  type Exame,
} from '@/lib/proposta/dados'
import { carregarPecas, montarHtml } from '@/lib/proposta/montar-html'
import { baixarBlob, gerarPdf, imprimir, temGeracaoDireta } from '@/lib/proposta/gerar-pdf'
import {
  carregarProposta,
  excluirProposta,
  listarPropostas,
  salvarProposta,
  type ItemHistorico,
} from '@/services/proposta_comercial'

const UNIDADES = ['exames', 'laudos']

const EXAME_NOVO: Exame = { sigla: '', nome: '', volume: '', unidade: 'exames', valor: '' }
const CASE_NOVO: Case = { cidade_uf: '', numero: '', unidade: '', descricao: '' }

/** Data por extenso, como o template espera: "09 de julho de 2026". */
const dataDeHoje = () => format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })

export default function PropostaComercial() {
  const { toast } = useToast()
  const direto = useMemo(temGeracaoDireta, [])

  const [nome, setNome] = useState('')
  const [cidadeUf, setCidadeUf] = useState('')
  const [artigo, setArtigo] = useState('o')
  const [cidadeEmissao, setCidadeEmissao] = useState('Joinville')
  const [data, setData] = useState(dataDeHoje)
  const [validade, setValidade] = useState('90 dias')
  const [exames, setExames] = useState<Exame[]>([{ ...EXAME_NOVO }])
  const [cases, setCases] = useState<Case[]>([])

  const [gerando, setGerando] = useState(false)
  const [historico, setHistorico] = useState<ItemHistorico[]>([])
  const [carregandoHistorico, setCarregandoHistorico] = useState(true)
  /** Blob URL do último PDF, para a pré-visualização. Só existe no Electron. */
  const [previaPdf, setPreviaPdf] = useState<string | null>(null)

  const atualizarHistorico = useCallback(() => {
    setCarregandoHistorico(true)
    listarPropostas()
      .then(setHistorico)
      .catch((e: Error) =>
        toast({ variant: 'destructive', title: 'Não consegui ler o histórico', description: e.message }),
      )
      .finally(() => setCarregandoHistorico(false))
  }, [toast])

  useEffect(atualizarHistorico, [atualizarHistorico])

  // Libera o blob da prévia ao trocar de PDF e ao sair da tela — sem isso cada
  // geração deixa um PDF de vários MB preso na memória da aba. A limpeza mora
  // SÓ aqui: revogar dentro do `setPreviaPdf` tornaria o updater impuro, e o
  // StrictMode o executa duas vezes.
  useEffect(() => {
    return () => {
      if (previaPdf) URL.revokeObjectURL(previaPdf)
    }
  }, [previaPdf])

  const dados = useMemo<DadosProposta>(
    () => ({
      slug: slugDe(nome),
      cliente: { nome: nome.trim(), cidade_uf: cidadeUf, artigo },
      proposta: { cidade_emissao: cidadeEmissao, data, validade },
      exames,
      cases,
    }),
    [nome, cidadeUf, artigo, cidadeEmissao, data, validade, exames, cases],
  )

  const preencherCom = (p: DadosProposta) => {
    setNome(p.cliente.nome)
    setCidadeUf(p.cliente.cidade_uf)
    setArtigo(p.cliente.artigo)
    setCidadeEmissao(p.proposta.cidade_emissao)
    setData(p.proposta.data)
    setValidade(p.proposta.validade)
    setExames(p.exames.length ? p.exames : [{ ...EXAME_NOVO }])
    setCases(p.cases)
  }

  const abrirDoHistorico = async (slug: string) => {
    try {
      const p = await carregarProposta(slug)
      if (!p) {
        toast({ variant: 'destructive', title: 'Proposta não encontrada.' })
        return
      }
      preencherCom(p)
      toast({ title: `Proposta de ${p.cliente.nome} carregada.` })
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Não consegui abrir a proposta',
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const remover = async (slug: string) => {
    try {
      await excluirProposta(slug)
      setHistorico((h) => h.filter((i) => i.slug !== slug))
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Não consegui excluir',
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const gerar = async () => {
    if (!dados.cliente.nome) {
      toast({ variant: 'destructive', title: 'Informe o nome do cliente.' })
      return
    }
    if (!dados.exames.some((e) => e.sigla || e.nome)) {
      toast({ variant: 'destructive', title: 'Inclua ao menos um exame.' })
      return
    }

    setGerando(true)
    try {
      // `{cliente}` nos textos dos cases vira o nome do cliente ANTES de montar
      // o HTML — o template não conhece o token.
      const resolvidos = resolverToken(dados, dados.cliente.nome)
      const pecas = await carregarPecas()
      const html = montarHtml(resolvidos, pecas)

      if (direto) {
        const blob = await gerarPdf(html)
        baixarBlob(blob, nomeDoPdf(dados.cliente.nome))
        setPreviaPdf(URL.createObjectURL(blob))
        toast({ title: 'PDF gerado e baixado.' })
      } else {
        await imprimir(html)
        toast({
          title: 'Caixa de impressão aberta.',
          description: 'Escolha "Salvar como PDF" para baixar a proposta.',
        })
      }

      // Salvar depois de gerar, e não antes: proposta que nem chegou a virar PDF
      // não deveria aparecer no histórico da equipe.
      await salvarProposta(resolvidos)
      atualizarHistorico()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Não consegui gerar a proposta',
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setGerando(false)
    }
  }

  const mudarExame = (i: number, campo: keyof Exame, valor: string) =>
    setExames((atual) => atual.map((e, j) => (i === j ? { ...e, [campo]: valor } : e)))

  const mudarCase = (i: number, campo: keyof Case, valor: string) =>
    setCases((atual) => atual.map((c, j) => (i === j ? { ...c, [campo]: valor } : c)))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight">Proposta Comercial</h1>
        <p className="text-sm text-muted-foreground mt-1">
          13 slides em PDF, com a volumetria e os cases do cliente.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px] items-start">
        <div className="space-y-5">
          <GlassCard>
            <CardContent className="pt-6 space-y-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Dados da proposta
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="p-nome">Nome do cliente</Label>
                  <Input
                    id="p-nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Hospital São Donato"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-cidade">Cidade / UF</Label>
                  <Input
                    id="p-cidade"
                    value={cidadeUf}
                    onChange={(e) => setCidadeUf(e.target.value)}
                    placeholder="Içara/SC"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-artigo">Artigo</Label>
                  <Select value={artigo} onValueChange={setArtigo}>
                    <SelectTrigger id="p-artigo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="o">o (Hospital)</SelectItem>
                      <SelectItem value="a">a (Clínica)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-emissao">Cidade de emissão</Label>
                  <Input
                    id="p-emissao"
                    value={cidadeEmissao}
                    onChange={(e) => setCidadeEmissao(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-data">Data da proposta</Label>
                  <Input id="p-data" value={data} onChange={(e) => setData(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-validade">Validade</Label>
                  <Input
                    id="p-validade"
                    value={validade}
                    onChange={(e) => setValidade(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </GlassCard>

          <GlassCard>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Exames
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setExames((a) => [...a, { ...EXAME_NOVO }])}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Exame
                </Button>
              </div>

              {exames.length > MAX_EXAMES_SEM_APERTO && (
                <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    {exames.length} exames — o slide 4 põe os mini-cards numa linha só e foi
                    desenhado para até {MAX_EXAMES_SEM_APERTO}. Confira o PDF antes de enviar.
                  </span>
                </div>
              )}

              {exames.map((e, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[80px_1fr_90px_110px_100px_36px] items-end">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Sigla</Label>
                    <Input value={e.sigla} onChange={(x) => mudarExame(i, 'sigla', x.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Nome (tabela)</Label>
                    <Input value={e.nome} onChange={(x) => mudarExame(i, 'nome', x.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Volume</Label>
                    <Input value={e.volume} onChange={(x) => mudarExame(i, 'volume', x.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Unidade</Label>
                    <Select value={e.unidade} onValueChange={(v) => mudarExame(i, 'unidade', v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIDADES.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Valor (R$)</Label>
                    <Input value={e.valor} onChange={(x) => mudarExame(i, 'valor', x.target.value)} />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setExames((a) => a.filter((_, j) => j !== i))}
                    aria-label="Remover exame"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </GlassCard>

          <GlassCard>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Cases (resultados reais)
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Use <code>{'{cliente}'}</code> na descrição para inserir o nome do cliente.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCases((a) => [...a, { ...CASE_NOVO }])}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Case
                </Button>
              </div>

              {cases.map((c, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_90px_140px_36px] items-end">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Cidade — UF</Label>
                    <Input value={c.cidade_uf} onChange={(x) => mudarCase(i, 'cidade_uf', x.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Número</Label>
                    <Input value={c.numero} onChange={(x) => mudarCase(i, 'numero', x.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Unidade</Label>
                    <Input value={c.unidade} onChange={(x) => mudarCase(i, 'unidade', x.target.value)} />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setCases((a) => a.filter((_, j) => j !== i))}
                    aria-label="Remover case"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <div className="space-y-1 sm:col-span-4">
                    <Label className="text-[11px]">Descrição</Label>
                    <Input value={c.descricao} onChange={(x) => mudarCase(i, 'descricao', x.target.value)} />
                  </div>
                </div>
              ))}
              {cases.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum case. O slide 12 fica sem a faixa de resultados.
                </p>
              )}
            </CardContent>
          </GlassCard>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={gerar} disabled={gerando} size="lg">
              {gerando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : direto ? (
                <Download className="h-4 w-4" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              {direto ? 'Gerar PDF' : 'Gerar e imprimir'}
            </Button>
            <p className="text-xs text-muted-foreground max-w-md">
              {direto
                ? `O arquivo baixa como "${nomeDoPdf(dados.cliente.nome || 'CLIENTE')}".`
                : 'No navegador não dá para salvar o PDF sozinho: a caixa de impressão abre e você escolhe "Salvar como PDF". No app instalado o download é direto.'}
            </p>
          </div>

          {previaPdf && (
            // Vidro só no `Card` — o `<iframe>` é o visualizador de PDF nativo
            // do navegador/Electron, conteúdo dele não é nosso pra estilizar.
            <GlassCard>
              <CardContent className="p-2">
                <iframe
                  src={previaPdf}
                  title="Pré-visualização da proposta"
                  className="w-full h-[560px] rounded-md border-0"
                />
              </CardContent>
            </GlassCard>
          )}
        </div>

        <GlassCard>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Histórico
              </p>
              <Button size="sm" variant="ghost" onClick={atualizarHistorico} disabled={carregandoHistorico}>
                <RefreshCw className={carregandoHistorico ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              </Button>
            </div>

            {carregandoHistorico && historico.length === 0 && (
              <p className="text-xs text-muted-foreground">Carregando...</p>
            )}
            {!carregandoHistorico && historico.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhuma proposta gerada ainda. As que você gerar aparecem aqui para a equipe toda.
              </p>
            )}

            {/* `divide-y` virou `ListRow`: cada linha tem DOIS alvos de clique
                (abrir / excluir), então a linha continua `<div>` — um `ListRow`
                com `onClick` viraria `<button>` e um `<button>` dentro de
                `<button>` é HTML inválido. */}
            <div className="space-y-0.5">
              {historico.map((item) => (
                <ListRow key={item.slug}>
                  <button
                    type="button"
                    onClick={() => abrirDoHistorico(item.slug)}
                    className="flex-1 text-left min-w-0 group"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium truncate group-hover:text-primary transition-colors">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {item.clienteNome}
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5 truncate">
                      {item.clienteCidadeUf} ·{' '}
                      {format(new Date(item.atualizadoEm), "dd/MM/yyyy 'às' HH:mm")}
                    </span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remover(item.slug)}
                    aria-label={`Excluir proposta de ${item.clienteNome}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </ListRow>
              ))}
            </div>
          </CardContent>
        </GlassCard>
      </div>
    </div>
  )
}
