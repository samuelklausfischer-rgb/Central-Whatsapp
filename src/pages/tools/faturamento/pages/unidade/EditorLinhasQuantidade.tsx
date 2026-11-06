import { ArrowDown, ArrowUp, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Botao, CLASSE_CONTROLE } from '../../components/ui'
import type { LinhaEdit } from './EditorRegras'
import { novaChave } from './EditorRegras'

const separar = (texto: string) => texto.split(/\s+ou\s+/i)

/** Lista editável de "Se o estudo contém [texto] → conta [N]" (vale a primeira que casar). */
export function EditorLinhasQuantidade({ linhas, erros, onChange }: {
  linhas: LinhaEdit[]
  /** Erros por linha (mesma ordem de `linhas`); só preenchido depois de tentar revisar. */
  erros: string[][]
  onChange: (linhas: LinhaEdit[]) => void
}) {
  const trocar = (i: number, nova: LinhaEdit) => onChange(linhas.map((l, j) => (j === i ? nova : l)))
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= linhas.length) return
    const c = [...linhas]; [c[i], c[j]] = [c[j], c[i]]
    onChange(c)
  }
  return (
    <div className="space-y-2">
      {linhas.length === 0 && <p className="text-sm text-slate-600">Nenhuma regra: todo estudo conta 1 exame.</p>}
      {linhas.length > 1 && <p className="text-xs text-slate-600">Vale a primeira regra da lista que casar com o estudo.</p>}
      <ol className="space-y-2">
        {linhas.map((l, i) => (
          <li key={l.chave} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-end gap-2">
              {l.tipo === 'simples' ? (
                <label className="min-w-[14rem] flex-1 text-xs font-medium text-slate-700">
                  Se o estudo contém
                  <input
                    className={`${CLASSE_CONTROLE} mt-1 uppercase`}
                    value={l.termos.join(' ou ')}
                    placeholder="ex.: ABDOME TOTAL ou TRIFASICO"
                    onChange={e => trocar(i, { ...l, termos: separar(e.target.value) })}
                  />
                </label>
              ) : (
                <label className="min-w-[14rem] flex-1 text-xs font-medium text-slate-700">
                  Padrão avançado
                  <input
                    className={`${CLASSE_CONTROLE} mt-1 font-mono`}
                    value={l.padrao}
                    onChange={e => trocar(i, { ...l, padrao: e.target.value })}
                  />
                </label>
              )}
              <label className="w-24 text-xs font-medium text-slate-700">
                conta
                <input
                  type="number" min={2} max={20} inputMode="numeric"
                  className={`${CLASSE_CONTROLE} mt-1 tabular-nums`}
                  value={Number.isFinite(l.quantidade) ? l.quantidade : ''}
                  onChange={e => trocar(i, { ...l, quantidade: e.target.value === '' ? NaN : Number(e.target.value) })}
                />
              </label>
              <div className="flex gap-1">
                <Botao tamanho="pequeno" variante="fantasma" icone={ArrowUp} disabled={i === 0} aria-label="Subir regra" title="Subir" onClick={() => mover(i, -1)} />
                <Botao tamanho="pequeno" variante="fantasma" icone={ArrowDown} disabled={i === linhas.length - 1} aria-label="Descer regra" title="Descer" onClick={() => mover(i, 1)} />
                <Botao tamanho="pequeno" variante="fantasma" icone={Trash2} aria-label="Remover regra" title="Remover regra" onClick={() => onChange(linhas.filter((_, j) => j !== i))} />
              </div>
            </div>
            {l.tipo === 'simples'
              ? <p className="mt-1 text-xs text-slate-600">Várias palavras: separe com " ou ". Maiúsculas e acentos não importam. Use " … " para "e depois".</p>
              : (
                <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  Regra avançada (expressão regular, em maiúsculas e sem acento). Só edite se souber o que está fazendo.
                </p>
              )}
            {erros[i]?.length > 0 && (
              <ul role="alert" className="mt-2 space-y-0.5 text-xs font-medium text-rose-700">
                {erros[i].map(e => <li key={e}>{e}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Botao tamanho="pequeno" icone={Plus} onClick={() => onChange([...linhas, { tipo: 'simples', termos: [''], quantidade: 2, chave: novaChave() }])}>
          Adicionar regra
        </Botao>
        <Botao tamanho="pequeno" variante="fantasma" onClick={() => onChange([...linhas, { tipo: 'avancada', padrao: '', quantidade: 2, chave: novaChave() }])}>
          Adicionar regra avançada
        </Botao>
      </div>
    </div>
  )
}
