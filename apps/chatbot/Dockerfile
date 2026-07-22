FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin-web/package.json apps/admin-web/
COPY apps/api/package.json apps/api/
COPY apps/catalogues-web/package.json apps/catalogues-web/
COPY apps/chatbot/package.json apps/chatbot/
COPY apps/dispatcher/package.json apps/dispatcher/
COPY apps/shopify/package.json apps/shopify/
COPY packages/db/package.json packages/db/
COPY packages/logger/package.json packages/logger/
COPY packages/observability/package.json packages/observability/
COPY packages/storage/package.json packages/storage/
COPY packages/types/package.json packages/types/
RUN pnpm install --no-frozen-lockfile --filter @aivastra/chatbot...

FROM deps AS build
COPY . .
RUN pnpm --filter @aivastra/db build && \
    pnpm --filter @aivastra/types build && \
    pnpm --filter @aivastra/logger build && \
    pnpm --filter @aivastra/observability build
RUN pnpm --filter @aivastra/chatbot build

FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4200
CMD ["pnpm", "--filter", "@aivastra/chatbot", "start"]
