---
name: electron-perf-audit
description: Metodologia canônica de medição de performance (memória/CPU/GPU/jank) para o app Electron Central Whats. Use antes de reportar qualquer achado de consumo/lentidão nesta missão de otimização, para que todos os investigadores meçam do mesmo jeito e todo achado tenha número, não opinião.
---

# electron-perf-audit

## Regra de ouro
Todo achado de performance precisa de **evidência**: trecho de código (arquivo:linha) OU número de medição. "Parece pesado" não é achado.

## Como medir cada camada

**Nível processo (sem tocar em UI, seguro para dados de produção):**
- `Get-Process 'Central Whats'` (PowerShell) lista os processos do app: main (sem `--type=`), `--type=gpu-process`, `--type=renderer`, `--type=utility` (network/audio). Use `Get-CimInstance Win32_Process -Filter "Name='Central Whats.exe'"` para pegar `CommandLine` e distinguir o papel de cada PID.
- Memória: `WorkingSet64` (working set atual) — some por role. `WorkingSet64/1MB` para MB.
- CPU: `Process.CPU` é tempo total acumulado (segundos) desde o início do processo, não %. Para % real, tire 2 amostras com um intervalo de tempo conhecido e calcule `(CPU_t2 - CPU_t1) / intervalo_segundos` → fração de 1 core. Divida por núcleos totais (`(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors`) se quiser % do sistema todo.
- **NUNCA** rode `Get-Process` sem filtrar pelo nome do processo do app-alvo — não colete métricas de outros apps do usuário (ex.: Obsidian, que também é Electron).

**Nível renderer (requer DevTools, mais invasivo — só com autorização explícita para cenários que tocam dados reais):**
- Performance tab: gravar sessão, procurar long tasks e jank.
- Memory tab: heap snapshots — ver skill [[heap-leak-hunt]].
- Rendering tab: paint flashing, layer borders (GPU/composição).

**Análise estática (barata, paralela, sempre segura):**
- `grep`/`Grep` por `setInterval`/`setTimeout`, `addEventListener` sem `removeEventListener` correspondente, `new Worker`, `canvas`, `WebGL`, subscriptions Realtime do Supabase (`.channel(`, `.subscribe(`).
- Auditar `webPreferences` em `central-whats-app/main.cjs` (ex.: `backgroundThrottling` ausente = default `true`, mas nem sempre suficiente — ver achado de baseline abaixo).
- Bundle: `vite build` com `--mode analyze` ou source-map-explorer se precisar auditar tamanho.

## Cenários mínimos de baseline (mission scenarios)
Cold start · idle (parado, focado) · **minimizado/background** (crucial — testar se `backgroundThrottling` realmente reduz CPU) · uso ativo (só com autorização, evitar tocar em conversas de clientes reais) · múltiplas contas (se aplicável).

## Achado de baseline já confirmado (09/07/2026, ver nota Obsidian "Baseline — Métricas Iniciais")
Renderer mantém CPU alta (~27-53% de 1 core) tanto **idle-visível** quanto **minimizado** — não há queda significativa ao minimizar. Isso é um sinal forte de que ou (a) `backgroundThrottling` não está mitigando o trabalho relevante (ex.: WebSocket/Realtime não é afetado por throttling de timers), ou (b) há polling/timer rodando fora do throttle padrão do Chromium. Qualquer investigador de CPU/Timers deve tentar confirmar a causa raiz com evidência de código, não só repetir a medição.

## Regra de escopo
Meça **somente processos do Central Whats**. Nunca meça, abra DevTools, ou colete métricas de outros aplicativos do usuário.
