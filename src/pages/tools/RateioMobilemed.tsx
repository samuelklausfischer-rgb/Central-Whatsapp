import { useRef, useState, type ReactNode } from 'react'
import { Loader2, UploadCloud, Download, FileSpreadsheet, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { GlassCard } from '@/components/ui/surface'
import { ListRow } from '@/components/ui/list-row'
import { useToast } from '@/hooks/use-toast'
import { FinanceiroAuthProvider, useFinanceiroAuth } from '@/contexts/financeiro-auth-context'
import { useRateioUpload, useRateioHistorico } from '@/hooks/use-rateio'
import { RateioHistoricoPanel } from '@/components/rateio/RateioHistoricoPanel'
import { fmt, fmtNum, valorNumerico, baixarBase64 } from '@/lib/rateio/format'
import { deleteRateioExecucao, type RateioEmpresa } from '@/services/rateio/rateio-service'

const EMPRESAS: { key: RateioEmpresa; label: string }[] = [
  { key: 'PRN', label: 'PRN' },
  { key: 'PRN_APICE', label: 'PRN / Apice Tele' },
  { key: 'MEDIMAGEM', label: 'MedImagem' },
  { key: 'MEDIMAGEM_APICE', label: 'MedImagem / Apice Tele' },
]

const TAXA_LABELS: Record<string, string> = {
  PORTAL: 'Portal',
  INTEGRACAO: 'Integração',
  SERVIDOR: 'Servidor',
  ROBO: 'Robô',
  STORAGE: 'Storage',
  ADICIONAL: 'Adicional de horas',
}

function FinanceiroLoginGate({ children }: { children: ReactNode }) {
  const { user, loading, error, retry } = useFinanceiroAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 gap-4">
        <p className="text-destructive text-sm font-medium text-center max-w-sm">
          {error || 'Não foi possível liberar seu acesso ao módulo financeiro.'}
        </p>
        <Button onClick={retry}>Tentar novamente</Button>
      </div>
    )
  }

  return <>{children}</>
}

// Linha do formulário de serviço adicional. `valor` fica como texto enquanto o
// usuário digita; só vira número na hora de enviar.
type LinhaAdicional = { nome: string; valor: string }

const LINHA_ADICIONAL_VAZIA: LinhaAdicional = { nome: '', valor: '' }

