import { Plus, Trash2 } from 'lucide-react'
import { Botao, CLASSE_CONTROLE } from '../../components/ui'
import { GRUPOS_NOME, validarNomes, type AliasForm } from '../../lib/unidadeNova'
import type { Referencias } from './useReferencias'

export function PassoNomes({ nomes, onChange, mostrarErros, refs }: { nomes: AliasForm[]; onChange: (l: AliasForm[]) => void; mostrarErros: boolean; refs: Referencias }) {
  const erros = validarNomes(nomes, refs.nomes, refs.ignorados)
  const set = (i: number, p: Partial<AliasForm>) => onChange(nomes.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">Escreva o nome exatamente como aparece no arquivo Bruto da Mobilemed. Cada nome só pode pertencer a uma unidade.</p>
      <ul className="space-y-2">
        {nomes.map((n, i) => (
          <li key={i} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="grid gap-2 sm:grid-cols-[2fr_1.4fr_auto_auto] sm:items-end">
              <label className="text-xs font-medium text-slate-700">Nome na Mobilemed
                <input value={n.nome_bruto} onChange={e => set(i, { nome_bruto: e.target.value.toUpperCase() })} className={`${CLASSE_CONTROLE} mt-1 font-mono`} />
              </label>
              <label className="text-xs font-medium text-slate-700">Grupo
                <select value={n.grupo} onChange={e => set(i, { grupo: e.target.value })} className={`${CLASSE_CONTROLE} mt-1`}>
                  <option value="">Automático</option>
                  {GRUPOS_NOME.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5 pb-2 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={n.principal} onChange={e => set(i, { principal: e.target.checked })} className="size-4" />Principal (recebe o fixo)
              </label>
              <Botao variante="fantasma" tamanho="pequeno" icone={Trash2} aria-label={`Remover nome ${i + 1}`} onClick={() => onChange(nomes.filter((_, j) => j !== i))}>Remover</Botao>
            </div>
            {(mostrarErros || n.nome_bruto) && erros[i] && <p role="alert" className="mt-1 text-xs font-medium text-rose-700">{erros[i]}</p>}
          </li>
        ))}
      </ul>
      <Botao icone={Plus} onClick={() => onChange([...nomes, { nome_bruto: '', grupo: '', principal: nomes.length === 0, subunidade: '' }])}>Adicionar nome</Botao>
      {mostrarErros && nomes.length === 0 && <p role="alert" className="text-xs font-medium text-rose-700">Cadastre pelo menos um nome da Mobilemed.</p>}
    </div>
  )
}
