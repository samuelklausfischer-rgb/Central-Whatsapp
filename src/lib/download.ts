import { isNativeAndroid } from '@/lib/app-info'

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
