# Análise Estratégica — Central Whats
**Para uso em brainstorming com IA — Versão 2026-06-18**

---

## 1. O QUE É O SISTEMA

**Central Whats** é uma plataforma SaaS de atendimento via WhatsApp voltada para equipes corporativas brasileiras. O sistema permite que múltiplos atendentes gerenciem conversas de vários números WhatsApp a partir de uma única interface centralizada, com controle de acesso por departamento.

### Conceito Central

```
Vários números WhatsApp (Evolution API)
        ↓
  Central Whats (Web ou Desktop)
        ↓
Equipe de atendimento (múltiplos usuários)
```

O diferencial de negócio é: **um único painel para gerenciar muitos dispositivos WhatsApp com equipe multiusuário, dashboard analítico, automações e IA**.

---

## 2. MÓDULOS — O QUE EXISTE E COMO FUNCIONA DE VERDADE

### 2.1 Dashboard (Analytics)

**O que faz:**
- Métricas de mensagens com seleção de período: Hoje / Ontem / 7 dias / 30 dias
- Gráfico de área (Recharts) com 3 séries: Recebidas, Enviadas, Enviadas por mim
- Top 6 conversas mais ativas do período
- Cards por dispositivo: inbound, outbound, enviadas pelo próprio usuário
- Contadores globais: Total não lidas + Pendentes de resposta

**Como calcula "Pendente de Resposta":**
Uma conversa é pendente se:
1. A última mensagem é `direction = 'inbound'` (chegou do contato)
2. E NÃO há `responded_at` na tabela `conversation_states` posterior a essa mensagem

Ou seja: é a quantidade de conversas aguardando resposta da equipe. Muito útil para SLA.

**Filtros por dispositivo:** o usuário pode selecionar quais dispositivos incluir nas métricas. Admin vê todos; operador vê apenas os que tem permissão.

**Granularidade do gráfico:**
- Período de 1 dia → blocos de 2 horas (00h, 02h, 04h...)
- Período de múltiplos dias → agrupado por dia (DD/MM)

---

### 2.2 Chat Hub (Central de Atendimento)

**O que faz:**
É o núcleo do sistema. Onde o atendimento acontece de fato.

**Componentes:**
- **Lista lateral redimensionável** (300px–520px, salvo no localStorage)
- **Janela de conversa central** (mínimo 420px)
- **Seletor de dispositivo** (dropdown com os dispositivos permitidos do usuário)

**Funcionalidades do Chat:**
- Conversas agrupadas por dispositivo selecionado
- Lista ordenada por última mensagem
- Contagem de não lidas por conversa
- Conversas arquivadas (toggle "mostrar arquivadas")
- Badge de notas vinculadas ao contato (ícone aparece quando há notas)
- Resumo da última mensagem no item da lista

**Sistema de Notificações (muito sofisticado):**
- Som gerado via Web Audio API (síntese de oscilador — não precisa de arquivo de áudio)
- Notificação nativa do browser (Notification API)
- Configuração POR DISPOSITIVO: som on/off e notificação background on/off
- Preferências salvas no localStorage por userId

**Criação de Contato:**
- Modal no Chat Hub com campos: Nome, DDD, Número
- Cria o contato no banco e abre a conversa automaticamente

**Persistência de estado:**
- Conversa ativa salva no `sessionStorage` — sobrevive a reload da página
- Dispositivo selecionado persistido

**ChatWindow (janela de mensagens) — 2.400 linhas:**
- Renderiza: texto, imagem, vídeo, áudio (player nativo), documento/arquivo
- Detecta números de telefone no texto → menu clicável (copiar / abrir conversa)
- Formatação inline do WhatsApp: *negrito*, _itálico_, ~tachado~, ```código```
- Respostas (reply_to) com snapshot do conteúdo original
- Mensagens de grupo: exibe nome do participante por mensagem
- Reações (emoji reactions) nas mensagens
- Ações por mensagem: responder, copiar texto, excluir (soft delete)
- Gatilhos de resposta rápida integrados (seletor no campo de input)
- Agendamento de mensagem direto pelo chat
- Assistente IA (botão para sugestão de resposta)
- Assinatura automática inserida na mensagem (por usuário ou por dispositivo)

---

### 2.3 CRM (Gestão de Tarefas — Kanban)

**O que faz REALMENTE (atenção: não é lista de contatos):**
É um board Kanban de tarefas vinculadas a contatos.

