import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '../navegacao'
import { AlertTriangle, ChevronDown, ChevronRight, FilterX, Plus, SearchX } from 'lucide-react'
import { db } from '../lib/supabase'
import { paginar } from '../lib/pool'
import type { PrecoVigente, RegrasUnidade, UnidadeResumo } from '../lib/tipos'
import { MODELO, hojeISO, plural } from '../lib/format'
import { modeloComum } from '../lib/config'
import { useStatusPorExame } from '../components/ComoFatura'
import { Botao, Carregando, Vazio } from '../components/ui'
import { BarraFiltros } from './lista/BarraFiltros'
import { SaudeCadastro } from './lista/SaudeCadastro'
import { IndicadoresLista } from './lista/IndicadoresLista'
import { GRADE, LinhaUnidade, type AliasLinha } from './lista/LinhaUnidade'
import {
  AGRUPAR_PADRAO, FILTROS_VAZIOS, agruparPor, alternarChave, contagens, filtrar, filtroAtivo, filtrosSalvos, saudeDe,
  type Agrupar, type ChaveRegra, type ChaveSaude, type Contexto, type Filtros,
} from './lista/filtrosLista'

const CHAVE_LISTA = 'fat:config:lista'
type EstadoLista = Filtros & { agrupar: Agrupar; grupos: string[]; unidades: string[] }
function lerEstado(): Partial<Record<keyof EstadoLista, unknown>> {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_LISTA) ?? '{}') } catch { return {} }
}
const lerAgrupar = (v: unknown): Agrupar => (v === 'nenhum' || v === 'contrato' || v === 'empresa') ? v : AGRUPAR_PADRAO
const lerLista = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

