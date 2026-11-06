import { ArrowRight, Check, Loader2, Undo2 } from 'lucide-react'
import { Botao } from './Botao'

export interface MudancaRevisao { rotulo: string; antes: string; depois: string }
export interface RevisaoAlteracoesProps {
  mudancas: MudancaRevisao[]
  onConfirmar: () => void
  onVoltar: () => void
  salvando?: boolean
  erro?: string
}

/** Painel "Antes → Depois" exibido antes de gravar, com confirmar/voltar. */
export function RevisaoAlteracoes({ mudancas, onConfirmar, onVoltar, salvando = false, erro }: RevisaoAlteracoesProps) {
  return (
    <div className="space-y-4" aria-busy={salvando}>
      <p className="text-sm font-medium text-slate-900">
        {mudancas.length ? `Confira ${mudancas.length === 1 ? 'a alteração' : `as ${mudancas.length} alterações`} antes de salvar:` : 'Nada foi alterado.'}
      </p>
      {mudancas.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {mudancas.map((m, i) => (
            <li key={`${m.rotulo}-${i}`} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(9rem,12rem)_1fr] sm:gap-x-4">
              <span className="font-medium text-slate-800">{m.rotulo}</span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-slate-600 line-through decoration-slate-400">{m.antes}</span>
                <ArrowRight className="size-3.5 text-slate-500" aria-label="para" />
                <span className="font-semibold text-emerald-700">{m.depois}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {erro && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <Botao variante="primario" icone={salvando ? Loader2 : Check} disabled={salvando || mudancas.length === 0} onClick={onConfirmar}>
          {salvando ? 'Salvando…' : 'Confirmar e salvar'}
        </Botao>
        <Botao variante="secundario" icone={Undo2} disabled={salvando} onClick={onVoltar}>Voltar a editar</Botao>
      </div>
    </div>
  )
}
