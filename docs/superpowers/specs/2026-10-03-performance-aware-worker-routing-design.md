# Performance-Aware Worker Routing — Design (rev 1.1)

Status: draft for implementation review. Stage 2 of the ComfyUI routing work; independent of the
Stage 1 timeout/cancel state machine (`2026-09-30-comfyui-timeout-from-execution-start-design.md`).

## 1. Goal

Among the workers that are already eligible for a job, send it to the one expected to execute it
fastest **right now**.

```text
3 idle workers: B = 24s, A = 35s, C = 73s
job 1 -> B      (B busy)
job 2 -> A      (A busy)
job 3 -> C
job 4 waits; whichever worker frees first takes it
```

Never wait for a faster BUSY worker while an eligible IDLE worker exists. Never route every job to
the fastest worker while others sit idle (BUSY workers are excluded before ranking).

## 2. Central invariant

> Performance data may change the **ordering** of otherwise eligible workers. It must never change
> worker eligibility, atomic ownership, health rules, queue-gate safety, job-type permissions, or
> post-claim validation.

Corollaries:
- Job priority/FIFO (which job is next) and worker ranking (which worker gets it) are separate
  decisions. Priority is never part of the worker score.
- Any failure to read or compute a score degrades to today's behaviour (round-robin), never to
  "no worker".

## 3. Verified facts (2026-10-03, read from repo and prod captures)

1. `selectWorker(redis, pool)` in `apps/dispatcher/src/worker/selector.ts` runs `CLAIM_LUA`:
   round-robin over the registry hash, first worker that is IDLE, has a live `worker:health:{id}`
   key, is not in the `excluded` ARGV list, and allows the pool; it marks BUSY atomically. The
   post-claim probe (`isQueueGateEnabled` / `isComfyQueueEmpty`, up to `MAX_QUEUE_PROBES = 4`)
   then runs; a failing worker is released and added to `excluded`.
2. `selectWorker` has **8 call sites**: `processor.ts` lines 641 (catalogue), 1186 and 1443
   (try-on), 1817 and 2085 (saree), 2465 (merchant), 2790 (Shopify), and `mannequin-phase.ts:94`.
   At each, the workflow template has already been resolved before the call. No resolution
   reordering is needed.
3. `workflow_templates.version` is bumped only by an explicit "replace"
   (`workflows.routes.ts`, `existing.version + 1`). A direct in-place edit sets only `updatedAt`
   (and writes a `workflow_versions` row). `templateId + version` therefore misses in-place edits.
4. ComfyUI 0.37.0 `/history/{id}` carries `status.messages` with `execution_start`,
   `execution_cached` and `execution_success`, each with a millisecond `timestamp` from the
   worker's own clock (captured: tryon-worker-4, job 6ac529f2, start 10:23:28 → success 10:24:21).
5. `tryon-worker-6` and `worker-6-process-2` share one physical GPU and can both be BUSY today.

## 4. Non-goals (v1)

- Warm-cache / last-job-type affinity.
- Enforcing a shared-GPU capacity rule (measure only).
- Reliability terms in the score (health and gates remain the only reliability mechanisms).
- Anything that changes which workers are *eligible*.

## 5. Performance key

```text
performanceKey = `${templateId}:${template.updatedAt.getTime()}`
```

- Taken from the **resolved template actually dispatched** (the row returned by
  `resolveWorkflowTemplateVersion`). Any edit to the template intentionally starts a fresh
  history, including edits that do not change the graph (accepted cost; label edits reset stats).
- Catalogue (`processor.ts:641`): the **effective** template after pose-garment overrides
  (`effectiveWorkflowTemplateId`).
- Mannequin phase (`mannequin-phase.ts:94`): the **mannequin workflow template**, not the job's
  final saree template.
- Archived-version resolution (job outlived a replace): for an archived version use
  `${templateId}:v${version}:archived`; it is never mixed with the live key.
- Later hardening option (not v1): a content hash of `jsonContent`.

## 6. Sample ingestion

Source: ComfyUI `/history` for the prompt, already fetched by `comfyui/progress.ts` on completion.
Not dispatcher polling timestamps.

**Ownership.** `progress.ts` parses the history and *returns* timing; it does not touch Redis
statistics. Today `WaitForCompletionResult` is `{ status: 'completed' } | { status:
'queue_cleanup_failed' }` and `'completed'` is returned from three places in `waitForCompletion`
(verified), so the history object is lost. The contract becomes:

```ts
type WaitForCompletionResult =
  | { status: 'completed'; executionTiming?: {
        executionStartMs: number; executionSuccessMs: number;
        cachedNodeCount: number; totalNodeCount: number } }
  | { status: 'queue_cleanup_failed' };
```

