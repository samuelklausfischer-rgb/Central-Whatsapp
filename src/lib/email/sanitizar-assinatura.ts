/**
 * Limpa o HTML de uma assinatura colada do Outlook.
 *
 * POR QUE ISTO EXISTE, E POR QUE NÃO É REGEX.
 * A assinatura é conteúdo que a própria pessoa cola — e que NÓS passamos a
 * enviar para fora, além de guardar no banco e renderizar de volta na tela. Um
 * `<script>` ou um `onerror=` que sobrevivesse aqui viraria código rodando
 * dentro do nosso app.
 *
 * O `EmailReader` limpa e-mail recebido com três `replace()` encadeados, e
 * aquilo é frágil por natureza: não pega `onclick='...'` com aspas simples, nem
 * `onclick=x` sem aspas, nem `<svg onload>`, nem `<script` sem fechamento. Lá
 * quem de fato segura é o `sandbox` do iframe. Aqui não há iframe, então a
 * limpeza precisa valer sozinha — e por isso ela roda sobre a árvore JÁ
 * INTERPRETADA pelo navegador, com lista de permissão. O que o parser não
 * reconhecer como tag ou atributo simplesmente não existe para nós.
 *
 * SEM DEPENDÊNCIA NOVA de propósito. DOMPurify faria isto melhor e é a escolha
 * certa se um dia a exigência crescer; hoje o alvo é estreito (assinatura
 * corporativa: texto, link, imagem, tabela de diagramação) e cabe aqui.
 *
 * `DOMParser` NÃO executa nada: scripts não rodam, `<img>` não busca a imagem.
 * É seguro dar o HTML colado para ele antes de limpar.
 */

/**
 * Tags que uma assinatura corporativa realmente usa.
 *
 * `table`/`tr`/`td` estão na lista porque o Outlook diagrama assinatura com
 * tabela — tirá-las embaralharia o logotipo ao lado do texto. `style` e `meta`
 * ficam de FORA: `<style>` colado do Word traz centenas de regras `Mso*` que
 * vazariam para o resto da página, já que não há iframe isolando isto.
 */
const TAGS_PERMITIDAS = new Set([
  'a', 'b', 'br', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'hr', 'i', 'img', 'li',
  'ol', 'p', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
])

/**
 * Atributos permitidos, por tag. `*` vale para qualquer uma.
 *
 * `style` entra porque é ele que carrega cor, tamanho e espaçamento — sem ele a
 * assinatura chega sem graça. Ele é filtrado à parte, em `limparStyle`.
 * `class` fica de fora: as classes do Word (`MsoNormal`) não significam nada
 * fora do Word e ainda colidiriam com as nossas.
 */
const ATRIBUTOS_PERMITIDOS: Record<string, Set<string>> = {
  '*': new Set(['style', 'title', 'dir', 'align']),
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height']),
  table: new Set(['border', 'cellpadding', 'cellspacing', 'width']),
  td: new Set(['colspan', 'rowspan', 'valign', 'width']),
  th: new Set(['colspan', 'rowspan', 'valign', 'width']),
  font: new Set(['color', 'face', 'size']),
}

/**
 * Propriedades de CSS que passam.
 *
 * Lista curta de propósito. Fora dela ficam `position`, `z-index` e afins: uma
 * assinatura com `position:fixed` cobriria a tela de quem recebe — e, na prévia,
 * a nossa. Também some qualquer valor com `url(` ou `expression(`, que são os
 * dois jeitos clássicos de esconder busca de rede ou código dentro de estilo.
 */
const CSS_PERMITIDO = new Set([
  'background-color', 'border', 'border-bottom', 'border-collapse', 'border-left',
  'border-right', 'border-top', 'color', 'font-family', 'font-size', 'font-style',
  'font-weight', 'height', 'letter-spacing', 'line-height', 'margin',
  'margin-bottom', 'margin-left', 'margin-right', 'margin-top', 'padding',
  'padding-bottom', 'padding-left', 'padding-right', 'padding-top', 'text-align',
  'text-decoration', 'vertical-align', 'white-space', 'width',
])

export interface ResultadoDaLimpeza {
  html: string
  /**
   * Avisos para mostrar na tela. Existem porque a pessoa PRECISA saber o que se
   * perdeu — descartar o logotipo em silêncio faria ela descobrir pelo cliente.
   */
  avisos: string[]
}

/** `cid:` é referência interna do Outlook; fora dele a imagem não existe. */
function origemDeImagemServe(src: string): boolean {
  const limpo = src.trim().toLowerCase()
  return limpo.startsWith('https://') || limpo.startsWith('data:image/')
}

