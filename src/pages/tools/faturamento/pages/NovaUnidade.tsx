import { useState } from 'react'
import { Link } from '../navegacao'
import { ArrowLeft, ArrowRight, Check, CheckCircle2 } from 'lucide-react'
import { Botao, Carregando } from '../components/ui'
import { hojeISO } from '../lib/format'
import {
  carregarOrigem, criarUnidade, formDeDuplicacao, formVazio, montarDuplicacao, montarPayload, podeCriar, situacaoPorVigencia,
  validarComoFatura, validarIdentificacao, validarItens, validarNomes,
  type AliasForm, type FormNova, type ItemForm,
} from '../lib/unidadeNova'
import { PassoIdentificacao } from './novaUnidade/PassoIdentificacao'
import { PassoComoFatura } from './novaUnidade/PassoComoFatura'
import { PassoPrecos } from './novaUnidade/PassoPrecos'
import { PassoNomes } from './novaUnidade/PassoNomes'
import { PassoRevisar } from './novaUnidade/PassoRevisar'
import { useReferencias, type UnidadeLista } from './novaUnidade/useReferencias'

const PASSOS = ['Identificação', 'Como fatura', 'Preços', 'Nomes da Mobilemed', 'Revisar'] as const
const CLASSE_LINK = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50'

export default function NovaUnidade() {
  const [versao, setVersao] = useState(0)
  const { ref, erro: erroRef } = useReferencias(versao)
  const [passo, setPasso] = useState(0)
  const [tentou, setTentou] = useState(false)
  const [modo, setModo] = useState<'zero' | 'duplicar'>('zero')
  const [form, setForm] = useState<FormNova>(formVazio)
  const [itens, setItens] = useState<ItemForm[]>([])
  const [nomes, setNomes] = useState<AliasForm[]>([])
  const [origemNome, setOrigemNome] = useState<string | null>(null)
  const [carregandoOrigem, setCarregandoOrigem] = useState(false)
  const [erroOrigem, setErroOrigem] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)
  const [erroCriar, setErroCriar] = useState<string | null>(null)
  const [criada, setCriada] = useState<{ id: string; pasta: string } | null>(null)

  if (erroRef) return <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Não foi possível carregar o cadastro: {erroRef}</p>
  if (!ref) return <Carregando linhas={5} />

  const mudar = (p: Partial<FormNova>) => setForm(f => ({ ...f, ...p }))

  async function duplicarDe(u: UnidadeLista) {
    setCarregandoOrigem(true); setErroOrigem(null)
    try {
      const origem = await carregarOrigem(u.id, hojeISO())
      const d = montarDuplicacao(origem, { empresa: u.empresa as FormNova['empresa'], pasta: '' })
      const novo = formDeDuplicacao(d)
      setForm(f => ({ ...novo.form, pasta: f.pasta }))
      setItens(novo.itens)
      setOrigemNome(u.pasta)
    } catch (e) { setErroOrigem(e instanceof Error ? e.message : String(e)) } finally { setCarregandoOrigem(false) }
  }

  function trocarModo(m: 'zero' | 'duplicar') {
    setModo(m)
    if (m === 'zero' && origemNome) { setForm(f => ({ ...formVazio(), pasta: f.pasta })); setItens([]); setOrigemNome(null) }
  }

  const problemas = podeCriar(form, itens, nomes, ref.unidades, ref.nomes, ref.ignorados)
  const passoOk = (p: number): boolean => {
    if (p === 0) return Object.keys(validarIdentificacao(form, ref.unidades).erros).length === 0
    if (p === 1) return Object.keys(validarComoFatura(form)).length === 0
    if (p === 2) return itens.length > 0 && Object.keys(validarItens(itens)).length === 0
    if (p === 3) return nomes.length > 0 && Object.keys(validarNomes(nomes, ref.nomes, ref.ignorados)).length === 0
    return true
  }

  function avancar() {
    if (!passoOk(passo)) { setTentou(true); return }
    if (passo === 0 && modo === 'zero' && form.situacao === 'sem_data') mudar({ situacao: situacaoPorVigencia(form.vigencia_inicio, form.vigencia_fim, hojeISO()) })
    setTentou(false)
    setPasso(p => p + 1)
  }

  async function criar() {
    setCriando(true); setErroCriar(null)
    try {
      const id = await criarUnidade(montarPayload(form, itens, nomes))
      setCriada({ id, pasta: form.pasta.trim() })
    } catch (e) { setErroCriar(e instanceof Error ? e.message : String(e)) } finally { setCriando(false) }
  }

  function recomecar() {
    setCriada(null); setPasso(0); setTentou(false); setModo('zero'); setForm(formVazio()); setItens([]); setNomes([]); setOrigemNome(null)
    setVersao(v => v + 1) // recarrega pastas e nomes já com a unidade criada
  }

  if (criada) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
        <p className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="size-6 text-emerald-600" aria-hidden="true" />Unidade criada</p>
        <p className="text-sm">“{criada.pasta}” já está no cadastro. Abra a unidade para conferir o diagnóstico e completar termos, observações e SharePoint.</p>
        <div className="flex flex-wrap gap-2">
          <Link to={`/faturamento/unidade/${criada.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1f4e78] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#173d5f]">Abrir a unidade <ArrowRight className="size-4" aria-hidden="true" /></Link>
          <button type="button" onClick={recomecar} className={CLASSE_LINK}>Criar outra</button>
          <Link to="/faturamento" className={CLASSE_LINK}>Voltar à lista</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/faturamento" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="size-4" aria-hidden="true" />Unidades e contratos</Link>
        <h1 className="mt-1 text-2xl font-bold text-[#1f4e78]">Nova unidade</h1>
        <p className="mt-1 text-sm text-slate-600">Nada é gravado até o último passo.</p>
      </div>

      <ol className="flex flex-wrap gap-2" aria-label="Passos">
        {PASSOS.map((nome, i) => (
          <li key={nome} aria-current={i === passo ? 'step' : undefined}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${i === passo ? 'bg-[#1f4e78] text-white ring-[#1f4e78]' : i < passo ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-white text-slate-600 ring-slate-200'}`}>
            {i < passo ? <Check className="size-3.5" aria-hidden="true" /> : <span>{i + 1}</span>}{nome}
          </li>
        ))}
      </ol>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-900">{passo + 1}. {PASSOS[passo]}</h2>
        {passo === 0 && <PassoIdentificacao form={form} unidades={ref.unidades} mostrarErros={tentou} modo={modo} origemNome={origemNome}
          carregandoOrigem={carregandoOrigem} erroOrigem={erroOrigem} onModo={trocarModo} onDuplicarDe={duplicarDe} onChange={mudar} />}
        {passo === 1 && <PassoComoFatura form={form} onChange={mudar} />}
        {passo === 2 && <PassoPrecos itens={itens} onChange={setItens} mostrarErros={tentou} />}
        {passo === 3 && <PassoNomes nomes={nomes} onChange={setNomes} mostrarErros={tentou} refs={ref} />}
        {passo === 4 && <PassoRevisar form={form} itens={itens} nomes={nomes} problemas={problemas} criando={criando} erro={erroCriar} onCriar={() => void criar()} />}
      </section>

      <div className="flex justify-between">
        <Botao icone={ArrowLeft} disabled={passo === 0 || criando} onClick={() => { setTentou(false); setPasso(p => p - 1) }}>Voltar</Botao>
        {passo < PASSOS.length - 1 && <Botao variante="primario" onClick={avancar}>Próximo<ArrowRight className="size-4" aria-hidden="true" /></Botao>}
      </div>
    </div>
  )
}
