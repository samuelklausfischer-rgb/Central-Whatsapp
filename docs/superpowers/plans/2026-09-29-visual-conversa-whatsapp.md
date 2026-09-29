# Visual da conversa igual ao WhatsApp — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** deixar o corpo da conversa do PRN Hub (web/PWA) visualmente o mais próximo possível do WhatsApp Web — balões, horário, menu, reação, agrupamento e separador de data.

**Architecture:** tudo acontece na lista memorizada `baloesDaConversa` de `src/components/chat/ChatWindow.tsx` (linhas ~4370–5160) e nas variáveis `--chat-*` de `src/main.css`. Regras puras (agrupamento, rótulo de data) saem para um arquivo novo pequeno; peças visuais repetidas (separador de data, rabinho) viram componentes próprios. Nada muda no banco nem no servidor.

**Tech Stack:** React 19 + Vite 8 + Tailwind + Radix (DropdownMenu) + date-fns (`ptBR`) + lucide-react.

---

## Execução orquestrada

> Política: `Memoria 2/docs/ai-orchestration/`. **Commits:** os passos "commit" abaixo NÃO são executados pelo agente — viram checkpoint: a sessão principal mostra o resultado e só commita com "pode commitar" do usuário. Deploy (Tarefa 12) idem, com autorização explícita à parte.

**Escritor único:** `ChatWindow.tsx` é tocado por quase todas as tarefas → um só executor Sonnet, em série, retomado por `SendMessage` entre fases (mantém contexto do arquivo de 7.5k linhas). Arquivos novos isolados podem nascer em paralelo porque ninguém mais os edita.

**Verificação visual fica na sessão principal:** é ela que tem o navegador do preview e o login do usuário; subagente não declara "ficou igual ao WhatsApp".

| # | Etapa | Quem | Modo | Arquivos (escrita) | Portão para seguir |
|---|---|---|---|---|---|
| 0a | Linha de base: lint, contagem `tsc`, build | Haiku | 2º plano | nenhum | números anotados |
| 0b | Fotos do "antes" (claro, escuro, celular) | Principal | frente | nenhum | usuário logado no preview |
| 1 | Criar `visualConversa.ts`, `RabinhoDaBolha.tsx`, `SeparadorDeData.tsx` | Sonnet E1 | 2º plano, junto com 0a | só os 3 novos | lint limpo nos 3 |
| 2 | Fase A (T1 agrupamento + T2 forma/rabinho) | Sonnet E1 | frente | `ChatWindow.tsx` | lint/tsc ≤ base + foto OK → **checkpoint A** |
| 3 | Fase B (T3 horário + T4 menu ⌄) | Sonnet E1 | frente | `ChatWindow.tsx` | lint/tsc ≤ base |
| 3r | Revisão de risco do diff da Fase B | Opus | 2º plano, enquanto a principal confere a tela | nenhum (só lê) | sem achado bloqueante → **checkpoint B** |
| 4 | Fase C (T5 reação, T6 reações, T7 data) | Sonnet E1 | frente | `ChatWindow.tsx`, `visualConversa.ts` | foto OK → **checkpoint C** |
| 5 | Fase D (T8 foto, T9 ✓) conforme D1/D2 | Sonnet E1 | frente | `ChatWindow.tsx` | decisão do usuário registrada |
| 5b | T10 fundo (ajuste fino por comparação) | Principal | frente | `src/main.css` (1 variável) | tom bate lado a lado |
| 6 | Portão final: lint, tsc, build | Haiku | 2º plano | nenhum | tudo ≤ base |
| 6b | Fotos do "depois" + definição de pronto + relatório | Principal | frente | nenhum | checklist manual entregue |

**Por que Opus só na 3r:** a Fase B mexe em clique (botão "tentar novamente" duplicado na cópia invisível), toque longo, modo de seleção, menu Radix e dependências do `useMemo` — é onde uma regressão silenciosa custa caro. As demais fases são troca de classe CSS.

**Parada:** lint com erro novo · `tsc` acima da base · build falha · regressão visual · 2 tentativas sem avanço na mesma tarefa → volta para a principal reavaliar (não escala modelo automaticamente) · qualquer passo que envolva enviar/reagir mensagem real ou produção → pergunta ao usuário.

**Proibido em teste:** enviar mensagem, reagir, editar ou apagar em conversa real (vai para o cliente de verdade). Reação e menu são conferidos só abrindo o seletor/menu e fechando com Esc.

---

## Contexto que quem executa precisa saber

