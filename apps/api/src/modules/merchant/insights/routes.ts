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
import { resolveScope } from '../analytics/scope.js';
import { buildFunnel, buildLostDemand, buildOutOfStock, buildReliability } from './handlers.js';

// Merchant Insights. Scope is enforced in resolveScope (staff → own branch, a foreign branch
// is a 403); every query also carries merchant_id. Read-only, source tables (plan D1).
export async function merchantInsightsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/merchant/insights/funnel',
    { preHandler: app.requireMerchantMember, schema: { querystring: InsightsQuery } },
    async (req): Promise<InsightsFunnelResponse> => {
      const q = req.query as InsightsQuery;
      return buildFunnel(app, q, await resolveScope(app.db, req.merchantMember!, q));
    },
  );

  app.get(
    '/v1/merchant/insights/lost-demand',
    { preHandler: app.requireMerchantMember, schema: { querystring: LostDemandQuery } },
    async (req): Promise<LostDemandResponse> => {
      const q = req.query as LostDemandQuery;
      return buildLostDemand(app, q, await resolveScope(app.db, req.merchantMember!, q));
    },
  );

  app.get(
    '/v1/merchant/insights/out-of-stock',
    { preHandler: app.requireMerchantMember, schema: { querystring: OutOfStockQuery } },
    async (req): Promise<OutOfStockResponse> => {
      const q = req.query as OutOfStockQuery;
      return buildOutOfStock(app, q, await resolveScope(app.db, req.merchantMember!, q));
    },
  );

  app.get(
    '/v1/merchant/insights/reliability',
    { preHandler: app.requireMerchantMember, schema: { querystring: InsightsQuery } },
    async (req): Promise<InsightsReliabilityResponse> => {
      const q = req.query as InsightsQuery;
      return buildReliability(app, q, await resolveScope(app.db, req.merchantMember!, q));
    },
  );
}
