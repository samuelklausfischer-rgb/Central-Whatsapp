# Worker do Disparador em massa.
#
# Serviço SEPARADO do app: no EasyPanel, criar em `apps` apontando para este
# repositório com `source.path = /worker`, mesmo padrão de `apps/financeiro-nf`.
#
# UMA RÉPLICA SÓ. O lease no banco impede duas réplicas de enviarem ao mesmo
# tempo, mas a segunda ficaria girando à toa consumindo recurso.
FROM oven/bun:1.2.22-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY src ./src

ENV NODE_ENV=production

CMD ["bun", "run", "src/index.ts"]
