/**
 * SVG → PNG dentro do navegador, e a cópia para a área de transferência.
 */

/**
 * Desenha o SVG num canvas e devolve o PNG em data URI.
 *
 * `escala` 2 é o que a assinatura usa: o e-mail exibe na largura lógica do SVG,
 * mas a imagem vai com o dobro de pixels — é isso que impede o texto de sair
 * borrado em tela de alta densidade.
 *
 * Se algum asset do SVG for uma URL externa em vez de `data:`, o canvas fica
 * *tainted* e o `toDataURL()` abaixo lança `SecurityError`. Ver `assets.ts`.
 */
export async function rasterizar(
  svg: string,
  escala = 2,
  /**
   * PNG por padrão — é o que "Copiar assinatura" e "Baixar PNG" sempre
   * entregaram, e não muda.
   *
   * `image/jpeg` existe para a assinatura de E-MAIL: em 2× o PNG desta
   * assinatura dá **729 KB em base64**, e ela viaja em todo e-mail enviado.
   * Medido comparando pixel a pixel contra o PNG, o JPEG em q92 fica em 106 KB
   * — 85% menor — com erro médio de 0,93 em 255, ou seja, imperceptível. O WebP
   * seria menor ainda (56 KB) e está FORA de propósito: o Outlook do Windows
   * desenha e-mail com o motor do Word, que não renderiza WebP.
   */
  formato: 'image/png' | 'image/jpeg' = 'image/png',
  qualidade?: number,
): Promise<{ url: string; largura: number }> {
  // `unescape(encodeURIComponent(...))` converte UTF-8 para latin1, que é o que
  // o `btoa` aceita — sem isso, qualquer acento no nome quebra a codificação.
  const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
  const img = new Image()
  await new Promise<void>((ok, err) => {
    img.onload = () => ok()
    img.onerror = () => err(new Error('Não consegui desenhar a assinatura.'))
    img.src = url
  })
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * escala)
  c.height = Math.round(img.height * escala)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível neste navegador.')
  // JPEG não tem canal alfa: onde o SVG fosse transparente, o canvas vazio sairia
  // PRETO. Os conceitos de hoje são todos opacos — conferido —, mas pintar o
  // branco antes custa nada e evita que um conceito novo entregue moldura preta
  // no e-mail sem ninguém entender por quê.
  if (formato === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  ctx.scale(escala, escala)
  ctx.drawImage(img, 0, 0)
  return { url: c.toDataURL(formato, qualidade), largura: img.width }
}

/**
 * Copia HTML formatado para a área de transferência.
 *
 * O caminho moderno (`ClipboardItem`) falha quando a página não tem permissão
 * ou o gesto do usuário já expirou. O fallback com `contentEditable` +
 * `execCommand('copy')` é feio e obsoleto, mas é o único que funciona nesses
 * casos — e sem ele "Copiar assinatura" simplesmente não faz nada.
 */
export async function copiarHTML(html: string): Promise<void> {
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([texto], { type: 'text/plain' }),
      }),
    ])
  } catch {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    el.style.cssText = 'position:fixed;left:-9999px;top:0;'
    el.innerHTML = html
    document.body.appendChild(el)
    const r = document.createRange()
    r.selectNodeContents(el)
    const s = getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
    document.execCommand('copy')
    s?.removeAllRanges()
    el.remove()
  }
}

/** Dispara o download de um data URI com o nome dado. */
export function baixar(dataUrl: string, nomeArquivo: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = nomeArquivo
  a.click()
}