- **Pasta:** `C:\Users\OPERACIONAL\Desktop\Projetos PRN\Central-Whatsapp\.worktrees\web-ajustes`, branch `web/ajustes-2909`, criada de `origin/main` @ `b47d5cc` (v0.0.217).
- **Dev server:** preview `web-ajustes` (porta 8080, `PWA=1`). A 1ª recarga pode mostrar a versão antiga (service worker) — recarregar duas vezes.
- **O banco é produção.** Não há staging. Abrir conversa no dev dispara recibo de leitura real; **não enviar mensagem** para testar visual — use conversas que já têm mensagens dos dois lados.
- **Não há testes automatizados** (`npm test` só imprime "there are no tests"). A verificação de cada tarefa é: `npm.cmd run lint` + build + conferência visual no navegador (screenshot antes/depois).
- **Typecheck não é porteiro:** `npx.cmd tsc -p tsconfig.app.json --noEmit` já tem ~32 erros de base. Critério = o número não sobe.
- **`useMemo` de `baloesDaConversa` tem dependências conferidas pelo oxlint.** Toda variável nova usada lá dentro entra na lista de dependências; nunca remover item para "memorizar melhor".
- **Existem DOIS rodapés duplicados** no balão: um no ramo de texto (~4916–4989) e outro no ramo "só mídia / apagada" (~5021–5102). Toda mudança de horário/menu precisa valer para os dois — a Tarefa 4 elimina a duplicação do menu.
- **Existem DOIS separadores de data** idênticos: ~4405 (mensagem fixada) e ~4462 (normal). A Tarefa 7 unifica.
- **Balão de "tentativa de envio"** (~6114–6125) e esqueleto de carregamento (~6061–6069) imitam o balão; acompanham as mudanças de forma.
- **Tema escuro existe** (`.dark` em `src/main.css:92`). As cores escuras já batem com o WhatsApp escuro; toda tarefa é conferida nos dois temas.
- **Mobile (<640px) usa o mesmo componente.** Conferir com `resize_window` preset `mobile` ao fim de cada fase.

### Medidas de referência do WhatsApp Web (tema claro)

| Elemento | Valor |
|---|---|
| Canto do balão | 7.5px |
| Espaço interno do balão | 6px topo · 7px direita · 8px baixo · 9px esquerda |
| Texto | 14.2px, altura de linha 19px |
| Largura máxima | 65% (desktop) |
| Espaço entre balões do mesmo remetente | 2px |
| Espaço ao trocar de remetente | 12px |
| Horário | 11px, cor `--chat-muted`, canto inferior direito, dentro do balão |
| Rabinho | 8×13px, só no 1º balão da sequência; esse balão perde o canto de cima do lado do rabinho |
| Separador de data | fundo branco, canto 7.5px, 12.5px, sombra da bolha, sem borda |
| Cores | já iguais: `--chat-bubble-out 112 87% 91%` ≈ `#d9fdd3`, `--chat-conversation 36 31% 90%` ≈ `#efeae2` |

## Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/components/chat/visualConversa.ts` | Criar | Regras puras: início de sequência e rótulo de data |
| `src/components/chat/SeparadorDeData.tsx` | Criar | Etiqueta de data centralizada (usada 2×) |
| `src/components/chat/RabinhoDaBolha.tsx` | Criar | SVG do rabinho, lado e cor por prop |
| `src/components/chat/ChatWindow.tsx` | Modificar | Lista de balões, rodapé, menu, reação |
| `src/main.css` | Modificar | Remover borda do balão enviado, ajustar padrão de fundo |

---

## Fase 0 — Linha de base

### Tarefa 0: Fotografar o antes

- [ ] **Passo 1:** subir o preview `web-ajustes`, entrar, abrir a conversa "samuel klaus fischer" (tem sequências dos dois lados, "Encaminhada" e negrito).
- [ ] **Passo 2:** screenshot em desktop claro, desktop escuro e `mobile` claro. Guardar os caminhos para comparar no fim.
- [ ] **Passo 3:** registrar a base:

```bash
npm.cmd run lint 2>&1 | tail -3
npx.cmd tsc -p tsconfig.app.json --noEmit 2>&1 | grep -c "error TS"
```

Anotar o número de erros do `tsc` (esperado ≈ 32).

---

## Fase A — Estrutura (maior ganho visual)

### Tarefa 1: Agrupamento por sequência

**Files:**
- Create: `src/components/chat/visualConversa.ts`
- Modify: `src/components/chat/ChatWindow.tsx:6056` (container) e o `className` da linha do balão (~4492)

- [ ] **Passo 1: criar a regra pura**

```ts
// src/components/chat/visualConversa.ts
/**
 * Regras de aparência da conversa que imitam o WhatsApp. Puras de propósito:
 * a lista de balões é memorizada e não pode depender de estado para decidir
 * forma — só da mensagem e da vizinha anterior.
 */

type MensagemMinima = {
  direction?: string | null
  sender_id?: string | null
  remote_sender?: string | null
  group_participant?: string | null
  sender_name?: string | null
  created_at: string
}

function ehMinha(msg: MensagemMinima, userId: string | undefined) {
  return msg.direction === 'outbound' || (!!userId && msg.sender_id === userId)
}

function autor(msg: MensagemMinima, userId: string | undefined) {
  if (ehMinha(msg, userId)) return 'eu'
  return msg.group_participant || msg.sender_name || msg.remote_sender || '?'
}

/**
 * Começa uma sequência nova quando não há anterior, quando muda o dia
 * (o separador de data quebra o bloco) ou quando muda quem falou.
 * É o que decide o espaço maior acima e o rabinho.
 */
export function ehInicioDeSequencia(
  msg: MensagemMinima,
  anterior: MensagemMinima | undefined,
  mudouDeDia: boolean,
  userId: string | undefined,
) {
  if (!anterior || mudouDeDia) return true
  return autor(msg, userId) !== autor(anterior, userId)
}
```

