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
        totalCreditsCharged: int(sql`coalesce(sum(${schema.jobs.creditsCharged}), 0)`),
      })
      .from(schema.jobs)
      .where(eq(schema.jobs.merchantId, merchantId));

    const terminalJobs = (totals?.completedJobs ?? 0) + (totals?.failedJobs ?? 0);
    const successRate = terminalJobs > 0 ? (totals?.completedJobs ?? 0) / terminalJobs : null;

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
      totalCreditsCharged: totals?.totalCreditsCharged ?? 0,
      recentOutputs,
    };
  });
}
