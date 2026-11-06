import { useMemo, useState } from 'react'
import { Link2, EyeOff, Loader2 } from 'lucide-react'
import { db } from '../../lib/supabase'
import { Botao } from '../../components/ui'
import { CLASSE_CONTROLE } from '../../components/ui/Campo'
import type { UnidadeCad } from '../../lib/diagnostico'
import { nomeExibicao, semAcentoMin } from './texto'

/** D33: ligar o nome do Bruto a uma unidade (insere em alias) ou ignorá-lo (insere em nome_ignorado). */
export function ResolverDesconhecido({ nome, unidades, onMudou }: { nome: string; unidades: UnidadeCad[]; onMudou: () => void }) {
  const [modo, setModo] = useState<'ligar' | 'ignorar' | null>(null)
  const [busca, setBusca] = useState('')
  const [escolhida, setEscolhida] = useState('')
  const [motivo, setMotivo] = useState('')
  const [rodando, setRodando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const opcoes = useMemo(() => {
    const q = semAcentoMin(busca.trim())
    return unidades.filter(u => !q || semAcentoMin(u.pasta).includes(q)).sort((a, b) => a.pasta.localeCompare(b.pasta, 'pt-BR')).slice(0, 50)
  }, [unidades, busca])

  async function gravar() {
    setRodando(true); setErro(null)
    const r = modo === 'ligar'
      ? await db.from('alias').insert({ nome_bruto: nome, unidade_id: escolhida })
      : await db.from('nome_ignorado').insert({ nome_bruto: nome, motivo: motivo.trim() })
    setRodando(false)
    if (r.error) { setErro(r.error.message); return }
    setModo(null)
    onMudou()
  }

  if (!modo) {
    return (
      <div className="flex flex-wrap gap-2">
        <Botao tamanho="pequeno" icone={Link2} onClick={() => setModo('ligar')}>Ligar a uma unidade</Botao>
        <Botao tamanho="pequeno" variante="fantasma" icone={EyeOff} onClick={() => setModo('ignorar')}>Ignorar</Botao>
      </div>
    )
  }
  const pronto = modo === 'ligar' ? !!escolhida : motivo.trim().length > 0
  return (
    <div className="mt-2 w-full min-w-[18rem] space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      {modo === 'ligar' ? (
        <>
          <p className="text-slate-700">Ligar <strong>“{nome}”</strong> a qual unidade? Os exames dele passam a ser faturados por ela na próxima geração.</p>
          <input className={CLASSE_CONTROLE} placeholder="Buscar unidade…" aria-label="Buscar unidade" value={busca} onChange={e => setBusca(e.target.value)} />
          <select className={CLASSE_CONTROLE} aria-label="Unidade" size={6} value={escolhida} onChange={e => setEscolhida(e.target.value)}>
            {opcoes.map(u => <option key={u.id} value={u.id}>{nomeExibicao(u.pasta)} — {u.empresa === 'MEDIMAGEM' ? 'Medimagem' : 'PRN'}</option>)}
          </select>
        </>
      ) : (
        <>
          <p className="text-slate-700">Ignorar <strong>“{nome}”</strong>: ele deixa de aparecer como erro e nunca é faturado. Diga o motivo.</p>
          <input className={CLASSE_CONTROLE} placeholder="Motivo (ex.: nome de teste)" aria-label="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)} />
        </>
      )}
      {erro && <p role="alert" className="text-xs font-medium text-rose-700">Não foi possível gravar: {erro}</p>}
      <div className="flex gap-2">
        <Botao tamanho="pequeno" variante="primario" disabled={!pronto || rodando} icone={rodando ? Loader2 : undefined} onClick={() => void gravar()}>{rodando ? 'Gravando…' : 'Confirmar'}</Botao>
        <Botao tamanho="pequeno" disabled={rodando} onClick={() => setModo(null)}>Cancelar</Botao>
      </div>
    </div>
  )
}
