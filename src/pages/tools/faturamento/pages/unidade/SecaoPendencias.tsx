import { useState } from 'react'
import { Check, CircleCheck, Pencil, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import type { Pendencia } from '../../lib/tipos'
import { limparDetalhePendencia, plural, rotuloPendencia } from '../../lib/format'
import type { Backup } from '../../lib/backup'
import { AvisoDesfazer, Botao, Campo, Cartao, CLASSE_CONTROLE, ConfirmarApagar, Selo, Vazio } from '../../components/ui'
import { TIPOS_PENDENCIA, TIPO_MANUAL, validarPendencia } from './EditorPendencias'

interface Acoes {
  onResolver: (id: string, nota: string) => void | Promise<unknown>
  onReabrir: (p: Pendencia) => void | Promise<unknown>
  onEditarNota: (id: string, nota: string) => void | Promise<unknown>
  onApagar: (p: Pendencia) => Promise<Backup>
  onBackup: (b: Backup) => void
}

export function SecaoPendencias({ pend, alvoId, onResolver, onCriar, onReabrir, onEditarNota, onApagar, onRecarregar }: {
  pend: Pendencia[]; alvoId?: string
  onResolver: (id: string, nota: string) => void | Promise<unknown>
  onCriar: (tipo: string, detalhe: string) => void | Promise<unknown>
  onReabrir: (p: Pendencia) => void | Promise<unknown>
  onEditarNota: (id: string, nota: string) => void | Promise<unknown>
  onApagar: (p: Pendencia) => Promise<Backup>
  onRecarregar: () => void | Promise<unknown>
}) {
  const abertas = pend.filter(p => !p.resolvida)
  const resolvidas = pend.filter(p => p.resolvida)
  const [criando, setCriando] = useState(false)
  const [backup, setBackup] = useState<Backup | null>(null)
  const acoes: Acoes = { onResolver, onReabrir, onEditarNota, onApagar, onBackup: setBackup }
  return (
    <Cartao
      id="pendencias"
      titulo="Pendências do cadastro" icone={TriangleAlert} cor="amber"
      acoes={!criando ? <Botao tamanho="pequeno" icone={Plus} onClick={() => setCriando(true)}>Nova pendência</Botao> : undefined}
      descricao={abertas.length
        ? `${plural(abertas.length, 'pendência em aberto', 'pendências em aberto')}${resolvidas.length ? ` · ${plural(resolvidas.length, 'resolvida', 'resolvidas')}` : ''}`
        : resolvidas.length ? `Tudo resolvido · ${plural(resolvidas.length, 'resolvida', 'resolvidas')}` : 'Nada a conferir neste cadastro.'}
    >
      {backup && <div className="mb-4"><AvisoDesfazer backup={backup} onDesfeito={() => { setBackup(null); void onRecarregar() }} /></div>}
      {criando && <NovaPendencia onCriar={onCriar} onFechar={() => setCriando(false)} />}
      {!pend.length && !criando && <Vazio icone={CircleCheck} titulo="Nenhuma pendência" texto="O cadastro desta unidade não tem nada a conferir." />}
      {abertas.length > 0 && (
        <ul className="space-y-2">
          {abertas.map(p => <PendenciaItem key={p.id} p={p} destaque={alvoId === p.id} {...acoes} />)}
        </ul>
      )}
      {resolvidas.length > 0 && (
        <details className={abertas.length ? 'mt-4' : ''} open={resolvidas.some(p => p.id === alvoId) || undefined}>
          <summary className="cursor-pointer text-sm font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40">
            Resolvidas ({resolvidas.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {resolvidas.map(p => <PendenciaItem key={p.id} p={p} destaque={alvoId === p.id} {...acoes} />)}
          </ul>
        </details>
      )}
    </Cartao>
  )
}

function NovaPendencia({ onCriar, onFechar }: { onCriar: (tipo: string, detalhe: string) => void | Promise<unknown>; onFechar: () => void }) {
  const [tipo, setTipo] = useState(TIPO_MANUAL)
  const [detalhe, setDetalhe] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | undefined>()
  const erros = validarPendencia(tipo, detalhe)
  async function criar() {
    if (erros.tipo || erros.detalhe) { setErro(erros.tipo ?? erros.detalhe); return }
    setEnviando(true); setErro(undefined)
    try { await onCriar(tipo, detalhe); onFechar() }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setEnviando(false) }
  }
  return (
    <div className="mb-4 space-y-3 rounded-lg border border-sky-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">Nova pendência</p>
      <div className="grid gap-3 md:grid-cols-[16rem_1fr]">
        <Campo rotulo="Tipo">
          <select className={CLASSE_CONTROLE} value={tipo} onChange={e => setTipo(e.target.value)}>
            {TIPOS_PENDENCIA.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
          </select>
        </Campo>
        <Campo rotulo="O que precisa ser conferido">
          <input className={CLASSE_CONTROLE} value={detalhe} onChange={e => setDetalhe(e.target.value)} autoFocus />
        </Campo>
      </div>
      {erro && <p role="alert" className="text-sm font-medium text-rose-700">{erro}</p>}
      <div className="flex gap-2">
        <Botao variante="primario" icone={enviando ? undefined : Plus} disabled={enviando} onClick={() => { void criar() }}>{enviando ? 'Salvando…' : 'Criar pendência'}</Botao>
        <Botao variante="fantasma" disabled={enviando} onClick={onFechar}>Cancelar</Botao>
      </div>
    </div>
  )
}

type Modo = null | 'resolver' | 'nota' | 'apagar'

function PendenciaItem({ p, destaque, onResolver, onReabrir, onEditarNota, onApagar, onBackup }: { p: Pendencia; destaque: boolean } & Acoes) {
  const [modo, setModo] = useState<Modo>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | undefined>()
  const [nota, setNota] = useState('')
  const idNota = `nota-pend-${p.id}`
  const manual = p.tipo === TIPO_MANUAL

  async function rodar(f: () => void | Promise<unknown>, depois?: () => void) {
    setEnviando(true); setErro(undefined)
    try { await f(); depois?.() }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setEnviando(false) }
  }
  const fechar = () => { setModo(null); setNota(''); setErro(undefined) }

  return (
    <li className={`rounded-lg border px-3 py-2.5 ${destaque ? 'ring-2 ring-amber-400' : ''} ${p.resolvida ? 'border-slate-200 bg-white' : 'border-amber-300 border-l-4 border-l-amber-500 bg-amber-50'}`}>
      <div className="flex flex-wrap items-start gap-2">
        {p.resolvida
          ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Resolvida" />
          : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Em aberto" />}
        <div className="min-w-0 flex-1 text-sm">
          <Selo cor={p.resolvida ? 'slate' : 'amber'}>{manual ? 'Anotação manual' : rotuloPendencia(p.tipo)}</Selo>
          <p className={`mt-1 ${p.resolvida ? 'text-slate-600' : 'text-slate-900'}`}>{limparDetalhePendencia(p.detalhe)}</p>
          {p.nota && <p className="mt-1 text-xs text-slate-600">Nota: {p.nota}</p>}
        </div>
        {modo === null && (
          <div className="flex flex-wrap gap-1.5">
            {!p.resolvida && <Botao tamanho="pequeno" icone={Check} onClick={() => { setNota(''); setModo('resolver') }}>Resolver</Botao>}
            {p.resolvida && <Botao tamanho="pequeno" icone={RotateCcw} disabled={enviando} onClick={() => { void rodar(() => onReabrir(p)) }}>Reabrir</Botao>}
            <Botao tamanho="pequeno" variante="fantasma" icone={Pencil} onClick={() => { setNota(p.nota ?? ''); setModo('nota') }}>Nota</Botao>
            {manual && <Botao tamanho="pequeno" variante="fantasma" icone={Trash2} onClick={() => setModo('apagar')}>Apagar</Botao>}
          </div>
        )}
      </div>
      {modo === 'apagar' ? (
        <div className="mt-3">
          <ConfirmarApagar nivel="leve" titulo="Apagar esta pendência manual?"
            efeitos={['A anotação some da lista. Uma cópia de segurança (arquivo) é baixada antes, e dá para desfazer logo depois.']}
            onConfirmar={async () => { const b = await onApagar(p); onBackup(b); setModo(null) }} onCancelar={fechar} />
        </div>
      ) : modo !== null && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <div className="min-w-[16rem] flex-1">
            <label htmlFor={idNota} className="mb-1 block text-xs font-medium text-slate-700">{modo === 'resolver' ? 'Como foi resolvida?' : 'Nota da pendência'}</label>
            <input id={idNota} className={CLASSE_CONTROLE} value={nota} onChange={e => setNota(e.target.value)} autoFocus />
          </div>
          <Botao variante="primario" icone={Check} disabled={enviando}
            onClick={() => { void rodar(() => (modo === 'resolver' ? onResolver(p.id, nota.trim()) : onEditarNota(p.id, nota)), fechar) }}>
            {enviando ? 'Salvando…' : 'Confirmar'}
          </Botao>
          <Botao variante="fantasma" disabled={enviando} onClick={fechar}>Cancelar</Botao>
        </div>
      )}
      {modo === null && erro && <p role="alert" className="mt-2 text-xs font-medium text-rose-700">{erro}</p>}
      {modo !== null && modo !== 'apagar' && erro && <p role="alert" className="mt-2 text-xs font-medium text-rose-700">{erro}</p>}
    </li>
  )
}
