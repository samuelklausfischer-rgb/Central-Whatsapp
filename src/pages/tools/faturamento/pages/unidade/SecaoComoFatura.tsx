import { CalendarDays, CheckCircle2, Gauge, Layers, Repeat, Sun, X, ReceiptText, type LucideIcon } from 'lucide-react'
import type { RegrasUnidade, UnidadeResumo } from '../../lib/tipos'
import { etiquetasRegras } from '../../lib/config'
import { linhasComoFatura } from '../../components/ComoFatura'
import { Cartao, Etiqueta } from '../../components/ui'

const ICONE: Record<string, LucideIcon> = {
  'Modelo': Layers,
  'Data que define o mês': CalendarDays,
  'Status aceitos': CheckCircle2,
  'Janela': Repeat,
  'Franquia': Gauge,
  'Contam mais de 1': X,
  'Fim de semana': Sun,
}

/** Resumo em frases curtas (uma por regra) — fica na coluna lateral. */
export function SecaoComoFatura({ u, regras, statusPorExame }: { u: UnidadeResumo; regras: RegrasUnidade; statusPorExame: string[] }) {
  const linhas = linhasComoFatura(u.modelo_cobranca, regras, statusPorExame)
  const etiquetas = etiquetasRegras(regras)
  return (
    <Cartao titulo="Como esta unidade fatura" icone={ReceiptText} cor="indigo" descricao="Resumo do que o cálculo usa hoje." tingido>
      <ul className="space-y-3">
        {linhas.map(l => {
          const Icone = ICONE[l.rotulo] ?? Layers
          return (
            <li key={l.rotulo} className="flex items-start gap-2.5 text-sm">
              <Icone className="mt-0.5 size-4 shrink-0 text-indigo-600" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-indigo-800">{l.rotulo}</p>
                <p className="break-words text-slate-900">{l.texto}</p>
              </div>
            </li>
          )
        })}
      </ul>
      {etiquetas.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          {etiquetas.map(e => <Etiqueta key={e}>{e}</Etiqueta>)}
        </div>
      )}
    </Cartao>
  )
}
