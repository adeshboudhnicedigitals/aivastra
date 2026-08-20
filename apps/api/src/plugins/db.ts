import { createDb, type DB } from '@aivastra/db';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    env: import('../env.js').Env;
    withAdvisoryLock<T>(lockKey: string, fn: (db: DB) => Promise<T>): Promise<T>;
  }
}
export const dbPlugin = fp(async (app) => {
  const { db, close, withAdvisoryLock } = createDb(app.env.DATABASE_URL);
  app.decorate('db', db);
  app.decorate('withAdvisoryLock', withAdvisoryLock);
  app.addHook('onClose', () => close());
});