- [ ] **Passo 2: tirar o espaçamento uniforme.** Em `ChatWindow.tsx:6056` trocar `className="py-4 space-y-3"` por `className="py-4"` e atualizar o comentário acima (ele cita `space-y-3`).

- [ ] **Passo 3: calcular a sequência dentro do `map`.** Logo depois de `shouldShowDateSeparator` (~4396):

```ts
const inicioDeSequencia = ehInicioDeSequencia(msg, previousMsg, shouldShowDateSeparator, user?.id)
```

Importar `ehInicioDeSequencia` de `@/components/chat/visualConversa`. Como é import de módulo (não variável de componente), não entra nas dependências do `useMemo`.

- [ ] **Passo 4: aplicar a margem** no `cn(...)` da linha do balão (~4492), primeira classe:

```ts
'flex flex-col',
inicioDeSequencia ? 'mt-3' : 'mt-0.5',
```

Na mensagem fixada (~4411) trocar `py-1` por `my-3`.

- [ ] **Passo 5: verificar.** Recarregar 2×. Esperado: balões do mesmo remetente quase colados, bloco novo com respiro. Conferir que o separador de data não gruda no balão (ele tem `py-2` próprio).

- [ ] **Passo 6: commit**

```bash
git add src/components/chat/visualConversa.ts src/components/chat/ChatWindow.tsx
git commit -m "feat(conversa): agrupa baloes por sequencia como o WhatsApp"
```

### Tarefa 2: Forma do balão e rabinho

**Files:**
- Create: `src/components/chat/RabinhoDaBolha.tsx`
- Modify: `src/components/chat/ChatWindow.tsx:4560-4566` (balão), `~6118` (tentativa), `~6065` (esqueleto)
- Modify: `src/main.css` (borda do balão enviado)

- [ ] **Passo 1: criar o rabinho**

```tsx
// src/components/chat/RabinhoDaBolha.tsx
/**
 * O "rabinho" do WhatsApp: só no primeiro balão de uma sequência. Herda a cor
 * do balão por `currentColor`, então quem usa passa a classe de texto com a
 * mesma cor do fundo (`text-chat-bubble-out` / `text-chat-bubble-in`).
 */
export function RabinhoDaBolha({ lado, className }: { lado: 'esquerda' | 'direita'; className?: string }) {
  const direita = lado === 'direita'
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 13"
      width="8"
      height="13"
      className={`pointer-events-none absolute top-0 ${direita ? '-right-2' : '-left-2'} ${className ?? ''}`}
    >
      {direita ? (
        <path fill="currentColor" d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" />
      ) : (
        <path fill="currentColor" d="M2.812 1H8v11.193L1.533 3.568C.474 2.156 1.042 1 2.812 1z" />
      )}
    </svg>
  )
}
```

- [ ] **Passo 2: nova classe do balão** (~4561). Substituir o template string por:

```tsx
<div
  className={cn(
    'relative group max-w-[88%] sm:max-w-[65%] rounded-[7.5px] pt-1.5 pr-[7px] pb-2 pl-[9px] shadow-chat-bubble transition-all duration-150 text-chat-text',
    isMe ? 'bg-chat-bubble-out' : 'bg-chat-bubble-in',
    inicioDeSequencia && (isMe ? 'rounded-tr-none' : 'rounded-tl-none'),
  )}
>
  {inicioDeSequencia && (
    <RabinhoDaBolha
      lado={isMe ? 'direita' : 'esquerda'}
      className={isMe ? 'text-chat-bubble-out' : 'text-chat-bubble-in'}
    />
  )}
```

(`border border-chat-bubble-outline` sai — o WhatsApp não tem borda.)

- [ ] **Passo 3: texto no tamanho do WhatsApp.** Em ~4888 trocar `text-[15px] leading-relaxed` por `text-[14.2px] leading-[19px]`. Mesma troca no balão de tentativa (~6125).

- [ ] **Passo 4: balão de tentativa e esqueleto.** Em ~6118 trocar `rounded-2xl rounded-br-sm px-3.5 py-2` por `rounded-[7.5px] pt-1.5 pr-[7px] pb-2 pl-[9px]` e `sm:max-w-[78%]` por `sm:max-w-[65%]`. Em ~6065 trocar `rounded-2xl` por `rounded-[7.5px]`.

- [ ] **Passo 5: verificar** claro e escuro: rabinho só no 1º balão do bloco, sem "degrau" entre rabinho e balão (se aparecer 1px de diferença, ajustar `-right-2`/`-left-2` para `-right-[7px]`/`-left-[7px]`). Conferir balão com foto e com resposta citada.

- [ ] **Passo 6: commit**

```bash
git add src/components/chat/RabinhoDaBolha.tsx src/components/chat/ChatWindow.tsx
git commit -m "feat(conversa): balao com canto e rabinho do WhatsApp"
```

---

## Fase B — Dentro do balão

### Tarefa 3: Horário no canto inferior direito

A técnica do WhatsApp: o rodapé (horário, "editado", relógio, falha) é desenhado **duas vezes** — uma cópia invisível no fim do texto, que reserva o espaço, e a cópia visível posicionada no canto. Assim o horário nunca cobre texto e o balão fica do tamanho certo.

**Files:** Modify `src/components/chat/ChatWindow.tsx:4916-4989` e `5021-5065`

