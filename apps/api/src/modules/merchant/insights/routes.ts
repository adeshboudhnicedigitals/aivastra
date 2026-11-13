import {
  type InsightsFunnelResponse,
  InsightsQuery,
  type InsightsReliabilityResponse,
  LostDemandQuery,
  type LostDemandResponse,
  OutOfStockQuery,
  type OutOfStockResponse,
} from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { resolveWindow } from '../analytics/params.js';
import { resolveScope } from '../analytics/scope.js';
import {
  demandByVariant,
  funnel,
  lostDemandItems,
  outOfStockRows,
  reliability,
  staleStock,
} from './queries.js';

// Merchant Insights. Scope is enforced in resolveScope (staff → own branch, a foreign branch
// is a 403); every query also carries merchant_id. Read-only, source tables (plan D1).
export async function merchantInsightsRoutes(app: FastifyInstance) {
  const common = async (req: {
    query: unknown;
    merchantMember?: Parameters<typeof resolveScope>[1];
  }) => {
    const q = req.query as InsightsQuery;
    const w = await resolveWindow(app.db, q, new Date());
    const scope = await resolveScope(app.db, req.merchantMember!, q);
    return { w, scope, win: { from: w.from, to: w.to, tz: w.tz } };
  };

  app.get(
    '/v1/merchant/insights/funnel',
    { preHandler: app.requireMerchantMember, schema: { querystring: InsightsQuery } },
    async (req): Promise<InsightsFunnelResponse> => {
      const { w, scope, win } = await common(req);
      return { window: win, ...(await funnel(app.db, scope, w)) };
    },
  );

  app.get(
    '/v1/merchant/insights/lost-demand',
    { preHandler: app.requireMerchantMember, schema: { querystring: LostDemandQuery } },
    async (req): Promise<LostDemandResponse> => {
      const { w, scope, win } = await common(req);
      const { minTries } = req.query as LostDemandQuery;
      const [items, bySize, byColour] = await Promise.all([
        lostDemandItems(app.db, scope, w, minTries),
        demandByVariant(app.db, scope, w, 'size'),
        demandByVariant(app.db, scope, w, 'colour'),
      ]);
      return { window: win, minTries, items, bySize, byColour };
    },
  );

  app.get(
    '/v1/merchant/insights/out-of-stock',
    { preHandler: app.requireMerchantMember, schema: { querystring: OutOfStockQuery } },
    async (req): Promise<OutOfStockResponse> => {
      const { w, scope, win } = await common(req);
      const { staleDays } = req.query as OutOfStockQuery;
      const [rows, stale] = await Promise.all([
        outOfStockRows(app.db, scope, w),
        staleStock(app.db, scope, staleDays, new Date()),
      ]);
      return { window: win, staleDays, rows, stale };
    },
  );

  app.get(
    '/v1/merchant/insights/reliability',
    { preHandler: app.requireMerchantMember, schema: { querystring: InsightsQuery } },
    async (req): Promise<InsightsReliabilityResponse> => {
      const { w, scope, win } = await common(req);
      return { window: win, ...(await reliability(app.db, scope, w)) };
    },
  );
}
