# syntax=docker/dockerfile:1

# ── base: shared node + pnpm setup ──────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

# ── deps: install all workspace deps (dev included for build) ────────────────
FROM base AS deps
WORKDIR /app
# Copy manifests only first so this layer is cached unless deps change
COPY package.json pnpm-workspace.yaml ./
COPY common/package.json ./common/
COPY apps/auth-service/package.json ./apps/auth-service/
RUN pnpm install --no-frozen-lockfile

# ── builder: compile common then auth-service ────────────────────────────────
FROM deps AS builder
COPY tsconfig.json ./
COPY common/ ./common/
COPY apps/auth-service/ ./apps/auth-service/
# build:auth = build:common && tsc for auth-service
RUN pnpm run build:auth

# ── runner: lean production image ────────────────────────────────────────────
FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

ENV NODE_ENV=production

# Install production deps only (workspace symlinks for @medlink/common included)
COPY package.json pnpm-workspace.yaml ./
COPY common/package.json ./common/
COPY apps/auth-service/package.json ./apps/auth-service/
RUN pnpm install --prod --no-frozen-lockfile

# Copy compiled output from builder
COPY --from=builder /app/common/dist ./common/dist
COPY --from=builder /app/apps/auth-service/dist ./apps/auth-service/dist

# Create runtime directories expected by the app (SQLite DB, file uploads)
RUN mkdir -p apps/auth-service/site/dbInit \
             apps/auth-service/site/files/global \
             apps/auth-service/site/files/auth \
             apps/auth-service/site/files/temp \
             apps/auth-service/site/settings

# Run as non-root
RUN addgroup -S medlink && adduser -S medlink -G medlink
RUN chown -R medlink:medlink /app
USER medlink

WORKDIR /app/apps/auth-service
EXPOSE 3001

CMD ["node", "dist/index.js"]
