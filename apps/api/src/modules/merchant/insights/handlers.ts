import type {
  InsightsFunnelResponse,
  InsightsQuery,
  InsightsReliabilityResponse,
  LostDemandQuery,
  LostDemandResponse,
  OutOfStockQuery,
  OutOfStockResponse,
} from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { resolveWindow } from '../analytics/params.js';
import type { AnalyticsScope } from '../analytics/scope.js';
import {
  demandByVariant,
  funnel,
  lostDemandItems,
  outOfStockRows,
  reliability,
  staleStock,
} from './queries.js';

// The Insights bodies, shared by the merchant routes (scope from the caller's membership) and
// the team console's per-account routes (scope = the named merchant), as with analytics/handlers.

async function windowOf(app: FastifyInstance, q: InsightsQuery) {
  const w = await resolveWindow(app.db, q, new Date());
  return { w, win: { from: w.from, to: w.to, tz: w.tz } };
}

export async function buildFunnel(
  app: FastifyInstance,
  q: InsightsQuery,
  scope: AnalyticsScope,
): Promise<InsightsFunnelResponse> {
  const { w, win } = await windowOf(app, q);
  return { window: win, ...(await funnel(app.db, scope, w)) };
}

export async function buildLostDemand(
  app: FastifyInstance,
  q: LostDemandQuery,
  scope: AnalyticsScope,
): Promise<LostDemandResponse> {
  const { w, win } = await windowOf(app, q);
  const [items, bySize, byColour] = await Promise.all([
    lostDemandItems(app.db, scope, w, q.minTries),
    demandByVariant(app.db, scope, w, 'size'),
    demandByVariant(app.db, scope, w, 'colour'),
  ]);
  return { window: win, minTries: q.minTries, items, bySize, byColour };
}

export async function buildOutOfStock(
  app: FastifyInstance,
  q: OutOfStockQuery,
  scope: AnalyticsScope,
): Promise<OutOfStockResponse> {
  const { w, win } = await windowOf(app, q);
  const [rows, stale] = await Promise.all([
    outOfStockRows(app.db, scope, w),
    staleStock(app.db, scope, q.staleDays, new Date()),
  ]);
  return { window: win, staleDays: q.staleDays, rows, stale };
}

export async function buildReliability(
  app: FastifyInstance,
  q: InsightsQuery,
  scope: AnalyticsScope,
): Promise<InsightsReliabilityResponse> {
  const { w, win } = await windowOf(app, q);
  return { window: win, ...(await reliability(app.db, scope, w)) };
}
