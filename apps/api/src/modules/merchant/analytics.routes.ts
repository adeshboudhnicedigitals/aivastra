import { schema } from '@aivastra/db';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

const RECENT_OUTPUTS_LIMIT = 12;
const int = (expr: ReturnType<typeof sql>) => sql<number>`${expr}::int`;

/**
 * Aggregate stats across every job the merchant has ever generated —
 * catalogue-manager uploads, kiosk devices, and developer-API calls alike, not
 * just the API-key-attributed subset /v1/merchant/api-usage covers.
 */
export async function merchantAnalyticsRoutes(app: FastifyInstance) {
  app.get('/v1/merchant/analytics', { preHandler: app.requireMerchant }, async (req) => {
    const merchantId = req.merchantClientId;
    if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

    const [totals] = await app.db
      .select({
        totalJobs: int(sql`count(*)`),
        completedJobs: int(sql`count(*) filter (where ${schema.jobs.status} = 'COMPLETED')`),
        failedJobs: int(sql`count(*) filter (where ${schema.jobs.status} = 'FAILED')`),
      })
      .from(schema.jobs)
      .where(eq(schema.jobs.merchantId, merchantId));

    const terminalJobs = (totals?.completedJobs ?? 0) + (totals?.failedJobs ?? 0);
    const successRate = terminalJobs > 0 ? (totals?.completedJobs ?? 0) / terminalJobs : null;

    // Net of refunds: summing jobs.creditsCharged alone overstates spend for any
    // job that was later refunded (cancelled mid-generation, or failed). The
    // ledger's delta is signed (negative on deduct, positive on refund) and
    // keyed by jobId, so -sum(delta) across every ledger row tied to this
    // merchant's jobs gives the true net spend.
    const [creditsRow] = await app.db
      .select({ netCredits: int(sql`coalesce(-sum(${schema.creditLedger.delta}), 0)`) })
      .from(schema.creditLedger)
      .innerJoin(schema.jobs, eq(schema.jobs.id, schema.creditLedger.jobId))
      .where(eq(schema.jobs.merchantId, merchantId));

    const outputRows = await app.db
      .select({
        jobId: schema.jobs.id,
        thumbnailKey: schema.jobOutputs.thumbnailKey,
        resultKey: schema.jobOutputs.resultKey,
        createdAt: schema.jobs.createdAt,
      })
      .from(schema.jobs)
      .innerJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
      .where(
        and(
          eq(schema.jobs.merchantId, merchantId),
          eq(schema.jobs.status, 'COMPLETED'),
          isNotNull(schema.jobOutputs.resultKey),
        ),
      )
      .orderBy(desc(schema.jobs.createdAt))
      .limit(RECENT_OUTPUTS_LIMIT);

    const recentOutputs = await Promise.all(
      outputRows.map(async (r) => {
        const key = r.thumbnailKey ?? r.resultKey;
        // resultKey is guaranteed non-null by the isNotNull filter above; only
        // thumbnailKey (an optional backfill) can actually be null here.
        // biome-ignore lint/style/noNonNullAssertion: guaranteed by the WHERE clause above
        const { url } = await app.storage.presignGet(key!, 3600);
        return { jobId: r.jobId, thumbnailUrl: url, createdAt: r.createdAt.toISOString() };
      }),
    );

    return {
      totalJobs: totals?.totalJobs ?? 0,
      completedJobs: totals?.completedJobs ?? 0,
      failedJobs: totals?.failedJobs ?? 0,
      successRate,
      totalCreditsCharged: creditsRow?.netCredits ?? 0,
      recentOutputs,
    };
  });
}