- [ ] **Passo 1: montar o rodapé uma vez só**, dentro do `map`, antes do `return` (~4447). Recorta o conteúdo hoje repetido nos dois ramos, **sem o menu ⋮** (ele sai na Tarefa 4):

```tsx
const rodape = (
  <>
    {msg.edited_at && <span className="text-[11px] text-chat-muted">(editado)</span>}
    {msg.revoked_at && !msg.deleted_at && (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-red-400">
        <Trash2 className="h-3 w-3" /> apagada
      </span>
    )}
    {isMe && msg.status === 'sending' && <Clock className="h-3 w-3 text-chat-muted shrink-0" />}
    {isMe && msg.status === 'failed' && (
      <button
        type="button"
        disabled={reenviando === msg.id}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void reenviarFalha(msg.id)
        }}
        className="inline-flex items-center gap-0.5 text-[11px] font-medium text-red-400 hover:text-red-300 hover:underline disabled:opacity-60"
      >
        {reenviando === msg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertCircle className="h-3 w-3" />}
        {reenviando === msg.id ? 'reenviando…' : 'falhou · tentar novamente'}
      </button>
    )}
    <span className="text-[11px] text-chat-muted">{timestamp}</span>
  </>
)
```

Atenção: no ramo de texto de hoje o badge "apagada" aparece mesmo com `deleted_at`; no ramo só-mídia ele exige `!msg.deleted_at`. Unificar com `!msg.deleted_at` (o balão apagado já diz "[Mensagem apagada]").

- [ ] **Passo 2: ramo de texto** (~4916–4989). Trocar o `<span className="inline-flex translate-y-[30%] ...">…</span>` inteiro por:

```tsx
{/* Reserva: cópia invisível que empurra a última linha para caber o horário. */}
<span aria-hidden className="invisible inline-flex items-center gap-1 whitespace-nowrap pl-2 align-bottom text-[11px]">
  {rodape}
</span>
<span className="absolute bottom-1 right-[7px] inline-flex items-center gap-1 whitespace-nowrap leading-none">
  {rodape}
</span>
```

O botão "tentar novamente" existe nas duas cópias; a invisível não recebe clique (`visibility: hidden`), então não há duplo disparo. Conferir que a cópia invisível leva `tabIndex={-1}` implícito — `visibility: hidden` já tira do foco.

- [ ] **Passo 3: ramo só-mídia/apagada** (~5021–5065): trocar o conteúdo do `div.mt-1.5` pelo `{rodape}` (mantendo o `div` com `mt-1 flex items-center justify-end gap-1`). Aqui não precisa da cópia invisível — o rodapé já é linha própria abaixo da mídia.

- [ ] **Passo 4: verificar** — texto curto ("Oi 13:02" colado), texto longo quebrando linha (horário na última linha sem cobrir texto), mensagem com "(editado)", foto sem legenda, áudio, mensagem apagada, grupo.

- [ ] **Passo 5: commit**

```bash
git commit -am "feat(conversa): horario no canto do balao, rodape unico"
```

### Tarefa 4: Menu ⌄ sobreposto no canto

**Files:** Modify `src/components/chat/ChatWindow.tsx` (remover os dois `DropdownMenu` de ~4955 e ~5067; adicionar um no topo do balão)

- [ ] **Passo 1: apagar os dois `<DropdownMenu>…</DropdownMenu>`** dos rodapés (o do ramo de texto e o do ramo só-mídia).

- [ ] **Passo 2: um único menu**, logo depois do `<RabinhoDaBolha …/>` dentro do balão:

```tsx
{!msg.deleted_at && (
  <DropdownMenu
    open={messageMenuOpenId === msg.id}
    onOpenChange={(open) => setMessageMenuOpenId(open ? msg.id : null)}
  >
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label="Opções da mensagem"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          // Degradê da cor do próprio balão: a setinha fica legível sem
          // tampar o texto com um bloco sólido — é o truque do WhatsApp.
          'absolute right-0.5 top-0.5 z-10 flex h-5 w-8 items-start justify-end rounded-tr-[7.5px] pr-1 text-chat-muted transition-opacity duration-150',
          isMe
            ? 'bg-[linear-gradient(to_left,hsl(var(--chat-bubble-out))_55%,transparent)]'
            : 'bg-[linear-gradient(to_left,hsl(var(--chat-bubble-in))_55%,transparent)]',
          messageMenuOpenId === msg.id
            ? 'opacity-100'
            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
        )}
      >
        <ChevronDown className="h-[18px] w-[18px]" />
      </button>
    </DropdownMenuTrigger>
    <MessageActionsMenu
      msg={msg}
      isMe={isMe}
      podeEditar={isMe && podeEditarNoWhatsapp(msg)}
      onReply={handleReply}
      onCopy={handleCopyMessage}
      onEdit={handleEditMessage}
      onDelete={setDeleteConfirmMsg}
      onForward={(m: any) => setMsgsParaEncaminhar([m])}
      onSelecionar={iniciarSelecaoCom}
      onReplyPrivately={handleReplyPrivately}
      podeResponderPrivadamente={isGroupContact && !isMe && !!msg.group_participant}
      onInfo={setMsgInfoAberta}
    />
  </DropdownMenu>
)}
```

