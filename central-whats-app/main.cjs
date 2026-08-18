const { app, BrowserWindow, shell, ipcMain } = require('electron')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')
const path = require('path')
const fs = require('fs')
const os = require('os')

// Desabilita QUIC (HTTP/3): o Chromium interno tenta negociar QUIC por padrão
// e, quando o servidor/proxy de destino não responde bem, a conexão trava por
// vários segundos até falhar com "Failed to fetch" — mesmo com o servidor e a
// rede saudáveis. Um navegador comum cai para HTTP/1.1/2 de forma tolerante;
// o Electron precisa dessa flag explícita para o mesmo comportamento.
app.commandLine.appendSwitch('disable-quic')

const isDev = process.env.NODE_ENV === 'development'

autoUpdater.logger = log
autoUpdater.logger.transports.file.level = 'warn'
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = false

let mainWindow = null

function sendStatus(status) {
  if (mainWindow) mainWindow.webContents.send('update-status', status)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '../public/logo.png'),
    title: 'PRN Hub',
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:8080')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()

    if (!isDev) {
      const checkUpdates = () =>
        autoUpdater.checkForUpdates().catch((err) => {
          log.warn('Falha ao verificar atualizações:', err.message)
        })

      // Checa 4 segundos após abrir
      setTimeout(checkUpdates, 4000)

      // Recheca a cada 4 horas (para quem deixa o app aberto o dia todo)
      setInterval(checkUpdates, 4 * 60 * 60 * 1000)
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ── Eventos do auto-updater ────────────────────────────────────────────────────

autoUpdater.on('checking-for-update', () => {
  log.info('Verificando atualizações...')
  sendStatus({ type: 'checking' })
})

autoUpdater.on('update-not-available', () => {
  log.info('App já está na versão mais recente.')
  sendStatus({ type: 'up-to-date' })
})

autoUpdater.on('update-available', (info) => {
  log.info('Nova versão disponível:', info.version)
  sendStatus({ type: 'available', version: info.version })
})

autoUpdater.on('download-progress', (progress) => {
  const percent = Math.round(progress.percent)
  log.info(`Baixando atualização: ${percent}%`)
  if (mainWindow) mainWindow.setProgressBar(progress.percent / 100)
  sendStatus({ type: 'downloading', percent })
})

autoUpdater.on('update-downloaded', (info) => {
  log.info('Atualização baixada:', info.version)
  if (mainWindow) mainWindow.setProgressBar(-1)
  sendStatus({ type: 'ready', version: info.version })
})

autoUpdater.on('error', (err) => {
  log.error('Erro no auto-updater:', err.message)
  if (mainWindow) mainWindow.setProgressBar(-1)
  sendStatus({ type: 'error', message: err.message })
})

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.on('check-for-updates', () => {
  autoUpdater.checkForUpdates().catch((err) => {
    log.warn('Verificação manual falhou:', err.message)
    sendStatus({ type: 'error', message: err.message })
  })
})

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall(false, true)
})

ipcMain.on('focus-window', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// ── Proposta comercial em PDF ─────────────────────────────────────────────────

/**
 * Tamanho da página da proposta, em POLEGADAS.
 *
 * Os slides são 1440x810 px de CSS, e 1 px de CSS vale 1/96 de polegada:
 * 1440/96 = 15 e 810/96 = 8,4375.
 *
 * A unidade é polegada desde o Electron 21, quando o `printToPDF` passou a usar
 * o motor de impressão do Chromium. Passar micrômetros (a unidade antiga) não
 * gera um PDF errado — gera `Error: Printing failed`, sem dizer o porquê.
 */
const PAGINA_PROPOSTA = { width: 15, height: 8.4375 }

/**
 * Gera o PDF da proposta com o mesmo motor de sempre.
 *
 * O app Python chamava `chrome --headless --print-to-pdf`; aqui o Chromium já
 * está dentro do Electron, então o resultado é idêntico sem depender de o
 * Chrome estar instalado na máquina de quem usa.
 *
 * POR QUE ARQUIVO TEMPORÁRIO, E NÃO `data:` URL
 * O HTML passa de 1 MB e navegação de topo para `data:` é bloqueada pelo
 * Chromium. `loadFile` num temporário é o caminho que funciona sempre.
 *
 * A janela é criada sem `preload` e sem integração com Node de propósito: ela
 * só desenha um HTML que já veio pronto, e não deve poder falar com o app.
 */
ipcMain.handle('gerar-pdf-proposta', async (_evento, html) => {
  if (typeof html !== 'string' || !html) throw new Error('HTML da proposta vazio.')

  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'prn-proposta-')),
    'proposta.html',
  )
  await fs.promises.writeFile(tmp, html, 'utf-8')

  const janela = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, javascript: true },
  })

  try {
    await janela.loadFile(tmp)
    const pdf = await janela.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'none' },
      pageSize: PAGINA_PROPOSTA,
      // O `preferCSSPageSize` faria o Chromium seguir o `@page` do template. Não
      // usamos: o `@page` está em px, e a medida explícita acima é a que garante
      // o mesmo tamanho que o `--print-to-pdf` do Chrome entregava.
      preferCSSPageSize: false,
    })
    log.info(`Proposta gerada: ${(pdf.length / 1024 / 1024).toFixed(2)} MB`)
    return pdf
  } finally {
    if (!janela.isDestroyed()) janela.destroy()
    // Apaga a pasta temporária inteira; falhar aqui não pode derrubar a geração.
    fs.promises.rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => {})
  }
})

// ── Ciclo de vida do app ──────────────────────────────────────────────────────

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
