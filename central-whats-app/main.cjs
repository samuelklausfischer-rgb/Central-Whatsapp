const { app, BrowserWindow, shell, ipcMain } = require('electron')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')
const path = require('path')

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

// ── Ciclo de vida do app ──────────────────────────────────────────────────────

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
