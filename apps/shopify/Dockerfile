FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --no-frozen-lockfile
ARG VITE_SHOPIFY_API_KEY
ENV VITE_SHOPIFY_API_KEY=$VITE_SHOPIFY_API_KEY
ARG VITE_AIVASTRA_APP_URL
ENV VITE_AIVASTRA_APP_URL=$VITE_AIVASTRA_APP_URL
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN NODE_ENV=production pnpm --filter @aivastra/shopify-admin build

FROM nginx:alpine AS runtime
COPY --from=build /app/apps/shopify/dist /usr/share/nginx/html
COPY apps/shopify/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
