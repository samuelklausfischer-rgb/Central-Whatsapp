import { isNativeAndroid } from '@/lib/app-info'

/**
 * Categorias usadas só para escolher o nome padrão quando não há nome real
 * (ver `nomeParaDownload` abaixo). Não precisa bater com `ViewerMedia['type']`.
 */
export type TipoArquivoDownload = 'audio' | 'video' | 'imagem' | 'documento'

const NOME_PADRAO_POR_TIPO: Record<TipoArquivoDownload, string> = {
  audio: 'audio-whatsapp',
  video: 'video-whatsapp',
  imagem: 'imagem-whatsapp',
  documento: 'documento-whatsapp',
}

/**
 * O webhook (`supabase/functions/evolution-webhook` e `evolution-history-import`,
 * função `ensureExtension`) já grava um nome genérico quando o WhatsApp não manda
 * `fileName` — `audio_message.ogg`, `video_message.mp4` etc. Isso é comum: áudio e
 * vídeo do WhatsApp quase nunca trazem nome real, então NA PRÁTICA todo áudio já
 * chega ao front com esse mesmo nome. Sem tratar isso aqui, um baixado por cima do
 * outro (mesmo nome = mesmo arquivo no Electron, que agora salva sem perguntar).
 */
const NOME_GENERICO_WEBHOOK = /^(image|video|audio|document|sticker)_message\.[a-z0-9]+$/i

/** Carimbo de data/hora do clique (local), só dígitos — nunca colide entre dois downloads no mesmo segundo é impossível, mas ajuda a diferenciar de olho os arquivos salvos. */
function carimboDataHora(data = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${data.getFullYear()}${p(data.getMonth() + 1)}${p(data.getDate())}-${p(data.getHours())}${p(data.getMinutes())}${p(data.getSeconds())}`
}

/** Windows rejeita esses caracteres em nome de arquivo (o Android já sanitiza os dele em `sanitizarNome`, mais abaixo). */
function sanitizarNomeArquivo(nome: string): string {
  return nome.replace(/[\\/:*?"<>|]/g, '_').trim()
}

function extensaoDe(nome: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(nome)
  return m ? m[1] : ''
}

/** Extensões que denunciam o tipo quando o nome genérico não diz (raro, mas acontece em reenvio). */
const EXT_POR_TIPO: Record<string, TipoArquivoDownload> = {
  ogg: 'audio', opus: 'audio', mp3: 'audio', m4a: 'audio', wav: 'audio', aac: 'audio',
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video', '3gp': 'video',
  jpg: 'imagem', jpeg: 'imagem', png: 'imagem', gif: 'imagem', webp: 'imagem', bmp: 'imagem',
}

/**
 * Descobre a categoria a partir do próprio nome do arquivo.
 *
 * Existe porque nem todo ponto de download conhece o tipo da mídia: a lista de
 * seleção do `ChatWindow` carrega só `{ url, name }`. Mas justamente no caso em
 * que o nome padrão é necessário — o genérico do webhook — **o tipo está escrito
 * no nome** (`audio_message.ogg`, `video_message.mp4`…), então dá para deduzir
 * sem arrastar o mime por toda a cadeia. A extensão é a segunda tentativa, e
 * `documento` é o padrão seguro (nome genérico de documento não engana ninguém).
 */
export function tipoPeloNome(nome: string | null | undefined): TipoArquivoDownload {
  const bruto = (nome || '').trim().toLowerCase()

  const generico = /^(image|video|audio|document|sticker)_message\./.exec(bruto)
  if (generico) {
    const prefixo = generico[1]
    if (prefixo === 'audio') return 'audio'
    if (prefixo === 'video') return 'video'
    if (prefixo === 'image' || prefixo === 'sticker') return 'imagem'
    return 'documento'
  }

  return EXT_POR_TIPO[extensaoDe(bruto).toLowerCase()] ?? 'documento'
}

/**
 * Nome final para salvar um download.
 *
 * Preserva um nome real quando existir (não estraga nome bom). Quando não —
 * vazio, o fallback `'arquivo'` do MediaViewer, ou o genérico `*_message.*` que
 * o webhook grava por falta de nome real — usa nome padrão por tipo + carimbo
 * de data/hora do clique, para nunca sobrescrever um download anterior.
 */
export function nomeParaDownload(nomeOriginal: string | null | undefined, tipo: TipoArquivoDownload): string {
  const bruto = (nomeOriginal || '').trim()
  const generico = !bruto || bruto.toLowerCase() === 'arquivo' || NOME_GENERICO_WEBHOOK.test(bruto)

  if (!generico) return sanitizarNomeArquivo(bruto)

  const ext = extensaoDe(bruto)
  const base = `${NOME_PADRAO_POR_TIPO[tipo]}-${carimboDataHora()}`
  return sanitizarNomeArquivo(ext ? `${base}.${ext}` : base)
}

/**
 * Baixa um arquivo (mídia/documento) forçando download local.
 * Faz fetch + blob para baixar de fato; se falhar (CORS/offline), abre em nova aba.
 *
 * NO ANDROID o caminho é outro. O atributo `download` de `<a>` é IGNORADO pelo
 * WebView: o clique não faz nada e o atendente fica achando que o app travou.
 * Lá o arquivo é gravado em disco e entregue pela folha de compartilhamento do
 * sistema ("abrir com / salvar em"), que é o comportamento que a pessoa já
 * conhece do próprio WhatsApp.
 */
export async function downloadFile(url: string, filename: string) {
  if (isNativeAndroid()) {
    const ok = await baixarNoAndroid(url, filename)
    if (ok) return
    // Não conseguiu gravar: abrir no navegador do sistema ainda permite salvar.
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/**
 * Acima disto o arquivo NÃO passa por base64 na memória.
 *
 * O Filesystem do Capacitor recebe o conteúdo como base64, que incha ~33% e vive
 * como string no heap do WebView. Um vídeo grande viraria centenas de MB de
 * string e derrubaria o app no celular. Acima do teto, a URL vai para o
 * navegador do sistema, que baixa em streaming.
 */
const TETO_BASE64 = 40 * 1024 * 1024

async function baixarNoAndroid(url: string, filename: string): Promise<boolean> {
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])

    const res = await fetch(url)
    if (!res.ok) return false
    const blob = await res.blob()
    if (blob.size > TETO_BASE64) return false

    const base64 = await blobParaBase64(blob)

    // `Cache`: gravar direto em Downloads exige permissão de armazenamento e
    // MediaStore no Android 10+. O arquivo vai para a área do app, e é a folha
    // de compartilhamento que leva ele para onde a pessoa quiser.
    const escrito = await Filesystem.writeFile({
      path: sanitizarNome(filename),
      data: base64,
      directory: Directory.Cache,
    })

    await Share.share({ title: filename, url: escrito.uri })
    return true
  } catch {
    return false
  }
}

function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onerror = () => reject(leitor.error)
    leitor.onload = () => {
      const resultado = String(leitor.result || '')
      // `readAsDataURL` devolve `data:<mime>;base64,<conteudo>`; o plugin quer
      // só o conteúdo.
      const virgula = resultado.indexOf(',')
      resolve(virgula >= 0 ? resultado.slice(virgula + 1) : resultado)
    }
    leitor.readAsDataURL(blob)
  })
}

/** Nome vindo do WhatsApp pode ter barra e dois-pontos, que o Android rejeita. */
function sanitizarNome(nome: string): string {
  const limpo = nome.replace(/[/\\:*?"<>|]/g, '_').trim()
  return limpo || 'arquivo'
}
