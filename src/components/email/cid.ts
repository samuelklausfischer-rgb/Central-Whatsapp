/**
 * Imagens embutidas por `cid:` — a parte que não depende de rede nem de DOM.
 *
 * O e-mail aponta a imagem por `<img src="cid:image001.png@01D8D9DB.51722550">`,
 * e a imagem em si viaja como anexo "embutido" cujo `contentId` é aquele texto.
 * O navegador não sabe resolver `cid:`, então a tela precisa trocar o endereço
 * por um `blob:` antes de entregar o HTML ao iframe (ver `CorpoDoEmail`).
 *
 * Tudo aqui compara por `normalizarCid`, porque os dois lados nunca escrevem
 * igual: o corpo pode trazer o id com `%40` no lugar de `@` ou em outra caixa, e
 * o Graph às vezes devolve entre `<` `>`. Comparar texto cru perderia imagem
 * sem erro nenhum.
 */

/** Forma canônica de um Content-ID: sem `cid:`, sem `<>`, decodificado, minúsculo. */
export function normalizarCid(bruto: string): string {
  let cid = bruto.trim().replace(/^cid:/i, '').replace(/^<|>$/g, '')
  try {
    cid = decodeURIComponent(cid)
  } catch {
    // `%` solto que não é escape: fica como veio.
  }
  return cid.trim().toLowerCase()
}

/** Tudo o que vem depois de `cid:` até aspas, espaço, `)` ou `>`. */
const REFERENCIA_CID = /\bcid:([^"'\s)>]+)/gi

/** Os Content-IDs citados no HTML, normalizados e sem repetição. */
export function extrairCids(html: string | null | undefined): string[] {
  if (!html) return []
  const vistos = new Set<string>()
  for (const achado of html.matchAll(REFERENCIA_CID)) {
    const cid = normalizarCid(achado[1])
    if (cid) vistos.add(cid)
  }
  return [...vistos]
}

/** Troca cada `cid:xxx` que tem correspondente no mapa (`cid normalizado` → endereço). */
export function substituirCids(html: string, enderecos: Map<string, string>): string {
  if (enderecos.size === 0) return html
  return html.replace(REFERENCIA_CID, (inteiro, bruto: string) => {
    return enderecos.get(normalizarCid(bruto)) ?? inteiro
  })
}

/**
 * Tira o `src="cid:…"` das imagens que ainda não foram resolvidas.
 *
 * Sem isto o leitor mostra o ícone de "imagem quebrada" durante o segundo em que
 * as imagens estão sendo buscadas — e, se a busca falhar, para sempre. Sem `src`,
 * a `<img>` mostra o texto alternativo (quando existe) e mantém o espaço das
 * dimensões que o e-mail declarou, então nada pula de lugar quando a imagem chega.
 */
export function esconderCidPendente(html: string): string {
  return html.replace(/(\s)src(\s*=\s*["']\s*cid:)/gi, '$1data-src-cid$2')
}
