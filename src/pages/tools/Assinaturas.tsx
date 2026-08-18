import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, Loader2, MousePointerClick } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { carregarAssets, type AssetsAssinatura } from '@/lib/assinaturas/assets'
import { montarSVG } from '@/lib/assinaturas/conceitos'
import { htmlClicavel, htmlDaImagem } from '@/lib/assinaturas/html-clicavel'
import { baixar, copiarHTML, rasterizar } from '@/lib/assinaturas/rasterizar'
import { nomeDoArquivo, semAcento, type DadosAssinatura } from '@/lib/assinaturas/comuns'
import {
  APELIDOS_MARCA,
  CHAVES_MARCA,
  CONCEITOS,
  MARCAS,
  type ChaveConceito,
  type ChaveMarca,
} from '@/lib/assinaturas/marcas'

const LOTE_EXEMPLO = [
  'prn; Renata Albuquerque; Administrativo; 47 99137-8313; suportelaudos@prndiagnosticos.com.br',
  'med; Nome Sobrenome; Recepção; 47 99112-0419; recepcao@clinicamedimagem.com',
  'locacao; Nome Sobrenome; Comercial; 47 99112-0419; prnlocacaoegestao@hotmail.com',
].join('\n')

/** `Renata Albuquerque` + PRN -> `renata.albuquerque@prndiagnosticos.com.br`. */
function sugerirEmail(nome: string, marca: ChaveMarca): string {
  const partes = semAcento(nome).trim().toLowerCase().split(/\s+/).filter(Boolean)
  const usuario = partes.length > 1 ? `${partes[0]}.${partes[partes.length - 1]}` : partes[0] || 'nome'
  return usuario.replace(/[^a-z0-9.]/g, '') + '@' + MARCAS[marca].emailDom
}

