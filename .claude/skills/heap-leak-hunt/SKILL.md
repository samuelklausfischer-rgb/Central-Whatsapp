---
name: heap-leak-hunt
description: Passo a passo para diferenciar vazamento real de memória (leak) de serrote normal de garbage collection no renderer do Central Whats, via diff de heap snapshot. Use quando a memória do processo renderer variar muito entre amostras (ex.: baseline mostrou 875MB→468MB→637MB em 60s parado).
---

# heap-leak-hunt

## Quando usar
Sempre que uma amostra de `Get-Process` (ver [[electron-perf-audit]]) mostrar working set do renderer oscilando fortemente mesmo em idle. Oscilação sozinha **não prova leak** — pode ser GC normal (serrote). Só heap snapshot diff prova.

## Passo a passo
1. Abrir DevTools do renderer (`Ctrl+Shift+I` na janela do app, ou `--remote-debugging-port` se headless).
2. Forçar GC manual antes de cada snapshot para eliminar lixo já coletável: rodar Electron/Chromium com `--js-flags="--expose-gc"` e chamar `gc()` no console, OU usar o botão "Collect garbage" da aba Memory.
3. **Snapshot A** (baseline, após GC forçado).
4. Executar a ação suspeita (ex.: abrir e fechar uma conversa, trocar de aparelho, deixar 5 min idle recebendo mensagens reais via Realtime).
5. Desfazer a ação (fechar a conversa, voltar ao estado inicial).
6. Forçar GC de novo.
7. **Snapshot B**.
8. Comparar B vs A no modo "Comparison" do DevTools — olhar **retained size** por constructor. Crescimento persistente em objetos que deveriam ter sido liberados (listeners, closures, arrays/Maps de mensagens) = leak real.
9. Detached DOM nodes: filtrar por "Detached" no snapshot — nós que saíram da árvore do documento mas continuam retidos (geralmente por listener ou closure esquecidos) são o sintoma clássico de leak em SPA React.

## Suspeitos prioritários neste projeto (ver Obsidian "Projetos/WhatsApp.md")
- Subscriptions Realtime do Supabase não desmontadas ao trocar de conversa/aparelho (`useRealtime` usa padrão latest-ref — checar se o cleanup do `useEffect` sempre roda).
- Cache de mensagens em `ChatHub.tsx` (dono de `messages`) que só cresce sem cap.
- Lista de mensagens sem virtualização (até 500 DOM nodes por conversa aberta) — não é leak, mas é retenção de DOM alta por design; documentar separado do leak hunting.

## Não fazer
Não rodar isso contra conversas de clientes reais sem autorização explícita — heap snapshots podem conter conteúdo de mensagens em texto claro na memória.
