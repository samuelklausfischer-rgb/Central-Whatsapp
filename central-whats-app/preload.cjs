const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  focusWindow: () => ipcRenderer.send('focus-window'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
  /**
   * Gera o PDF da proposta comercial e devolve os bytes.
   *
   * O `Buffer` do processo principal chega aqui como `Uint8Array` — quem chama
   * monta um `Blob` para baixar. Ver o handler em `main.cjs`.
   */
  gerarPdfProposta: (html) => ipcRenderer.invoke('gerar-pdf-proposta', html),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },
})
