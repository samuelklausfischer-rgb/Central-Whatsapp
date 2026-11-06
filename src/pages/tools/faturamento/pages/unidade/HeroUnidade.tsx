import type { ReactNode } from 'react'
import { Link } from '../../navegacao'
import { ArrowLeft, CalendarClock, ClipboardList, Receipt, Wallet, type LucideIcon } from 'lucide-react'
import type { ItemVigente, PapelItem, Pendencia, PrecoVigente, UnidadeResumo } from '../../lib/tipos'
import { MODELO, SITUACAO, alertaVigencia, dataBR, nomeExibicao, plural } from '../../lib/format'
import { resumoPreco } from '../../lib/config'
import { BotaoSharePoint } from '../../components/ui'
import { cn } from '../../components/ui/cn'

type Tom = 'indigo' | 'emerald' | 'rose' | 'amber' | 'slate'
const TOM: Record<Tom, { caixa: string; icone: string; valor: string }> = {
  indigo: { caixa: 'bg-white border-indigo-200', icone: 'bg-indigo-100 text-indigo-700', valor: 'text-indigo-900' },
  emerald: { caixa: 'bg-white border-emerald-200', icone: 'bg-emerald-100 text-emerald-700', valor: 'text-emerald-700' },
  rose: { caixa: 'bg-rose-50 border-rose-300', icone: 'bg-rose-100 text-rose-700', valor: 'text-rose-800' },
  amber: { caixa: 'bg-amber-50 border-amber-300', icone: 'bg-amber-100 text-amber-800', valor: 'text-amber-900' },
  slate: { caixa: 'bg-white border-slate-200', icone: 'bg-slate-100 text-slate-700', valor: 'text-slate-900' },
}

function Indicador({ rotulo, icone: Icone, tom, children, sub }: { rotulo: string; icone: LucideIcon; tom: Tom; children: ReactNode; sub?: string }) {
  const t = TOM[tom]
  return (
    <div className={cn('flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 shadow-sm', t.caixa)}>
      <span className={cn('rounded-lg p-2', t.icone)} aria-hidden="true"><Icone className="size-5" /></span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{rotulo}</p>
        <p className={cn('break-words text-sm font-bold leading-snug', t.valor)}>{children}</p>
        {sub && <p className="text-xs text-slate-600">{sub}</p>}
      </div>
    </div>
  )
}

const SELO_HERO = 'inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/40'

/** Topo da unidade: faixa com a cor da marca, nome, selos, SharePoint em destaque e 4 indicadores. */
export function HeroUnidade({ u, itens, papeis, pend }: { u: UnidadeResumo; itens: ItemVigente[]; papeis: Map<string, PapelItem>; pend: Pendencia[] }) {
  const vig = alertaVigencia(u.vigencia_fim)
  const abertas = pend.filter(p => !p.resolvida).length
  const precos: PrecoVigente[] = itens.map(i => ({ ...i, unidade_id: u.id, papel: papeis.get(i.item_preco_id) ?? 'normal' }))
  const vigTexto = vig
    ? (vig.tipo === 'vencida' ? `Vencida há ${plural(vig.dias, 'dia', 'dias')}` : vig.dias === 0 ? 'Vence hoje' : `Faltam ${plural(vig.dias, 'dia', 'dias')}`)
    : u.vigencia_fim ? 'Em dia' : 'Sem data de fim'
  return (
    <header className="space-y-4 rounded-2xl bg-gradient-to-r from-[#1f4e78] via-[#22608d] to-sky-700 p-5 text-white shadow-md sm:p-6">
      <Link to="/faturamento" className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-100 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
        <ArrowLeft className="size-4" aria-hidden="true" />Unidades
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2.5">
          <h1 className="break-words text-2xl font-bold sm:text-3xl">{nomeExibicao(u.pasta)}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className={SELO_HERO}>{u.empresa}</span>
            <span className={SELO_HERO}>{SITUACAO[u.situacao]?.rotulo ?? u.situacao}</span>
            {vig && <span title={vig.texto} className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold', vig.tipo === 'vencida' ? 'bg-rose-100 text-rose-900' : 'bg-amber-200 text-amber-950')}>{vigTexto}</span>}
            {u.situacao_manual && <span className="text-xs text-sky-100">situação definida à mão</span>}
          </div>
        </div>
        <BotaoSharePoint url={u.sharepoint_url} tamanho="grande" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Cobra" icone={Receipt} tom="indigo">{MODELO[u.modelo_cobranca] ?? u.modelo_cobranca}</Indicador>
        <Indicador rotulo="Preço hoje" icone={Wallet} tom="emerald">{resumoPreco(u, precos)}</Indicador>
        <Indicador rotulo="Vigência" icone={CalendarClock} tom={vig ? (vig.tipo === 'vencida' ? 'rose' : 'amber') : u.vigencia_fim ? 'emerald' : 'slate'}
          sub={u.vigencia_fim ? `até ${dataBR(u.vigencia_fim)}` : undefined}>{vigTexto}</Indicador>
        <Indicador rotulo="Pendências" icone={ClipboardList} tom={abertas > 0 ? 'amber' : 'emerald'}>{abertas > 0 ? `${abertas} em aberto` : 'Nenhuma'}</Indicador>
      </div>
    </header>
  )
}
