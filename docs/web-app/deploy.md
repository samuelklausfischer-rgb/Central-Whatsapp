# Deploy — Web App

O Web App é distribuído como uma **imagem Docker** contendo o build React servido pelo Nginx.

## Arquitetura de Produção

```
Internet → HTTPS → EasyPanel/Proxy → Container Docker
                                         ├── Nginx (porta 80)
                                         │     └── dist/ (build React)
                                         └── /env-config.js (variáveis injetadas)
```

## Docker

### Dockerfile

O `Dockerfile` usa **build multi-stage**:

**Stage 1 — Build (Node.js):**
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build        # Gera dist/
```

**Stage 2 — Runtime (Nginx):**
```dockerfile
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Entrypoint injeta variáveis em /env-config.js e inicia Nginx
```

### nginx.conf

Configurado para SPA (Single Page Application):
- Todas as rotas inexistentes são redirecionadas para `index.html`
- Assets estáticos com cache longo (imutáveis)
- Gzip habilitado
- Health check em `/health`

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

## Deploy no EasyPanel (Recomendado)

### Passo a Passo

1. **Criar novo App** no EasyPanel
   - Fonte: GitHub → selecionar o repositório `Central-Whatsapp`
   - Tipo de deploy: **Dockerfile**

2. **Configurar porta interna:** `80`

3. **Adicionar variáveis de ambiente:**
   ```
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sua_chave_aqui
   ```

4. **Fazer o primeiro deploy** (botão "Deploy" ou "Rebuild")

5. **Verificar** abrindo `https://sua-url.easypanel.host/env-config.js` — deve exibir os valores corretos

### Atualizações

Para atualizar após push no GitHub:
- Manual: botão "Rebuild" no EasyPanel
- Automático: configurar webhook do GitHub para trigger automático

## Build Manual (Sem EasyPanel)

### Build da Imagem

```bash
# Na raiz do projeto
docker build \
  --build-arg VITE_SUPABASE_URL=https://seu-projeto.supabase.co \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx \
  -t central-whats:latest .
```

### Rodar o Container

```bash
docker run -d \
  -p 80:80 \
  -e VITE_SUPABASE_URL=https://seu-projeto.supabase.co \
  -e VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx \
  --name central-whats \
  central-whats:latest
```

### Docker Compose (opcional)

```yaml
version: '3.8'
services:
  central-whats:
    build: .
    ports:
      - "80:80"
    environment:
      - VITE_SUPABASE_URL=https://seu-projeto.supabase.co
      - VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
    restart: unless-stopped
```

## Health Check

O Nginx responde em `/health` com `200 OK`. Configure o health check do container:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -q --spider http://localhost/health || exit 1
```

## Deploy das Edge Functions

As Edge Functions Supabase são **independentes** do Docker e devem ser publicadas separadamente:

```bash
# Instalar CLI do Supabase
npm install -g supabase

# Login
supabase login

# Vincular ao projeto
supabase link --project-ref SEU_PROJECT_REF

# Publicar todas as functions
supabase functions deploy

# Ou publicar function específica
supabase functions deploy send-message
```

## Checklist de Deploy

- [ ] Variáveis de ambiente configuradas no container
- [ ] `/env-config.js` exibe valores corretos no browser
- [ ] Login funciona (Supabase Auth acessível)
- [ ] Chat carrega conversas (Supabase Realtime funcionando)
- [ ] Envio de mensagem funciona (Edge Function `send-message` publicada)
- [ ] Webhook da Evolution API apontando para `evolution-webhook` Edge Function
- [ ] Edge Functions publicadas com variáveis `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`

## Troubleshooting

### Tela em branco após deploy
1. Abrir DevTools → Console → verificar erros
2. Verificar `/env-config.js` — valores devem ser não-vazios
3. Verificar se Supabase URL e key estão corretos

### Mensagens não chegam em tempo real
1. Verificar se Supabase Realtime está habilitado no projeto
2. Verificar se o webhook da Evolution API está configurado para a Edge Function `evolution-webhook`
3. Verificar logs da Edge Function no painel do Supabase

### Erro 404 ao recarregar página
O `nginx.conf` deve ter `try_files $uri $uri/ /index.html;` para suportar SPA routing.
