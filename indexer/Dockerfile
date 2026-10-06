# Self-hosted Mirror indexer (Railway or any Docker host). Needs Postgres and, for GraphQL, Hasura.
FROM node:24-slim
WORKDIR /app
ENV ENVIO_TUI=false
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm codegen
EXPOSE 9898
CMD ["pnpm", "start"]