All three `completed` return points populate `executionTiming` when the history carries both
messages, else omit it. The caller (which knows `workerId` and `performanceKey`) passes it to a
`perf/record-sample.ts` service, which owns EWMA, counters and score recomputation. `totalNodeCount`
is the number of executable nodes in the dispatched prompt graph (excluding non-executing/note
nodes), computed by the caller; "fully cached" means `cachedNodeCount >= totalNodeCount`.

```text
status == success AND outputs present
  execution_start present?   execution_success present?   -> no: skip, count metric
  executionMs = execution_success.timestamp - execution_start.timestamp
  cachedNodeCount = length of execution_cached.nodes (0 if absent)
  record cachedNodeCount always
  if cachedNodeCount > CACHE_EXCLUDE_THRESHOLD: skip EWMA update, count cached-sample metric
  else update EWMA
```

- Only successful, usable samples update the EWMA. Cancelled, execution-timeout, workflow-failure,
  queue-timeout and cleanup-failure outcomes never do; each increments its own per-worker ×
  performanceKey counter (for later analysis, not scoring).
- **`CACHE_EXCLUDE_THRESHOLD` is not frozen.** It has not been measured: our captures show
  `execution_cached` present on every run, so "has cached nodes" cannot be the rule (it would
  discard nearly all samples). Required first step: record `cachedNodeCount` and `totalNodeCount`
  in OBSERVE mode and review the production distribution per performanceKey before choosing the
  threshold. Provisional rule until then: exclude only fully cached runs.
- **Bootstrap/reseed.** The store keeps aggregates, so a sample cannot be removed from an EWMA
  later. Therefore statistics collected under the provisional rule are **not eligible for ACTIVE
  certification**. When `CACHE_EXCLUDE_THRESHOLD` is frozen: delete `worker:perfstats:*` and
  `perf:score:*`, then collect fresh samples under the final rule. Only those count toward
  `MIN_SAMPLES` in the ACTIVE gate. Raw-sample retention is deliberately not built.
- `executionMs` excludes queue wait by construction (worker-side start to success).
- Samples are recorded after job completion, off the dispatch hot path. A failed write is logged
  and dropped; it must not fail the job.

## 7. Data model (Redis)

```text
worker:perfstats:{workerId}:{performanceKey}     hash
  ewmaExecutionMs, sampleCount, lastExecutionMs, updatedAt,
  successCount, timeoutCount, cancelledCount, failedCount, cachedSkipCount

perf:score:{performanceKey}                        hash   workerId -> effectiveScoreMs
perf:score:{performanceKey}:ts                     (or field) when scores were last computed

perf:baseline:{performanceKey}                     string ms (configured default; see 8)
worker:probe-backoff:{workerId}                    key with PX TTL
config:perf-routing                                { mode: "off"|"observe"|"active", ... }
```

- EWMA: `new = α·latest + (1−α)·prev`, α = 0.2 (configurable). First sample seeds the EWMA.
- Key TTL on `perfstats`/`score` hashes: 14 days, so retired templates age out.
- Statistics are computed in TypeScript. Lua reads the precomputed `effectiveScoreMs` only.

## 8. Effective score

```text
sampleConfidence = min(1, sampleCount / MIN_SAMPLES)         MIN_SAMPLES = 5
ageConfidence    = decay(now - updatedAt)                    1.0 at 0h, linear to 0.0 at 24h+
confidence       = sampleConfidence * ageConfidence
effectiveScore   = confidence * ewma + (1 - confidence) * baseline
```

Baseline:
- Phase 1: configured default per performanceKey (fallback: per pool default).
- Phase 2+: when at least 3 workers have `sampleCount >= MIN_SAMPLES` for the key, baseline is the
  **median** of their EWMAs; otherwise the configured default.
- Never 0 and never infinity for an unknown worker. A worker with no samples scores exactly the
  baseline.

Why scores decay: after ACTIVE routing, faster workers receive more work and slower workers
produce less fresh data. Without decay an old slow reading would be permanently authoritative.

Scores are recomputed in TypeScript after each accepted sample and by a periodic refresh
(every 5 min) so age decay applies to idle workers.

## 9. Selection (`CLAIM_LUA`)

Inputs added: `performanceKey`, mode, tie band, backoff key prefix.

### Mode semantics (normative)

```text
OFF      actual = existing round-robin. No scoring. Backoff neither written nor applied.
OBSERVE  actual = existing round-robin, byte-for-byte the same worker as OFF would choose.
         preferred = computed by the same ranking, never claimed. Probe failures may be
         logged as hypothetical backoff; backoff MUST NOT be written or affect selection.
         Lua marks the ROUND-ROBIN worker BUSY, never the preferred one.
ACTIVE   actual = steps 1-5 below.
```

### ACTIVE selection order

1. Existing filters, unchanged: IDLE, live health key, pool allowed, not in `excluded`.
2. Probe backoff: drop workers with an active `worker:probe-backoff:{id}`, **unless** that would
   leave no candidate. If every otherwise-eligible worker is backed off, keep only the one whose
   backoff expires soonest.
