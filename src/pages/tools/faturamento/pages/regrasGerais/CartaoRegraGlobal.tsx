import { useState } from 'react'
import { AlertTriangle, Pencil, Plus, X } from 'lucide-react'
import { db } from '../../lib/supabase'
import { Botao, Cartao, RevisaoAlteracoes, Segmentado, Selo } from '../../components/ui'
import { CLASSE_CONTROLE } from '../../components/ui/Campo'
import { adicionarItem, csv, duplicadoEntra, fraseGlobal, listaCsv, validarGlobal, valorEfetivo, type InfoChave } from './regras'
import { Info } from 'lucide-react'

/** Leitura + edição de uma regra que vale para todas as unidades (nível pesado: digitar ALTERAR). */
export function CartaoRegraGlobal({ info, config, totalUnidades, onSalvo }: {
  info: InfoChave; config: Record<string, string>; totalUnidades: number; onSalvo: () => void
}) {
  const atual = valorEfetivo(config, info)
  const [fase, setFase] = useState<'leitura' | 'editando' | 'revisando'>('leitura')
  const [rascunho, setRascunho] = useState(atual.valor)
  const [novoItem, setNovoItem] = useState('')
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | undefined>()
  const [salvoEm, setSalvoEm] = useState(false)

  const itens = listaCsv(rascunho)
  const erroValor = fase === 'editando' ? validarGlobal(info, rascunho) : null
  const mudou = rascunho.trim() !== atual.valor.trim()

  function iniciar() { setRascunho(atual.valor); setNovoItem(''); setErroLista(null); setTexto(''); setErro(undefined); setSalvoEm(false); setFase('editando') }
  function incluir() {
    const r = adicionarItem(itens, novoItem)
    setErroLista(r.erro ?? null)
    if (!r.erro) { setRascunho(csv(r.lista)); setNovoItem('') }
  }
  async function salvar() {
    if (texto !== 'ALTERAR') { setErro('Digite ALTERAR (em maiúsculas) para confirmar.'); return }
    setSalvando(true); setErro(undefined)
    const { error } = await db.from('config').upsert({ chave: info.chave, valor: rascunho.trim() }, { onConflict: 'chave' })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setFase('leitura'); setSalvoEm(true)
    onSalvo()
  }

  const acoes = fase === 'leitura'
    ? <Botao tamanho="pequeno" icone={Pencil} onClick={iniciar}>Editar</Botao>
    : <Botao tamanho="pequeno" variante="fantasma" onClick={() => setFase('leitura')}>Descartar</Botao>

  return (
    <Cartao titulo={info.titulo} descricao={info.explicacao} cor="indigo" destaque={fase === 'leitura' ? undefined : 'edicao'} acoes={acoes}>
      <p className="text-sm font-medium text-slate-900">{fraseGlobal(info.chave, fase === 'leitura' ? atual.valor : rascunho)}</p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800">{info.chave}</code>
        {atual.padrao && fase === 'leitura' && <Selo cor="slate">usando o padrão do sistema</Selo>}
        {salvoEm && fase === 'leitura' && <Selo cor="emerald">Salvo</Selo>}
        <span>Quem lê: {info.lidoPor}</span>
      </p>

      {fase !== 'leitura' && (
        <div role="note" className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden="true" />
          Esta mudança vale para as {totalUnidades} unidades no próximo relatório.
        </div>
      )}

      {fase === 'editando' && (
        <div className="mt-4 space-y-3">
          {info.tipo === 'simnao' ? (
            <Segmentado nome={info.chave} rotulo={info.titulo} valor={duplicadoEntra(rascunho) ? 'sim' : 'nao'} onChange={v => setRascunho(v)}
              opcoes={[{ valor: 'sim', rotulo: 'Sim, entram' }, { valor: 'nao', rotulo: 'Não, ficam de fora' }]} />
          ) : (
            <>
              <ul className="flex flex-wrap gap-2">
                {itens.map(i => (
                  <li key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm text-slate-900 ring-1 ring-inset ring-slate-300">
                    {i}
                    <button type="button" aria-label={`Remover ${i}`} className="rounded-full p-1 text-slate-600 hover:bg-slate-200" onClick={() => setRascunho(csv(itens.filter(x => x !== i)))}><X className="size-3.5" /></button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input className={CLASSE_CONTROLE} aria-label="Novo item" placeholder="Novo item…" value={novoItem} onChange={e => setNovoItem(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); incluir() } }} />
                <Botao icone={Plus} disabled={!novoItem.trim()} onClick={incluir}>Adicionar</Botao>
              </div>
              {erroLista && <p role="alert" className="text-xs font-medium text-rose-700">{erroLista}</p>}
            </>
          )}
          {erroValor && <p role="alert" className="text-xs font-medium text-rose-700">{erroValor}</p>}
          <Botao variante="primario" disabled={!mudou || !!erroValor} onClick={() => { setTexto(''); setErro(undefined); setFase('revisando') }}>Revisar alteração</Botao>
          {!mudou && <p className="text-xs text-slate-600">Nada mudou ainda.</p>}
        </div>
      )}

      {fase === 'revisando' && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-slate-900">
            Para confirmar, digite <span className="rounded bg-white px-1 py-0.5 font-mono text-rose-700 ring-1 ring-rose-200">ALTERAR</span>
            <input className={`${CLASSE_CONTROLE} mt-1 max-w-xs font-mono`} value={texto} autoComplete="off" spellCheck={false} onChange={e => setTexto(e.target.value)} />
          </label>
          <RevisaoAlteracoes salvando={salvando} erro={erro} onVoltar={() => setFase('editando')} onConfirmar={() => void salvar()}
            mudancas={[{ rotulo: info.titulo, antes: fraseGlobal(info.chave, atual.valor), depois: fraseGlobal(info.chave, rascunho) }]} />
          <p className="flex items-center gap-1.5 text-xs text-slate-600"><Info className="size-3.5" aria-hidden="true" />O valor antigo era: <code className="font-mono">{atual.valor || '(vazio)'}</code></p>
        </div>
      )}
    </Cartao>
  )
}
