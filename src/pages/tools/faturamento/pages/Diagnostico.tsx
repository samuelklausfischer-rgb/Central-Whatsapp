import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '../navegacao'
import { CheckCircle2, RefreshCw, Search, SlidersHorizontal, X, XCircle } from 'lucide-react'
import { Botao, Carregando, Segmentado, Vazio } from '../components/ui'
import { CLASSE_CONTROLE } from '../components/ui/Campo'
import { carregarCadastro } from '../lib/cadastroCompleto'
import { CATALOGO, contarPorSeveridade, diagnosticar, type Cadastro, type Problema } from '../lib/diagnostico'
import { agruparProblemas, filtrar, FILTROS_VAZIOS, type Agrupamento, type FiltrosDiag } from './diagnostico/filtros'
import { LinhaProblema } from './diagnostico/LinhaProblema'
import { ResumoSeveridade } from './diagnostico/ResumoSeveridade'

const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export default function Diagnostico() {
  const [cadastro, setCadastro] = useState<Cadastro | null>(null)
  const [problemas, setProblemas] = useState<Problema[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [verificadoEm, setVerificadoEm] = useState<Date | null>(null)
  const [filtros, setFiltros] = useState<FiltrosDiag>(FILTROS_VAZIOS)
  const [agrupar, setAgrupar] = useState<Agrupamento>('unidade')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try {
      const c = await carregarCadastro({ comDesconhecidos: true })
      const agora = new Date()
      setCadastro(c); setProblemas(diagnosticar(c, agora)); setVerificadoEm(agora)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setCarregando(false)
    }
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  const unidades = useMemo(() => new Map((cadastro?.unidades ?? []).map(u => [u.id, u])), [cadastro])
  const visiveis = useMemo(() => filtrar(problemas, unidades, filtros), [problemas, unidades, filtros])
  const grupos = useMemo(() => agruparProblemas(visiveis, unidades, agrupar), [visiveis, unidades, agrupar])
  const contagem = useMemo(() => contarPorSeveridade(problemas), [problemas])
  const regrasComProblema = useMemo(() => [...new Set(problemas.map(p => p.id))].sort(), [problemas])
  const filtrando = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VAZIOS)
  const set = <K extends keyof FiltrosDiag>(k: K, v: FiltrosDiag[K]) => setFiltros(f => ({ ...f, [k]: v }))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm"><Link to="/faturamento" className="text-[#1f4e78] hover:underline">← Unidades</Link></p>
          <h1 className="text-xl font-bold text-slate-900">Erros de configuração</h1>
          <p className="text-sm text-slate-600">Confere o cadastro de todas as unidades e mostra o que pode fazer o relatório sair errado, antes de gerar.</p>
        </div>
        <div className="flex items-center gap-3">
          {verificadoEm && <span className="text-xs text-slate-600">verificado às {hhmm(verificadoEm)}</span>}
          <Link to="/faturamento/regras-gerais" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
            <SlidersHorizontal className="size-4" aria-hidden="true" />Regras gerais
          </Link>
          <Botao icone={RefreshCw} disabled={carregando} onClick={() => void carregar()}>{carregando ? 'Verificando…' : 'Atualizar'}</Botao>
        </div>
      </header>

      {erro && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden="true" />
          <div className="flex-1"><p className="font-semibold">Não foi possível conferir o cadastro.</p><p>{erro}</p></div>
          <Botao tamanho="pequeno" onClick={() => void carregar()}>Tentar de novo</Botao>
        </div>
      )}

      {carregando && !cadastro && <Carregando linhas={5} rotulo="Conferindo o cadastro…" />}

      {cadastro && (
        <>
          <ResumoSeveridade contagem={contagem} ativo={filtros.severidade} onEscolher={s => set('severidade', s)} />

          {problemas.length === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-10 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden="true" />
              <p className="mt-3 text-lg font-semibold text-emerald-900">Nenhum erro encontrado</p>
              <p className="mt-1 text-sm text-emerald-800">O cadastro de {cadastro.unidades.length} unidades passou em todas as conferências.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <label className="relative min-w-[14rem] flex-1">
                  <span className="sr-only">Buscar</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" aria-hidden="true" />
                  <input className={`${CLASSE_CONTROLE} pl-9`} placeholder="Buscar unidade ou texto…" value={filtros.busca} onChange={e => set('busca', e.target.value)} />
                </label>
                <label className="text-xs font-medium text-slate-700">Tipo de erro
                  <select className={`${CLASSE_CONTROLE} mt-1`} value={filtros.regra} onChange={e => set('regra', e.target.value)}>
                    <option value="">Todos</option>
                    {regrasComProblema.map(id => <option key={id} value={id}>{id} · {CATALOGO[id]?.titulo}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-700">Empresa
                  <select className={`${CLASSE_CONTROLE} mt-1`} value={filtros.empresa} onChange={e => set('empresa', e.target.value)}>
                    <option value="">Todas</option><option value="PRN">PRN</option><option value="MEDIMAGEM">Medimagem</option>
                  </select>
                </label>
                {filtrando && <Botao variante="fantasma" icone={X} onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar</Botao>}
                <div className="ml-auto">
                  <Segmentado nome="agrupar-diagnostico" rotulo="Agrupar por" valor={agrupar} onChange={v => setAgrupar(v as Agrupamento)}
                    opcoes={[{ valor: 'unidade', rotulo: 'Por unidade' }, { valor: 'tipo', rotulo: 'Por tipo de erro' }]} />
                </div>
              </div>

              <p className="text-sm text-slate-600" aria-live="polite">{visiveis.length} de {problemas.length} {problemas.length === 1 ? 'problema' : 'problemas'}</p>

              {visiveis.length === 0 ? (
                <Vazio icone={Search} titulo="Nada com esses filtros" texto="Tire algum filtro para ver os outros problemas." acao={<Botao onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar filtros</Botao>} />
              ) : (
                <div className="space-y-4">
                  {grupos.map(g => (
                    <section key={g.chave} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label={g.titulo}>
                      <h2 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-slate-900">
                        {g.titulo}
                        {g.subtitulo && <span className="text-xs font-normal text-slate-600">{g.subtitulo}</span>}
                        <span className="ml-auto text-xs font-normal text-slate-600">{g.problemas.length}</span>
                      </h2>
                      <ul className="mt-3 space-y-2">
                        {g.problemas.map((p, i) => (
                          <LinhaProblema key={`${p.id}-${p.unidadeId}-${p.alvoId ?? ''}-${i}`} p={p} unidade={p.unidadeId ? unidades.get(p.unidadeId) : undefined}
                            mostrarUnidade={agrupar === 'tipo'} unidades={cadastro.unidades} onMudou={() => void carregar()} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
