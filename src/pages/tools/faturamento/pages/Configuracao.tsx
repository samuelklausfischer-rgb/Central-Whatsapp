import { useEffect, useMemo, useState } from 'react'
import { Link } from '../navegacao'
import { db } from '../lib/supabase'
import { paginar } from '../lib/pool'
import type { Alias, PrecoVigente, RegrasUnidade, UnidadeResumo } from '../lib/tipos'
import { MODELO, SITUACAO, brl, dataBR, hojeISO } from '../lib/format'
import { BLOCOS_PRECO, agruparUnidades, comoFatura, etiquetasRegras, modeloComum, resumoPreco } from '../lib/config'
import { Pill } from '../components/Pill'

type AliasLinha = Pick<Alias, 'nome_bruto' | 'unidade_id' | 'subunidade' | 'principal'>

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export default function Configuracao() {
  const [unidades, setUnidades] = useState<UnidadeResumo[]>([])
  const [regras, setRegras] = useState<Map<string, RegrasUnidade>>(new Map())
  const [precos, setPrecos] = useState<Map<string, PrecoVigente[]>>(new Map())
  const [aliases, setAliases] = useState<Map<string, AliasLinha[]>>(new Map())
  const [dataRef, setDataRef] = useState(hojeISO())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [situacao, setSituacao] = useState('')
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(new Set())
  const [unidadesAbertas, setUnidadesAbertas] = useState<Set<string>>(new Set())

  // Cadastro (unidades, regras e nomes) — não depende da data
  useEffect(() => {
    ;(async () => {
      try {
        const [us, rs, as] = await Promise.all([
          paginar<UnidadeResumo>((de, ate) => db.from('v_unidade_resumo').select('*').order('pasta').order('id').range(de, ate)),
          paginar<RegrasUnidade>((de, ate) => db.from('unidade').select('id, janela, criterio_data, franquia_mensal').order('id').range(de, ate)),
          paginar<AliasLinha>((de, ate) => db.from('alias').select('nome_bruto, unidade_id, subunidade, principal').order('nome_bruto').range(de, ate)),
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

  const grupos = useMemo(() => {
    const q = norm(busca.trim())
    const passaFiltro = (u: UnidadeResumo) => (!empresa || u.empresa === empresa) && (!situacao || u.situacao === situacao)
    const casaUnidade = (u: UnidadeResumo) => !q
      || norm(`${u.pasta} ${u.orgao ?? ''}`).includes(q)
      || (aliases.get(u.id) ?? []).some(a => norm(a.nome_bruto).includes(q))
    return agruparUnidades(unidades)
      .map(g => {
        const grupoCasa = !!q && norm(g.nome).includes(q)
        return { ...g, unidades: g.unidades.filter(u => passaFiltro(u) && (grupoCasa || casaUnidade(u))) }
      })
      .filter(g => g.unidades.length > 0)
  }, [unidades, aliases, busca, empresa, situacao])

  const totalMostradas = grupos.reduce((s, g) => s + g.unidades.length, 0)

  function alternar(set: Set<string>, k: string, atualizar: (s: Set<string>) => void) {
    const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k)
    atualizar(n)
  }

  if (erro) return <p className="text-rose-700">Erro ao carregar: {erro}</p>
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Configuração dos contratos</h1>
        <p className="text-sm text-slate-600">Cada grupo reúne as unidades de um mesmo contrato. Abra uma unidade para ver os valores por exame, o valor fixo e como ela fatura.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input className="min-w-[240px] flex-1 rounded border bg-white px-2 py-1" placeholder="Buscar grupo, unidade, órgão ou nome do Bruto…"
          value={busca} onChange={e => setBusca(e.target.value)} />
        <select className="rounded border bg-white px-2 py-1" value={empresa} onChange={e => setEmpresa(e.target.value)}>
          <option value="">Todas as empresas</option><option value="PRN">PRN</option><option value="MEDIMAGEM">MedImagem</option></select>
        <select className="rounded border bg-white px-2 py-1" value={situacao} onChange={e => setSituacao(e.target.value)}>
          <option value="">Qualquer situação</option>
          {Object.entries(SITUACAO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}</select>
        <label className="text-slate-600">valores vigentes em{' '}
          <input type="date" className="rounded border bg-white px-1 py-0.5" value={dataRef} onChange={e => e.target.value && setDataRef(e.target.value)} /></label>
      </div>

      {carregando && !unidades.length ? <p className="text-sm text-slate-500">Carregando…</p> : (
        <>
          <div className="space-y-3">
            {grupos.map(g => {
              const aberto = gruposAbertos.has(g.nome)
              const modelo = modeloComum(g.unidades)
              return (
                <section key={g.nome} className="overflow-hidden rounded-lg border bg-white">
                  <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" aria-expanded={aberto}
                    onClick={() => alternar(gruposAbertos, g.nome, setGruposAbertos)}>
                    <span className="w-4 text-slate-400">{aberto ? '▾' : '▸'}</span>
                    <span className="font-semibold">{g.nome}</span>
                    <span className="text-xs text-slate-500">{g.unidades.length} {g.unidades.length === 1 ? 'unidade' : 'unidades'}</span>
                    {modelo && <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{MODELO[modelo] ?? modelo}</span>}
                  </button>
                  {aberto && (
                    <ul className="divide-y border-t">
                      {g.unidades.map(u => (
                        <LinhaUnidade key={u.id} u={u} regras={regras.get(u.id)} itens={precos.get(u.id) ?? []} nomes={aliases.get(u.id) ?? []}
                          aberta={unidadesAbertas.has(u.id)} dataRef={dataRef}
                          onAlternar={() => alternar(unidadesAbertas, u.id, setUnidadesAbertas)} />
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
            {!grupos.length && <p className="rounded-lg border bg-white p-4 text-center text-sm text-slate-500">Nenhum grupo ou unidade com esses filtros.</p>}
          </div>
          <p className="text-xs text-slate-500">{grupos.length} grupos · {totalMostradas} de {unidades.length} unidades{carregando ? ' · atualizando valores…' : ''}</p>
        </>
      )}
    </div>
  )
}

function LinhaUnidade({ u, regras, itens, nomes, aberta, dataRef, onAlternar }: {
  u: UnidadeResumo; regras: RegrasUnidade | undefined; itens: PrecoVigente[]; nomes: AliasLinha[]
  aberta: boolean; dataRef: string; onAlternar: () => void
}) {
  const etiquetas = etiquetasRegras(regras)
  return (
    <li>
      <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 pl-8 text-left text-sm hover:bg-slate-50" aria-expanded={aberta} onClick={onAlternar}>
        <span className="w-4 text-slate-400">{aberta ? '▾' : '▸'}</span>
        <span className="font-medium">{u.pasta}</span>
        <span className="text-xs text-slate-500">{u.empresa === 'MEDIMAGEM' ? 'MedImagem' : 'PRN'}</span>
        <Pill texto={SITUACAO[u.situacao]?.rotulo ?? u.situacao} cor={SITUACAO[u.situacao]?.cor ?? ''} />
        <span className="text-xs text-slate-600">{MODELO[u.modelo_cobranca] ?? u.modelo_cobranca}</span>
        <span className="text-xs font-medium text-slate-800">{resumoPreco(u, itens)}</span>
        {etiquetas.map(e => <span key={e} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">{e}</span>)}
      </button>
      {aberta && (
        <div className="space-y-4 bg-slate-50 px-4 py-3 pl-12 text-sm">
          {BLOCOS_PRECO.map(b => {
            const linhas = itens.filter(i => i.papel === b.papel)
            if (!linhas.length) return null
            return (
              <div key={b.papel}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{b.titulo}</h3>
                <table className="w-full rounded border bg-white">
                  <thead className="text-left text-xs text-slate-500">
                    <tr><th className="p-1.5">Exame</th><th>Modalidade</th><th className="text-right">Valor original</th><th className="text-right">Valor vigente</th><th className="pl-3">Vigente desde</th></tr>
                  </thead>
                  <tbody>
                    {linhas.map(i => (
                      <tr key={i.item_preco_id} className="border-t">
                        <td className="p-1.5">{i.exame}</td><td>{i.modalidade ?? '—'}</td>
                        <td className="text-right text-slate-500">{brl(i.valor_original)}</td>
                        <td className="text-right font-semibold text-slate-900">{brl(i.valor)}</td>
                        <td className="pl-3 text-slate-600">{dataBR(i.vigente_desde)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
          {!itens.length && <p className="italic text-slate-500">{u.n_itens > 0 ? `Nenhum valor vigente em ${dataBR(dataRef)}.` : 'Esta unidade não tem itens de preço cadastrados.'}</p>}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Como fatura</h3>
              <dl className="space-y-0.5">
                {comoFatura(u.modelo_cobranca, regras).map(l => (
                  <div key={l.rotulo} className="flex gap-2"><dt className="w-40 shrink-0 text-slate-500">{l.rotulo}</dt><dd>{l.texto}</dd></div>
                ))}
              </dl>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Nomes no relatório da Mobilemed</h3>
              {nomes.length ? (
                <ul className="space-y-0.5">
                  {nomes.map(a => (
                    <li key={a.nome_bruto}>{a.nome_bruto}
                      {a.subunidade && <span className="text-slate-500"> · {a.subunidade}</span>}
                      {a.principal && <span className="ml-1 rounded bg-emerald-100 px-1 text-[11px] text-emerald-800">principal</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="italic text-slate-500">Nenhum nome cadastrado.</p>}
            </div>
          </div>
          <Link to={`/faturamento/unidade/${u.id}`} className="inline-block text-[#1f4e78] underline">Abrir detalhes e editar →</Link>
        </div>
      )}
    </li>
  )
}
