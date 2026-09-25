// Converte uma imagem (File/Blob) para WebP via canvas, reduzindo qualidade
// e/ou dimensão até caber num teto de tamanho.
//
// Usado hoje só pelos prints do "Reportar problema / ideia": a policy de
// INSERT em `hub_report_anexos` exige `tamanho_bytes <= 5242880` (5 MiB) e
// `mime IN ('image/webp','image/png','image/jpeg')` — o insert falha se
// qualquer uma das duas não bater, então a compressão acontece ANTES do
// upload, nunca depois.

/** Espelha o teto da policy — ver comentário acima. */
export const IMAGEM_MAX_BYTES = 5 * 1024 * 1024

/** Maior lado da imagem final. Print de tela cheia em 4K não precisa de mais que isso. */
const LADO_MAXIMO_PADRAO = 1920

// Combinação de tentativas: primeiro reduz qualidade na escala original: só
// encolhe a imagem quando nem a pior qualidade coube — perder nitidez incomoda
// menos, num print de bug, do que perder pixels.
const QUALIDADES = [0.85, 0.72, 0.6, 0.45, 0.3]
const FATORES_DE_ESCALA = [1, 0.75, 0.5, 0.35]

export interface ImagemConvertida {
  blob: Blob
  /** Largura real do canvas usado para gerar o blob — não a da imagem original. */
  largura: number
  /** Altura real do canvas usado para gerar o blob — não a da original. */
  altura: number
}

interface ConverterImagemParaWebpOpcoes {
  maxBytes?: number
  ladoMaximo?: number
}

async function carregarImagem(arquivo: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(arquivo)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Não consegui ler esta imagem.'))
      img.src = url
    })
    return img
  } finally {
    // O bitmap já foi decodificado para dentro do <img> no `onload`; a URL
    // não precisa sobreviver além disso (mesmo raciocínio de `rasterizar.ts`).
    URL.revokeObjectURL(url)
  }
}

function desenharCanvas(img: HTMLImageElement, largura: number, altura: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível neste navegador.')
  ctx.drawImage(img, 0, 0, largura, altura)
  return canvas
}

function canvasParaBlob(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/webp', qualidade))
}

/**
 * Redimensiona (se preciso) e comprime até caber em `maxBytes`.
 *
 * Tenta, em ordem, escala 100/75/50/35% × qualidade 85/72/60/45/30% e devolve
 * a PRIMEIRA combinação que couber. Se nenhuma couber, rejeita com uma
 * mensagem clara em vez de subir um arquivo que a policy vai recusar de
 * qualquer forma.
 */
export async function converterImagemParaWebp(
  arquivo: File | Blob,
  opcoes: ConverterImagemParaWebpOpcoes = {},
): Promise<ImagemConvertida> {
  const maxBytes = opcoes.maxBytes ?? IMAGEM_MAX_BYTES
  const ladoMaximo = opcoes.ladoMaximo ?? LADO_MAXIMO_PADRAO

  const img = await carregarImagem(arquivo)
  const larguraOriginal = img.naturalWidth || img.width
  const alturaOriginal = img.naturalHeight || img.height
  if (!larguraOriginal || !alturaOriginal) {
    throw new Error('Não consegui ler as dimensões desta imagem.')
  }

  const maiorLado = Math.max(larguraOriginal, alturaOriginal)
  // Só encolhe quando passa do teto — imagem pequena não é ampliada.
  const escalaInicial = maiorLado > ladoMaximo ? ladoMaximo / maiorLado : 1

  let menorConseguido: ImagemConvertida | null = null

  for (const fator of FATORES_DE_ESCALA) {
    const escala = escalaInicial * fator
    const largura = Math.max(1, Math.round(larguraOriginal * escala))
    const altura = Math.max(1, Math.round(alturaOriginal * escala))
    const canvas = desenharCanvas(img, largura, altura)

    for (const qualidade of QUALIDADES) {
      const blob = await canvasParaBlob(canvas, qualidade)
      if (!blob) continue
      if (blob.size <= maxBytes) {
        return { blob, largura, altura }
      }
      if (!menorConseguido || blob.size < menorConseguido.blob.size) {
        menorConseguido = { blob, largura, altura }
      }
    }
  }

  const tamanhoMb = menorConseguido ? (menorConseguido.blob.size / 1024 / 1024).toFixed(1) : null
  throw new Error(
    tamanhoMb
      ? `Esta imagem não coube no limite de 5 MB mesmo comprimida (menor tamanho conseguido: ${tamanhoMb} MB).`
      : 'Não foi possível converter esta imagem para WebP neste navegador.',
  )
}
