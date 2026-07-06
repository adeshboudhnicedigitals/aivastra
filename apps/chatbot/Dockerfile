FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --no-frozen-lockfile
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
