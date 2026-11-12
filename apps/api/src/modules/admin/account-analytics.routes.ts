import { schema } from '@aivastra/db';
import {
  AnalyticsBreakdownQuery,
  type AnalyticsBreakdownResponse,
  AnalyticsQuery,
  type AnalyticsSummaryResponse,
  AnalyticsTimeseriesQuery,
  type AnalyticsTimeseriesResponse,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { buildBreakdown, buildSummary, buildTimeseries } from '../merchant/analytics/handlers.js';
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
}
