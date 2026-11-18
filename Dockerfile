# syntax=docker/dockerfile:1
# Bot Ecommerce TECS Acarigua - imagen de produccion (multi-stage).
# Etapas: deps (todas las dependencias) -> build (compila TypeScript) -> prod-deps (solo runtime) -> runtime.
# La imagen final lleva unicamente: node_modules de produccion, dist/, data/ y public/.

ARG NODE_IMAGE=node:22-alpine

# ---------- 1) Dependencias completas (para compilar) ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ---------- 2) Compilacion ----------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- 3) Dependencias solo de produccion ----------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# ---------- 4) Imagen final ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node data ./data
COPY --chown=node:node public ./public

# Carpetas de datos que docker-compose monta como volumenes (leads y logs).
RUN mkdir -p /app/storage/leads /app/storage/logs \
 && chown -R node:node /app/storage

USER node
EXPOSE 3000

# Falla si el servidor no responde o si /health informa que la capa de datos no esta disponible.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/server.js"]
