# Componentes Chave — Web App

Documentação dos componentes mais importantes e sua responsabilidade no sistema.

## Estrutura de Componentes

```
src/components/
├── ui/                        # Primitivos Shadcn/Radix (não editar diretamente)
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── dropdown-menu.tsx
│   ├── input.tsx
│   ├── select.tsx
│   └── ... (60+ componentes)
│
├── chat/                      # Módulo de chat
│   ├── ChatWindow.tsx         # Janela de mensagens (componente crítico)
│   ├── ChatList.tsx           # Lista de conversas
│   ├── ConversationFilters.tsx # Filtros e busca
│   ├── AudioMessage.tsx       # Player de áudio
│   └── SmartAvatar.tsx        # Avatar com fallback inteligente
│
├── Layout.tsx                 # Shell principal da aplicação
├── Header.tsx                 # Barra de navegação superior
├── AppSidebar.tsx             # Sidebar de navegação lateral
└── ...
```

## Componentes Críticos

### `ChatWindow.tsx` (~2.400 linhas)

O maior e mais complexo componente do sistema. Renderiza o chat ativo.

**Responsabilidades:**
- Renderizar histórico completo de mensagens (texto, áudio, imagem, vídeo, documento)
- Enviar mensagens via Edge Function `send-message`
- Renderizar mensagens inline com detecção de números de telefone
- Menu de ações por mensagem (responder, copiar, excluir)
- Botão e modal para adicionar novo contato
- Rolagem automática para nova mensagem
- Agrupamento de mensagens por data
- Exibição de nome de autor em grupos

**Dependências principais:**
- `src/services/messages.ts` — CRUD de mensagens
- `src/lib/contacts/normalize.ts` — normalização de JIDs
- `SmartAvatar.tsx` — avatares de participantes
- Supabase Realtime — atualização ao vivo

**Funções internas importantes:**
- `formatInline()` — processa texto da mensagem (negrito, links, números)
- `renderMessage()` — decide qual componente de mídia renderizar
- `splitByPhoneNumbers()` — separa texto em segmentos para o `PhoneNumberTrigger`
- `getDateLabel()` — rótulo de data com proteção contra datas inválidas

---

### `ChatList.tsx`

Lista lateral com todas as conversas do dispositivo selecionado.

**Responsabilidades:**
- Listar conversas ordenadas por última mensagem
- Exibir nome do contato (via `resolveContactDisplayName`)
- Preview da última mensagem
- Indicadores de mensagens não lidas
- Selecionar conversa ativa

**Componente interno `ChatRow`:**
- Recebe `contactIndex` para resolver nomes sem lookups repetidos
- Protege `previewLabel` contra `content` nulo
- Usa `Select` controlado (`value={selectedDeviceId ?? ''}`) para evitar aviso de controlled/uncontrolled

---

### `SmartAvatar.tsx`

Avatar inteligente com múltiplos níveis de fallback.

**Comportamento:**
1. Tenta exibir imagem de `avatar_url` do banco
2. Se 403/404, tenta buscar nova URL via `contact-avatar` Edge Function
3. Se ainda falhar, exibe iniciais do nome
4. Se não houver nome, exibe ícone padrão

---

### `Layout.tsx`

Shell principal que envolve todas as páginas autenticadas.

**Responsabilidades:**
- Renderizar `AppSidebar` e `Header`
- Prover contexto de tema (dark/light via `next-themes`)
- Prover `Toaster` do Sonner para notificações globais

---

### `AppSidebar.tsx`

Navegação lateral com todos os links do sistema.

**Itens de navegação:**
- Dashboard, Chat, CRM, Notas, Dispositivos, Gatilhos, Agendados, Admin, Configurações

---

### `ConversationFilters.tsx`

Filtros da lista de conversas no Chat Hub.

**Filtros disponíveis:**
- Por dispositivo/instância
- Por etiqueta
- Por status (lido, não lido, arquivado)
- Busca por nome ou número

## Camada de Utilitários

### `src/lib/contacts/normalize.ts`

Utilitário central de normalização de identificadores de contato WhatsApp.

**Funções exportadas:**

| Função | Descrição |
|---|---|
| `isGroupJid(jid)` | Retorna `true` se JID for de grupo (`@g.us`) |
| `normalizeToDigits(value)` | Remove não-dígitos do JID |
| `normalizeContactId(id)` | Normaliza qualquer formato de identificador |
| `buildContactIndex(contacts)` | Cria índice em memória O(1) para lookup |
| `findContactByIdentifier(id, index)` | Busca contato por qualquer formato de JID |
| `resolveContactDisplayName(jid, index, fallback)` | Resolve nome com prioridade: `nickname` > `name` > `sender_name` > número |
| `formatPhoneNumber(digits)` | Formata número brasileiro para exibição |

**Prioridade de nome de contato:**
```
nickname  (alias manual do usuário)
  ↓
name      (nome salvo no contato)
  ↓
sender_name (nome vindo da mensagem)
  ↓
número formatado (fallback visual)
```

### `src/lib/supabase/types.ts`

Tipos TypeScript centrais do banco de dados.

**Interfaces principais:**
- `Contact` — `remote_jid`, `name`, `nickname`, `avatar_url`, etc.
- `Message` — `id`, `content`, `direction`, `created_at`, `attachments`, etc.
- `Device` — `id`, `name`, `instance_name`, `status`, etc.

## Componentes UI (Shadcn/Radix)

A pasta `src/components/ui/` contém 60+ componentes primitivos gerados pelo Shadcn UI. Estes componentes **não devem ser editados manualmente** — são a camada base de design system.

Para adicionar novo componente Shadcn, use:
```bash
npx shadcn@latest add <nome-do-componente>
```