**Colunas:**
- Pendente → Em Andamento → Concluído

**Funcionalidades:**
- Drag & drop nativo (HTML5 Drag API) entre colunas
- Cada card mostra: título, descrição (2 linhas), nome do contato vinculado, data de criação
- Avatar do contato no card
- Atualização de status em tempo real via Realtime
- Exclusão de tarefa com confirmação

**Limitação atual:** tarefas são criadas pelo ChatWindow (dentro do chat), não diretamente nesta página. A página CRM só exibe e move as tarefas.

---

### 2.4 Mensagens Agendadas

**O que faz:**
Permite agendar mensagens para envio futuro. Execução via cron job no PostgreSQL.

**Status de ciclo de vida:**
```
pending → processing → sent
                   ↘ failed → (retry) → pending novamente
cancelled (manual)
```

**Funcionalidades:**
- Tabela com todas as mensagens agendadas
- Filtro visual por status com badges coloridos
- Cancelar mensagens pendentes
- Reenviar mensagens com falha (botão "Reenviar")
- Excluir registros
- Suporte a anexos (ícone de paperclip na tabela)
- Exibe erro de falha quando `status = 'failed'`

**Mecanismo de execução:** cron job em PostgreSQL (`pg_cron`) roda a cada minuto. Busca `scheduled_at <= now() AND status = 'pending'`, chama a Edge Function `send-message` para cada uma.

**Agendamento** ocorre dentro do ChatWindow, não nesta tela. Esta tela é só gestão/histórico.

---

### 2.5 Gatilhos de Mensagem

**O que faz REALMENTE (atenção: NÃO é automação por palavra-chave):**
São **templates de mensagens rápidas** para uso manual no chat.

**Funcionalidades:**
- Criar / editar / excluir templates
- Cada template tem: título (para busca) + conteúdo (texto)
- Suporta formatação WhatsApp (*negrito*, _itálico_ etc.)
- Busca por título em tempo real
- Integrado ao ChatWindow: botão de "Gatilhos" abre seletor → insere texto no campo de mensagem

**Nome pode confundir:** "Gatilho" aqui não dispara automaticamente — é um atalho de texto manual, equivalente a "respostas salvas" ou "canned responses".

---

### 2.6 Notas

**O que faz:**
Sistema simples de anotações globais (não apenas vinculadas a contatos).

**Funcionalidades:**
- Criar / excluir notas (edição não implementada na tela principal)
- Busca por título e conteúdo
- Vinculação a contato via `contact_jid` e `contact_name`
- Categorias: geral, financeiro, rh, administrativo
- Atualização em tempo real via Realtime
- Badge de contagem de notas na lista de conversas do Chat Hub

**Observação:** notas podem ser criadas diretamente do ChatWindow (vinculadas ao contato ativo) ou da tela de Notas (globalmente).

---

### 2.7 Dispositivos

**O que faz:**
Gerencia as instâncias Evolution API (números WhatsApp conectados).

**Funcionalidades (via Admin):**
- Importar instâncias da Evolution API (botão "Sincronizar")
- Configurar webhooks automaticamente para cada instância
- Ver status de conexão
- Vincular instância a departamento

---

### 2.8 Assistente IA

**O que faz:**
Sugestão de resposta com IA dentro do ChatWindow.

**Estrutura:**
- Tabela `ai_assistant_prompts` com prompts customizáveis
- Campos: `label` (nome do botão), `action_key` (identificador), `system_prompt` (instrução do modelo)
- `is_global` (visível a todos) vs. pessoal
- `is_active` (habilitar/desabilitar sem excluir)
- Admin pode criar prompts globais; usuário comum cria apenas pessoais

**Edge Function `ai-message-assist`:**
Recebe contexto da conversa + system_prompt escolhido → retorna sugestão de texto

---

### 2.9 Etiquetas (Labels)

**O que faz:**
Categorização visual de conversas.

**Estrutura:**
- Tabela `labels`: nome + cor (hex) por usuário
- Tabela `contact_tags`: vincula `device_id + remote_sender` a `label_id`
- Uma conversa pode ter múltiplas etiquetas

**Como usar:**
- Criar etiquetas com cor customizada em Settings > Etiquetas
- Aplicar etiqueta à conversa no ChatWindow
- Filtrar conversas por etiqueta na lista do Chat Hub

---

### 2.10 Admin

**O que faz:**
Painel de gestão completo da plataforma (apenas `is_admin = true`).