/** O SVG desenhado direto no DOM. É preview: nunca vira o PNG copiado. */
function Preview({ svg, className }: { svg: string; className?: string }) {
  return (
    <div
      className={cn('[&>svg]:block [&>svg]:h-auto [&>svg]:max-w-full', className)}
      // O SVG é montado por nós a partir de campos já escapados por `esc()` em
      // `comuns.ts` — nada digitado chega cru ao markup.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default function Assinaturas() {
  const { toast } = useToast()
  const [assets, setAssets] = useState<AssetsAssinatura | null>(null)
  const [erroAssets, setErroAssets] = useState<string | null>(null)

  const [conceito, setConceito] = useState<ChaveConceito>('vidro')
  const [marca, setMarca] = useState<ChaveMarca>('prn-diagnosticos')
  const [nome, setNome] = useState('Renata Albuquerque')
  const [cargo, setCargo] = useState('Administrativo')
  const [telefone, setTelefone] = useState(MARCAS['prn-diagnosticos'].telefone)
  const [email, setEmail] = useState('suportelaudos@prndiagnosticos.com.br')
  const [endereco, setEndereco] = useState(MARCAS['prn-diagnosticos'].endereco)
  const [mostrarEmpresa, setMostrarEmpresa] = useState(true)
  /**
   * Enquanto for `false`, digitar o nome reescreve o e-mail sugerido. Vira
   * `true` no primeiro toque no campo de e-mail e nunca mais volta — quem
   * digitou um endereço à mão não pode vê-lo sumir ao corrigir o sobrenome.
   */
  const emailTocado = useRef(false)

  const [lote, setLote] = useState(LOTE_EXEMPLO)
  const [pessoasDoLote, setPessoasDoLote] = useState<DadosAssinatura[]>([])
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    carregarAssets()
      .then(setAssets)
      .catch((e: Error) => setErroAssets(e.message))
  }, [])

  const dados = useMemo<DadosAssinatura>(
    () => ({
      conceito,
      marca,
      nome: nome || 'Nome Sobrenome',
      cargo,
      telefone,
      email,
      endereco,
      empresa: mostrarEmpresa,
    }),
    [conceito, marca, nome, cargo, telefone, email, endereco, mostrarEmpresa],
  )

  const svg = useMemo(() => (assets ? montarSVG(dados, assets) : ''), [dados, assets])

  const trocarMarca = (nova: ChaveMarca) => {
    setMarca(nova)
    // Telefone e endereço são da empresa, não da pessoa: trocar de marca repõe
    // os dois pelo padrão da nova, como no gerador original.
    setTelefone(MARCAS[nova].telefone)
    setEndereco(MARCAS[nova].endereco)
    if (!emailTocado.current) setEmail(sugerirEmail(nome, nova))
  }

  const trocarNome = (novo: string) => {
    setNome(novo)
    if (!emailTocado.current) setEmail(sugerirEmail(novo, marca))
  }

  /** Envolve as ações assíncronas: trava o botão e transforma erro em toast. */
  const executar = useCallback(
    async (acao: () => Promise<void>, sucesso: string) => {
      if (!assets) return
      setOcupado(true)
      try {
        await acao()
        toast({ title: sucesso })
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'Não deu certo',
          description: e instanceof Error ? e.message : String(e),
        })
      } finally {
        setOcupado(false)
      }
    },
    [assets, toast],
  )

  const copiarImagem = (d: DadosAssinatura) =>
    executar(async () => {
      const { url, largura } = await rasterizar(montarSVG(d, assets!))
      await copiarHTML(htmlDaImagem(url, largura, d, MARCAS[d.marca].nome))
    }, 'Assinatura copiada. Cole no e-mail com Ctrl + V.')

  const baixarPNG = (d: DadosAssinatura) =>
    executar(async () => {
      const { url } = await rasterizar(montarSVG(d, assets!))
      baixar(url, nomeDoArquivo(d.nome))
    }, 'PNG baixado.')

  const copiarClicavel = () =>
    executar(
      () => copiarHTML(htmlClicavel(dados, assets!)),
      'Versão clicável copiada. Cole com Ctrl + V.',
    )

  const gerarLote = () => {
    const pessoas = lote
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((linha): DadosAssinatura => {
        const p = linha.split(';').map((s) => s.trim())
        const chave = APELIDOS_MARCA[semAcento(p[0] || '').toLowerCase()] || 'prn-diagnosticos'
        const m = MARCAS[chave]
        return {
          conceito,
          marca: chave,
          nome: p[1] || '',
          cargo: p[2] || '',
          telefone: p[3] || m.telefone,
          email: p[4] || '',
          endereco: m.endereco,
          empresa: mostrarEmpresa,
        }
      })
    setPessoasDoLote(pessoas)
  }

  if (erroAssets) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center">
        <p className="text-destructive text-sm font-medium">
          Não consegui carregar as marcas e as fontes das assinaturas.
        </p>
        <p className="text-muted-foreground text-xs max-w-md">{erroAssets}</p>
        <Button onClick={() => window.location.reload()}>Recarregar</Button>
      </div>
    )
  }

  if (!assets) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight">Assinaturas de e-mail</h1>
        <p className="text-sm text-muted-foreground mt-1">
          PRN Diagnósticos · MedImagem · PRN Locação e Gestão
        </p>
      </div>

      <Tabs defaultValue="uma">
        <TabsList>
          <TabsTrigger value="uma">Uma pessoa</TabsTrigger>
          <TabsTrigger value="lote">Vários de uma vez</TabsTrigger>
        </TabsList>

        <TabsContent value="uma" className="mt-4">
          <div className="grid gap-5 lg:grid-cols-[340px_1fr] items-start">
            <Card>
              <CardContent className="pt-6 space-y-5">
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Conceito
                  </p>
                  {CONCEITOS.map((c) => (
                    <button
                      key={c.chave}
                      type="button"
                      onClick={() => setConceito(c.chave)}
                      className={cn(
                        'w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors',
                        conceito === c.chave
                          ? 'border-primary bg-accent ring-1 ring-primary'
                          : 'border-border hover:bg-accent/50',
                      )}
                    >
                      {c.rotulo}
                      <span className="block text-[11px] text-muted-foreground mt-0.5">
                        {c.descricao}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Empresa
                  </p>
                  {CHAVES_MARCA.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => trocarMarca(k)}
                      className={cn(
                        'w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors',
                        marca === k
                          ? 'border-primary bg-accent ring-1 ring-primary'
                          : 'border-border hover:bg-accent/50',
                      )}
                    >
                      {MARCAS[k].rotulo}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Dados
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="a-nome">Nome completo</Label>
                    <Input id="a-nome" value={nome} onChange={(e) => trocarNome(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="a-cargo">Cargo / setor</Label>
                    <Input id="a-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="a-tel">Telefone</Label>
                    <Input id="a-tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="a-email">E-mail</Label>
                    <Input
                      id="a-email"
                      value={email}
                      onChange={(e) => {
                        emailTocado.current = true
                        setEmail(e.target.value)
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="a-end">Endereço</Label>
                    <Textarea
                      id="a-end"
                      rows={2}
                      value={endereco}
                      onChange={(e) => setEndereco(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox
                      id="a-empresa"
                      checked={mostrarEmpresa}
                      onCheckedChange={(v) => setMostrarEmpresa(v === true)}
                    />
                    <Label htmlFor="a-empresa" className="font-normal">
                      Mostrar o nome da empresa
                    </Label>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button onClick={() => copiarImagem(dados)} disabled={ocupado}>
                    {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                    Copiar assinatura
                  </Button>
                  <Button variant="outline" onClick={() => baixarPNG(dados)} disabled={ocupado}>
                    <Download className="h-4 w-4" />
                    Baixar PNG
                  </Button>
                  <Button variant="outline" onClick={copiarClicavel} disabled={ocupado}>
                    <MousePointerClick className="h-4 w-4" />
                    Copiar versão clicável
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <b>Copiar assinatura</b> leva a imagem exatamente como aparece ao lado. A{' '}
                  <b>versão clicável</b> troca por texto de verdade com links — mais funcional, porém
                  sem sombra e sem a fonte Poppins, que o Outlook não carrega.
                </p>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardContent className="p-2 overflow-auto">
                  <Preview svg={svg} />
                </CardContent>
              </Card>

              <Accordion type="single" collapsible>
                <AccordionItem value="instalar" className="border rounded-lg px-4">
                  <AccordionTrigger className="text-sm">
                    Como instalar no Outlook e no Gmail
                  </AccordionTrigger>
                  <AccordionContent>
                    <ol className="list-decimal ml-4 space-y-2 text-sm text-muted-foreground">
                      <li>
                        <b>Outlook (aplicativo):</b> <code>Nova mensagem</code> →{' '}
                        <code>Assinatura</code> → <code>Assinaturas…</code> → <code>Nova</code>,
                        clique na caixa de edição e cole com <code>Ctrl + V</code>.
                      </li>
                      <li>
                        <b>Outlook na web:</b> engrenagem → <code>Email</code> →{' '}
                        <code>Redigir e responder</code> → cole e salve.
                      </li>
                      <li>
                        <b>Gmail:</b> engrenagem → <code>Ver todas as configurações</code> → aba{' '}
                        <code>Geral</code> → <code>Assinatura</code> → <code>Criar nova</code> → cole
                        e salve no final da página.
                      </li>
                      <li>
                        Cole com <code>Ctrl + V</code> normal, nunca "colar sem formatação".
                      </li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="lote" className="mt-4 space-y-5">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Uma pessoa por linha
              </p>
              <p className="text-xs text-muted-foreground">
                Formato: <code>marca; nome; cargo; telefone; e-mail</code> — marca pode ser{' '}
                <code>prn</code>, <code>med</code> ou <code>locacao</code>. Usa o conceito escolhido
                na outra aba.
              </p>
              <Textarea
                rows={6}
                className="font-mono text-xs"
                value={lote}
                onChange={(e) => setLote(e.target.value)}
              />
              <Button onClick={gerarLote}>Gerar assinaturas</Button>
            </CardContent>
          </Card>

          {pessoasDoLote.length > 0 && (
            <Card>
              <CardContent className="pt-6 divide-y">
                {pessoasDoLote.map((p, i) => (
                  <div key={`${p.nome}-${i}`} className="py-5 first:pt-0">
                    <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {p.nome || '(sem nome)'} — {MARCAS[p.marca].rotulo}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copiarImagem(p)}
                          disabled={ocupado}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copiar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => baixarPNG(p)}
                          disabled={ocupado}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Baixar PNG
                        </Button>
                      </div>
                    </div>
                    <div className="overflow-auto">
                      <Preview svg={montarSVG(p, assets)} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
