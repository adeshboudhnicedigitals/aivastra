import { schema } from '@aivastra/db';
import { SystemConfigBody } from '@aivastra/types';
import { and, count, countDistinct, eq, gte, lt, lte, sql, sum } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './guard.js';

const KEY = 'config:system';

export async function adminConfigRoutes(app: FastifyInstance) {
  app.get(
    '/admin/config',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ADMIN']) },
    async () => {
      const raw = await app.redis.get(KEY);
      return raw ? JSON.parse(raw) : { creditCostPerJob: 1, maxJobsPerDay: 50 };
    },
  );

  app.patch(
    '/admin/config',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: SystemConfigBody },
    },
    async (req) => {
      const cur = JSON.parse((await app.redis.get(KEY)) ?? '{}');
      const next = { ...cur, ...(req.body as any) };
      await app.redis.set(KEY, JSON.stringify(next));
      return next;
    },
  );

  app.get(
    '/admin/stats',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ADMIN']) },
    async () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(todayStart.getTime() - 86400000);
      const h24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const d7ago = new Date(todayStart.getTime() - 6 * 86400000);
      const stuckThreshold = new Date(now.getTime() - 10 * 60 * 1000);

      const [
        queueN,
        queueP,
        workersRaw,
        jobsTodayRows,
        jobsYesterdayRows,
        activeUsersTodayRows,
        activeUsersYesterdayRows,
        creditsTodayRows,
        creditsYesterdayRows,
        failed24hRows,
        jobsPerDayRows,
        recentFailures,
        stuckJobs,
      ] = await Promise.all([
        app.redis.xlen('jobs:normal'),
        app.redis.xlen('jobs:priority'),
        app.redis.hgetall('worker:registry'),

        app.db
          .select({ c: count() })
          .from(schema.jobs)
          .where(gte(schema.jobs.createdAt, todayStart)),
        app.db
          .select({ c: count() })
          .from(schema.jobs)
          .where(and(gte(schema.jobs.createdAt, yesterday), lt(schema.jobs.createdAt, todayStart))),

        app.db
          .select({ c: countDistinct(schema.jobs.userId) })
          .from(schema.jobs)
          .where(gte(schema.jobs.createdAt, todayStart)),
        app.db
          .select({ c: countDistinct(schema.jobs.userId) })
          .from(schema.jobs)
          .where(and(gte(schema.jobs.createdAt, yesterday), lt(schema.jobs.createdAt, todayStart))),

        app.db
          .select({ c: sum(schema.jobs.creditsCharged) })
          .from(schema.jobs)
          .where(
            and(eq(schema.jobs.status, 'COMPLETED'), gte(schema.jobs.completedAt, todayStart)),
          ),
        app.db
          .select({ c: sum(schema.jobs.creditsCharged) })
          .from(schema.jobs)
          .where(
            and(
              eq(schema.jobs.status, 'COMPLETED'),
              gte(schema.jobs.completedAt, yesterday),
              lt(schema.jobs.completedAt as any, todayStart),
            ),
          ),

        app.db
          .select({ c: count() })
          .from(schema.jobs)
          .where(and(eq(schema.jobs.status, 'FAILED'), gte(schema.jobs.createdAt, h24ago))),

        app.db
          .select({
            day: sql<string>`DATE(${schema.jobs.createdAt})`,
            c: count(),
          })
          .from(schema.jobs)
          .where(gte(schema.jobs.createdAt, d7ago))
          .groupBy(sql`DATE(${schema.jobs.createdAt})`)
          .orderBy(sql`DATE(${schema.jobs.createdAt})`),

        app.db
          .select({
            id: schema.jobs.id,
            errorCode: schema.jobs.errorCode,
            createdAt: schema.jobs.createdAt,
            userEmail: schema.users.email,
          })
          .from(schema.jobs)
          .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
          .where(and(eq(schema.jobs.status, 'FAILED'), gte(schema.jobs.createdAt, h24ago)))
          .orderBy(sql`${schema.jobs.createdAt} DESC`)
          .limit(5),

        app.db
          .select({
            id: schema.jobs.id,
            createdAt: schema.jobs.createdAt,
            userEmail: schema.users.email,
          })
          .from(schema.jobs)
          .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
          .where(and(eq(schema.jobs.status, 'QUEUED'), lte(schema.jobs.createdAt, stuckThreshold)))
          .orderBy(schema.jobs.createdAt)
          .limit(5),
      ]);

      // Workers from Redis
      const workers: { id: string; status: string; healthy: boolean; lastSeen?: string }[] = [];
      for (const [id, v] of Object.entries(workersRaw)) {
        try {
          const info = JSON.parse(v);
          const healthKey = await app.redis.get(`worker:health:${id}`);
          workers.push({
            id,
            status: info.status ?? 'UNKNOWN',
            healthy: !!healthKey,
            lastSeen: info.lastSeen,
          });
        } catch {
          /* skip malformed */
        }
      }

      const delta = (today: number, yesterday: number) =>
        yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100 * 10) / 10 : null;

      const jobsToday = jobsTodayRows[0]?.c ?? 0;
      const jobsYesterday = jobsYesterdayRows[0]?.c ?? 0;
      const activeUsersToday = activeUsersTodayRows[0]?.c ?? 0;
      const activeUsersYesterday = activeUsersYesterdayRows[0]?.c ?? 0;
      const creditsToday = Number(creditsTodayRows[0]?.c ?? 0);
      const creditsYesterday = Number(creditsYesterdayRows[0]?.c ?? 0);

      // Build 7-day chart (fill missing days with 0)
      const dayMap = new Map(jobsPerDayRows.map((r) => [r.day, Number(r.c)]));
      const jobsPerDay: number[] = [];
      const jobsPerDayLabels: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(todayStart.getTime() - i * 86400000);
        const key = d.toISOString().slice(0, 10);
        jobsPerDay.push(dayMap.get(key) ?? 0);
        jobsPerDayLabels.push(
          i === 0 ? 'Today' : d.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        );
      }

      const sevenDayTotal = jobsPerDay.reduce((a, b) => a + b, 0);
      const failed24h = failed24hRows[0]?.c ?? 0;

      return {
        jobsToday,
        jobsTodayDelta: delta(jobsToday, jobsYesterday),
        creditsToday,
        creditsTodayDelta: delta(creditsToday, creditsYesterday),
        activeUsersToday,
        activeUsersDelta: delta(activeUsersToday, activeUsersYesterday),
        workersHealthy: workers.filter((w) => w.healthy).length,
        workersTotal: workers.length,
        workers,
        queueDepth: queueN + queueP,
        failed24h,
        jobsPerDay,
        jobsPerDayLabels,
        sevenDayTotal,
        recentFailures: recentFailures.map((j) => ({
          id: j.id.slice(0, 12),
          user: j.userEmail ?? '—',
          error: j.errorCode ?? 'unknown',
          age: formatAge(j.createdAt),
        })),
        stuckJobs: stuckJobs.map((j) => ({
          id: j.id.slice(0, 12),
          user: j.userEmail ?? '—',
          age: formatAge(j.createdAt),
        })),
      };
    },
  );
}

function formatAge(d: Date | null): string {
  if (!d) return '?';
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}