**Gestão de Usuários:**
- Criar / editar / excluir usuários do sistema
- Campos: nome, email, username, senha, departamento, is_admin
- Vincular usuário a dispositivos específicos (acesso granular)
- Usuários agrupados por departamento

**Gestão de Dispositivos:**
- Editar nome e departamento de dispositivos
- Importar novas instâncias da Evolution API
- Configurar webhooks em massa (um clique)

**Departamentos disponíveis:** Financeiro, Administrativo, RH, Comercial (+ departamentos customizados dos devices)

---

### 2.11 Configurações

**GeneralSettings:**
- Editar perfil: nome, username, assinatura pessoal
- Assinaturas por instância (via `SignatureManagerDialog`)
- Tema claro/escuro (next-themes)

**LabelsSettings:**
- Criar / excluir etiquetas com nome e cor

**AiAssistantSettings:**
- Criar / editar / excluir prompts IA
- Toggle `is_active` e `is_global`

**InstancesSettings:**
- Configurações específicas de instâncias conectadas

---

## 3. ARQUITETURA TÉCNICA REAL

### Stack Completo
```
Frontend:   React 19 + TypeScript + Vite + Tailwind + Shadcn/Radix
Backend:    Supabase (PostgreSQL + Auth + Realtime + Edge Functions Deno)
WhatsApp:   Evolution API (multi-instância)
Desktop:    Electron 42 + electron-updater (Windows)
Deploy:     Docker + Nginx | EasyPanel
```

### Tabelas do Banco (confirmadas pelo código)
```
profiles              → usuários (name, email, is_admin, signature, department)
devices               → instâncias WhatsApp (instance_key, department, status)
user_allowed_devices  → permissão usuário↔dispositivo
contacts              → contatos (remote_jid, name, nickname, avatar_url)
messages              → mensagens (direction, content, attachments, reactions, reply_to)
conversation_states   → metadados de conversa por usuário (responded_at)
labels                → etiquetas (name, color, user_id)
contact_tags          → etiqueta aplicada a conversa (device_id + remote_sender + label_id)
notes                 → anotações (title, content, contact_jid, category)
message_triggers      → templates de resposta rápida (title, content)
scheduled_messages    → agendamentos (scheduled_at, status, retry_count, error_message)
tasks                 → tarefas Kanban (title, description, status, contact_id)
ai_assistant_prompts  → prompts IA (label, action_key, system_prompt, is_global)
```

### Edge Functions (8 functions serverless)
```
send-message             → envia mensagem via Evolution API
evolution-webhook        → recebe mensagens chegando (webhook Evolution)
sync-instances           → sincroniza status das instâncias
evolution-instances      → operações CRUD em instâncias
evolution-history-import → importa histórico ao conectar nova instância
ai-message-assist        → gera sugestão de resposta com IA
contact-avatar           → busca/atualiza URL de avatar do WhatsApp
manage-user              → criar/editar/desativar usuários (admin)
```

### Sistema de Tempo Real
O hook `useRealtime` usa Supabase Realtime (WebSocket) para escutar mudanças no PostgreSQL. Cada tabela crítica (`messages`, `tasks`, `notes`, `labels`, `message_triggers`, `scheduled_messages`) tem subscription ativa nas telas relevantes.

### Sistema de Permissões (Multi-tenancy)
```
Admin  → vê todos os dispositivos, gerencia usuários, cria prompts globais
Usuário → vê apenas dispositivos de user_allowed_devices
           cada usuário cria seus próprios labels, triggers, notes, scheduled_messages
           profiles.is_admin controla acesso ao AdminPage
```

---

## 4. O QUE ESTÁ FUNCIONANDO (STATUS ATUAL)

### ✅ Implementado e Funcional
- Autenticação completa (login, logout, refresh, recuperação)
- Multi-tenancy com controle de acesso por dispositivo
- Chat em tempo real (WebSocket + Realtime)
- Envio e recebimento de mensagens (texto, imagem, vídeo, áudio, documento)
- Notificações (som sintetizado + browser notification)
- Agendamento de mensagens com cron job
- Gatilhos (templates de resposta rápida)
- Etiquetas coloridas com filtro na lista de conversas
- Notas globais e vinculadas a contatos
- Board Kanban de tarefas (CRM)
- Dashboard analytics com gráficos e métricas por período
- Assistente IA configurável com prompts customizados
- Histórico de importação de conversas ao conectar novo dispositivo
- Assinatura pessoal e por dispositivo
- Avatar dos contatos com fallback inteligente
- Normalização de números brasileiros (JIDs WhatsApp)
- Grupos WhatsApp (renderiza nome do participante por mensagem)
- Reações em mensagens (emoji reactions)
- Reply com snapshot da mensagem original
- Soft delete de mensagens
- Desktop App Electron com auto-updater
- Build Docker + deploy EasyPanel
- Tema claro/escuro