function RateioInner() {
  const [empresa, setEmpresa] = useState<RateioEmpresa>('PRN')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const [adicionais, setAdicionais] = useState<LinhaAdicional[]>([{ ...LINHA_ADICIONAL_VAZIA }])
  const inputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const { processar, enviando, status, erro, resultado } = useRateioUpload()
  const { historico, loading: carregandoHistorico, error: erroHistorico, refetch } = useRateioHistorico(empresa)

  function selecionarArquivo(f: File | null | undefined) {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      toast({ title: 'Selecione um arquivo .xlsx', variant: 'destructive' })
      return
    }
    setArquivo(f)
  }

  function atualizarAdicional(i: number, campo: keyof LinhaAdicional, valor: string) {
    setAdicionais((atual) => atual.map((a, idx) => (idx === i ? { ...a, [campo]: valor } : a)))
  }

  function adicionarLinhaAdicional() {
    setAdicionais((atual) => [...atual, { ...LINHA_ADICIONAL_VAZIA }])
  }

  function removerLinhaAdicional(i: number) {
    setAdicionais((atual) => (atual.length > 1 ? atual.filter((_, idx) => idx !== i) : atual))
  }

  // Só sobe o que tem valor > 0. Linha em branco é o estado normal (campo opcional).
  const adicionaisValidos = adicionais
    .map((a) => ({ nome: a.nome.trim(), valor: valorNumerico(a.valor) }))
    .filter((a) => a.valor > 0)

  const totalAdicionais = adicionaisValidos.reduce((s, a) => s + a.valor, 0)

  async function handleGerar() {
    if (!arquivo || enviando) return
    try {
      await processar(arquivo, empresa, adicionaisValidos)
      refetch()
    } catch {
      // erro já fica exposto pelo hook (erro/status) — nada mais a fazer aqui
    }
  }

  function handleBaixarAtual() {
    if (!resultado?.arquivo) return
    baixarBase64(resultado.arquivo.nome, resultado.arquivo.mime, resultado.arquivo.base64)
  }

  async function handleDeleteHistorico(id: string) {
    try {
      await deleteRateioExecucao(id)
      toast({ title: 'Sucesso', description: 'Rateio excluído do histórico.' })
      refetch()
    } catch (err) {
      toast({
        title: 'Erro',
        description: (err as Error).message || 'Não foi possível excluir o rateio.',
        variant: 'destructive',
      })
    }
  }

  const r = resultado?.resumo
  const pendencias = resultado?.pendencias || []

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 overflow-y-auto p-6">
        <header className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Rateio Mobilemed</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Suba o relatório <span className="font-medium text-foreground">Bruto.xlsx</span> exportado da
            Mobilemed para gerar o rateio por unidade — inclui todos os exames, sem filtro.
          </p>
        </header>

        {/* Caixa de upload — vidro no lugar de `bg-card` sólido, seguindo o
            idioma da home. O dropzone logo abaixo continua com seus próprios
            estados de borda (arrastando/hover): vidro só na moldura externa. */}
        <GlassCard className="p-5">
          <div className="mb-4">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Empresa
            </span>
            <div className="grid w-fit grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-0.5">
              {EMPRESAS.map((e) => (
                <button
                  key={e.key}
                  onClick={() => setEmpresa(e.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                    empresa === e.key
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setArrastando(true)
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => {
              e.preventDefault()
              setArrastando(false)
              selecionarArquivo(e.dataTransfer.files[0])
            }}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              arrastando ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30'
            }`}
          >
            <UploadCloud className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Clique ou arraste o Bruto.xlsx aqui</p>
            <p className="mt-1 text-xs text-muted-foreground">arquivo .xlsx exportado da Mobilemed</p>
            {arquivo && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {arquivo.name} ({(arquivo.size / 1048576).toFixed(1)} MB)
              </p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => selecionarArquivo(e.target.files?.[0])}
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Serviço adicional <span className="normal-case">(opcional)</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={adicionarLinhaAdicional}
                className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
              >
                <Plus className="h-3.5 w-3.5" />
                adicionar serviço
              </Button>
            </div>

            <div className="space-y-2">
              {adicionais.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={a.nome}
                    onChange={(e) => atualizarAdicional(i, 'nome', e.target.value)}
                    placeholder="Nome do serviço (ex.: horas extras de setembro)"
                    className="min-w-0 flex-1"
                  />
                  <Input
                    inputMode="decimal"
                    value={a.valor}
                    onChange={(e) => atualizarAdicional(i, 'valor', e.target.value)}
                    placeholder="Valor total"
                    className="w-32 shrink-0 text-right"
                  />
                  {adicionais.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Remover serviço ${i + 1}`}
                      onClick={() => removerLinhaAdicional(i)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-1.5 text-xs text-muted-foreground">
              {totalAdicionais > 0
                ? `${fmt(totalAdicionais)} será dividido igualmente entre as unidades cadastradas e ativas de ${
                    EMPRESAS.find((e) => e.key === empresa)?.label || empresa
                  }.`
                : 'Se preenchido, o valor é dividido igualmente entre as unidades cadastradas e ativas da empresa selecionada.'}
            </p>
          </div>

          <Button
            onClick={handleGerar}
            disabled={!arquivo || enviando}
            className="mt-4 w-full h-11 font-semibold"
          >
            {enviando ? 'Processando…' : 'Gerar rateio'}
          </Button>

          {status && !erro && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              {enviando && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
              {status}
            </p>
          )}
          {erro && <p className="mt-3 text-xs font-medium text-destructive">Erro: {erro}</p>}
        </GlassCard>

        {r && (
          <section className="mt-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <GlassCard>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Total do rateio
                  </p>
                  <p className="mt-1 text-4xl font-bold text-foreground">{fmt(r.total_geral)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {EMPRESAS.find((e) => e.key === r.empresa)?.label || r.empresa}
                  </p>
                </CardContent>
              </GlassCard>
              <GlassCard>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Exames (variável)
                  </p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{fmt(r.total_variavel)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmtNum(r.total_exames)} exames</p>
                </CardContent>
              </GlassCard>
              <GlassCard>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Taxas fixas</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{fmt(r.total_encargos)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmtNum(r.n_unidades)} unidades</p>
                </CardContent>
              </GlassCard>
            </div>

            <GlassCard className="p-5">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Detalhamento das taxas fixas</h3>
              {/* Grade de taxas trocou `border-b` por `ListRow`: sem linha
                  entre itens, só o respiro e o hover — mesmo idioma da home. */}
              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-3">
                {Object.entries(r.totais_taxa || {}).map(([tipo, valor]) => (
                  <ListRow key={tipo} className="justify-between">
                    <span className="text-sm text-muted-foreground">{TAXA_LABELS[tipo] || tipo}</span>
                    <span className="text-sm font-medium text-foreground">{fmt(valor)}</span>
                  </ListRow>
                ))}
              </div>

              {(r.adicionais || []).length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Serviços adicionais informados
                    {r.adicional_n_unidades
                      ? ` · rateados entre ${fmtNum(r.adicional_n_unidades)} unidades`
                      : ''}
                  </p>
                  {(r.adicionais || []).map((a, i) => (
                    <ListRow key={i} className="justify-between">
                      <span className="text-sm text-muted-foreground">{a.nome}</span>
                      <span className="text-sm font-medium text-foreground">{fmt(a.valor)}</span>
                    </ListRow>
                  ))}
                </div>
              )}
            </GlassCard>

            {pendencias.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
                <h3 className="mb-2 text-sm font-semibold text-amber-600">
                  ⚠ {pendencias.length} pendência{pendencias.length > 1 ? 's' : ''} — revise o cadastro
                </h3>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-amber-600/90">
                  {pendencias.map((p, i) => (
                    <li key={i}>
                      • <span className="font-medium">{p.tipo}</span>: {p.referencia}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              variant="outline"
              onClick={handleBaixarAtual}
              className="w-full h-11 font-semibold gap-2"
            >
              <Download className="h-4 w-4" />
              Baixar {resultado?.arquivo?.nome}
            </Button>
          </section>
        )}
      </div>

      <RateioHistoricoPanel
        historico={historico}
        loading={carregandoHistorico}
        error={erroHistorico}
        onDelete={handleDeleteHistorico}
      />
    </div>
  )
}

export default function RateioMobilemed() {
  return (
    <FinanceiroAuthProvider>
      <FinanceiroLoginGate>
        <RateioInner />
      </FinanceiroLoginGate>
    </FinanceiroAuthProvider>
  )
}
