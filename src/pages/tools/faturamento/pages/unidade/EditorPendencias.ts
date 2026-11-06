// Lógica pura das pendências de cadastro: tipos para criar à mão, nota ao reabrir e validação.
import { ROTULO_PENDENCIA } from '../../lib/format'

/** Tipo usado nas pendências criadas à mão (as únicas que podem ser apagadas). */
export const TIPO_MANUAL = 'manual'
export const TIPOS_PENDENCIA: { valor: string; rotulo: string }[] = [
  { valor: TIPO_MANUAL, rotulo: 'Anotação manual' },
  ...Object.entries(ROTULO_PENDENCIA).map(([valor, rotulo]) => ({ valor, rotulo })),
]

/** Valida a nova pendência; devolve erro por campo. */
export function validarPendencia(tipo: string, detalhe: string): { tipo?: string; detalhe?: string } {
  const e: { tipo?: string; detalhe?: string } = {}
  if (!tipo.trim()) e.tipo = 'Escolha o tipo'
  if (!detalhe.trim()) e.detalhe = 'Descreva o que precisa ser conferido'
  return e
}

const dois = (n: number) => String(n).padStart(2, '0')

/** "Reaberta em 06/11: nota anterior" (mantém a nota antiga depois do prefixo; não repete o prefixo se já houver). */
export function notaReaberta(notaAnterior: string | null, hoje: Date = new Date()): string {
  const prefixo = `Reaberta em ${dois(hoje.getDate())}/${dois(hoje.getMonth() + 1)}:`
  const n = (notaAnterior ?? '').trim()
  return n ? `${prefixo} ${n}` : prefixo
}