### ⚠️ Implementado Parcialmente / Com Ressalvas
- **CRM (Kanban):** tarefas só podem ser criadas pelo ChatWindow, não pelo CRM diretamente
- **Gatilhos:** são templates manuais, não automações por palavra-chave (pode gerar confusão)
- **Notas:** sem edição (só criação + exclusão) na tela principal
- **Filtro de dispositivo no Dashboard:** existe mas muda apenas o painel de stats, não o gráfico separadamente
- **Dispositivos:** tela ainda incompleta para usuário não-admin

### ❌ Não Implementado (identificado pelo código)
- Automação real por palavra-chave (resposta automática quando contato digita X)
- Histórico de busca de mensagens (fulltext search)
- Relatórios exportáveis (PDF/Excel)
- Atribuição de conversas a atendentes específicos
- Status de conversa (aberto/fechado/em espera)
- Tempo médio de resposta (TMA) nas métricas
- Satisfação/avaliação do atendimento (CSAT)
- Transferência de conversa entre atendentes
- Fila de atendimento
- Integração com CRM externo (Salesforce, HubSpot, etc.)
- API pública para integrações de terceiros

---

## 5. LACUNAS IDENTIFICADAS E OPORTUNIDADES ESTRATÉGICAS

### Lacuna 1 — CRM Real (além do Kanban)
O sistema tem `contacts` no banco com campos ricos (name, nickname, avatar), mas não tem uma tela de lista/ficha de contato. O "CRM" atual é apenas um Kanban de tarefas. **Oportunidade:** tela de contatos com histórico de conversas, campos customizados, funil de vendas.

### Lacuna 2 — Automação Real por Palavras-chave
Os "Gatilhos" são só templates. **Oportunidade:** resposta automática quando receber mensagem contendo X palavra, com horário de funcionamento, fila de espera, mensagem de ausência.

### Lacuna 3 — Status de Conversa (Triagem)
Não há conceito de "conversa aberta/fechada". **Oportunidade:** sistema de triagem com atribuição de responsável, SLA por conversa, fila de espera com tempo de espera visível.

### Lacuna 4 — Métricas de Desempenho da Equipe
O Dashboard mede volume de mensagens mas não performance. **Oportunidade:** TMA (Tempo Médio de Atendimento), TMP (Tempo Médio de Primeira Resposta), CSAT, conversas por atendente.

### Lacuna 5 — Busca de Mensagens
Não há busca fulltext dentro das conversas. **Oportunidade:** buscar mensagem por texto em qualquer conversa, filtrar por data/tipo/dispositivo.

### Lacuna 6 — Integrações
Nenhuma integração com sistema externo. **Oportunidade:** webhook outgoing (notificar sistemas externos de novas mensagens), API REST pública, Zapier/n8n connector.

### Lacuna 7 — Campanha / Disparo em Massa
Há agendamento individual mas não para múltiplos contatos de uma vez. **Oportunidade:** disparar mensagem para lista de contatos (importação CSV, por etiqueta, por departamento).

### Lacuna 8 — Chatbot / Fluxo Conversacional
Sem fluxo de chatbot. **Oportunidade:** builder visual de fluxos (se mensagem = X → enviar Y → aguardar → se resposta = Z → fazer ação).

### Lacuna 9 — Atribuição de Conversa
Qualquer usuário vê todas as conversas do dispositivo. **Oportunidade:** atribuir conversa a atendente específico, fila de espera, transferência entre atendentes.

### Lacuna 10 — Mobile
Não há app mobile nativo. **Oportunidade:** PWA (já é SPA, baixo custo) ou app React Native.

---

## 6. MODELO DE DADOS — RELACIONAMENTOS CHAVE

