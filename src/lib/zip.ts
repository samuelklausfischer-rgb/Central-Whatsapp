import { zipSync } from 'fflate'
import { isNativeAndroid } from '@/lib/app-info'
import { salvarBlob, TETO_BASE64 } from '@/lib/download'

/** Devolve um nome que ainda não foi usado: `foto.jpg` → `foto-2.jpg`, `foto-3.jpg`… */
function nomeUnico(nome: string, usados: Set<string>): string {
  // Comparação sem diferenciar maiúsculas: Windows/macOS tratam `Foto.jpg` e
  // `foto.jpg` como o mesmo arquivo ao extrair.
  if (!usados.has(nome.toLowerCase())) {
    usados.add(nome.toLowerCase())
    return nome
  }
  const ponto = nome.lastIndexOf('.')
  const base = ponto > 0 ? nome.slice(0, ponto) : nome
  const ext = ponto > 0 ? nome.slice(ponto) : ''
  for (let n = 2; ; n++) {
    const candidato = `${base}-${n}${ext}`
    if (!usados.has(candidato.toLowerCase())) {
      usados.add(candidato.toLowerCase())
      return candidato
    }
  }
}

/** Erro de tamanho: precisa escapar do `try` por item, senão viraria "falha de um arquivo". */
class AlbumGrandeDemais extends Error {
  constructor() {
    super('Álbum grande demais para baixar de uma vez no celular')
  }
}

/**
 * Baixa cada URL, monta um .zip e o salva.
 *
 * - Nível 0 (só armazena): fotos e vídeos já vêm comprimidos; recomprimir gasta
 *   CPU e memória sem diminuir o arquivo.
 * - Uma URL que falha (CORS, 404, rede) NÃO derruba as outras: o zip sai com o
 *   que deu e o retorno diz quantos entraram (`baixados` de `total`), para quem
 *   chamou avisar a pessoa.
 * - Se nenhum arquivo foi baixado lança erro — um zip vazio seria pior que nada.
 * - Baixa em sequência, e não em `Promise.all`: dezenas de fotos em paralelo
 *   estouram a memória do celular e o limite de conexões do navegador.
 * - No Android o `salvarBlob` recusa blob acima de `TETO_BASE64` (o base64 do
 *   compartilhamento derruba o WebView). Por isso o tamanho é somado durante o
 *   download e a operação para ASSIM QUE passa do teto, em vez de baixar tudo
 *   para só falhar no fim. `content-length` (quando o servidor manda) barra
 *   antes mesmo de baixar o corpo.
 * - `signal`: quem chamou (o visualizador, ao fechar) pode abortar. Aborta o
 *   fetch em curso, para o laço e NÃO salva nada — lança `AbortError`.
 */
export async function baixarComoZip(
  itens: { url: string; nome: string }[],
  nomeDoZip: string,
  signal?: AbortSignal,
): Promise<{ baixados: number; total: number }> {
  const arquivos: Record<string, Uint8Array> = {}
  const usados = new Set<string>()
  let baixados = 0
  let somaBytes = 0
  const android = isNativeAndroid()
  // Folga de 1 MB: o zip é um pouco maior que a soma dos arquivos (cabeçalhos).
  const teto = TETO_BASE64 - 1024 * 1024

  for (const item of itens) {
    if (signal?.aborted) throw new DOMException('Download cancelado', 'AbortError')
    try {
      const res = await fetch(item.url, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (android) {
        const anunciado = Number(res.headers.get('content-length'))
        if (anunciado > 0 && somaBytes + anunciado > teto) {
          void res.body?.cancel()
          throw new AlbumGrandeDemais()
        }
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      somaBytes += bytes.byteLength
      if (android && somaBytes > teto) throw new AlbumGrandeDemais()
      arquivos[nomeUnico(item.nome, usados)] = bytes
      baixados++
    } catch (err) {
      if (err instanceof AlbumGrandeDemais) throw err
      // Abortar não é "falha de um arquivo": tem que interromper tudo.
      if (signal?.aborted) throw new DOMException('Download cancelado', 'AbortError')
      // Segue para o próximo; a contagem final registra a falha.
    }
  }

  if (signal?.aborted) throw new DOMException('Download cancelado', 'AbortError')
  if (baixados === 0) throw new Error('Não foi possível baixar nenhum arquivo')

  const zip = zipSync(arquivos, { level: 0 })
  // Direto, sem `new Uint8Array(zip)`: copiar dobraria o pico de memória (o zip
  // inteiro existiria duas vezes) exatamente no ponto mais pesado.
  const blob = new Blob([zip as BlobPart], { type: 'application/zip' })
  const nomeFinal = /\.zip$/i.test(nomeDoZip) ? nomeDoZip : `${nomeDoZip}.zip`
  const salvo = await salvarBlob(blob, nomeFinal)
  if (!salvo) throw new Error('Não foi possível salvar o arquivo .zip')

  return { baixados, total: itens.length }
}
