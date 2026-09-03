/**
 * A ordem da LISTA LATERAL do dia — e só dela.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Pedido da Renata (01/09/2026): "no canto direito onde ficam os cards da
 * agenda, ter opção de mover para deixar os mais importantes para cima".
 *
 * A leitura foi que o problema é o RESULTADO (o importante aparecer em cima),
 * não o gesto (arrastar). O campo `importancia` já existe e já é escolhido em
 * todo compromisso — só não influenciava a ordem, servia apenas para pintar o
 * rótulo. Ordenar por ele resolve o pedido sem exigir ação manual nenhuma da
 * pessoa, sem coluna nova no banco e sem biblioteca de arrastar-e-soltar (o
 * projeto não tem nenhuma, e o único drag que existe — o Kanban do CRM — move
 * card ENTRE colunas, não reordena dentro de uma lista).
 *
 * POR QUE SÓ A LISTA LATERAL
 * `GradeDoMes` e `GradeDeHoras` posicionam o compromisso pelo horário (a régua
 * do dia, a célula da semana). Reordenar por importância ali não teria para
 * onde ir: o lugar do bloco na régua É o horário dele. Por isso o `porDia`,
 * compartilhado pelas grades, continua estritamente cronológico — este
 * critério é aplicado depois, derivado, e só no que a lista lateral desenha.
 *
 * O HORÁRIO CONTINUA MANDANDO DENTRO DO MESMO NÍVEL
 * Dois compromissos "urgente" no mesmo dia aparecem em ordem de horário entre
 * si. A importância agrupa; o relógio desempata. Sem isso a lista perderia a
 * noção de linha do tempo dentro de cada bloco.
 */

import type { AgendaImportancia } from '@/lib/supabase/types'
import type { ItemDaAgenda } from './tipos'

/**
 * Peso de cada nível. Maior = mais acima na lista.
 *
 * Espelha os quatro valores de `AgendaImportancia` (o `Record` garante que
 * acrescentar um nível novo lá quebre a compilação aqui, em vez de silenciosa-
 * mente cair em `undefined` e bagunçar a ordem).
 */
export const PESO_IMPORTANCIA: Record<AgendaImportancia, number> = {
  urgente: 3,
  alta: 2,
  normal: 1,
  baixa: 0,
}

/** Importância desc, horário asc como desempate. */
export function porImportanciaDepoisHorario(a: ItemDaAgenda, b: ItemDaAgenda): number {
  const diferenca = PESO_IMPORTANCIA[b.importancia] - PESO_IMPORTANCIA[a.importancia]
  if (diferenca !== 0) return diferenca
  return a.starts_at.localeCompare(b.starts_at)
}
