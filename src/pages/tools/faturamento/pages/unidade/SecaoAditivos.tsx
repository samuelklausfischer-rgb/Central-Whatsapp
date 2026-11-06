import { useMemo, useState } from 'react'
import { FileSignature, Pencil, Plus, Save, Trash2, TrendingUp } from 'lucide-react'
import { TIPOS_EVENTO, brl, dataBR, hojeISO } from '../../lib/format'
import type { Backup } from '../../lib/backup'
import { AvisoDesfazer, Botao, Campo, CLASSE_CONTROLE, Cartao, ConfirmarApagar, RevisaoAlteracoes, Selo, Vazio } from '../../components/ui'
import type { EventoCompleto, NovoEvento, ValorEvento } from './useUnidade'
import type { ItemCompleto } from './EditorPrecos'
import {
  FORM_TERMO_VAZIO, camposDeForm, diffValores, efeitosApagarTermo, formDeTermo, mudancasNovoTermo, mudancasTermo, tipoLegivel, validarTermo,
  type CamposTermo, type FormTermo, type ValorTermo,
} from './EditorTermo'

export function SecaoAditivos({ eventos, itens, pastaExibida, alvoId, onCriar, onSalvar, onApagar, onRecarregar }: {
  eventos: EventoCompleto[]; itens: ItemCompleto[]; pastaExibida: string; alvoId?: string
  onCriar: (ev: NovoEvento, valores: ValorEvento[]) => void | Promise<unknown>
  onSalvar: (e: EventoCompleto, campos: CamposTermo | null, upserts: ValorTermo[], removidos: string[]) => Promise<Backup | null>
  onApagar: (e: EventoCompleto) => Promise<Backup>
  onRecarregar: () => void | Promise<unknown>
}) {
  const [editando, setEditando] = useState(false)
  const [apagando, setApagando] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null) // id do termo em edição, 'novo' ou null
  const [salvo, setSalvo] = useState(false)
  const [backup, setBackup] = useState<Backup | null>(null)
  const hoje = hojeISO()

  // mais recente no topo; sem data vai para o fim
  const ordenados = useMemo(() => [...eventos].sort((a, b) => {
    const da = a.data_referencia ?? '', db = b.data_referencia ?? ''
    if (da !== db) return !da ? 1 : !db ? -1 : da < db ? 1 : -1
    return b.ordem - a.ordem
  }), [eventos])
  const idVigente = ordenados.find(e => { const d = e.data_efeito ?? e.data_referencia; return d != null && d.slice(0, 10) <= hoje })?.id
  const nomeItem = (id: string) => itens.find(i => i.id === id)?.exame ?? 'Item'

  const fechar = () => { setEditando(false); setApagando(null); setAberto(null) }
  const acoes = editando
    ? <><Selo cor="sky">Editando</Selo><Botao variante="fantasma" tamanho="pequeno" onClick={fechar}>Concluir</Botao></>
    : <>{salvo && <Selo cor="emerald">Salvo</Selo>}<Botao icone={Pencil} tamanho="pequeno" onClick={() => { setSalvo(false); setEditando(true) }}>Editar termos</Botao></>

  const concluido = () => { setSalvo(true); setTimeout(() => setSalvo(false), 4000) }

  return (
    <Cartao id="aditivos" titulo="Aditivos e reajustes" icone={TrendingUp} cor="violet" descricao="Termos do contrato, do mais recente para o mais antigo." acoes={acoes} destaque={editando ? 'edicao' : undefined}>
      <div className="space-y-5">
        {backup && <AvisoDesfazer backup={backup} onDesfeito={() => { setBackup(null); void onRecarregar() }} />}
        {!ordenados.length ? (
          <Vazio icone={FileSignature} titulo="Sem termos cadastrados" texto="Aditivos e reajustes registrados aparecem aqui em ordem de data." />
        ) : (
          <ol className="relative">
            {ordenados.map((e, k) => {
              const ef = efeitosApagarTermo(e.tipo, e.evento_valor.length)
              return (
                <li key={e.id} className={`relative flex gap-4 rounded-lg pb-6 last:pb-0 ${alvoId === e.id ? 'bg-amber-50 ring-2 ring-amber-400' : ''}`}>
                  {k < ordenados.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" aria-hidden="true" />}
                  <span className={`relative z-10 mt-1.5 size-[15px] shrink-0 rounded-full border-2 ${e.id === idVigente ? 'border-emerald-500 bg-emerald-100' : 'border-slate-300 bg-white'}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold tabular-nums text-slate-900">{e.data_referencia ? dataBR(e.data_referencia) : 'Sem data'}</span>
                      {!e.data_referencia && <Selo cor="rose">termo ignorado no cálculo</Selo>}
                      {e.qualidade_data === 'aproximada' && <Selo cor="amber">data aproximada</Selo>}
                      {e.id === idVigente && <Selo cor="emerald" cheio>vale hoje</Selo>}
                      <span className="text-sm text-slate-700">{e.numero ?? tipoLegivel(e.tipo)} · {tipoLegivel(e.tipo)}</span>
                      {e.percentual != null && <Selo cor="indigo">{String(e.percentual).replace('.', ',')}%{e.indice ? ` · ${e.indice}` : ''}</Selo>}
                    </div>
                    {e.evento_valor.length > 0 && (
                      <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-800">
                        {e.evento_valor.map((v, i) => <li key={i}>{v.item_preco?.exame ?? '?'}: <span className="font-medium tabular-nums">{brl(v.valor)}</span></li>)}
                      </ul>
                    )}
                    {e.objeto && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-slate-600 hover:text-slate-900">Ver o que o termo faz</summary>
                        <p className="mt-1 text-slate-700">{e.objeto}</p>
                      </details>
                    )}
                    {e.fonte_doc && <p className="text-xs text-slate-600">Fonte: {e.fonte_doc}</p>}
                    {editando && aberto === e.id && (
                      <FormEvento
                        titulo={`Editar ${e.numero ?? tipoLegivel(e.tipo)}`} inicial={formDeTermo(e)} itens={itens}
                        montarRevisao={f => mudancasTermo(e, f, nomeItem)}
                        onSalvar={async f => {
                          const campos = camposDeForm(f)
                          const dv = diffValores(e.evento_valor, f.valores)
                          const mudouCampos = mudancasTermo({ ...e, evento_valor: [] }, { ...f, valores: {} }, nomeItem).length > 0
                          const b = await onSalvar(e, mudouCampos ? campos : null, [...dv.adicionados, ...dv.alterados.map(({ item_preco_id, valor }) => ({ item_preco_id, valor }))], dv.removidos.map(v => v.item_preco_id))
                          if (b) setBackup(b)
                          concluido()
                        }}
                        onFechar={() => setAberto(null)}
                      />
                    )}
                    {editando && aberto !== e.id && (apagando === e.id ? (
                      <ConfirmarApagar
                        nivel={ef.nivel} titulo={`Apagar “${e.numero ?? tipoLegivel(e.tipo)}”?`} efeitos={ef.efeitos}
                        confirmarCom={ef.nivel === 'pesado' ? pastaExibida : undefined}
                        onConfirmar={async () => { const b = await onApagar(e); setBackup(b); setApagando(null); concluido() }}
                        onCancelar={() => setApagando(null)}
                      />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Botao variante="secundario" tamanho="pequeno" icone={Pencil} onClick={() => { setAberto(e.id); setApagando(null) }}>Editar termo</Botao>
                        <Botao variante="fantasma" tamanho="pequeno" icone={Trash2} onClick={() => { setApagando(e.id); setAberto(null) }}>Apagar</Botao>
                      </div>
                    ))}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {editando && (aberto === 'novo'
          ? (
            <FormEvento
              titulo="Novo termo" inicial={FORM_TERMO_VAZIO(eventos.length)} itens={itens}
              montarRevisao={f => mudancasNovoTermo(f, nomeItem)}
              onSalvar={async f => {
                const c = camposDeForm(f)
                const valores = Object.entries(f.valores).filter(([, v]) => v.trim() !== '').map(([k, v]) => ({ item_preco_id: k, valor: Number(v.replace(',', '.')) }))
                await onCriar(c, valores)
                concluido()
              }}
              onFechar={() => setAberto(null)}
            />)
          : <Botao icone={Plus} onClick={() => { setAberto('novo'); setApagando(null) }}>Novo termo</Botao>)}
      </div>
    </Cartao>
  )
}

function FormEvento({ titulo, inicial, itens, montarRevisao, onSalvar, onFechar }: {
  titulo: string; inicial: FormTermo; itens: ItemCompleto[]
  montarRevisao: (f: FormTermo) => { rotulo: string; antes: string; depois: string }[]
  onSalvar: (f: FormTermo) => Promise<void>; onFechar: () => void
}) {
  const [f, setF] = useState<FormTermo>(inicial)
  const [revisando, setRevisando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msgErro, setMsgErro] = useState<string | undefined>()
  const v = useMemo(() => validarTermo(f), [f])
  const set = <K extends keyof FormTermo>(k: K, valor: FormTermo[K]) => setF(x => ({ ...x, [k]: valor }))

  const revisar = () => {
    const erros = Object.values(v.campos)
    if (erros.length) { setMsgErro(erros.join(' ')); return }
    setMsgErro(undefined); setRevisando(true)
  }
  const confirmar = async () => {
    setSalvando(true); setMsgErro(undefined)
    try { await onSalvar(f); onFechar() }
    catch (e) { setMsgErro(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }

  if (revisando) {
    const lista = montarRevisao(f)
    return (
      <div className="space-y-3">
        {v.avisos.length > 0 && <ul className="list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-sm text-amber-900">{v.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        <RevisaoAlteracoes mudancas={lista} salvando={salvando} erro={msgErro} onConfirmar={confirmar} onVoltar={() => { setMsgErro(undefined); setRevisando(false) }} />
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border border-sky-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Tipo do termo" erro={v.campos.tipo}>
          <select className={CLASSE_CONTROLE} value={f.tipo} onChange={e => set('tipo', e.target.value)}>{TIPOS_EVENTO.map(t => <option key={t} value={t}>{tipoLegivel(t)}</option>)}</select>
        </Campo>
        <Campo rotulo="Número do termo"><input className={CLASSE_CONTROLE} placeholder="ex.: 3º TA" value={f.numero} onChange={e => set('numero', e.target.value)} /></Campo>
        <Campo rotulo="Ordem" ajuda="Desempata termos da mesma data." erro={v.campos.ordem}><input inputMode="numeric" className={CLASSE_CONTROLE} value={f.ordem} onChange={e => set('ordem', e.target.value)} /></Campo>
        <Campo rotulo="Data de assinatura"><input type="date" className={CLASSE_CONTROLE} value={f.data_assinatura} onChange={e => set('data_assinatura', e.target.value)} /></Campo>
        <Campo rotulo="Data de efeito" ajuda="Quando passa a valer; tem prioridade sobre a assinatura."><input type="date" className={CLASSE_CONTROLE} value={f.data_efeito} onChange={e => set('data_efeito', e.target.value)} /></Campo>
        <Campo rotulo="Nova vigência até" ajuda="Para prorrogações."><input type="date" className={CLASSE_CONTROLE} value={f.nova_vigencia_fim} onChange={e => set('nova_vigencia_fim', e.target.value)} /></Campo>
        <Campo rotulo="Percentual (%)" erro={v.campos.percentual}><input inputMode="decimal" className={CLASSE_CONTROLE} placeholder="ex.: 4,5" value={f.percentual} onChange={e => set('percentual', e.target.value)} /></Campo>
        <Campo rotulo="Índice"><input className={CLASSE_CONTROLE} placeholder="ex.: IPCA" value={f.indice} onChange={e => set('indice', e.target.value)} /></Campo>
        <Campo rotulo="Documento de origem"><input className={CLASSE_CONTROLE} value={f.fonte_doc} onChange={e => set('fonte_doc', e.target.value)} /></Campo>
      </div>
      <Campo rotulo="Link do documento"><input className={CLASSE_CONTROLE} value={f.fonte_uri} onChange={e => set('fonte_uri', e.target.value)} /></Campo>
      <Campo rotulo="O que o termo faz"><input className={CLASSE_CONTROLE} value={f.objeto} onChange={e => set('objeto', e.target.value)} /></Campo>
      {v.avisos.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">{v.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      {itens.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800">Valores escritos no termo, por item</legend>
          <p className="text-xs text-slate-600">Preencha para criar ou mudar o valor do item neste termo. <b>Apague o campo para tirar o valor</b> do termo. Vazio em todos = vale só o percentual.</p>
          <div className="grid gap-2 md:grid-cols-2">
            {itens.map(i => (
              <label key={i.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-700" title={i.exame}>{i.exame}</span>
                <input aria-label={`Valor de ${i.exame} neste termo`} inputMode="decimal" className={`${CLASSE_CONTROLE} w-28 text-right tabular-nums`}
                  value={f.valores[i.id] ?? ''} onChange={e => set('valores', { ...f.valores, [i.id]: e.target.value })} />
              </label>
            ))}
          </div>
          {v.campos.valores && <p role="alert" className="text-xs font-medium text-rose-700">{v.campos.valores}</p>}
        </fieldset>
      )}
      {msgErro && <p role="alert" className="text-sm font-medium text-rose-700">{msgErro}</p>}
      <div className="flex flex-wrap gap-2">
        <Botao variante="primario" icone={Save} onClick={revisar}>Revisar alterações</Botao>
        <Botao variante="fantasma" onClick={onFechar}>Descartar</Botao>
      </div>
    </div>
  )
}
