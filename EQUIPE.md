# EQUIPE — como várias janelas de contexto trabalham nesta pasta

Esta pasta é um **worktree compartilhado**: várias janelas do Claude Code trabalham aqui ao
mesmo tempo, cada uma na sua área. O git não avisa quando duas sessões editam o mesmo arquivo —
uma simplesmente sobrescreve a outra. Este documento é o que evita isso.

Criado em 26/08/2026.

## Onde estamos

| | |
| --- | --- |
| Repositório | `C:\Users\OPERACIONAL\Desktop\Projetos PRN\Central-Whatsapp` |
| Worktree | `.worktrees/equipe` ← **você está aqui** |
| Branch | `equipe/2026-08` (criado de `main` em `b2303b6`, v0.0.215) |
| Cópia principal | `Central-Whatsapp/` na raiz, em `main`, limpa — não trabalhe lá |
| Remote | `samuelklausfischer-rgb/Central-Whatsapp` |

### Pastas que NÃO são o app

Existem cópias antigas do Central Whats no disco. Se a sua sessão abriu em uma delas, você está
no lugar errado:

- `Projetos PRN\Whatsapp` — outro repositório git. Só rastreia `manutencao-*` e um HTML, e o
  `.gitignore` dele exclui `Central-Whats/`. **Não contém o app.**
- `Projetos PRN\Whatsapp\SITE\Central-Whats` — cópia morta, parada na v0.0.204 (`37e2d2d`),
  onze versões atrás. Pendência: aposentar essa pasta.

Confirmação rápida de que você está no lugar certo:

```bash
git rev-parse --abbrev-ref HEAD   # deve responder: equipe/2026-08
```

## Donos por área

Cada área tem uma janela dona. **Edite só os arquivos da sua área.**

