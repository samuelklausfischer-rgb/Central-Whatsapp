import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, Pencil, Plus, Save, Tag, Trash2 } from 'lucide-react'
import type { ItemVigente, PapelItem } from '../../lib/tipos'
import { brl, dataBR } from '../../lib/format'
import { BLOCOS_PRECO, ROTULO_PAPEL } from '../../lib/config'
import type { Backup } from '../../lib/backup'
import { AvisoDesfazer, Botao, Campo, CLASSE_CONTROLE, Cartao, ConfirmarApagar, RevisaoAlteracoes, Selo, Vazio } from '../../components/ui'
import {
  MODALIDADES, PAPEIS, avisosItem, avisosRevisao, diffItens, efeitosRemoverItem, mudancasItens, paraRascunho, rascunhoVazio, validarRascunho,
  type ItemAlterado, type ItemCompleto, type RascunhoItem,
} from './EditorPrecos'

type Fase = 'leitura' | 'editando' | 'revisando'
type Linha = { item: ItemVigente; exame: string }

const FAIXA: Record<PapelItem, string> = {
  fixo: 'border-l-violet-400', normal: 'border-l-sky-400', urgencia: 'border-l-rose-400', excedente: 'border-l-amber-400',
}
const COR_PAPEL: Record<PapelItem, 'violet' | 'sky' | 'rose' | 'amber'> = { fixo: 'violet', normal: 'sky', urgencia: 'rose', excedente: 'amber' }
const DESTAQUE = 'bg-amber-50 ring-2 ring-inset ring-amber-400'

/** "HOSPITAL — X — EXAME" vira {hospital: "X", exame: "EXAME"}; "HOSPITAL X — EXAME" vira {hospital: "HOSPITAL X", exame: "EXAME"}. */
function separarHospital(nome: string): { hospital: string; exame: string } | null {
  const partes = nome.split(/\s+[—–]\s+/).map(s => s.trim())
  // mesma convenção do motor (doSub): "HOSPITAL — exame" → o que vem antes do travessão é o hospital (ex.: "HGERJ — Raio-x")
  if (partes.length < 2 || !partes[0]) return null
  if (/^hospital$/i.test(partes[0])) return partes.length >= 3 ? { hospital: partes[1], exame: partes.slice(2).join(' — ') } : null
  return { hospital: partes[0], exame: partes.slice(1).join(' — ') }
}

type CampoTexto = 'exame' | 'subunidade' | 'codigo' | 'unidade_medida' | 'quantidade_estimada' | 'valor_original'

