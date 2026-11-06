import { nomeExibicao } from '../../lib/format'
import { Link } from '../../navegacao'
import { AlertTriangle, ArrowLeftRight, BadgeDollarSign, CalendarClock, ChevronDown, ChevronRight, ClipboardList, ExternalLink, type LucideIcon } from 'lucide-react'
import { BotaoSharePoint, Etiqueta, Selo, type Cor } from '../../components/ui'
import { cn } from '../../components/ui/cn'
import { SeloVigencia } from '../../components/SeloVigencia'
import { ComoFaturaLista } from '../../components/ComoFatura'
import type { Alias, PrecoVigente, RegrasUnidade, UnidadeResumo } from '../../lib/tipos'
import { SITUACAO, alertaVigencia, brl, dataBR, plural, vigenciaTexto } from '../../lib/format'
import { BLOCOS_PRECO, alertasModelo, nomeQueRecebeFixo, resumoPreco } from '../../lib/config'
import { etiquetasExtras, fraseCobranca, type ChaveSaude } from './filtrosLista'

export type AliasLinha = Pick<Alias, 'nome_bruto' | 'unidade_id' | 'subunidade' | 'principal' | 'grupo'>

/** Colunas da grade no desktop (o cabeçalho da lista usa a mesma). */
export const GRADE = 'lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,2.2fr)_minmax(0,1.6fr)_10rem_6.5rem] lg:items-center lg:gap-x-4'

const COR_SITUACAO: Record<string, Cor> = {
  vigente: 'emerald', vencido: 'rose', encerrado: 'slate', minuta: 'amber', nao_iniciado: 'sky', sem_data: 'slate',
}
const FILETE: Record<string, string> = {
  vigente: 'border-l-emerald-500', vencido: 'border-l-rose-500', sem_data: 'border-l-slate-300',
  nao_iniciado: 'border-l-sky-500', minuta: 'border-l-violet-500', encerrado: 'border-l-slate-700',
}
const ALERTA: Record<ChaveSaude, { icone: LucideIcon; cor: string }> = {
  vencida_vigente: { icone: AlertTriangle, cor: 'bg-rose-50 text-rose-700 ring-rose-200' },
  vence_60: { icone: CalendarClock, cor: 'bg-amber-50 text-amber-700 ring-amber-200' },
  sem_preco: { icone: BadgeDollarSign, cor: 'bg-rose-50 text-rose-700 ring-rose-200' },
  pendencia: { icone: ClipboardList, cor: 'bg-amber-50 text-amber-700 ring-amber-200' },
  divergente: { icone: ArrowLeftRight, cor: 'bg-amber-50 text-amber-700 ring-amber-200' },
}

function textoAlerta(k: ChaveSaude, u: UnidadeResumo, itens: PrecoVigente[]): string {
  switch (k) {
    case 'vencida_vigente': return `Marcada como vigente, mas a vigência já terminou. ${alertaVigencia(u.vigencia_fim)?.texto ?? ''}`.trim()
    case 'vence_60': return alertaVigencia(u.vigencia_fim)?.texto ?? 'Vigência perto do fim'
    case 'sem_preco': return u.n_itens > 0 ? 'Nenhum valor vigente na data escolhida — o cálculo vai parar' : 'Sem preço cadastrado — o cálculo vai parar'
    case 'pendencia': return `${plural(u.n_pendencias, 'pendência aberta', 'pendências abertas')}`
    case 'divergente': return alertasModelo(u.modelo_cobranca, itens).join('; ')
  }
}

