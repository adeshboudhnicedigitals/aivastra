import { schema } from '@aivastra/db';
import { count, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './guard.js';

// Mirrors JOB_STREAMS in apps/dispatcher/src/worker/health-monitor.ts — the same
// four Redis Streams the dispatcher's queue_depth gauge reports via XLEN.
const JOB_STREAMS = ['jobs:priority', 'jobs:normal', 'jobs:low', 'jobs:video'] as const;

interface TelemetryRow {
  [key: string]: unknown;
  job_type: string;
  sample_count: number;
  processing_p50_ms: number | null;
  processing_p95_ms: number | null;
  e2e_p50_ms: number | null;
  e2e_p95_ms: number | null;
  comfy_sample_count: number;
  comfy_p50_ms: number | null;
  comfy_p95_ms: number | null;
}

export async function adminTelemetryRoutes(app: FastifyInstance) {
  // Portable subset of the Grafana "Pipeline Overview" dashboard — everything
  // that's derivable from Postgres/Redis without a Grafana Cloud round-trip:
  // job-type duration breakdown, queue depth per stream (mirrors the
  // queue_depth gauge), and jobs-by-outcome/success-rate over the window.
  // HTTP-request-level panels (req rate, status codes, per-route p95) only
  // exist in Prometheus — the api doesn't persist per-request logs anywhere —
  // and are deliberately not reproduced here.
  // processing_* approximates the dispatcher's per-attempt wall time as
  // started_at (GENERATING transition) -> completed_at; it excludes
  // queue-wait/worker-selection time that the Prometheus histogram includes,
  // so the two won't match exactly.
  app.get(
    '/admin/telemetry',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']) },
    async (req) => {
      const query = req.query as { days?: string };
      const days = parseInt(query.days || '7', 10);
      const validDays = Number.isNaN(days) || days < 1 ? 7 : days > 90 ? 90 : days;
      const sinceDate = new Date(Date.now() - validDays * 86400000);
      const since = sinceDate.toISOString();

      const [rows, queueDepthByStream, outcomeRows] = await Promise.all([
        app.db.execute<TelemetryRow>(sql`
        SELECT
          COALESCE(source, 'unknown') AS job_type,
          count(*) FILTER (WHERE started_at IS NOT NULL AND completed_at IS NOT NULL)::int
            AS sample_count,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
          ) FILTER (WHERE started_at IS NOT NULL AND completed_at IS NOT NULL) AS processing_p50_ms,
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
          ) FILTER (WHERE started_at IS NOT NULL AND completed_at IS NOT NULL) AS processing_p95_ms,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000
          ) FILTER (WHERE completed_at IS NOT NULL) AS e2e_p50_ms,
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000
          ) FILTER (WHERE completed_at IS NOT NULL) AS e2e_p95_ms,
          count(*) FILTER (WHERE comfy_duration_ms IS NOT NULL)::int AS comfy_sample_count,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY comfy_duration_ms)
            FILTER (WHERE comfy_duration_ms IS NOT NULL) AS comfy_p50_ms,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY comfy_duration_ms)
            FILTER (WHERE comfy_duration_ms IS NOT NULL) AS comfy_p95_ms
        FROM jobs
        WHERE created_at >= ${since}
        GROUP BY source
        ORDER BY sample_count DESC
      `),
        Promise.all(
          JOB_STREAMS.map(async (stream) => ({ stream, depth: await app.redis.xlen(stream) })),
        ),
        app.db
          .select({ status: schema.jobs.status, c: count() })
          .from(schema.jobs)
          .where(gte(schema.jobs.createdAt, sinceDate))
          .groupBy(schema.jobs.status),
      ]);

      const completed = outcomeRows.find((r) => r.status === 'COMPLETED')?.c ?? 0;
      const failed = outcomeRows.find((r) => r.status === 'FAILED')?.c ?? 0;
      const terminal = completed + failed;

      return {
        days: validDays,
        jobTypes: rows.map((r) => ({
          jobType: r.job_type,
          sampleCount: r.sample_count,
          processingP50Ms: r.processing_p50_ms === null ? null : Math.round(r.processing_p50_ms),
          processingP95Ms: r.processing_p95_ms === null ? null : Math.round(r.processing_p95_ms),
          e2eP50Ms: r.e2e_p50_ms === null ? null : Math.round(r.e2e_p50_ms),
          e2eP95Ms: r.e2e_p95_ms === null ? null : Math.round(r.e2e_p95_ms),
          comfySampleCount: r.comfy_sample_count,
          comfyP50Ms: r.comfy_p50_ms === null ? null : Math.round(r.comfy_p50_ms),
          comfyP95Ms: r.comfy_p95_ms === null ? null : Math.round(r.comfy_p95_ms),
        })),
        queueDepthByStream,
        outcomes: outcomeRows.map((r) => ({ status: r.status, count: r.c })),
        successRate: terminal > 0 ? completed / terminal : null,
      };
    },
  );
}