| Área | Arquivos |
| --- | --- |
| **Emails** | `src/components/email/**`, `src/pages/EmailHub.tsx`, `src/pages/settings/EmailAccountSettings.tsx`, `src/services/email_*.ts`, `src/lib/supabase/email-types.ts`, `supabase/functions/email-send/**`, migrations `*email*` |
| **Notificações** | `src/components/notificacoes/**`, `src/components/NotificationsDialog.tsx`, `src/hooks/use-notificacoes.ts`, `src/hooks/use-notificacoes-de-mensagem.ts`, `src/lib/notificacao-do-sistema.ts`, `src/services/notificacoes.ts`, `src/stores/notificacoes.ts`, `supabase/migrations/*_notificacoes.sql` |
| **Correção de bugs** | ✅ **Terminada e liberada.** `src/pages/ChatHub.tsx`, `src/services/conversation_states.ts` e `src/components/chat/ChatWindow.tsx` — commits `901d683` (não lida entre usuários) e `ea0d578` (Pegar/Finalizar na lista, + migration que restaura `global_read_at`). Não encosto mais nesses arquivos. |
| **Controle de Mensagens (relatório)** | ✅ **Terminada.** `src/pages/tools/ControleMensagens.tsx`, `src/services/response_metrics.ts` e as RPCs `get_controle_*` / `get_response_metrics_*` — commit `9934da6`. |
| **Disparador em massa** | `src/pages/tools/DisparadorEmMassa.tsx`, `src/services/disparador.ts`, `worker/**` (novo, Bun), migrations `*_disparador_*` e as tabelas **`disparo_*`** no banco (`disparo_listas`, `disparo_lista_membros`, `disparo_campanhas`, `disparo_alvos`, `disparo_worker_heartbeat`) + RPCs `disparo_*` e `pode_disparar()`. ⚠️ Nomeadas `disparo_` e **não** `broadcast_` de propósito: `app_broadcasts`/`broadcast_reads` já são os avisos internos do app, e as duas coisas juntas confundem. Peguei `App.tsx` e `navegacao.ts` depois de Gestão Médica liberar — acréscimos de rota e item de menu, sem tocar no que já existe. Também `src/services/tool_access.ts` e `src/hooks/use-tool-access.tsx` (só a união `ToolName`) e `ToolHost.tsx`. Aberta em 26/08/2026. |
| **Etiquetas e atribuição** | `src/services/labels.ts`, `src/pages/settings/LabelsSettings.tsx`, migrations `*_etiquetas_compartilhadas.sql` e `*_atribuicao_automatica_ao_responder.sql`. **`ChatWindow.tsx` LIBERADO** (26/08 12:5x) — mexi só no `GerenciarEtiquetasDialog` (~810-1000) e já terminei; não encosto mais nele. ⚠️ Para a área de Correção de bugs: `public.send_whatsapp_message` NÃO foi alterada, mas `messages` ganhou o gatilho `atribuir_conversa_ao_responder`, que **cria/altera `conversation_assignments` sozinho quando alguém responde um contato sem dono** — isso muda o que a lista precisa refletir. Aberta em 26/08/2026. |
| **Gestão Médica** | `supabase/migrations/*_gestao_medica_*.sql` neste repo, e o repositório **separado** `samuelklausfischer-rgb/PRN-gestao-medica` (pasta `Projetos PRN\Gestão medica\gest-o-m-dica-ia-79o09jh8l`). ⚠️ Criou o schema `gestao_medica` no MESMO Supabase (padrão do `relatorios`) e **alterou `authenticator.pgrst.db_schemas`** para expô-lo — quem mexer nessa configuração precisa preservar a lista inteira (`public, storage, graphql_public, relatorios, laudos, gestao_medica`), senão derruba Relatórios e Laudos. Nada de `public` foi tocado. ⚠️ Também mexi em `src/components/tools/ToolFrame.tsx` e `src/lib/tool-embed.ts` (26/08, fim da tarde), que **não estão na lista de fronteira mas são compartilhados por todas as ferramentas embutidas**: o `ToolFrame` passou a publicar o TEMA para o app filho, e o protocolo ganhou o tipo `EmbedThemeMessage`. É aditivo — quem não conhece a mensagem ignora, então Relatórios, Licitações, PRN Hub e Proposta seguem iguais. Já liberado, podem pegar. ✅ **FRONTEIRA LIBERADA** (26/08, tarde) — `src/App.tsx`, `src/lib/navegacao.ts` e `src/lib/env.ts` estão livres; **área do Disparador em massa, podem pegar.** O que acrescentei em cada um foi só isso, sem tocar no que já existia: em `App.tsx`, o guarda `AdministrativoToolRoute` e a rota `/ferramentas/gestao-medica`; em `navegacao.ts`, o `DestinoNav` `GESTAO_MEDICA` entrando em `gruposDeFerramentas`; em `env.ts`, `VITE_GESTAO_MEDICA_APP_URL`. Também mexi em `src/lib/permissions.ts` (`canAccessGestaoMedica`), `ToolHost.tsx` (slug `gestao-medica`), `src/pages/tools/GestaoMedica.tsx` (novo) e no `Dockerfile`. Aberta em 26/08/2026. |
| **Liberações (26/08, fim do dia)** | ⚠️ **Peguei os arquivos de fronteira `src/App.tsx` e `src/lib/navegacao.ts`**, mais `src/lib/permissions.ts`, `src/services/tool_access.ts` e `src/hooks/use-tool-access.tsx` — **área do Disparador em massa, aviso aqui ao liberar**. Mudança de quem enxerga três ferramentas: Controle de Mensagens sai de super-admin e vai para `tool_access` pessoa a pessoa; Gestão Médica fecha no setor Administrativo (perde o `is_admin`); **Disparador em massa perde o portão e fica para todos** — o campo `disparador` sai do `AcessoFerramentasExternas`, do `ToolAccessValue` e do `ToolName`. |
| **Fila 01/09 (itens 3-6)** | ✅ **LIBEREI** (commits `e7e0fdf`, `2188e1d`, `9a26963`, `f47e6e9`). (a) Atalhos `/` no composer + renome "Gatilhos"→"Atalhos de mensagem" (`ChatWindow.tsx`, `navegacao.ts`, `Triggers.tsx` — só textos de interface; rota `/triggers` e tabela intactas); (b) `AlertaDeviceDesconectado` novo no `Layout.tsx` — carência de 30s, um som por episódio; (c) cor nos compromissos (`Agenda.tsx`, `src/components/agenda/**`, `types.ts`) — coluna `agenda_events.cor` JÁ APLICADA em produção, gravação protegida contra banco sem a coluna. No banco: `mark_conversation_read_global` sem o congelamento de `waiting` — abrir agora marca lida para todos, a conversa continua na fila. ⚠️ Se alguém depender do comportamento antigo do badge na fila, a mudança foi decisão do Samuel em 01/09. **Adendo 01/09:** reconectar WhatsApp deixou de ser só-admin — ação nova `reconnect_device` na edge function `evolution-instances` (gate por `requireDeviceAccess`, o cliente manda `deviceId` e o servidor resolve o `instance_key`), **JÁ PUBLICADA no container** (backup em `index.ts.bak-20260901`); botão "Reconectar" da faixa de desconexão agora abre dialog com QR para qualquer pessoa com o aparelho liberado (`AlertaDeviceDesconectado.tsx` + `reconectarAparelho` em `services/evolution_instances.ts`). Criar/apagar/renomear instância continuam só-admin. |
| **Canais Realtime duplicados (02/09)** | ⚠️ **PEGUEI** `src/hooks/use-realtime.ts`. **Fase 0 PUBLICADA em 03/09** (merge `bf10d1b` no `main`, bundle `DjJUSmGJ`; SQL idêntico ao baseline, 0 erro de console, 0 erro no Realtime). ⚠️ **AVISO A TODAS AS JANELAS: a branch de deploy do EasyPanel agora é `main`** — alguém trocou de `deploy/financeiro-analise-prn` para `main` em 03/09; a branch antiga ficou órfã (recebe push, não deploya nada). Confira `source.ref` no `inspectAppService` antes de empurrar. — usado por ~29 pontos do app, mudança é aditiva (registro de canal compartilhado, `TABELAS_COMPARTILHADAS` começa VAZIO = zero mudança de comportamento na Fase 0). Raiz do incidente de lentidão de 02/09: cada `useRealtime(tabela,...)` sempre abria canal próprio, `messages`/`devices`/`labels`/`contact_tags` tinham o dobro de assinaturas por sessão do que deveriam. Fase 0 implementada e testada localmente (build/tsc/oxlint limpos); **ainda NÃO publicada** — plano completo, faseado, com passo a passo de rollout de baixo risco no arquivo de plano da sessão. Fases seguintes (1a/1b/2) tocam só este mesmo arquivo, uma tabela por vez, cada deploy isolado — avisar aqui antes de cada uma. |
| **Confiabilidade (28/08)** | ✅ **LIBEREI.** `use-realtime.ts`, `ChatHub.tsx`, `ChatWindow.tsx`, `messages.ts`, `services/tentativas-de-envio.ts` (novo) e 3 migrations `20260828*`. **`send_whatsapp_message` NÃO foi tocada** — o plano previa alterá-la e o desenho mudou, ver abaixo. Item 1: `useRealtime` ganhou 6º parâmetro OPCIONAL `aoReconectar`; os ~26 chamadores existentes ficaram idênticos. Item 2: a tentativa de envio virou tabela própria, `public.tentativas_de_envio`. ⚠️ **Duas armadilhas que custaram caro, para quem mexer nisso depois:** (a) gravar a tentativa DENTRO da RPC não funciona — ela é uma transação só com `statement_timeout` de 8s, então timeout/exceção desfazem o insert junto; por isso quem grava é o cliente, numa requisição separada. (b) a tentativa **não pode** morar em `messages`: o gatilho `processar_mensagem_para_atendimento` fecha a pendência em `conversation_pendencias` em todo insert de saída, e registraria tempo de resposta de mensagem que nunca saiu — o Controle de Mensagens passaria a medir errado. ⚠️ **Sobrou lixo:** 4 colunas `envio_*` sem uso em `public.messages` (o classificador recusou o DROP); o SQL para removê-las está no rodapé de `20260828130144_tentativas_de_envio.sql`. |
| **Proposta Comercial** | ✅ **Terminada** (28/08/2026). `src/pages/tools/PropostaComercial.tsx`, `src/lib/proposta/**`, `src/services/proposta_comercial.ts` e `src/services/proposta-render.ts` (novo). A ferramenta **parou de reimplementar** o gerador: o repositório **separado** `samuelklausfischer-rgb/PRN-proposta-comercial` (pasta `Projetos PRN\PROPOSTA PRN PDF`) virou um serviço HTTP e agora é a fonte única de templates, schema e geração — ele responde PDF, Word, Excel e ZIP dos três em base64, no molde do `rateio-service.ts`. Motivo: o mini-Jinja em TS não paginava exames (6 por slide) nem numerava o rodapé, então o PDF saía errado acima de 6 exames, e Word/Excel não existiam aqui. ⚠️ **Arquivo de fronteira `src/lib/env.ts`** — acréscimo de `VITE_PROPOSTA_RENDER_URL` e `VITE_PROPOSTA_API_KEY`, sem tocar no que já existia; também no `Dockerfile` (ARG/ENV + `env-config.js`, preservando `VITE_GESTAO_MEDICA_APP_URL`) e em `scripts/checar-env.mjs` (só um comentário: as duas são OPCIONAIS de propósito, não entram em `OBRIGATORIAS`). **Já liberados, podem pegar.** `src/lib/proposta/montar-html.ts`, `gerar-pdf.ts` e `public/proposta/**` foram **mantidos como fallback**: enquanto `VITE_PROPOSTA_RENDER_URL` vier vazia, o caminho antigo continua valendo e o app não quebra. |
| **Análise PRN** | ✅ **Terminada** (01/09/2026). `src/pages/tools/AnalisePrn.tsx`, `src/components/prn-analise/**`, `src/lib/prn-analise/**` e `src/services/prn-analise/prn-service.ts`. Duas frentes: (1) a validação de meses do histórico parou de acusar "falha de leitura" quando o problema era seleção incompleta — commit `e19f15c`; (2) simplificação da tela de nova análise (três passos, data de referência automática, fim dos arquivos temporários) e correção do card fantasma "daily" no cofre — commits `8ae7f24` e `dd56f1e`. **Nenhum arquivo de fronteira foi tocado.** ⚠️ Para quem mexer com o Storage: `listHistoryFiles` agora descarta entradas sem `id`, que é como o Supabase devolve subpasta — os diários vivem em `userId/daily/` e a pasta aparecia como se fosse arquivo. ⚠️ `source: 'temporary'` foi mantido de propósito nos tipos de `prn-service.ts` e `prn-history-workbook.ts`: execuções antigas já têm esse valor gravado em `prn_report_runs.historical_files` e precisam continuar sendo lidas. |
| _(livre)_ | Acrescente sua área aqui ao começar, para as outras janelas verem. |

