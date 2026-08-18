/**
 * Fontes e imagens da assinatura, em base64.
 *
 * POR QUE BASE64, E NÃO URL
 * A assinatura vira PNG desenhando o SVG num `<canvas>` e chamando
 * `toDataURL()` (ver `rasterizar.ts`). Se o SVG apontar para qualquer URL
 * `http(s)` — fonte, logo, ícone — o canvas fica *tainted* e `toDataURL()`
 * lança `SecurityError`. O preview continuaria perfeito na tela e só "Copiar
 * assinatura" e "Baixar PNG" quebrariam, que é o pior tipo de bug: silencioso
 * onde ninguém olha. Por isso tudo entra embutido no próprio SVG.
 *
 * POR QUE `public/`, E NÃO UM `.ts`
 * São ~578 KB de base64 que não comprimem (woff2 e PNG já vêm comprimidos).
 * Como `.ts` isso entraria no chunk da ferramenta; buscado por `fetch` fica
 * fora do JavaScript, é cacheado pelo navegador como arquivo e só é baixado
 * por quem abre a ferramenta. A promessa é memoizada: uma vez por sessão.
 */

import type { ChaveMarca } from './marcas'

type ChaveIcone = 'phone' | 'mail' | 'web' | 'pin'

interface ImagensDaMarca {
  /** Logotipo em cores, para fundo claro. */
  logo: string
  /** Logotipo em negativo, para fundo escuro. */
  neg: string
  /** A esfera da marca, usada como marca d'água. */
  esfera: string
  painel: string
  /** Painel pronto do conceito Vidro — usado pela versão clicável em HTML. */
  painelVidro: string
}

export interface AssetsAssinatura {
  /** woff2 em base64 CRU (sem o prefixo `data:`) — vai dentro de `@font-face`. */
  fontes: Record<'poppins-400' | 'poppins-500' | 'opensans-400', string>
  imagens: Record<ChaveMarca, ImagensDaMarca>
  /** `claro` para fundo claro, `escuro` para os conceitos Vidro e Noturno. */
  icones: Record<'claro' | 'escuro', Record<ChaveIcone, string>>
}

let promessa: Promise<AssetsAssinatura> | null = null

export function carregarAssets(): Promise<AssetsAssinatura> {
  if (!promessa) {
    promessa = fetch(`${import.meta.env.BASE_URL}assinaturas/assets.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`assets.json respondeu ${r.status}`)
        return r.json() as Promise<AssetsAssinatura>
      })
      .catch((erro) => {
        // Não guardar a promessa rejeitada: senão o primeiro erro de rede
        // condena a ferramenta até recarregar o app inteiro.
        promessa = null
        throw erro
      })
  }
  return promessa
}

/** O `<style>` que embute as fontes dentro do SVG. */
export function cssDasFontes(assets: AssetsAssinatura): string {
  return `
 @font-face{font-family:'Poppins';font-weight:400;src:url(data:font/woff2;base64,${assets.fontes['poppins-400']}) format('woff2')}
 @font-face{font-family:'Poppins';font-weight:500;src:url(data:font/woff2;base64,${assets.fontes['poppins-500']}) format('woff2')}
 @font-face{font-family:'OpenSansX';font-weight:400;src:url(data:font/woff2;base64,${assets.fontes['opensans-400']}) format('woff2')}
 text{white-space:pre}`
}
