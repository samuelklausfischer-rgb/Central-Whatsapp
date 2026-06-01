# Central Whats

Frontend React/Vite para uma central de atendimento WhatsApp integrada ao Supabase e Evolution API.

## Arquitetura

```text
Browser -> Frontend Docker/Nginx -> Supabase Auth/REST/Realtime/Edge Functions
                               -> Evolution API via Supabase Edge Functions
```

O frontend nao chama a Evolution API diretamente. Operacoes sensiveis, como envio de mensagens, sincronizacao de instancias e webhooks, passam pelas Edge Functions do Supabase.

## Stack

- React 19
- Vite
- TypeScript
- Tailwind CSS
- Shadcn UI / Radix UI
- Supabase JS
- Nginx para servir a build em producao

## Variaveis De Ambiente

Crie um `.env.local` para desenvolvimento local com base em `.env.example`:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sua_chave_aqui
```

No Dockerfile, as variaveis `VITE_*` devem ser enviadas como build args. A build gera `/env-config.js` dentro da imagem com esses valores.

## Desenvolvimento Local

```bash
npm install
npm run dev
```

A aplicacao roda em `http://localhost:8080` conforme `vite.config.ts`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run format
npm run preview
```

## Docker Local

Build com variaveis em build time:

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://seu-projeto.supabase.co \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sua_chave_aqui \
  -t central-whats .
```

Run da imagem gerada:

```bash
docker run --rm -p 8080:80 central-whats
```

Abra `http://localhost:8080`.

## Deploy No EasyPanel

1. Crie um novo app a partir do repositorio GitHub.
2. Selecione deploy por `Dockerfile`.
3. Use porta interna `80`.
4. Configure as variaveis como build args:

| Variavel | Obrigatoria | Observacao |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Sim | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Sim | Chave publishable/anon do Supabase |

Essas variaveis precisam estar disponiveis durante o build da imagem. Depois do rebuild, verifique `/env-config.js` no navegador e confirme que os valores nao estao vazios.

## Backend E Funcoes

- `supabase/functions/` fica versionado no repositorio, mas nao entra na imagem Docker do frontend.
- `pocketbase/` fica versionado no repositorio para historico/hooks, mas nao entra na imagem Docker do frontend.
- `evolution-api-mcp/` e ferramenta local de desenvolvimento e tambem nao entra na imagem Docker.

As Edge Functions do Supabase devem ser publicadas separadamente pelo fluxo de Supabase CLI ou pelo painel do Supabase.

## Estrutura Principal

```text
src/                  Frontend React
public/               Assets publicos e env-config.js base
supabase/functions/   Edge Functions Supabase
pocketbase/           Hooks/migrations legados do PocketBase
Dockerfile            Build e runtime Nginx do frontend
nginx.conf            Configuracao SPA do Nginx
```
