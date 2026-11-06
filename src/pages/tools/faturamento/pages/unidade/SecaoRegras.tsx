import { useEffect, useMemo, useState } from 'react'
import { Calculator, CalendarRange, Check, ClipboardCheck, Coins, Hash, ListChecks, Pencil, ScanSearch, Undo2, TriangleAlert, CalendarDays, Gauge } from 'lucide-react'
import type { RegrasUnidade, UnidadeResumo } from '../../lib/tipos'
import { MODELO } from '../../lib/format'
import { alertasModelo, comoFatura, rotuloJanela, statusAceitos } from '../../lib/config'
import { MODALIDADES_FIM_DE_SEMANA, exemploPeriodo, montarJanela } from '../../lib/regrasEditor'
import { diffLinhas } from '../../lib/edicao'
import { Botao, Campo, CLASSE_CONTROLE, Cartao, Definicoes, Interruptor, RevisaoAlteracoes, Segmentado, Selo } from '../../components/ui'
import type { CamposRegras } from './useUnidade'
import {
  DESCRICAO_MODELO, dataEfetiva, fraseRegra, mudancasRegras, rascunhoInicial, rascunhoMudou, regrasParaComoFatura,
  rotuloModelo, textoFimDeSemana, textoFranquia, validarRascunho, type CriterioRascunho, type RascunhoRegras,
} from './EditorRegras'
import { EditorLinhasQuantidade } from './EditorLinhasQuantidade'

type Modo = 'leitura' | 'edicao' | 'revisao'
type ItemModelo = { papel: string }

function competenciaAtual() {
  const d = new Date()
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 }
}

function exemplo(janela: string): string | null {
  try { return exemploPeriodo(janela, competenciaAtual()) } catch { return null }
}

