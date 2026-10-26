import { schema } from '@aivastra/db';
import { and, count, desc, eq, lt, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { cancelQueuedComparisons } from '../comparison/retention.js';
import {
  ComparisonSettingsPatch,
  getComparisonSettings,
  saveComparisonSettings,
} from '../comparison/settings.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

const ComparisonListQuery = z.object({
  status: z
    .enum([
      'COLLECTED',
      'QUEUED',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'UNSUPPORTED',
      'EXPIRED',
      'CANCELLED',
    ])
    .optional(),
  sourceSource: z.string().min(1).max(80).optional(),
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const ComparisonCursor = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

const COMPARISON_STATUSES = [
  'COLLECTED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'UNSUPPORTED',
  'EXPIRED',
  'CANCELLED',
] as const;

export async function adminComparisonRoutes(app: FastifyInstance) {
  app.get(
    '/admin/comparison',
    { preHandler: requirePermission('jobs.read'), schema: { querystring: ComparisonListQuery } },
    async (req) => {
      const { status, sourceSource, cursor, limit } = req.query as z.infer<
        typeof ComparisonListQuery
      >;
      const t = schema.workflowComparisons;
      const conditions = [];
      if (status) conditions.push(eq(t.status, status));
      if (sourceSource) conditions.push(eq(t.sourceSource, sourceSource));
      if (cursor) {
        let cursorAnchor: z.infer<typeof ComparisonCursor> | undefined;
        try {
          cursorAnchor = ComparisonCursor.parse(
            JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
          );
        } catch {
          throw new AppError('VALIDATION', 400, 'invalid cursor');
        }
        conditions.push(
          or(
            lt(t.createdAt, new Date(cursorAnchor.createdAt)),
            and(eq(t.createdAt, new Date(cursorAnchor.createdAt)), lt(t.id, cursorAnchor.id)),
          ),
        );
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const [items, groupedCounts] = await Promise.all([
        app.db
          .select({
            id: t.id,
            status: t.status,
            unsupportedReason: t.unsupportedReason,
            sourceSource: t.sourceSource,
            sourceJobId: t.sourceJobId,
            generalJobId: t.generalJobId,
            createdAt: t.createdAt,
          })
          .from(t)
          .where(where)
          .orderBy(desc(t.createdAt), desc(t.id))
          .limit(limit),
        app.db.select({ status: t.status, total: count() }).from(t).groupBy(t.status),
      ]);
      const counts = Object.fromEntries(COMPARISON_STATUSES.map((key) => [key, 0])) as Record<
        (typeof COMPARISON_STATUSES)[number],
        number
      >;
      for (const row of groupedCounts) {
        if (row.status in counts) counts[row.status as keyof typeof counts] = Number(row.total);
      }
      const lastItem = items.at(-1);
      const nextCursor =
        items.length === limit && lastItem
          ? Buffer.from(
              JSON.stringify({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id }),
            ).toString('base64url')
          : null;
      return {
        items,
        nextCursor,
        counts,
        backlog: {
          collected: counts.COLLECTED,
          queued: counts.QUEUED,
          running: counts.RUNNING,
        },
      };
    },
  );

  app.get(
    '/admin/comparison/:id',
    {
      preHandler: requirePermission('jobs.read'),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const c = schema.workflowComparisons;
      const [comparison] = await app.db.select().from(c).where(eq(c.id, id));
      if (!comparison) throw new AppError('NOT_FOUND', 404, 'comparison not found');

      const [template] = await app.db
        .select({ id: schema.workflowTemplates.id, label: schema.workflowTemplates.label })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, comparison.templateId));
      const [source] = await app.db
        .select({
          jobId: schema.jobs.id,
          source: schema.jobs.source,
          workerId: schema.jobs.workerId,
          durationMs: schema.jobs.comfyDurationMs,
          error: schema.jobs.errorCode,
        })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, comparison.sourceJobId));
      if (!source) throw new AppError('NOT_FOUND', 404, 'source job not found');
      const [sourceTemplate] = comparison.sourceTemplateId
        ? await app.db
            .select({ label: schema.workflowTemplates.label })
            .from(schema.workflowTemplates)
            .where(eq(schema.workflowTemplates.id, comparison.sourceTemplateId))
        : [];
      const [sourceOutput] = await app.db
        .select({ resultKey: schema.jobOutputs.resultKey })
        .from(schema.jobOutputs)
        .where(eq(schema.jobOutputs.jobId, source.jobId));
      const [general] = comparison.generalJobId
        ? await app.db
            .select({
              jobId: schema.jobs.id,
              workerId: schema.jobs.workerId,
              durationMs: schema.jobs.comfyDurationMs,
              error: schema.jobs.errorCode,
            })
            .from(schema.jobs)
            .where(eq(schema.jobs.id, comparison.generalJobId))
        : [];
      const [generalOutput] = general
        ? await app.db
            .select({ resultKey: schema.jobOutputs.resultKey })
            .from(schema.jobOutputs)
            .where(eq(schema.jobOutputs.jobId, general.jobId))
        : [];
      const getUrl = async (key: string | null | undefined) =>
        key ? (await app.storage.presignGet(key, 3600)).url : null;
      return {
        id: comparison.id,
        status: comparison.status,
        unsupportedReason: comparison.unsupportedReason,
        template: {
          id: comparison.templateId,
          version: comparison.templateVersion,
          label: template?.label ?? null,
        },
        source: {
          jobId: source.jobId,
          source: source.source,
          workflowLabel: sourceTemplate?.label ?? null,
          workerId: source.workerId,
          durationMs: source.durationMs,
          error: source.error,
        },
        general: general
          ? {
              jobId: general.jobId,
              workerId: general.workerId,
              durationMs: general.durationMs,
              error: general.error,
            }
          : null,
        inputs: {
          personUrl: await getUrl(comparison.personKey),
          garmentUrl: await getUrl(comparison.garmentKey),
        },
        originalResultUrl: await getUrl(sourceOutput?.resultKey),
        generalResultUrl: await getUrl(generalOutput?.resultKey),
      };
    },
  );

  app.get(
    '/admin/comparison/settings',
    { preHandler: requirePermission('config.read') },
    async () => {
      return getComparisonSettings(app);
    },
  );

  app.patch(
    '/admin/comparison/settings',
    { preHandler: requirePermission('config.write'), schema: { body: ComparisonSettingsPatch } },
    async (req) => {
      const patch = ComparisonSettingsPatch.parse(req.body);
      return saveComparisonSettings(app, patch, async (before, after) => {
        // Redis cannot join a Postgres transaction. Match system config: commit
        // the audit first so a failed audit can never leave an applied change.
        await app.db.transaction(async (tx) => {
          await recordAudit(tx, {
            actor: { userId: req.userId, role: req.adminRole! },
            action: 'comparison.settings.update',
            resourceType: 'workflow_comparison_settings',
            before,
            after,
            request: req,
          });
        });
      });
    },
  );

  // Only replays that have not started. A running comparison always finishes.
  // Audited even when nothing was queued: the click itself is the event.
  app.post(
    '/admin/comparison/cancel-queued',
    { preHandler: requirePermission('config.write') },
    async (req) =>
      cancelQueuedComparisons(app, (tx, result) =>
        recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'comparison.cancel_queued',
          resourceType: 'workflow_comparison',
          after: result,
          request: req,
        }),
      ),
  );
}
