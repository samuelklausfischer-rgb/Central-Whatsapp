# Variáveis de Ambiente — Web App

## Frontend (Vite)

Apenas duas variáveis são necessárias para o frontend funcionar:

| Variável | Obrigatória | Descrição | Exemplo |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Sim | URL do projeto Supabase | `https://xyzxyz.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Sim | Chave anon/publishable do Supabase | `sb_publishable_xxx...` |

## Onde Configurar por Ambiente

### Desenvolvimento Local

Crie `.env.local` na raiz do projeto (nunca commit este arquivo):

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sua_chave_aqui
```

O arquivo `.env.example` serve como template:
```bash
cp .env.example .env.local
```

O Vite carrega automaticamente `.env.local` em `import.meta.env.VITE_*`.

### Produção (Docker / EasyPanel)

Em produção, as variáveis **não são passadas em build time** — são injetadas em runtime via `/env-config.js`.

**Como funciona:**

1. O `Dockerfile` define valores padrão como `ARG` e `ENV`:
   ```dockerfile
   ARG VITE_SUPABASE_URL=""
   ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
   ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
   ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
   ```

2. O script de entrypoint do Nginx gera `/env-config.js` com os valores das variáveis de ambiente do container:
   ```javascript
   // /env-config.js gerado em runtime
   window.__env = {
     VITE_SUPABASE_URL: "https://xyzxyz.supabase.co",
     VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxx"
   };
   ```

3. O `index.html` carrega `/env-config.js` antes de qualquer script React.

4. O cliente Supabase lê de `window.__env` com fallback para `import.meta.env`:
   ```typescript
   const url = window.__env?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
   ```

**Configurar no EasyPanel:**

Nas configurações do app → _Environment Variables_, adicione:

```
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sua_chave_aqui
```

Após salvar, faça rebuild da imagem para as variáveis serem aplicadas.

## Verificação em Produção

Para confirmar que as variáveis estão corretas após o deploy, acesse no navegador:

```
https://sua-url.com/env-config.js
```

O arquivo deve exibir os valores corretos. Se estiver vazio ou com valores padrão, verifique:
1. As variáveis de ambiente estão configuradas no container?
2. O container foi reiniciado após a configuração?
3. O Dockerfile está gerando o `/env-config.js` corretamente?

## Edge Functions (Supabase)

As Edge Functions têm suas próprias variáveis, configuradas no **painel do Supabase**:

Painel Supabase → _Settings_ → _Edge Functions_ → _Secrets_

| Variável | Descrição |
|---|---|
| `EVOLUTION_API_URL` | URL base da Evolution API (ex: `https://api.evolution.xxx`) |
| `EVOLUTION_API_KEY` | API Key da Evolution API |

As variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetadas automaticamente pelo Supabase em todas as Edge Functions — não precisam ser configuradas manualmente.

## Segurança

- **Nunca** commite `.env.local` ou qualquer arquivo com chaves reais.
- O `.gitignore` já exclui `.env.local` e `.env.*.local`.
- A `VITE_SUPABASE_PUBLISHABLE_KEY` é a chave **anon/publishable** — ela é segura para o frontend (exposta no navegador). Nunca use a `service_role` key no frontend.
- As chaves sensíveis (Evolution API, service_role) ficam exclusivamente nas Edge Functions.
