FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @aivastra/db build && \
    pnpm --filter @aivastra/logger build && \
    pnpm --filter @aivastra/storage build && \
    pnpm --filter @aivastra/types build && \
    pnpm --filter @aivastra/dispatcher build

FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
CMD ["node", "apps/dispatcher/dist/index.js"]
