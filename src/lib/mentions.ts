/**
 * Menções em mensagem (@pessoa e @todos).
 *
 * COMO O WHATSAPP FAZ, E POR QUE IMPORTA
 * A menção NÃO é um enfeite visual: a mensagem viaja com o NÚMERO escrito no
 * texto (`@5547999999999`) e, em paralelo, com a lista de JIDs no campo
 * `mentioned` do envio. É a lista que faz o WhatsApp do destinatário destacar o
 * nome e **notificar a pessoa**. Só escrever `@Fulano` no texto produz uma
 * mensagem que parece certa e não menciona ninguém.
 *
 * Por isso o texto guardado e enviado contém o número, e a troca por nome
 * acontece só na EXIBIÇÃO — exatamente como o WhatsApp, que mostra `@Fulano`
 * sobre um texto que por baixo tem o número.
 *
 * Efeito colateral bem-vindo: as mensagens que a clínica RECEBE com menção hoje
 * mostram o número cru. Passam a mostrar o nome também.
 */

/**
 * Sequência que representa uma menção no texto: arroba + 10 a 15 dígitos.
 *
 * A FONTE ÚNICA do padrão. O balão precisa dele para quebrar o texto (junto com
 * link, negrito e itálico, num `split` só) e o envio precisa dele para extrair
 * os números. Cópias soltas do padrão em cada lugar já produziram uma versão
 * escrita `@d{10,15}` — que casa a letra "d", não dígito, e simplesmente nunca
 * casa nada.
 */
export const PADRAO_MENCAO = '@\\d{10,15}\\b'

const REGEX_MENCAO = new RegExp(`@(\\d{10,15})\\b`, 'g')

/** Verdadeiro se o pedaço de texto É exatamente uma menção (e nada mais). */
export function ehMencao(pedaco: string): boolean {
  return /^@\d{10,15}$/.test(pedaco)
}

/** Telefones mencionados no texto, para mandar no campo `mentioned` do envio. */
export function extrairMencionados(texto: string): string[] {
  if (!texto) return []
  const encontrados = new Set<string>()
  for (const achado of texto.matchAll(REGEX_MENCAO)) {
    encontrados.add(achado[1])
  }
  return [...encontrados]
}

/**
 * A palavra parcial que o usuário está digitando depois de um `@`, para filtrar
 * o autocomplete. Devolve `null` quando o cursor não está numa menção em curso.
 *
 * Só dispara quando o `@` está no começo do texto ou depois de espaço — assim
 * um e-mail digitado no meio da frase não abre a lista.
 */
export function mencaoEmDigitacao(texto: string, posicaoCursor: number): { termo: string; inicio: number } | null {
  const antes = texto.slice(0, posicaoCursor)
  const idx = antes.lastIndexOf('@')
  if (idx < 0) return null
  if (idx > 0 && !/\s/.test(antes[idx - 1])) return null
  const termo = antes.slice(idx + 1)
  // Espaço encerra a menção em curso; e um limite evita a lista ficar aberta
  // enquanto a pessoa escreve um parágrafo.
  if (/\s/.test(termo) || termo.length > 30) return null
  return { termo, inicio: idx }
}

/** Substitui a menção em curso pelo número escolhido, devolvendo texto e cursor. */
export function aplicarMencao(
  texto: string,
  inicio: number,
  posicaoCursor: number,
  telefone: string,
): { texto: string; cursor: number } {
  const insercao = `@${telefone} `
  const novo = texto.slice(0, inicio) + insercao + texto.slice(posicaoCursor)
  return { texto: novo, cursor: inicio + insercao.length }
}
