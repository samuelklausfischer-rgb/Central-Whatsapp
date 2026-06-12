# Contexto do Projeto

## Objetivo

Frontend React/Vite para uma central de atendimento WhatsApp integrada ao Supabase e Evolution API.

## Arquitetura

```
Browser -> Frontend Docker/Nginx -> Supabase Auth/REST/Realtime/Edge Functions
                               -> Evolution API via Supabase Edge Functions
```

O frontend **não** chama a Evolution API diretamente. Operações sensíveis, como envio de mensagens, sincronização de instâncias e webhooks, passam pelas Edge Functions do Supabase.

## Stack

- React 19
- Vite
- TypeScript
- Tailwind CSS
- Shadcn UI / Radix UI
- Supabase JS
- Nginx para servir a build em produção

## Variáveis de Ambiente

Crie um `.env.local` para desenvolvimento local com base em `.env.example`:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sua_chave_aqui
```

No Dockerfile, as variáveis `VITE_*` possuem defaults de produção e também podem ser sobrescritas por build args. A build gera `/env-config.js` dentro da imagem com esses valores.

## Estrutura Principal

```
src/                  Frontend React
public/               Assets públicos e env-config.js base
supabase/functions/   Edge Functions Supabase
pocketbase/           Hooks/migrations legados do PocketBase
Dockerfile            Build e runtime Nginx do frontend
nginx.conf            Configuração SPA do Nginx
```

## Desenvolvimento Local

```bash
npm install
npm run dev
```

A aplicação roda em `http://localhost:8080` conforme `vite.config.ts`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run format
npm run preview
```

## Deploy no EasyPanel

1. Crie um novo app a partir do repositório GitHub.
2. Selecione deploy por `Dockerfile`.
3. Use porta interna `80`.
4. Faça rebuild da imagem. O Dockerfile já possui defaults de produção para:

| Variável | Obrigatória | Observação |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Sim | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Sim | Chave publishable/anon do Supabase |

Se o EasyPanel oferecer build args, você pode sobrescrever esses valores. Caso contrário, o rebuild usa os defaults do Dockerfile. Depois do rebuild, verifique `/env-config.js` no navegador e confirme que os valores não estão vazios.

## Backend e Funções

- `supabase/functions/` fica versionado no repositório, mas não entra na imagem Docker do frontend.
- `pocketbase/` fica versionado no repositório para histórico/hooks, mas não entra na imagem Docker do frontend.
- `evolution-api-mcp/` e ferramenta local de desenvolvimento e também não entra na imagem Docker.

As Edge Functions do Supabase devem ser publicadas separadamente pelo fluxo de Supabase CLI ou pelo painel do Supabase.
