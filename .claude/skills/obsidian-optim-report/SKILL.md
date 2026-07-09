---
name: obsidian-optim-report
description: Convenções e templates de nota no Obsidian para a missão de otimização do Central Whats Electron. Use ao escrever qualquer relatório de investigação, ranking, plano ou changelog desta missão, para manter estrutura e links consistentes entre agentes.
---

# obsidian-optim-report

## Onde escrever
Cofre: `C:\Users\OPERACIONAL\Desktop\Memoria 2\Memoria 2`. Todas as notas desta missão ficam em `Projetos/WhatsApp - Otimização Electron/`:
- `Índice.md` (MOC — visão geral, status por fase, links pra tudo)
- `Baseline — Métricas Iniciais.md` (Fase 0)
- `Investigação — Achados <Agente>.md` (uma por agente da Fase 1, ex. "Investigação — Achados A - Main e Ciclo de Vida.md")
- `Ranking de Causas.md` e `Backlog Priorizado.md` (Fase 2)
- `Plano Cirúrgico.md` (Fase 3, com status de aprovação por item)
- `Changelog de Mudanças.md` (Fase 4 — uma entrada por commit)
- `Validação — Antes vs Depois.md` (Fase 5)
- `Relatório Final.md` (Fase 6)

## Tags
`#otimizacao/electron`, `#fase/0` a `#fase/6`, `#risco/baixo` `#risco/medio` `#risco/alto`.

## Regra inegociável
**Toda métrica citada precisa ter número.** Nada de "melhorou bastante", "ficou mais leve" sem antes/depois numérico (MB, %CPU, ms). Todo achado de investigação precisa de arquivo:linha ou medição — nunca opinião solta.

## Template — nota de achado de investigador (Fase 1)
```
---
tags: [otimizacao/electron, fase/1, agente/<letra>]
---

# Investigação — Achados <Agente> — <Foco>

## Área e arquivos inspecionados
- <caminho exato>

## Achados
### <título curto>
- **O quê:** ...
- **Onde:** arquivo:linha
- **Evidência:** trecho de código ou número de medição
- **Hipótese de impacto:** Mem/CPU/GPU/Jank + magnitude estimada
- **Confiança:** alta/média/baixa
```

## Template — entrada de changelog (Fase 4)
```
### <item> — <data>
- **Arquivo(s):** ...
- **Antes → Depois:** <métrica> <valor1> → <valor2>
- **Commit:** <hash>
- **Risco:** 🟢/🟡/🔴
```

## Ao final de cada fase
Atualizar `Índice.md` com o status da fase e link para as notas novas. Não deixar a Índice desatualizada — é o ponto de entrada de qualquer sessão futura sobre esta missão.
