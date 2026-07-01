const cache = new Map<string, Promise<number | null>>()

/** Descobre o tamanho do arquivo via HEAD (Content-Length). Cacheado por URL; retorna null se falhar. */
export function getFileSize(url: string): Promise<number | null> {
  const cached = cache.get(url)
  if (cached) return cached
  const promise = fetchSize(url)
  cache.set(url, promise)
  return promise
}

async function fetchSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    const len = res.headers.get('content-length')
    return len ? parseInt(len, 10) : null
  } catch {
    return null
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
