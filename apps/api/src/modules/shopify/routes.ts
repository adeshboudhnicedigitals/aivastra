import type { FastifyInstance } from 'fastify';
import { shopifyAuthRoutes } from './auth.routes.js';
import { shopifyMeRoutes } from './me.routes.js';

export async function shopifyRoutes(app: FastifyInstance) {
  await app.register(shopifyAuthRoutes);
  await app.register(shopifyMeRoutes);
}
