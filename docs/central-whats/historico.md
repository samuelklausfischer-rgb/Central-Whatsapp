# Histórico do Projeto

## Sessão Atual (12/06/2026)

### Objetivo
- Implementar sistema de "adicionar novo contato" no chat.
- Criar menu clicável no número de telefone em mensagens existentes.
- Exibir nomes de contatos em vez de números brutos.

### Conquistas
- Adicionado botão "Adicionar nova conversa" no `ChatWindow.tsx`.
- Adicionado modal no `ChatHub.tsx` para nome, DDD e número com validação.
- Integrado `updateContactByJid` para salvar contato e abrir conversa automaticamente.
- Criado modal de novo contato com validação de campos.
- Build e lint passaram sem novos erros.

### Em Progresso
- Implementação de lógica para exibir nomes de contatos em vez de números brutos.
- Resolvido problema da tela preta no chat.

### Problemas Identificados e Resolvidos

#### 1. Tela Preta no Chat (Black Screen)
**Causa Raiz**: `contactIndex is not defined` em `ChatList.tsx:124`.
- O prop `contactIndex` estava no tipo mas não foi desestruturado na assinatura da função `ChatRow`.
- Quando `resolveContactDisplayName(..., contactIndex, ...)` executava, a lista quebrava e o React apagava a árvore.

**Correções Aplicadas**:
1. Adicionado `useMemo` na importação do React em `ChatWindow.tsx:1`.
2. Blindagem em `normalize.ts` para `remote_jid` inválido.
3. Removidos lookups diretos restantes usando `findContactByIdentifier` e `resolveContactDisplayName`.
4. Proteção para datas inválidas em `ChatWindow.tsx`.
5. Corrigido `contactIndex` na desestruturação de `ChatRow` em `ChatList.tsx:97`.
6. Protegido `previewLabel` contra `content` nulo em `ChatList.tsx:80`.
7. Estabilizado `Select` para não alternar entre controlled/uncontrolled em `ChatList.tsx:388`.

#### 2. Erros 403 de Avatares
- Requisições para `pps.whatsapp.net` retornando 403.
- **Não era a causa da tela preta** - são falhas de carregamento de avatar.
- `SmartAvatar` já trata isso com fallback.

#### 3. ParticipantJid Indefinido
- `participantJid` sendo usado em `ChatWindow.tsx:1128` mas não existia no escopo.
- Corrigido criando `fallbackParticipantId` com `normalizeToDigits()`.

### Decisões Técnicas
- Usar `55 + DDD + número` como formato `remote_jid` (dígitos apenas).
- Usar `DropdownMenu` (Radix UI) para menu de números.
- Usar `navigator.clipboard` para copiar números.
- Formato brasileiro de números por padrão.

### Arquivos Modificados
- `src/components/chat/ChatWindow.tsx`: Menu de números, normalização, correção de crashes.
- `src/pages/ChatHub.tsx`: Modal de novo contato, execução de mensagens.
- `src/services/contacts.ts`: Exporta `updateContactByJid`.
- `src/lib/supabase/types.ts`: Interface `Contact` (`remote_jid`, `name`, `nickname`).
- `src/lib/contacts/normalize.ts`: **Novo** - Utilitário de normalização de contatos.
- `src/components/chat/ChatList.tsx`: Atualizado para usar novo utilitário.
- `src/components/chat/SmartAvatar.tsx`: Avatar inteligente com fallback.

### Próximos Passos (Pendentes)
- Confirmar se nome deve vir de `nickname` ou `name`.
- Confirmar se substituição deve ser apenas no chat ou em toda UI.
- Confirmar se `@47988722513` representa conversa normal ou participante de grupo.
- Criar `normalizeContactKey` helper para mapear diversos formatos de JID.
- Testar correções em ambiente real.
