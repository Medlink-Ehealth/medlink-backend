# syntax=docker/dockerfile:1
# Build context: repo root
#   docker build -f apps/auth-service/Dockerfile -t auth-service .

# ── base: shared node + pnpm setup ───────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

# ── deps: workspace manifests + full install (dev included for build) ─────────
FROM base AS deps
WORKDIR /build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY common/package.json                ./common/
COPY apps/auth-service/package.json     ./apps/auth-service/
RUN pnpm install --frozen-lockfile

# ── builder: compile common → auth-service ────────────────────────────────────
FROM deps AS builder
COPY tsconfig.json                      ./
COPY common/                            ./common/
COPY apps/auth-service/                 ./apps/auth-service/
RUN pnpm run build:auth

# ── deployer: bundle auth-service with prod deps into a standalone dir ─────────
# pnpm deploy respects auth-service's "files":["dist"], so /deploy contains:
#   dist/  package.json  node_modules/ (all prod deps + @medlink/common)
FROM builder AS deployer
RUN pnpm --filter auth-service deploy --prod /deploy
# Trim @medlink/common to dist + package.json only (src not needed at runtime)
RUN find /deploy/node_modules/@medlink/common \
         -mindepth 1 -maxdepth 1 \
         ! -name dist \
         ! -name package.json \
         -exec rm -rf {} +

# ── runner: lean production image ─────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# auth-service: dist, package.json, node_modules (includes @medlink/common/dist)
COPY --from=deployer /deploy/dist           ./dist
COPY --from=deployer /deploy/package.json   ./package.json
COPY --from=deployer /deploy/node_modules   ./node_modules

# site: mail templates and other static assets
COPY --from=builder /build/apps/auth-service/site ./site

# runtime dirs (site/dbInit already exists as a file in source; only create missing dirs)
RUN mkdir -p site/files/global \
             site/files/auth \
             site/files/auth/temp \
             site/files/temp \
             site/settings \
             logs

RUN addgroup -S medlink && adduser -S medlink -G medlink \
    && chown -R medlink:medlink /app
USER medlink

EXPOSE 3001
CMD ["node", "dist/index.js"]
