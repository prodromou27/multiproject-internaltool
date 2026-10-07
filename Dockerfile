# syntax=docker/dockerfile:1
# Multi-stage build: compile the React client, then run the Express server that
# serves both the API and the built SPA. PostgreSQL is a separate service
# (see docker-compose.yml); this image is the app only.

# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:24-alpine AS client-build
WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: server runtime ──────────────────────────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/server

# pg_dump and psql for the in-app database backups (Settings → System → Backups),
# the same major version as the database (postgres:16 in docker-compose.yml).
RUN apk add --no-cache postgresql16-client

# Install production deps only (better-sqlite3 is a devDependency used solely by
# the one-off SQLite→Postgres migration script, so it is intentionally excluded).
COPY server/package*.json ./
RUN npm ci --omit=dev

# Server source
COPY server/ ./

# Built client — the server serves path.join(__dirname, '../client/dist')
COPY --from=client-build /client/dist /app/client/dist

# Uploaded files and database backups live here (volumes in compose, for persistence)
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /app/server/uploads /app/server/backups \
  && chown -R app:app /app

USER app

EXPOSE 8080
CMD ["node", "index.js"]
