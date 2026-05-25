FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/dispatcher/package.json apps/dispatcher/
COPY packages/db/package.json packages/db/
COPY packages/logger/package.json packages/logger/
COPY packages/storage/package.json packages/storage/
COPY packages/types/package.json packages/types/
RUN pnpm install --no-frozen-lockfile --prod=false

FROM deps AS build
COPY apps/dispatcher/ apps/dispatcher/
COPY packages/ packages/
COPY templates/ templates/
RUN pnpm --filter @aivastra/db build && \
    pnpm --filter @aivastra/logger build && \
    pnpm --filter @aivastra/storage build && \
    pnpm --filter @aivastra/types build && \
    pnpm --filter @aivastra/dispatcher build

FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/dispatcher/package.json apps/dispatcher/
COPY packages/db/package.json packages/db/
COPY packages/logger/package.json packages/logger/
COPY packages/storage/package.json packages/storage/
COPY packages/types/package.json packages/types/
RUN pnpm install --no-frozen-lockfile --prod
COPY --from=build /app/apps/dispatcher/dist ./apps/dispatcher/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/logger/dist ./packages/logger/dist
COPY --from=build /app/packages/storage/dist ./packages/storage/dist
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/templates ./templates

ENV NODE_ENV=production
CMD ["node", "apps/dispatcher/dist/index.js"]