export function LinhaUnidade({ u, regras, itens, nomes, saude, statusPorExame, aberta, dataRef, onAlternar }: {
  u: UnidadeResumo; regras: RegrasUnidade | undefined; itens: PrecoVigente[]; nomes: AliasLinha[]; saude: ChaveSaude[]
  statusPorExame: string[]; aberta: boolean; dataRef: string; onAlternar: () => void
}) {
  const extras = etiquetasExtras(regras)
  const empresa = u.empresa === 'MEDIMAGEM' ? 'Medimagem' : 'PRN'
  const sit = SITUACAO[u.situacao]
  const idPrevia = `previa-${u.id}`
  const textoPreco = resumoPreco(u, itens)
  const fixo = itens.some(i => i.papel === 'fixo') ? nomeQueRecebeFixo(nomes) : null
  return (
    <li className={cn('border-l-4', FILETE[u.situacao] ?? 'border-l-slate-300', aberta && 'bg-sky-50/60')}>
      <div className="flex items-stretch">
        <Link to={`/faturamento/unidade/${u.id}`}
          className={cn('block min-w-0 flex-1 space-y-1.5 px-4 py-3 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1f4e78]/50', GRADE)}>
          <span className="block min-w-0">
            <span className="block truncate font-semibold text-[#1f4e78]" title={u.pasta}>{nomeExibicao(u.pasta)}</span>
            <span className="block truncate text-xs text-slate-600">{empresa}{u.orgao ? ` · ${u.orgao}` : ''}</span>
          </span>
          <span className="block min-w-0">
            <span className="block text-slate-800">{fraseCobranca(u.modelo_cobranca, regras)}</span>
            {extras.length > 0 && (
              <span className="mt-1 flex flex-wrap gap-1">{extras.map(e => <Etiqueta key={e}>{e}</Etiqueta>)}</span>
            )}
          </span>
          <span className={cn('block font-semibold tabular-nums', textoPreco.startsWith('sem preço') ? 'text-rose-700' : 'text-emerald-700')}>{textoPreco}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Selo cor={COR_SITUACAO[u.situacao] ?? 'slate'}>{sit?.rotulo ?? u.situacao}</Selo>
            {alertaVigencia(u.vigencia_fim)
              ? <SeloVigencia fim={u.vigencia_fim} curto />
              : <span className="text-xs text-slate-600">{u.vigencia_fim ? `até ${dataBR(u.vigencia_fim)}` : 'sem data'}</span>}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {saude.length === 0 && <span className="text-xs text-slate-500 lg:sr-only">Sem alertas</span>}
            {saude.map(k => {
              const { icone: Icone, cor } = ALERTA[k]
              const t = textoAlerta(k, u, itens)
              return (
                <span key={k} title={t} aria-label={t} role="img" className={cn('inline-flex size-6 items-center justify-center rounded-full ring-1 ring-inset', cor)}>
                  <Icone className="size-3.5" aria-hidden="true" />
                </span>
              )
            })}
          </span>
        </Link>
        <button type="button" aria-expanded={aberta} aria-controls={idPrevia} onClick={onAlternar}
          aria-label={`${aberta ? 'Recolher' : 'Ver prévia de'} ${u.pasta}`} title={aberta ? 'Recolher prévia' : 'Ver prévia'}
          className="flex w-11 shrink-0 items-center justify-center border-l border-slate-100 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1f4e78]/50">
          {aberta ? <ChevronDown className="size-5" aria-hidden="true" /> : <ChevronRight className="size-5" aria-hidden="true" />}
        </button>
      </div>
      {aberta && <Previa id={idPrevia} u={u} regras={regras} itens={itens} nomes={nomes} fixo={fixo} statusPorExame={statusPorExame} dataRef={dataRef} />}
    </li>
  )
}

function Previa({ id, u, regras, itens, nomes, fixo, statusPorExame, dataRef }: {
  id: string; u: UnidadeResumo; regras: RegrasUnidade | undefined; itens: PrecoVigente[]; nomes: AliasLinha[]
  fixo: ReturnType<typeof nomeQueRecebeFixo>; statusPorExame: string[]; dataRef: string
}) {
  return (
    <div id={id} className="space-y-4 border-t border-slate-100 px-4 py-4 text-sm lg:pl-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link to={`/faturamento/unidade/${u.id}`}
          className="inline-flex items-center gap-1.5 font-medium text-[#1f4e78] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40">
          <ExternalLink className="size-4" aria-hidden="true" />Abrir unidade
        </Link>
        <span className="text-xs text-slate-600">Vigência: {vigenciaTexto(u.vigencia_inicio, u.vigencia_fim)}</span>
        {u.sharepoint_url && <BotaoSharePoint url={u.sharepoint_url} tamanho="link" />}
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Preços em {dataBR(dataRef)}</h3>
          {itens.length ? (
            <div className="space-y-2">
              {BLOCOS_PRECO.map(b => {
                const linhas = itens.filter(i => i.papel === b.papel)
                if (!linhas.length) return null
                return (
                  <div key={b.papel}>
                    <p className="text-xs font-medium text-slate-700">{b.titulo}</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {linhas.map(i => (
                        <li key={i.item_preco_id} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-slate-700" title={i.exame}>{i.exame}{i.modalidade ? ` · ${i.modalidade}` : ''}</span>
                          <span className="shrink-0 font-bold tabular-nums text-emerald-700">{brl(i.valor)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="italic text-slate-600">{u.n_itens > 0 ? `Nenhum valor vigente em ${dataBR(dataRef)}.` : 'Sem itens de preço cadastrados.'}</p>
          )}
        </div>
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Como fatura</h3>
          <ComoFaturaLista modelo={u.modelo_cobranca} regras={regras} statusPorExame={statusPorExame} />
        </div>
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Nomes na Mobilemed</h3>
          {fixo && (
            <p className="mb-1 text-xs text-slate-700">Recebe o fixo: <b>{fixo.todos.join(', ')}</b>
              {fixo.automatico && <span className="text-slate-600"> (escolhido automaticamente)</span>}</p>
          )}
          {nomes.length ? (
            <ul className="space-y-0.5">
              {nomes.map(a => (
                <li key={a.nome_bruto} className="text-slate-700">{a.nome_bruto}
                  {a.subunidade && <span className="text-slate-600"> · {a.subunidade}</span>}
                  {a.principal && <span className="ml-1 rounded bg-emerald-600 px-1 text-[11px] font-semibold text-white">principal</span>}
                </li>
              ))}
            </ul>
          ) : <p className="italic text-slate-600">Nenhum nome cadastrado.</p>}
        </div>
      </div>
    </div>
  )
}
