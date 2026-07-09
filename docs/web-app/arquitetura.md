# Arquitetura — Web App

## Diagrama Geral

```
┌─────────────────────────────────────────────────────────────────┐
│                         USUÁRIO                                  │
│                    (Navegador / App)                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              FRONTEND (React SPA)                                │
│         Docker Container → Nginx → dist/index.html              │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ ChatHub  │  │   CRM    │  │Dispositiv│  │   Settings   │   │
│  │          │  │          │  │    os    │  │              │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │             Camada de Serviços (src/services/)           │   │
│  │  contacts │ messages │ devices │ labels │ scheduled_msg  │   │
│  └─────────────────────────┬───────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────────┘
                             │ supabase-js (REST + Realtime)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SUPABASE                                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │     Auth     │  │  PostgreSQL  │  │   Realtime Sub.    │   │
│  │  (JWT/Email) │  │  (Tabelas +  │  │  (websocket live   │   │
│  │              │  │  Migrations) │  │   updates)         │   │
│  └──────────────┘  └──────────────┘  └────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Edge Functions (Deno)                        │  │
│  │                                                           │  │
│  │  send-message  │  evolution-webhook  │  sync-instances   │  │
│  │  ai-message-assist  │  contact-avatar  │  manage-user    │  │
│  └──────────────────────┬────────────────────────────────────┘  │
└───────────────────────────┼──────────────────────────────────────┘
                            │ REST API
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EVOLUTION API                                  │
│              (Gateway WhatsApp Business)                         │
│                                                                  │
│   Instância 1    │    Instância 2    │    Instância N            │
│  (Dispositivo)   │   (Dispositivo)  │   (Dispositivo)           │
└─────────────────────────────────────────────────────────────────┘
```

## Princípio de Segurança

O frontend **nunca** chama a Evolution API diretamente. Todo acesso à Evolution API passa pelas **Supabase Edge Functions**, que:

1. Validam o JWT do usuário autenticado
2. Verificam permissões via RLS
3. Executam a operação na Evolution API
4. Retornam o resultado ao frontend

Isso garante que as credenciais da Evolution API (API key, endpoint) fiquem **apenas no servidor**, nunca expostas no cliente.

## Estrutura de Diretórios

```
SITE/Central-Whats/
├── src/                          # Código-fonte React
│   ├── pages/                    # Páginas da aplicação (rotas)
│   ├── components/               # Componentes reutilizáveis
│   │   ├── ui/                   # Componentes Shadcn/Radix (primitivos)
│   │   ├── chat/                 # Componentes do módulo de chat
│   │   └── ...                   # Outros componentes
│   ├── services/                 # Camada de comunicação com Supabase
│   ├── lib/                      # Utilitários e helpers
│   │   ├── supabase/             # Cliente Supabase e tipos
│   │   └── contacts/             # Normalização de contatos
│   └── hooks/                    # React Hooks customizados
│
├── supabase/
│   ├── functions/                # Edge Functions (Deno)
│   └── migrations/               # Migrations SQL do banco
│
├── central-whats-app/            # Configuração do Electron (Desktop App)
├── public/                       # Assets estáticos (logo, favicon)
├── dist/                         # Build de produção (gerado)
├── Dockerfile                    # Build Docker multi-stage
├── nginx.conf                    # Configuração Nginx (SPA routing)
├── vite.config.ts                # Configuração do Vite
├── tailwind.config.ts            # Configuração do Tailwind
└── tsconfig.json                 # Configuração TypeScript
```

## Fluxo de Dados

### Recebimento de Mensagem
```
Evolution API
    → Webhook para Edge Function (evolution-webhook)
    → Edge Function salva mensagem no PostgreSQL
    → Supabase Realtime notifica todos os clientes conectados
    → Frontend atualiza a UI em tempo real
```

### Envio de Mensagem
```
Usuário clica em "Enviar"
    → Frontend chama Edge Function (send-message)
    → Edge Function valida JWT + permissões
    → Edge Function chama Evolution API com a mensagem
    → Evolution API entrega ao destinatário
    → Edge Function salva mensagem enviada no banco
    → Frontend atualiza a UI
```

### Autenticação
```
Usuário faz login
    → Supabase Auth valida credenciais
    → Supabase retorna JWT (access + refresh token)
    → Frontend armazena token via supabase-js
    → Todas as requisições subsequentes incluem o JWT
    → RLS do banco filtra dados pelo user_id do JWT
```

## Multi-tenancy e Isolamento de Dados

O banco usa **Row Level Security (RLS)** do PostgreSQL. Cada usuário só vê os dados vinculados ao seu `user_id` ou à sua organização. As políticas RLS são definidas nas migrations em `supabase/migrations/`.

## Realtime

O Supabase Realtime usa WebSockets para push de atualizações. O frontend se inscreve em canais de tabelas relevantes (ex: `messages`, `contacts`) e recebe eventos de `INSERT`, `UPDATE`, `DELETE` sem polling.