> ⚠️ **Área de Notificações:** o Disparador em massa passou a ser um PRODUTOR de notificações
> (26/08/2026). Quando uma campanha fecha, `public.disparo_concluir_alvo` insere uma linha em
> `public.notificacoes` com `tipo = 'disparo_concluido'`, `origem_id` = id da campanha e
> `link = '/ferramentas/disparador-em-massa'`. **Não alterei nada de vocês** — nem schema, nem
> os arquivos da área; a tabela não tem `CHECK` em `tipo`, então o tipo novo entrou sem migration.
> Só avisando porque agora existe um segundo produtor, e o sino vai mostrar isso.

## Arquivos de fronteira — não edite sem avisar

Toda área precisa deles em algum momento. São os que geram conflito silencioso:

- `src/App.tsx` — registro de rotas
- `src/lib/navegacao.ts` — itens de menu (`DESTINOS_PRINCIPAIS`, `gruposDeFerramentas`, `itensDeConta`)
- `src/components/Header.tsx`, `src/components/Layout.tsx`, `src/components/mobile/MobileHeader.tsx` — casca do app
- `src/lib/env.ts` — variáveis de ambiente e seus padrões
- `package.json`, `package-lock.json`, `vite.config.ts`

> **Agora:** `Header.tsx`, `Layout.tsx` e `MobileHeader.tsx` estão **modificados pela área de
> notificações** e ainda não commitados. Quem precisar mexer neles fala com aquela janela antes.
>
> **A área de e-mail encostou em dois arquivos de fronteira em 26/08/2026 — avisando aqui:**
> - `Layout.tsx`: acrescentou `/email` à condição `isFullBleed` (linha ~37). As mudanças de
>   notificações estão nas linhas 13 e 64 — regiões diferentes, sem sobreposição.
> - `App.tsx`: duas linhas — o `lazy()` de `EmailCampanhas` e a rota `/email/campanhas`.

