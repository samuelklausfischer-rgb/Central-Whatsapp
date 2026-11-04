# syntax=docker/dockerfile:1

FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .

ARG VITE_SUPABASE_URL="https://apps-supabase.srofjl.easypanel.host"
ARG VITE_FINANCEIRO_SUPABASE_URL="https://afwrsrnzmqzteojbeeei.supabase.co"
ARG VITE_FINANCEIRO_SUPABASE_ANON_KEY="sb_publishable_f0HmcgxIyRvw0e6pA_q6GQ_EF6t-k5W"
# Apps embutidos na aba Ferramentas (URLs públicas, sem segredo).
ARG VITE_RELATORIOS_APP_URL="https://frontends-relatorios.srofjl.easypanel.host"
ARG VITE_LICITACAO_APP_URL="https://frontends-front-licitacao.srofjl.easypanel.host"
ARG VITE_GESTAO_MEDICA_APP_URL="https://frontends-gestao-medica.srofjl.easypanel.host"
ARG VITE_PROPOSTA_APP_URL="https://frontends-propostacomercial.srofjl.easypanel.host"
ARG VITE_CONCILIACAO_APP_URL="https://frontends-conciliacao.srofjl.easypanel.host"
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_FINANCEIRO_SUPABASE_URL=$VITE_FINANCEIRO_SUPABASE_URL
ENV VITE_FINANCEIRO_SUPABASE_ANON_KEY=$VITE_FINANCEIRO_SUPABASE_ANON_KEY
ENV VITE_RELATORIOS_APP_URL=$VITE_RELATORIOS_APP_URL
ENV VITE_LICITACAO_APP_URL=$VITE_LICITACAO_APP_URL
ENV VITE_GESTAO_MEDICA_APP_URL=$VITE_GESTAO_MEDICA_APP_URL
ENV VITE_PROPOSTA_APP_URL=$VITE_PROPOSTA_APP_URL
ENV VITE_CONCILIACAO_APP_URL=$VITE_CONCILIACAO_APP_URL

# URL e chave anon do Supabase principal só existem em runtime (ver stage final);
# o portão de build (scripts/checar-env.mjs) não pode exigi-las aqui.
ENV ENV_EM_RUNTIME=1
RUN npm run build

FROM nginx:stable-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# /env-config.js (window.__APP_CONFIG__) é gerado na SUBIDA do container, a
# partir das variáveis do serviço — a chave anon do Supabase não fica na imagem.
# A imagem oficial do nginx roda /docker-entrypoint.d/*.sh antes de iniciar.
# VITE_SUPABASE_PUBLISHABLE_KEY é obrigatória no Environment do EasyPanel (sem
# padrão aqui de propósito); a URL e as URLs públicas dos apps têm padrão.
ENV VITE_SUPABASE_URL="https://apps-supabase.srofjl.easypanel.host" \
    VITE_RELATORIOS_APP_URL="https://frontends-relatorios.srofjl.easypanel.host" \
    VITE_LICITACAO_APP_URL="https://frontends-front-licitacao.srofjl.easypanel.host" \
    VITE_GESTAO_MEDICA_APP_URL="https://frontends-gestao-medica.srofjl.easypanel.host" \
    VITE_PROPOSTA_APP_URL="https://frontends-propostacomercial.srofjl.easypanel.host" \
    VITE_CONCILIACAO_APP_URL="https://frontends-conciliacao.srofjl.easypanel.host"
COPY docker-entrypoint.d/40-config.sh /docker-entrypoint.d/40-config.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-config.sh && chmod +x /docker-entrypoint.d/40-config.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
