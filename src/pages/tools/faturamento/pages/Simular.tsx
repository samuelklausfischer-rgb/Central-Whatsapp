import { useEffect, useState } from 'react'
import { Link } from '../navegacao'
import { db } from '../lib/supabase'
import { lerBrutos, mesPredominante, type ArquivoLido, type BrutosLidos } from '../lib/bruto'
import { executarEmPool } from '../lib/pool'
import { baixarConsolidado, carregarInfoAlias, simularNome, verificarFuncao, type ModoCalculo } from '../lib/simular'
import { grupoDoNome, GRUPOS, type InfoAlias } from '../lib/relatorioUnidade'
import { normNome } from '../nucleo/motor'
import { brl } from '../lib/format'

interface ResultadoNome { nome: string; unidade: string | null; faturados: number; total: number; pendencias: string[]; erro?: string; ignorado?: boolean }

function mesAnterior(): string {
  const d = new Date()
  d.setDate(1); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Simular() {
  const [competencia, setCompetencia] = useState(mesAnterior())
  const [arquivos, setArquivos] = useState<File[]>([])
  const [build, setBuild] = useState<string | null | undefined>(undefined) // undefined = verificando
  const [fase, setFase] = useState<'parado' | 'lendo' | 'calculando' | 'fim'>('parado')
  const [resumoLeitura, setResumoLeitura] = useState<{ exames: number; nomes: number; arquivos: ArquivoLido[] } | null>(null)
  const [feitos, setFeitos] = useState(0)
  const [total, setTotal] = useState(0)
  const [resultados, setResultados] = useState<ResultadoNome[]>([])
  const [simulacaoId, setSimulacaoId] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [gerandoConsolidado, setGerandoConsolidado] = useState(false)
  // leitura feita ao escolher os arquivos: detecta o mês e evita gerar setembro com o Bruto de julho
  const [lido, setLido] = useState<BrutosLidos | null>(null)
  const [detectado, setDetectado] = useState<{ competencia: string; fracao: number } | null>(null)
  const [lendoArquivo, setLendoArquivo] = useState(false)

  const [infoAlias, setInfoAlias] = useState<Map<string, InfoAlias> | null>(null)
  useEffect(() => { verificarFuncao().then(setBuild); carregarInfoAlias().then(setInfoAlias).catch(() => setInfoAlias(new Map())) }, [])
  const grupoDe = (nome: string) => grupoDoNome(nome, infoAlias?.get(normNome(nome))?.grupo, null)

  const mmaaaa = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`

  async function escolherArquivos(files: File[]) {
    setArquivos(files); setLido(null); setDetectado(null); setErro(null)
    if (!files.length) return
    setLendoArquivo(true)
    try {
      const l = await lerBrutos(files)
      setLido(l)
      const d = mesPredominante(l.linhas)
      setDetectado(d)
      if (d) setCompetencia(d.competencia)
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setLendoArquivo(false) }
  }

  async function processar() {
    if (!arquivos.length) { setErro('Escolha o(s) arquivo(s) Bruto (.xlsx).'); return }
    if (!/^\d{4}-\d{2}$/.test(competencia)) { setErro('Informe a competência.'); return }
    if (detectado && detectado.competencia !== competencia &&
      !confirm(`Os exames deste arquivo são de ${mmaaaa(detectado.competencia)} (${Math.round(detectado.fracao * 100)}% pela data do laudo), mas a competência escolhida é ${mmaaaa(competencia)}.\n\nNesse caso quase nenhum exame entra e saem só os valores fixos. Gerar mesmo assim?`)) return
    setErro(null); setResultados([]); setFeitos(0); setSimulacaoId(null); setResumoLeitura(null)
    try {
      setFase('lendo')
      const { linhas, nomes, arquivos: lidos } = lido ?? await lerBrutos(arquivos)
      if (nomes.size === 0) throw new Error('Nenhuma linha com Unidade preenchida foi encontrada no arquivo.')
      setResumoLeitura({ exames: linhas.length, nomes: nomes.size, arquivos: lidos })
      setTotal(nomes.size)

      const { data: sim, error } = await db.from('simulacao')
        .insert({ competencia: `${competencia}-01`, arquivo_nome: arquivos.map(f => f.name).join(' + '), total_nomes: nomes.size, status: 'processando' })
        .select('id').single()
      if (error || !sim) throw new Error(error?.message ?? 'Não consegui criar o relatório.')
      setSimulacaoId(sim.id)

      setFase('calculando')
      const modo: ModoCalculo = build ? 'servidor' : 'local'
      const cache = {}
      let nFeitos = 0, nFaturados = 0, nFalhas = 0, valor = 0
      await executarEmPool([...nomes.entries()], 3, async ([nome, ls]) => {
        let r: ResultadoNome
        try {
          let resp
          try { resp = await simularNome({ simulacao_id: sim.id, competencia, nome_bruto: nome, linhas: ls }, modo, cache) }
          catch { resp = await simularNome({ simulacao_id: sim.id, competencia, nome_bruto: nome, linhas: ls }, modo, cache) } // 1 nova tentativa
          r = { nome, unidade: resp.unidade ?? null, faturados: resp.faturados ?? 0, total: resp.total ?? 0, pendencias: resp.pendencias ?? [], ignorado: !!(resp as { ignorado?: boolean }).ignorado }
          nFaturados += r.faturados; valor += r.total
        } catch (e) {
          nFalhas++
          r = { nome, unidade: null, faturados: 0, total: 0, pendencias: [], erro: e instanceof Error ? e.message : String(e) }
        }
        nFeitos++
        setFeitos(nFeitos)
        setResultados(prev => [...prev, r])
      })
      const { error: e2 } = await db.from('simulacao').update({
        status: nFalhas ? 'erro' : 'concluida', nomes_feitos: nFeitos - nFalhas, total_exames: nFaturados,
        total_valor: Math.round(valor * 100) / 100, erro: nFalhas ? `${nFalhas} nome(s) falharam` : null,
      }).eq('id', sim.id)
      if (e2) throw new Error(e2.message)
      setFase('fim')
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e)); setFase('parado')
    }
  }

  async function relatorioConsolidado() {
    if (!simulacaoId) return
    setErro(null); setGerandoConsolidado(true)
    try { await baixarConsolidado(simulacaoId) }
    catch (e) { setErro(`Falha ao gerar o relatório consolidado: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setGerandoConsolidado(false) }
  }

  const ocupado = fase === 'lendo' || fase === 'calculando'
  const falhas = resultados.filter(r => r.erro).length
  const pct = total ? Math.round((feitos / total) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Gerar relatório das unidades</h1>
        <Link to="/faturamento/relatorios" className="text-sm text-[#1f4e78] underline">Ver relatórios anteriores</Link>
      </div>

      <p className="text-xs text-slate-500">O cálculo roda no servidor (função fat-simular), com as mesmas regras do app de testes.</p>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Competência</span>
          <input type="month" className="rounded border px-2 py-1" value={competencia} disabled={ocupado} onChange={e => setCompetencia(e.target.value)} />
        </label>
        <label className="flex min-w-[260px] flex-1 flex-col gap-1">
          <span className="text-xs text-slate-500">Arquivos Bruto (.xlsx da Mobilemed) — selecione os 4 grupos juntos: PRN, PRN Ápice Tele, Medimagem, Medimagem Ápice Tele</span>
          <input type="file" accept=".xlsx" multiple className="rounded border px-2 py-1" disabled={ocupado} onChange={e => escolherArquivos([...(e.target.files ?? [])])} />
        </label>
        <button className="rounded bg-[#1f4e78] px-4 py-1.5 text-white disabled:opacity-50" onClick={processar} disabled={ocupado || lendoArquivo || build === undefined || !arquivos.length}>
          {ocupado ? 'Processando…' : lendoArquivo ? 'Lendo arquivo…' : 'Processar'}
        </button>
      </div>
      {detectado && (
        <p className={`rounded-lg border p-2 text-sm ${detectado.competencia === competencia ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          📅 Pelas datas do laudo, os exames deste arquivo são de <b>{mmaaaa(detectado.competencia)}</b> ({Math.round(detectado.fracao * 100)}% dos exames).
          {detectado.competencia === competencia
            ? ' A competência já foi preenchida com esse mês.'
            : <> A competência escolhida é <b>{mmaaaa(competencia)}</b>: assim quase nenhum exame entra no relatório. <button className="underline" onClick={() => setCompetencia(detectado.competencia)}>Usar {mmaaaa(detectado.competencia)}</button></>}
        </p>
      )}
      <p className="text-xs text-slate-500">Os arquivos são lidos aqui no navegador e enviados aos poucos, um nome de unidade por vez. Os relatórios ficam guardados por 30 dias.</p>

      {erro && <p className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Erro: {erro}</p>}
      {resumoLeitura && (
        <div className="space-y-1 text-sm">
          <p>Lido: <b>{resumoLeitura.exames.toLocaleString('pt-BR')}</b> exames em <b>{resumoLeitura.nomes}</b> nomes de unidade.</p>
          <table className="text-xs text-slate-600">
            <tbody>
              {resumoLeitura.arquivos.map(a => (
                <tr key={a.nome}>
                  <td className="pr-3">{a.grupo || 'grupo não informado'}</td>
                  <td className="pr-3">{a.nome}</td>
                  <td className="pr-3 text-right">{a.exames.toLocaleString('pt-BR')} exames</td>
                  <td>{a.repetidos ? `${a.repetidos.toLocaleString('pt-BR')} já vieram em outro arquivo (não contados de novo)` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fase !== 'parado' && total > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm"><span>Progresso: {feitos}/{total}</span><span>{pct}%</span></div>
          <div className="h-3 overflow-hidden rounded bg-slate-200"><div className="h-full bg-[#1f4e78] transition-all" style={{ width: `${pct}%` }} /></div>
          {fase === 'fim' && (
            <div className="flex items-center gap-3 pt-1 text-sm">
              <span>{falhas ? `Concluída com ${falhas} falha(s).` : 'Concluída.'}</span>
              {simulacaoId && <Link to={`/faturamento/relatorio/${simulacaoId}`} className="rounded bg-emerald-700 px-3 py-1.5 text-white">Abrir relatório das unidades</Link>}
              {simulacaoId && (
                <button className="rounded bg-[#1f4e78] px-3 py-1.5 text-white disabled:opacity-60" disabled={gerandoConsolidado} onClick={relatorioConsolidado}>
                  {gerandoConsolidado ? '📊 Gerando…' : '📊 Relatório consolidado'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {resultados.length > 0 && (
        <div className="max-h-[420px] overflow-auto rounded-lg border bg-white text-sm">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-100 text-left text-xs text-slate-500">
              <tr><th className="p-2">Grupo</th><th>Nome no Bruto</th><th>Unidade (contrato)</th><th className="text-right">Faturados</th><th className="text-right">Total</th><th className="pr-2 text-right">Situação</th></tr>
            </thead>
            <tbody>
              {GRUPOS.flatMap(g => {
                const doGrupo = resultados.filter(r => grupoDe(r.nome) === g).sort((a, b) => a.nome.localeCompare(b.nome))
                if (!doGrupo.length) return []
                const sub = (
                  <tr key={`sub|${g}`} className="border-t-2 border-[#1f4e78]/30 bg-slate-100 font-semibold text-[#1f4e78]">
                    <td className="p-2" colSpan={3}>Subtotal {g} · {doGrupo.length} nome(s)</td>
                    <td className="text-right">{doGrupo.reduce((s, r) => s + (r.erro ? 0 : r.faturados), 0).toLocaleString('pt-BR')}</td>
                    <td className="text-right">{brl(doGrupo.reduce((s, r) => s + (r.erro ? 0 : r.total), 0))}</td><td></td>
                  </tr>)
                return [...doGrupo.map(r => (
                <tr key={r.nome} className="border-t">
                  <td className="p-2 whitespace-nowrap text-xs text-slate-600">{g}</td>
                  <td>{r.nome}</td>
                  <td>{r.erro ? <span className="text-rose-700">{r.erro}</span> : r.ignorado ? <span className="text-slate-400">ignorado (fora do faturamento)</span> : r.unidade ?? <span className="text-amber-700">sem contrato</span>}</td>
                  <td className="text-right">{r.erro ? '—' : r.faturados.toLocaleString('pt-BR')}</td>
                  <td className="text-right">{r.erro ? '—' : brl(r.total)}</td>
                  <td className="pr-2 text-right text-xs">{r.erro ? 'erro' : r.pendencias.length ? `${r.pendencias.length} pendência(s)` : 'ok'}</td>
                </tr>
                )), sub]
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
