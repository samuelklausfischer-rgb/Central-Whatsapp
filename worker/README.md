# Worker do Disparador em massa

Consome a fila `public.disparo_alvos` e envia pela RPC `public.send_whatsapp_message`,
no ritmo gravado em cada campanha.

## Por que é um serviço separado

Um disparo no ritmo seguro (3–13 min entre mensagens) leva **horas** — 100 contatos
levam cerca de 13 h. Ele precisa continuar depois que a pessoa fecha o navegador, e
não pode depender de ninguém estar com a tela aberta.

## Por que não fala com a Evolution direto

O `prn-vigilante`, de onde este worker foi portado, tinha um cliente Evolution
próprio. Aqui isso não serve: quem grava a mensagem em `messages` — e portanto quem
a faz **aparecer na conversa do chat** — é a `send_whatsapp_message`. Um segundo
caminho até a Evolution mandaria mensagem que o atendente não conseguiria ler, e ele
veria o cliente respondendo a algo invisível.

## Variáveis

| Variável | Obrigatória | Padrão | Para quê |
| --- | --- | --- | --- |
| `SUPABASE_URL` | sim | — | Instância do PRN Hub |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | — | O worker não tem usuário logado; precisa passar por cima da RLS |
| `WORKER_NAME` | não | `disparador` | Aparece no heartbeat e no log |
| `DRY_RUN` | não | `false` | `true` percorre a fila inteira **sem enviar nada** |
| `POLL_INTERVAL_MS` | não | `5000` | Espera quando a fila está vazia |
| `LEASE_SECONDS` | não | `90` | Validade do lease de worker único |

## Rodar local

```bash
cd worker && bun install && bun run seco
```

`bun run seco` é o modo seco: os alvos caminham de `pendente` a `enviado` e a
campanha fecha, sem uma única chamada à Evolution. É como testar o ciclo inteiro sem
risco de mandar mensagem para cliente.

## Implantação

Serviço `app` no EasyPanel, projeto `apps`, a partir deste repositório com
`source.path = /worker` e build por Dockerfile — mesmo padrão de `apps/financeiro-nf`.

**Uma réplica só.** O lease no banco (`disparo_adquirir_lease`) garante que só um
worker envie por vez; uma segunda réplica ficaria girando à toa.

## Como saber se está de pé

A tela do Disparador mostra um aviso quando o último heartbeat passa de 3 minutos.
A tabela é `public.disparo_worker_heartbeat`; a linha `lease` diz quem está mandando
agora.
