import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from '../navegacao'
import { db } from '../lib/supabase'
import type { Alias, Evento, ItemVigente, PapelItem, Pendencia, RegrasUnidade, UnidadeResumo } from '../lib/tipos'
import { GRUPOS, grupoDoNome, type Grupo } from '../lib/relatorioUnidade'
import { MODELO, SITUACAO, TIPOS_EVENTO, brl, dataBR, hojeISO } from '../lib/format'
import { ROTULO_JANELA, ROTULO_PAPEL } from '../lib/config'
import { Pill } from '../components/Pill'

export default function Unidade() {
  const { id } = useParams<{ id: string }>()
  const [u, setU] = useState<UnidadeResumo | null>(null)
  const [itens, setItens] = useState<ItemVigente[]>([])
  const [eventos, setEventos] = useState<Evento[]>([])
  const [pend, setPend] = useState<Pendencia[]>([])
  const [regras, setRegras] = useState<RegrasUnidade | null>(null)
  const [nomes, setNomes] = useState<Alias[]>([])
  const [papeis, setPapeis] = useState<Map<string, PapelItem>>(new Map())
  const [dataRef, setDataRef] = useState(hojeISO())
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!id) return
    const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
      db.from('v_unidade_resumo').select('*').eq('id', id).single(),
      db.rpc('preco_vigente', { p_unidade: id, p_data: dataRef }),
      db.from('evento').select('*, evento_valor(valor, item_preco(exame))').eq('unidade_id', id)
        .order('data_referencia', { nullsFirst: false }).order('ordem'),
      db.from('pendencia_cadastro').select('*').eq('unidade_id', id).order('resolvida').order('tipo'),
      // as colunas novas ficam na tabela (a view v_unidade_resumo não as traz)
      db.from('unidade').select('id, janela, criterio_data, franquia_mensal, todos_status, estudos_conta_2').eq('id', id).single(),
      db.from('alias').select('*').eq('unidade_id', id).order('nome_bruto'),
      db.from('item_preco').select('id, papel').eq('unidade_id', id),
    ])
    const e = r1.error || r2.error || r3.error || r4.error || r5.error || r6.error || r7.error
    if (e) { setErro(e.message); return }
    setU(r1.data as unknown as UnidadeResumo); setItens((r2.data ?? []) as unknown as ItemVigente[])
    setEventos((r3.data ?? []) as unknown as Evento[]); setPend((r4.data ?? []) as unknown as Pendencia[])
    setRegras(r5.data as unknown as RegrasUnidade); setNomes((r6.data ?? []) as unknown as Alias[])
    setPapeis(new Map(((r7.data ?? []) as unknown as { id: string; papel: PapelItem }[]).map(x => [x.id, x.papel])))
  }, [id, dataRef])

  useEffect(() => { carregar() }, [carregar])

  async function salvar(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p
    if (error) setErro(error.message); else { setErro(null); carregar() }
  }

  if (erro) return <p className="text-rose-700">Erro: {erro} <button className="underline" onClick={() => { setErro(null); carregar() }}>tentar de novo</button></p>
  if (!u || !regras) return <p>Carregando…</p>

  return (
    <div className="space-y-6">
      <Link to="/faturamento" className="text-sm text-[#1f4e78] hover:underline">← Configuração</Link>
      <section className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{u.pasta}</h1>
          <span className="text-sm text-slate-500">{u.empresa}{u.grupo ? ` · ${u.grupo}` : ''}</span>
          <Pill texto={SITUACAO[u.situacao]?.rotulo ?? u.situacao} cor={SITUACAO[u.situacao]?.cor ?? ''} />
          {u.situacao_manual && <span className="text-xs text-slate-500">(definida à mão)</span>}
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
          <div><dt className="text-xs text-slate-500">Órgão</dt><dd>{u.orgao ?? '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">Contrato</dt><dd>{u.numero_contrato ?? '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">Vigência</dt><dd>{dataBR(u.vigencia_inicio)} a {dataBR(u.vigencia_fim)}</dd></div>
          <div><dt className="text-xs text-slate-500">Modelo</dt><dd>{MODELO[u.modelo_cobranca]}</dd></div>
          <div><dt className="text-xs text-slate-500">Valor total</dt><dd>{brl(u.valor_total)}</dd></div>
          <div><dt className="text-xs text-slate-500">Pasta</dt><dd>{u.sharepoint_url ? <a className="text-[#1f4e78] underline" href={encodeURI(u.sharepoint_url)} target="_blank">abrir no SharePoint</a> : '—'}</dd></div>
        </dl>
        <FormSituacao u={u} onSalvar={(sit, motivo) => salvar(db.from('unidade').update({ situacao: sit, motivo_situacao: motivo, situacao_manual: true, atualizado_em: new Date().toISOString() }).eq('id', u.id))} />
      </section>

      <FormRegras key={`${u.id}|${u.modelo_cobranca}|${regras.janela}|${regras.criterio_data}|${regras.franquia_mensal}|${regras.todos_status}|${regras.estudos_conta_2}`} u={u} regras={regras}
        onSalvar={(r, modelo) => salvar(db.from('unidade').update({ janela: r.janela, criterio_data: r.criterio_data, franquia_mensal: r.franquia_mensal, todos_status: r.todos_status, estudos_conta_2: r.estudos_conta_2, modelo_cobranca: modelo, atualizado_em: new Date().toISOString() }).eq('id', u.id))} />

      <SecaoNomes nomes={nomes} empresa={u.empresa}
        onAdicionar={(nome_bruto, subunidade, principal, grupo) => salvar(db.from('alias').insert({ nome_bruto, unidade_id: u.id, subunidade, principal, grupo }))}
        onRemover={a => { if (confirm(`Remover o nome ${a.nome_bruto}?`)) salvar(db.from('alias').delete().eq('id', a.id)) }}
        onPrincipal={(a, v) => salvar(db.from('alias').update({ principal: v }).eq('id', a.id))}
        onGrupo={(a, g) => salvar(db.from('alias').update({ grupo: g }).eq('id', a.id))} />

      <section className="rounded-lg border bg-white p-4">
        <div className="mb-2 flex items-center gap-3">
          <h2 className="font-semibold">Preços</h2>
          <label className="text-sm text-slate-600">preço vigente em <input type="date" className="rounded border px-1" value={dataRef} onChange={e => setDataRef(e.target.value)} /></label>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th>Exame / item</th><th>Tipo</th><th>Mod.</th><th className="text-right">Original</th><th className="text-right">Vigente</th><th>Desde</th><th>Definido por</th></tr></thead>
          <tbody>
            {itens.map(i => (
              <tr key={i.item_preco_id} className="border-t">
                <td className="py-1">{i.exame}</td><td className="text-xs text-slate-600">{ROTULO_PAPEL[papeis.get(i.item_preco_id) ?? 'normal']}</td><td>{i.modalidade}</td>
                <td className="text-right"><EditarValor valor={i.valor_original} onSalvar={v => salvar(db.from('item_preco').update({ valor_original: v }).eq('id', i.item_preco_id))} /></td>
                <td className="text-right font-semibold">{brl(i.valor)}</td>
                <td>{dataBR(i.vigente_desde)}</td><td className="text-xs text-slate-500">{i.definido_por}</td>
              </tr>
            ))}
            {!itens.length && <tr><td colSpan={7} className="py-2 italic text-slate-500">Nenhum item de preço.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 font-semibold">Aditivos e termos</h2>
        <ul className="space-y-2 text-sm">
          {eventos.map(e => (
            <li key={e.id} className="border-l-2 border-slate-200 pl-3">
              <b>{dataBR(e.data_referencia)}</b> <span className="text-xs text-slate-500">({e.qualidade_data})</span> · {e.numero ?? e.tipo} · <i>{e.tipo}</i>
              {e.percentual != null && <> · <b>{e.percentual}%</b> {e.indice ?? ''}</>}
              {e.evento_valor.length > 0 && <div className="text-xs">{e.evento_valor.map(v => `${v.item_preco?.exame ?? '?'}: ${brl(v.valor)}`).join(' · ')}</div>}
              <div className="text-xs text-slate-500">{e.objeto} {e.fonte_doc ? `· ${e.fonte_doc}` : ''}</div>
              <button className="text-xs text-rose-700 underline" onClick={() => { if (confirm('Apagar este termo?')) salvar(db.from('evento').delete().eq('id', e.id)) }}>apagar</button>
            </li>
          ))}
          {!eventos.length && <li className="italic text-slate-500">Sem termos.</li>}
        </ul>
        <FormEvento itens={itens} proximaOrdem={eventos.length} onSalvar={async (ev, valores) => {
          const { data, error } = await db.from('evento').insert({ ...ev, unidade_id: u.id }).select('id').single()
          if (error) { setErro(error.message); return }
          if (valores.length) await salvar(db.from('evento_valor').insert(valores.map(v => ({ evento_id: data!.id, ...v }))))
          else carregar()
        }} />
      </section>

      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 font-semibold">Pendências</h2>
        <ul className="space-y-1 text-sm">
          {pend.map(p => (
            <li key={p.id} className={p.resolvida ? 'text-slate-400 line-through' : ''}>
              <span className="mr-1 rounded bg-slate-100 px-1 text-xs">{p.tipo}</span>{p.detalhe}
              {!p.resolvida && <button className="ml-2 text-xs text-emerald-700 underline" onClick={() => {
                const nota = prompt('Como foi resolvida?') ?? ''
                salvar(db.from('pendencia_cadastro').update({ resolvida: true, resolvida_em: new Date().toISOString(), nota }).eq('id', p.id))
              }}>resolver</button>}
              {p.nota && <span className="ml-2 text-xs text-slate-500">nota: {p.nota}</span>}
            </li>
          ))}
          {!pend.length && <li className="italic text-slate-500">Nenhuma.</li>}
        </ul>
      </section>

      {u.observacoes?.length > 0 && (
        <details className="rounded-lg border bg-white p-4 text-sm"><summary className="cursor-pointer font-semibold">Observações da leitura ({u.observacoes.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{u.observacoes.map((o, k) => <li key={k}>{o}</li>)}</ul></details>
      )}
    </div>
  )
}

function FormSituacao({ u, onSalvar }: { u: UnidadeResumo; onSalvar: (sit: string, motivo: string) => void }) {
  const [sit, setSit] = useState(u.situacao); const [motivo, setMotivo] = useState(u.motivo_situacao ?? '')
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-slate-500">Mudar situação:</span>
      <select className="rounded border px-1" value={sit} onChange={e => setSit(e.target.value)}>
        {Object.entries(SITUACAO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}</select>
      <input className="min-w-[260px] flex-1 rounded border px-2" placeholder="motivo (ex.: renovado até 12/2027 — ofício X)" value={motivo} onChange={e => setMotivo(e.target.value)} />
      <button className="rounded bg-[#1f4e78] px-3 py-1 text-white" onClick={() => onSalvar(sit, motivo)}>Salvar</button>
    </div>
  )
}

function EditarValor({ valor, onSalvar }: { valor: number | null; onSalvar: (v: number | null) => void }) {
  const [editando, setEditando] = useState(false); const [txt, setTxt] = useState(valor?.toString() ?? '')
  if (!editando) return <button className="hover:underline" title="editar valor original" onClick={() => setEditando(true)}>{brl(valor)}</button>
  return (
    <span className="inline-flex gap-1">
      <input className="w-24 rounded border px-1 text-right" value={txt} onChange={e => setTxt(e.target.value)} />
      <button className="text-xs text-emerald-700" onClick={() => { const n = txt.trim() === '' ? null : Number(txt.replace(',', '.')); if (n === null || !Number.isNaN(n)) { onSalvar(n); setEditando(false) } }}>ok</button>
      <button className="text-xs text-slate-500" onClick={() => setEditando(false)}>x</button>
    </span>
  )
}

type NovoEvento = { tipo: string; numero: string | null; data_assinatura: string | null; data_efeito: string | null; percentual: number | null; indice: string | null; objeto: string | null; ordem: number }

function FormEvento({ itens, proximaOrdem, onSalvar }: { itens: ItemVigente[]; proximaOrdem: number; onSalvar: (ev: NovoEvento, valores: { item_preco_id: string; valor: number }[]) => void }) {
  const [aberto, setAberto] = useState(false)
  const [f, setF] = useState({ tipo: 'reajuste', numero: '', data_assinatura: '', data_efeito: '', percentual: '', indice: '', objeto: '' })
  const [valores, setValores] = useState<Record<string, string>>({})
  if (!aberto) return <button className="mt-3 text-sm text-[#1f4e78] underline" onClick={() => setAberto(true)}>+ adicionar termo</button>
  const n = (s: string) => (s.trim() === '' ? null : s)
  return (
    <div className="mt-3 space-y-2 rounded border bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <select className="rounded border px-1" value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>{TIPOS_EVENTO.map(t => <option key={t}>{t}</option>)}</select>
        <input className="rounded border px-1" placeholder="número (ex.: 3º TA)" value={f.numero} onChange={e => setF({ ...f, numero: e.target.value })} />
        <label>assinatura <input type="date" className="rounded border px-1" value={f.data_assinatura} onChange={e => setF({ ...f, data_assinatura: e.target.value })} /></label>
        <label>efeito <input type="date" className="rounded border px-1" value={f.data_efeito} onChange={e => setF({ ...f, data_efeito: e.target.value })} /></label>
        <input className="w-20 rounded border px-1" placeholder="%" value={f.percentual} onChange={e => setF({ ...f, percentual: e.target.value })} />
        <input className="w-24 rounded border px-1" placeholder="índice" value={f.indice} onChange={e => setF({ ...f, indice: e.target.value })} />
      </div>
      <input className="w-full rounded border px-1" placeholder="o que o termo faz" value={f.objeto} onChange={e => setF({ ...f, objeto: e.target.value })} />
      <div className="text-xs text-slate-500">Valores novos escritos no termo (deixe vazio para usar só o %):</div>
      <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
        {itens.map(i => (
          <label key={i.item_preco_id} className="flex items-center gap-2"><span className="flex-1 truncate">{i.exame}</span>
            <input className="w-24 rounded border px-1 text-right" value={valores[i.item_preco_id] ?? ''} onChange={e => setValores({ ...valores, [i.item_preco_id]: e.target.value })} /></label>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="rounded bg-[#1f4e78] px-3 py-1 text-white" onClick={() => {
          const vals = Object.entries(valores).filter(([, v]) => v.trim() !== '').map(([k, v]) => ({ item_preco_id: k, valor: Number(v.replace(',', '.')) }))
          if (vals.some(v => Number.isNaN(v.valor))) { alert('Valor inválido'); return }
          onSalvar({ tipo: f.tipo, numero: n(f.numero), data_assinatura: n(f.data_assinatura), data_efeito: n(f.data_efeito),
            percentual: f.percentual.trim() ? Number(f.percentual.replace(',', '.')) : null, indice: n(f.indice), objeto: n(f.objeto), ordem: proximaOrdem }, vals)
          setAberto(false); setValores({})
        }}>Salvar termo</button>
        <button className="text-slate-500" onClick={() => setAberto(false)}>cancelar</button>
      </div>
    </div>
  )
}

function FormRegras({ u, regras, onSalvar }: {
  u: UnidadeResumo; regras: RegrasUnidade
  onSalvar: (r: { janela: RegrasUnidade['janela']; criterio_data: RegrasUnidade['criterio_data']; franquia_mensal: number | null; todos_status: boolean; estudos_conta_2: string | null }, modelo: string) => void
}) {
  const [janela, setJanela] = useState(regras.janela)
  const [criterio, setCriterio] = useState<string>(regras.criterio_data ?? '')
  const [franquia, setFranquia] = useState(regras.franquia_mensal?.toString() ?? '')
  const [modelo, setModelo] = useState(u.modelo_cobranca)
  const [todos, setTodos] = useState(regras.todos_status)
  const [conta2, setConta2] = useState(regras.estudos_conta_2 ?? '')
  const campo = 'rounded border px-2 py-1'
  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="mb-1 font-semibold">Regras de faturamento</h2>
      <p className="mb-3 text-xs text-slate-500">Usadas no cálculo do relatório. Em "Automático", preço por exame usa a data do laudo e valor fixo usa a data do exame.</p>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Janela do período</span>
          <select className={campo} value={janela} onChange={e => setJanela(e.target.value as RegrasUnidade['janela'])}>
            {Object.entries(ROTULO_JANELA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Data que define o mês</span>
          <select className={campo} value={criterio} onChange={e => setCriterio(e.target.value)}>
            <option value="">Automático</option><option value="laudo">Data do laudo</option><option value="exame">Data do exame</option></select></label>
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Franquia mensal (exames)</span>
          <input className={`${campo} w-32`} inputMode="numeric" placeholder="sem franquia" value={franquia} onChange={e => setFranquia(e.target.value)} /></label>
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Modelo de cobrança</span>
          <select className={campo} value={modelo} onChange={e => setModelo(e.target.value)}>
            {Object.entries(MODELO).map(([k, v]) => <option key={k} value={k}>{k === 'nao_identificado' ? 'Não identificado' : v}</option>)}</select></label>
        <label className="flex items-center gap-2 pb-1" title="Cobra também exames sem laudo assinado (À Preparar, Pendente…). Valor fixo mensal já cobra todos.">
          <input type="checkbox" checked={todos} onChange={e => setTodos(e.target.checked)} />
          <span>Cobra todos os status</span></label>
        <label className="flex flex-col gap-1" title="Separe por | . Ex.: ABDOME TOTAL|TRIFASICO (sem acento, maiúsculas)"><span className="text-xs text-slate-500">Estudos que contam 2</span>
          <input className={`${campo} w-64`} placeholder="ex.: ABDOME TOTAL|TRIFASICO" value={conta2} onChange={e => setConta2(e.target.value)} /></label>
        <button className="rounded bg-[#1f4e78] px-3 py-1.5 text-white" onClick={() => {
          const txt = franquia.trim()
          const n = txt === '' ? null : Number(txt.replace(/\./g, '').replace(',', '.'))
          if (n !== null && (!Number.isInteger(n) || n <= 0)) { alert('Franquia deve ser um número inteiro maior que zero (ou vazio)'); return }
          onSalvar({ janela, criterio_data: criterio === '' ? null : (criterio as 'laudo' | 'exame'), franquia_mensal: n, todos_status: todos, estudos_conta_2: conta2.trim() || null }, modelo)
        }}>Salvar</button>
      </div>
    </section>
  )
}

function SecaoNomes({ nomes, empresa, onAdicionar, onRemover, onPrincipal, onGrupo }: {
  nomes: Alias[]; empresa: string
  onAdicionar: (nome: string, subunidade: string | null, principal: boolean, grupo: Grupo) => void
  onRemover: (a: Alias) => void; onPrincipal: (a: Alias, v: boolean) => void; onGrupo: (a: Alias, g: Grupo) => void
}) {
  const [nome, setNome] = useState(''); const [sub, setSub] = useState(''); const [principal, setPrincipal] = useState(false)
  const [grupo, setGrupo] = useState<Grupo | ''>('')
  const grupoDe = (a: Alias) => grupoDoNome(a.nome_bruto, a.grupo, empresa)
  const campo = 'rounded border bg-white px-1 py-0.5 text-xs'
  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="mb-1 font-semibold">Nomes no relatório da Mobilemed</h2>
      <p className="mb-3 text-xs text-slate-500">Como esta unidade aparece na coluna Unidade do Bruto, separados pelos 4 grupos da Mobilemed. Cada grupo gera o seu próprio relatório da unidade. Nome sem cadastro aqui vira pendência no relatório. O nome "principal" recebe o valor fixo mensal.</p>
      <div className="mb-3 grid gap-3 md:grid-cols-2">
        {GRUPOS.map(g => {
          const doGrupo = nomes.filter(a => grupoDe(a) === g)
          return (
            <div key={g} className="rounded border p-2">
              <div className="mb-1 flex items-center justify-between text-xs font-semibold text-[#1f4e78]">
                <span>{g}</span><span className="font-normal text-slate-500">{doGrupo.length} nome(s)</span>
              </div>
              <ul className="space-y-1 text-sm">
                {doGrupo.map(a => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <b className="break-all">{a.nome_bruto}</b>
                    {a.subunidade && <span className="text-slate-500">· {a.subunidade}</span>}
                    {a.incerto && <span className="rounded bg-amber-100 px-1 text-xs text-amber-800">incerto</span>}
                    <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={a.principal} onChange={e => onPrincipal(a, e.target.checked)} /> principal</label>
                    <select className={campo} title="Mudar o grupo deste nome" value={g} onChange={e => onGrupo(a, e.target.value as Grupo)}>
                      {GRUPOS.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                    <button className="text-xs text-rose-700 underline" onClick={() => onRemover(a)}>remover</button>
                  </li>
                ))}
                {!doGrupo.length && <li className="text-xs italic text-slate-400">nenhum nome neste grupo</li>}
              </ul>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded border bg-slate-50 p-2 text-sm">
        <input className="min-w-[240px] flex-1 rounded border bg-white px-2 py-1" placeholder="Nome exatamente como no Bruto" value={nome} onChange={e => setNome(e.target.value)} />
        <input className="w-44 rounded border bg-white px-2 py-1" placeholder="subunidade (opcional)" value={sub} onChange={e => setSub(e.target.value)} />
        <select className="rounded border bg-white px-2 py-1" value={grupo} onChange={e => setGrupo(e.target.value as Grupo | '')}>
          <option value="">Grupo: automático pelo nome</option>
          {GRUPOS.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" checked={principal} onChange={e => setPrincipal(e.target.checked)} /> principal (recebe o valor fixo)</label>
        <button className="rounded bg-[#1f4e78] px-3 py-1 text-white" onClick={() => {
          if (!nome.trim()) { alert('Informe o nome como aparece no Bruto'); return }
          const n = nome.trim().toUpperCase()
          onAdicionar(n, sub.trim() || null, principal, grupo || grupoDoNome(n, null, empresa))
          setNome(''); setSub(''); setPrincipal(false); setGrupo('')
        }}>Adicionar nome</button>
      </div>
    </section>
  )
}