- [ ] **Passo 3: se `MoreVertical` deixar de ser usado** no arquivo, o oxlint acusa import sem uso — ele ainda é usado no cabeçalho (~5540), então deve continuar. Rodar `npm.cmd run lint` para confirmar.

- [ ] **Passo 4: verificar** — passar o mouse mostra ⌄ no canto; abrir o menu e escolher Responder/Copiar/Encaminhar funciona; em foto sem legenda a setinha aparece sobre a foto (se ficar ilegível, aplicar degradê escuro + ícone branco quando `messageAttachments.length > 0 && !msg.content?.trim()` — decidir olhando). No celular o menu segue abrindo pelo toque longo (não depende do botão).

- [ ] **Passo 5: commit**

```bash
git commit -am "feat(conversa): menu da mensagem vira setinha no canto do balao"
```

---

## Fase C — Acabamento

### Tarefa 5: Botão de reação mais discreto

**Files:** Modify `src/components/chat/ChatWindow.tsx:5105-5128`

- [ ] **Passo 1:** trocar `-left-8`/`-right-8` por `-left-10`/`-right-10` (a setinha agora ocupa o canto, o botão precisa de respiro) e a classe do botão por:

```tsx
className={cn(
  'flex h-[26px] w-[26px] items-center justify-center rounded-full bg-black/[0.06] text-chat-muted transition-all duration-150 hover:bg-black/10 hover:text-chat-text dark:bg-white/10 dark:hover:bg-white/15',
  reactionPopoverMessageId === msg.id
    ? 'opacity-100 pointer-events-auto scale-100'
    : 'opacity-0 pointer-events-none scale-95 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-focus-within:scale-100',
)}
```

Ícone: `<Smile className="h-4 w-4" />` continua.

- [ ] **Passo 2: verificar** que o botão não "some" ao levar o mouse do balão até ele (o `group` é o balão; o botão é filho dele, então o hover se mantém). Commit:

```bash
git commit -am "feat(conversa): botao de reacao no estilo do WhatsApp"
```

### Tarefa 6: Reações penduradas na borda

**Files:** Modify `src/components/chat/ChatWindow.tsx:4992-5008`

- [ ] **Passo 1:** trocar o `div.flex.flex-wrap.gap-1.mt-1.5` das reações por uma pílula absoluta:

```tsx
{msg.reactions && msg.reactions.length > 0 && (
  <div
    className={cn(
      'absolute -bottom-4 z-10 flex items-center gap-0.5 rounded-full bg-chat-bubble-in px-1.5 py-0.5 text-[13px] leading-none shadow-chat ring-2 ring-chat-conversation',
      isMe ? 'right-2' : 'left-2',
    )}
  >
    {Array.from(
      msg.reactions.reduce((acc: Map<string, number>, r: any) => {
        acc.set(r.emoji, (acc.get(r.emoji) || 0) + 1)
        return acc
      }, new Map()),
    ).map(([emoji, count]) => (
      <span key={emoji}>
        {emoji}
        {count > 1 ? <span className="ml-0.5 text-[11px] text-chat-muted">{count}</span> : null}
      </span>
    ))}
  </div>
)}
```

- [ ] **Passo 2: abrir espaço embaixo** para a pílula não cobrir o próximo balão: no `cn(...)` da linha (Tarefa 1, Passo 4) acrescentar `msg.reactions?.length > 0 && 'mb-4'`.

- [ ] **Passo 3: verificar** em mensagem com reação (enviada e recebida) e em sequência. Commit:

```bash
git commit -am "feat(conversa): reacoes penduradas na borda do balao"
```

### Tarefa 7: Separador de data

**Files:**
- Modify: `src/components/chat/visualConversa.ts` (rótulo)
- Create: `src/components/chat/SeparadorDeData.tsx`
- Modify: `src/components/chat/ChatWindow.tsx:797-809` (`getDateLabel`), `~4405`, `~4462`

- [ ] **Passo 1: rótulo com dia da semana** — acrescentar em `visualConversa.ts`:

```ts
import { format, differenceInCalendarDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'

/**
 * Hoje · Ontem · nome do dia (até 6 dias atrás) · dd/MM/yyyy.
 * `agora` é parâmetro para a regra ser pura (e conferível no console).
 */
export function rotuloDaData(valor: string, agora: Date = new Date()) {
  if (!valor) return ''
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return ''
  const dias = differenceInCalendarDays(agora, data)
  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  if (dias > 1 && dias < 7) return format(data, 'EEEE', { locale: ptBR })
  return format(data, 'dd/MM/yyyy')
}
```

Conferir se `date-fns/locale` já é usado no projeto (`grep -rn "date-fns/locale" src`); se for, seguir o mesmo import.

- [ ] **Passo 2: componente**

```tsx
// src/components/chat/SeparadorDeData.tsx
export function SeparadorDeData({ rotulo }: { rotulo: string }) {
  return (
    <div className="mt-3 flex justify-center">
      <span className="rounded-[7.5px] bg-chat-bubble-in px-3 pb-1.5 pt-[5px] text-[12.5px] text-chat-muted shadow-chat-bubble">
        {rotulo}
      </span>
    </div>
  )
}
```

