import Fastify from 'fastify';
import { ZodTypeProvider, validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { createLogger } from '@aivastra/logger';
import type { Env } from './env';
import { dbPlugin } from './plugins/db';
import { redisPlugin } from './plugins/redis';
import { storagePlugin } from './plugins/storage';
import { authPlugin } from './plugins/auth';
import { authRoutes } from './modules/auth/routes';
import { creditsRoutes } from './modules/credits/routes';
import { catalogRoutes } from './modules/catalog/routes';
import { uploadsRoutes } from './modules/uploads/routes';
import { jobsRoutes } from './modules/jobs/routes';
import { modelsRoutes } from './modules/models/routes.js';
import { adminUsersRoutes } from './modules/admin/users.routes';
import { adminCreditsRoutes } from './modules/admin/credits.routes';
import { adminCatalogRoutes } from './modules/admin/catalog.routes';
import { adminJobsRoutes } from './modules/admin/jobs.routes';
import { adminWorkersRoutes } from './modules/admin/workers.routes';
import { adminConfigRoutes } from './modules/admin/config.routes';
import { adminMeRoutes } from './modules/admin/me.routes';
import { adminAssetsRoutes } from './modules/admin/models.routes';
import { adminSubcategoriesRoutes } from './modules/admin/subcategories.routes';
import { adminTemplatesRoutes } from './modules/admin/templates.routes';
import { AppError } from './lib/errors';

export async function buildServer(env: Env) {
  const app = Fastify({ loggerInstance: createLogger('api') }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(sensible);

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
      return reply.code(400).send({ error: { code: 'VALIDATION', message: err.message } });
    }
    app.log.error({ err }, 'unhandled');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
  });

  await app.register(authRoutes);
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
  await app.register(adminSubcategoriesRoutes);
  await app.register(adminTemplatesRoutes);

  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
