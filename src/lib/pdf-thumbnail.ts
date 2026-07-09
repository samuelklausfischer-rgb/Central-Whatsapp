export type PdfPreview = { thumbnail: string | null; pageCount: number | null }

const cache = new Map<string, Promise<PdfPreview>>()
let workerConfigured = false

// pdfjs-dist é carregado sob demanda — evita empacotar/inicializar a lib
// (e seu worker) sempre que uma conversa abre, mesmo sem anexo de PDF.
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  if (!workerConfigured) {
    // eslint-disable-next-line import/no-unresolved
    const pdfWorkerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    workerConfigured = true
  }
  return pdfjs
}

/** Renderiza a primeira página do PDF como imagem (data URL) + conta de páginas. Cacheado por URL. */
export function getPdfPreview(url: string, maxWidth = 260): Promise<PdfPreview> {
  const cached = cache.get(url)
  if (cached) return cached
  const promise = renderPdfPreview(url, maxWidth)
  cache.set(url, promise)
  return promise
}

async function renderPdfPreview(url: string, maxWidth: number): Promise<PdfPreview> {
  try {
    const { getDocument } = await loadPdfjs()
    const pdf = await getDocument({ url }).promise
    const pageCount = pdf.numPages
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = maxWidth / baseViewport.width
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { thumbnail: null, pageCount }

    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    return { thumbnail: canvas.toDataURL('image/png'), pageCount }
  } catch (err) {
    console.error('Erro ao gerar prévia do PDF:', err)
    return { thumbnail: null, pageCount: null }
  }
}
