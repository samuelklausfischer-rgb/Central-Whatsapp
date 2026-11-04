/**
 * Período do "Buscar mensagens" (Conexão WhatsApp).
 *
 * Tudo no horário LOCAL do computador de quem usa — a equipe está no Brasil e
 * "hoje" para ela é de 00:00 até agora no relógio dela, não em UTC.
 *
 * Regras:
 * - o início é sempre 00:00:00.000 do primeiro dia;
 * - o fim é 23:59:59.999 do último dia, MAS se o último dia é hoje, o fim é
 *   "agora" (não faz sentido pedir mensagens do futuro);
 * - o servidor corta de novo em "agora" (`periodoDoCorpo` na edge function).
 */

export type PresetPeriodo = 'hoje' | 'ontem' | '7dias' | 'personalizado'

export interface PeriodoBusca {
  /** ISO, inclusivo. */
  from: string
  /** ISO, inclusivo. */
  to: string
}

const DIA_MS = 24 * 60 * 60 * 1000

function inicioDoDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function fimDoDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** `YYYY-MM-DD` (valor do `<input type="date">`) no horário local. */
export function dataLocal(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor || '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3]) ? null : d
}

/** `Date` -> `YYYY-MM-DD` no horário local (para preencher o `<input type="date">`). */
export function paraInputData(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Monta o período. `agora` é parâmetro para o teste poder fixar o relógio; na
 * tela, chame sem ele, no MOMENTO do clique — "hoje" calculado ao abrir a janela
 * ficaria parado no horário em que ela abriu.
 *
 * Devolve `{ erro }` com frase pronta para a tela quando o pedido não fecha.
 */
export function montarPeriodo(
  preset: PresetPeriodo,
  personalizado: { de: string; ate: string },
  agora: Date = new Date(),
): PeriodoBusca | { erro: string } {
  if (preset === 'hoje') {
    return { from: inicioDoDia(agora).toISOString(), to: agora.toISOString() }
  }
  if (preset === 'ontem') {
    const ontem = new Date(inicioDoDia(agora).getTime() - DIA_MS / 2)
    return { from: inicioDoDia(ontem).toISOString(), to: fimDoDia(ontem).toISOString() }
  }
  if (preset === '7dias') {
    // Hoje + 6 dias para trás = 7 dias de calendário.
    const inicio = inicioDoDia(agora)
    inicio.setDate(inicio.getDate() - 6)
    return { from: inicio.toISOString(), to: agora.toISOString() }
  }

  const de = dataLocal(personalizado.de)
  const ate = dataLocal(personalizado.ate)
  if (!de) return { erro: 'Escolha a data inicial.' }
  if (!ate) return { erro: 'Escolha a data final.' }
  if (inicioDoDia(de).getTime() > agora.getTime()) return { erro: 'A data inicial não pode ser no futuro.' }
  if (de.getTime() > ate.getTime()) return { erro: 'A data inicial precisa ser antes da final.' }

  const fim = mesmoDia(ate, agora) || ate.getTime() > agora.getTime() ? agora : fimDoDia(ate)
  return { from: inicioDoDia(de).toISOString(), to: fim.toISOString() }
}

/** "04/11/2026 00:00:00" — como o período aparece na tela. */
export function formatarMomento(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
