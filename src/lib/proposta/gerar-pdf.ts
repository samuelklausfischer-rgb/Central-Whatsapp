/**
 * Como a proposta vira PDF em cada plataforma.
 *
 * NO APP INSTALADO (Electron) — caminho principal
 * O processo principal imprime o HTML numa janela oculta com o Chromium que já
 * vem embutido. É o mesmo motor que o `build.py` usava via
 * `chrome --headless --print-to-pdf`, então o PDF sai idêntico ao de hoje: 13
 * páginas de 1440x810, fundos, sombras e Poppins embutida. O arquivo baixa
 * direto, com o nome certo, sem caixa de diálogo.
 *
 * NA WEB E NO ANDROID — alternativa
 * Não há como imprimir sem o usuário: sobra abrir a caixa de impressão do
 * navegador num iframe e pedir "Salvar como PDF". O `@page` de 1440x810 está no
 * template, então o tamanho vem certo — mas quem escolhe o nome e o destino do
 * arquivo é a pessoa, e margens/escala dependem do que ela marcar.
 */

import { getAppPlatform } from '@/lib/app-info'

interface PonteElectron {
  gerarPdfProposta?: (html: string) => Promise<Uint8Array>
}

const ponte = (): PonteElectron | undefined => (window as unknown as { electronAPI?: PonteElectron }).electronAPI

/** `true` quando dá para gerar o PDF sem passar pela caixa de impressão. */
export function temGeracaoDireta(): boolean {
  return getAppPlatform() === 'app' && typeof ponte()?.gerarPdfProposta === 'function'
}

/** Os bytes do PDF. Só no Electron — checar `temGeracaoDireta()` antes. */
export async function gerarPdf(html: string): Promise<Blob> {
  const api = ponte()
  if (!api?.gerarPdfProposta) {
    throw new Error('Geração direta de PDF indisponível nesta versão do app.')
  }
  const bytes = await api.gerarPdfProposta(html)
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
}

/**
 * Abre a caixa de impressão do navegador com a proposta montada.
 *
 * O iframe é criado fora da tela e removido depois. `srcdoc` (em vez de
 * `src="blob:"`) mantém tudo no mesmo documento, o que evita o bloqueio de
 * `print()` entre origens diferentes.
 *
 * Resolve quando a caixa fecha — no Chrome o `print()` é síncrono e só retorna
 * depois disso; ainda assim há um `setTimeout` de segurança para o iframe nunca
 * ficar preso no DOM se algum navegador se comportar de outro jeito.
 */
export function imprimir(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1440px;height:810px;border:0;'
    iframe.srcdoc = html

    let encerrado = false
    const encerrar = () => {
      if (encerrado) return
      encerrado = true
      iframe.remove()
      resolve()
    }

    iframe.onload = () => {
      try {
        const janela = iframe.contentWindow
        if (!janela) throw new Error('Não consegui montar a proposta para impressão.')
        janela.focus()
        janela.print()
        // Só remove depois de um respiro: em alguns navegadores o `print()`
        // volta antes da caixa aparecer, e tirar o iframe cedo cancela tudo.
        setTimeout(encerrar, 1000)
      } catch (e) {
        iframe.remove()
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    iframe.onerror = () => {
      iframe.remove()
      reject(new Error('Não consegui montar a proposta para impressão.'))
    }

    document.body.appendChild(iframe)
  })
}

/** Baixa um Blob com o nome dado, liberando a URL temporária depois. */
export function baixarBlob(blob: Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  a.click()
  // Revogar na hora cancelaria o download em navegadores que só o iniciam no
  // próximo tick.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