export function FormRegras({ u, regras, onSalvar, itens, statusPorExame }: {
  u: UnidadeResumo; regras: RegrasUnidade
  /** Pode devolver Promise: se rejeitar, o erro aparece dentro do cartão e a edição continua. */
  onSalvar: (r: CamposRegras, modelo: string) => void | Promise<unknown>
  /** Itens de preço da unidade (papel de cada um) — habilita os alertas de tipo de cobrança. */
  itens?: ItemModelo[]
  /** Status que entram no relatório (padrão: Assinado e Reassinado). */
  statusPorExame?: string[]
}) {
  const [modo, setModo] = useState<Modo>('leitura')
  const original = useMemo(() => rascunhoInicial(u.modelo_cobranca, regras), [u.modelo_cobranca, regras])
  const [r, setR] = useState<RascunhoRegras>(original)
  const [mostrarErros, setMostrarErros] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erroGravar, setErroGravar] = useState<string | undefined>()
  const [salvo, setSalvo] = useState(false)

  const emEdicao = modo !== 'leitura'
  const mudou = emEdicao && rascunhoMudou(r, original)
  const valid = useMemo(() => validarRascunho(r), [r])

  // avisa ao sair da página com alterações não salvas
  useEffect(() => {
    if (!mudou) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [mudou])

  useEffect(() => {
    if (!salvo) return
    const t = setTimeout(() => setSalvo(false), 4000)
    return () => clearTimeout(t)
  }, [salvo])

  const set = (p: Partial<RascunhoRegras>) => setR(x => ({ ...x, ...p }))

  function editar() {
    setR(rascunhoInicial(u.modelo_cobranca, regras)); setMostrarErros(false); setErroGravar(undefined); setSalvo(false); setModo('edicao')
  }
  function descartar() {
    if (mudou && !confirm('Descartar as alterações feitas nas regras?')) return
    setModo('leitura'); setMostrarErros(false); setErroGravar(undefined)
  }
  function revisar() {
    if (!valid.ok) { setMostrarErros(true); return }
    setErroGravar(undefined); setModo('revisao')
  }
  async function confirmar() {
    if (!valid.campos) return
    setSalvando(true); setErroGravar(undefined)
    try {
      await onSalvar(valid.campos, r.modelo)
      setModo('leitura'); setSalvo(true)
    } catch (e) {
      setErroGravar(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally { setSalvando(false) }
  }

  const acoes = modo === 'leitura'
    ? <Botao icone={Pencil} onClick={editar}>Editar</Botao>
    : modo === 'edicao'
      ? <Selo cor="sky" icone={Pencil}>Editando</Selo>
      : <Selo cor="sky" icone={ClipboardCheck}>Revisando</Selo>

  return (
    <Cartao
      titulo="Como fatura (regras)" icone={Calculator} cor="indigo" destaque={emEdicao ? 'edicao' : undefined} acoes={acoes}
      descricao="Estas regras são usadas no cálculo do relatório de cada mês."
    >
      {salvo && modo === 'leitura' && (
        <p role="status" className="mb-4 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          <Check className="size-4" aria-hidden="true" />Salvo. O próximo cálculo já usa as regras novas.
        </p>
      )}
      {modo === 'leitura' && <Leitura u={u} regras={regras} itens={itens} statusPorExame={statusPorExame} />}
      {modo === 'edicao' && (
        <div className="space-y-6">
          <Edicao r={r} set={set} mostrarErros={mostrarErros} valid={valid} itens={itens} statusPorExame={statusPorExame} />
          {mostrarErros && !valid.ok && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              Corrija os campos marcados abaixo antes de revisar.
              {valid.erroQuantidade && <> {valid.erroQuantidade}</>}
            </p>
          )}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Botao variante="primario" icone={ClipboardCheck} disabled={!mudou} onClick={revisar}>Revisar alterações</Botao>
            <Botao icone={Undo2} onClick={descartar}>Descartar</Botao>
            {!mudou && <span className="self-center text-xs text-slate-600">Nada foi alterado ainda.</span>}
          </div>
        </div>
      )}
      {modo === 'revisao' && valid.campos && (
        <Revisao
          antes={original} depois={r} u={u} regras={regras} campos={valid.campos} salvando={salvando} erro={erroGravar}
          onConfirmar={confirmar} onVoltar={() => setModo('edicao')}
        />
      )}
    </Cartao>
  )
}

// ---------------------------------------------------------------- leitura
function Leitura({ u, regras, itens, statusPorExame }: { u: UnidadeResumo; regras: RegrasUnidade; itens?: ItemModelo[]; statusPorExame?: string[] }) {
  const r = useMemo(() => rascunhoInicial(u.modelo_cobranca, regras), [u.modelo_cobranca, regras])
  const janela = montarJanela(r.periodo)
  const ex = exemplo(janela)
  const dia = dataEfetiva(u.modelo_cobranca, r.criterio)
  const alertas = itens ? alertasModelo(u.modelo_cobranca, itens) : []
  const st = statusAceitos({ modelo_cobranca: u.modelo_cobranca, todos_status: regras.todos_status, criterio_data: regras.criterio_data }, statusPorExame)
  return (
    <Definicoes itens={[
      { rotulo: 'Período', icone: CalendarRange, valor: <>{rotuloJanela(janela)}{ex && <span className="block text-xs text-slate-600">Exemplo: {ex}</span>}</> },
      { rotulo: 'Data que define o mês', icone: CalendarDays, valor: r.criterio === '' ? `Automático (= data do ${dia})` : `Data do ${dia}` },
      { rotulo: 'Status aceitos', icone: ListChecks, valor: st.texto },
      {
        rotulo: 'Contam mais de 1', icone: Hash,
        valor: r.linhas.length
          ? <ul className="space-y-0.5">{r.linhas.map(l => <li key={l.chave}>{fraseRegra(l)}</li>)}</ul>
          : <span className="text-slate-600">Nenhuma — todo estudo conta 1</span>,
      },
      { rotulo: 'Fim de semana', icone: CalendarDays, valor: textoFimDeSemana(r.fimDeSemana) },
      { rotulo: 'Franquia', icone: Gauge, valor: r.franquia ? `${textoFranquia(r.franquia)}; acima disso cobra o excedente` : 'Sem franquia' },
      {
        rotulo: 'Tipo de cobrança', icone: Coins,
        valor: <>{rotuloModelo(u.modelo_cobranca)}{alertas.map(a => <span key={a} className="mt-1 block text-xs font-medium text-amber-800">{a}</span>)}</>,
      },
    ]} />
  )
}

// ---------------------------------------------------------------- edição
function Edicao({ r, set, mostrarErros, valid, itens, statusPorExame }: {
  r: RascunhoRegras; set: (p: Partial<RascunhoRegras>) => void; mostrarErros: boolean
  valid: ReturnType<typeof validarRascunho>; itens?: ItemModelo[]; statusPorExame?: string[]
}) {
  const janela = montarJanela(r.periodo)
  const ex = r.periodo.tipo === 'corte' && valid.erroPeriodo ? null : exemplo(janela)
  const dia = dataEfetiva(r.modelo, r.criterio)
  const alertas = itens ? alertasModelo(r.modelo, itens) : []
  const st = statusAceitos({ modelo_cobranca: r.modelo, todos_status: r.todos, criterio_data: r.criterio || null }, statusPorExame)
  const mods = [...MODALIDADES_FIM_DE_SEMANA as readonly string[], ...r.fimDeSemana.modalidades.filter(m => !(MODALIDADES_FIM_DE_SEMANA as readonly string[]).includes(m))]
  const franq = r.franquia.trim()

  return (
    <div className="space-y-6">
      <Bloco titulo="Período" ajuda="Quais dias entram na fatura de cada mês.">
        <Segmentado nome="periodo" rotulo="Período da fatura" valor={r.periodo.tipo} onChange={v => {
          const tipo = v as RascunhoRegras['periodo']['tipo']
          set({ periodo: tipo === 'corte' ? { tipo, dia: r.periodo.tipo === 'corte' ? r.periodo.dia : undefined } : tipo === 'ciclo' ? { tipo, dia: 27 } : { tipo } })
        }} opcoes={[
          { valor: 'mes', rotulo: 'Mês calendário', descricao: 'Do dia 1 ao último dia do mês' },
          { valor: 'quinzena', rotulo: 'Quinzena', descricao: 'Dias 1–15 e 16–fim do mês' },
          { valor: 'corte', rotulo: 'Corte em um dia', descricao: 'Começa num dia que você escolhe' },
          { valor: 'ciclo', rotulo: 'Ciclo FHEMIG', descricao: 'Do dia 27 do mês anterior ao dia 26' },
        ]} />
        {r.periodo.tipo === 'corte' && (
          <div className="max-w-xs">
            <Campo rotulo="Dia em que o período começa" ajuda="De 2 a 28 (o dia 27 é o Ciclo FHEMIG)." erro={mostrarErros ? valid.erroPeriodo : undefined}>
              <input type="number" min={2} max={28} inputMode="numeric" className={`${CLASSE_CONTROLE} tabular-nums`}
                value={r.periodo.dia ?? ''} onChange={e => set({ periodo: { tipo: 'corte', dia: e.target.value === '' ? undefined : Number(e.target.value) } })} />
            </Campo>
          </div>
        )}
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800" aria-live="polite">
          <span className="font-medium">{rotuloJanela(janela)}.</span>{' '}
          {ex ? <>Exemplo — {ex}</> : <span className="text-slate-600">Informe o dia para ver o exemplo.</span>}
        </p>
      </Bloco>

      <Bloco titulo="Data que define o mês" ajuda="Em qual mês o exame é cobrado.">
        <Segmentado nome="criterio" rotulo="Data que define o mês" valor={r.criterio || 'auto'} onChange={v => set({ criterio: (v === 'auto' ? '' : v) as CriterioRascunho })} opcoes={[
          { valor: 'auto', rotulo: 'Automático', descricao: 'Preço por exame usa a data do laudo; valor fixo usa a data do exame' },
          { valor: 'laudo', rotulo: 'Data do laudo', descricao: 'O exame entra no mês em que o laudo foi assinado' },
          { valor: 'exame', rotulo: 'Data do exame', descricao: 'O exame entra no mês em que foi feito, mesmo que o laudo saia depois' },
        ]} />
        <p className="text-sm text-slate-700">
          {r.criterio === '' ? `Automático: nesta unidade vale a data do ${dia}.` : `Vale a data do ${dia}, em todos os exames.`}
        </p>
      </Bloco>

      <Bloco titulo="Status" ajuda="Quais exames entram na fatura.">
        <Interruptor ligado={r.todos} onChange={v => set({ todos: v })} rotulo="Cobrar também exame sem laudo (todos os status)"
          descricao="Inclui exames À Preparar, Pendente etc. Valor fixo pela data do exame já cobra todos." />
        <p className="text-sm text-slate-700">Entram: {st.texto}.</p>
      </Bloco>

      <Bloco titulo="Contam mais de 1" ajuda="Estudos que valem mais de um exame na cobrança.">
        <EditorLinhasQuantidade linhas={r.linhas} erros={mostrarErros ? valid.errosLinhas : r.linhas.map(() => [])} onChange={linhas => set({ linhas })} />
        {mostrarErros && valid.erroQuantidade && <p role="alert" className="text-xs font-medium text-rose-700">{valid.erroQuantidade}</p>}
      </Bloco>

      <Bloco titulo="Fim de semana" ajuda="Exame feito no sábado ou domingo (pela data do exame) sai num relatório à parte, com o mesmo preço.">
        <Interruptor ligado={r.fimDeSemana.ligado} onChange={ligado => set({ fimDeSemana: { ...r.fimDeSemana, ligado } })} rotulo="Ter relatório de fim de semana" />
        {r.fimDeSemana.ligado && (
          <div>
            <p className="mb-1.5 text-xs text-slate-600">Modalidades (nada marcado = todas):</p>
            <div className="flex flex-wrap gap-2">
              {mods.map(m => {
                const on = r.fimDeSemana.modalidades.includes(m)
                return (
                  <button key={m} type="button" aria-pressed={on}
                    onClick={() => set({ fimDeSemana: { ...r.fimDeSemana, modalidades: on ? r.fimDeSemana.modalidades.filter(x => x !== m) : [...r.fimDeSemana.modalidades, m] } })}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40 ${on ? 'border-[#1f4e78] bg-[#1f4e78] text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'}`}>
                    {m}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Bloco>

      <Bloco titulo="Franquia">
        <div className="max-w-xs">
          <Campo rotulo="Franquia mensal (exames)" ajuda={franq ? `Acima de ${franq} exames no mês, o excedente é cobrado à parte.` : 'Vazio = sem franquia.'} erro={mostrarErros ? valid.erroFranquia : undefined}>
            <input className={`${CLASSE_CONTROLE} tabular-nums`} inputMode="numeric" placeholder="sem franquia" value={r.franquia} onChange={e => set({ franquia: e.target.value })} />
          </Campo>
        </div>
      </Bloco>

      <Bloco titulo="Tipo de cobrança">
        <div className="max-w-md">
          <Campo rotulo="Tipo de cobrança" ajuda={DESCRICAO_MODELO[r.modelo]}>
            <select className={CLASSE_CONTROLE} value={r.modelo} onChange={e => set({ modelo: e.target.value })}>
              {Object.keys(MODELO).map(k => <option key={k} value={k}>{rotuloModelo(k)}</option>)}
            </select>
          </Campo>
        </div>
        {alertas.map(a => <p key={a} role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 border-l-4 border-l-amber-500 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{a}</p>)}
      </Bloco>
    </div>
  )
}

function Bloco({ titulo, ajuda, children }: { titulo: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-3 border-0 p-0">
      <legend className="mb-1 p-0">
        <span className="text-sm font-semibold text-slate-900">{titulo}</span>
        {ajuda && <span className="ml-2 text-xs font-normal text-slate-600">{ajuda}</span>}
      </legend>
      {children}
    </fieldset>
  )
}

// ---------------------------------------------------------------- revisão
function Revisao({ antes, depois, u, regras, campos, salvando, erro, onConfirmar, onVoltar }: {
  antes: RascunhoRegras; depois: RascunhoRegras; u: UnidadeResumo; regras: RegrasUnidade; campos: CamposRegras
  salvando: boolean; erro?: string; onConfirmar: () => void; onVoltar: () => void
}) {
  const ms = mudancasRegras(antes, depois)
  const diff = diffLinhas(comoFatura(u.modelo_cobranca, regras), comoFatura(depois.modelo, regrasParaComoFatura(campos)))
  return (
    <div className="space-y-5">
      {diff.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><ScanSearch className="size-4" aria-hidden="true" />Como esta unidade fatura: antes → depois</p>
          <ul className="space-y-1.5 text-sm">
            {diff.map((d, i) => (
              <li key={`${d.rotulo}-${i}`} className="grid gap-x-3 sm:grid-cols-[minmax(9rem,12rem)_1fr]">
                <span className="text-slate-600">{d.rotulo}</span>
                <span>
                  {d.antes && <span className="mr-2 text-slate-600 line-through decoration-slate-400">{d.antes}</span>}
                  {d.depois ? <span className="font-semibold text-emerald-700">{d.depois}</span> : <span className="font-medium text-rose-700">removido</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <RevisaoAlteracoes mudancas={ms} salvando={salvando} erro={erro} onConfirmar={onConfirmar} onVoltar={onVoltar} />
    </div>
  )
}