- [ ] **Passo 3:** trocar os dois blocos `<div className="flex justify-center py-2"><span …>{getDateLabel(msg.created_at)}</span></div>` por `<SeparadorDeData rotulo={rotuloDaData(msg.created_at)} />` e apagar `getDateLabel` (conferir antes com `grep -n getDateLabel` que não há outro uso).

- [ ] **Passo 4: verificar** — "Hoje", "Ontem", "sexta-feira" (ou o dia correspondente), data completa para mais antigos. Commit:

```bash
git commit -am "feat(conversa): separador de data com dia da semana"
```

---

## Fase C2 — Foto e vídeo (referência enviada pelo usuário em 29/09)

Referência WhatsApp: a mídia ocupa o balão quase inteiro (moldura de ~3px na cor do balão), cantos ~6px; **horário branco sobreposto no canto inferior direito da própria imagem**, sobre um degradê escuro; vídeo com círculo cinza translúcido de play no centro; **botão de encaminhar rápido** (➦, círculo) do lado de fora do balão, junto do botão de reação.

Hoje (ChatWindow.tsx): imagem `max-w-[320px] rounded-xl` (~4839, ~4942), vídeo `w-[300px] rounded-xl border bg-black` (~4797, ~4920), figurinha `max-w-[160px]` (~4864, ~4959); horário numa linha própria abaixo da mídia (ramo só-rodapé); encaminhar só pelo menu ⌄.

### Tarefa 7b: Mídia sem legenda no estilo WhatsApp

**Files:** Modify `src/components/chat/ChatWindow.tsx` (wrappers de imagem/vídeo nos dois ramos de anexo + ramo só-rodapé)

- [ ] **Passo 1:** quando o balão tem **uma** imagem ou vídeo e **não tem legenda** (conteúdo vazio ou rótulo técnico), o balão usa `p-[3px]` em vez do padding de texto; a mídia vai `rounded-[6px]`, sem `border`, largura ~330px (`w-[330px] max-w-full`).
- [ ] **Passo 2:** nesse caso o rodapé NÃO vai para a linha de baixo: vai `absolute bottom-1.5 right-2` sobre a mídia, texto branco (`text-white`, ícones brancos), com um degradê `bg-gradient-to-t from-black/50 to-transparent` de ~28px no pé da mídia (`pointer-events-none`). "tentar novamente" (falha) mantém a cor vermelha legível sobre o degradê.
- [ ] **Passo 3:** com legenda, a mídia continua com moldura de 3px e a legenda segue o padrão de texto (Tarefa 3) — horário no fim da legenda.
- [ ] **Passo 4:** vídeo: botão de play central vira círculo `h-12 w-12 bg-black/40` com ícone branco (já é quase isso — conferir).
- [ ] **Passo 5:** figurinha (`max-w-[160px]`): no WhatsApp **não tem balão** — fundo transparente, sem sombra, horário numa pílula pequena `bg-black/30 text-white` no canto. Aplicar quando o único anexo for figurinha.
- [ ] **Passo 6 (verificar):** ⌄ sobre foto fica legível (se não, degradê escuro + ícone branco quando for mídia sem legenda — a revisão já previa esse fallback); balão com rabinho + foto: a moldura de 3px continua com o rabinho da cor do balão.

### Tarefa 7c: Botão de encaminhar rápido ao lado da mídia

- [ ] **Passo 1:** para mensagens com imagem/vídeo/documento (não apagadas), acrescentar ao lado do botão de reação (mesmo container absoluto do lado de fora, Tarefa 5) um segundo círculo de 26px com ícone `Forward` que chama `setMsgsParaEncaminhar([msg])` — a mesma ação que o menu já faz, sem lógica nova. Os dois ficam empilhados/alinhados como no WhatsApp (reação acima, encaminhar logo abaixo, ou lado a lado — conferir na referência) e aparecem só no hover.
- [ ] **Passo 2 (verificar):** clicar abre o diálogo de encaminhar já existente e **fechar sem enviar** (Esc). Nunca concluir um encaminhamento em teste.

---

## Fase C3 — Documentos (referência enviada pelo usuário em 29/09) — BACKLOG, aguardando print do PRN Hub

Referência WhatsApp (documentos .zip enviados em sequência):
- Balão na largura fixa (~330px). Dentro, um **cartão** um tom mais escuro que o balão (`bg-black/[0.04]`), cantos ~6px, padding ~10px, ocupando a largura toda.
- Cartão: ícone de documento cinza com a sigla do tipo ("ZIP") à esquerda · nome do arquivo 14.2px, quebrando em até 2 linhas · abaixo "ZIP • 988 KB" em 12px `text-chat-muted` · ícone de baixar (seta na bandeja) cinza à direita, centralizado na altura.
- Rodapé (horário + ✓) **abaixo do cartão**, dentro do balão, alinhado à direita — NÃO sobreposto (diferente de foto/vídeo).
- Rabinho só no 1º da sequência; balões de documento seguidos com o mesmo espaçamento curto (Tarefa 1).

### Correção da Tarefa 7c (vista nos prints de mídia e de documento)
- **➦ fica SEMPRE visível** ao lado de mídia/documento (não só no hover).
- **😊 aparece só no hover**, e os dois ficam **lado a lado na horizontal**: ➦ colado ao balão, 😊 do lado de fora dele (enviadas: `😊 ➦ [balão]`; recebidas: `[balão] ➦ 😊`), centralizados na altura do balão.
- O executor implementou empilhado na vertical e ambos só no hover → ajustar.

