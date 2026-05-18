import fp from 'fastify-plugin';
import { createDb, type DB } from '@aivastra/db';
declare module 'fastify' { interface FastifyInstance { db: DB; env: import('../env').Env } }
export const dbPlugin = fp(async (app) => {
  const { db, close } = createDb(app.env.DATABASE_URL);
  app.decorate('db', db);
  app.addHook('onClose', () => close());
});
