# MeterBook – Server und Web-Frontend in einem Image
#
#   docker build -t meterbook .
#
# Daten (SQLite-Datenbank und Fotos) liegen im Volume /data.

FROM node:24-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:24-bookworm-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl tzdata && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    PORT=3000 \
    DATA_DIR=/data \
    DATABASE_URL=file:/data/meterbook.db \
    WEB_DIR=/app/web
WORKDIR /app/server
COPY --from=server /app/server/package.json ./
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/prisma ./prisma
COPY --from=server /app/server/dist ./dist
COPY --from=web /app/web/dist /app/web
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Datenbank-Migrationen laufen bei jedem Start (idempotent), danach der Server.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
