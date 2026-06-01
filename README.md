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

As variaveis `VITE_*` tambem sao aceitas em runtime no container Docker. O script `docker/10-env-config.sh` gera `/env-config.js` quando o container inicia.

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

Run com variaveis em runtime:

```bash
docker run --rm -p 8080:80 \
  -e VITE_SUPABASE_URL=https://seu-projeto.supabase.co \
  -e VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sua_chave_aqui \
  central-whats
```

Abra `http://localhost:8080`.

## Deploy No EasyPanel

1. Crie um novo app a partir do repositorio GitHub.
2. Selecione deploy por `Dockerfile`.
3. Use porta interna `80`.
4. Configure as variaveis de ambiente:

| Variavel | Obrigatoria | Observacao |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Sim | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Sim | Chave publishable/anon do Supabase |

Essas variaveis podem ser configuradas como runtime environment variables no EasyPanel. Se o painel tambem oferecer build args, mantenha os mesmos nomes e valores.

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
docker/               Scripts de runtime do container
Dockerfile            Build e runtime Nginx do frontend
nginx.conf            Configuracao SPA do Nginx
```
