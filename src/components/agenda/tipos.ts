import type { AgendaEscopo, AgendaImportancia } from '@/lib/supabase/types'

/**
 * A forma comum de um compromisso na tela.
 *
 * Ele pode vir de dois lugares — do nosso banco ou do Outlook da pessoa — e as
 * grades não precisam saber a diferença. Só o rótulo de origem muda.
 */
export interface ItemDaAgenda {
  id: string
  titulo: string
  descricao: string | null
  starts_at: string
  ends_at: string
  dia_inteiro: boolean
  importancia: AgendaImportancia
  link: string | null
  email: string | null
  origem: 'interna' | 'outlook'
  escopo: AgendaEscopo | null
  setor: string | null
  /**
   * ESPELHAM as policies, não as reinventam — e as duas são DIFERENTES:
   *   editar  (`agenda_events_mexer`)  → criador, DESIGNADO ou admin
   *   excluir (`agenda_events_apagar`) → criador ou admin
   * Quem decide de verdade é o banco; isto só escolhe o que mostrar. Se
   * divergirem, o botão aparece e a gravação é recusada — nunca o contrário.
   */
  podeEditar: boolean
  podeExcluir: boolean
  /** Ocorrência de um compromisso que se repete: mexer vale só para este dia. */
  seRepete: boolean
  /** O `group_id`, para o diálogo de edição voltar no grupo certo. */
  groupId: string | null
  /** Cor de destaque escolhida na criação. Nula = visual padrão. Outlook não tem. */
  cor: string | null
}

export interface Rascunho {
  titulo: string
  descricao: string
  inicio: string
  fim: string
  diaInteiro: boolean
  importancia: AgendaImportancia
  link: string
  email: string
  escopo: AgendaEscopo
  groupId: string
  /** Salvar no Outlook em vez de na nossa agenda. Só para escopo pessoal. */
  noOutlook: boolean
  /** Cor de destaque escolhida no seletor do diálogo. Nula = "sem cor". */
  cor: string | null
}

export type Visao = 'mes' | 'semana' | 'dia'

/**
 * Faixa de horas desenhada nas visões de semana e dia.
 *
 * Começa às 6h e não à 0h: madrugada vazia empurraria o expediente para fora da
 * tela, e a rolagem inicial cairia sempre no lugar errado. Compromisso fora da
 * faixa não some — é grampeado na borda (ver `posicaoNaFaixa`).
 */
export const HORA_INICIAL = 6
export const HORA_FINAL = 22
export const ALTURA_DA_HORA = 48

/**
 * Onde o compromisso entra na coluna de horas, em pixels, já grampeado à faixa
 * visível. O piso de 18px garante que um compromisso de 5 minutos ainda tenha
 * altura para o título aparecer.
 */
export function posicaoNaFaixa(inicio: Date, fim: Date) {
  const emHoras = (d: Date) => d.getHours() + d.getMinutes() / 60
  const de = Math.max(emHoras(inicio), HORA_INICIAL)
  const ate = Math.min(emHoras(fim), HORA_FINAL + 1)
  return {
    top: (de - HORA_INICIAL) * ALTURA_DA_HORA,
    height: Math.max((ate - de) * ALTURA_DA_HORA, 18),
  }
}

export const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** `datetime-local` quer 'YYYY-MM-DDTHH:mm' no horário LOCAL, sem fuso. */
export function paraCampoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
