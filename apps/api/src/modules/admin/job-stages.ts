import { type DB, schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { and, eq, inArray } from 'drizzle-orm';

// A job with an in-job pre-step (garment extract, or the inline mannequin phase) submits
// to ComfyUI more than once, each under its own execution_attempts.phase. The jobs row only
// keeps one worker_id, so the per-phase worker/timing the admin wants ("S1: w1 · S2: w3")
// is derived here from those attempt rows. Display-only: nothing reads this for settlement.
export type JobStageState = 'running' | 'done' | 'failed';

export interface JobStage {
  stage: number;
  phase: 'garment_extract' | 'mannequin' | 'main';
  label: string;
  workerId: string | null;
  state: JobStageState;
  /** Submissions for this phase — >1 means the phase was retried. */
  attempts: number;
  startedAt: string;
  endedAt: string | null;
  /** Garment extraction taken from a sibling job (another pose of the same request) rather than run here. */
  reusedFromJobId?: string | null;
}

const STAGE_ORDER = { garment_extract: 1, mannequin: 1, main: 2 } as const;
const STAGE_LABEL = {
  garment_extract: 'Garment extraction',
  mannequin: 'Mannequin',
  main: 'Image generation',
} as const;
type StagePhase = keyof typeof STAGE_ORDER;

const isStagePhase = (p: string): p is StagePhase => p in STAGE_ORDER;

const stateOf = (state: string): JobStageState =>
  state === 'SUCCEEDED'
    ? 'done'
    : state === 'FAILED' || state === 'UNKNOWN_RETRIED'
      ? 'failed'
      : 'running';

/**
 * Stages per job id, only for jobs that ran more than one phase — a plain single-phase
 * job maps to nothing, so callers fall back to the existing single worker display.
 * Each phase reports its latest attempt (highest attempt_no) plus how many there were.
 */
export async function loadJobStages(db: DB, jobIds: string[]): Promise<Map<string, JobStage[]>> {
  const out = new Map<string, JobStage[]>();
  if (jobIds.length === 0) return out;

  const rows = await db
    .select({
      jobId: schema.executionAttempts.jobId,
      phase: schema.executionAttempts.phase,
      attemptNo: schema.executionAttempts.attemptNo,
      state: schema.executionAttempts.state,
      workerId: schema.executionAttempts.workerId,
      createdAt: schema.executionAttempts.createdAt,
      updatedAt: schema.executionAttempts.updatedAt,
      resolvedAt: schema.executionAttempts.resolvedAt,
    })
    .from(schema.executionAttempts)
    .where(inArray(schema.executionAttempts.jobId, jobIds));

  const latest = new Map<string, { row: (typeof rows)[number]; count: number }>();
  for (const r of rows) {
    if (!r.jobId || !isStagePhase(r.phase)) continue;
    const k = `${r.jobId}:${r.phase}`;
    const cur = latest.get(k);
    if (!cur) latest.set(k, { row: r, count: 1 });
    else {
      cur.count += 1;
      if (r.attemptNo > cur.row.attemptNo) cur.row = r;
    }
  }

  for (const { row: r, count } of latest.values()) {
    if (!r.jobId || !isStagePhase(r.phase)) continue;
    const state = stateOf(r.state);
    const list = out.get(r.jobId) ?? [];
    list.push({
      stage: STAGE_ORDER[r.phase],
      phase: r.phase,
      label: STAGE_LABEL[r.phase],
      workerId: r.workerId,
      state,
      attempts: count,
      startedAt: r.createdAt.toISOString(),
      // A failed attempt never gets resolvedAt (the remote prompt may still be alive), so
      // its updatedAt is the best "ended" time; a running one has none yet.
      endedAt: (r.resolvedAt ?? (state === 'failed' ? r.updatedAt : null))?.toISOString() ?? null,
    });
    out.set(r.jobId, list);
  }

  // A job that reused a sibling's extraction never submitted one, so it has no attempt row for
  // stage 1 — synthesise it from the event the dispatcher recorded when it copied the result.
  const reuseEvents = await db
    .select({
      jobId: schema.jobEvents.jobId,
      createdAt: schema.jobEvents.createdAt,
      payload: schema.jobEvents.payload,
    })
    .from(schema.jobEvents)
    .where(
      and(
        inArray(schema.jobEvents.jobId, jobIds),
        eq(schema.jobEvents.eventType, 'GARMENT_EXTRACT_REUSED'),
      ),
    );
  for (const ev of reuseEvents) {
    const list = out.get(ev.jobId);
    if (!list || list.some((st) => st.stage === 1)) continue;
    const payload = (ev.payload ?? {}) as { sourceJobId?: string | null; workerId?: string | null };
    list.push({
      stage: 1,
      phase: 'garment_extract',
      label: STAGE_LABEL.garment_extract,
      workerId: payload.workerId ?? null,
      state: 'done',
      attempts: 0,
      startedAt: ev.createdAt.toISOString(),
      endedAt: ev.createdAt.toISOString(),
      reusedFromJobId: payload.sourceJobId ?? null,
    });
  }

  for (const [jobId, list] of out) {
    if (list.length < 2) out.delete(jobId);
    else list.sort((a, b) => a.stage - b.stage);
  }
  return out;
}

/** R2 keys a stage read and produced, for the admin's input/output links. */
export function stageKeys(
  jobId: string,
  stages: JobStage[],
  job: { upperGarmentKey: string | null; outputKey: string | null },
): Map<JobStage['phase'], { inputKey: string | null; outputKey: string | null }> {
  const byPhase = new Map<
    JobStage['phase'],
    { inputKey: string | null; outputKey: string | null }
  >();
  const pre = stages.find((s) => s.stage === 1);
  const preKey = pre
    ? pre.phase === 'garment_extract'
      ? keys.garmentExtractIntermediate(jobId)
      : keys.mannequinIntermediate(jobId)
    : null;
  for (const s of stages) {
    if (s.stage === 1) {
      byPhase.set(s.phase, {
        inputKey: job.upperGarmentKey,
        outputKey: s.state === 'done' ? preKey : null,
      });
    } else {
      // The main run's garment is the pre-step's output, never the raw upload.
      byPhase.set(s.phase, {
        inputKey: pre?.state === 'done' ? preKey : null,
        outputKey: s.state === 'done' ? job.outputKey : null,
      });
    }
  }
  return byPhase;
}
