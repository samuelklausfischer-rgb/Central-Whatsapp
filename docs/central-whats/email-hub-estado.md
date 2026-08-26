# Email Hub — estado real em 26/08/2026

Levantamento feito direto no código e no banco de produção, para retomar sem redescobrir.
Conclusão curta: **a interface está construída, o banco está de pé, e nada nunca funcionou** —
não existe nenhum caminho para cadastrar uma conta de email.

## O que existe e é real

### Interface (1.750 linhas, funcional)

| Arquivo | Linhas |
| --- | --- |
| `src/pages/EmailHub.tsx` | 415 |
| `src/components/email/EmailComposer.tsx` | 257 |
| `src/components/email/EmailReader.tsx` | 247 |
| `src/components/email/EmailList.tsx` | 169 |
| `src/components/email/AiSuggestionPanel.tsx` | 156 |
| `src/components/email/FolderTree.tsx` | 154 |
| `src/components/email/CrossChannelPanel.tsx` | 123 |
| `src/components/email/AccountSwitcher.tsx` | 118 |
| `src/components/email/EmailActionsBar.tsx` | 111 |

Serviços: `src/services/email_accounts.ts`, `emails.ts`, `email_states.ts`, `email_folders.ts`,
`email_templates.ts`. Tipos em `src/lib/supabase/email-types.ts`.

### Rotas e menu — já ligados

- `/email` → `EmailHub`, registrada em `src/App.tsx:149` (via `lazy()`).
- `/settings/email-accounts` → `EmailAccountSettings`, em `src/App.tsx:206`.
- **O item de menu existe**: `src/lib/navegacao.ts:68` põe Email como um dos quatro
  `DESTINOS_PRINCIPAIS`, ao lado de Painel, Conversas e Agenda. Sem gate de permissão — todo
  mundo vê, na barra do desktop e nas abas do rodapé no celular.

### Banco (produção, projeto `supabase-whats-novo`)

As 6 tabelas existem: `email_accounts` (23 colunas), `emails` (29), `email_folders` (12),
`email_states` (12), `email_templates` (11), `user_allowed_email_accounts` (4).

**Todas com 0 linhas.**

RLS em `email_accounts`: `email_accounts_user_own` (`user_id = uid()`) e
`email_accounts_admin_all` (`profiles.is_admin`).

## O que está quebrado ou faltando

### 1. Não há como cadastrar uma conta — este é o bloqueio

`src/pages/settings/EmailAccountSettings.tsx` tem **20 linhas** e é um placeholder:
um ícone, "Em breve" e "Este recurso está em desenvolvimento". Nenhum formulário, nenhum campo.

É o único stub do módulo — os 8 componentes e o `EmailHub` são código real. Sem uma linha em
`email_accounts`, o `AccountSwitcher` não tem o que listar e o hub inteiro fica vazio.

### 2. `imap_password_enc` não é cifrado

O nome promete cifragem que não existe. Nada em `src/` escreve nessa coluna, e a edge function
usa o valor **como senha em texto puro**:

```
supabase/functions/email-send/index.ts:147
  pass: account.imap_password_enc,
```

Antes de montar o formulário do item 1, decidir onde a senha vai morar. Gravar texto puro numa
coluna chamada `_enc` é a pior das opções: parece seguro e não é. O RLS limita a leitura ao dono
e aos admins, mas o `select('*')` de `getEmailAccounts()` traz a senha para o navegador do dono.

### 3. `user_allowed_email_accounts` não tem efeito

A tabela existe para compartilhar uma caixa entre pessoas, mas não há policy em `email_accounts`
que permita ler uma conta por estar listado nela — só `user_id = uid()` ou admin. Hoje a tabela
não muda nada.

### 4. Ingestão: nada traz email para dentro

Pela nota de 18/06/2026, os workflows n8n do projeto `samuel` (`8IjKtyD1zZxhml34`) são:

| ID | Nome | Situação |
| --- | --- | --- |
| `NPDFmBrlUvwIe5If` | Email IMAP Poller | placeholder, sem nó IMAP |
| `Z4JpmEei5EoGGKrw` | Email Outlook Poller | Graph API, precisa de `oauth_access_token` |
| `ogbNl50EAHEBtexb` | Email Scheduled Processor | agendados |
| `IzaHy6qvwnrod352` | Email SLA Monitor | alerta de SLA |
| `8JinKodAApLJLS0s` | Email Classifier | sub-workflow OpenRouter |

Credenciais pendentes: Header Auth (`t0v1quxbbh4iPatP`), Bearer Auth (`BF6ndm9jnG5cy73q`),
OpenRouter (`C0zmaz9ApIhriyQy`). **Não conferido nesta sessão** — vale revalidar no n8n antes de
tratar como verdade, a nota tem dois meses.

## Correção importante ao diagnóstico acima (26/08/2026, mesma data)

O provedor da empresa é **Microsoft 365**, não IMAP genérico nem Gmail. O MX de
`prndiagnosticos.com.br` e de `clinicamedimagem.com` aponta para
`mail.protection.outlook.com`, e ambos estão no **mesmo tenant**
`ec5a76d5-4773-4c5f-ae34-e667576941ae`.

Consequências:

- A coluna `imap_password_enc` é caminho morto — a Microsoft desativou Basic Auth para
  IMAP/POP/SMTP. Com OAuth não existe senha para guardar, então o problema de texto puro
  descrito acima deixa de existir em vez de precisar ser resolvido.
- A `email-send` precisa ser reescrita para Microsoft Graph; hoje ela só fala Gmail e SMTP.
- O padrão já roda em produção fora do app: o n8n tem 4 credenciais `microsoftOutlookOAuth2Api`
  reais (Financeiro PRN, Medimagem, Palhoça, licitação) usadas pelo workflow `Email AI Analyzer`.

O passo a passo de conexão, escrito para quem não é técnico, está em
`docs/email/como-conectar-os-emails.html`.

## Ordem sugerida

1. Decidir o armazenamento da credencial IMAP/SMTP (item 2) — condiciona o formulário.
2. Construir o formulário de conta em `EmailAccountSettings.tsx` (item 1).
3. Cadastrar uma caixa real e provar o envio pela edge function `email-send`.
4. Só então atacar a ingestão (item 4): sem conta cadastrada não há o que pollar.

O caminho 1→3 já dá um módulo que envia. A leitura depende do item 4.

## Fronteiras

Mexer em email não deve tocar em nada de WhatsApp. Os arquivos da área estão listados no
`EQUIPE.md` da raiz do worktree, junto com os arquivos de fronteira que exigem aviso.
