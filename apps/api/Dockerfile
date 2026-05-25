FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/*/package.json packages/*/
RUN pnpm install --no-frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @aivastra/api build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4000
CMD ["pnpm", "--filter", "@aivastra/api", "start"]
