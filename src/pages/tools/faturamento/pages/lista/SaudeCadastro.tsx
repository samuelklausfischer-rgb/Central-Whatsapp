import { AlertTriangle, ArrowLeftRight, BadgeDollarSign, CalendarClock, ClipboardList, HeartPulse, type LucideIcon } from 'lucide-react'
import { Cartao, type Cor } from '../../components/ui'
import { ChipFiltro } from './ChipFiltro'
import { SAUDE, type ChaveSaude } from './filtrosLista'

const VISUAL: Record<ChaveSaude, { icone: LucideIcon; cor: Cor }> = {
  vencida_vigente: { icone: AlertTriangle, cor: 'rose' },
  vence_60: { icone: CalendarClock, cor: 'amber' },
  sem_preco: { icone: BadgeDollarSign, cor: 'rose' },
  pendencia: { icone: ClipboardList, cor: 'amber' },
  divergente: { icone: ArrowLeftRight, cor: 'amber' },
}

/** Faixa "Saúde do cadastro": chips que também filtram a lista (qualquer um dos marcados). */
export function SaudeCadastro({ contagem, selecionadas, onAlternar, carregandoPrecos }: {
  contagem: Record<ChaveSaude, number>
  selecionadas: ChaveSaude[]
  onAlternar: (k: ChaveSaude) => void
  carregandoPrecos: boolean
}) {
  const total = SAUDE.reduce((s, x) => s + contagem[x.chave], 0)
  return (
    <Cartao
      titulo="Saúde do cadastro"
      icone={HeartPulse}
      cor={total === 0 ? 'emerald' : 'amber'}
      descricao={carregandoPrecos
        ? 'Conferindo os preços… alguns números ainda podem mudar.'
        : total === 0 ? 'Nada a corrigir nesta visão. Clique num item para filtrar a lista.' : 'Clique num item para ver só essas unidades.'}
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar pela saúde do cadastro">
        {SAUDE.map(s => (
          <ChipFiltro key={s.chave} ativo={selecionadas.includes(s.chave)} onClick={() => onAlternar(s.chave)}
            icone={VISUAL[s.chave].icone} cor={contagem[s.chave] > 0 ? VISUAL[s.chave].cor : 'slate'} contagem={contagem[s.chave]} title={s.dica}>
            {s.rotulo}
          </ChipFiltro>
        ))}
      </div>
    </Cartao>
  )
}
