import { FileWarning } from 'lucide-react'
import { Cartao, Vazio } from '../../components/ui'
import type { InstrucaoCad } from '../../lib/diagnostico'

/** Instruções de NF sem unidade (D20). Só leitura: neste app a tabela não aceita gravação. */
export function CartaoNfOrfas({ instrucoes }: { instrucoes: InstrucaoCad[] }) {
  const orfas = instrucoes.filter(i => !i.unidade_id).sort((a, b) => a.nome_planilha.localeCompare(b.nome_planilha, 'pt-BR'))
  return (
    <Cartao titulo="Instruções de NF sem unidade" icone={FileWarning} cor="amber"
      descricao="Aparecem no relatório só quando ligadas a uma unidade. Para ligar, use o Central Whats: aqui elas são só para consulta.">
      {orfas.length === 0
        ? <Vazio icone={FileWarning} titulo="Todas as instruções de NF estão ligadas a uma unidade" />
        : (
          <>
            <p className="mb-2 text-sm text-slate-700">{orfas.length} {orfas.length === 1 ? 'instrução' : 'instruções'} sem unidade:</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {orfas.map(o => <li key={o.id} className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800">{o.nome_planilha}</li>)}
            </ul>
          </>
        )}
    </Cartao>
  )
}
