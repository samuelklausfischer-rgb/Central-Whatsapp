/**
 * As cores da Agenda — fonte única.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * As classes viviam escritas à mão em onze lugares da tela, todas com
 * `text-<cor>-300`. Esse tom é feito para fundo escuro: no tema claro dava
 * texto claro sobre fundo claro, e o rótulo simplesmente sumia. Medido:
 *
 *      Baixa 1,23:1 · Alta 1,28:1 · Outlook 1,44:1
 *      Normal 1,52:1 · Se repete 1,54:1 · Urgente 1,56:1
 *
 * O mínimo legível (WCAG AA) é 4,5:1. Os seis falhavam.
 *
 * NÃO BASTA COPIAR O PADRÃO DO PROJETO
 * `MeusHubReports.tsx:21` usa `text-<cor>-600 dark:text-<cor>-400`, que é o
 * caminho certo — mas `-600` só passa em duas das seis cores aqui:
 *
 *      slate  6,29 ✅     violet 4,75 ✅
 *      blue   4,35 ❌ →  -700 (5,64)
 *      red    3,97 ❌ →  -700 (5,32)
 *      sky    3,53 ❌ →  -700 (5,12)
 *      amber  2,84 ❌ →  -800 (6,31)   ← o amarelo é o pior caso
 *
 * E O FUNDO NÃO É BRANCO
 * `.superficie-vidro` tem `--vidro-opacidade: 0.72`, ou seja, 28% da imagem de
 * fundo atravessa — e o app usa uma foto. O contraste real muda conforme a
 * região da imagem. Por isso a escolha é sempre o tom com FOLGA, nunca o que
 * passa raspando: 4,6:1 sobre branco teórico pode cair abaixo de 4,5 sobre uma
 * parte mais clara da foto.
 *
 * No tema escuro os `-300` medem de 9 a 12:1 — ficam como estão, no `dark:`.
 *
 * AO ACRESCENTAR COR NOVA: medir. Não deduzir pelo nome do tom.
 */

import type { AgendaImportancia } from '@/lib/supabase/types'

/** Rótulo de importância, nos dois temas. */
export const CORES_IMPORTANCIA: Record<AgendaImportancia, string> = {
  baixa: 'bg-slate-500/15 border-slate-500/30 text-slate-600 dark:text-slate-300',
  normal: 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300',
  alta: 'bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-300',
  urgente: 'bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300',
}

/** Compromisso vindo do Outlook. */
export const COR_OUTLOOK = 'bg-sky-500/15 border-sky-500/30 text-sky-700 dark:text-sky-300'

/**
 * Variante mais forte, para o bloco dentro da grade de horas: ali o retângulo
 * é pequeno e disputa espaço com as linhas da régua, então precisa de mais
 * presença que o rótulo da lista.
 */
export const COR_OUTLOOK_BLOCO =
  'bg-sky-500/25 border-sky-500/40 text-sky-800 dark:bg-sky-500/20 dark:text-sky-100'

/** Marca de compromisso que se repete. */
export const COR_REPETE = 'bg-violet-500/10 border-violet-500/30 text-violet-600 dark:text-violet-300'

/** Aviso de repetição dentro do diálogo. */
export const COR_AVISO_REPETE =
  'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200'

/** Falha do Outlook — a agenda daqui continua servindo, então é aviso, não erro. */
export const COR_AVISO = 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'

/** Erro que impede a tela de funcionar. */
export const COR_ERRO = 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'

/** Ação destrutiva em texto (Excluir). Sem fundo — vai direto sobre o vidro. */
export const COR_ACAO_EXCLUIR = 'text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300'

/** Ícone do Outlook na barra de conexão. */
export const COR_ICONE_OUTLOOK = 'text-sky-700 dark:text-sky-400'

/** A cor do bloco na grade e do rótulo na célula do mês, conforme a origem. */
export function corDoItem(origem: 'interna' | 'outlook', importancia: AgendaImportancia): string {
  return origem === 'outlook' ? COR_OUTLOOK : CORES_IMPORTANCIA[importancia]
}

export function corDoBloco(origem: 'interna' | 'outlook', importancia: AgendaImportancia): string {
  return origem === 'outlook' ? COR_OUTLOOK_BLOCO : CORES_IMPORTANCIA[importancia]
}