export function SecaoPrecos({ itens, completos, valoresPorItem, pastaExibida, dataRef, onDataRef, onSalvarItens, onApagarItem, onRecarregar, alvoId, porHospital = false }: {
  /** Agrupar itens "HOSPITAL — exame" só quando a unidade tem nomes com subunidade (Exército, FHEMIG, UPAs). */
  porHospital?: boolean
  itens: ItemVigente[]; completos: ItemCompleto[]; valoresPorItem: Map<string, number>; pastaExibida: string; dataRef: string
  onDataRef: (d: string) => void
  onSalvarItens: (novos: RascunhoItem[], alterados: ItemAlterado[], onFeito: (r: { id?: string; chave?: string }) => void) => Promise<void>
  onApagarItem: (i: ItemCompleto) => Promise<Backup>
  onRecarregar: () => void | Promise<unknown>
  alvoId?: string
}) {
  const [fase, setFase] = useState<Fase>('leitura')
  const [rasc, setRasc] = useState<Record<string, RascunhoItem>>({}) // linhas existentes que o usuário mexeu
  const [novos, setNovos] = useState<RascunhoItem[]>([])
  const [erro, setErro] = useState<string | undefined>()
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [removendo, setRemovendo] = useState<string | null>(null)
  const [backup, setBackup] = useState<Backup | null>(null)

  const blocos = useMemo(() => {
    const papelDe = new Map(completos.map(c => [c.id, c.papel]))
    return BLOCOS_PRECO.map(b => ({ ...b, itens: itens.filter(i => (papelDe.get(i.item_preco_id) ?? 'normal') === b.papel) })).filter(b => b.itens.length)
  }, [itens, completos])
  const semValor = itens.filter(i => i.valor == null).length
  const vigentePorId = useMemo(() => new Map(itens.map(i => [i.item_preco_id, i])), [itens])

  // linhas da tabela de edição: existentes (com a edição por cima) e novas; uma linha nova já gravada (falha no meio) não repete
  const linhas: RascunhoItem[] = useMemo(() => {
    const ids = new Set(completos.map(c => c.id))
    return [...completos.map(c => rasc[c.id] ?? paraRascunho(c)), ...novos.filter(n => !ids.has(n.chave))]
  }, [completos, rasc, novos])
  const diff = useMemo(() => diffItens(completos, linhas), [completos, linhas])
  const errosPorLinha = useMemo(() => new Map(linhas.map(l => [l.chave, validarRascunho(l)])), [linhas])
  const nInvalidas = [...errosPorLinha.values()].filter(e => Object.keys(e).length).length
  const lista = mudancasItens(diff)
  const avisos = avisosRevisao(diff, valoresPorItem)
  const nAlteracoes = diff.novos.length + diff.alterados.length

  const abrir = () => { setRasc({}); setNovos([]); setErro(undefined); setSalvo(false); setRemovendo(null); setFase('editando') }
  const descartar = () => { setFase('leitura'); setRasc({}); setNovos([]); setErro(undefined); setRemovendo(null) }
  const revisar = () => {
    if (nInvalidas) { setErro(`${nInvalidas === 1 ? '1 linha tem' : `${nInvalidas} linhas têm`} campo inválido (veja em vermelho).`); return }
    setErro(undefined); setFase('revisando')
  }
  const confirmar = async () => {
    setSalvando(true); setErro(undefined)
    try {
      await onSalvarItens(diff.novos, diff.alterados, r => {
        if (r.id) setRasc(x => { const { [r.id!]: _, ...resto } = x; return resto })
        if (r.chave) setNovos(n => n.filter(x => x.chave !== r.chave))
      })
      setFase('leitura'); setRasc({}); setNovos([]); setSalvo(true); setTimeout(() => setSalvo(false), 4000)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }

  const mudar = (l: RascunhoItem, campo: keyof RascunhoItem, valor: string) => {
    const nova = { ...l, [campo]: valor } as RascunhoItem
    if (l.id) setRasc(r => ({ ...r, [l.chave]: nova }))
    else setNovos(n => n.map(x => (x.chave === l.chave ? nova : x)))
  }
  const adicionar = () => setNovos(n => [...n, rascunhoVazio(crypto.randomUUID())])
  const tirarNova = (chave: string) => setNovos(n => n.filter(x => x.chave !== chave))

  const editando = fase !== 'leitura'
  const acoes = fase === 'leitura'
    ? <>{salvo && <Selo cor="emerald">Salvo</Selo>}<Botao icone={Pencil} tamanho="pequeno" onClick={abrir}>Editar preços</Botao></>
    : <Selo cor="sky">{fase === 'editando' ? 'Editando' : 'Revisão'}</Selo>

  return (
    <Cartao id="precos" titulo="Preços" icone={Tag} cor="emerald" descricao="Valores por papel no cálculo. “Vigente” já considera os aditivos até a data escolhida." acoes={acoes} destaque={editando ? 'edicao' : undefined}>
      <div className="space-y-5">
        {backup && <AvisoDesfazer backup={backup} onDesfeito={() => { setBackup(null); void onRecarregar() }} />}

        <div className="max-w-[14rem]">
          <Campo rotulo="Ver preços em" ajuda="Mostra os preços como estavam nessa data.">
            <input type="date" className={CLASSE_CONTROLE} value={dataRef} disabled={editando} onChange={e => onDataRef(e.target.value)} />
          </Campo>
        </div>

        {semValor > 0 && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {semValor === 1 ? '1 item está' : `${semValor} itens estão`} sem valor nesta data — o cálculo vai parar para esta unidade.
          </p>
        )}

        {fase === 'revisando' ? (
          <div className="space-y-3">
            {avisos.length > 0 && (
              <ul className="list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-sm text-amber-900">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
            )}
            <RevisaoAlteracoes mudancas={lista} salvando={salvando} erro={erro} onConfirmar={confirmar} onVoltar={() => { setErro(undefined); setFase('editando') }} />
          </div>
        ) : editando ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
              Mude qualquer campo e clique em <b>Revisar alterações</b>. <b>Apagar</b> um item é imediato (com confirmação, cópia de segurança e “Desfazer”).
            </p>
            <TabelaEdicao
              linhas={linhas} erros={errosPorLinha} vigentePorId={vigentePorId} completos={completos} valoresPorItem={valoresPorItem}
              removendo={removendo} alvoId={alvoId} pastaExibida={pastaExibida}
              onMudar={mudar} onTirarNova={tirarNova} onRemover={setRemovendo}
              onApagar={async (item) => { const b = await onApagarItem(item); setBackup(b); setRemovendo(null); setRasc(r => { const { [item.id]: _, ...resto } = r; return resto }) }}
              itensVigentes={itens}
            />
            <Botao icone={Plus} onClick={adicionar}>Adicionar item</Botao>
            {erro && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{erro}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Botao variante="primario" icone={Save} disabled={!nAlteracoes} onClick={revisar}>Revisar alterações</Botao>
              <Botao variante="fantasma" onClick={descartar}>Descartar</Botao>
              <span className="text-xs text-slate-600">{nAlteracoes ? `${nAlteracoes} ${nAlteracoes === 1 ? 'linha alterada ou nova' : 'linhas alteradas ou novas'}` : 'Nada alterado ainda.'}</span>
            </div>
          </div>
        ) : (
          <>
            {!blocos.length && <Vazio icone={Tag} titulo="Nenhum item de preço" texto="Sem preço cadastrado o cálculo desta unidade não roda." />}
            {blocos.map(b => (
              <div key={b.papel} className={`rounded-lg border border-l-4 border-slate-200 ${FAIXA[b.papel]} bg-white`}>
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-slate-900">{b.titulo}</h3>
                  <Selo cor={COR_PAPEL[b.papel]}>{b.itens.length} {b.itens.length === 1 ? 'item' : 'itens'}</Selo>
                </div>
                {porHospital ? <Agrupado itens={b.itens} alvoId={alvoId} /> : <Tabela linhas={b.itens.map(i => ({ item: i, exame: i.exame }))} alvoId={alvoId} />}
              </div>
            ))}
          </>
        )}
      </div>
    </Cartao>
  )
}

