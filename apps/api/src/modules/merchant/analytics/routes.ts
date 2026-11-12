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
import { LOW_CREDIT_THRESHOLD } from '../../credits/low-credit-alert-scheduler.js';
import { heatmapCells } from './heatmap.js';
import { resolveWindow } from './params.js';
import {
  breakdownRows,
  conversionRatio,
  creditTotals,
  dailyPoints,
  itemTotals,
  ownerBalance,
  sessionTotals,
} from './queries.js';
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
      const window = await resolveWindow(app.db, q, new Date());
      const scope = await resolveScope(app.db, req.merchantMember!, q);

      const [sessions, items, credits, balance] = await Promise.all([
        sessionTotals(app.db, scope, window),
        itemTotals(app.db, scope, window),
        creditTotals(app.db, scope, window),
        // The wallet is merchant-wide, not a branch figure: staff never receive it.
        scope.isStaff ? Promise.resolve(null) : ownerBalance(app.db, scope.merchantId),
      ]);

      const body: AnalyticsSummaryResponse = {
        window: { from: window.from, to: window.to, tz: window.tz },
        sessions: sessions.sessions,
        tried: items.tried,
        sold: items.sold,
        wishlisted: items.wishlisted,
        conversion: {
          sold: items.sold,
          sessions: sessions.sessions,
          ratio: conversionRatio(items.sold, sessions.sessions),
        },
        creditsSpent: credits.spent,
        creditsBalance: balance,
        lowCreditThreshold: LOW_CREDIT_THRESHOLD,
        // Staff get false rather than a derived hint about a wallet they cannot see.
        lowCredit: balance !== null && balance < LOW_CREDIT_THRESHOLD,
        // Legacy jobs have no branch, so they are not a staff (branch) figure.
        unattributed: scope.isStaff
          ? null
          : { jobs: credits.legacyJobs, credits: credits.legacyCredits },
      };
      if (scope.isStaff) {
        body.mine = {
          sessions: sessions.mineSessions,
          tried: items.mineTried,
          sold: items.mineSold,
        };
      }
      return body;
    },
  );

  app.get(
    '/v1/merchant/analytics/timeseries',
    { preHandler: app.requireMerchantMember, schema: { querystring: AnalyticsTimeseriesQuery } },
    async (req): Promise<AnalyticsTimeseriesResponse> => {
      const q = req.query as AnalyticsTimeseriesQuery;
      const window = await resolveWindow(app.db, q, new Date());
      const scope = await resolveScope(app.db, req.merchantMember!, q);
      return {
        window: { from: window.from, to: window.to, tz: window.tz },
        points: await dailyPoints(app.db, scope, window),
      };
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
      const window = await resolveWindow(app.db, q, new Date());
      const scope = await resolveScope(app.db, req.merchantMember!, q);
      const rows = await breakdownRows(app.db, scope, window, q.by);
      return {
        by: q.by,
        rows: rows.map((r) => ({
          id: r.id,
          name: r.name,
          sessions: r.sessions,
          tried: r.tried,
          sold: r.sold,
          wishlisted: r.wishlisted,
          conversion: {
            sold: r.sold,
            sessions: r.sessions,
            ratio: conversionRatio(r.sold, r.sessions),
          },
          creditsSpent: r.creditsSpent,
        })),
      };
    },
  );
}