3. Score lookup: `effectiveScoreMs` for each remaining worker; missing -> baseline passed as ARGV.
4. Find `minScore` over the candidates. The tie group is every candidate with
   `score <= minScore * 1.10` (relative to the single minimum, not pairwise, so the result does
   not depend on hash iteration order; e.g. 100/109/118 -> tie group {100, 109}). Pick within the
   tie group by existing round-robin cursor order.
5. Atomically mark the chosen worker BUSY and return it.

In OBSERVE the script additionally returns `preferred` and both scores for logging; the BUSY mark
and the returned claim are the round-robin worker.

Fallbacks: mode `off`, a missing/unreadable score hash, or a missing `performanceKey` -> existing
round-robin behaviour exactly.

**Fail-soft Lua.** Every performance-specific Redis read in the script (score hash, backoff keys,
config) uses `redis.pcall` and checks for an error reply; a wrong-type key (e.g. a string where a
hash is expected) counts as "no performance data". If performance metadata cannot be read for a
claim, that claim ignores scoring and backoff and runs the existing round-robin selection. The
performance path must never turn a dispatchable job into a selector exception. Test with
deliberately corrupted keys.

Post-claim, unchanged: queue gate, `isComfyQueueEmpty` probe, release and re-select on failure.
New: a worker released by a failed post-claim probe gets `worker:probe-backoff:{id}` with a
15–30s TTL (default 20s). Backoff applies to probe failures only, never to health state.

## 10. Modes and rollout

```text
off      today's routing, no data collected
observe  today's routing; collect samples, compute scores, log preferred vs actual
active   score-ordered routing
```

Observe-mode log per dispatch: `jobType`, `performanceKey`, `actualWorker`, `preferredWorker`,
`actualWorkerScore`, `preferredWorkerScore`, `scoreSampleCount`, `selectionMode`; and on completion
`actualExecutionMs`, `cachedNodeCount`, `siblingGpuBusyAtStart`, `siblingGpuOverlapMs`.

**What observe can and cannot show.** It cannot show that the preferred worker would have been
faster, because it did not run the job. It validates **calibration**: predicted versus actual on
the worker that ran.

ACTIVE gate (all required):
- samples counted are only those collected after the cache policy was frozen (section 6);
- per performanceKey in use: every pool-eligible worker has `>= MIN_SAMPLES`, or the key is
  explicitly allowed to run on the baseline;
- median absolute prediction error below an agreed bound (initially 20%);
- worker ordering stable across two consecutive review windows;
- the `CACHE_EXCLUDE_THRESHOLD` distribution has been reviewed and the value recorded;
- no unexplained probe-backoff behaviour.

ACTIVE is enabled per pool, not globally, and reverts to `observe` by changing one Redis key.

## 11. Shared-GPU pair (measurement only)

`gpuGroup` is Redis-registry metadata for `tryon-worker-6` and `worker-6-process-2` (no DB
column in v1). It is used only to record `siblingGpuBusyAtStart` and overlap time. Compare, per
performanceKey, runs with the sibling idle against runs with it busy. A later `gpuGroupCapacity`
rule is a separate spec and only if the data shows meaningful slowdown or instability.

## 12. Call-site changes

All 8 `selectWorker` call sites pass `performanceKey` (new optional parameter; omitted =
round-robin). Mechanical change; no resolution reordering. `mannequin-phase.ts` passes the
mannequin template's key.

## 13. Tests

- Lua: lowest score chosen among IDLE; BUSY never chosen; tie band falls back to cursor order;
  unknown worker scores baseline; missing score hash -> round-robin; backoff skipped unless all
  backed off; excluded list still honoured.
- B → A → C sequence with three claims, then waiting.
- Concurrency: two simultaneous claims never get the same worker.
- Sampling: success with both messages updates EWMA; missing message skipped; failure/cancel/
  timeout do not update EWMA but increment counters; cached-threshold skip.
- Confidence: sample-count and age blending, median baseline switch, decay.
- Performance key: in-place edit changes the key; archived resolution uses the archived key.
- Mode flip `active` -> `observe` takes effect on the next claim.
- OBSERVE parity: with scores that prefer a different worker, the claimed worker equals the OFF
  choice, and no backoff key is written.
- Tie group relative to the minimum: 100/109/118 ties only {100,109}; result independent of
  registry hash order.
- Fail-soft: score key of the wrong type, malformed config, missing baseline -> round-robin, no
  Lua error.
- `waitForCompletion`: all three `completed` return points carry `executionTiming` when history
  has both messages; omit it otherwise; existing callers unaffected.
- Reseed: deleting perfstats/scores returns scoring to baseline for every worker.

## 14. Open items (resolve in implementation, not design)

- Distribution of `cachedNodeCount` per workflow on production (sets `CACHE_EXCLUDE_THRESHOLD`).
- Configured baselines per pool / workflow.
- Whether `/history` retention on workers always covers completion time (sampling happens at
  completion, so expected yes).
