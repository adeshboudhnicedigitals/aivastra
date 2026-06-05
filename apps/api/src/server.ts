import { createLogger } from '@aivastra/logger';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Env } from './env.js';
import { AppError } from './lib/errors.js';
import { adminCatalogRoutes } from './modules/admin/catalog.routes.js';
import { adminConfigRoutes } from './modules/admin/config.routes.js';
import { adminCreditsRoutes } from './modules/admin/credits.routes.js';
import { adminJobsRoutes } from './modules/admin/jobs.routes.js';
import { adminMeRoutes } from './modules/admin/me.routes.js';
import { adminAssetsRoutes } from './modules/admin/models.routes.js';
import { adminGarmentTypesRoutes } from './modules/admin/subcategories.routes.js';
import { adminUsersRoutes } from './modules/admin/users.routes.js';
import { adminWorkersRoutes } from './modules/admin/workers.routes.js';
import { adminWorkflowsRoutes } from './modules/admin/workflows.routes.js';
import { googleAuthRoutes } from './modules/auth/google.routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { creditsRoutes } from './modules/credits/routes.js';
import { jobsRoutes } from './modules/jobs/routes.js';
import { modelsRoutes } from './modules/models/routes.js';
import { paymentsRoutes } from './modules/payments/routes.js';
import { resultsRoutes } from './modules/results/routes.js';
import { uploadsRoutes } from './modules/uploads/routes.js';
import { authPlugin } from './plugins/auth.js';
import { dbPlugin } from './plugins/db.js';
import { metricsPlugin } from './plugins/metrics.js';
import { redisPlugin } from './plugins/redis.js';
import { storagePlugin } from './plugins/storage.js';

export async function buildServer(env: Env) {
  const app = Fastify({ loggerInstance: createLogger('api') }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const r2Origin = new URL(env.R2_PUBLIC_URL).origin;
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', r2Origin],
        'connect-src': ["'self'", r2Origin],
      },
    },
  });
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(sensible);
  await app.register(metricsPlugin);

  app.decorate('env', env);
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(storagePlugin);
  await app.register(authPlugin);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if ((err as { validation?: unknown }).validation) {
      return reply
        .code(400)
        .send({ error: { code: 'VALIDATION', message: (err as Error).message } });
    }
    app.log.error({ err }, 'unhandled');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
  });

  await app.register(authRoutes);
  await app.register(googleAuthRoutes);
  await app.register(creditsRoutes);
  await app.register(catalogRoutes);
  await app.register(uploadsRoutes);
  await app.register(jobsRoutes);
  await app.register(modelsRoutes);
  await app.register(adminUsersRoutes);
  await app.register(adminCreditsRoutes);
  await app.register(adminCatalogRoutes);
  await app.register(adminJobsRoutes);
  await app.register(adminWorkersRoutes);
  await app.register(adminConfigRoutes);
  await app.register(adminMeRoutes);
  await app.register(adminAssetsRoutes);
  await app.register(adminGarmentTypesRoutes);
  await app.register(adminWorkflowsRoutes);
  await app.register(resultsRoutes);
  await app.register(paymentsRoutes);

  app.get('/health', async () => ({ status: 'ok' }));
  return app as unknown as FastifyInstance;
}