```
profiles (1) ──────────────── (N) user_allowed_devices (N) ──── (1) devices
profiles (1) ──────────────── (N) notes
profiles (1) ──────────────── (N) message_triggers
profiles (1) ──────────────── (N) scheduled_messages
profiles (1) ──────────────── (N) labels
profiles (1) ──────────────── (N) ai_assistant_prompts
profiles (1) ──────────────── (N) tasks

devices (1) ────────────────── (N) messages
devices (1) ────────────────── (N) contact_tags

messages (N) ──────────────── (1) contacts    [via remote_sender = remote_jid]
messages (N) ──────────────── (1) messages    [reply_to_id → self-referential]

contacts (1) ───────────────── (N) tasks
contacts (1) ───────────────── (N) notes      [via contact_jid]

contact_tags (N) ──────────── (1) labels
contact_tags (N) ──────────── (1) devices
```

---

## 7. PADRÕES TÉCNICOS ADOTADOS

| Padrão | Implementação |
|--------|--------------|
| Realtime | `useRealtime` hook → Supabase WebSocket por tabela |
| Auth | JWT via Supabase Auth, refresh silencioso sem re-render |
| Multi-tenant | `user_allowed_devices` + RLS no banco |
| Notificações | Web Audio API (síntese) + Notification API |
| Avatar | SmartAvatar: URL local → Edge Function → fallback iniciais |
| Normalização JID | `src/lib/contacts/normalize.ts` — índice O(1) em memória |
| Formulários | React Hook Form + Zod validation |
| Toast | Sonner (não o toast nativo do Radix) |
| Tema | next-themes com CSS variables do Tailwind |
| Deploy | Docker multi-stage + Nginx SPA + runtime env injection |
| Desktop | Electron com contextIsolation + preload bridge |
| Auto-update | electron-updater → GitHub Releases |

---

## 8. CONTEXTO DE PRODUTO (MERCADO)

- **Público-alvo:** Empresas brasileiras com equipe de atendimento via WhatsApp (PMEs a mid-market)
- **Concorrentes diretos:** Zenvia, Kommo, Wati, Notificame, Huggy, Octadesk
- **Diferencial técnico:** Totalmente self-hosted (Evolution API + Supabase), sem custo por mensagem
- **Idioma:** 100% português do Brasil
- **Foco:** B2B — equipes internas de atendimento, não bots públicos
- **Plataformas:** Web (Docker) e Desktop Windows (Electron) — mesma codebase

---

## 9. FLUXO DE ATENDIMENTO (Como um atendente usa o sistema)

```
1. Atendente faz login → vê Dashboard com métricas do dia
2. Vai para Chat Hub → seleciona seu dispositivo WhatsApp
3. Lista mostra conversas ordenadas por mais recente
4. Clica em conversa → abre ChatWindow
5. Lê mensagem → pode:
   a. Responder manualmente
   b. Usar Gatilho (template rápido)
   c. Pedir sugestão ao Assistente IA
   d. Aplicar etiqueta à conversa
   e. Agendar resposta para outra hora
   f. Criar nota sobre o contato
   g. Criar tarefa (vai para Kanban CRM)
   h. Clicar em número de telefone no texto → copiar ou abrir nova conversa
6. Conversa respondida → próxima conversa
```

---

## 10. RESUMO PARA GERAÇÃO DE NOVAS IDEIAS

**O sistema JÁ TEM:**
`Login multiusuário` + `Múltiplos WhatsApp` + `Chat em tempo real` + `Analytics` + `Templates de resposta` + `Agendamento` + `Etiquetas` + `Notas` + `Tarefas Kanban` + `Assistente IA configurável` + `Desktop App` + `Admin completo`

**O sistema NÃO TEM (maiores oportunidades):**
1. **Automação real** (chatbot, resposta automática por palavras-chave, fluxos)
2. **Status de conversa** (triagem, atribuição, fila)
3. **Disparo em massa** (campanha para lista de contatos)
4. **Métricas de performance** (TMA, CSAT, por atendente)
5. **Busca fulltext** nas mensagens
6. **CRM completo** (ficha do cliente, histórico, campos customizados)
7. **Integrações externas** (webhooks, API, n8n/Zapier)
8. **Relatórios exportáveis**

**Stack disponível para implementação:**
React + TypeScript + Supabase Edge Functions (Deno) + PostgreSQL + Evolution API + Tailwind/Shadcn

**Restrições importantes:**
- Todo acesso ao WhatsApp DEVE passar pelas Edge Functions (nunca direto no frontend)
- Sistema é multi-tenant com RLS no banco
- Realtime via Supabase WebSocket já disponível para qualquer tabela nova
- Código em português brasileiro
