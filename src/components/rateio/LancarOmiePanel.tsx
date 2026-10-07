import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, AlertTriangle, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { GlassCard } from '@/components/ui/surface'
import { EstadoPainel } from '@/components/ui/estado-painel'
import { useToast } from '@/hooks/use-toast'
import { fmt, valorNumerico } from '@/lib/rateio/format'
import {
  analisarRateioOmie,
  lancarRateioOmie,
  listarDepartamentosOmie,
  vincularUnidadeOmie,
  type OmieAnalise,
  type OmieAnaliseEntrada,
  type OmieDepartamento,
  type OmieLancarResultado,
} from '@/services/rateio/rateio-omie-service'

// Painel "Lançar no Omie" da execução recém-gravada. Processa UMA empresa por vez; o
// "Lançar tudo" do produto (laço por empresa) está pronto e comentado em
// rateio-omie-service.ts até o histórico permitir escolher as 4 execuções do mês.
//
// Só é montado com VITE_RATEIO_OMIE === '1' (decisão da página). A página usa `key={execucaoId}`
// para zerar todo o estado quando uma nova execução é gerada.

const ROTULO_EMPRESA: Record<string, string> = {
  PRN: 'PRN',
  PRN_APICE: 'PRN / Apice Tele',
  MEDIMAGEM: 'MedImagem',
  MEDIMAGEM_APICE: 'MedImagem / Apice Tele',
}

// Texto próprio por tipo de bloqueio/aviso novo; o que o servidor mandou fica entre parênteses.
const TEXTO_BLOQUEIO: Record<string, string> = {
  NF_JA_LANCADA: 'Esta NF já foi lançada nesta empresa com outra competência. Não é lançada duas vezes.',
  EXECUCAO_JA_LANCADA: 'Este rateio já foi lançado com outra NF ou competência. Não é lançado duas vezes.',
  DEPARTAMENTO_VALOR_INVALIDO:
    'Algum departamento ficou com valor ou percentual zero ou negativo; o Omie recusaria o lançamento.',
  EXECUCAO_DE_OUTRO_USUARIO: 'Este rateio foi gerado por outro usuário. Só quem gerou pode lançá-lo no Omie.',
  LANCAMENTO_EM_ANDAMENTO: 'Há um lançamento desta NF em andamento. Aguarde alguns minutos e analise de novo.',
}

const TEXTO_AVISO: Record<string, string> = {
  LANCAMENTO_INCERTO:
    'Um envio anterior desta NF terminou sem confirmação. Ao tentar de novo, o Omie é consultado antes de criar qualquer coisa.',
  TENTATIVA_ANTERIOR_COM_ERRO: 'Uma tentativa anterior desta NF falhou. Você pode tentar de novo.',
}

function comDetalhe(texto: string | undefined, servidor: string): string {
  if (!texto) return servidor
  return servidor && servidor !== texto ? texto + ' (' + servidor + ')' : texto
}

const dataBr = (iso: string) => iso.split('-').reverse().join('/')
const competenciaBr = (c: string) => c.split('-').reverse().join('/')

const pad = (n: number) => String(n).padStart(2, '0')
const isoDia = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function competenciaPadrao(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

// Último dia do mês da emissão (AAAA-MM-DD); '' se a emissão for inválida.
function ultimoDiaDoMes(emissao: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(emissao)
  if (!m) return ''
  return isoDia(new Date(Number(m[1]), Number(m[2]), 0))
}

function dataCurta(iso: string | null): string {
  if (!iso) return 'data não informada'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}

const perc = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</span>
      {children}
    </label>
  )
}

interface LancarOmiePanelProps {
  // Execução gravada no histórico; null quando não dá para lançar (ver `motivoIndisponivel`).
  execucaoId: string | null
  motivoIndisponivel?: string | null
}

