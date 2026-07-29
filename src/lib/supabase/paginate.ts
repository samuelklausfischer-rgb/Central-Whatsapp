/**
 * Busca TODAS as linhas de uma consulta, contornando o teto do PostgREST.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * O PostgREST do Supabase self-hosted roda com `PGRST_DB_MAX_ROWS=1000`
 * (confirmado no container `apps_supabase-rest-1` e no `.env` do stack). Ele
 * injeta `LIMIT 1000` em toda consulta REST — **sem erro, sem aviso e com HTTP
 * 200**. Um `.select()` sem paginação numa tabela maior que isso devolve uma
 * fatia silenciosa, e o app trata a fatia como se fosse o conjunto inteiro.
 *
 * Foi exatamente o que aconteceu com `contacts` (1.486 linhas): 486 contatos
 * nunca chegavam ao cliente, então as conversas deles apareciam com o número de
 * telefone no lugar do nome salvo e a foto nunca fixava. O Supabase Cloud aplica
 * o mesmo teto de 1.000, então paginar é a correção portátil — subir a variável
 * no servidor é só folga, e some se o stack for recriado.
 *
 * POR QUE KEYSET E NÃO `.range()`
 * Com OFFSET, um INSERT concorrente desloca a janela e uma linha pode ser
 * PULADA entre duas páginas. Como `id` é uuid (aleatório), a linha nova cai em
 * posição arbitrária e o pulo é silencioso — ou seja, o mesmo defeito que esta
 * função existe para corrigir. Com keyset (`.gt(coluna, cursor)`) a janela é
 * ancorada num valor, não numa contagem.
 */

const TAMANHO_PAGINA = 1000
// Teto de segurança: 50 páginas = 50.000 linhas. Existe só para um bug de
// cursor não virar laço infinito batendo na rede.
const MAX_PAGINAS = 50

type ConstrutorDePagina<T> = (
  tamanho: number,
  cursor: string | null,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/**
 * `construirPagina` recebe o tamanho da página e o cursor (o valor da coluna de
 * ordenação na última linha da página anterior, ou `null` na primeira) e deve
 * devolver a query já ordenada, limitada e filtrada por `.gt(coluna, cursor)`.
 *
 * `extrairCursor` lê dessa linha o valor que ancora a próxima página. A coluna
 * usada precisa ser ÚNICA e ter ordenação total (uma PK serve) — com coluna
 * repetida, `.gt()` pularia as linhas empatadas.
 *
 * All-or-nothing de propósito: qualquer página que falhe lança, e o chamador
 * fica com o estado anterior. Devolver o que já veio seria pior que o bug
 * original — gravaria uma lista truncada como se estivesse completa.
 */
export async function buscarTodasAsPaginas<T>(
  construirPagina: ConstrutorDePagina<T>,
  extrairCursor: (linha: T) => string,
): Promise<T[]> {
  const todas: T[] = []
  let cursor: string | null = null

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data, error } = await construirPagina(TAMANHO_PAGINA, cursor)
    if (error) throw new Error(error.message)

    const lote = data ?? []
    // Parar SÓ com lote vazio, nunca em `lote.length < TAMANHO_PAGINA`. Se o
    // servidor tiver um teto MENOR que TAMANHO_PAGINA, toda página cheia volta
    // curta e o "otimizado" pararia na primeira — recriando este bug em
    // silêncio. O custo é uma requisição extra, que é lookup por índice.
    if (lote.length === 0) break

    todas.push(...lote)
    cursor = extrairCursor(lote[lote.length - 1])
  }

  return todas
}

export const TAMANHO_PAGINA_PADRAO = TAMANHO_PAGINA