### Como está no PRN Hub (print de produção, 29/09)
- Componente: `src/components/chat/DocumentBubble.tsx` (rótulo "Compactado" vem de `src/lib/file-type.ts:58`, via `getFileTypeMeta`). O tamanho do arquivo **já existe** ("2.5 MB").
- Cartão **branco** com sombra/borda, destacado do balão verde (no WhatsApp é um tom mais escuro do próprio balão, sem sombra).
- Ícone **laranja em quadrado amarelo claro** (WhatsApp: ícone de documento cinza com a sigla do tipo escrita nele).
- Subtítulo "Compactado · 2.5 MB" (WhatsApp: "ZIP • 2 MB" — sigla da extensão em maiúsculas).
- Nome **cortado em 1 linha com "…"** (WhatsApp: quebra em até 2 linhas).
- **Largura do balão varia** com o nome (WhatsApp: largura fixa ~330px, todos alinhados).
- Margem verde grossa em volta do cartão (~10px; WhatsApp ~3–5px).
- Horário embaixo do cartão: ✅ já igual ao WhatsApp.

### Tarefa 7d: Cartão de documento

**Files:** Modify `src/components/chat/DocumentBubble.tsx`; ChatWindow só se o wrapper do documento tiver padding/largura própria.

- [ ] **Passo 1:** cartão `w-[330px] max-w-full rounded-[6px] bg-black/[0.04] dark:bg-white/[0.05] p-2.5` sem `shadow`/`border`/`bg-white`.
- [ ] **Passo 2:** ícone: documento cinza (`FileIcon`/`File` do lucide, `text-chat-muted`, ~32px) com a sigla da extensão (`getFileExtension(...).toUpperCase()`, máx. 4 letras, 8px bold) sobreposta embaixo do ícone — sem o quadrado colorido.
- [ ] **Passo 3:** subtítulo `"{EXT} • {tamanho}"` (`text-[12px] text-chat-muted`); sem tamanho, só `{EXT}`. O rótulo amigável ("Compactado", "Planilha") deixa de aparecer aqui — conferir com grep se outro lugar (galeria, `UnavailableAttachmentBubble`) depende dele antes de mexer em `file-type.ts` (de preferência NÃO mexer lá).
- [ ] **Passo 4:** nome `text-[14.2px] leading-[19px] line-clamp-2 break-all` no lugar do `truncate`.
- [ ] **Passo 5:** botão de baixar: ícone `Download` 22px `text-chat-muted`, centralizado na altura do cartão; mantém o mesmo `onClick`/`href`, e a prévia de PDF/Excel (`onOpenPreview`) continua funcionando.
- [ ] **Passo 6:** o balão de documento usa padding `p-[3px] pb-1` (como mídia sem legenda) e o rodapé segue abaixo do cartão, à direita (não sobreposto). Com legenda, a legenda vem entre o cartão e o rodapé no padrão de texto.
- [ ] **Passo 7 (verificar):** PDF, Excel, ZIP, nome longo, arquivo sem tamanho, documento recebido e enviado, documento indisponível (`UnavailableAttachmentBubble` — só conferir que não quebrou).

---

## Fase F — Álbum de fotos + visualizador com navegação (pedido do usuário, 29/09)

**Levantamento (Haiku, 29/09):**
- Visualizador: `src/components/chat/MediaViewer.tsx` (zoom, arrastar, Esc, baixar 1 arquivo via `downloadFile` de `src/lib/download.ts`). Estado `mediaView` em `ChatWindow.tsx:~1696`, render em `~7537`. **Não tem** anterior/próximo nem miniaturas.
- `ConversationGallery.tsx` já chama `onAbrirMidia(itens, index)` com a lista inteira → ganha navegação de graça quando o visualizador aceitar lista.
- **Banco não sabe o que é álbum**: cada foto é uma mensagem; webhook não trata `albumMessage`. → agrupamento é **regra no cliente**.
- **Não há biblioteca de zip** no projeto. `downloadFile` faz fetch → blob (com fallback para nova aba em CORS).
- "Ler mais" não existe.

**Regra de álbum (proposta, igual WhatsApp):** ≥ 4 mensagens seguidas de imagem/vídeo **sem legenda**, do mesmo autor, no mesmo dia, cada uma até 60 s depois da anterior, nenhuma apagada. Menos que 4 → balões normais.

**Divisão (escritor único por arquivo, duas frentes em paralelo):**

| Frente | Executor | Arquivos | Depende de |
|---|---|---|---|
| F-a Visualizador com lista | Sonnet E2 | `MediaViewer.tsx`, `src/lib/download.ts`, `src/lib/zip.ts` (novo), `package.json` (+ `fflate`) | decisão F2 |
| F-b Álbum na conversa | Sonnet E1 | `ChatWindow.tsx`, `visualConversa.ts`, `AlbumDeFotos.tsx` (novo) | F-a pronto (props do viewer) |
| F-c Ler mais | Sonnet E1 | `ChatWindow.tsx` (MessageBody) | — |
| Revisão | Opus | leitura | F-a + F-b |

