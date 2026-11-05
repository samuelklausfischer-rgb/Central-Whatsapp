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

No Dockerfile, a URL do Supabase e as URLs públicas dos apps têm defaults de produção. O `/env-config.js` é gerado na SUBIDA do container (`docker-entrypoint.d/40-config.sh`) a partir das variáveis do serviço; a chave anon (`VITE_SUPABASE_PUBLISHABLE_KEY`) não tem default e precisa estar no Environment do EasyPanel.

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
4. Cadastre as variáveis abaixo no Environment do serviço e faça deploy. O Dockerfile tem default só para as URLs:

| Variável | Obrigatória | Observação |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Sim | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Sim | Chave publishable/anon do Supabase |

As variáveis são lidas em runtime (sem rebuild para trocar a chave). Se `VITE_SUPABASE_PUBLISHABLE_KEY` faltar, o log do container mostra `[40-config] ERRO`. Depois do deploy, verifique `/env-config.js` no navegador e confirme que os valores não estão vazios.

## Backend e Funções

- `supabase/functions/` fica versionado no repositório, mas não entra na imagem Docker do frontend.
- `pocketbase/` fica versionado no repositório para histórico/hooks, mas não entra na imagem Docker do frontend.
- `evolution-api-mcp/` e ferramenta local de desenvolvimento e também não entra na imagem Docker.

As Edge Functions do Supabase devem ser publicadas separadamente pelo fluxo de Supabase CLI ou pelo painel do Supabase.
