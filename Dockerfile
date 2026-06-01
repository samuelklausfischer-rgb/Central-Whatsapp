# syntax=docker/dockerfile:1

FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .

ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN npm run build

FROM nginx:stable-alpine AS production

ENV VITE_SUPABASE_URL=""
ENV VITE_SUPABASE_PUBLISHABLE_KEY=""

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/10-env-config.sh /docker-entrypoint.d/10-env-config.sh
COPY --from=build /app/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.d/10-env-config.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
