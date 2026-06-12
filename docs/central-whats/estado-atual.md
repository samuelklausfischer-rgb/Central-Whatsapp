# Estado Atual do Projeto

## Status Geral
- ✅ Build passando (`npm run build`)
- ✅ Lint passando (apenas warnings pré-existentes)
- ✅ Modal de novo contato funcionando
- ✅ Menu de números de telefone implementado
- ✅ Problema da tela preta resolvido (causa principal)

## O que Está Funcionando

### 1. Estrutura de Contatos
- `remote_jid` armazenado como dígitos apenas (ex: `5521999999999`).
- `ChatHub.tsx` gerencia estado `selectedContact`.
- `ChatWindow.tsx` renderiza mensagens e contém `formatInline` / `renderMessage`.
- Regex `PHONE_REGEX` para detecção de números.

### 2. Normalização de Contatos (Novo)
- **Arquivo**: `src/lib/contacts/normalize.ts`
- Funções criadas:
  - `isGroupJid()` - Identifica grupos
  - `normalizeToDigits()` - Normaliza para dígitos
  - `normalizeContactId()` - Normaliza qualquer identificador
  - `buildContactIndex()` - Índice em memória para lookups O(1)
  - `findContactByIdentifier()` - Busca contato por qualquer formato
  - `resolveContactDisplayName()` - Resolve nome com prioridade
  - `formatPhoneNumber()` - Formata para exibição

### 3. Interface do Chat
- `ChatList.tsx` usa `buildContactIndex` e `resolveContactDisplayName`.
- `ChatWindow.tsx` usa `contactIndex` para resolver nomes.
- `SmartAvatar.tsx` gerencia avatares com fallback.
- Menu de números (`PhoneNumberTrigger`) com `DropdownMenu`.

### 4. Correções de Crashes
- `contactIndex` corrigido na desestruturação de `ChatRow`.
- `previewLabel` protegido contra `null/undefined`.
- `Select` estabilizado (controlled component).
- `thisSender` corrigido (sem `participantJid` indefinido).
- Datas inválidas protegidas em `getDateLabel`.
- Attachments nulos verificados antes de acessar propriedades.

## Pendentes

### 1. Normalização de Nomes
- [ ] Confirmar se nome deve vir de `nickname` ou `name`.
- [ ] Confirmar se substituição deve ser apenas no chat ou em toda UI.
- [ ] Confirmar se `@47988722513` representa conversa normal ou participante de grupo.
- [ ] Criar `normalizeContactKey` helper para mapear JIDs.

### 2. Testes em Ambiente Real
- [ ] Testar correções de tela preta em ambiente real.
- [ ] Verificar se avatares 403 ainda aparecem.
- [ ] Confirmar se nomes de contatos aparecem corretamente.

### 3. Documentação
- [x] Criar pasta de documentação (`docs/central-whats/`).
- [x] `README.md` - índice e visão geral.
- [x] `contexto.md` - objetivo, stack e arquitetura.
- [x] `historico.md` - linha do tempo.
- [ ] `estado-atual.md` - estado atual (este arquivo).
- [ ] `decisoes.md` - decisões técnicas.
- [ ] `problemas-conhecidos.md` - bugs e riscos.
- [ ] `proximos-passos.md` - ordem para continuar.

## Riscos Conhecidos
1. **Contact Index Crash** (Resolvido) - `contactIndex` não desestruturado.
2. **Avatar 403** (Não crítico) - URLs do WhatsApp CDN expiram.
3. **Datas Inválidas** (Resolvido) - `format()` sem validação.
4. **Attachments Nulos** (Resolvido) - `att.url` sem verificação.

## Configuração Atual
- **Build**: `npm run build` (passando)
- **Lint**: `npm run lint` (apenas warnings pré-existentes)
- **Dev**: `npm run dev` (localhost:8080)
- **Stack**: React 19, Vite, TypeScript, Tailwind, Shadcn UI, Supabase, Evolution API
