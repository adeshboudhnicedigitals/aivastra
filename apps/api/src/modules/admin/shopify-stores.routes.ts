import { schema } from '@aivastra/db';
import { PaygSpendCapBody } from '@aivastra/types';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin, requirePermission } from './guard.js';

const LedgerQuery = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function adminShopifyStoresRoutes(app: FastifyInstance) {
  const RO = requirePermission('shopify_stores.read');

  const WRITE = requireAdmin(['SUPER_ADMIN']);

  app.patch(
    '/admin/shopify-stores/:id/payg-cap',
    {
      preHandler: WRITE,
      schema: { params: z.object({ id: z.string().uuid() }), body: PaygSpendCapBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { spendCapUsdCents } = req.body as PaygSpendCapBody;
      const [updated] = await app.db
        .update(schema.shopifyStores)
        .set({ paygSpendCapUsdCents: spendCapUsdCents, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, id))
        .returning({
          id: schema.shopifyStores.id,
          paygSpendCapUsdCents: schema.shopifyStores.paygSpendCapUsdCents,
        });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'store not found');
      return updated;
    },
  );

  app.get('/admin/shopify-stores', { preHandler: RO }, async () => {
    const stores = await app.db
      .select({
        id: schema.shopifyStores.id,
        shopDomain: schema.shopifyStores.shopDomain,
        planHandle: schema.shopifyStores.planHandle,
        subscriptionStatus: schema.shopifyStores.subscriptionStatus,
        installedAt: schema.shopifyStores.installedAt,
        uninstalledAt: schema.shopifyStores.uninstalledAt,
        balance: sql<number>`COALESCE(${schema.shopifyStoreCredits.balance}, 0)`,
      })
      .from(schema.shopifyStores)
      .leftJoin(
        schema.shopifyStoreCredits,
        eq(schema.shopifyStoreCredits.storeId, schema.shopifyStores.id),
      )
      .orderBy(desc(schema.shopifyStores.installedAt));
    return { stores };
  });

  app.get(
    '/admin/shopify-stores/:id/ledger',
    {
      preHandler: RO,
      schema: { params: z.object({ id: z.string().uuid() }), querystring: LedgerQuery },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { cursor, limit } = req.query as z.infer<typeof LedgerQuery>;
      const entries = await app.db
        .select({
          id: schema.shopifyCreditLedger.id,
          delta: schema.shopifyCreditLedger.delta,
          reason: schema.shopifyCreditLedger.reason,
          jobId: schema.shopifyCreditLedger.jobId,
          createdAt: schema.shopifyCreditLedger.createdAt,
        })
        .from(schema.shopifyCreditLedger)
        .where(
          cursor
            ? sql`${schema.shopifyCreditLedger.storeId} = ${id} AND ${schema.shopifyCreditLedger.createdAt} < ${new Date(cursor)}`
            : eq(schema.shopifyCreditLedger.storeId, id),
        )
        .orderBy(desc(schema.shopifyCreditLedger.createdAt))
        .limit(limit);
      const nextCursor =
        entries.length === limit ? entries[entries.length - 1].createdAt.toISOString() : null;
      return { entries, nextCursor };
    },
  );
}
