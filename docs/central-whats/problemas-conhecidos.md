# Problemas Conhecidos

## 1. Tela Preta no Chat (Black Screen) - Resolvido

### Sintoma
- A tela do chat aparece por 1 segundo e depois some tudo.
- Não ocorre ao clicar em nada, acontece já na carga inicial.

### Causa Raiz
- `contactIndex is not defined` em `ChatList.tsx:124`.
- O prop `contactIndex` estava no tipo mas não foi desestruturado na assinatura da função `ChatRow`.
- Quando `resolveContactDisplayName(..., contactIndex, ...)` executava, a lista quebrava e o React apagava a árvore.

### Correção Aplicada
1. Adicionado `contactIndex,` nos parâmetros desestruturados do `ChatRow` (`ChatList.tsx:97`).
2. Protegido `previewLabel` contra `content` nulo (`ChatList.tsx:80`).
3. Estabilizado `Select` para não alternar entre controlled/uncontrolled (`ChatList.tsx:388`).

### Como Reproduzir
1. Abrir a página de chat sem clicar em nada.
2. Aguardar o carregamento das conversas (resumo).
3. Se o `contactIndex` não estiver nos parâmetros, a tela fica preta.

### Status
- ✅ Resolvido em 12/06/2026.

## 2. Erros 403 de Avatares (pps.whatsapp.net) - Não Crítico

### Sintoma
- Requisições GET para `https://pps.whatsapp.net/...` retornam `403 Forbidden`.
- Aparecem no console como erros de rede.

### Causa
- URLs de avatar do WhatsApp CDN estão expiradas ou sem token de autenticação.
- O navegador tenta carregar a imagem diretamente.

### Por que não derruba a página
- `SmartAvatar` trata erro de imagem com `onError={handleImageError}`.
- Ao falhar, exibe `AvatarFallback` com iniciais ou ícone.
- Erro fica restrito ao componente de avatar.

### Status
- ⚠️ Ruído visual/rede, não afeta funcionalidade.

## 3. participantJid Indefinido - Resolvido

### Sintoma
- Possível crash ao renderizar mensagens de grupo.
- `ReferenceError: participantJid is not defined`.

### Causa
- `participantJid` estava sendo usado na montagem do nome do autor em `ChatWindow.tsx:1128`.
- Variável não existia no escopo após refatoração.

### Correção Aplicada
- Substituído por `msg.group_participant` com `normalizeToDigits()`.
- Criado `fallbackParticipantId` seguro.

### Status
- ✅ Resolvido em 12/06/2026.

## 4. Datas Inválidas em Format() - Resolvido

### Sintoma
- Possível crash ao renderizar folha de visualizadores (viewers sheet).
- `format()` pode lançar erro com data inválida.

### Causa
- `v.last_opened_at` sem validação antes de `new Date()` e `format()`.

### Correção Aplicada
- Adicionado `v.last_opened_at && !isNaN(new Date(v.last_opened_at).getTime())` antes da formatação.
- Retorna `—` se a data for inválida.

### Status
- ✅ Resolvido em 12/06/2026.

## 5. Attachments Nulos - Resolvido

### Sintoma
- Possível crash ao renderizar anexos de mensagem.
- Tentativa de acessar `att.url` em item nulo.

### Causa
- `messageAttachments.map` assumia que `att` nunca era `null`.

### Correção Aplicada
- Adicionado `att && typeof att === 'object' && att.url` antes do acesso.

### Status
- ✅ Resolvido em 12/06/2026.

## 6. Aviso do Select (Controlled/Uncontrolled) - Resolvido

### Sintoma
- Console mostra: `Select is changing from uncontrolled to controlled`.
- Aviso de compatibilidade do Radix UI.

### Causa
- `value={selectedDeviceId || undefined}` alternava entre `undefined` e string.

### Correção Aplicada
- Alterado para `value={selectedDeviceId ?? ''}` para manter sempre controlado.

### Status
- ✅ Resolvido em 12/06/2026.

## Riscos Conhecidos (Não Resolvidos)

### 1. Contatos com remote_jid Nulo/Inválido
- **Risco**: `buildContactIndex` pode quebrar se houver contato com `remote_jid` nulo.
- **Mitigação**: `generateContactKeys` já retorna `[]` para `remote_jid` falsy.
- **Status**: Baixo risco, dados do Supabase geralmente consistentes.

### 2. Mensagens com content Nulo
- **Risco**: `previewLabel` ou render de mensagem pode quebrar.
- **Mitigação**: `previewLabel` agora aceita `null | undefined`.
- **Status**: Parcialmente mitigado.

### 3. Triggers sem title
- **Risco**: `t.title.toLowerCase()` pode quebrar se `title` for vazio.
- **Mitigação**: Ainda não implementada.
- **Status**: Pendente.

### 4. Mensagens Malformadas
- **Risco**: `msg.direction`, `msg.created_at` etc. sem verificação de shape.
- **Mitigação**: Ainda não implementada proteção ampla.
- **Status**: Pendente.
