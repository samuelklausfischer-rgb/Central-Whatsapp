# Build e Distribuição — Desktop App

## Pré-requisitos

- Node.js 20+ instalado
- Conta no GitHub com acesso ao repositório `samuelklausfischer-rgb/Central-Whatsapp`
- `GH_TOKEN` configurado (para publicação automática no GitHub Releases)

## Processo de Build

O build do Desktop App é composto de **3 etapas** executadas sequencialmente:

```
1. vite build --base ./       →  Gera dist/ (build React com paths relativos)
2. node create-icon.cjs       →  Gera icon.ico a partir de logo.png
3. electron-builder           →  Empacota e gera instalador .exe
```

### Build Local (sem publicar)

```bash
npm run build:electron
```

Output gerado em `central-whats-app/release/`:
```
release/
├── Central Whats Setup 0.0.141.exe     # Instalador NSIS
├── Central Whats Setup 0.0.141.exe.blockmap
└── latest.yml                           # Manifest para auto-updater
```

### Build + Publicar no GitHub Releases

```bash
npm run publish:electron
```

O script `publish:electron` faz adicionalmente:
1. `node central-whats-app/create-tag.cjs` — cria tag Git `v0.0.141` automaticamente
2. `electron-builder --publish always` — faz upload do `.exe` e `latest.yml` para o GitHub Release

**Variável de ambiente necessária:**
```bash
export GH_TOKEN=ghp_seu_token_aqui  # Token GitHub com permissão de repo
```

No Windows (PowerShell):
```powershell
$env:GH_TOKEN = "ghp_seu_token_aqui"
npm run publish:electron
```

## Configuração do Instalador (builder.json)

```json
{
  "appId": "com.centralwhats.app",
  "productName": "Central Whats",
  "copyright": "© 2025 Central Whats",

  "directories": {
    "output": "central-whats-app/release"
  },

  "files": [
    "dist/**/*",
    "central-whats-app/main.cjs",
    "central-whats-app/preload.cjs",
    "public/logo.png"
  ],

  "publish": {
    "provider": "github",
    "owner": "samuelklausfischer-rgb",
    "repo": "Central-Whatsapp",
    "releaseType": "release"
  },

  "win": {
    "target": "nsis",
    "icon": "central-whats-app/icon.png"
  },

  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Central Whats"
  }
}
```

### O que é incluído no instalador

Apenas os arquivos listados em `files` entram no pacote:
- `dist/**/*` — build React (assets, JS, CSS)
- `central-whats-app/main.cjs` — processo principal Electron
- `central-whats-app/preload.cjs` — script de preload
- `public/logo.png` — ícone da janela

**O que NÃO entra:** `node_modules/`, `src/`, `supabase/`, `pocketbase/`, `.env*`, código-fonte TypeScript.

## Versionamento

A versão do app é definida no campo `"version"` do `package.json`. O `create-tag.cjs` lê essa versão e cria a tag Git correspondente (`v0.0.141`).

### Incrementar versão antes de publicar

Edite `package.json`:
```json
{
  "version": "0.0.142"
}
```

Depois execute `npm run publish:electron` — a nova versão será detectada pelos clientes com auto-update instalado.

## GitHub Releases

Após `npm run publish:electron`, o GitHub Release conterá:

```
v0.0.141
├── Central Whats Setup 0.0.141.exe          # Instalador para usuários
├── Central Whats Setup 0.0.141.exe.blockmap # Para delta updates
└── latest.yml                               # Metadata para auto-updater
```

O `latest.yml` é o arquivo crítico para o auto-updater — ele contém a versão mais recente, hash SHA512 e URL de download.

## Distribuição para Usuários

Após a publicação no GitHub Releases:

1. Usuário baixa `Central Whats Setup X.X.X.exe` da página de Releases
2. Executa o instalador (interface NSIS com escolha de pasta)
3. App aparece na área de trabalho e menu iniciar como "Central Whats"
4. Na primeira abertura, o app verifica atualizações automaticamente

## Troubleshooting de Build

### Erro: `GH_TOKEN não definido`
Configure a variável de ambiente antes de executar `publish:electron`.

### Erro: `icon.ico not found`
Execute `node central-whats-app/create-icon.cjs` manualmente antes do build, ou verifique se `logo.png` existe em `public/`.

### Instalador não detecta nova versão
Verifique se o `version` no `package.json` foi incrementado antes do build.

### Build lento / travado em `electron-builder`
O electron-builder precisa baixar o binário do Electron na primeira execução. Pode levar alguns minutos dependendo da conexão.