## ⚠️ Aviso para quem mexe com NÃO LIDA / notificação (26/08/2026)

A migration `20260826125016_atribuicao_automatica_ao_responder` acrescentou o gatilho
`atribuir_conversa_ao_responder` em `messages`. Ele mudou, como efeito colateral, uma regra de
leitura que ninguém pediu para mudar — **se você está caçando um comportamento estranho de "não
lida", leia isto antes de investigar.**

O gatilho vizinho `processar_mensagem_para_atendimento` reabre conversa finalizada e, no mesmo
`update`, grava `global_read_at`/`global_read_by`. Mas o `where` dele é `status = 'finished'`, e
o gatilho novo dispara antes (ordem alfabética) tirando o status de `finished`. Medido com o
gatilho ligado e desligado na mesma transação:

| responder conversa `finished` | status | dono | `global_read_at` |
| --- | --- | --- | --- |
| antes de 26/08 | `open` | ninguém | **marcada** |
| agora | `taken` | quem respondeu | **não marcada** |

`global_read_at` alimenta o `cursorDeLeitura` em `ChatHub.tsx`. Efeito: colega que não abriu a
conversa continua vendo como não lida, onde antes a resposta de outra pessoa limpava para todos.

**Deixado assim de propósito** — é território da área de não lida, não da de atribuição. Para
restaurar o comportamento antigo basta a função `public.atribuir_conversa_ao_responder` gravar
`global_read_at = now(), global_read_by = p_user_id` quando o status anterior era `finished`.
Para desligar a atribuição automática inteira enquanto investiga:
`alter table public.messages disable trigger atribuir_conversa_ao_responder;`

