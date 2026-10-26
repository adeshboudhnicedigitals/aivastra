import { schema } from '@aivastra/db';
import { and, asc, count, desc, eq, gt, notExists, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { classifySourceJob } from './eligibility.js';
import { resolveGeneralTemplate } from './general-template.js';
import { getComparisonSettings } from './settings.js';

type CollectorResult = {
  collected: number;
  unsupported: number;
  skipped: 'disabled' | 'no_general' | 'backlog_full' | null;
};

function readParams(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function missingObject(err: unknown): boolean {
  const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    error?.$metadata?.httpStatusCode === 404 ||
    error?.name === 'NotFound' ||
    error?.name === 'NoSuchKey'
  );
}

/**
 * Source jobs must have completed after this. Besides "not before the feature was
 * enabled", the window never reaches back past retentionDays: retention deletes
 * finished comparison rows once they are that old, and a row is never older than its
 * source job, so without this bound a deleted row's source would be collected and
 * replayed again every retention period.
 */
function collectionWindowStart(settings: { enabledSince: string | null; retentionDays: number }) {
  const retentionStart = Date.now() - settings.retentionDays * 86_400_000;
  return new Date(Math.max(Date.parse(settings.enabledSince ?? '') || 0, retentionStart));
}

export async function runCollectorTick(
  app: FastifyInstance,
  opts: { batch?: number } = {},
): Promise<CollectorResult> {
  const result: CollectorResult = { collected: 0, unsupported: 0, skipped: null };
  const settings = await getComparisonSettings(app);
  if (settings.enabled !== true || !settings.enabledSince)
    return { ...result, skipped: 'disabled' };
  const general = await resolveGeneralTemplate(app.db);
  if (!general) return { ...result, skipped: 'no_general' };
  const batch = Math.max(1, Math.min(500, Math.trunc(opts.batch ?? 100) || 100));
  // Filter these permanent exclusions before LIMIT so old general/erased jobs
  // cannot starve newer candidates. Event fallback is the dispatcher's record.
  // Historical params can be a JSON string (including malformed strings).
  // PostgreSQL 16 validates before casting so one old row cannot abort or
  // permanently occupy the bounded batch ahead of usable sources.
  const candidateParams = sql`(case
    when jsonb_typeof(${schema.jobInputs.params}) = 'object' then ${schema.jobInputs.params}
    when jsonb_typeof(${schema.jobInputs.params}) = 'string'
      and pg_input_is_valid(${schema.jobInputs.params} #>> '{}', 'jsonb')
      then (${schema.jobInputs.params} #>> '{}')::jsonb
    else '{}'::jsonb end)`;
  const effectiveTemplate = sql`coalesce(${candidateParams} ->> 'workflowTemplateId', (
    select payload ->> 'workflowTemplateId' from job_events
    where job_id = ${schema.jobs.id} and event_type = 'COMFY_DISPATCH'
    order by created_at desc, id desc limit 1
  ))`;
  const candidates = await app.db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
    .where(
      and(
        eq(schema.jobs.status, 'COMPLETED'),
        gt(schema.jobs.completedAt, collectionWindowStart(settings)),
        sql`${schema.jobs.source} is distinct from 'comparison'`,
        sql`coalesce(${candidateParams} ->> 'comparisonErased', 'false') <> 'true'`,
        sql`${effectiveTemplate} is distinct from ${general.templateId}`,
        notExists(
          app.db
            .select({ id: schema.workflowComparisons.id })
            .from(schema.workflowComparisons)
            .where(
              and(
                eq(schema.workflowComparisons.sourceJobId, schema.jobs.id),
                eq(schema.workflowComparisons.templateId, general.templateId),
                eq(schema.workflowComparisons.templateVersion, general.version),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(schema.jobs.completedAt), asc(schema.jobs.id))
    .limit(batch);

  // Each source has its own bounded transaction. The advisory lock serializes
  // cap checks across processes; template/source row locks fence replacement and
  // privacy invalidation. Never hold one transaction for the whole sweep.
  const collectOne = async (sourceId: string | null) =>
    app.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('workflow-comparison:collector', 0))`,
      );
      const currentSettings = await getComparisonSettings(app);
      if (currentSettings.enabled !== true || !currentSettings.enabledSince)
        return 'disabled' as const;
      const frozen = await resolveGeneralTemplate(tx, true);
      if (!frozen) return 'no_general' as const;
      const [backlog] = await tx
        .select({ count: count() })
        .from(schema.workflowComparisons)
        .where(eq(schema.workflowComparisons.status, 'COLLECTED'));
      if (Number(backlog?.count ?? 0) >= currentSettings.backlogCap) return 'backlog_full' as const;
      if (!sourceId) return null;
      const [job] = await tx
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, sourceId))
        .for('update');
      if (
        job?.status !== 'COMPLETED' ||
        !job.completedAt ||
        job.completedAt <= collectionWindowStart(currentSettings)
      )
        return null;
      const [input] = await tx
        .select()
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.jobId, sourceId));
      if (!input) return null;
      const params = readParams(input.params);
      if (job.source === 'comparison' || params.comparisonErased === true) return null;
      const [output] = await tx
        .select()
        .from(schema.jobOutputs)
        .where(eq(schema.jobOutputs.jobId, sourceId));
      const [dispatch] = await tx
        .select()
        .from(schema.jobEvents)
        .where(
          and(
            eq(schema.jobEvents.jobId, sourceId),
            eq(schema.jobEvents.eventType, 'COMFY_DISPATCH'),
          ),
        )
        .orderBy(desc(schema.jobEvents.createdAt), desc(schema.jobEvents.id))
        .limit(1);
      const eventTemplate = readParams(dispatch?.payload).workflowTemplateId;
      const sourceTemplateId =
        typeof params.workflowTemplateId === 'string'
          ? params.workflowTemplateId
          : typeof eventTemplate === 'string'
            ? eventTemplate
            : null;
      if (sourceTemplateId === frozen.templateId) return null;
      const eligibility = classifySourceJob(
        {
          ...job,
          resultKey: output?.resultKey ?? null,
          templateId: sourceTemplateId,
          inputs: { ...input, params },
        },
        frozen.templateId,
      );
      let status = eligibility.eligible ? 'COLLECTED' : 'UNSUPPORTED';
      let reason: string | null = eligibility.eligible ? null : eligibility.reason;
      if (eligibility.eligible && output?.resultKey) {
        for (const key of [eligibility.personKey, eligibility.garmentKey, output.resultKey]) {
          try {
            await app.storage.headObject(key);
          } catch (err) {
            if (!missingObject(err)) throw err;
            status = 'EXPIRED';
            reason = 'SOURCE_OBJECT_MISSING';
            break;
          }
        }
      }
      const inserted = await tx
        .insert(schema.workflowComparisons)
        .values({
          sourceJobId: sourceId,
          templateId: frozen.templateId,
          templateVersion: frozen.version,
          sourceSource: job.source,
          sourceTemplateId,
          status,
          unsupportedReason: reason,
          personKey: status === 'COLLECTED' && eligibility.eligible ? eligibility.personKey : null,
          garmentKey:
            status === 'COLLECTED' && eligibility.eligible ? eligibility.garmentKey : null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.workflowComparisons.id });
      if (inserted.length > 0) {
        if (status === 'COLLECTED') result.collected++;
        if (status === 'UNSUPPORTED') result.unsupported++;
      }
      return null;
    });
  // Also report a full backlog when no uncollected candidates remain.
  if (candidates.length === 0) result.skipped = await collectOne(null);
  for (const candidate of candidates) {
    const skipped = await collectOne(candidate.id);
    if (skipped) {
      result.skipped = skipped;
      break;
    }
  }
  return result;
}

export function startComparisonCollector(app: FastifyInstance, intervalMs = 60_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runCollectorTick(app)
      .catch((err) => app.log.error({ err }, 'comparison collector tick failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
