import { Selo } from '../../components/ui'
import { cn } from '../../components/ui/cn'
import { ROTULO_SEVERIDADE, type Problema, type UnidadeCad } from '../../lib/diagnostico'
import { BotaoCorrigir } from './BotaoCorrigir'
import { COR_SEV, FAIXA_SEV, ICONE_SEV } from './estilo'
import { ResolverDesconhecido } from './ResolverDesconhecido'
import { nomeDaUnidade } from './filtros'

export function LinhaProblema({ p, unidade, mostrarUnidade, unidades, onMudou }: {
  p: Problema; unidade?: UnidadeCad; mostrarUnidade: boolean; unidades: UnidadeCad[]; onMudou: () => void
}) {
  return (
    <li className={cn('rounded-lg border border-slate-200 border-l-4 p-3', FAIXA_SEV[p.severidade])}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Selo cor={COR_SEV[p.severidade]} icone={ICONE_SEV[p.severidade]}>{ROTULO_SEVERIDADE[p.severidade]}</Selo>
            <span className="text-sm font-semibold text-slate-900">{p.titulo}</span>
            <span className="text-xs text-slate-600">{p.id}</span>
          </div>
          {mostrarUnidade && unidade && <p className="mt-1 text-xs font-medium text-slate-700">{nomeDaUnidade(unidade)} · {unidade.empresa === 'MEDIMAGEM' ? 'Medimagem' : 'PRN'}</p>}
          <p className="mt-1 text-sm text-slate-700">{p.detalhe}</p>
        </div>
        <div className="shrink-0">
          {p.id === 'D33' && p.alvoId
            ? <ResolverDesconhecido nome={p.alvoId} unidades={unidades} onMudou={onMudou} />
            : <BotaoCorrigir problema={p} />}
        </div>
      </div>
    </li>
  )
}
