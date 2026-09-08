/**
 * Imagem de assinatura: de `data:` para `cid:`, e de volta.
 *
 * POR QUE ISTO PRECISA EXISTIR.
 * O gerador de assinaturas (`/ferramentas/assinaturas`) embute TODAS as imagens
 * como `data:image/png;base64,…` — o painel da marca e os quatro ícones. Isso é
 * proposital lá: um `<img>` apontando para URL externa deixaria o `<canvas>`
 * *tainted* e quebraria o "Baixar PNG" (ver `lib/assinaturas/assets.ts`).
 *
 * Só que **o Gmail REMOVE imagem `data:` e o Outlook de mesa a bloqueia**. Hoje
 * ninguém percebe porque a ferramenta serve para a pessoa COLAR no Outlook, e é
 * o Outlook quem converte a imagem colada em anexo embutido ao enviar. Se
 * mandarmos o HTML cru pelo Graph, quem recebe vê retângulo quebrado.
 *
 * A solução é a mesma que o Outlook usa: mandar cada imagem como anexo
 * **embutido**, com um `contentId`, e referenciá-la no corpo por `cid:`. Isso
 * atravessa Gmail, Outlook e webmail sem depender de "exibir imagens".
 */

export interface ImagemEmbutida {
  /** O que vai no `src="cid:…"` e no `contentId` do anexo. */
  cid: string
  nome: string
  tipo: string
  /** Base64 puro, sem o prefixo `data:`. */
  base64: string
}

/** `data:image/png;base64,AAA` → `{ tipo: 'image/png', base64: 'AAA' }`. */
function partirDataUrl(src: string): { tipo: string; base64: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(src.trim())
  if (!m) return null
  return { tipo: m[1], base64: m[2] }
}

/**
 * Troca as imagens `data:` do HTML por referências `cid:` e devolve os bytes.
 *
 * DEDUPLICA POR CONTEÚDO: a assinatura repete ícones, e sem isto o mesmo
 * arquivo viajaria várias vezes no e-mail. O mapa é a própria data URL, que já
 * é o conteúdo inteiro — comparação exata, sem hash.
 *
 * O que não for `data:` fica intacto: uma imagem `https://` já funciona no
 * e-mail (o destinatário pode precisar liberar imagens externas, mas ela chega).
 */
export function extrairImagensEmbutidas(html: string): {
  html: string
  imagens: ImagemEmbutida[]
} {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const porDataUrl = new Map<string, ImagemEmbutida>()

  for (const img of [...doc.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? ''
    if (!src.toLowerCase().startsWith('data:image/')) continue

    let ja = porDataUrl.get(src)
    if (!ja) {
      const partes = partirDataUrl(src)
      if (!partes) continue
      const indice = porDataUrl.size
      ja = {
        cid: `assinatura-${indice}`,
        nome: `assinatura-${indice}.${partes.tipo.split('/')[1] || 'png'}`,
        tipo: partes.tipo,
        base64: partes.base64,
      }
      porDataUrl.set(src, ja)
    }
    img.setAttribute('src', `cid:${ja.cid}`)
  }

  return { html: doc.body.innerHTML.trim(), imagens: [...porDataUrl.values()] }
}

/**
 * O caminho inverso, só para mostrar na tela.
 *
 * `cid:` só existe dentro de um e-mail montado — num navegador ele não resolve
 * nada e a imagem aparece quebrada. Sem esta função, a prévia da assinatura no
 * compositor e no diálogo de ajustes mostraria exatamente o defeito que estamos
 * evitando no e-mail de verdade.
 */
export function paraPrevia(html: string, imagens: ImagemEmbutida[] = []): string {
  if (!html) return ''
  if (imagens.length === 0) return html
  const porCid = new Map(imagens.map((i) => [i.cid, i]))
  const doc = new DOMParser().parseFromString(html, 'text/html')

  for (const img of [...doc.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? ''
    if (!src.toLowerCase().startsWith('cid:')) continue
    const achada = porCid.get(src.slice(4))
    if (achada) img.setAttribute('src', `data:${achada.tipo};base64,${achada.base64}`)
  }

  return doc.body.innerHTML
}
