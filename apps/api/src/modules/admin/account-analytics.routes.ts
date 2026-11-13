import { schema } from '@aivastra/db';
import {
  AnalyticsBreakdownQuery,
  type AnalyticsBreakdownResponse,
  AnalyticsHeatmapQuery,
  type AnalyticsHeatmapResponse,
  AnalyticsQuery,
  type AnalyticsSummaryResponse,
  AnalyticsTimeseriesQuery,
  type AnalyticsTimeseriesResponse,
} from '@aivastra/types';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { buildBreakdown, buildSummary, buildTimeseries } from '../merchant/analytics/handlers.js';
import { heatmapCells } from '../merchant/analytics/heatmap.js';
import { resolveWindow } from '../merchant/analytics/params.js';
import type { AnalyticsScope } from '../merchant/analytics/scope.js';
import { requirePermission } from './guard.js';

// Account console phase 2: one account's dashboards for the AiVastra team. Same queries as the
// merchant's own analytics (shared handlers), scoped to the merchant named in the path. Read
// only, so no audit row; gated by accounts.read. An unknown merchant is a 404 here (unlike the
// merchant routes): the caller is staff and may know which accounts exist.

const Params = z.object({ id: z.string().uuid() });

export async function adminAccountAnalyticsRoutes(app: FastifyInstance) {
  const GUARD = requirePermission('accounts.read');

  // Admin-style scope: whole merchant, optional branch/staff/device narrowing, never `isStaff`.
  async function scopeFor(
    id: string,
    q: { branchId?: string; staffId?: string; deviceId?: string },
  ): Promise<AnalyticsScope> {
    const [m] = await app.db
      .select({ id: schema.merchants.id })
      .from(schema.merchants)
      .where(eq(schema.merchants.id, id));
    if (!m) throw new AppError('NOT_FOUND', 404, 'Account not found');
    return {
      merchantId: id,
      branchId: q.branchId,
      staffId: q.staffId,
      deviceId: q.deviceId,
      isStaff: false,
      memberStaffId: null,
    };
  }

  app.get(
    '/admin/accounts/:id/analytics/summary',
    { preHandler: GUARD, schema: { params: Params, querystring: AnalyticsQuery } },
    async (req): Promise<AnalyticsSummaryResponse> => {
      const { id } = req.params as z.infer<typeof Params>;
      const q = req.query as AnalyticsQuery;
      return buildSummary(app, q, await scopeFor(id, q));
    },
  );

  app.get(
    '/admin/accounts/:id/analytics/timeseries',
    { preHandler: GUARD, schema: { params: Params, querystring: AnalyticsTimeseriesQuery } },
    async (req): Promise<AnalyticsTimeseriesResponse> => {
      const { id } = req.params as z.infer<typeof Params>;
      const q = req.query as AnalyticsTimeseriesQuery;
      return buildTimeseries(app, q, await scopeFor(id, q));
    },
  );

  app.get(
    '/admin/accounts/:id/analytics/breakdown',
    { preHandler: GUARD, schema: { params: Params, querystring: AnalyticsBreakdownQuery } },
    async (req): Promise<AnalyticsBreakdownResponse> => {
      const { id } = req.params as z.infer<typeof Params>;
      const q = req.query as AnalyticsBreakdownQuery;
      return buildBreakdown(app, q, await scopeFor(id, q));
    },
  );

  // Same as the merchant heatmap: read from analytics_buckets, so it trails live activity by ~2 min.
  app.get(
    '/admin/accounts/:id/analytics/heatmap',
    { preHandler: GUARD, schema: { params: Params, querystring: AnalyticsHeatmapQuery } },
    async (req): Promise<AnalyticsHeatmapResponse> => {
      const { id } = req.params as z.infer<typeof Params>;
      const q = req.query as AnalyticsHeatmapQuery;
      const scope = await scopeFor(id, q);
      const window = await resolveWindow(app.db, q, new Date());
      return {
        window: { from: window.from, to: window.to, tz: window.tz },
        metric: q.metric,
        cells: await heatmapCells(app.db, scope, window, q.metric),
      };
    },
  );

  // Phase 3: the Shopify stores that roll up under this account. The link is the one the account
  // list already uses (shopify_stores.owner_user_id = the merchant's user), so a store with no
  // owner is not under any account. Identity and billing fields only: no tokens, no shop contact.
  app.get(
    '/admin/accounts/:id/shopify-stores',
    { preHandler: GUARD, schema: { params: Params } },
    async (req) => {
      const { id } = req.params as z.infer<typeof Params>;
      const [m] = await app.db
        .select({ userId: schema.merchants.userId })
        .from(schema.merchants)
        .where(eq(schema.merchants.id, id));
      if (!m) throw new AppError('NOT_FOUND', 404, 'Account not found');
      const stores = await app.db
        .select({
          id: schema.shopifyStores.id,
          shopDomain: schema.shopifyStores.shopDomain,
          shopName: schema.shopifyStores.shopName,
          partnerDevelopment: schema.shopifyStores.partnerDevelopment,
          installedAt: schema.shopifyStores.installedAt,
          uninstalledAt: schema.shopifyStores.uninstalledAt,
          balance: sql<number>`coalesce(${schema.shopifyStoreCredits.balance}, 0)::int`,
          jobs: sql<number>`(select count(*)::int from ${schema.jobs} where ${schema.jobs.shopifyStoreId} = ${schema.shopifyStores.id})`,
        })
        .from(schema.shopifyStores)
        .leftJoin(
          schema.shopifyStoreCredits,
          eq(schema.shopifyStoreCredits.storeId, schema.shopifyStores.id),
        )
        .where(eq(schema.shopifyStores.ownerUserId, m.userId))
        .orderBy(desc(schema.shopifyStores.installedAt));
      return { stores };
    },
  );
}
