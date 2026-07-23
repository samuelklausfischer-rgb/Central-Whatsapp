import { useRef, useState, type ReactNode } from 'react'
import { Loader2, UploadCloud, Download, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { FinanceiroAuthProvider, useFinanceiroAuth } from '@/contexts/financeiro-auth-context'
import { useRateioUpload, useRateioHistorico } from '@/hooks/use-rateio'
import { RateioHistoricoPanel } from '@/components/rateio/RateioHistoricoPanel'
import { fmt, fmtNum, baixarBase64 } from '@/lib/rateio/format'
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

function RateioInner() {
  const [empresa, setEmpresa] = useState<RateioEmpresa>('PRN')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [arrastando, setArrastando] = useState(false)
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

  async function handleGerar() {
    if (!arquivo || enviando) return
    try {
      await processar(arquivo, empresa)
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

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
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
        </section>

        {r && (
          <section className="mt-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Total do rateio
                  </p>
                  <p className="mt-1 text-4xl font-bold text-foreground">{fmt(r.total_geral)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {EMPRESAS.find((e) => e.key === r.empresa)?.label || r.empresa}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Exames (variável)
                  </p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{fmt(r.total_variavel)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmtNum(r.total_exames)} exames</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Taxas fixas</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{fmt(r.total_encargos)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmtNum(r.n_unidades)} unidades</p>
                </CardContent>
              </Card>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Detalhamento das taxas fixas</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                {Object.entries(r.totais_taxa || {}).map(([tipo, valor]) => (
                  <div key={tipo} className="flex items-center justify-between border-b border-border py-1">
                    <span className="text-muted-foreground">{TAXA_LABELS[tipo] || tipo}</span>
                    <span className="font-medium text-foreground">{fmt(valor)}</span>
                  </div>
                ))}
              </div>
            </div>

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