function Agrupado({ itens, alvoId }: { itens: ItemVigente[]; alvoId?: string }) {
  const grupos = useMemo(() => {
    const m = new Map<string, Linha[]>()
    const soltos: Linha[] = []
    for (const i of itens) {
      const s = separarHospital(i.exame)
      if (s) m.set(s.hospital, [...(m.get(s.hospital) ?? []), { item: i, exame: s.exame }])
      else soltos.push({ item: i, exame: i.exame })
    }
    return { m, soltos }
  }, [itens])
  if (grupos.m.size < 2) return <Tabela linhas={itens.map(i => ({ item: i, exame: i.exame }))} alvoId={alvoId} />
  return (
    <div className="divide-y divide-slate-100">
      {grupos.soltos.length > 0 && <Tabela linhas={grupos.soltos} alvoId={alvoId} />}
      {[...grupos.m.entries()].map(([hosp, linhas]) => (
        <details key={hosp} className="group" open={linhas.some(l => l.item.item_preco_id === alvoId) || undefined}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 text-slate-600 transition-transform group-open:rotate-180" aria-hidden="true" />
            <span className="flex-1 font-medium text-slate-900">{hosp}</span>
            <span className="text-xs text-slate-600">{linhas.length} {linhas.length === 1 ? 'item' : 'itens'}{linhas.some(l => l.item.valor == null) ? ' · há item sem valor' : ''}</span>
          </summary>
          <Tabela linhas={linhas} alvoId={alvoId} />
        </details>
      ))}
    </div>
  )
}

