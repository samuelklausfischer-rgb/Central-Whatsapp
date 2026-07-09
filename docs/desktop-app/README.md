# Desktop App — Central Whats

Versão desktop do Central Whats construída com **Electron**, empacotada como instalador Windows (`.exe`).

## O Que É

O Desktop App é o mesmo frontend React do Web App, porém executado dentro de uma janela nativa do Windows via Electron. As duas aplicações compartilham 100% do código React — a diferença está no ambiente de execução e na distribuição.

| | Web App | Desktop App |
|---|---|---|
| **Execução** | Navegador via Docker/Nginx | Janela nativa via Electron |
| **Distribuição** | URL (EasyPanel/Cloud) | Instalador `.exe` (GitHub Releases) |
| **Atualizações** | Imediatas (ao recarregar) | Auto-update integrado |
| **Offline** | Não | Parcial (cache de assets) |
| **Acesso** | Qualquer browser | Windows instalado |

## Arquivos do Desktop App

```
central-whats-app/
├── main.cjs          # Processo principal do Electron (Node.js)
├── preload.cjs       # Script de preload (ponte Node.js ↔ React)
├── builder.json      # Configuração do electron-builder
├── create-icon.cjs   # Gera icon.ico a partir de logo.png
├── create-tag.cjs    # Cria tag Git para versionamento
├── icon.png          # Ícone da aplicação
└── release/          # Output dos instaladores (gerado pelo build)
```

## Stack

| Tecnologia | Versão | Uso |
|---|---|---|
| Electron | 42.4.0 | Runtime desktop |
| electron-builder | 26.15.3 | Empacotamento e instalador |
| electron-updater | 6.8.9 | Sistema de auto-atualização |
| electron-log | 5.4.4 | Logging persistente |

## Documentação Detalhada

- [Arquitetura Electron](./arquitetura-electron.md) — Como o Electron funciona neste projeto
- [Build e Distribuição](./build-e-distribuicao.md) — Como compilar e publicar
- [Auto-atualização](./auto-atualizacao.md) — Sistema de update automático

## Início Rápido (Desenvolvimento)

```bash
# Instalar dependências
npm install

# Rodar em modo desenvolvimento (Vite + Electron simultâneos)
npm run dev:electron
```

O comando `dev:electron`:
1. Inicia o Vite dev server em `http://localhost:8080`
2. Aguarda o servidor estar disponível (`wait-on`)
3. Abre a janela Electron apontando para `localhost:8080`

Qualquer mudança no código React recarrega automaticamente a janela Electron (Hot Module Replacement).

## Scripts

```bash
npm run dev:electron       # Desenvolvimento com Electron
npm run build:electron     # Build de produção + instalador Windows
npm run publish:electron   # Build + tag + publicar no GitHub Releases
```

## Configuração do App (builder.json)

```json
{
  "appId": "com.centralwhats.app",
  "productName": "Central Whats",
  "publish": {
    "provider": "github",
    "owner": "samuelklausfischer-rgb",
    "repo": "Central-Whatsapp"
  },
  "win": {
    "target": "nsis"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true
  }
}
```

O instalador Windows (`nsis`) permite ao usuário escolher a pasta de instalação e cria atalhos na área de trabalho e menu iniciar.

## Versão Atual

`0.0.141` — sincronizada com `package.json`. A versão é usada pelo sistema de auto-atualização.
