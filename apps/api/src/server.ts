import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import * as Sentry from '@sentry/node';
import { and, eq, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Env } from './env.js';
import { AppError } from './lib/errors.js';
import { adminAuthRoutes } from './modules/admin/auth.routes.js';
import { adminCatalogRoutes } from './modules/admin/catalog.routes.js';
import { adminChatbotRoutes } from './modules/admin/chatbot.routes.js';
import { adminConfigRoutes } from './modules/admin/config.routes.js';
import { adminContactRoutes } from './modules/admin/contact.routes.js';
import { adminCreditPlansRoutes } from './modules/admin/creditPlans.routes.js';
import { adminCreditsRoutes } from './modules/admin/credits.routes.js';
import { adminJobsRoutes } from './modules/admin/jobs.routes.js';
import { adminMeRoutes } from './modules/admin/me.routes.js';
import { adminAssetsRoutes } from './modules/admin/models.routes.js';
import { adminSareeRoutes } from './modules/admin/saree.routes.js';
import { adminShopifyFunnelsRoutes } from './modules/admin/shopify-funnels.routes.js';
import { adminShopifyPlansRoutes } from './modules/admin/shopify-plans.routes.js';
import { adminGarmentTypesRoutes } from './modules/admin/subcategories.routes.js';
import { adminTryonRoutes } from './modules/admin/tryon.routes.js';
import { adminUsersRoutes } from './modules/admin/users.routes.js';
import { adminWidgetClientsRoutes } from './modules/admin/widget-clients.routes.js';
import { adminWorkersRoutes } from './modules/admin/workers.routes.js';
import { adminWorkflowsRoutes } from './modules/admin/workflows.routes.js';
import { googleAuthRoutes } from './modules/auth/google.routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { creditsRoutes } from './modules/credits/routes.js';
import { jobsRoutes } from './modules/jobs/routes.js';
import { merchantPaymentsRoutes } from './modules/merchant/payments.routes.js';
import { merchantRoutes } from './modules/merchant/routes.js';
import { modelsRoutes } from './modules/models/routes.js';
import { paymentsRoutes } from './modules/payments/routes.js';
import { resultsRoutes } from './modules/results/routes.js';
import { shopifyRoutes } from './modules/shopify/routes.js';
import { supportRoutes } from './modules/support/routes.js';
import { uploadsRoutes } from './modules/uploads/routes.js';
import { widgetRoutes } from './modules/widget/routes.js';
import { authPlugin } from './plugins/auth.js';
import { dbPlugin } from './plugins/db.js';
import { metricsPlugin } from './plugins/metrics.js';
import { redisPlugin } from './plugins/redis.js';
import { sentryPlugin } from './plugins/sentry.js';
import { shopifyAuthPlugin } from './plugins/shopify-auth.js';
import { shopifyWidgetAuthPlugin } from './plugins/shopify-widget-auth.js';
import { storagePlugin } from './plugins/storage.js';
import { widgetAuthPlugin } from './plugins/widget-auth.js';

export async function buildServer(env: Env) {
  const app = Fastify({ loggerInstance: createLogger('api') }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('env', env);

  const r2Origin = new URL(env.R2_PUBLIC_URL).origin;
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', r2Origin],
        'connect-src': ["'self'", r2Origin],
      },
    },
  });
  // In-process TTL cache in front of the widgetClients allowed-origins lookup below.
  // Without it, every cross-origin request whose Origin isn't env.CORS_ORIGIN (every
  // storefront/widget request, every preflight, any attacker-supplied Origin) triggers
  // a full Postgres query. 30s staleness is an accepted tradeoff (see CLAUDE.md task notes);
  // this is not a cache-invalidation-on-write system.
  const originCache = new Map<string, { allowed: boolean; expiresAt: number }>();
  const ORIGIN_CACHE_TTL_MS = 30_000;
  const ORIGIN_CACHE_MAX_ENTRIES = 10_000;

  await app.register(cors, {
    origin: async (origin: string | undefined) => {
      if (!origin) return false;
      if (origin === env.CORS_ORIGIN) return true;

      const now = Date.now();
      const cached = originCache.get(origin);
      if (cached && cached.expiresAt > now) return cached.allowed;

      const [row] = await app.db
        .select({ id: schema.widgetClients.id })
        .from(schema.widgetClients)
        .where(
          and(
            eq(schema.widgetClients.isActive, true),
            sql`${origin} = ANY(${schema.widgetClients.allowedOrigins})`,
          ),
        )
        .limit(1);
      const allowed = !!row;
      // Cap unbounded growth from a flood of distinct attacker-supplied Origins; a full
      // clear is simple and fine since worst case is a handful of extra DB hits.
      if (originCache.size >= ORIGIN_CACHE_MAX_ENTRIES) originCache.clear();
      originCache.set(origin, { allowed, expiresAt: now + ORIGIN_CACHE_TTL_MS });
      return allowed;
    },
    credentials: true,
  });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(redisPlugin);
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    redis: app.redis,
    allowList: (req) =>
      (req.url.startsWith('/admin/') && !req.url.startsWith('/admin/auth/')) ||
      req.url === '/v1/payments/webhook',
  });
  await app.register(sensible);
  await app.register(multipart, { limits: { fileSize: 2.5 * 1024 * 1024 * 1024 } });
  await app.register(metricsPlugin);

  await app.register(sentryPlugin);
  await app.register(dbPlugin);
  await app.register(storagePlugin);
  await app.register(authPlugin);
  await app.register(widgetAuthPlugin);
  await app.register(shopifyAuthPlugin);
  await app.register(shopifyWidgetAuthPlugin);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      app.log.warn(
        { code: err.code, statusCode: err.statusCode, msg: err.message, url: _req.url },
        'app error',
      );
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if ((err as { validation?: unknown }).validation) {
      app.log.warn({ err, url: _req.url, body: _req.body }, 'validation error');
      return reply
        .code(400)
        .send({ error: { code: 'VALIDATION', message: (err as Error).message } });
    }
    Sentry.captureException(err);
    app.log.error({ err }, 'unhandled');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
  });

  await app.register(authRoutes);
  await app.register(googleAuthRoutes);
  await app.register(creditsRoutes);
  await app.register(catalogRoutes);
  await app.register(uploadsRoutes);
  await app.register(jobsRoutes);
  await app.register(merchantRoutes);
  await app.register(merchantPaymentsRoutes);
  await app.register(widgetRoutes);
  await app.register(shopifyRoutes);
  await app.register(modelsRoutes);
  await app.register(adminAuthRoutes);
  await app.register(adminUsersRoutes);
  await app.register(adminCreditsRoutes);
  await app.register(adminCreditPlansRoutes);
  await app.register(adminCatalogRoutes);
  await app.register(adminChatbotRoutes);
  await app.register(adminJobsRoutes);
  await app.register(adminWorkersRoutes);
  await app.register(adminConfigRoutes);
  await app.register(adminMeRoutes);
  await app.register(adminAssetsRoutes);
  await app.register(adminGarmentTypesRoutes);
  await app.register(adminShopifyFunnelsRoutes);
  await app.register(adminWorkflowsRoutes);
  await app.register(adminTryonRoutes);
  await app.register(adminSareeRoutes);
  await app.register(adminShopifyPlansRoutes);
  await app.register(adminContactRoutes);
  await app.register(adminWidgetClientsRoutes);
  await app.register(resultsRoutes);
  await app.register(supportRoutes);
  await app.register(paymentsRoutes);

  app.get('/health', async () => ({ status: 'ok' }));
  return app as unknown as FastifyInstance;
}
