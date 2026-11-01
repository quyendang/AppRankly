FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY app/frontend/package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY app/frontend/ ./
RUN npm run build

FROM node:22-alpine AS backend
WORKDIR /app
COPY app/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY app/server.js app/cli.js ./
COPY app/lib/ ./lib/
COPY app/routes/ ./routes/

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data
RUN apk add --no-cache su-exec && mkdir -p /app/data && chown node:node /app/data
COPY --from=backend --chown=node:node /app ./
COPY --from=frontend --chown=node:node /app/public ./public
COPY docker-entrypoint.sh /usr/local/bin/apprankly-entrypoint
RUN chmod 755 /usr/local/bin/apprankly-entrypoint
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/readyz" || exit 1
ENTRYPOINT ["/usr/local/bin/apprankly-entrypoint"]
