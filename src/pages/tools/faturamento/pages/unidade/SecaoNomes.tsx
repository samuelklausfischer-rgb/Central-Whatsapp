import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Check, Pencil, Plus, Save, Star, Tag, Trash2 } from 'lucide-react'
import type { Alias } from '../../lib/tipos'
import { GRUPOS, grupoDoNome, type Grupo } from '../../lib/relatorioUnidade'
import { nomeQueRecebeFixo } from '../../lib/config'
import { nomeExibicao } from '../../lib/format'
import { mudancas } from '../../lib/edicao'
import type { Backup } from '../../lib/backup'
import { AvisoDesfazer, Botao, Campo, CLASSE_CONTROLE, Cartao, ConfirmarApagar, Interruptor, RevisaoAlteracoes, Selo, Vazio } from '../../components/ui'
import { COR_GRUPO, agruparPorSubunidade, efeitosMoverNome, efeitosRemoverNome, filtrarUnidades, nomeJaCadastrado } from './EditorNomes'
import type { UnidadeLista } from './useUnidade'

type Painel = { id: string; tipo: 'editar' | 'mover' | 'remover' } | null

export function SecaoNomes({ nomes, empresa, temFixo, unidadeId, alvoId, onAdicionar, onRemover, onPrincipal, onGrupo, onEditar, onMover, onListarUnidades, onRecarregar }: {
  nomes: Alias[]; empresa: string; temFixo: boolean; unidadeId: string; alvoId?: string
  onAdicionar: (nome: string, subunidade: string | null, principal: boolean, grupo: Grupo) => void | Promise<unknown>
  onRemover: (a: Alias) => Promise<Backup>; onPrincipal: (a: Alias, v: boolean) => void | Promise<unknown>
  onGrupo: (a: Alias, g: Grupo) => void | Promise<unknown>
  onEditar: (a: Alias, d: { subunidade: string | null; incerto: boolean }) => Promise<unknown>
  onMover: (a: Alias, destinoId: string, subunidade: string | null) => Promise<unknown>
  onListarUnidades: () => Promise<UnidadeLista[]>
  onRecarregar: () => void | Promise<unknown>
}) {
  const [editando, setEditando] = useState(false)
  const [erroGravar, setErroGravar] = useState<string | undefined>()
  // cada mudança é gravada na hora; falha aparece dentro do cartão e a edição continua
  async function executar(f: () => void | Promise<unknown>): Promise<boolean> {
    try { await f(); setErroGravar(undefined); return true }
    catch (e) { setErroGravar(e instanceof Error ? e.message : 'Não foi possível salvar.'); return false }
  }
  const [painel, setPainel] = useState<Painel>(null)
  const [backup, setBackup] = useState<Backup | null>(null)
  const grupoDe = (a: Alias) => grupoDoNome(a.nome_bruto, a.grupo, empresa)
  const subgrupos = agruparPorSubunidade(nomes)
  const fixo = temFixo ? nomeQueRecebeFixo(nomes) : null

  return (
    <Cartao
      titulo="Nomes da Mobilemed" icone={Tag} cor="cyan" destaque={editando ? 'edicao' : undefined}
      descricao="Como esta unidade aparece na coluna Unidade do Bruto. Nome sem cadastro aqui vira pendência no relatório."
      acoes={editando
        ? <Botao variante="primario" icone={Check} onClick={() => { setEditando(false); setPainel(null); setErroGravar(undefined) }}>Concluir</Botao>
        : <Botao icone={Pencil} onClick={() => setEditando(true)}>Editar</Botao>}
    >
      <div className="space-y-4">
        {backup && <AvisoDesfazer backup={backup} onDesfeito={() => { setBackup(null); void onRecarregar() }} />}
        {temFixo && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
            <span className="font-semibold">Recebe o valor fixo: </span>
            {fixo
              ? <>
                  <b>{fixo.todos.join(', ')}</b>
                  {fixo.automatico && <span className="text-violet-800"> (escolhido automaticamente — marque ★ principal para escolher outro)</span>}
                </>
              : <span className="font-medium text-amber-900">nenhum nome cadastrado para receber o valor fixo desta unidade</span>}
          </div>
        )}

        {editando && erroGravar && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{erroGravar}</p>}

        {editando && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">Aqui cada mudança de ★ e grupo é gravada na hora. Editar, mover e remover pedem confirmação. O nome ★ principal recebe o valor fixo mensal.</p>}

        {!nomes.length
          ? <Vazio icone={Tag} titulo="Nenhum nome cadastrado" texto="Sem nome cadastrado, os exames desta unidade não entram no relatório." />
          : subgrupos.map(g => (
            <div key={g.rotulo} className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between rounded-t-lg border-b border-slate-100 bg-slate-50 px-3 py-2">
                <h3 className="text-sm font-semibold text-slate-900">{g.rotulo}</h3>
                <span className="text-xs text-slate-600">{g.nomes.length === 1 ? '1 nome' : `${g.nomes.length} nomes`}</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {g.nomes.map(a => {
                  const grupo = grupoDe(a)
                  const outros = nomes.filter(x => x.id !== a.id)
                  return (
                    <li key={a.id} className={`px-3 py-2 ${alvoId === a.id ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : ''}`}>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {editando
                          ? (
                            <button type="button" aria-pressed={a.principal} aria-label={`${a.principal ? 'Tirar' : 'Marcar'} ${a.nome_bruto} como principal`}
                              title={a.principal ? 'Principal (recebe o valor fixo) — clique para tirar' : 'Marcar como principal'}
                              onClick={() => { void executar(() => onPrincipal(a, !a.principal)) }}
                              className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40">
                              <Star className={`size-4 ${a.principal ? 'fill-amber-400 text-amber-500' : 'text-slate-400'}`} aria-hidden="true" />
                            </button>)
                          : a.principal
                            ? <Star className="size-4 fill-amber-400 text-amber-500" aria-label="Principal" />
                            : <span className="inline-block size-4" aria-hidden="true" />}
                        <b className="break-all font-medium text-slate-900">{a.nome_bruto}</b>
                        {!editando && <Selo cor={COR_GRUPO[grupo] ?? 'slate'}>{grupo}</Selo>}
                        {a.incerto && <Selo cor="amber" title="Ligação deste nome com a unidade ainda não foi confirmada">incerto</Selo>}
                        {editando && (
                          <>
                            <select aria-label={`Grupo de ${a.nome_bruto}`} title="Mudar o grupo deste nome" value={grupo}
                              className={`${CLASSE_CONTROLE} !w-auto !px-2 !py-1 !text-xs`} onChange={e => { const g = e.target.value as Grupo; void executar(() => onGrupo(a, g)) }}>
                              {GRUPOS.map(x => <option key={x} value={x}>{x}</option>)}
                            </select>
                            <Botao tamanho="pequeno" variante="fantasma" icone={Pencil} onClick={() => setPainel({ id: a.id, tipo: 'editar' })}>Editar</Botao>
                            <Botao tamanho="pequeno" variante="fantasma" icone={ArrowRightLeft} onClick={() => setPainel({ id: a.id, tipo: 'mover' })}>Mover</Botao>
                            <Botao tamanho="pequeno" variante="fantasma" icone={Trash2} onClick={() => setPainel({ id: a.id, tipo: 'remover' })}>Remover</Botao>
                          </>
                        )}
                      </div>
                      {editando && painel?.id === a.id && painel.tipo === 'editar' && (
                        <EditarNome a={a} onSalvar={d => onEditar(a, d)} onFechar={() => setPainel(null)} />
                      )}
                      {editando && painel?.id === a.id && painel.tipo === 'mover' && (
                        <MoverNome a={a} outros={outros} temFixo={temFixo} unidadeId={unidadeId} onListar={onListarUnidades}
                          onMover={(destino, sub) => onMover(a, destino, sub)} onFechar={() => setPainel(null)} />
                      )}
                      {editando && painel?.id === a.id && painel.tipo === 'remover' && (
                        <div className="mt-2">
                          <ConfirmarApagar
                            nivel="leve" titulo={`Remover “${a.nome_bruto}”?`} efeitos={efeitosRemoverNome(a, outros, temFixo)}
                            onConfirmar={async () => { const b = await onRemover(a); setBackup(b); setPainel(null) }}
                            onCancelar={() => setPainel(null)}
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}

        {editando && <NovoNome nomes={nomes} empresa={empresa} onAdicionar={(...a) => executar(() => onAdicionar(...a))} />}
      </div>
    </Cartao>
  )
}

function NovoNome({ nomes, empresa, onAdicionar }: {
  nomes: Alias[]; empresa: string; onAdicionar: (nome: string, subunidade: string | null, principal: boolean, grupo: Grupo) => Promise<boolean>
}) {
  const [nome, setNome] = useState(''); const [sub, setSub] = useState(''); const [principal, setPrincipal] = useState(false)
  const [grupo, setGrupo] = useState<Grupo | ''>('')
  const [erro, setErro] = useState<string | undefined>()
  async function adicionar() {
    const n = nome.trim().toUpperCase()
    if (!n) { setErro('Informe o nome como aparece no Bruto'); return }
    if (nomeJaCadastrado(nomes, n)) { setErro('Este nome já está cadastrado nesta unidade'); return }
    setErro(undefined)
    const ok = await onAdicionar(n, sub.trim() || null, principal, grupo || grupoDoNome(n, null, empresa))
    if (ok) { setNome(''); setSub(''); setPrincipal(false); setGrupo('') }
  }
  return (
    <div className="space-y-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-4">
      <p className="text-sm font-semibold text-slate-900">Adicionar nome</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Campo rotulo="Nome exatamente como no Bruto" erro={erro}>
          <input className={`${CLASSE_CONTROLE} uppercase`} value={nome} onChange={e => setNome(e.target.value)} />
        </Campo>
        <Campo rotulo="Subunidade / hospital (opcional)">
          <input className={CLASSE_CONTROLE} value={sub} onChange={e => setSub(e.target.value)} />
        </Campo>
        <Campo rotulo="Grupo" ajuda="Automático decide pelo nome e pela empresa.">
          <select className={CLASSE_CONTROLE} value={grupo} onChange={e => setGrupo(e.target.value as Grupo | '')}>
            <option value="">Automático pelo nome</option>
            {GRUPOS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Campo>
        <div className="self-end pb-1">
          <Interruptor ligado={principal} onChange={setPrincipal} rotulo="Principal" descricao="Recebe o valor fixo mensal" />
        </div>
      </div>
      <Botao variante="primario" icone={Plus} onClick={() => { void adicionar() }}>Adicionar nome</Botao>
    </div>
  )
}

function EditarNome({ a, onSalvar, onFechar }: { a: Alias; onSalvar: (d: { subunidade: string | null; incerto: boolean }) => Promise<unknown>; onFechar: () => void }) {
  const [sub, setSub] = useState(a.subunidade ?? '')
  const [incerto, setIncerto] = useState(a.incerto)
  const [revisando, setRevisando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | undefined>()
  const lista = mudancas(
    { subunidade: a.subunidade?.trim() ?? '', incerto: a.incerto },
    { subunidade: sub.trim(), incerto },
    { subunidade: { rotulo: 'Hospital / subunidade' }, incerto: { rotulo: 'Ligação incerta' } },
  )
  async function confirmar() {
    setSalvando(true); setErro(undefined)
    try { await onSalvar({ subunidade: sub.trim() || null, incerto }); onFechar() }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-sky-200 bg-white p-3">
      {revisando ? (
        <RevisaoAlteracoes mudancas={lista} salvando={salvando} erro={erro} onConfirmar={() => { void confirmar() }} onVoltar={() => { setErro(undefined); setRevisando(false) }} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo rotulo="Hospital / subunidade" ajuda="Escolhe os preços do hospital. Vazio = unidade toda.">
              <input className={CLASSE_CONTROLE} value={sub} onChange={e => setSub(e.target.value)} />
            </Campo>
            <div className="self-end pb-1">
              <Interruptor ligado={incerto} onChange={setIncerto} rotulo="Ligação incerta" descricao="Marque se ainda não foi confirmado que este nome é desta unidade." />
            </div>
          </div>
          <div className="flex gap-2">
            <Botao variante="primario" tamanho="pequeno" icone={Save} disabled={!lista.length} onClick={() => setRevisando(true)}>Revisar alterações</Botao>
            <Botao variante="fantasma" tamanho="pequeno" onClick={onFechar}>Descartar</Botao>
          </div>
        </>
      )}
    </div>
  )
}

function MoverNome({ a, outros, temFixo, unidadeId, onListar, onMover, onFechar }: {
  a: Alias; outros: Alias[]; temFixo: boolean; unidadeId: string; onListar: () => Promise<UnidadeLista[]>
  onMover: (destinoId: string, subunidade: string | null) => Promise<unknown>; onFechar: () => void
}) {
  const [lista, setLista] = useState<UnidadeLista[] | null>(null)
  const [busca, setBusca] = useState('')
  const [destinoId, setDestinoId] = useState('')
  const [sub, setSub] = useState('')
  const [revisando, setRevisando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | undefined>()
  // a lista de unidades só é lida quando o usuário abre "Mover"
  useEffect(() => {
    let vivo = true
    onListar().then(l => { if (vivo) setLista(l) }).catch(e => { if (vivo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar as unidades.') })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const opcoes = useMemo(() => filtrarUnidades(lista ?? [], busca, unidadeId), [lista, busca, unidadeId])
  const destino = lista?.find(u => u.id === destinoId)
  async function confirmar() {
    setSalvando(true); setErro(undefined)
    try { await onMover(destinoId, sub.trim() || null); onFechar() }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível mover.') }
    finally { setSalvando(false) }
  }
  if (revisando && destino) {
    const efeitos = efeitosMoverNome(a, nomeExibicao(destino.pasta), outros, temFixo)
    return (
      <div className="mt-2 space-y-3 rounded-lg border border-sky-200 bg-white p-3">
        <ul className="list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-sm text-amber-900">{efeitos.map((t, i) => <li key={i}>{t}</li>)}</ul>
        <RevisaoAlteracoes
          mudancas={[
            { rotulo: `Unidade de “${a.nome_bruto}”`, antes: 'esta unidade', depois: `${nomeExibicao(destino.pasta)} (${destino.empresa})` },
            { rotulo: 'Hospital / subunidade', antes: a.subunidade?.trim() || '—', depois: sub.trim() || '—' },
            ...(a.principal ? [{ rotulo: '★ Principal', antes: 'Sim', depois: 'Não' }] : []),
          ]}
          salvando={salvando} erro={erro} onConfirmar={() => { void confirmar() }} onVoltar={() => { setErro(undefined); setRevisando(false) }}
        />
      </div>
    )
  }
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-sky-200 bg-white p-3">
      <p className="text-sm font-semibold text-slate-900">Mover “{a.nome_bruto}” para outra unidade</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Campo rotulo="Buscar a unidade de destino">
            <input className={CLASSE_CONTROLE} placeholder="Digite parte do nome da pasta" value={busca} onChange={e => setBusca(e.target.value)} />
          </Campo>
          {!lista && !erro && <p className="text-xs text-slate-600">Carregando as unidades…</p>}
          {lista && (
            <select aria-label="Unidade de destino" size={6} className={CLASSE_CONTROLE} value={destinoId} onChange={e => setDestinoId(e.target.value)}>
              {opcoes.map(u => <option key={u.id} value={u.id}>{nomeExibicao(u.pasta)} · {u.empresa}</option>)}
            </select>
          )}
          {lista && !opcoes.length && <p className="text-xs text-slate-600">Nenhuma unidade encontrada.</p>}
        </div>
        <Campo rotulo="Hospital / subunidade no destino (opcional)">
          <input className={CLASSE_CONTROLE} value={sub} onChange={e => setSub(e.target.value)} />
        </Campo>
      </div>
      {erro && <p role="alert" className="text-sm font-medium text-rose-700">{erro}</p>}
      <div className="flex gap-2">
        <Botao variante="primario" tamanho="pequeno" icone={Save} disabled={!destinoId} onClick={() => setRevisando(true)}>Revisar</Botao>
        <Botao variante="fantasma" tamanho="pequeno" onClick={onFechar}>Cancelar</Botao>
      </div>
    </div>
  )
}
