# syntax=docker/dockerfile:1
# Multi-stage build: compile the React client, then run the Express server that
# serves both the API and the built SPA. PostgreSQL is a separate service
# (see docker-compose.yml); this image is the app only.

# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:20-alpine AS client-build
WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: server runtime ──────────────────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/server

# Install production deps only (better-sqlite3 is a devDependency used solely by
# the one-off SQLite→Postgres migration script, so it is intentionally excluded).
COPY server/package*.json ./
RUN npm ci --omit=dev

# Server source
COPY server/ ./

# Built client — the server serves path.join(__dirname, '../client/dist')
COPY --from=client-build /client/dist /app/client/dist

# Uploaded files live here (mounted as a volume in compose for persistence)
RUN mkdir -p /app/server/uploads

EXPOSE 8080
CMD ["node", "index.js"]
