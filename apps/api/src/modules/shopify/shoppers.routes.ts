import { schema } from '@aivastra/db';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

/** One row per person, not per browser. `shopify_shoppers` holds a row per
 *  (store, browser) and never merges them, so a logged-in customer who shops on
 *  a phone and a laptop has two rows sharing one email. Merging by email here
 *  makes the try-on count the person's total, and the list a mailing list with
 *  no duplicates. Only shoppers who actually supplied an email appear:
 *  anonymous rows exist for limit counting and are not a mailing list. */
async function listShoppers(app: FastifyInstance, storeId: string) {
  const s = schema.shopifyShoppers;
  const firstSeenAt = sql<Date>`min(${s.firstSeenAt})`.mapWith(s.firstSeenAt);
  return app.db
    .select({
      id: sql<string>`(array_agg(${s.id} order by ${s.firstSeenAt}))[1]`,
      email: sql<string>`min(${s.email})`,
      // Marketable if any of the person's browsers recorded an opt-in.
      emailConsent: sql<boolean>`bool_or(${s.emailConsent})`,
      phone: sql<string | null>`max(${s.phone})`,
      firstSeenAt,
      tryOnCount: sql<number>`count(${schema.jobs.id})::int`,
    })
    .from(s)
    .leftJoin(schema.jobs, eq(schema.jobs.shopifyShopperId, s.id))
    .where(and(eq(s.storeId, storeId), isNotNull(s.email)))
    .groupBy(sql`lower(${s.email})`)
    .orderBy(desc(firstSeenAt));
}

/** RFC4180 minimal quoting, so a stray quote or comma cannot corrupt the file. */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function shopifyShoppersRoutes(app: FastifyInstance) {
  app.get('/v1/shopify/shoppers', { preHandler: app.requireShopifySession }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    return { items: await listShoppers(app, store.id) };
  });

  app.get(
    '/v1/shopify/shoppers.csv',
    { preHandler: app.requireShopifySession },
    async (req, reply) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const rows = await listShoppers(app, store.id);
      const lines = ['email,first_seen,try_ons'];
      for (const r of rows) {
        lines.push(
          [csvCell(r.email ?? ''), r.firstSeenAt.toISOString(), String(r.tryOnCount)].join(','),
        );
      }
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="shoppers.csv"')
        .send(`${lines.join('\n')}\n`);
    },
  );
}
