import { AnalyticsQuery, type AnalyticsSummaryResponse } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { LOW_CREDIT_THRESHOLD } from '../../credits/low-credit-alert-scheduler.js';
import { parseWindow } from './params.js';
import {
  conversionRatio,
  creditTotals,
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
      const window = parseWindow(q, new Date());
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
}
