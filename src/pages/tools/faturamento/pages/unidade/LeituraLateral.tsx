import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, FileText, HeartPulse, ListChecks, NotebookText, ReceiptText, Tag, Tags, TrendingUp, type LucideIcon } from 'lucide-react'
import type { ItemVigente, PapelItem, Pendencia, UnidadeResumo } from '../../lib/tipos'
import { alertaVigencia } from '../../lib/format'
import { alertasModelo } from '../../lib/config'
import { Cartao, type CorSecao } from '../../components/ui'
import { COR_SECAO } from '../../components/ui/cn'

const SECOES: { id: string; rotulo: string; icone: LucideIcon; cor: CorSecao }[] = [
  { id: 'contrato', rotulo: 'Contrato e vigência', icone: FileText, cor: 'sky' },
  { id: 'regras', rotulo: 'Como fatura', icone: ReceiptText, cor: 'indigo' },
  { id: 'precos', rotulo: 'Preços', icone: Tag, cor: 'emerald' },
  { id: 'aditivos', rotulo: 'Aditivos e reajustes', icone: TrendingUp, cor: 'violet' },
  { id: 'nomes', rotulo: 'Nomes da Mobilemed', icone: Tags, cor: 'cyan' },
  { id: 'pendencias', rotulo: 'Pendências', icone: ListChecks, cor: 'amber' },
  { id: 'observacoes', rotulo: 'Observações', icone: NotebookText, cor: 'slate' },
]

export function IndiceSecoes() {
  return (
    <Cartao titulo="Nesta página" icone={ClipboardList} cor="sky">
      <nav aria-label="Seções da unidade">
        <ul className="space-y-0.5">
          {SECOES.map(s => (
            <li key={s.id}>
              <a href={`#${s.id}`} onClick={e => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e78]/40 ${COR_SECAO[s.cor].indice}`}>
                <span className={`rounded-md p-1 ${COR_SECAO[s.cor].icone}`} aria-hidden="true"><s.icone className="size-3.5 shrink-0" /></span>{s.rotulo}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </Cartao>
  )
}

type Linha = { ok: boolean; texto: string }

export function SaudeCadastro({ u, pend, itens, papeis }: { u: UnidadeResumo; pend: Pendencia[]; itens: ItemVigente[]; papeis: Map<string, PapelItem> }) {
  const abertas = pend.filter(p => !p.resolvida).length
  const semValor = itens.filter(i => i.valor == null).length
  const modelo = alertasModelo(u.modelo_cobranca, itens.map(i => ({ papel: papeis.get(i.item_preco_id) ?? 'normal' })))
  const vig = alertaVigencia(u.vigencia_fim)
  const linhas: Linha[] = [
    abertas > 0 ? { ok: false, texto: `${abertas} ${abertas === 1 ? 'pendência aberta' : 'pendências abertas'}` } : { ok: true, texto: 'Nenhuma pendência aberta' },
    semValor > 0 ? { ok: false, texto: `${semValor} ${semValor === 1 ? 'item sem valor' : 'itens sem valor'} — o cálculo vai parar` } : { ok: true, texto: 'Todos os itens têm valor' },
    ...modelo.map(t => ({ ok: false, texto: t })),
    vig ? { ok: false, texto: vig.texto } : { ok: true, texto: u.vigencia_fim ? 'Vigência em dia' : 'Sem data de fim cadastrada' },
  ]
  if (!modelo.length) linhas.splice(2, 0, { ok: true, texto: 'Modelo de cobrança confere com os preços' })
  const problemas = linhas.filter(l => !l.ok).length
  return (
    <Cartao titulo="Saúde do cadastro" icone={HeartPulse} cor={problemas ? 'amber' : 'emerald'} descricao={problemas ? `${problemas} ${problemas === 1 ? 'ponto' : 'pontos'} para olhar` : 'Tudo certo por aqui'}>
      <ul className="space-y-2">
        {linhas.map((l, i) => (
          <li key={i} className={`flex items-start gap-2 rounded-md text-sm ${l.ok ? 'text-slate-700' : 'border border-amber-300 bg-amber-100 px-2 py-1.5 font-medium text-amber-900'}`}>
            {l.ok
              ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Ok" />
              : (vigIcone(l.texto) ? <CalendarClock className="mt-0.5 size-4 shrink-0" aria-label="Atenção" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-label="Atenção" />)}
            <span>{l.texto}</span>
          </li>
        ))}
      </ul>
    </Cartao>
  )
}

const vigIcone = (t: string) => t.startsWith('Vigência')
