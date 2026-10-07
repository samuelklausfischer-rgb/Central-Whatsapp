import { format, startOfDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { MensagemInterna } from '@/lib/supabase/chat-interno-types'

/**
 * Regras puras do Chat interno — sem React, sem rede. Ficam à parte para a
 * store, a lista, a janela e a notificação concordarem sobre as MESMAS regras
 * (prévia, ordem, iniciais) em vez de cada uma ter a sua cópia.
 */

const FORMATO_ISO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/

/**
 * Instante em MICROSSEGUNDOS, para ordenar mensagens.
 *
 * `Date.parse` corta no milissegundo, e as mensagens de sistema de uma mesma
 * operação (ex.: "X removeu Y" + "Z agora é administrador") nascem na mesma
 * transação, com microssegundos de diferença — dentro do mesmo milissegundo a
 * ordem cairia no desempate por uuid, que é aleatório. O banco usa
 * `clock_timestamp()` justamente para isso (ver a migration); aqui a precisão
 * precisa chegar até a tela.
 *
 * Cabe em inteiro seguro: 1,8e12 ms * 1000 = 1,8e15 < 9e15.
 */
export function microssDe(iso: string | null | undefined): number {
  if (!iso) return Number.NaN
  const m = FORMATO_ISO.exec(iso)
  if (!m) {
    const t = Date.parse(iso)
    return Number.isNaN(t) ? Number.NaN : t * 1000
  }
  const [, base, fracao = '', fuso = 'Z'] = m
  // O Postgres escreve `+00` ou `+00:00`; o `Date.parse` só aceita a forma com dois-pontos.
  let normalizado = fuso
  if (/^[+-]\d{2}$/.test(fuso)) normalizado = `${fuso}:00`
  else if (/^[+-]\d{4}$/.test(fuso)) normalizado = `${fuso.slice(0, 3)}:${fuso.slice(3)}`
  const ms = Date.parse(`${base}${normalizado}`)
  if (Number.isNaN(ms)) return Number.NaN
  return ms * 1000 + Number(fracao.padEnd(6, '0').slice(0, 6))
}

/** Ordem de exibição: mais antiga primeiro, `id` só como desempate estável. */
export function compararMensagens(a: Pick<MensagemInterna, 'criado_em' | 'id'>, b: Pick<MensagemInterna, 'criado_em' | 'id'>): number {
  const d = microssDe(a.criado_em) - microssDe(b.criado_em)
  if (d !== 0 && !Number.isNaN(d)) return d
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Mesma regra de `_chat_interno_preview` no banco — a lista se atualiza sem esperar o resumo. */
export function previewDaMensagem(
  m: Pick<MensagemInterna, 'tipo' | 'conteudo' | 'anexo_nome' | 'apagada_em'>,
): string {
  const texto = (m.conteudo ?? '').replace(/\s+/g, ' ').trim()
  let preview: string
  if (m.apagada_em) preview = 'Mensagem apagada'
  else if (m.tipo === 'imagem') preview = texto || 'Foto'
  else if (m.tipo === 'audio') preview = 'Áudio'
  else if (m.tipo === 'arquivo') preview = (m.anexo_nome ?? '').trim() || 'Arquivo'
  else preview = texto
  return preview.slice(0, 140)
}

/** Duas letras para o avatar: inicial do primeiro e do último nome. */
export function iniciaisDe(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return ''
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/** Hoje: hora · ontem: "Ontem" · até 6 dias: dia da semana · depois: data. Igual à lista do WhatsApp. */
export function horaDaLista(iso: string | null | undefined): string {
  if (!iso) return ''
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return ''
  const hoje = startOfDay(new Date())
  const dias = Math.round((hoje.getTime() - startOfDay(data).getTime()) / 86_400_000)
  if (dias <= 0) return format(data, 'HH:mm')
  if (dias === 1) return 'Ontem'
  if (dias <= 6) return format(data, 'EEE', { locale: ptBR })
  if (data.getFullYear() === new Date().getFullYear()) return format(data, 'dd/MM')
  return format(data, 'dd/MM/yy')
}

export function horaDoBalao(iso: string): string {
  const data = new Date(iso)
  return Number.isNaN(data.getTime()) ? '' : format(data, 'HH:mm')
}

/** Mm:ss — duração de gravação e de áudio. */
export function minutosESegundos(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const CORES_DE_AUTOR = [
  'text-emerald-600 dark:text-emerald-400',
  'text-sky-600 dark:text-sky-400',
  'text-violet-600 dark:text-violet-400',
  'text-amber-600 dark:text-amber-400',
  'text-rose-600 dark:text-rose-400',
  'text-teal-600 dark:text-teal-400',
  'text-fuchsia-600 dark:text-fuchsia-400',
  'text-orange-600 dark:text-orange-400',
]

/** A mesma pessoa tem sempre a mesma cor no grupo — como o nome colorido do WhatsApp. */
export function corDoAutor(id: string | null | undefined): string {
  if (!id) return CORES_DE_AUTOR[0]
  let soma = 0
  for (let i = 0; i < id.length; i++) soma = (soma * 31 + id.charCodeAt(i)) >>> 0
  return CORES_DE_AUTOR[soma % CORES_DE_AUTOR.length]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** O id veio da URL: só serve se for um uuid de verdade. */
export function ehUuid(valor: string | null | undefined): valor is string {
  return !!valor && UUID.test(valor)
}

/** Sem acento e em minúsculas — a busca "joao" acha "João". */
export function normalizarParaBusca(texto: string): string {
  return texto.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').toLowerCase()
}

/** Extensão em maiúsculas para o cartão de arquivo (no máximo 4 letras). */
export function siglaDoArquivo(nome: string | null | undefined): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(nome ?? '')
  return m ? m[1].slice(0, 4).toUpperCase() : 'ARQ'
}

/**
 * Valor do item "Chat interno" dentro do seletor de aparelhos da lista.
 *
 * NÃO é um id de aparelho e nunca pode virar `selectedDeviceId`: aquele id vai
 * para RPC de uuid (`get_conversation_summaries`), para `?device=` e para o
 * `sessionStorage` das notificações. O seletor só o usa como valor de exibição,
 * e a escolha vira troca de MODO no `ChatHub`.
 */
export const VALOR_CHAT_INTERNO = '__chat_interno__'

/** `sessionStorage`: o modo da tela de conversas ('whats' | 'interno') e a conversa interna aberta. */
export const CHAVE_MODO_DO_CHAT = 'chatModo'
export const CHAVE_CONVERSA_INTERNA = 'chatInternoConversa'
/**
 * `sessionStorage`: a conversa do WhatsApp que estava aberta quando a pessoa foi
 * para o modo interno. `activeContactJid` é apagado nesse modo (o aviso de
 * mensagem trata a chave como "conversa em foco" e ficaria mudo), então a
 * conversa precisa de outra chave para sobreviver a sair e voltar ao `/chat`.
 */
export const CHAVE_CONTATO_ANTES_DO_INTERNO = 'activeContactJidAntesDoInterno'
