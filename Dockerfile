# syntax=docker/dockerfile:1

FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .

ARG VITE_SUPABASE_URL="https://cwpegwqopttjtdrqevlx.supabase.co"
ARG VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_u11a3BzevSFDqemZJ_-4eA_jXE2lLw7"
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN npm run build
RUN node -e "const fs=require('node:fs'); const cfg={VITE_SUPABASE_URL:process.env.VITE_SUPABASE_URL||'',VITE_SUPABASE_PUBLISHABLE_KEY:process.env.VITE_SUPABASE_PUBLISHABLE_KEY||''}; fs.writeFileSync('/app/dist/env-config.js','window.__APP_CONFIG__ = '+JSON.stringify(cfg,null,2)+';\\n');"

FROM nginx:stable-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
