# =============================================================================
# FRONTEND — Dockerfile multi-etapa
#
# Etapas:
#   deps     → instala node_modules (cacheado si package.json no cambia)
#   builder  → compila el bundle de producción con Vite
#   runtime  → Nginx sirve los archivos estáticos (~25MB imagen final)
#
# Las variables VITE_* se inyectan en BUILD TIME, no en runtime.
# Para cambiar la región sin re-construir, usar runtime-config.js (ver abajo).
# =============================================================================

# ── Etapa 1: dependencias ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
# Copiar solo los manifiestos — Docker cachea node_modules si no cambian
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline


# ── Etapa 2: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Las variables VITE_* son públicas — se pueden pasar como build args
ARG VITE_API_URL
ARG VITE_MAP_REGION=velez_ricaurte
ARG VITE_POLL_INTERVAL_MS=3000
ARG VITE_MAP_TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
ARG VITE_MAP_ATTRIBUTION=© OpenStreetMap contributors

ENV VITE_API_URL=$VITE_API_URL \
    VITE_MAP_REGION=$VITE_MAP_REGION \
    VITE_POLL_INTERVAL_MS=$VITE_POLL_INTERVAL_MS \
    VITE_MAP_TILE_URL=$VITE_MAP_TILE_URL \
    VITE_MAP_ATTRIBUTION=$VITE_MAP_ATTRIBUTION

RUN npm run build


# ── Etapa 3: runtime con Nginx ────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Eliminar config por defecto de Nginx
RUN rm /etc/nginx/conf.d/default.conf

# Configuración optimizada para SPA React
COPY deploy/frontend/nginx.conf /etc/nginx/conf.d/app.conf

# Archivos estáticos compilados
COPY --from=builder /app/dist /usr/share/nginx/html

# Script que inyecta variables de entorno en runtime (ver comentario abajo)
COPY deploy/frontend/inject-runtime-config.sh /docker-entrypoint.d/40-inject-config.sh
RUN chmod +x /docker-entrypoint.d/40-inject-config.sh

HEALTHCHECK --interval=30s --timeout=5s \
    CMD wget -qO- http://localhost/health || exit 1

EXPOSE 80
