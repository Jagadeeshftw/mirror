# Build context: the repository root (the engine reads ../shared/config.json).
#   docker build -f engine/Dockerfile .
FROM node:24-slim AS build
WORKDIR /app/engine
RUN corepack enable
COPY engine/package.json engine/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY engine/tsconfig.json engine/tsconfig.build.json ./
COPY engine/src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    SHARED_CONFIG_PATH=/app/shared/config.json \
    DB_PATH=/data/engine.db
WORKDIR /app/engine
COPY --from=build /app/engine/node_modules ./node_modules
COPY --from=build /app/engine/dist ./dist
COPY engine/package.json ./
COPY shared /app/shared
EXPOSE 8080
# SQLite lives on a Railway volume mounted at /data.
CMD ["node", "dist/src/index.js"]
