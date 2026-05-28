import { createDb, type DB } from '@aivastra/db';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    env: import('../env.js').Env;
  }
}
export const dbPlugin = fp(async (app) => {
  const { db, close } = createDb(app.env.DATABASE_URL);
  app.decorate('db', db);
  app.addHook('onClose', () => close());
});
