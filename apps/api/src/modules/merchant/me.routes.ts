import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

export async function merchantMeRoutes(app: FastifyInstance) {
  app.get('/v1/merchant/me', { preHandler: app.requireMerchant }, async (req) => {
    const merchantId = req.merchantClientId;
    if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

    const [row] = await app.db
      .select({
        displayName: schema.users.displayName,
        email: schema.users.email,
        balance: sql<number>`COALESCE(${schema.merchantCredits.balance}, 0)`,
      })
      .from(schema.merchants)
      .innerJoin(schema.users, eq(schema.users.id, schema.merchants.userId))
      .leftJoin(schema.merchantCredits, eq(schema.merchantCredits.merchantId, schema.merchants.id))
      .where(eq(schema.merchants.id, merchantId));
    if (!row) throw new AppError('NOT_FOUND', 404, 'merchant not found');

    return row;
  });
}