function Tabela({ linhas, alvoId }: { linhas: Linha[]; alvoId?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-slate-600">
          <tr className="border-b border-slate-100">
            <th scope="col" className="px-4 py-2 font-medium">Exame / item</th>
            <th scope="col" className="px-2 py-2 font-medium">Mod.</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Original</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Vigente</th>
            <th scope="col" className="px-2 py-2 font-medium">Desde</th>
            <th scope="col" className="px-4 py-2 font-medium">Definido por</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {linhas.map(({ item: i, exame }) => (
            <tr key={i.item_preco_id} className={`align-top ${alvoId === i.item_preco_id ? DESTAQUE : ''}`}>
              <td className="px-4 py-2 text-slate-900">
                {exame}
                {i.valor == null && <div className="mt-1"><Selo cor="rose">sem valor — o cálculo vai parar</Selo></div>}
              </td>
              <td className="px-2 py-2 text-slate-700">{i.modalidade ?? '—'}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-700">{brl(i.valor_original)}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right text-base font-bold tabular-nums text-emerald-700">{brl(i.valor)}</td>
              <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">{dataBR(i.vigente_desde)}</td>
              <td className="px-4 py-2 text-xs text-slate-600">{i.definido_por ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const PEQUENO = `${CLASSE_CONTROLE} !px-2 !py-1.5 !text-xs`

function TabelaEdicao({ linhas, erros, vigentePorId, completos, valoresPorItem, removendo, alvoId, pastaExibida, itensVigentes, onMudar, onTirarNova, onRemover, onApagar }: {
  linhas: RascunhoItem[]; erros: Map<string, ReturnType<typeof validarRascunho>>; vigentePorId: Map<string, ItemVigente>
  completos: ItemCompleto[]; valoresPorItem: Map<string, number>; removendo: string | null; alvoId?: string; pastaExibida: string; itensVigentes: ItemVigente[]
  onMudar: (l: RascunhoItem, campo: keyof RascunhoItem, valor: string) => void
  onTirarNova: (chave: string) => void; onRemover: (id: string | null) => void; onApagar: (i: ItemCompleto) => Promise<void>
}) {
  const campo = (l: RascunhoItem, c: CampoTexto, rotulo: string, largura: string, extra = '') => (
    <input aria-label={`${rotulo} de ${l.exame || 'novo item'}`} className={`${PEQUENO} ${largura} ${extra}`} value={l[c]} onChange={e => onMudar(l, c, e.target.value)} />
  )
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="text-left text-xs text-slate-600">
          <tr className="border-b border-slate-100">
            <th scope="col" className="px-3 py-2 font-medium">Item / exame</th>
            <th scope="col" className="px-2 py-2 font-medium">Hospital</th>
            <th scope="col" className="px-2 py-2 font-medium">Modalidade</th>
            <th scope="col" className="px-2 py-2 font-medium">Papel</th>
            <th scope="col" className="px-2 py-2 font-medium">Código</th>
            <th scope="col" className="px-2 py-2 font-medium">Un. medida</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Qtd. estimada</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Valor original</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Vale hoje</th>
            <th scope="col" className="px-2 py-2"><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {linhas.map(l => {
            const e = erros.get(l.chave) ?? {}
            const av = avisosItem(l)
            const existente = l.id ? completos.find(c => c.id === l.id) : undefined
            const vig = l.id ? vigentePorId.get(l.id) : undefined
            const nVal = l.id ? valoresPorItem.get(l.id) ?? 0 : 0
            return (
              <Fragment key={l.chave}>
                <tr className={`align-top ${alvoId === l.id ? DESTAQUE : ''}`}>
                  <td className={`border-l-4 px-3 py-2 ${FAIXA[l.papel]}`}>
                    {campo(l, 'exame', 'Nome', 'w-64', e.exame ? 'border-rose-400' : '')}
                    {e.exame && <p role="alert" className="mt-0.5 text-xs font-medium text-rose-700">{e.exame}</p>}
                    {!l.id && <div className="mt-1"><Selo cor="emerald">novo</Selo></div>}
                    {av.map((t, i) => <p key={i} className="mt-0.5 max-w-[16rem] text-xs text-amber-800">{t}</p>)}
                  </td>
                  <td className="px-2 py-2">{campo(l, 'subunidade', 'Hospital', 'w-32')}</td>
                  <td className="px-2 py-2">
                    <select aria-label={`Modalidade de ${l.exame || 'novo item'}`} className={`${PEQUENO} w-28`} value={l.modalidade} onChange={ev => onMudar(l, 'modalidade', ev.target.value)}>
                      <option value="">Qualquer</option>
                      {MODALIDADES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select aria-label={`Papel de ${l.exame || 'novo item'}`} className={`${PEQUENO} w-28`} value={l.papel} onChange={ev => onMudar(l, 'papel', ev.target.value)}>
                      {PAPEIS.map(p => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">{campo(l, 'codigo', 'Código', 'w-24')}</td>
                  <td className="px-2 py-2">{campo(l, 'unidade_medida', 'Unidade de medida', 'w-20')}</td>
                  <td className="px-2 py-2">
                    {campo(l, 'quantidade_estimada', 'Quantidade estimada', 'w-20 text-right tabular-nums', e.quantidade_estimada ? 'border-rose-400' : '')}
                    {e.quantidade_estimada && <p role="alert" className="mt-0.5 text-xs font-medium text-rose-700">{e.quantidade_estimada}</p>}
                  </td>
                  <td className="px-2 py-2">
                    {campo(l, 'valor_original', 'Valor original', 'w-28 text-right tabular-nums', e.valor_original ? 'border-rose-400' : '')}
                    {e.valor_original && <p role="alert" className="mt-0.5 text-xs font-medium text-rose-700">{e.valor_original}</p>}
                    {nVal > 0 && <p className="mt-0.5 max-w-[9rem] text-right text-xs text-slate-600">O valor de hoje vem de aditivo; o original só vale antes do 1º termo.</p>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-700">
                    {vig ? <><span className="font-semibold text-emerald-700">{brl(vig.valor)}</span>{vig.definido_por && <div className="text-xs text-slate-600">{vig.definido_por}</div>}</> : '—'}
                  </td>
                  <td className="px-2 py-2">
                    {existente
                      ? <Botao tamanho="pequeno" variante="fantasma" icone={Trash2} aria-label={`Apagar ${l.exame}`} onClick={() => onRemover(removendo === existente.id ? null : existente.id)}>Apagar</Botao>
                      : <Botao tamanho="pequeno" variante="fantasma" icone={Trash2} aria-label="Tirar linha nova" onClick={() => onTirarNova(l.chave)}>Tirar</Botao>}
                  </td>
                </tr>
                {existente && removendo === existente.id && (
                  <tr>
                    <td colSpan={10} className="bg-rose-50/40 px-3 py-3">
                      <ApagarItem item={existente} nValores={nVal} outros={completos.filter(c => c.id !== existente.id).map(c => ({ papel: c.papel, modalidade: c.modalidade, valor: itensVigentes.find(v => v.item_preco_id === c.id)?.valor ?? null }))}
                        pastaExibida={pastaExibida} onCancelar={() => onRemover(null)} onApagar={() => onApagar(existente)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          {!linhas.length && <tr><td colSpan={10} className="px-3 py-6 text-center text-sm text-slate-600">Nenhum item. Use “Adicionar item”.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function ApagarItem({ item, nValores, outros, pastaExibida, onCancelar, onApagar }: {
  item: ItemCompleto; nValores: number; outros: { papel: PapelItem; modalidade: string | null; valor: number | null }[]
  pastaExibida: string; onCancelar: () => void; onApagar: () => Promise<void>
}) {
  const ef = efeitosRemoverItem(item, nValores, outros)
  return (
    <ConfirmarApagar
      nivel={ef.nivel} titulo={`Apagar o item “${item.exame}”?`} efeitos={ef.efeitos}
      confirmarCom={ef.nivel === 'pesado' ? pastaExibida : undefined}
      onConfirmar={onApagar} onCancelar={onCancelar}
    />
  )
}
