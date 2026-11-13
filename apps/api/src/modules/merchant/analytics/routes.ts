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
import type { FastifyInstance } from 'fastify';
import { buildBreakdown, buildSummary, buildTimeseries } from './handlers.js';
import { heatmapCells } from './heatmap.js';
import { resolveWindow } from './params.js';
import { resolveScope } from './scope.js';

// v1.0 step 3c: read-only Merchant Web analytics. Scope is enforced server-side in
// resolveScope (staff → own branch, foreign ids 403); the client's filters are only ever
// narrowing, never widening.
export async function merchantAnalyticsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/merchant/analytics/summary',
    { preHandler: app.requireMerchantMember, schema: { querystring: AnalyticsQuery } },
    async (req): Promise<AnalyticsSummaryResponse> => {
      const q = req.query as AnalyticsQuery;
      return buildSummary(app, q, await resolveScope(app.db, req.merchantMember!, q));
    },
  );

  app.get(
    '/v1/merchant/analytics/timeseries',
    { preHandler: app.requireMerchantMember, schema: { querystring: AnalyticsTimeseriesQuery } },
    async (req): Promise<AnalyticsTimeseriesResponse> => {
      const q = req.query as AnalyticsTimeseriesQuery;
      return buildTimeseries(app, q, await resolveScope(app.db, req.merchantMember!, q));
    },
  );

  // Read from analytics_buckets (rolled up every minute), so it trails live activity by up to
  // ~2 minutes; the endpoints above stay on source tables (plan D2).
  app.get(
    '/v1/merchant/analytics/heatmap',
    { preHandler: app.requireMerchantMember, schema: { querystring: AnalyticsHeatmapQuery } },
    async (req): Promise<AnalyticsHeatmapResponse> => {
      const q = req.query as AnalyticsHeatmapQuery;
      const window = await resolveWindow(app.db, q, new Date());
      const scope = await resolveScope(app.db, req.merchantMember!, q);
      return {
        window: { from: window.from, to: window.to, tz: window.tz },
        metric: q.metric,
        cells: await heatmapCells(app.db, scope, window, q.metric),
      };
    },
  );

  app.get(
    '/v1/merchant/analytics/breakdown',
    { preHandler: app.requireMerchantMember, schema: { querystring: AnalyticsBreakdownQuery } },
    async (req): Promise<AnalyticsBreakdownResponse> => {
      const q = req.query as AnalyticsBreakdownQuery;
      return buildBreakdown(app, q, await resolveScope(app.db, req.merchantMember!, q));
    },
  );
}
