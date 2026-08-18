/**
 * Gera o PDF da proposta com o MESMO caminho que o app usa (janela oculta do
 * Electron + printToPDF) e confere o resultado, sem abrir o app.
 *
 * Serve principalmente para pegar erro no `pageSize`: em polegadas o PDF sai
 * com 13 páginas; em pixels sai com o dobro, cada slide partido ao meio; em
 * micrômetros (a unidade antiga, de antes do Electron 21) o `printToPDF` falha
 * com um `Printing failed` que não explica nada.
 *
 * Uso:
 *   npm run conferir:proposta-pdf
 */

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const WORK = 'C:/Users/OPERACIONAL/Desktop/Projetos PRN/PROPOSTA PRN PDF/work'
const SAIDA = path.join(RAIZ, 'build-proposta')

// Precisa bater com o PAGINA_PROPOSTA de central-whats-app/main.cjs (polegadas).
const PAGINA_PROPOSTA = { width: 15, height: 8.4375 }
const PAGINAS_ESPERADAS = 13

/** Conta páginas sem dependência externa — mesmo truque do `_count_pages` do Python. */
const contarPaginas = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length

/** Confere se as fontes foram embutidas no PDF (senão o texto sai em fallback). */
const temPoppins = (buf) => buf.toString('latin1').includes('Poppins')

/**
 * O relatório vai para stdout E para um arquivo.
 *
 * Chamando o `electron.exe` direto no Windows o stdout não volta para o
 * terminal (pelo atalho `electron` do npm, volta). O arquivo garante que o
 * resultado apareça dos dois jeitos.
 */
const relatorio = []
const dizer = (t = '') => {
  relatorio.push(t)
  console.log(t)
}

app.commandLine.appendSwitch('disable-quic')

// Sem isto o Electron encerra sozinho assim que a janela oculta é destruída
// (comportamento padrão no Windows quando ninguém trata `window-all-closed`), e
// o script morre antes de gravar o PDF e o relatório. No app de verdade isso não
// acontece: `main.cjs` trata o evento e a janela principal segue aberta.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  let falhou = false
  try {
    const jsonCliente = process.argv[2] || path.join(WORK, 'dados/hospital-sao-donato.json')
    const html = await fs.promises.readFile(path.join(SAIDA, 'proposta.html'), 'utf-8').catch(() => {
      throw new Error('Rode antes: node scripts/conferir-proposta.mjs ' + jsonCliente)
    })

    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prn-proposta-')), 'proposta.html')
    await fs.promises.writeFile(tmp, html, 'utf-8')

    const janela = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    await janela.loadFile(tmp)
    const pdf = await janela.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'none' },
      pageSize: PAGINA_PROPOSTA,
      preferCSSPageSize: false,
    })
    janela.destroy()
    await fs.promises.rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => {})

    const destino = path.join(SAIDA, 'proposta.pdf')
    await fs.promises.writeFile(destino, pdf)

    const paginas = contarPaginas(pdf)
    const mb = (pdf.length / 1024 / 1024).toFixed(2)

    dizer(`\nPDF: ${destino}`)
    dizer(`Tamanho: ${mb} MB\n`)

    const checagens = [
      [`${PAGINAS_ESPERADAS} páginas`, paginas === PAGINAS_ESPERADAS, paginas],
      ['Poppins embutida', temPoppins(pdf), ''],
      ['PDF não vazio', pdf.length > 100_000, `${mb} MB`],
    ]
    for (const [rotulo, ok, detalhe] of checagens) {
      dizer(`  ${ok ? 'OK   ' : 'FALHA'} ${rotulo}${detalhe !== '' ? ` (${detalhe})` : ''}`)
      if (!ok) falhou = true
    }
    if (paginas === PAGINAS_ESPERADAS * 2) {
      dizer('\n  >> O dobro de páginas: o pageSize foi passado em pixels, não em polegadas.')
    }
    dizer(`\nSTATUS: ${falhou ? 'REVISAR' : 'OK'}\n`)
  } catch (e) {
    dizer('ERRO: ' + e.message)
    falhou = true
  }
  try {
    fs.mkdirSync(SAIDA, { recursive: true })
    fs.writeFileSync(path.join(SAIDA, 'relatorio-pdf.txt'), relatorio.join('\n'), 'utf-8')
  } catch {
    /* o relatório em arquivo é conveniência: não pode derrubar o script */
  }
  app.exit(falhou ? 1 : 0)
})