export function LancarOmiePanel({ execucaoId, motivoIndisponivel }: LancarOmiePanelProps) {
  const { toast } = useToast()

  const [nf, setNf] = useState('')
  const [valorNf, setValorNf] = useState('')
  const [competencia, setCompetencia] = useState(competenciaPadrao)
  const [emissao, setEmissao] = useState(() => isoDia(new Date()))
  const [vencimentoManual, setVencimentoManual] = useState<string | null>(null)
  const [contaCorrente, setContaCorrente] = useState('')

  // Vencimento acompanha a emissão até o usuário mexer nele.
  const vencimento = vencimentoManual ?? ultimoDiaDoMes(emissao)

  const [analisando, setAnalisando] = useState(false)
  const [erroAnalise, setErroAnalise] = useState<string | null>(null)
  const [analise, setAnalise] = useState<OmieAnalise | null>(null)
  // Entrada (serializada) com que `analise` foi feita: se o formulário mudar depois, ela fica velha.
  const [analiseChave, setAnaliseChave] = useState<string | null>(null)

  const [confirmando, setConfirmando] = useState(false)
  const [lancando, setLancando] = useState(false)
  const [resultado, setResultado] = useState<OmieLancarResultado | null>(null)
  const [erroLancar, setErroLancar] = useState<string | null>(null)

  const [departamentos, setDepartamentos] = useState<OmieDepartamento[] | null>(null)
  const [carregandoDeptos, setCarregandoDeptos] = useState(false)
  const [erroDeptos, setErroDeptos] = useState<string | null>(null)
  const [escolhaDepto, setEscolhaDepto] = useState<Record<string, string>>({})
  const [vinculando, setVinculando] = useState<string | null>(null)

  // Monta a entrada do contrato a partir do formulário; null enquanto algo obrigatório falta.
  const entrada: OmieAnaliseEntrada | null = useMemo(() => {
    const v = Math.round(valorNumerico(valorNf) * 100) / 100
    const cc = contaCorrente.replace(/\D/g, '')
    if (!execucaoId || !nf.trim() || v <= 0) return null
    if (!/^\d{4}-\d{2}$/.test(competencia) || !/^\d{4}-\d{2}-\d{2}$/.test(emissao)) return null
    return {
      execucao_id: execucaoId,
      nf: nf.trim(),
      valor_nf: v,
      competencia,
      emissao,
      ...(vencimento ? { vencimento } : {}),
      ...(cc ? { conta_corrente: Number(cc) } : {}),
    }
  }, [execucaoId, nf, valorNf, competencia, emissao, vencimento, contaCorrente])

  const chaveAtual = entrada ? JSON.stringify(entrada) : null
  const analiseVelha = !!analise && analiseChave !== chaveAtual

  // Entrada com que a análise exibida foi feita (o modal e o lançar usam esta, não o formulário).
  const entradaAnalise = useMemo<OmieAnaliseEntrada | null>(
    () => (analiseChave ? (JSON.parse(analiseChave) as OmieAnaliseEntrada) : null),
    [analiseChave],
  )

  // "Já lançado" só vale para a chave da análise atual: se o formulário mudou (analiseVelha) ou o
  // servidor informar outra chave, não mostra nada.
  const jaLancadoBruto = analise?.ja_lancado ?? null
  const jaLancado =
    jaLancadoBruto && !analiseVelha && (!jaLancadoBruto.chave || jaLancadoBruto.chave === analise?.chave)
      ? jaLancadoBruto
      : null
  // incerto/erro não são beco sem saída: o botão volta como "Tentar de novo" (o servidor consulta
  // o Omie antes de incluir). Qualquer outro status (lancado, enviando) segue barrando.
  const retentar = !!jaLancado && (jaLancado.status === 'incerto' || jaLancado.status === 'erro')
  const lancadoAgora = resultado?.status === 'lancado'
  const bloqueios = analise?.bloqueios ?? []
  const semDepto = bloqueios.filter((b) => b.tipo === 'UNIDADE_SEM_DEPARTAMENTO')
  const empresaAnalise = analise?.empresa

  async function analisar(para: OmieAnaliseEntrada | null = entrada) {
    if (!para || analisando) return
    setAnalisando(true)
    setErroAnalise(null)
    setErroLancar(null)
    setResultado(null)
    try {
      const a = await analisarRateioOmie(para)
      setAnalise(a)
      setAnaliseChave(JSON.stringify(para))
    } catch (err) {
      setAnalise(null)
      setAnaliseChave(null)
      setErroAnalise((err as Error).message)
    } finally {
      setAnalisando(false)
    }
  }

  // O seletor de departamento só é necessário quando há unidade sem vínculo; recarrega por empresa.
  const precisaDeptos = semDepto.length > 0
  useEffect(() => {
    if (!precisaDeptos || !empresaAnalise) return
    let cancelado = false
    setCarregandoDeptos(true)
    setErroDeptos(null)
    listarDepartamentosOmie(empresaAnalise)
      .then((l) => {
        if (!cancelado) setDepartamentos(l)
      })
      .catch((err) => {
        if (!cancelado) setErroDeptos((err as Error).message)
      })
      .finally(() => {
        if (!cancelado) setCarregandoDeptos(false)
      })
    return () => {
      cancelado = true
    }
  }, [precisaDeptos, empresaAnalise])

  async function vincular(unidade: string) {
    const cod = Number(escolhaDepto[unidade])
    if (!empresaAnalise || !cod || vinculando) return
    setVinculando(unidade)
    try {
      const r = await vincularUnidadeOmie(empresaAnalise, unidade, cod)
      toast({ title: 'Unidade vinculada', description: `${unidade} → ${r.departamento_nome}` })
      // Reanalisa com a mesma entrada da análise que mostrou o bloqueio.
      await analisar(entradaAnalise ?? entrada)
    } catch (err) {
      toast({ title: 'Erro ao vincular', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setVinculando(null)
    }
  }

  async function lancar() {
    if (!analise || !entradaAnalise || analiseVelha || bloqueios.length > 0 || lancando) return
    setLancando(true)
    setErroLancar(null)
    try {
      const r = await lancarRateioOmie(entradaAnalise, analise.hash)
      setResultado(r)
      // A recusa traz a análise refeita pelo servidor: mostra o que mudou em vez da velha.
      if (r.analise) setAnalise(r.analise)
    } catch (err) {
      setErroLancar((err as Error).message)
    } finally {
      setLancando(false)
      setConfirmando(false)
    }
  }

  if (!execucaoId) {
    return (
      <GlassCard className="p-5">
        <h3 className="text-sm font-semibold text-foreground">Lançar no Omie</h3>
        <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>{motivoIndisponivel || 'Esta execução não está disponível para lançamento no Omie.'}</span>
        </p>
      </GlassCard>
    )
  }

  const podeAnalisar = !!entrada && !analisando && !lancando
  // Depois de qualquer resposta de lançamento (lançado, erro, incerto ou recusa) o botão só volta
  // com uma nova análise: `resultado` é zerado em `analisar`. Evita reenvio às cegas após `incerto`.
  const podeLancar =
    !!analise &&
    !analiseVelha &&
    bloqueios.length === 0 &&
    (!jaLancado || retentar) &&
    !resultado &&
    !erroLancar &&
    !analisando &&
    !lancando
  const rotuloEmpresa = ROTULO_EMPRESA[analise?.empresa ?? ''] || analise?.empresa || ''

  return (
    <GlassCard className="p-5">
      <h3 className="mb-1 text-sm font-semibold text-foreground">Lançar no Omie</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Confira a distribuição por departamento antes de criar a conta a pagar. Analisar não grava nada no Omie.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Campo rotulo="NF">
          <Input value={nf} onChange={(e) => setNf(e.target.value)} placeholder="Número da NF" />
        </Campo>
        <Campo rotulo="Valor da NF">
          <Input
            inputMode="decimal"
            value={valorNf}
            onChange={(e) => setValorNf(e.target.value)}
            placeholder="0,00"
            className="text-right"
          />
        </Campo>
        <Campo rotulo="Competência">
          <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        </Campo>
        <Campo rotulo="Emissão">
          <Input type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} />
        </Campo>
        <Campo rotulo="Vencimento">
          <Input type="date" value={vencimento} onChange={(e) => setVencimentoManual(e.target.value)} />
        </Campo>
        <Campo rotulo="Conta corrente (opcional)">
          <Input
            inputMode="numeric"
            value={contaCorrente}
            onChange={(e) => setContaCorrente(e.target.value)}
            placeholder="Padrão da empresa"
          />
        </Campo>
      </div>

      <Button onClick={() => analisar()} disabled={!podeAnalisar} variant="outline" className="mt-4 h-10 w-full gap-2">
        {analisando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {analisando ? 'Analisando…' : analise ? 'Analisar de novo' : 'Analisar'}
      </Button>
      {!entrada && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Informe NF, valor da NF (maior que zero), competência e emissão para analisar.
        </p>
      )}

      {analisando && !analise && (
        <div className="mt-4">
          <EstadoPainel carregando erro={false} vazio={false} mensagemVazio="" />
        </div>
      )}

      {erroAnalise && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">Não foi possível analisar: {erroAnalise}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => analisar()}
            disabled={!podeAnalisar}
            className="h-7 px-2 text-xs"
          >
            Tentar de novo
          </Button>
        </div>
      )}

      {analise && (
        <div className="mt-4 space-y-4">
          {analiseVelha && !resultado && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
              Os dados foram alterados depois da análise. Clique em "Analisar de novo" para poder lançar.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {rotuloEmpresa} · conta Omie {analise.conta_omie} · chave{' '}
            <span className="font-mono text-foreground/80">{analise.chave}</span>
          </p>

          {analise.distribuicao.length === 0 ? (
            <EstadoPainel
              carregando={false}
              erro={false}
              vazio
              mensagemVazio="Nenhum departamento com valor neste rateio."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Departamento</TableHead>
                  <TableHead>Unidades</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analise.distribuicao.map((d) => (
                  <TableRow key={d.cod_departamento}>
                    <TableCell className="font-medium">{d.nome}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{d.unidades.join(', ')}</TableCell>
                    <TableCell className="text-right">{fmt(d.valor)}</TableCell>
                    <TableCell className="text-right">{perc(d.perc)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total do rateio</TableCell>
                  <TableCell className="text-right">{fmt(analise.total_rateio)}</TableCell>
                  <TableCell />
                </TableRow>
                <TableRow>
                  <TableCell colSpan={2}>Valor da NF</TableCell>
                  <TableCell className="text-right">{fmt(analise.valor_nf)}</TableCell>
                  <TableCell />
                </TableRow>
                <TableRow>
                  <TableCell colSpan={2}>Diferença (NF − rateio)</TableCell>
                  <TableCell className={`text-right ${Math.abs(analise.diferenca) >= 0.005 ? 'text-amber-600' : ''}`}>
                    {fmt(analise.diferenca)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          )}

          {bloqueios.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <XCircle className="h-3.5 w-3.5" />
                {bloqueios.length} bloqueio{bloqueios.length > 1 ? 's' : ''}: não dá para lançar
              </p>
              <ul className="space-y-2 text-xs text-destructive">
                {bloqueios.map((b, i) => {
                  const unidade = b.referencia
                  return (
                    <li key={`${b.tipo}-${unidade ?? i}`}>
                      <span>• {comDetalhe(TEXTO_BLOQUEIO[b.tipo], b.mensagem)}</span>
                      {b.tipo === 'UNIDADE_SEM_DEPARTAMENTO' && unidade && !analiseVelha && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-foreground">
                          <Select
                            value={escolhaDepto[unidade] ?? ''}
                            onValueChange={(v) => setEscolhaDepto((e) => ({ ...e, [unidade]: v }))}
                            disabled={carregandoDeptos || !departamentos?.length}
                          >
                            <SelectTrigger aria-label={`Departamento de ${unidade}`} className="h-8 w-64 text-xs">
                              <SelectValue
                                placeholder={
                                  carregandoDeptos
                                    ? 'Carregando departamentos…'
                                    : erroDeptos
                                      ? 'Departamentos indisponíveis'
                                      : 'Escolha o departamento'
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {(departamentos || []).map((d) => (
                                <SelectItem key={d.cod} value={String(d.cod)}>
                                  {d.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 px-3 text-xs"
                            disabled={!escolhaDepto[unidade] || vinculando !== null || analisando}
                            onClick={() => vincular(unidade)}
                          >
                            {vinculando === unidade ? 'Vinculando…' : 'Vincular'}
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
              {erroDeptos && semDepto.length > 0 && (
                <p className="mt-2 text-xs text-destructive">Não foi possível carregar os departamentos: {erroDeptos}</p>
              )}
              {!erroDeptos && !carregandoDeptos && semDepto.length > 0 && departamentos?.length === 0 && (
                <p className="mt-2 text-xs text-destructive">Nenhum departamento ativo encontrado no Omie.</p>
              )}
            </div>
          )}

          {analise.avisos.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                {analise.avisos.length} aviso{analise.avisos.length > 1 ? 's' : ''}
              </p>
              <ul className="space-y-1 text-xs text-amber-600/90">
                {analise.avisos.map((a, i) => (
                  <li key={`${a.tipo}-${a.referencia ?? i}`}>• {comDetalhe(TEXTO_AVISO[a.tipo], a.mensagem)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {jaLancado && jaLancado.status === 'lancado' && (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-600">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Já lançado em {dataCurta(jaLancado.criado_em)}, código {jaLancado.omie_codigo_lancamento ?? '—'}
        </p>
      )}
      {jaLancado && retentar && (
        <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
          Há uma tentativa anterior desta NF com status "{jaLancado.status}" ({dataCurta(jaLancado.criado_em)}). Ao
          tentar de novo, o Omie é consultado antes: se a conta já existir, ela é apenas registrada, sem duplicar.
        </p>
      )}
      {jaLancado && jaLancado.status !== 'lancado' && !retentar && (
        <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
          Existe um lançamento desta NF com status "{jaLancado.status}" ({dataCurta(jaLancado.criado_em)}). Aguarde ou
          confira no Omie.
        </p>
      )}

      {resultado && <ResultadoLancamento r={resultado} />}
      {erroLancar && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Não foi possível lançar: {erroLancar}. Clique em "Analisar de novo" para conferir se a conta chegou a ser
          criada.
        </p>
      )}

      {analise && jaLancado?.status !== 'lancado' && !lancadoAgora && (
        <Button onClick={() => setConfirmando(true)} disabled={!podeLancar} className="mt-4 h-11 w-full font-semibold">
          {retentar ? 'Tentar de novo (vai consultar o Omie antes)' : 'Lançar no Omie'}
        </Button>
      )}

      <AlertDialog open={confirmando} onOpenChange={(o) => !lancando && setConfirmando(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lançar no Omie?</AlertDialogTitle>
            <AlertDialogDescription>Isso cria uma conta a pagar real no Omie.</AlertDialogDescription>
          </AlertDialogHeader>
          {analise && entradaAnalise && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Empresa</dt>
              <dd className="font-medium">{rotuloEmpresa}</dd>
              <dt className="text-muted-foreground">NF</dt>
              <dd className="font-medium">{entradaAnalise.nf}</dd>
              <dt className="text-muted-foreground">Valor</dt>
              <dd className="font-medium">{fmt(analise.valor_nf)}</dd>
              <dt className="text-muted-foreground">Competência</dt>
              <dd className="font-medium">{competenciaBr(entradaAnalise.competencia)}</dd>
              <dt className="text-muted-foreground">Vencimento</dt>
              <dd className="font-medium">
                {entradaAnalise.vencimento ? dataBr(entradaAnalise.vencimento) : 'último dia do mês da emissão'}
              </dd>
              <dt className="text-muted-foreground">Conta corrente</dt>
              <dd className="font-medium">{entradaAnalise.conta_corrente ?? 'padrão da empresa'}</dd>
              <dt className="text-muted-foreground">Departamentos</dt>
              <dd className="font-medium">{analise.distribuicao.length}</dd>
              <dt className="text-muted-foreground">Chave</dt>
              <dd className="break-all font-mono text-xs font-medium">{analise.chave}</dd>
            </dl>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={lancando}>Cancelar</AlertDialogCancel>
            <Button onClick={lancar} disabled={lancando || !podeLancar} className="gap-2">
              {lancando && <Loader2 className="h-4 w-4 animate-spin" />}
              {lancando ? 'Lançando…' : 'Confirmar e lançar'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GlassCard>
  )
}

// Status final do lançamento, com a mensagem que diz o que fazer em cada caso.
function ResultadoLancamento({ r }: { r: OmieLancarResultado }) {
  const verde = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
  const ambar = 'border-amber-500/30 bg-amber-500/10 text-amber-600'
  const vermelho = 'border-destructive/30 bg-destructive/10 text-destructive'

  let classe = vermelho
  let texto: string
  if (r.status === 'lancado') {
    classe = verde
    texto = `Lançado no Omie${r.omie_codigo_lancamento ? `, código ${r.omie_codigo_lancamento}` : ''}.`
  } else if (r.status === 'incerto') {
    classe = ambar
    texto =
      'Resultado incerto: o Omie não confirmou se a conta foi criada. Não tente de novo sem conferir: ' +
      'clique em "Analisar de novo" ou veja no Omie.'
  } else if (r.status === 'erro') {
    texto = 'O Omie recusou o lançamento.'
  } else if (r.motivo === 'ESCRITA_DESLIGADA') {
    classe = ambar
    texto = 'A escrita no Omie está desligada neste ambiente. Nada foi criado.'
  } else if (r.motivo === 'HASH_MUDOU') {
    classe = ambar
    texto =
      'A distribuição mudou desde a sua análise (por exemplo, alguém vinculou uma unidade). Nada foi criado. ' +
      'Analise de novo, revise e lance outra vez.'
  } else if (r.motivo === 'BLOQUEADO') {
    texto = 'O lançamento foi bloqueado na conferência final. Nada foi criado; veja os bloqueios acima.'
  } else if (r.motivo === 'JA_LANCADO') {
    classe = ambar
    texto = 'Esta NF já está lançada no Omie. Nada foi criado de novo.'
  } else if (r.motivo === 'LANCAMENTO_EM_ANDAMENTO') {
    classe = ambar
    texto = 'Há outro envio desta NF em andamento (talvez em outra aba). Aguarde e analise de novo antes de tentar.'
  } else if (r.motivo === 'NF_JA_LANCADA') {
    texto = 'Esta NF já foi lançada nesta empresa com outra competência. Nada foi criado.'
  } else if (r.motivo === 'EXECUCAO_JA_LANCADA') {
    texto = 'Este rateio já foi lançado com outra NF ou competência. Nada foi criado.'
  } else {
    texto = 'Não foi possível lançar.'
  }

  return (
    <p className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-xs font-medium ${classe}`}>
      {r.status === 'lancado' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>
        {texto}
        {r.mensagem ? ` ${r.mensagem}` : ''}
      </span>
    </p>
  )
}