function limparStyle(valor: string): string {
  return valor
    .split(';')
    .map((parte) => {
      const i = parte.indexOf(':')
      if (i < 0) return ''
      const prop = parte.slice(0, i).trim().toLowerCase()
      const val = parte.slice(i + 1).trim()
      if (!CSS_PERMITIDO.has(prop)) return ''
      if (/url\s*\(|expression\s*\(|javascript:/i.test(val)) return ''
      return `${prop}: ${val}`
    })
    .filter(Boolean)
    .join('; ')
}

/**
 * Devolve o HTML limpo e a lista do que foi descartado.
 *
 * Percorre de trás para frente ao remover, porque `children` é uma coleção viva:
 * apagar durante a varredura para frente pularia o elemento seguinte.
 */
export function sanitizarAssinatura(htmlCru: string): ResultadoDaLimpeza {
  const avisos: string[] = []
  const doc = new DOMParser().parseFromString(htmlCru, 'text/html')

  let imagensDescartadas = 0
  let scriptsDescartados = 0

  /**
   * Aplica as regras a UM elemento e, antes, aos filhos dele.
   *
   * Recebe sempre um FILHO do `body`, nunca o `body`. A primeira versão daqui
   * chamava esta função no próprio `body`: como `body` não está na lista de tags
   * permitidas, ele caía no ramo de "desembrulhar", perdia a casca e sumia do
   * documento — e a linha seguinte lia `doc.body.innerHTML` de um `null`. Toda
   * chamada estourava.
   */
  const visitar = (no: Element) => {
    for (let i = no.children.length - 1; i >= 0; i--) {
      visitar(no.children[i] as Element)
    }

    const tag = no.tagName.toLowerCase()

    if (!TAGS_PERMITIDAS.has(tag)) {
      if (tag === 'script' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
        scriptsDescartados++
        no.remove()
        return
      }
      // Tag desconhecida mas inofensiva (`o:p` do Word, `center`, `section`):
      // some a casca e o CONTEÚDO fica. Remover junto apagaria texto da pessoa.
      if (tag === 'style' || tag === 'meta' || tag === 'link' || tag === 'title') {
        no.remove()
        return
      }
      const pai = no.parentNode
      if (pai) {
        while (no.firstChild) pai.insertBefore(no.firstChild, no)
        no.remove()
      }
      return
    }

    if (tag === 'img' && !origemDeImagemServe(no.getAttribute('src') ?? '')) {
      imagensDescartadas++
      no.remove()
      return
    }

    for (const atributo of [...no.attributes]) {
      const nome = atributo.name.toLowerCase()
      const permitidos = ATRIBUTOS_PERMITIDOS[tag]
      const vale =
        ATRIBUTOS_PERMITIDOS['*'].has(nome) || (permitidos ? permitidos.has(nome) : false)
      if (!vale) {
        // Todo `on*` cai aqui, e é o caso que mais importa.
        no.removeAttribute(atributo.name)
        continue
      }
      if (nome === 'style') {
        const limpo = limparStyle(atributo.value)
        if (limpo) no.setAttribute('style', limpo)
        else no.removeAttribute('style')
        continue
      }
      if (nome === 'href' && /^\s*javascript:/i.test(atributo.value)) {
        no.removeAttribute('href')
        continue
      }
      if (nome === 'src' && tag === 'img' && !origemDeImagemServe(atributo.value)) {
        no.removeAttribute('src')
      }
    }

    // Link de assinatura abre fora do app; sem `noopener` a página aberta ganha
    // referência para a nossa janela.
    if (tag === 'a' && no.getAttribute('href')) {
      no.setAttribute('target', '_blank')
      no.setAttribute('rel', 'noopener noreferrer')
    }
  }

  // De trás para frente, e só nos FILHOS: `children` é coleção viva, e remover
  // durante uma varredura para a frente pularia o elemento seguinte.
  for (let i = doc.body.children.length - 1; i >= 0; i--) {
    visitar(doc.body.children[i] as Element)
  }

  if (imagensDescartadas > 0) {
    avisos.push(
      imagensDescartadas === 1
        ? 'Uma imagem não veio junto: o Outlook a guarda internamente, e fora dele ela não existe. Salve o arquivo e cole de novo, ou use um endereço da web.'
        : `${imagensDescartadas} imagens não vieram juntas: o Outlook as guarda internamente, e fora dele elas não existem. Salve os arquivos e cole de novo, ou use endereços da web.`,
    )
  }
  if (scriptsDescartados > 0) {
    avisos.push('Havia código embutido no que você colou. Foi removido.')
  }

  return { html: doc.body.innerHTML.trim(), avisos }
}