export default function Configuracao() {
  const [unidades, setUnidades] = useState<UnidadeResumo[]>([])
  const [regras, setRegras] = useState<Map<string, RegrasUnidade>>(new Map())
  const [precos, setPrecos] = useState<Map<string, PrecoVigente[]>>(new Map())
  const [aliases, setAliases] = useState<Map<string, AliasLinha[]>>(new Map())
  const [dataRef, setDataRef] = useState(hojeISO())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo] = useState(lerEstado)
  const [filtros, setFiltros] = useState<Filtros>(() => filtrosSalvos(salvo))
  const [agrupar, setAgrupar] = useState<Agrupar>(() => lerAgrupar(salvo.agrupar))
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(new Set(lerLista(salvo.grupos)))
  const [unidadesAbertas, setUnidadesAbertas] = useState<Set<string>>(new Set(lerLista(salvo.unidades)))
  const abrirResultados = useRef(false) // depois de mexer em busca/filtro, abre os grupos com resultado
  const statusPorExame = useStatusPorExame()

  useEffect(() => {
    try {
      sessionStorage.setItem(CHAVE_LISTA, JSON.stringify({ ...filtros, agrupar, grupos: [...gruposAbertos], unidades: [...unidadesAbertas] } satisfies EstadoLista))
    } catch { /* sem sessionStorage: segue sem lembrar */ }
  }, [filtros, agrupar, gruposAbertos, unidadesAbertas])

  // Cadastro (unidades, regras e nomes) — não depende da data
  useEffect(() => {
    ;(async () => {
      try {
        const [us, rs, as] = await Promise.all([
          paginar<UnidadeResumo>((de, ate) => db.from('v_unidade_resumo').select('*').order('pasta').order('id').range(de, ate)),
          paginar<RegrasUnidade>((de, ate) => db.from('unidade').select('id, janela, criterio_data, franquia_mensal, todos_status, regras_quantidade, estudos_conta_2, acao_intensificada').order('id').range(de, ate)),
          paginar<AliasLinha>((de, ate) => db.from('alias').select('nome_bruto, unidade_id, subunidade, principal, grupo').order('nome_bruto').range(de, ate)),
        ])
        setUnidades(us)
        setRegras(new Map(rs.map(r => [r.id, r])))
        const m = new Map<string, AliasLinha[]>()
        for (const a of as) { const l = m.get(a.unidade_id); if (l) l.push(a); else m.set(a.unidade_id, [a]) }
        setAliases(m)
      } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    })()
  }, [])

  // Preços vigentes de todas as unidades na data escolhida
  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    ;(async () => {
      try {
        const ps = await paginar<PrecoVigente>((de, ate) =>
          db.rpc('precos_vigentes', { p_data: dataRef }).order('unidade_id').order('item_preco_id').range(de, ate))
        if (cancelado) return
        const m = new Map<string, PrecoVigente[]>()
        for (const p of ps) {
          const item = { ...p, valor: p.valor == null ? null : Number(p.valor), valor_original: p.valor_original == null ? null : Number(p.valor_original) }
          const l = m.get(p.unidade_id); if (l) l.push(item); else m.set(p.unidade_id, [item])
        }
        setPrecos(m); setErro(null)
      } catch (e) { if (!cancelado) setErro(e instanceof Error ? e.message : String(e)) }
      finally { if (!cancelado) setCarregando(false) }
    })()
    return () => { cancelado = true }
  }, [dataRef])

  const ctx: Contexto = useMemo(() => ({ regras, precos, aliases, precosProntos: !carregando }), [regras, precos, aliases, carregando])
  const contagem = useMemo(() => contagens(unidades, filtros, ctx), [unidades, filtros, ctx])
  const visiveis = useMemo(() => filtrar(unidades, filtros, ctx), [unidades, filtros, ctx])
  const grupos = useMemo(() => agruparPor(visiveis, agrupar), [visiveis, agrupar])
  const ativo = filtroAtivo(filtros)
  const resumo = useMemo(() => {
    const atencao = unidades.filter(u => saudeDe(u, ctx).some(k => k === 'vencida_vigente' || k === 'sem_preco' || k === 'divergente')).length
    return { vigentes: unidades.filter(u => u.situacao === 'vigente').length, atencao, pendencia: unidades.filter(u => u.n_pendencias > 0).length }
  }, [unidades, ctx])

  useEffect(() => {
    if (!abrirResultados.current || !grupos.length) return
    abrirResultados.current = false
    setGruposAbertos(new Set(grupos.map(g => g.nome)))
  }, [grupos])

  function mudar(f: Partial<Filtros>) { abrirResultados.current = true; setFiltros(a => ({ ...a, ...f })) }
  function limparFiltros() { abrirResultados.current = false; setFiltros(FILTROS_VAZIOS) }

  const itensDe = (u: UnidadeResumo) => precos.get(u.id) ?? []
  function alternar(set: Set<string>, k: string, atualizar: (s: Set<string>) => void) {
    const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k)
    atualizar(n)
  }
  const linha = (u: UnidadeResumo) => (
    <LinhaUnidade key={u.id} u={u} regras={regras.get(u.id)} itens={itensDe(u)} nomes={aliases.get(u.id) ?? []}
      saude={saudeDe(u, ctx)} statusPorExame={statusPorExame} aberta={unidadesAbertas.has(u.id)} dataRef={dataRef}
      onAlternar={() => alternar(unidadesAbertas, u.id, setUnidadesAbertas)} />
  )

  if (erro) return <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Erro ao carregar: {erro}</p>
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-[#1f4e78]">Unidades e contratos</h1>
          <p className="mt-1 text-sm text-slate-600">Veja como cada unidade fatura e o que precisa de atenção. Abra uma unidade para ver os valores por exame, o valor fixo e editar as regras.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link to="/faturamento/diagnostico" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
            <AlertTriangle className="size-4" aria-hidden="true" />Erros de configuração
          </Link>
          <Link to="/faturamento/nova-unidade" className="inline-flex items-center gap-1.5 rounded-lg bg-[#1f4e78] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#173d5f]">
            <Plus className="size-4" aria-hidden="true" />Nova unidade
          </Link>
        </div>
      </div>

      {carregando && !unidades.length ? <Carregando linhas={5} /> : (
        <>
          <IndicadoresLista total={unidades.length} vigentes={resumo.vigentes} atencao={resumo.atencao} pendencia={resumo.pendencia} />

          <SaudeCadastro contagem={contagem.saude} selecionadas={filtros.saude} carregandoPrecos={carregando}
            onAlternar={(k: ChaveSaude) => mudar({ saude: alternarChave(filtros.saude, k) })} />

          <BarraFiltros filtros={filtros} contagem={contagem} totalGeral={unidades.length} agrupar={agrupar} dataRef={dataRef} filtroAtivo={ativo}
            onBusca={busca => mudar({ busca })} onEmpresa={empresa => mudar({ empresa })} onSituacao={situacao => mudar({ situacao })}
            onRegra={(k: ChaveRegra) => mudar({ regras: alternarChave(filtros.regras, k) })}
            onAgrupar={setAgrupar} onData={setDataRef} onLimpar={limparFiltros} />

          {grupos.length > 0 && (
            <div className="space-y-4">
              <div className={`hidden rounded-lg bg-[#1f4e78]/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-[#1f4e78] ${GRADE} lg:grid lg:pr-[3.75rem]`} aria-hidden="true">
                <span>Unidade</span><span>Como fatura</span><span>Preço hoje</span><span>Vigência</span><span>Alertas</span>
              </div>
              {grupos.map(g => {
                if (agrupar === 'nenhum') {
                  return <ul key="todas" className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">{g.unidades.map(linha)}</ul>
                }
                const aberto = gruposAbertos.has(g.nome)
                const modelo = modeloComum(g.unidades, itensDe)
                return (
                  <section key={g.nome} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <button type="button" aria-expanded={aberto} onClick={() => alternar(gruposAbertos, g.nome, setGruposAbertos)}
                      className="flex w-full items-center gap-3 border-l-4 border-l-[#1f4e78] bg-gradient-to-r from-sky-100 to-sky-50 px-4 py-3 text-left hover:from-sky-200 hover:to-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1f4e78]/50">
                      {aberto ? <ChevronDown className="size-4 text-slate-600" aria-hidden="true" /> : <ChevronRight className="size-4 text-slate-600" aria-hidden="true" />}
                      <span className="font-bold text-[#1f4e78]">{g.nome}</span>
                      <span className="rounded-full bg-[#1f4e78] px-2 py-0.5 text-xs font-semibold text-white">{plural(g.unidades.length, 'unidade', 'unidades')}</span>
                      {modelo && <span className="ml-auto rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-900 ring-1 ring-inset ring-indigo-300">{MODELO[modelo] ?? modelo}</span>}
                    </button>
                    {aberto && <ul className="divide-y divide-slate-100 border-t border-slate-200">{g.unidades.map(linha)}</ul>}
                  </section>
                )
              })}
            </div>
          )}

          {!grupos.length && (
            <Vazio icone={SearchX} titulo="Nenhuma unidade com esses filtros"
              texto="Tente outra busca ou tire algum filtro."
              acao={ativo ? <Botao icone={FilterX} onClick={limparFiltros}>Limpar filtros</Botao> : undefined} />
          )}

          <p className="text-xs text-slate-600">
            {agrupar === 'nenhum' ? '' : `${plural(grupos.length, 'grupo', 'grupos')} · `}{visiveis.length} de {plural(unidades.length, 'unidade', 'unidades')}{carregando ? ' · atualizando valores…' : ''}
          </p>
        </>
      )}
    </div>
  )
}
