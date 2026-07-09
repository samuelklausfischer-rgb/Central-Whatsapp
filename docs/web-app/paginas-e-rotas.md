# Páginas e Rotas — Web App

Todas as rotas são gerenciadas por **React Router DOM v7** como SPA.

## Mapa de Rotas

```
/                → Index.tsx          (Dashboard)
/login           → Login.tsx          (Autenticação)
/chat            → ChatHub.tsx        (Chat principal)
/crm             → CRM.tsx            (Gestão de contatos)
/notes           → Notes.tsx          (Notas)
/devices         → Devices.tsx        (Dispositivos)
/triggers        → Triggers.tsx       (Gatilhos automáticos)
/scheduled       → ScheduledMessages.tsx (Mensagens agendadas)
/admin           → admin/             (Área administrativa)
/settings        → settings/          (Configurações)
/*               → NotFound.tsx       (404)
```

## Proteção de Rotas

- **`ProtectedRoute`** — envolve todas as rotas autenticadas. Redireciona para `/login` se não houver sessão Supabase ativa.
- **`AdminRoute`** — envolve rotas administrativas. Verifica se o usuário tem papel de administrador.

## Páginas

### `/` — Dashboard (Index.tsx)

Visão geral do sistema com métricas em tempo real:

- Status de cada dispositivo WhatsApp conectado (online/offline/bateria)
- Contagem de mensagens recebidas e enviadas
- Cards de resumo por instância
- Indicadores de saúde do sistema

### `/login` — Login (Login.tsx)

Tela de autenticação pública (única rota não protegida):

- Formulário de e-mail e senha via Supabase Auth
- Suporte a recuperação de senha
- Redireciona para `/` após login bem-sucedido

### `/chat` — Chat Hub (ChatHub.tsx)

Módulo principal da aplicação (~700 linhas):

- **Lista de conversas** (esquerda): filtros por dispositivo, etiqueta, status; busca por contato
- **Janela de chat** (centro): histórico de mensagens, envio, anexos de mídia
- **Painel lateral** (direita): informações do contato, notas, etiquetas
- Modal para criar nova conversa / adicionar contato
- Suporte a mensagens de texto, áudio, imagens e documentos
- Atualização em tempo real via Supabase Realtime

### `/crm` — CRM (CRM.tsx)

Gestão do relacionamento com contatos:

- Listagem e busca de contatos
- Cadastro e edição de informações de contato
- Histórico de interações
- Vinculação com conversas do chat

### `/notes` — Notas (Notes.tsx)

Sistema de notas vinculadas a contatos:

- Criar, editar e excluir notas
- Associar notas a contatos específicos
- Visualização por contato ou global

### `/devices` — Dispositivos (Devices.tsx)

Gerenciamento das instâncias Evolution API:

- Listar instâncias WhatsApp conectadas
- Sincronizar novas instâncias
- Ver status de conexão (QR Code, conectado, desconectado)
- Configurar webhook por instância

### `/triggers` — Gatilhos (Triggers.tsx)

Automações baseadas em palavras-chave:

- Criar regras de resposta automática
- Configurar palavras-chave de ativação
- Definir resposta a ser enviada
- Ativar/desativar gatilhos por dispositivo

### `/scheduled` — Mensagens Agendadas (ScheduledMessages.tsx)

Agendamento de envios futuros:

- Criar mensagem com data e hora de envio
- Selecionar contato e dispositivo de envio
- Listar mensagens pendentes
- Cancelar agendamentos

### `/admin` — Painel Administrativo (admin/)

Área restrita a administradores:

- Gerenciamento de usuários do sistema
- Permissões e papéis
- Configurações globais

### `/settings` — Configurações (settings/)

Configurações do usuário e do sistema:

- **Configurações Gerais** — preferências de conta
- **Etiquetas** — criar e gerenciar etiquetas de conversa
- **Assistente IA** — configurar integração com IA para sugestões
- **Instâncias** — parâmetros de conexão das instâncias WhatsApp

### `/*` — Não Encontrado (NotFound.tsx)

Página 404 para rotas inexistentes com link de retorno ao Dashboard.
