import { CalendarDays, FilterX, Search, SlidersHorizontal } from 'lucide-react'
import { CLASSE_CONTROLE, Segmentado } from '../../components/ui'
import { SITUACAO } from '../../lib/format'
import { ChipFiltro } from './ChipFiltro'
import { REGRAS_ESPECIAIS, type Agrupar, type ChaveRegra, type Contagens, type Filtros } from './filtrosLista'

export function BarraFiltros({ filtros, contagem, totalGeral, agrupar, dataRef, filtroAtivo, onBusca, onEmpresa, onSituacao, onRegra, onAgrupar, onData, onLimpar }: {
  filtros: Filtros
  contagem: Contagens
  totalGeral: number
  agrupar: Agrupar
  dataRef: string
  filtroAtivo: boolean
  onBusca: (v: string) => void
  onEmpresa: (v: string) => void
  onSituacao: (v: string) => void
  onRegra: (k: ChaveRegra) => void
  onAgrupar: (v: Agrupar) => void
  onData: (v: string) => void
  onLimpar: () => void
}) {
  const nEmpresa = (k: string) => contagem.empresa[k] ?? 0
  const todas = nEmpresa('PRN') + nEmpresa('MEDIMAGEM')
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="block min-w-[16rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-700">Buscar</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input type="search" className={`${CLASSE_CONTROLE} pl-9`} placeholder="Grupo, unidade, órgão ou nome do Bruto…"
              value={filtros.busca} onChange={e => onBusca(e.target.value)} />
          </span>
        </label>
        <div className="w-full sm:w-80">
          <span className="mb-1 block text-xs font-medium text-slate-700">Empresa</span>
          <Segmentado nome="empresa" rotulo="Empresa" valor={filtros.empresa} onChange={onEmpresa} opcoes={[
            { valor: '', rotulo: `Todas (${todas})` },
            { valor: 'PRN', rotulo: `PRN (${nEmpresa('PRN')})` },
            { valor: 'MEDIMAGEM', rotulo: `Medimagem (${nEmpresa('MEDIMAGEM')})` },
          ]} />
        </div>
        <label className="block w-full sm:w-52">
          <span className="mb-1 block text-xs font-medium text-slate-700">Situação</span>
          <select className={CLASSE_CONTROLE} value={filtros.situacao} onChange={e => onSituacao(e.target.value)}>
            <option value="">Qualquer situação</option>
            {Object.entries(SITUACAO).map(([k, v]) => <option key={k} value={k}>{v.rotulo} ({contagem.situacao[k] ?? 0})</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Regras especiais">
        <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700"><SlidersHorizontal className="size-3.5" aria-hidden="true" />Regras especiais</span>
        {REGRAS_ESPECIAIS.map(r => (
          <ChipFiltro key={r.chave} cor="indigo" ativo={filtros.regras.includes(r.chave)} onClick={() => onRegra(r.chave)} contagem={contagem.regras[r.chave]}>{r.rotulo}</ChipFiltro>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-slate-100 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-700">Agrupar por</span>
          <div className="w-60">
            <Segmentado nome="agrupar" rotulo="Agrupar por" valor={agrupar} onChange={v => onAgrupar(v as Agrupar)} opcoes={[
              { valor: 'nenhum', rotulo: 'Nenhum' }, { valor: 'contrato', rotulo: 'Contrato' }, { valor: 'empresa', rotulo: 'Empresa' },
            ]} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600" title="Mostra os preços como estavam nesse dia (por exemplo, antes de um reajuste)">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          <span>Valores vigentes em</span>
          <input type="date" className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40"
            value={dataRef} onChange={e => e.target.value && onData(e.target.value)} />
        </label>
        <span className="hidden text-xs text-slate-600 lg:inline">Mostra os preços como estavam nesse dia (por exemplo, antes de um reajuste).</span>
        {filtroAtivo && (
          <button type="button" onClick={onLimpar}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-[#1f4e78] hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40">
            <FilterX className="size-4" aria-hidden="true" />Limpar filtros
          </button>
        )}
        <span className="sr-only">{totalGeral} unidades no cadastro</span>
      </div>
    </div>
  )
}
