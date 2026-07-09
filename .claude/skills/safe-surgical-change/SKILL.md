---
name: safe-surgical-change
description: Protocolo obrigatório para aplicar QUALQUER mudança de código durante a Fase 4 (Implementação Cirúrgica) da missão de otimização do Central Whats Electron. Use antes de editar código de performance neste projeto — garante que cada mudança seja isolada, medida e reversível.
---

# safe-surgical-change

## Protocolo (loop, 1 mudança por vez)

1. **Confirmar branch e árvore limpa.** Deve estar em `perf/otimizacao-electron` (worktree isolado em `.worktrees/perf-otimizacao-electron`), sem alterações pendentes de uma mudança anterior não commitada.
2. **Aplicar UMA mudança do plano aprovado** — a menor possível. Nunca combinar duas otimizações no mesmo commit, mesmo que relacionadas.
3. **Rodar smoke test / checagem de regressão** específica daquele item (definida no Plano Cirúrgico da Fase 3).
4. **Medir** o recurso alvo com a metodologia de [[electron-perf-audit]] e comparar com o baseline.
5. **Commit atômico**: `perf: <item> — <efeito medido>` (ex.: `perf: throttle scroll listener ChatWindow — CPU idle 53%→12% de 1 core`).
6. **Registrar no changelog do Obsidian** (nota "Changelog de Mudanças"): o que mudou, número antes/depois, commit hash.
7. **Gate por risco:** itens 🟡/🔴 (risco médio/alto) — parar e reportar ao usuário antes de seguir para o próximo item. Itens 🟢 (risco baixo) podem encadear, mas sempre 1 commit por vez.

## Se algo piorar
Métrica piorou, teste quebrou, ou comportamento mudou de forma inesperada → **revert imediato** do commit (`git revert`, nunca `git reset --hard` de um commit já compartilhado). Reportar o que aconteceu. Não tentar "consertar por cima" do que já foi revertido.

## O que NÃO fazer
- Não reescrever lógica de negócio que já funciona.
- Não mexer nos arquivos de quarentena da versão web (`Dockerfile`, `nginx.conf`, `docker/`).
- Não fazer mudança que altere comportamento observável pelo usuário sem aprovação explícita separada (isso deixa de ser "cirúrgico").
