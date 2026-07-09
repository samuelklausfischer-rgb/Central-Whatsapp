---
name: whatsapp-electron-context
description: Contexto arquitetural já conhecido do Central Whats (app Electron de atendimento WhatsApp) — carregue isso antes de investigar performance para não re-derivar do zero. Cobre estrutura de processos, stack, realtime e histórico de otimizações anteriores.
---

# whatsapp-electron-context

## O que é
SaaS multi-tenant de atendimento WhatsApp (RLS no Supabase). Frente ativa = app desktop Electron; versão web (Docker/Nginx/EasyPanel) está **descontinuada**, mantida só de contexto. Ambas compartilham o mesmo `src/` React — só os arquivos de empacotamento divergem.

## Localização
Repo: `Whatsapp/SITE/Central-Whats/` (github: samuelklausfischer-rgb/Central-Whatsapp). Trabalho de otimização acontece em worktree isolado: `.worktrees/perf-otimizacao-electron/` (branch `perf/otimizacao-electron`).

**Quarentena — nunca modificar nesta missão:** `Dockerfile`, `nginx.conf`, `docker/` (exclusivos da versão web descontinuada).

## Stack
React 19 + Vite 8 + TS + Tailwind + Shadcn/Radix. Supabase (Auth/Postgres/Realtime/Edge Functions/Storage). Evolution API (gateway WhatsApp, multi-instância). Electron 42.4.0 + electron-updater 6.8.9 + electron-log 5.4.4. 170 arquivos `.ts`/`.tsx` em `src/`.

## Processo Electron (central-whats-app/)
- `main.cjs`: uma única `BrowserWindow` (1400×900), `nodeIntegration:false` + `contextIsolation:true`, `show:false` até `ready-to-show`. Sem `webview`/`BrowserView` — single window, single renderer. Auto-updater já com log `'warn'`, checa 4s após abrir + a cada 4h (`setInterval` no processo main).
- `preload.cjs`: `contextBridge` minimalista (só update-related: focusWindow/getAppVersion/checkForUpdates/installUpdate/onUpdateStatus).
- Processos observados em produção: main, `gpu-process`, 2× `utility` (network/audio), `renderer`. Renderer é de longe o maior consumidor de memória (ver baseline).

## Arquitetura realtime/chat
`ChatHub.tsx` é o dono de `messages`, lista de conversas (RPC `get_conversation_summaries`) e das subscriptions. `ChatWindow.tsx` é "burro" (recebe `conversation.messages` por prop). `useRealtime` usa padrão *latest-ref* (`callbackRef.current = callback`) — não tem stale closure, não adicionar deps de estado ao useEffect (causaria churn de canal). Subscription de `messages` é GLOBAL de propósito (notificação multi-aparelho). ~10 canais WebSocket simultâneos com uma conversa aberta (era ~11 antes da otimização de 08/07).

## Histórico de otimização já feito (sessão 08/07/2026, v0.0.174)
Baseline informal relatado antes: ~2GB RAM / 7-14% CPU. 3 ajustes aplicados:
1. `ChatHub.tsx` adia fetch fallback de 2000 mensagens (só busca se RPC vier vazio/falhar).
2. Removida subscription Realtime duplicada de `conversation_assignments` em `ChatWindow.tsx`.
3. Log do auto-updater de `'info'` para `'warn'` em `main.cjs`.

**Alavanca de maior impacto identificada e AINDA NÃO feita:** virtualizar a lista de mensagens (até 500 DOM nodes por conversa aberta) — candidato a `@tanstack/react-virtual`, mas interage com a lógica de scroll `isNearBottomRef` (corrigida no mesmo dia) e foi propositalmente adiada para um ciclo próprio de design+teste. Esta missão é esse ciclo.

## Baseline confirmado nesta missão (09/07/2026)
Ver nota Obsidian "Projetos/WhatsApp - Otimização Electron/Baseline — Métricas Iniciais". Resumo: total ~1,1-1,5GB entre os 5 processos (melhora vs. os ~2GB de antes, mas ainda alto); renderer sozinho chega a ~875MB; CPU do renderer fica em ~27-53% de 1 core tanto idle-visível quanto minimizado — sinal de que trabalho contínuo roda independente de foco de janela.

## Regra de segurança de dados
Este app conecta em Supabase e Evolution API de **produção real**, usados por atendentes de verdade. Não existe staging. Qualquer teste que abra conversas reais, envie mensagens, ou rode heap snapshots deve ter autorização explícita do usuário — não presumir.
