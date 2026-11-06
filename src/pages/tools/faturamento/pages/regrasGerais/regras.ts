// Regras gerais (tabela config): textos em português, validação e listas de pastas. Lógica pura.
import { normNome } from '../../nucleo/motor'

export interface InfoChave {
  chave: string
  titulo: string
  explicacao: string
  lidoPor: string
  padrao: string
  tipo: 'lista' | 'simnao' | 'pastas'
}

/** Chaves que valem para todas as unidades. `padrao` é o que o motor usa quando a chave não existe (servico.ts, lerConfig). */
export const CHAVES_GLOBAIS: InfoChave[] = [
  {
    chave: 'status_por_exame', titulo: 'Status que entram na fatura', tipo: 'lista', padrao: 'Assinado,Reassinado',
    explicacao: 'Só entram na fatura os exames com um destes status. Unidades marcadas para cobrar “todos os status” (e fixo pela data do exame) ignoram esta lista.',
    lidoPor: 'Motor de cálculo (fat-simular) e a tela “Como esta unidade fatura”.',
  },
  {
    chave: 'prioridades_urgencia', titulo: 'Prioridades cobradas como urgência', tipo: 'lista', padrao: 'URGENCIA,EMERGENCIA,PLANTAO',
    explicacao: 'Exame com uma destas prioridades na Mobilemed é cobrado pelo preço de urgência, quando a unidade tem um.',
    lidoPor: 'Motor de cálculo (fat-simular).',
  },
  {
    chave: 'duplicado_entra', titulo: 'Exames duplicados entram na fatura', tipo: 'simnao', padrao: 'sim',
    explicacao: '“Sim”: o exame marcado como duplicado na Mobilemed é cobrado como os outros. “Não”: ele fica de fora.',
    lidoPor: 'Motor de cálculo (fat-simular).',
  },
]

/** Chaves de lista de unidades (texto = pastas separadas por vírgula). */
export const CHAVES_PASTAS: InfoChave[] = [
  {
    chave: 'separar_urgencia_pastas', titulo: 'Separar urgência no relatório', tipo: 'pastas', padrao: '',
    explicacao: 'Nestas unidades o relatório mostra a urgência separada do eletivo.',
    lidoPor: 'Só o relatório do Central Whats (o motor não lê esta chave).',
  },
  {
    chave: 'desdobrar_quantidade_pastas', titulo: 'Desdobrar exames que contam mais de 1', tipo: 'pastas', padrao: '',
    explicacao: 'Nestas unidades, o exame que conta 2 ou mais aparece desdobrado no relatório.',
    lidoPor: 'Só o relatório do Central Whats (o motor não lê esta chave).',
  },
  {
    chave: 'juntar_cr_dx_pastas', titulo: 'Juntar CR e DX numa linha só (RX)', tipo: 'pastas', padrao: '',
    explicacao: 'Nestas unidades o resumo junta radiografia computadorizada (CR) e digital (DX) numa linha só, “RX”.',
    lidoPor: 'Motor de cálculo (fat-simular) e o relatório.',
  },
]

export function listaCsv(v: string | null | undefined): string[] {
  return (v ?? '').split(',').map(s => s.trim()).filter(Boolean)
}
export function csv(l: string[]): string { return l.join(',') }

/** Valor que está valendo: o da config, ou o padrão do motor quando a chave não existe. */
export function valorEfetivo(config: Record<string, string>, info: InfoChave): { valor: string; padrao: boolean } {
  return info.chave in config ? { valor: config[info.chave], padrao: false } : { valor: info.padrao, padrao: true }
}

/** O motor só diz “não” para “nao”/“não”; qualquer outra coisa é “sim”. */
export function duplicadoEntra(valor: string): boolean {
  const v = valor.toLowerCase().trim()
  return v !== 'nao' && v !== 'não'
}

function ou(l: string[]): string { return l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} ou ${l[l.length - 1]}` }

/** Frase de leitura de cada regra. */
export function fraseGlobal(chave: string, valor: string): string {
  const l = listaCsv(valor)
  if (chave === 'status_por_exame') return l.length ? `Só entram exames com status ${ou(l)}.` : 'Nenhum status está liberado: nenhum exame entra.'
  if (chave === 'prioridades_urgencia') return l.length ? `Exame com prioridade ${ou(l)} é cobrado como urgência.` : 'Nenhuma prioridade é cobrada como urgência.'
  if (chave === 'duplicado_entra') return duplicadoEntra(valor) ? 'Exames duplicados entram na fatura normalmente.' : 'Exames duplicados ficam de fora da fatura.'
  return valor
}

/** Erro de validação do valor novo, ou null. */
export function validarGlobal(info: InfoChave, valor: string): string | null {
  if (info.tipo === 'simnao') return /^(sim|nao|não)$/i.test(valor.trim()) ? null : 'Escolha sim ou não.'
  if (info.tipo === 'lista') return listaCsv(valor).length ? null : 'A lista não pode ficar vazia.'
  return null
}

/** Itens da lista sem repetir (ignora caixa e acento) e sem vírgula. */
export function adicionarItem(lista: string[], novo: string): { lista: string[]; erro?: string } {
  const t = novo.trim().replace(/,/g, ' ').replace(/\s+/g, ' ')
  if (!t) return { lista }
  if (lista.some(x => normNome(x) === normNome(t))) return { lista, erro: `“${t}” já está na lista.` }
  return { lista: [...lista, t] }
}

/** Cada pasta do texto, com a unidade que ela encontra (pela comparação do motor, normNome). */
export function pastasComStatus<U extends { id: string; pasta: string }>(valor: string, unidades: U[]): { pasta: string; unidade: U | null }[] {
  const porNorm = new Map(unidades.map(u => [normNome(u.pasta), u]))
  return listaCsv(valor).map(p => ({ pasta: p, unidade: porNorm.get(normNome(p)) ?? null }))
}

/** Liga/desliga uma unidade na lista de pastas (grava o texto exato da pasta). */
export function alternarPasta(pastas: string[], u: { pasta: string }): string[] {
  const n = normNome(u.pasta)
  return pastas.some(p => normNome(p) === n) ? pastas.filter(p => normNome(p) !== n) : [...pastas, u.pasta]
}

export function marcada(pastas: string[], u: { pasta: string }): boolean {
  const n = normNome(u.pasta)
  return pastas.some(p => normNome(p) === n)
}
