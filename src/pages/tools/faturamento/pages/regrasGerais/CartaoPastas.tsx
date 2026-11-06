import { useMemo, useState } from 'react'
import { Pencil, Search, X } from 'lucide-react'
import { db } from '../../lib/supabase'
import { Botao, Cartao, RevisaoAlteracoes, Selo } from '../../components/ui'
import { CLASSE_CONTROLE } from '../../components/ui/Campo'
import { nomeExibicao } from '../../lib/format'
import type { UnidadeCad } from '../../lib/diagnostico'
import { semAcentoMin } from '../diagnostico/texto'
import { alternarPasta, csv, listaCsv, marcada, pastasComStatus, type InfoChave } from './regras'

/** Regra por unidade (`*_pastas`): as unidades são escolhidas numa lista, nunca digitadas. Grava o texto exato da pasta. */
export function CartaoPastas({ info, config, unidades, onSalvo }: {
  info: InfoChave; config: Record<string, string>; unidades: UnidadeCad[]; onSalvo: () => void
}) {
  const atual = config[info.chave] ?? ''
  const [fase, setFase] = useState<'leitura' | 'editando' | 'revisando'>('leitura')
  const [rascunho, setRascunho] = useState<string[]>([])
  const [busca, setBusca] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | undefined>()
  const [salvo, setSalvo] = useState(false)

  const lidas = pastasComStatus(atual, unidades)
  const inexistentes = lidas.filter(l => !l.unidade)
  const opcoes = useMemo(() => {
    const q = semAcentoMin(busca.trim())
    return [...unidades].filter(u => !q || semAcentoMin(u.pasta).includes(q)).sort((a, b) => a.pasta.localeCompare(b.pasta, 'pt-BR'))
  }, [unidades, busca])
  const orfas = pastasComStatus(csv(rascunho), unidades).filter(l => !l.unidade)

  const antes = listaCsv(atual)
  const novas = rascunho.filter(p => !antes.includes(p))
  const removidas = antes.filter(p => !rascunho.includes(p))
  const nomeP = (p: string) => { const u = pastasComStatus(p, unidades)[0]?.unidade; return u ? nomeExibicao(u.pasta) : `${nomeExibicao(p)} (não existe)` }

  async function salvar() {
    setSalvando(true); setErro(undefined)
    const { error } = await db.from('config').upsert({ chave: info.chave, valor: csv(rascunho) }, { onConflict: 'chave' })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setFase('leitura'); setSalvo(true)
    onSalvo()
  }

  const acoes = fase === 'leitura'
    ? <Botao tamanho="pequeno" icone={Pencil} onClick={() => { setRascunho(antes); setBusca(''); setErro(undefined); setSalvo(false); setFase('editando') }}>Editar</Botao>
    : <Botao tamanho="pequeno" variante="fantasma" onClick={() => setFase('leitura')}>Descartar</Botao>

  return (
    <Cartao titulo={info.titulo} descricao={info.explicacao} cor="violet" destaque={fase === 'leitura' ? undefined : 'edicao'} acoes={acoes}>
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800">{info.chave}</code>
        <span>Quem lê: {info.lidoPor}</span>
        {salvo && fase === 'leitura' && <Selo cor="emerald">Salvo</Selo>}
      </p>

      {fase === 'leitura' && (
        lidas.length === 0
          ? <p className="mt-3 text-sm text-slate-700">Nenhuma unidade escolhida.</p>
          : (
            <>
              <ul className="mt-3 flex flex-wrap gap-2">
                {lidas.map(l => (
                  <li key={l.pasta}>
                    {l.unidade
                      ? <Selo cor="slate">{nomeExibicao(l.unidade.pasta)}</Selo>
                      : <Selo cor="rose" title="Nenhuma unidade tem esta pasta: a regra está desligada para ela">{nomeExibicao(l.pasta)} · não existe</Selo>}
                  </li>
                ))}
              </ul>
              {inexistentes.length > 0 && <p role="alert" className="mt-2 text-xs font-medium text-rose-800">{inexistentes.length} pasta(s) não existem mais. Clique em Editar e tire da lista.</p>}
            </>
          )
      )}

      {fase === 'editando' && (
        <div className="mt-4 space-y-3">
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">Marque as unidades em que a regra vale. Só elas são afetadas — as outras ficam como estão.</p>
          {orfas.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Pastas que não existem">
              {orfas.map(o => (
                <li key={o.pasta} className="inline-flex items-center gap-1 rounded-full bg-rose-50 py-1 pl-3 pr-1 text-sm text-rose-900 ring-1 ring-inset ring-rose-200">
                  {nomeExibicao(o.pasta)} · não existe
                  <button type="button" aria-label={`Remover ${o.pasta}`} className="rounded-full p-1 hover:bg-rose-100" onClick={() => setRascunho(rascunho.filter(p => p !== o.pasta))}><X className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <label className="relative block">
            <span className="sr-only">Buscar unidade</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" aria-hidden="true" />
            <input className={`${CLASSE_CONTROLE} pl-9`} placeholder="Buscar unidade…" value={busca} onChange={e => setBusca(e.target.value)} />
          </label>
          <ul className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white">
            {opcoes.map(u => (
              <li key={u.id} className="border-b border-slate-100 last:border-0">
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="size-4 rounded border-slate-400" checked={marcada(rascunho, u)} onChange={() => setRascunho(alternarPasta(rascunho, u))} />
                  <span className="flex-1 text-slate-900">{nomeExibicao(u.pasta)}</span>
                  <span className="text-xs text-slate-600">{u.empresa === 'MEDIMAGEM' ? 'Medimagem' : 'PRN'}</span>
                </label>
              </li>
            ))}
            {opcoes.length === 0 && <li className="px-3 py-3 text-sm text-slate-600">Nenhuma unidade encontrada.</li>}
          </ul>
          <p className="text-xs text-slate-600">{rascunho.length} {rascunho.length === 1 ? 'unidade escolhida' : 'unidades escolhidas'}</p>
          <Botao variante="primario" disabled={!novas.length && !removidas.length} onClick={() => setFase('revisando')}>Revisar alterações</Botao>
        </div>
      )}

      {fase === 'revisando' && (
        <div className="mt-4">
          <RevisaoAlteracoes salvando={salvando} erro={erro} onVoltar={() => setFase('editando')} onConfirmar={() => void salvar()}
            mudancas={[
              ...novas.map(p => ({ rotulo: 'Passa a valer em', antes: 'não valia', depois: nomeP(p) })),
              ...removidas.map(p => ({ rotulo: 'Deixa de valer em', antes: 'valia', depois: nomeP(p) })),
            ]} />
        </div>
      )}
    </Cartao>
  )
}
