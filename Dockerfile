# Production image for the Medusa backend (API + admin dashboard).
# Build context: the repository root (npm workspaces monorepo).

FROM node:24.14.0-bookworm-slim AS build
WORKDIR /repo
ENV NODE_ENV=development

COPY package.json package-lock.json .npmrc turbo.json ./
COPY apps/backend/package.json apps/backend/
RUN npm ci --no-audit --no-fund

COPY apps/backend apps/backend
WORKDIR /repo/apps/backend
# medusa-config.ts requires these to load; the build never connects to them.
# Real values come from deploy/.env at runtime.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    REDIS_URL=redis://localhost:6379 \
    STORE_CORS=http://localhost \
    ADMIN_CORS=http://localhost \
    AUTH_CORS=http://localhost
# Builds the server to .medusa/server and the admin dashboard to .medusa/server/public/admin.
RUN npx medusa build

# Keep only runtime dependencies; .medusa/server resolves them from /repo/node_modules.
WORKDIR /repo
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:24.14.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/backend/package.json ./apps/backend/package.json
COPY --from=build --chown=node:node /repo/apps/backend/.medusa/server ./apps/backend/.medusa/server
COPY --chown=node:node deploy/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh

WORKDIR /repo/apps/backend/.medusa/server
# Uploaded product images (local file provider). Mount a volume here.
RUN mkdir -p static && chown node:node static

USER node
EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["sh", "/usr/local/bin/backend-entrypoint.sh"]
CMD ["npx", "medusa", "start"]
