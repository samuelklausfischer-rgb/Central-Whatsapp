import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from '../navegacao'
import JSZip from 'jszip'
import { db } from '../lib/supabase'
import { paginar, executarEmPool } from '../lib/pool'
import { baixarArquivo, baixarConsolidado, carregarInfoAlias, xlsxDoNome, xlsxDoRelatorio } from '../lib/simular'
import { agruparRelatorios, caminhoRelatorio, grupoDoNome, GRUPOS, ordemDoGrupo, type InfoAlias, type Relatorio } from '../lib/relatorioUnidade'
import { normNome } from '../nucleo/motor'
import { TIPO_PENDENCIA } from '../lib/consolidado'
import { nomeArquivo } from '../lib/excel'
import { brl } from '../lib/format'
import { Pill } from '../components/Pill'
import { competenciaBR, STATUS_SIM } from './Simulacoes'
import type { Simulacao as SimulacaoT, SimulacaoNome, SimulacaoPendencia } from '../lib/tipos'

const TIPO_PEND = TIPO_PENDENCIA

function Kpi({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-xs text-slate-500">{rotulo}</div>
      <div className="text-xl font-semibold">{valor}</div>
    </div>
  )
}

export default function Simulacao() {
  const { id } = useParams()
  const [sim, setSim] = useState<SimulacaoT | null>(null)
  const [nomes, setNomes] = useState<SimulacaoNome[]>([])
  const [pend, setPend] = useState<SimulacaoPendencia[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [soPendencia, setSoPendencia] = useState(false)
  const [busca, setBusca] = useState('')
  const [baixando, setBaixando] = useState<string | null>(null) // chave da linha em download
  const [zip, setZip] = useState<{ feitos: number; total: number } | null>(null)
  const [gerandoConsolidado, setGerandoConsolidado] = useState(false)
  const [infoAlias, setInfoAlias] = useState<Map<string, InfoAlias> | null>(null)
  const [grupo, setGrupo] = useState('')

  useEffect(() => {
    if (!id) return
    ;(async () => {
      try {
        const { data, error } = await db.from('simulacao').select('*').eq('id', id).single()
        if (error) throw new Error(error.message)
        setSim(data as SimulacaoT)
        const [n, p, ia] = await Promise.all([
          paginar<SimulacaoNome>((de, ate) => db.from('v_simulacao_nome').select('*').eq('simulacao_id', id).order('nome_bruto').order('periodo').range(de, ate)),
          paginar<SimulacaoPendencia>((de, ate) => db.from('simulacao_pendencia').select('*').eq('simulacao_id', id).order('id').range(de, ate)),
          carregarInfoAlias(),
        ])
        setInfoAlias(ia)
        setNomes(n.map(x => ({ ...x, qtd_exames: x.qtd_exames == null ? null : Number(x.qtd_exames), total: x.total == null ? null : Number(x.total), n_pendencias: Number(x.n_pendencias) })))
        setPend(p)
      } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
      finally { setCarregando(false) }
    })()
  }, [id])

  const chave = (n: SimulacaoNome) => `${n.nome_bruto}||${n.periodo}`
  const competencia = sim ? sim.competencia.slice(0, 7) : ''

  const kpis = useMemo(() => {
    const nomesDistintos = new Set(nomes.map(n => n.nome_bruto))
    const ligados = new Set(nomes.filter(n => n.unidade_id).map(n => n.nome_bruto))
    return {
      nomes: sim?.total_nomes ?? nomesDistintos.size, ligados: ligados.size,
      exames: nomes.reduce((s, n) => s + (n.qtd_exames ?? 0), 0),
      valor: nomes.reduce((s, n) => s + (n.total ?? 0), 0),
    }
  }, [nomes, sim])

  // grupo da Mobilemed de cada nome (os 4: PRN, PRN Apice Tele, Medimagem, Medimagem Apice Tele)
  const grupoDe = (n: SimulacaoNome) => grupoDoNome(n.nome_bruto, infoAlias?.get(normNome(n.nome_bruto))?.grupo, n.empresa)

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return nomes.filter(n =>
      (!grupo || grupoDe(n) === grupo) && (!soPendencia || n.n_pendencias > 0) &&
      (!q || n.nome_bruto.toLowerCase().includes(q) || (n.pasta ?? '').toLowerCase().includes(q)))
      .sort((a, b) => ordemDoGrupo(grupoDe(a)) - ordemDoGrupo(grupoDe(b)) || a.nome_bruto.localeCompare(b.nome_bruto))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nomes, grupo, soPendencia, busca, infoAlias])

  // relatórios por unidade, separados pelo grupo da Mobilemed (PRN, PRN Ápice Tele, Medimagem, Medimagem Ápice Tele…)
  const relatorios = useMemo(() => {
    if (!infoAlias) return []
    const tot = new Map(nomes.map(n => [chave(n), n]))
    return agruparRelatorios(nomes, infoAlias).map(r => {
      const linhas = r.nomes.map(nb => tot.get(`${nb}||${r.periodo}`)).filter(Boolean) as SimulacaoNome[]
      return { ...r, exames: linhas.reduce((s, x) => s + (x.qtd_exames ?? 0), 0), total: linhas.reduce((s, x) => s + (x.total ?? 0), 0) }
    })
  }, [nomes, infoAlias])
  const relFiltrados = relatorios.filter(r => !grupo || r.rotuloGrupo === grupo)
  // totais por grupo (cartões e subtotais da tabela)
  const porGrupo = useMemo(() => GRUPOS.map(g => {
    const rs = relatorios.filter(r => r.grupo === g)
    return { grupo: g, unidades: new Set(rs.filter(r => r.pasta).map(r => `${r.pasta}|${r.subunidade ?? ''}`)).size,
      exames: rs.reduce((s, r) => s + r.exames, 0), total: rs.reduce((s, r) => s + r.total, 0) }
  }), [relatorios])
  const chaveRel = (r: Relatorio) => `rel|${caminhoRelatorio(r, competencia)}`

  async function baixarRelatorioUnidade(r: Relatorio) {
    if (!id) return
    setBaixando(chaveRel(r)); setErro(null)
    try {
      const bytes = await xlsxDoRelatorio(id, competencia, r)
      baixarArquivo(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), caminhoRelatorio(r, competencia).split('/').pop()!)
    } catch (e) { setErro(`Falha ao gerar o relatório de ${r.pasta ?? r.nomes[0]}: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setBaixando(null) }
  }

  async function baixarRelatoriosZip() {
    if (!id || relFiltrados.length === 0) return
    setErro(null); setZip({ feitos: 0, total: relFiltrados.length })
    try {
      const arq = new JSZip()
      let feitos = 0
      await executarEmPool(relFiltrados, 2, async r => {
        arq.file(caminhoRelatorio(r, competencia), await xlsxDoRelatorio(id, competencia, r))
        setZip({ feitos: ++feitos, total: relFiltrados.length })
      })
      const blob = await arq.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      const [aaaa, mm] = competencia.split('-')
      baixarArquivo(blob, `Faturas por unidade ${mm}.${aaaa}${grupo ? ' - ' + grupo : ''}.zip`)
    } catch (e) { setErro(`Falha ao gerar o .zip: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setZip(null) }
  }

  const semContrato = pend.filter(p => p.tipo === 'unidade_desconhecida')
  const porTipo = useMemo(() => {
    const m = new Map<string, SimulacaoPendencia[]>()
    for (const p of pend) { const l = m.get(p.tipo); if (l) l.push(p); else m.set(p.tipo, [p]) }
    return [...m.entries()]
  }, [pend])

  async function baixarUm(n: SimulacaoNome) {
    if (!id) return
    setBaixando(chave(n)); setErro(null)
    try {
      const bytes = await xlsxDoNome(id, n.nome_bruto, n.periodo)
      baixarArquivo(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nomeArquivo(n.nome_bruto, competencia, n.periodo))
    } catch (e) { setErro(`Falha ao gerar o Excel de ${n.nome_bruto}: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setBaixando(null) }
  }

  async function baixarRelatorio() {
    if (!id) return
    setErro(null); setGerandoConsolidado(true)
    try { await baixarConsolidado(id) }
    catch (e) { setErro(`Falha ao gerar o relatório consolidado: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setGerandoConsolidado(false) }
  }

  async function baixarTodos() {
    if (!id || nomes.length === 0) return
    setErro(null); setZip({ feitos: 0, total: nomes.length })
    try {
      const arq = new JSZip()
      const usados = new Set<string>()
      let feitos = 0
      await executarEmPool(nomes, 2, async n => {
        const bytes = await xlsxDoNome(id, n.nome_bruto, n.periodo)
        let nome = nomeArquivo(n.nome_bruto, competencia, n.periodo)
        for (let k = 2; usados.has(nome.toLowerCase()); k++) nome = nomeArquivo(`${n.nome_bruto} (${k})`, competencia, n.periodo)
        usados.add(nome.toLowerCase())
        arq.file(`${grupoDe(n)}/${nome}`, bytes) // uma pasta por grupo da Mobilemed
        setZip({ feitos: ++feitos, total: nomes.length })
      })
      const blob = await arq.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      baixarArquivo(blob, `Faturas por nome ${competencia.slice(5, 7)}.${competencia.slice(0, 4)}.zip`)
    } catch (e) { setErro(`Falha ao gerar o .zip: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setZip(null) }
  }

  if (carregando) return <p className="text-sm text-slate-500">Carregando…</p>
  if (!sim) return <p className="text-rose-700">{erro ?? 'Relatório não encontrado.'}</p>

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link to="/faturamento/relatorios" className="text-sm text-[#1f4e78] underline">← Relatórios</Link>
        <h1 className="text-lg font-semibold">Relatório das unidades · competência {competenciaBR(sim.competencia)}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>Arquivo: <b>{sim.arquivo_nome ?? '—'}</b></span>
          <Pill texto={STATUS_SIM[sim.status]?.rotulo ?? sim.status} cor={STATUS_SIM[sim.status]?.cor ?? ''} />
          <span>Criada em {new Date(sim.criada_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span>Total: <b>{brl(sim.total_valor)}</b> · {sim.total_exames?.toLocaleString('pt-BR') ?? '—'} exames</span>
        </div>
        {sim.erro && <p className="text-sm text-rose-700">{sim.erro}</p>}
      </div>

      <button className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60" disabled={gerandoConsolidado} onClick={baixarRelatorio}>
        {gerandoConsolidado ? '📊 Gerando relatório…' : '📊 Baixar relatório consolidado (Excel)'}
      </button>

      {erro && <p className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Erro: {erro}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi rotulo="Nomes no Bruto" valor={kpis.nomes.toLocaleString('pt-BR')} />
        <Kpi rotulo="Ligados a contrato" valor={kpis.ligados.toLocaleString('pt-BR')} />
        <Kpi rotulo="Exames faturados" valor={kpis.exames.toLocaleString('pt-BR')} />
        <Kpi rotulo="Valor total" valor={brl(kpis.valor)} />
        <Kpi rotulo="Pendências" valor={pend.length.toLocaleString('pt-BR')} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {porGrupo.map(g => (
          <button key={g.grupo} onClick={() => setGrupo(grupo === g.grupo ? '' : g.grupo)}
            className={`rounded-lg border p-3 text-left transition ${grupo === g.grupo ? 'border-[#1f4e78] bg-[#1f4e78] text-white' : 'bg-white hover:border-[#1f4e78]'}`}>
            <div className={`text-xs font-semibold ${grupo === g.grupo ? 'text-white/80' : 'text-[#1f4e78]'}`}>{g.grupo}</div>
            <div className="text-xl font-semibold">{brl(g.total)}</div>
            <div className={`text-xs ${grupo === g.grupo ? 'text-white/80' : 'text-slate-500'}`}>{g.unidades} relatório(s) · {g.exames.toLocaleString('pt-BR')} exames</div>
          </button>
        ))}
      </div>
      <p className="-mt-2 text-xs text-slate-500">{grupo ? <>Mostrando só o grupo <b>{grupo}</b> — clique de novo no cartão (ou escolha “Todos os grupos”) para ver tudo.</> : 'Clique num grupo para filtrar as tabelas abaixo.'}</p>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <h2 className="mr-2 font-semibold">Relatórios por unidade ({relatorios.length})</h2>
          <select className="rounded border px-2 py-1" value={grupo} onChange={e => setGrupo(e.target.value)}>
            <option value="">Todos os grupos</option>
            {GRUPOS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <button className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50" disabled={!!zip || relFiltrados.length === 0} onClick={baixarRelatoriosZip}>
            {zip ? `Gerando ${zip.feitos}/${zip.total}…` : `Baixar relatórios ${grupo ? `de ${grupo}` : 'de todos os grupos'} (.zip, uma pasta por grupo)`}
          </button>
        </div>
        <p className="text-xs text-slate-500">Um arquivo por unidade dentro de cada grupo da Mobilemed ({GRUPOS.join(', ')}). Junta todos os nomes da unidade daquele grupo, com resumo, valor fixo, TOTAL A FATURAR e a lista de exames.</p>
        <div className="max-h-[480px] overflow-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-left text-xs text-slate-500">
              <tr><th className="p-2">Grupo</th><th>Unidade</th><th>Nomes na Mobilemed</th><th>Período</th><th className="text-right">Exames</th><th className="text-right">Total</th><th></th></tr>
            </thead>
            <tbody>
              {relFiltrados.flatMap((r, i) => {
                const fimDoGrupo = i === relFiltrados.length - 1 || relFiltrados[i + 1].grupo !== r.grupo
                const g = porGrupo.find(x => x.grupo === r.grupo)
                const linha = (
                <tr key={chaveRel(r)} className="border-t align-top">
                  <td className="p-2 whitespace-nowrap">{r.rotuloGrupo}</td>
                  <td>{r.pasta ? `${r.pasta}${r.subunidade ? ` · ${r.subunidade}` : ''}` : <span className="text-amber-700">sem contrato</span>}</td>
                  <td className="text-xs text-slate-600">{r.nomes.join(' · ')}</td>
                  <td>{r.periodo || '—'}</td>
                  <td className="text-right">{r.exames.toLocaleString('pt-BR')}</td>
                  <td className="text-right">{brl(r.total)}</td>
                  <td className="pr-2 text-right">
                    <button className="text-[#1f4e78] underline disabled:opacity-50" disabled={baixando === chaveRel(r) || !!zip} onClick={() => baixarRelatorioUnidade(r)}>
                      {baixando === chaveRel(r) ? 'gerando…' : 'Baixar'}
                    </button>
                  </td>
                </tr>)
                return fimDoGrupo && g ? [linha,
                  <tr key={`sub|${r.grupo}`} className="border-t-2 border-[#1f4e78]/30 bg-slate-100 font-semibold text-[#1f4e78]">
                    <td className="p-2" colSpan={4}>Subtotal {r.grupo}</td>
                    <td className="text-right">{g.exames.toLocaleString('pt-BR')}</td>
                    <td className="text-right">{brl(g.total)}</td><td></td>
                  </tr>] : [linha]
              })}
              {!infoAlias && <tr><td colSpan={7} className="p-4 text-center text-slate-500">Carregando grupos…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <h2 className="mr-2 font-semibold">Faturas por nome do Bruto</h2>
          <select className="rounded border px-2 py-1" value={grupo} onChange={e => setGrupo(e.target.value)}>
            <option value="">Todos os grupos</option>
            {GRUPOS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <label className="flex items-center gap-1"><input type="checkbox" checked={soPendencia} onChange={e => setSoPendencia(e.target.checked)} /> só com pendência</label>
          <input className="min-w-[200px] flex-1 rounded border px-2 py-1" placeholder="Buscar por nome ou unidade…" value={busca} onChange={e => setBusca(e.target.value)} />
          <button className="rounded bg-[#1f4e78] px-3 py-1.5 text-white disabled:opacity-50" disabled={!!zip || nomes.length === 0} onClick={baixarTodos}>
            {zip ? `Gerando ${zip.feitos}/${zip.total}…` : 'Baixar todos (.zip)'}
          </button>
        </div>
        {zip && (
          <div className="h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-[#1f4e78] transition-all" style={{ width: `${Math.round((zip.feitos / zip.total) * 100)}%` }} /></div>
        )}
        <div className="overflow-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs text-slate-500">
              <tr><th className="p-2">Grupo</th><th>Nome no Bruto</th><th>Unidade (pasta)</th><th>Período</th><th className="text-right">Exames</th><th className="text-right">Total</th><th className="text-right">Pendências</th><th></th></tr>
            </thead>
            <tbody>
              {filtradas.map(n => (
                <tr key={chave(n)} className="border-t">
                  <td className="p-2 whitespace-nowrap text-xs text-slate-600">{grupoDe(n)}</td>
                  <td>{n.nome_bruto}</td>
                  <td>{n.pasta ?? <span className="text-amber-700">sem contrato</span>}</td>
                  <td>{n.periodo || '—'}</td>
                  <td className="text-right">{(n.qtd_exames ?? 0).toLocaleString('pt-BR')}</td>
                  <td className="text-right">{brl(n.total)}</td>
                  <td className="text-right">{n.n_pendencias > 0 ? <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">{n.n_pendencias}</span> : '—'}</td>
                  <td className="pr-2 text-right">
                    <button className="text-[#1f4e78] underline disabled:opacity-50" disabled={baixando === chave(n) || !!zip} onClick={() => baixarUm(n)}>
                      {baixando === chave(n) ? 'gerando…' : 'Baixar Excel'}
                    </button>
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-500">Nenhum resultado com esses filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {semContrato.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Nomes sem contrato ({semContrato.length})</h2>
            <Link to="/faturamento" className="text-sm text-[#1f4e78] underline">Cadastre o nome na unidade em Configuração</Link>
          </div>
          <p className="text-sm text-slate-600">Estes nomes aparecem no Bruto mas não estão ligados a nenhuma unidade de contrato, então não foram faturados.</p>
          <table className="w-full rounded-lg border bg-white text-sm">
            <thead className="bg-slate-100 text-left text-xs text-slate-500"><tr><th className="p-2">Nome no Bruto</th><th className="pr-2 text-right">Exames</th></tr></thead>
            <tbody>
              {semContrato.map(p => (
                <tr key={p.id} className="border-t"><td className="p-2">{p.nome_bruto}</td><td className="pr-2 text-right">{(p.qtd_exames ?? 0).toLocaleString('pt-BR')}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {porTipo.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Pendências por tipo</h2>
          {porTipo.map(([tipo, lista]) => (
            <details key={tipo} className="rounded-lg border bg-white text-sm">
              <summary className="cursor-pointer p-2 font-medium">{TIPO_PEND[tipo] ?? tipo} <span className="ml-1 rounded bg-slate-100 px-1.5 text-xs text-slate-600">{lista.length}</span></summary>
              <ul className="space-y-1 border-t p-2">
                {lista.map(p => (
                  <li key={p.id}><b>{p.nome_bruto ?? '—'}</b> — {p.detalhe}{p.qtd_exames ? ` (${p.qtd_exames.toLocaleString('pt-BR')} exames)` : ''}</li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      )}
    </div>
  )
}
