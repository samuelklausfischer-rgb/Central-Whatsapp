import { Plus, Trash2 } from 'lucide-react'
import { Botao, CLASSE_CONTROLE } from '../../components/ui'
import { ROTULO_PAPEL } from '../../lib/config'
import { MODALIDADES, PAPEIS, validarItens, type ItemForm } from '../../lib/unidadeNova'

const VAZIO: ItemForm = { exame: '', papel: 'normal', modalidade: '', subunidade: '', codigo: '', valor: '' }

export function PassoPrecos({ itens, onChange, mostrarErros }: { itens: ItemForm[]; onChange: (l: ItemForm[]) => void; mostrarErros: boolean }) {
  const erros = validarItens(itens)
  const set = (i: number, p: Partial<ItemForm>) => onChange(itens.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">Cadastre os preços do contrato. Termos e reajustes entram depois, na tela da unidade. Valor em reais (ex.: 12,50).</p>
      {itens.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-600">Nenhum item ainda.</p>}
      <ul className="space-y-2">
        {itens.map((it, i) => (
          <li key={i} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
              <label className="text-xs font-medium text-slate-700">Exame
                <input value={it.exame} onChange={e => set(i, { exame: e.target.value })} className={`${CLASSE_CONTROLE} mt-1`} />
              </label>
              <label className="text-xs font-medium text-slate-700">Modalidade
                <select value={it.modalidade} onChange={e => set(i, { modalidade: e.target.value })} className={`${CLASSE_CONTROLE} mt-1`}>
                  <option value="">Qualquer</option>
                  {MODALIDADES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-700">Papel
                <select value={it.papel} onChange={e => set(i, { papel: e.target.value as ItemForm['papel'] })} className={`${CLASSE_CONTROLE} mt-1`}>
                  {PAPEIS.map(p => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-700">Valor (R$)
                <input inputMode="decimal" value={it.valor} onChange={e => set(i, { valor: e.target.value })} className={`${CLASSE_CONTROLE} mt-1`} />
              </label>
              <Botao variante="fantasma" tamanho="pequeno" icone={Trash2} aria-label={`Remover item ${i + 1}`} onClick={() => onChange(itens.filter((_, j) => j !== i))}>Remover</Botao>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-700">Hospital / subunidade (opcional)
                <input value={it.subunidade} onChange={e => set(i, { subunidade: e.target.value })} className={`${CLASSE_CONTROLE} mt-1`} />
              </label>
              <label className="text-xs font-medium text-slate-700">Código (opcional)
                <input value={it.codigo} onChange={e => set(i, { codigo: e.target.value })} className={`${CLASSE_CONTROLE} mt-1`} />
              </label>
            </div>
            {(mostrarErros || it.exame || it.valor) && erros[i] && <p role="alert" className="mt-1 text-xs font-medium text-rose-700">{erros[i]}</p>}
          </li>
        ))}
      </ul>
      <Botao icone={Plus} onClick={() => onChange([...itens, { ...VAZIO }])}>Adicionar item</Botao>
      {mostrarErros && itens.length === 0 && <p role="alert" className="text-xs font-medium text-rose-700">Cadastre pelo menos um item de preço.</p>}
    </div>
  )
}
