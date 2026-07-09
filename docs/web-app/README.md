# Web App — Central Whats

Central de atendimento WhatsApp construída como Single Page Application (SPA) em React, servida via Nginx dentro de um container Docker.

## O Que É

O **Central Whats** é uma plataforma de atendimento via WhatsApp voltada para o mercado brasileiro. Permite que equipes gerenciem conversas de múltiplos dispositivos WhatsApp a partir de uma interface centralizada.

## Funcionalidades Principais

| Funcionalidade | Descrição |
|---|---|
| **Chat Hub** | Interface principal de conversas com filtros e busca |
| **CRM** | Gestão de contatos e relacionamentos |
| **Agendamento** | Envio de mensagens programadas |
| **Gatilhos** | Automação de respostas por palavras-chave |
| **Dispositivos** | Gerenciamento de instâncias WhatsApp conectadas |
| **Notas** | Anotações vinculadas a contatos |
| **Etiquetas** | Categorização de conversas |
| **Assistente IA** | Sugestões de resposta via IA |
| **Painel Admin** | Controle de usuários e configurações gerais |
| **Tema** | Suporte a modo escuro e claro |

## Stack Tecnológica

### Frontend
| Tecnologia | Versão | Uso |
|---|---|---|
| React | 19.2.5 | Framework principal |
| TypeScript | 6.0.3 | Tipagem estática |
| Vite | 8.0.10 | Bundler e dev server |
| React Router DOM | 7.14.2 | Roteamento SPA |
| Tailwind CSS | 3.4.19 | Estilização utilitária |
| Shadcn UI / Radix UI | — | Componentes de interface |
| React Hook Form | 7.75.0 | Gerenciamento de formulários |
| Zod | 4.4.2 | Validação de esquemas |
| Recharts | 2.15.4 | Gráficos e visualizações |
| Sonner | 2.0.7 | Notificações toast |
| next-themes | 0.4.6 | Tema claro/escuro |

### Backend (Supabase)
| Tecnologia | Uso |
|---|---|
| Supabase Auth | Autenticação JWT |
| Supabase PostgreSQL | Banco de dados relacional |
| Supabase Realtime | Atualizações em tempo real |
| Supabase Edge Functions | Funções serverless (Deno) |

### Produção
| Tecnologia | Uso |
|---|---|
| Docker | Containerização |
| Nginx | Servidor de arquivos estáticos + SPA routing |
| EasyPanel | Plataforma de deploy recomendada |

## Documentação Detalhada

- [Arquitetura](./arquitetura.md) — Diagrama e explicação da arquitetura
- [Páginas e Rotas](./paginas-e-rotas.md) — Todas as páginas e suas responsabilidades
- [Componentes Chave](./componentes-chave.md) — Componentes críticos do sistema
- [Serviços e API](./servicos-e-api.md) — Camada de serviços e comunicação com Supabase
- [Backend — Edge Functions](./backend-edge-functions.md) — Funções serverless
- [Variáveis de Ambiente](./variaveis-de-ambiente.md) — Configuração de ambiente
- [Deploy](./deploy.md) — Guia de implantação em produção

## Início Rápido (Desenvolvimento)

```bash
# 1. Instalar dependências
npm install

# 2. Criar arquivo de ambiente
cp .env.example .env.local
# Editar .env.local com suas credenciais Supabase

# 3. Iniciar servidor de desenvolvimento
npm run dev
# Acesse: http://localhost:8080
```

## Scripts Disponíveis

```bash
npm run dev          # Servidor de desenvolvimento (porta 8080)
npm run build        # Build de produção em dist/
npm run preview      # Preview da build de produção
npm run lint         # Lint com oxlint
npm run lint:fix     # Lint com correção automática
npm run format       # Formatar código com oxfmt
npm run format:check # Verificar formatação sem alterar
```

## Versão Atual

`0.0.141` — ver `package.json`