### Tarefa F-a: Visualizador com lista, miniaturas e zip
- [ ] `MediaViewer` aceita `media` **ou** `{ itens: ViewerMedia[]; indice: number }` (sem quebrar os chamadores atuais).
- [ ] Botões ◀ ▶ nas laterais + setas ← → do teclado; zoom volta a 1x ao trocar.
- [ ] Faixa de miniaturas embaixo (rolagem horizontal, atual destacada, clique troca; rola até a atual).
- [ ] "Baixar" = só a atual (`downloadFile`). "Baixar todas (.zip)" só quando há > 1: `src/lib/zip.ts` baixa cada URL (fetch → blob), monta com `fflate.zipSync`, nomes via `nomeParaDownload`; falha parcial → zip com o que deu + aviso "N de M baixadas". Botão com estado "gerando…".
- [ ] `ChatWindow`: `onAbrirMidia(itens, index)` da galeria passa a lista.

### Tarefa F-b: Álbum na conversa
- [ ] `visualConversa.ts`: `agruparAlbuns(mensagens)` puro → para cada índice diz se é início de álbum (com a lista de ids) ou membro (não renderiza).
- [ ] `AlbumDeFotos.tsx`: grade 2×2 (330px, fendas de 3px, cantos 6px), horário em cada quadro, 4º quadro escurecido com "+N". Clique abre o visualizador na foto clicada com a lista do álbum.
- [ ] Balão do álbum: rabinho/sequência normais, ➦ encaminha **todas** (`setMsgsParaEncaminhar(lista)`), reações agregadas.
- [ ] Menu ⌄ do álbum: Responder (1ª foto), Encaminhar todas, Selecionar. **No modo de seleção o álbum se desfaz** em balões individuais (apagar/info/copiar continuam por foto — sem ação em massa nova).
- [ ] Dependências do `useMemo` conferidas; foto chegando pelo Realtime entra no álbum sozinha (é derivado da lista).

### Tarefa F-c: "Ler mais"
- [ ] Texto longo: limite por altura (`line-clamp` ~ 14 linhas) em vez de cortar caracteres (não quebra negrito/links/destaques da busca); botão "Ler mais" verde (`text-emerald-700 dark:text-emerald-400`) só quando transborda; expande no lugar.

---

## Fase D — Itens que dependem de decisão

### Tarefa 8: Foto do contato (decisão D1)

- **Se D1 = "tirar em conversa individual" (recomendado, igual WhatsApp):** em ~4544–4559 renderizar o `SmartAvatar`/espaçador só quando `isGroupContactMsg`; apagar o espaçador `w-7` das enviadas (~5156–5158). Em grupo, o WhatsApp mostra a foto no 1º balão da sequência e o **nome colorido dentro do balão** — trocar a pílula `shouldShowSenderLabel` (~4522) por `<div className="mb-0.5 text-[12.8px] font-medium text-emerald-700 dark:text-emerald-400">{thisSender}</div>` renderizado dentro do balão, antes do conteúdo.
- **Se D1 = "manter":** pular a tarefa.

### Tarefa 9: Confirmação de envio (decisão D2)

O banco **não guarda** entregue/lida: nas 3.304 mensagens enviadas dos últimos 7 dias `envio_status` é nulo para todas. ✓✓ azul real exige capturar o evento de leitura da Evolution no webhook + coluna nova — é outro projeto (servidor + banco), fora deste plano.

- **Se D2 = "✓ cinza simples agora":** no `rodape` (Tarefa 3) acrescentar, depois do horário, `{isMe && !msg.status && <Check className="h-3.5 w-3.5 text-chat-muted" />}` — significa só "chegou ao servidor".
- **Se D2 = "nada até ter o dado real":** pular.

### Tarefa 10: Intensidade do fundo (decisão D3)

As cores do fundo já batem com o WhatsApp; o que difere é o desenho. Medir no navegador (amostra de cor do screenshot) e ajustar só `--chat-conversation-pattern-opacity` em `src/main.css:66` (hoje `0.038`) até o tom médio bater com `#efeae2`. Um valor por vez, comparando screenshots lado a lado.

---

## Fase E — Fechamento

### Tarefa 11: Verificação final

- [ ] `npm.cmd run lint` sem erro novo.
- [ ] `npx.cmd tsc -p tsconfig.app.json --noEmit 2>&1 | grep -c "error TS"` ≤ número da Tarefa 0.
- [ ] `npm.cmd run build` passa.
- [ ] Screenshots depois (desktop claro, escuro, mobile) lado a lado com os da Tarefa 0 e com a referência do WhatsApp.
- [ ] Casos: texto curto, texto longo, negrito com quebra de linha, foto, áudio, documento, resposta citada, encaminhada, editada, apagada, reação, grupo, modo de seleção (checkbox), mensagem fixada, balão de falha com "tentar novamente".

### Tarefa 12: Publicar (só com autorização explícita)

- [ ] Perguntar ao usuário antes. Produção builda de `main` no EasyPanel — conferir `source.ref` antes (por `listPorts`, não `inspectAppService`, que derrama o env).
- [ ] Depois do deploy, provar com uma string nova dentro do bundle servido (ex.: `aria-label="Opções da mensagem"`), não pelo "push aceito".
