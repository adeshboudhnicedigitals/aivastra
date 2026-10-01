import { schema } from '@aivastra/db';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

const LedgerQuery = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const StoreJobsQuery = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const GROWTH_DAY_RANGES = ['7', '30', '90', 'all'] as const;
const GrowthQuery = z.object({ days: z.enum(GROWTH_DAY_RANGES).default('30') });

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function adminShopifyStoresRoutes(app: FastifyInstance) {
  const RO = requirePermission('shopify_stores.read');
  const DELETE = requirePermission('shopify_stores.delete');

  app.get('/admin/shopify-stores', { preHandler: RO }, async () => {
    const stores = await app.db
      .select({
        id: schema.shopifyStores.id,
        shopDomain: schema.shopifyStores.shopDomain,
        shopEmail: schema.shopifyStores.shopEmail,
        shopName: schema.shopifyStores.shopName,
        shopOwnerName: schema.shopifyStores.shopOwnerName,
        shopPhone: schema.shopifyStores.shopPhone,
        shopAddress: schema.shopifyStores.shopAddress,
        ianaTimezone: schema.shopifyStores.ianaTimezone,
        partnerDevelopment: schema.shopifyStores.partnerDevelopment,
        scope: schema.shopifyStores.scope,
        installedAt: schema.shopifyStores.installedAt,
        uninstalledAt: schema.shopifyStores.uninstalledAt,
        balance: sql<number>`COALESCE(${schema.shopifyStoreCredits.balance}, 0)`,
        jobsCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${schema.jobs}
          WHERE ${schema.jobs.shopifyStoreId} = ${schema.shopifyStores.id}
        )`,
        failedJobsCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${schema.jobs}
          WHERE ${schema.jobs.shopifyStoreId} = ${schema.shopifyStores.id}
            AND ${schema.jobs.status} = 'FAILED'
        )`,
      })
      .from(schema.shopifyStores)
      .leftJoin(
        schema.shopifyStoreCredits,
        eq(schema.shopifyStoreCredits.storeId, schema.shopifyStores.id),
      )
      .orderBy(desc(schema.shopifyStores.installedAt));
    return { stores };
  });

  /**
   * "Merchant growth" analytics for the Shopify Stores dashboard — installs,
   * uninstalls, and net active-merchant count per day.
   *
   * This is NOT fetched from Shopify — Shopify's own equivalent (the
   * "Merchant growth" chart on partners.shopify.com's app Overview page) lives
   * behind the separate Partner API, which this app has no credentials for.
   * But every install and uninstall already passes through this app (the OAuth/
   * managed-install callback stamps installed_at, the app_uninstalled webhook
   * stamps uninstalled_at), so the identical chart is derivable from data we
   * already hold — computed here from shopify_stores directly.
   */
  app.get('/admin/shopify-stores/growth', { preHandler: RO }, async (req) => {
    const { days } = req.query as z.infer<typeof GrowthQuery>;

    const rows = await app.db
      .select({
        installedAt: schema.shopifyStores.installedAt,
        uninstalledAt: schema.shopifyStores.uninstalledAt,
      })
      .from(schema.shopifyStores);

    const installsByDay = new Map<string, number>();
    const uninstallsByDay = new Map<string, number>();
    for (const r of rows) {
      const ik = utcDateKey(r.installedAt);
      installsByDay.set(ik, (installsByDay.get(ik) ?? 0) + 1);
      if (r.uninstalledAt) {
        const uk = utcDateKey(r.uninstalledAt);
        uninstallsByDay.set(uk, (uninstallsByDay.get(uk) ?? 0) + 1);
      }
    }

    const windowEnd = utcMidnight(new Date());
    const windowStart =
      days === 'all'
        ? rows.length > 0
          ? utcMidnight(
              rows.reduce(
                (min, r) => (r.installedAt < min ? r.installedAt : min),
                rows[0].installedAt,
              ),
            )
          : windowEnd
        : new Date(windowEnd.getTime() - (Number(days) - 1) * 24 * 60 * 60 * 1000);

    // Active-merchant count the instant before windowStart — the line's
    // starting point. A store counts as active then if it had already
    // installed and either never uninstalled or did so on/after windowStart.
    let cumulative = rows.filter(
      (r) => r.installedAt < windowStart && (!r.uninstalledAt || r.uninstalledAt >= windowStart),
    ).length;
    const startActive = cumulative;

    const series: {
      date: string;
      installs: number;
      uninstalls: number;
      activeMerchants: number;
    }[] = [];
    for (
      let cursor = new Date(windowStart);
      cursor <= windowEnd;
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
    ) {
      const key = utcDateKey(cursor);
      const installs = installsByDay.get(key) ?? 0;
      const uninstalls = uninstallsByDay.get(key) ?? 0;
      cumulative += installs - uninstalls;
      series.push({ date: key, installs, uninstalls, activeMerchants: cumulative });
    }

    const endActive = cumulative;
    const installsTotal = series.reduce((sum, p) => sum + p.installs, 0);
    const uninstallsTotal = series.reduce((sum, p) => sum + p.uninstalls, 0);
    const growthPct =
      startActive === 0 ? null : Math.round(((endActive - startActive) / startActive) * 100);

    return { days, series, installsTotal, uninstallsTotal, startActive, endActive, growthPct };
  });

  // The actual job records for this store — kept separate from the ledger
  // below on purpose. The ledger is a log of every *credit-affecting event*
  // (a job dispatch, its refund, a purchase, a trial grant, …), which reads
  // as one flat undifferentiated list; this is the store's real job history
  // (status, worker, duration) an admin actually wants when checking on
  // generation activity rather than balance history.
  app.get(
    '/admin/shopify-stores/:id/jobs',
    {
      preHandler: RO,
      schema: { params: z.object({ id: z.string().uuid() }), querystring: StoreJobsQuery },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { cursor, limit } = req.query as z.infer<typeof StoreJobsQuery>;
      const jobs = await app.db
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status,
          creditsCharged: schema.jobs.creditsCharged,
          workerId: schema.jobs.workerId,
          errorCode: schema.jobs.errorCode,
          createdAt: schema.jobs.createdAt,
          startedAt: schema.jobs.startedAt,
          completedAt: schema.jobs.completedAt,
          shopperEmail: schema.shopifyShoppers.email,
        })
        .from(schema.jobs)
        .leftJoin(
          schema.shopifyShoppers,
          eq(schema.shopifyShoppers.id, schema.jobs.shopifyShopperId),
        )
        .where(
          cursor
            ? sql`${schema.jobs.shopifyStoreId} = ${id} AND ${schema.jobs.createdAt} < ${new Date(cursor)}`
            : eq(schema.jobs.shopifyStoreId, id),
        )
        .orderBy(desc(schema.jobs.createdAt))
        .limit(limit);
      const nextCursor =
        jobs.length === limit ? jobs[jobs.length - 1].createdAt.toISOString() : null;
      return { jobs, nextCursor };
    },
  );

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

  // Hard delete, not a soft "mark uninstalled" — this exists for dev/test
  // cleanup so a store can be reinstalled from a genuinely blank slate
  // (synced products, credit ledger, onboarding flags all gone), which
  // `uninstalledAt` reprovisioning does not give you. Cascades through every
  // shopify_* child table except jobs.shopifyStoreId (set null). Gated on
  // shopify_stores.delete, SUPER_ADMIN only — see migration 0173.
  app.delete(
    '/admin/shopify-stores/:id',
    { preHandler: DELETE, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };

      await app.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.shopifyStores)
          .where(eq(schema.shopifyStores.id, id))
          .for('update');
        if (!existing) throw new AppError('NOT_FOUND', 404, 'store not found');

        await tx.delete(schema.shopifyStores).where(eq(schema.shopifyStores.id, id));

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'shopify_stores.delete',
          resourceType: 'shopify_store',
          resourceId: id,
          before: { id: existing.id, shopDomain: existing.shopDomain },
          request: req,
        });
      });

      app.log.warn(
        { adminUserId: req.userId, storeId: id, action: 'SHOPIFY_STORE_DELETE' },
        'admin deleted Shopify store',
      );

      return { ok: true };
    },
  );
}
