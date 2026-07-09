# Sistema de Auto-atualização — Desktop App

O Desktop App usa **electron-updater** para verificar, baixar e instalar atualizações automaticamente a partir dos GitHub Releases.

## Fluxo de Atualização

```
App inicia
    ↓
4 segundos (delay para estabilizar)
    ↓
autoUpdater.checkForUpdates()
    ↓
Consulta latest.yml no GitHub Releases
    ↓
Versão no latest.yml > versão instalada?
    ├── NÃO → evento "update-not-available" → app continua normalmente
    └── SIM → evento "update-available"
                ↓
         Download automático em background
                ↓
         Progresso via "download-progress" (barra de progresso na taskbar)
                ↓
         Evento "update-downloaded"
                ↓
         Usuário vê notificação "Atualização disponível"
                ↓
         Usuário clica "Instalar e reiniciar" (ou aguarda)
                ↓
         autoUpdater.quitAndInstall(false, true)
         (fecha app + instala + reabre automaticamente)
```

## Configuração no `main.cjs`

```javascript
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')

// Configuração do logger
autoUpdater.logger = log
autoUpdater.logger.transports.file.level = 'info'

// Baixa atualização automaticamente ao encontrar
autoUpdater.autoDownload = true

// Não instala sozinho ao fechar — aguarda confirmação do usuário
autoUpdater.autoInstallOnAppQuit = false
```

### Por que `autoInstallOnAppQuit = false`?

Com `true`, o app instalaria silenciosamente ao fechar, sem aviso. Com `false`, o app controla quando instalar via `install-update` IPC, permitindo mostrar uma notificação ao usuário antes.

## Eventos e Status

O processo principal emite eventos via IPC para o renderer React informar o usuário:

| Evento | Payload | Significado |
|---|---|---|
| `checking` | `{ type: 'checking' }` | Verificando se há atualização |
| `up-to-date` | `{ type: 'up-to-date' }` | Versão atual é a mais recente |
| `available` | `{ type: 'available', version: '0.0.142' }` | Nova versão encontrada, download iniciando |
| `downloading` | `{ type: 'downloading', percent: 45 }` | Download em progresso (%) |
| `ready` | `{ type: 'ready', version: '0.0.142' }` | Update baixado, pronto para instalar |
| `error` | `{ type: 'error', message: '...' }` | Falha no processo de atualização |

**Barra de progresso na taskbar:**

Durante o download, o Electron atualiza a barra de progresso nativa do Windows na taskbar:
```javascript
mainWindow.setProgressBar(progress.percent / 100)
// Ao finalizar:
mainWindow.setProgressBar(-1)  // Remove a barra
```

## Como o React Recebe os Status

O React escuta o canal `update-status` via `window.electronAPI`:

```typescript
useEffect(() => {
  // Disponível apenas no Desktop App
  if (!window.electronAPI) return

  window.electronAPI.onUpdateStatus((event, status) => {
    switch (status.type) {
      case 'available':
        toast.info(`Nova versão ${status.version} disponível`)
        break
      case 'downloading':
        setUpdateProgress(status.percent)
        break
      case 'ready':
        setShowInstallPrompt(true)
        break
      case 'error':
        console.error('Update error:', status.message)
        break
    }
  })
}, [])
```

## Verificação Manual

O usuário pode verificar manualmente atualizações:

```typescript
// Botão nas configurações
window.electronAPI?.checkForUpdates()
```

## Instalação

Ao usuário confirmar instalação:

```typescript
// Fecha app, instala, reabre
window.electronAPI?.installUpdate()
// Internamente: autoUpdater.quitAndInstall(false, true)
```

Parâmetros do `quitAndInstall(isSilent, isForceRunAfter)`:
- `isSilent = false` — mostra janela de instalação NSIS
- `isForceRunAfter = true` — reabre o app após instalar

## Source da Atualização

O electron-updater determina onde buscar atualizações pelo `builder.json`:

```json
{
  "publish": {
    "provider": "github",
    "owner": "samuelklausfischer-rgb",
    "repo": "Central-Whatsapp"
  }
}
```

Em produção, ele busca: `https://github.com/samuelklausfischer-rgb/Central-Whatsapp/releases/latest/download/latest.yml`

## Logs

Todos os eventos do auto-updater ficam registrados em:
- Windows: `%USERPROFILE%\AppData\Roaming\Central Whats\logs\main.log`

Útil para diagnosticar problemas de update em produção sem acessar o console da janela.

## Troubleshooting

### Update não é detectado
1. Verificar se o `latest.yml` está publicado no GitHub Release
2. Verificar se a versão no `package.json` foi incrementada
3. Verificar os logs em `main.log`

### Download falha
1. Verificar conexão com internet
2. Verificar se o `.exe` e `.blockmap` estão no Release do GitHub
3. Verificar se o Release não está como "draft" (deve ser publicado)

### App não abre após instalação
Verificar se `isForceRunAfter = true` está no `quitAndInstall`

### Erro `autoUpdater.checkForUpdates` em desenvolvimento
O auto-updater só funciona em builds de produção (empacotados). Em `NODE_ENV=development`, a verificação é suprimida automaticamente.
