# Serviços e API — Web App

A camada de serviços em `src/services/` abstrai toda comunicação com o Supabase e as Edge Functions.

## Visão Geral

```
src/services/
├── contacts.ts                  # CRUD de contatos
├── messages.ts                  # CRUD de mensagens
├── devices.ts                   # Sincronização de dispositivos
├── evolution_instances.ts       # Gerenciamento de instâncias Evolution API
├── evolution_history_import.ts  # Importação de histórico de conversas
├── conversation_states.ts       # Estado e metadados de conversas
├── scheduled_messages.ts        # Agendamento de mensagens
├── labels.ts                    # Etiquetas de conversa
├── notes.ts                     # Notas de contatos
└── users.ts                     # Dados de usuários
```

## Serviços Principais

### `contacts.ts`

Operações sobre a tabela `contacts` do Supabase.

**Funções principais:**

| Função | Descrição |
|---|---|
| `getContacts()` | Busca todos os contatos do usuário |
| `getContactByJid(jid)` | Busca contato por `remote_jid` |
| `updateContactByJid(jid, data)` | Atualiza ou cria contato pelo JID |
| `fetchAvatar(jid, instanceName)` | Busca URL de avatar via `contact-avatar` Edge Function |

**Throttling de avatar:** o serviço implementa fila de requisições com throttling para evitar rate limiting do WhatsApp CDN ao buscar múltiplos avatares simultaneamente.

---

### `messages.ts`

Operações sobre a tabela `messages`.

**Funções principais:**

| Função | Descrição |
|---|---|
| `getMessages(contactJid, deviceId)` | Busca histórico de mensagens de uma conversa |
| `sendMessage(payload)` | Chama Edge Function `send-message` |
| `markAsRead(conversationId)` | Marca conversa como lida |
| `deleteMessage(messageId)` | Exclui mensagem localmente |

---

### `devices.ts`

Sincronização e listagem de dispositivos WhatsApp.

**Funções principais:**

| Função | Descrição |
|---|---|
| `getDevices()` | Lista todos os dispositivos do usuário |
| `syncDevices()` | Chama Edge Function `sync-instances` para atualizar status |
| `getDeviceStatus(instanceName)` | Retorna status de conexão de uma instância |

---

### `evolution_instances.ts`

Interface com as instâncias da Evolution API (via Edge Functions).

**Funções principais:**

| Função | Descrição |
|---|---|
| `listInstances()` | Lista instâncias via Edge Function `evolution-instances` |
| `connectInstance(name)` | Conecta instância e gera QR Code |
| `disconnectInstance(name)` | Desconecta instância |

---

### `evolution_history_import.ts`

Importação de histórico de conversas de uma instância recém-conectada.

**Uso:** chamado ao conectar nova instância para trazer mensagens anteriores do WhatsApp para o banco de dados.

---

### `scheduled_messages.ts`

Gerenciamento de mensagens agendadas.

**Funções principais:**

| Função | Descrição |
|---|---|
| `createScheduledMessage(data)` | Cria novo agendamento |
| `getScheduledMessages()` | Lista agendamentos pendentes |
| `cancelScheduledMessage(id)` | Cancela agendamento |

**Nota:** O envio efetivo é realizado por um **cron job** no banco de dados (PostgreSQL cron), configurado nas migrations do Supabase. O cron verifica mensagens com `scheduled_at <= now()` a cada minuto.

---

### `labels.ts`

Etiquetas de categorização de conversas.

**Funções principais:**

| Função | Descrição |
|---|---|
| `getLabels()` | Lista todas as etiquetas disponíveis |
| `applyLabel(conversationId, labelId)` | Aplica etiqueta a uma conversa |
| `removeLabel(conversationId, labelId)` | Remove etiqueta de uma conversa |

---

### `notes.ts`

Notas vinculadas a contatos.

**Funções principais:**

| Função | Descrição |
|---|---|
| `getNotesByContact(contactId)` | Lista notas de um contato |
| `createNote(data)` | Cria nova nota |
| `updateNote(id, data)` | Atualiza nota existente |
| `deleteNote(id)` | Exclui nota |

## Cliente Supabase

Configurado em `src/lib/supabase/client.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = window.__env?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
const supabaseKey = window.__env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)
```

**Nota sobre `window.__env`:** em produção (Docker), as variáveis são injetadas via `/env-config.js` carregado no `index.html`. Em desenvolvimento, vêm do `.env.local` via `import.meta.env`.

## Padrão de Chamada às Edge Functions

```typescript
const { data, error } = await supabase.functions.invoke('nome-da-funcao', {
  body: { /* payload */ },
})

if (error) throw error
return data
```

As Edge Functions são autenticadas automaticamente pelo `supabase-js`, que inclui o JWT do usuário logado no header `Authorization`.
