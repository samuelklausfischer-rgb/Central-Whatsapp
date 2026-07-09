# Backend — Edge Functions

As Edge Functions são serverless functions escritas em **Deno/TypeScript**, hospedadas no Supabase. Todo acesso à Evolution API passa por elas.

## Localização

```
supabase/functions/
├── send-message/
├── evolution-webhook/
├── sync-instances/
├── evolution-instances/
├── evolution-history-import/
├── ai-message-assist/
├── contact-avatar/
└── manage-user/
```

## Functions

### `send-message`

**Trigger:** chamada direta pelo frontend ao enviar mensagem.

**Responsabilidades:**
1. Valida JWT do usuário
2. Recebe payload: `{ instanceName, remoteJid, message, messageType }`
3. Chama Evolution API para enviar mensagem WhatsApp
4. Salva mensagem enviada no banco (`messages`)
5. Retorna confirmação ao frontend

**Tipos de mensagem suportados:** texto, imagem, áudio, documento, vídeo.

---

### `evolution-webhook`

**Trigger:** chamada pela Evolution API quando chega nova mensagem.

**Responsabilidades:**
1. Recebe evento de webhook da Evolution API
2. Valida assinatura/origem do webhook
3. Normaliza payload para o formato do banco
4. Salva mensagem recebida em `messages`
5. Atualiza `conversation_states` (última mensagem, não lidas)
6. Supabase Realtime propaga automaticamente para clientes conectados

**Eventos tratados:**
- `messages.upsert` — nova mensagem recebida
- `messages.update` — atualização de status (enviado, entregue, lido)
- `connection.update` — mudança de status da instância

---

### `sync-instances`

**Trigger:** acionada manualmente pelo usuário na tela de Dispositivos.

**Responsabilidades:**
1. Busca todas as instâncias da Evolution API
2. Sincroniza status de cada instância com a tabela `devices`
3. Atualiza campos: `status`, `battery`, `is_connected`, `last_seen`

---

### `evolution-instances`

**Trigger:** acionada pelo frontend para operações de instância.

**Operações:**
- `list` — listar instâncias
- `connect` — conectar instância (gera QR Code)
- `disconnect` — desconectar instância
- `delete` — remover instância

---

### `evolution-history-import`

**Trigger:** acionada ao conectar nova instância.

**Responsabilidades:**
1. Busca histórico de conversas da Evolution API
2. Salva mensagens históricas em `messages`
3. Cria/atualiza contatos baseado nos participantes
4. Processa em lotes para evitar timeout

---

### `ai-message-assist`

**Trigger:** acionada quando o usuário solicita sugestão de resposta.

**Responsabilidades:**
1. Recebe contexto da conversa (últimas N mensagens)
2. Chama modelo de IA (configurável)
3. Retorna sugestão de resposta ao frontend

---

### `contact-avatar`

**Trigger:** acionada pelo `SmartAvatar` quando avatar local está expirado.

**Responsabilidades:**
1. Recebe `jid` e `instanceName`
2. Chama Evolution API para buscar URL de avatar do contato
3. Retorna URL atualizada
4. Frontend armazena nova URL em `contacts.avatar_url`

---

### `manage-user`

**Trigger:** acionada por administradores.

**Responsabilidades:**
- Criar novo usuário no Supabase Auth
- Atualizar papel/permissões de usuário
- Desativar conta de usuário

## Banco de Dados (Migrations)

As migrations ficam em `supabase/migrations/` e definem:

### Tabelas Principais

| Tabela | Descrição |
|---|---|
| `contacts` | Contatos WhatsApp (`remote_jid`, `name`, `nickname`, `avatar_url`) |
| `messages` | Mensagens (`content`, `direction`, `created_at`, `attachments`) |
| `devices` | Instâncias Evolution API (`instance_name`, `status`, `battery`) |
| `conversation_states` | Estado de cada conversa (não lidas, último acesso) |
| `labels` | Etiquetas de categorização |
| `scheduled_messages` | Mensagens agendadas (`scheduled_at`, `status`) |
| `notes` | Notas vinculadas a contatos |
| `triggers` | Gatilhos de resposta automática |

### Cron Job de Agendamento

A migration de agendamento instala um **cron job PostgreSQL** (via `pg_cron`) que:
- Executa a cada **1 minuto**
- Busca mensagens com `scheduled_at <= now()` e `status = 'pending'`
- Chama a Edge Function `send-message` para cada uma
- Atualiza `status` para `'sent'` ou `'error'`

### RLS — Row Level Security

Todas as tabelas têm RLS ativado. Políticas básicas:
- Usuário só lê/escreve dados do próprio `user_id`
- Edge Functions usam `service_role` key (ignora RLS quando necessário)

## Publicar Edge Functions

As Edge Functions **não entram no Docker** do frontend. Devem ser publicadas separadamente:

```bash
# Via CLI do Supabase
supabase functions deploy send-message
supabase functions deploy evolution-webhook
# ... (repetir para cada função)

# Ou publicar todas de uma vez
supabase functions deploy
```

Alternativa: pelo **painel do Supabase** em _Edge Functions_ → _Deploy_.

## Variáveis de Ambiente das Edge Functions

Configurar no painel do Supabase em _Settings_ → _Edge Functions_ → _Environment Variables_:

| Variável | Descrição |
|---|---|
| `EVOLUTION_API_URL` | URL base da Evolution API |
| `EVOLUTION_API_KEY` | API Key da Evolution API |
| `SUPABASE_URL` | URL do projeto Supabase (automático) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (automático) |