> ✅ **RESOLVIDO em 26/08/2026 pela área de Correção de bugs.** O Samuel decidiu restaurar o
> comportamento antigo, e foi feito exatamente como sugerido acima: a migration
> `20260826132909_bugs_restaura_global_read_ao_responder` faz um `create or replace` de
> `public.atribuir_conversa_ao_responder` acrescentando `global_read_at`/`global_read_by` ao
> `DO UPDATE`, só quando o status **anterior** era `finished`. Já aplicada em produção por MCP.
>
> **Área de Etiquetas: a função é sua, e ela mudou.** O resto do corpo está idêntico — os guardas
> de grupo, de convite pendente e de "nunca rouba" continuam palavra por palavra. Verificado em
> transação revertida: reabrir finalizada marca a leitura global com o autor certo; conversa
> `open` **não** ganha marca (espelha o `where status = 'finished'` do vizinho, nem mais nem
> menos); e responder conversa de colega segue sem roubá-la.

## Regras

1. **Nunca `git stash`.** A pilha de stash é compartilhada entre a cópia principal e todos os
   worktrees, e outra sessão pode estar usando. Para guardar trabalho, faça um commit WIP.
2. **Nunca `git restore .`, `git checkout .` ou `git clean` em massa.** Sempre nomeie os arquivos.
   Um comando desses aqui apaga o trabalho de todas as outras janelas de uma vez.
3. **Não commitar nem dar push sem o Samuel pedir.**
4. **Migrations:** `AAAAMMDDHHMMSS_area_descricao.sql`. Use o segundo real do relógio, não um
   número redondo — foi assim que duas áreas quase colidiram no mesmo timestamp.
5. **Rodar o app:** use o `.claude/launch.json` desta pasta. Ele aponta para o cwd e não depende
   do `launch.json` do outro repositório. `autoPort` está ligado, então duas janelas podem subir
   o dev server ao mesmo tempo sem brigar pela 8080. Duas pegadinhas já confirmadas nesta
   máquina:
   - **`npm.cmd`, não `npm`.** O Node está em `C:\Program Files\nodejs`, e o executável sem
     extensão é um script de shell — o spawner do preview não cita o caminho e o Windows
     responde `'C:\Program' não é reconhecido`. Vale para `npx.cmd` também.
   - **Navegador precisa de `PWA=1`.** `npm run dev` puro é o modo Electron: sem a flag o
     plugin de PWA não entra, `src/main.tsx` não resolve `virtual:pwa-register` e a página
     morre em 500 com "PRN Hub não conseguiu abrir". O gate é deliberado
     (`vite.config.ts:22`, com o porquê escrito lá). Use `central-whats-web`.
6. **`.env.local` já está aqui** (copiado da cópia principal, gitignored). Não apague. Sem ele o
   build sai quebrado em silêncio — `scripts/checar-env.mjs` é o portão que impede isso no
   `npm run build`, mas o `npm run dev` não checa nada.

## Estado do trabalho não commitado

O trabalho de **notificações** (11 arquivos) foi movido da cópia principal para cá em 26/08/2026
e está pendente de commit — vai junto no próximo commit e push, como combinado.

Backup intacto em `C:\Users\OPERACIONAL\.claude\backups\notificacoes-2026-08-26\`
(arquivos + `notificacoes.patch` + `base-commit.txt`).

## Pendências conhecidas

- [ ] Commitar e dar push do trabalho de notificações
- [ ] Aposentar a cópia morta `Whatsapp\SITE\Central-Whats` (v0.0.204)
- [ ] Remover os worktrees órfãos em `Whatsapp\.claude\worktrees\` — são do repositório errado,
      estão limpos e não servem para nada:
      - `central-whats-emails-logic-702273`
      - `central-whatsapp-bug-fixes-cd23af` (26/08/2026 — a sessão de correção de bugs nasceu
        nele; a sessão não consegue mudar o próprio CWD, então trabalha aqui por caminho
        absoluto. Não apagar enquanto ela estiver aberta.)
- [ ] Email Hub: ver `docs/central-whats/email-hub-estado.md`
