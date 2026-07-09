# Arquitetura Electron — Desktop App

## Modelo de Processos do Electron

O Electron usa **dois processos separados** que se comunicam via IPC (Inter-Process Communication):

```
┌─────────────────────────────────────────────────────────────┐
│                    ELECTRON APP                              │
│                                                             │
│  ┌─────────────────────┐        ┌───────────────────────┐  │
│  │  Processo Principal  │        │  Processo Renderer    │  │
│  │   (main.cjs)        │◄──IPC──│  (React App)          │  │
│  │                     │        │                        │  │
│  │  - Cria a janela    │        │  - ChatHub, CRM, etc.  │  │
│  │  - Auto-updater     │        │  - UI React/TypeScript │  │
│  │  - IPC handlers     │        │  - Mesma lógica do     │  │
│  │  - Ciclo de vida    │        │    Web App             │  │
│  └──────────┬──────────┘        └──────────┬─────────────┘  │
│             │                              │                  │
│             │         preload.cjs          │                  │
│             └──────────────────────────────┘                  │
│                  (ponte segura Node ↔ React)                  │
└─────────────────────────────────────────────────────────────┘
```

## Processo Principal (`main.cjs`)

O processo principal (Node.js) controla o ciclo de vida da aplicação.

### Configuração da Janela

```javascript
new BrowserWindow({
  width: 1400,
  height: 900,
  minWidth: 960,
  minHeight: 600,
  webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'),
    nodeIntegration: false,    // Segurança: Node.js inacessível no renderer
    contextIsolation: true,    // Segurança: contextos isolados
  },
  title: 'Central Whats',
})
```

**Segurança:**
- `nodeIntegration: false` — o renderer (React) não tem acesso direto ao Node.js
- `contextIsolation: true` — o preload e o renderer têm contextos JavaScript separados
- Links externos abrem no navegador padrão do sistema (`shell.openExternal`)

### Carregamento da UI

| Modo | URL Carregada |
|---|---|
| Desenvolvimento (`NODE_ENV=development`) | `http://localhost:8080` (Vite dev server) |
| Produção | `dist/index.html` (build local empacotada) |

### IPC Handlers

O processo principal expõe as seguintes operações via IPC:

| Canal | Tipo | Descrição |
|---|---|---|
| `get-app-version` | `handle` (responde) | Retorna versão do app (`app.getVersion()`) |
| `check-for-updates` | `on` (evento) | Aciona verificação manual de atualização |
| `install-update` | `on` (evento) | Instala update baixado e reinicia |
| `focus-window` | `on` (evento) | Traz janela para frente se minimizada |

### Eventos de Ciclo de Vida

| Evento | Ação |
|---|---|
| `app.whenReady()` | Cria a janela principal |
| `window-all-closed` | Encerra o app (`app.quit()`) |
| `ready-to-show` | Mostra janela + inicia verificação de update (4s delay) |

---

## Script de Preload (`preload.cjs`)

O preload roda em um contexto intermediário — tem acesso ao Node.js mas é executado antes do renderer. Usa `contextBridge` para expor APIs seguras ao React.

**Propósito:** permitir que o React invoque ações do processo principal sem ter acesso direto ao Node.js.

**APIs expostas ao React (via `window.electronAPI`):**

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', callback),
  focusWindow: () => ipcRenderer.send('focus-window'),
})
```

**Como o React usa:**

```typescript
// Em qualquer componente React
const version = await window.electronAPI?.getAppVersion()
window.electronAPI?.onUpdateStatus((event, status) => {
  // status: { type: 'downloading', percent: 45 }
})
```

O uso de `window.electronAPI?.` (opcional chaining) garante que o código React também funcione no Web App — onde `electronAPI` não existe.

---

## Sistema de Logs

O `electron-log` persiste logs em arquivo no sistema do usuário:

| OS | Localização |
|---|---|
| Windows | `%USERPROFILE%\AppData\Roaming\Central Whats\logs\main.log` |

O auto-updater usa o mesmo logger: todos os eventos de verificação e download de update ficam registrados no arquivo de log.
