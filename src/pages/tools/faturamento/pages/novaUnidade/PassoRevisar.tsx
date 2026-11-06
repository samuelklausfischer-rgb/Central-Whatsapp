import { Loader2 } from 'lucide-react'
import { Botao } from '../../components/ui'
import { MODELO, brl, vigenciaTexto } from '../../lib/format'
import { rotuloJanela } from '../../lib/config'
import { lerValor, type AliasForm, type FormNova, type ItemForm } from '../../lib/unidadeNova'

interface Props { form: FormNova; itens: ItemForm[]; nomes: AliasForm[]; problemas: string[]; criando: boolean; erro: string | null; onCriar: () => void }

export function PassoRevisar({ form, itens, nomes, problemas, criando, erro, onCriar }: Props) {
  const linhas: [string, string][] = [
    ['Empresa / pasta', `${form.empresa} / ${form.pasta.trim() || '—'}`],
    ['Órgão e contrato', [form.orgao, form.numero_contrato].filter(Boolean).join(' · ') || 'Não informado'],
    ['Vigência', vigenciaTexto(form.vigencia_inicio || null, form.vigencia_fim || null)],
    ['Modelo', MODELO[form.modelo_cobranca] ?? form.modelo_cobranca],
    ['Período', rotuloJanela(form.janela)],
    ['Data que vale', form.criterio_data === 'laudo' ? 'Data do laudo' : form.criterio_data === 'exame' ? 'Data do exame' : 'Automático'],
    ['Status dos exames', form.todos_status ? 'Qualquer status' : 'Só os status padrão'],
  ]
  return (
    <div className="space-y-5">
      <dl className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
        {linhas.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[12rem_1fr]"><dt className="font-medium text-slate-800">{k}</dt><dd className="text-slate-700">{v}</dd></div>
        ))}
      </dl>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Preços ({itens.length})</h3>
        <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
          {itens.map((it, i) => {
            const v = lerValor(it.valor)
            return <li key={i}>{it.exame || '—'}{it.modalidade ? ` (${it.modalidade})` : ''}: {typeof v === 'number' ? brl(v) : <span className="text-amber-700">sem valor</span>}</li>
          })}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Nomes da Mobilemed ({nomes.length})</h3>
        <ul className="mt-1 space-y-0.5 font-mono text-xs text-slate-700">{nomes.map((n, i) => <li key={i}>{n.nome_bruto || '—'}{n.principal ? ' ★' : ''}</li>)}</ul>
      </div>
      {problemas.length > 0 && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <p className="font-semibold">Falta corrigir antes de criar:</p>
          <ul className="list-disc pl-5">{problemas.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}
      {erro && <p role="alert" className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm text-rose-800">{erro}</p>}
      <Botao variante="primario" disabled={problemas.length > 0 || criando} icone={criando ? Loader2 : undefined} onClick={onCriar}>{criando ? 'Criando…' : 'Criar unidade'}</Botao>
    </div>
  )
}
