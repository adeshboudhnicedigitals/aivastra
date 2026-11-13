import type {
  AnalyticsBreakdownQuery,
  AnalyticsBreakdownResponse,
  AnalyticsQuery,
  AnalyticsSummaryResponse,
  AnalyticsTimeseriesQuery,
  AnalyticsTimeseriesResponse,
} from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { LOW_CREDIT_THRESHOLD } from '../../credits/low-credit-alert-scheduler.js';
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
import type { AnalyticsScope } from './scope.js';

// The summary / timeseries / breakdown bodies, shared by the merchant routes (scope from the
// caller's membership) and the team console's per-account routes (scope = the named merchant).
// Both build an AnalyticsScope first, so every query below still carries merchant_id.

export async function buildSummary(
  app: FastifyInstance,
  q: AnalyticsQuery,
  scope: AnalyticsScope,
): Promise<AnalyticsSummaryResponse> {
  const window = await resolveWindow(app.db, q, new Date());
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
}

export async function buildTimeseries(
  app: FastifyInstance,
  q: AnalyticsTimeseriesQuery,
  scope: AnalyticsScope,
): Promise<AnalyticsTimeseriesResponse> {
  const window = await resolveWindow(app.db, q, new Date());
  return {
    window: { from: window.from, to: window.to, tz: window.tz },
    points: await dailyPoints(app.db, scope, window),
  };
}

export async function buildBreakdown(
  app: FastifyInstance,
  q: AnalyticsBreakdownQuery,
  scope: AnalyticsScope,
): Promise<AnalyticsBreakdownResponse> {
  const window = await resolveWindow(app.db, q, new Date());
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
}
