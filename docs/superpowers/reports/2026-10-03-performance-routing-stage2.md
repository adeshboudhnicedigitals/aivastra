# Performance-aware worker routing — Stage 2 implementation report

Branch: `feat/performance-aware-routing`, based on local `dev` at
`20a5ded3517dc0310be9c16eb5c3160e13fced17`. Working-tree changes only; no commits or push.

Contract: rev 1.1, SHA-256
`8f5d2fc6f7e7020e6e0a195dfbf94a4fd9d82952e62be312c5ddb4272a07eb4a`.
The supplied spec was copied read-only from the explicitly authorized VPS path and verified.
No production database, Redis or worker access, production configuration changes or deployment.
The spec is unmodified and remains an untracked supplied file.

## Implementation by section

| Spec | Implementation |
| --- | --- |
| 1–4: goal/invariant/non-goals | Ranking stays inside one atomic `CLAIM_LUA`. Existing IDLE, health, exclusions and pool filters run before ranking. BUSY ownership and cursor advancement stay atomic. No job-priority/FIFO, reliability or GPU-capacity changes. |
| 5: performance keys | `perf/performance-key.ts`: live keys use resolved row ID and `updatedAt`; archive resolutions carry an optional archive-version marker and use `id:vN:archived`. All eight selectors receive the key. |
| 6: parser/ingestion | `comfyui/execution-timing.ts` is pure history parsing. All three completion returns in `progress.ts` return optional timing, with caller-supplied candidate-node count. No statistics reads/writes in the parser. `perf/observe-completion.ts` retains results/errors and defers successful samples until guarded job completion (mannequin: intermediate output stored), and submits background samples. Cancelled completions and post-GPU failures settle as counters only, once. |
| 6: cache/reseed | Follow-up supersedes earlier conservative admission: OBSERVE admits usable timing with unreliable counts into provisional EWMA; fully-cached exclusion requires reliable counts. Provisional tags survive config flips. Bounded cached-count distribution (256 fields, 14-day TTL) added; dry-run reseed includes aggregate, score and distribution patterns. No outlier threshold selected. |
| 7–8: statistics/scoring | `perf/record-sample.ts` owns statistic writes, EWMA (default alpha 0.2), first-sample seeding, per-outcome counters, confidence blending, median switch after three mature workers, 24h linear decay, and 14-day hash TTLs. Periodic refresh runs every five minutes and stops at shutdown. |
| 9: selector | OFF/OBSERVE claim the first eligible worker in the existing cursor order. OBSERVE computes hypothetical preference without applying/writing backoff. ACTIVE mechanics: backoff, earliest expiry if all backed off, unknown-worker baseline, tie group relative to the single minimum, same cursor tie-break, atomic BUSY. Every performance Redis read uses `redis.pcall` with error-reply checking. Missing/invalid metadata falls back to round-robin. Existing post-claim gate/probe/release/re-selection remains; only effectively applied ACTIVE scoring writes a bounded 20s default probe backoff (15–30s configurable). |
| 10: modes/logs | Absent config means OFF. Config is read inside each atomic claim, so mode changes affect the next claim. Modes can be overridden by pool. Selection/completion logs include the requested key, worker, score/count, timing, cache/node and sibling fields when available. Four Prometheus counters documented in `docs/observability.md`. |
| 10: ACTIVE readiness | Production ACTIVE is hard-blocked by `NODE_COUNT_RULE_RELIABLE = false` and downgrades to OBSERVE, even if configured ACTIVE. Cache freezing with a recorded final threshold and per-pool opt-in are additional conditions. No ACTIVE certification or rollout is claimed. The other review-window/readiness conditions remain operator review requirements. |
| 11: shared GPU | Optional registry `gpuGroup` is retained across dispatcher registration. Worker group is read once; ungrouped workers start no timer, and grouped workers discover siblings once then HMGET those entries. Sibling BUSY sampling is read-only; no GPU capacity enforcement or DB column. Group metadata is operator supplied, not assigned in production by this task. |
| 12: caller wiring | Catalogue uses `tmplRoles` for both key and the approved patcher snapshot; direct try-on, regenerate, saree step 1, saree step 2 and Shopify use `template`; merchant uses `templateRow`; mannequin queries its own template's ID/updatedAt and uses that row. |
| 13: tests | Atomic ordering/concurrency, parity, minimum-relative ties, corruption fallbacks, mode changes, backoff/probe behavior, samples/counters/cache/confidence/decay/median/reseed, template edit/archive keys and all three completion returns covered. The existing caller test still requires seven processor consumers and one mannequin consumer, with no bare await. |
| 14: open items | Production cache distribution, final cache policy, configured baseline calibration, real-worker history retention and ACTIVE certification remain unverified; none inferred from local fixtures. |

## Files changed

Dispatcher production:
- `src/worker/selector.ts`, `src/worker/registry.ts`, `src/index.ts`.
- `src/perf/{config,performance-key,record-sample,observe-completion}.ts` (new).
- `src/comfyui/progress.ts`, `src/comfyui/execution-timing.ts` (new parser).
- `src/job/{processor,mannequin-phase}.ts`.
- `src/workflow/{resolve-template-version,patcher}.ts`.
- `scripts/reseed-performance-routing.mts` (new).

Tests:
- `src/comfyui/progress.test.ts`, new `src/comfyui/execution-timing.test.ts`.
- New `src/perf/{config,performance-key,observe-completion}.test.ts`.
- `test/integration/resolve-template-version.test.ts`.
- New `test/integration/performance-{routing,samples,probe-backoff,reseed}.test.ts`.

Shared/docs:
- `packages/observability/src/metrics.ts`.
- `docs/observability.md`, `docs/progress.md`, this report.
- The supplied, unchanged rev 1.1 spec is included in the review patch as a new file.

## totalNodeCount verification

Read-only inspection of the **local Docker** `tryon_dev.workflow_templates` found:

| Workflow type | Templates | Candidate nodes |
| --- | ---: | ---: |
| regular/catalogue | 71 | 48–80 |
| tryon | 44 | 17–40 |
| saree | 1 | 27 |
| saree_step1 | 10 | 28–29 |
| saree_step1_two_input | 8 | 29 |
| regeneration | 2 | 13 |

A separate join through `garment_subcategories.mannequin_workflow_template_id` and
`saree_mannequin_styles.mannequin_workflow_template_id` identified two actual mannequin
references, both `saree_step1`, each with 29 API-shaped nodes. Repository fixtures were also
inspected. The candidate shape is `class_type` plus `inputs`; stored graphs include custom
classes such as `ComfySwitchNode`, `Save Image With Callback` and custom text encoders.

Neither stored JSON nor repository patcher/detection code contains an authoritative custom
node execution/output/lazy-execution definition or a validated non-executing-note rule.
API shape alone therefore is **not** treated as proof of executability. `promptNodeCount`
counts string `class_type` candidates for measurement and always marks the result unreliable.
It does not invent a note-class blacklist. The test deliberately includes a hypothetical
custom note: it is counted as a candidate, never certified executable.

Original delivery consequence (superseded by Fix 1 below): successful runs skipped EWMA for
unreliable counts. The follow-up admits usable timing provisionally and populates scores;
ACTIVE remains blocked. The executable-node finding itself is unchanged.
Tests supply hypothetical reliable counts to exercise the sampler. Lua tests pass a hypothetical
validated-classifier flag; the post-probe test mocks that flag only in its isolated fixture.
A separate real-selector test verifies that the production false flag downgrades ACTIVE.

Local graph-inspection artifacts: `/tmp/perf-local-graphs.log`,
`/tmp/perf-mannequin-graphs.log` (class names/counts only; no graph inputs/credentials).
Temporary inspection scripts were removed.

## Amendments, deviations and unresolved limits

1. **Approved amendment to section 12:** catalogue previously resolved the row before selection,
   then `patchWorkflow` resolved again after uploads. The user approved an optional resolved-row
   argument, passed only by catalogue. Omitted argument retains the old self-resolution behavior.
   Resolution order is unchanged. Edits during that upload window apply to the next job, rather
   than changing this job's graph after its key was selected. This removes a redundant DB read
   and prevents EWMA contamination. A real Redis claim followed by a DB edit verifies the key
   and patched graph share the selected row; the omitted-argument path sees the edit. The other
   seven sites directly clone their previously resolved row and have no later re-resolution.
2. **Admission instruction superseded by follow-up Fix 1:** executable-node counting remains
   unresolved. The original user-directed EWMA block has been removed in favor of provisional
   OBSERVE calibration; ACTIVE remains blocked. Candidate nodes are not certified executable.
3. **History-contract ambiguity:** section 6 says cached counts are always recorded, but the frozen
   result omits all `executionTiming` when either timing message is missing. In those completions,
   the caller records the known candidate-node count and `missing_timing` skip; cached count is
   unknown/omitted. No extra result variant or callback was invented to bypass that contract.
4. **Outcome-source limitation:** the statistics service has separate queue-timeout and
   cleanup-failure counters and tests both. Current callers only receive `queue_cleanup_failed`,
   which maps to cleanup-failure. No separate automatic queue-timeout emission was invented;
   distinguishing queue-timeout from cleanup outcome requires a Stage 1 result-contract decision.
5. **Shared-GPU measurement precision:** sibling state is sampled once per second while waiting.
   Execution-window alignment uses the observed completion time minus worker-clock duration,
   so polling/network lag affects overlap estimates. Registry BUSY also covers input uploads and postprocessing; it is a proxy, not physical GPU-utilization telemetry. Start state can remain unknown when no
   sample covers the inferred start. Missing group metadata produces unknown values. These are
   measurements, not capacity/eligibility gates; exact worker/dispatcher clock alignment was not
   established. No group metadata was written to production.
6. **Engineering configuration details:** rev 1.1 leaves baseline values and config shape open.
   Implemented `mode`, optional `pools`, `baselineMs` (fallback 60,000), `poolBaselines`, `alpha`,
   `probeBackoffMs`, `cacheExcludeThreshold` and `cachePolicyFrozen`. Optional configured per-key
   baseline input is `perf:baseline:{key}:configured`; `perf:baseline:{key}` holds the computed
   baseline Lua reads. Added hash metadata `pool`, `performanceKey`, `cachePolicy`, last cache/node
   counts and skip counters for refresh/diagnostics. No raw-sample retention. These are additive
   storage details, not eligibility changes or claims that the fallback baseline is calibrated.
7. **Aggregation concurrency boundary:** background writes/refreshes serialize within this
   dispatcher connection/process. No cross-process statistics lock was added. Atomic worker
   ownership is still enforced by Lua across simultaneous dispatchers. Statistics remain best-effort
   and can be stale after dropped writes until a successful refresh; they never authorize a worker.
8. **ACTIVE review conditions:** sample coverage, prediction error, ordering stability and probe
   review remain operator certification conditions rather than an invented automated policy.
   The executable-node hard block prevents ACTIVE now. Provisional aggregates retain their tag
   after config freezing and must be deleted/re-collected; merely flipping config does not certify them.

## What applies even while OFF

OFF keeps the claimed worker and live queue-gate behavior unchanged and writes no performance
statistics/backoff. All jobs now pass resolved template keys, parse optional history timing and
compute candidate-node counts; the Lua claim reads the mode inside the same atomic request when
a key is supplied. Mode claim counters are populated. The approved catalogue snapshot amendment
also applies while OFF: an edit during uploads waits until the next job. Successful sampling is
settled only after guarded finalization (or successful mannequin intermediate storage); this is
an instrumentation change, not a change to completion, cancellation, timeout or ACK semantics.

## Actual verification

Local Docker services were confirmed healthy: `aivastra-postgres`, `aivastra-redis`,
`aivastra-minio`. Tests used local services and local mock HTTP servers. Nothing was deployed.

### Dispatcher units — exit 0

Command: `pnpm --filter @aivastra/dispatcher test`

```text
 Test Files  13 passed (13)
      Tests  186 passed (186)
   Start at  13:20:00
   Duration  3.25s (transform 605ms, setup 0ms, collect 1.65s, tests 1.05s, environment 0ms, prepare 84ms)
```

Log: `/tmp/perf-unit-settlement.log`.

### Full dispatcher integrations — exit 0

Command: `pnpm --filter @aivastra/dispatcher test:integration`

```text
 Test Files  35 passed (35)
      Tests  159 passed (159)
   Start at  13:20:05
   Duration  383.32s (transform 1.32s, setup 208ms, collect 8.49s, tests 374.05s, environment 0ms, prepare 43ms)
```

Log: `/tmp/perf-full-integration-final.log`. This repeated full run includes the reseed-script file and finalization settlement wiring. One subsequent optional-candidate scanning guard was verified in the focused run below, including the existing queue-gate file. Counts overlap; they must not be added together.

### Final focused dispatcher integrations — exit 0

Command:
`pnpm --filter @aivastra/dispatcher test:integration test/integration/performance-routing.test.ts test/integration/performance-samples.test.ts test/integration/performance-probe-backoff.test.ts test/integration/performance-reseed.test.ts test/integration/resolve-template-version.test.ts test/integration/selector-queue-gate.test.ts`

```text
 Test Files  6 passed (6)
      Tests  54 passed (54)
   Start at  13:49:55
   Duration  7.71s (transform 409ms, setup 49ms, collect 1.39s, tests 5.99s, environment 0ms, prepare 50ms)
```

Log: `/tmp/perf-targeted-final3.log`.

### Relevant API integrations — exit 0

Command: `pnpm --filter @aivastra/api test:integration test/integration/admin-workflows.test.ts`

```text
 Test Files  1 passed (1)
      Tests  67 passed (67)
   Start at  12:36:59
   Duration  17.79s (transform 1.87s, setup 19ms, collect 3.93s, tests 5.60s, environment 0ms, prepare 148ms)
```

Log: `/tmp/perf-api-integration.log`. No API production code changed.

### Typecheck — exit 0

`pnpm typecheck` built the shared packages and ran workspace typechecks. Actual final lines:

```text
apps/api typecheck$ tsc --noEmit
apps/catalogues-web typecheck$ tsc --noEmit
apps/shopify typecheck$ tsc -b
apps/chatbot typecheck$ tsc --noEmit
apps/chatbot typecheck: Done
apps/catalogues-web typecheck: Done
apps/shopify typecheck: Done
apps/api typecheck: Done
```

Log: `/tmp/perf-workspace-typecheck-final.log`. Dispatcher has no package `typecheck` script;
`pnpm --filter @aivastra/dispatcher exec tsc --noEmit` was also run successfully
(empty successful output; `/tmp/perf-typecheck-delivery.log`). Shared package builds are not migrations.

### Lint — exit 0

Command: `pnpm lint`

```text
The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 743.
Checked 1197 files in 698ms. No fixes applied.
Found 751 warnings.
Found 12 infos.
```

Log: `/tmp/perf-lint-delivery.log`. No lint errors. Final documentation and whitespace validation (`git diff --check`) also exited 0.

### Initial failures, shown rather than hidden

- Initial dispatcher typecheck rejected unchecked array indexes in `median` and sibling sampling:

```text
src/perf/observe-completion.ts(43,11): error TS2532: Object is possibly 'undefined'.
src/perf/observe-completion.ts(43,110): error TS2532: Object is possibly 'undefined'.
src/perf/record-sample.ts(28,31): error TS2322: Type 'number | undefined' is not assignable to type 'number'.
```

  Guarded array access was added; later dispatcher checks pass. `/tmp/perf-tsc.log`.
- First unit run was sandboxed without local socket access and the caller grep had not yet been
  updated for the instrumentation wrapper:

```text
Error: Test timed out in 30000ms.
Error: listen EPERM: operation not permitted 127.0.0.1
AssertionError: expected 0 to be greater than 0
 Test Files  2 failed | 9 passed (11)
      Tests  3 failed | 169 passed (172)
     Errors  2 errors
```

  Reran with authorized local socket access. The updated grep requires exactly seven processor
  and one mannequin result consumers and eight keyed selections; terminal handling assertions
  remain. `/tmp/perf-unit.log`, passing `/tmp/perf-unit-settlement.log`.
- First Redis tests assumed insertion order was Redis hash order:

```text
AssertionError: expected 'C' to be 'B' // Object.is equality
 Test Files  1 failed | 1 passed (2)
      Tests  9 failed | 22 passed (31)
```

  OFF parity fixtures now compute the original cursor choice from actual Redis hash order.
  Minimum-relative tie tests assert the exact first tie-group member in that order.
  `/tmp/perf-targeted.log`; final focused run passes.
- New snapshot fixture initially violated an existing database NOT NULL constraint:

```text
PostgresError: null value in column "garment_phase_prompt_node" of relation "workflow_templates" violates not-null constraint
 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 39 passed (40)
```

  Corrected the required fixture field without weakening assertions. `/tmp/perf-targeted3.log`;
  full/final focused snapshot test passes.
- First local graph inspection used an incorrect relative env-file path:

```text
node: ../../.env: not found
```

  Re-ran with an explicit local database endpoint and no env file. No credentials or prompt inputs
  were printed; only class names/counts were captured.

## Explicitly not done

- No production data/schema work, migrations, worker calls, performance collection or baseline calibration.
- No commits, push, PR, deploy, OBSERVE enablement or ACTIVE enablement.
- No reliable executable-node classifier; no accepted production EWMA samples or ACTIVE certification.
- No production cache-distribution review/final threshold, real-worker history-retention validation,
  prediction-error/order-stability certification or unexplained-backoff review.
- No exact shared-GPU clock synchronization, capacity enforcement or production group configuration.
- No new Stage 1 cancellation/timeouts/queue-gate behavior or wiring of other cancellation callbacks.
- No raw-sample retention, warm-cache affinity, reliability scoring or schema columns.
- No new result variants to recover cached counts when timing is absent or distinguish queue timeout
  from cleanup outcome. These contract limits are listed above.
- No full API unit/integration suite rerun; only the relevant workflow-admin integration file was run.
- No cross-process statistics serialization. No browser/UI work.

## Follow-up fixes

Review follow-up, 2026-10-03. Same branch; no commits, push, deployment or production mode changes.
Spec rev 1.1 remains unchanged. This section supersedes the original delivery's unknown-count
admission behavior and records the user-authorized histogram addition.

### Corrections and spec mapping

| Fix / spec | Result |
| --- | --- |
| 1 / sections 6–8, 10 | OBSERVE successes with finite positive worker-clock timing seed/update EWMA even with unreliable candidate counts. Unknown counts no longer exclude calibration data; those aggregates are provisional. Missing timing still skips. Fully-cached exclusion requires reliable positive totals under the provisional policy (`fully_cached`); a configured frozen threshold retains the existing final-policy behavior. Production node-rule flag remains false and ACTIVE remains hard-blocked. OFF returns before statistics/distribution writes. A real sample-to-Lua test checks baseline/scores, hypothetical preference and unchanged RR claim. |
| 2 / new authorized storage addition | `perf:cachedist:{performanceKey}` is a hash of available nonnegative integer cached counts for accepted and skipped successful samples, TTL 14 days. Atomic recording permits at most 256 distinct fields; existing fields keep incrementing at the limit. All distribution writes live in `record-sample.ts`. Reseed includes `perf:cachedist:*`; no outlier threshold or raw-sample retention added. |
| 3 / sections 9–10 | Unusable ranking changes effective ACTIVE to OBSERVE, leaving actual RR claim unchanged. The existing backoff writer and mode metric now receive the effective mode. A wrong-type score + failed probe integration test verifies no backoff is written. |
| 4 / section 11 | One initial HGET reads the claimed worker's group. Absent group means no interval, HGETALL or sibling polling. Present group triggers one discovery HGETALL; subsequent 1s reads HMGET sibling entries only. Unit tests exercise both paths and timer teardown. No measurement becomes a routing/capacity gate. |
| 5 / section 6 | Each completed return computes timing once. Added the requested best-effort pending-success early-return comment. |

Follow-up production files: `perf/record-sample.ts`, `perf/observe-completion.ts`,
`worker/selector.ts`, `comfyui/progress.ts`, `scripts/reseed-performance-routing.mts`.
Tests changed: `perf/observe-completion.test.ts`, integration
`performance-{samples,probe-backoff,reseed}.test.ts`. Updated observability documentation,
this report and progress log. Caller/patcher code was audited, not changed in the follow-up.

### Self-audit: write isolation and corruption

`recordSample` and periodic `refreshPerformanceScores` return promises from the same
`enqueue` helper, which catches/logs asynchronous errors and resolves. Job callers invoke
recording with `void`; periodic refresh also uses `void`. Redis failures do not throw into job
execution. A corrupt current statistics key of the wrong Redis type drops that sample with a
warning; it is not destructively replaced. A corrupt sibling aggregate previously aborted the
whole refresh: the audit found this bug and added isolated `readStats` handling so that sibling
uses baseline and other scores still update. The scan also skips unreadable aggregates.

Malformed numeric fields previously could produce NaN EWMA/counters. This was a clear bug:
invalid counters now seed at zero; an invalid previous EWMA seeds from the new valid timing.
Integration tests cover malformed fields, wrong-type current keys (promise resolves), and
wrong-type siblings during sample/periodic refresh. A corrupt distribution hash can still cause
that background sample to be logged/dropped; it cannot fail a job. No automatic destructive
repair or cross-process EWMA lock was added.

### Self-audit: eight template keys and graph resolution

- Catalogue (`processJob`): `tmplRoles` resolves the effective post-override ID once before select; its key and optional patcher row are the same object. No second resolve after selection (approved amendment retained).
- Direct try-on (`processTryonDirectJob`): resolved `template` supplies key and `structuredClone(template.jsonContent)`; no later resolve.
- Try-on regeneration (`processRegenerateJob`): resolved `template` supplies key and cloned graph; no later resolve.
- Saree mannequin job final phase (`processSareeMannequinJob`): resolved `template` supplies its key and cloned graph; the separate mannequin subphase uses its own row/key; no later re-resolve of this selected row.
- Saree direct job (`processSareeJob`): resolved `template` supplies key and cloned graph; no later resolve.
- Merchant/widget (`processWidgetJob`): `resolvedTemplate` is filtered into `templateRow`; the same active row supplies key and cloned graph; no later resolve.
- Shopify (`processShopifyJob`): resolved `template` supplies key and cloned graph; no later resolve.
- Mannequin: queries the mannequin template's ID, updatedAt, graph and mappings once; uses that row for key and cloned graph. No final-saree key or later resolve; archive resolver is not used in this existing path.

### Self-audit: settlement exits

The seven processor paths each use the same settlement structure. Successful finalization
calls `settlePerformanceSample(w, 'success')`; guarded completion rejected by DB cancellation
calls it with `cancelled` before ACK/return. Errors after GPU success but before finalization
call it from catch as cancelled/workflow_failure. These consume and remove the pending sample
before background submission, so recording happens at most once.

**The function is not literally invoked exactly once on every claimed-worker exit:**
- Queue-cleanup result returns early without settlement in all seven processor paths and the mannequin path: `observeCompletion` already records cleanup failure directly and creates no pending success.
- Wait cancellation/execution timeout/workflow error is recorded directly by `observeCompletion`; outer catch invokes settlement but finds no pending sample, preventing duplicate recording.
- Errors before entering the waiter (download/upload/patch/submit/event write) invoke catch settlement with no pending sample. These currently produce no performance outcome statistic.
- OFF / no performance metadata: settlement can be called, but no pending sample was created and statistics stay absent.
- An error after successful settlement (e.g. ACK, widget SSE/webhook publication) reaches catch and invokes settlement again, but the pending entry is already deleted. The successfully finalized sample is not counted twice or reclassified.
- No-worker, validation/pre-claim returns and mannequin existing-intermediate returns claim no worker and do not settle.
- Process termination or a future early return after a successful waiter but before settlement can lose the pending sample; the added comment records this accepted best-effort limitation. No such additional normal early-return path was found in the current eight paths.

Mannequin success settles after intermediate storage; post-GPU errors settle workflow failure
and rethrow; its cleanup result returns directly as described above. Worker release still runs
in each existing finally. No Stage 1 cancellation callback or release/ACK behavior changed.

### Deviations and remaining limits (complete current list)

1. Approved catalogue optional-row snapshot amendment to section 12 remains; applies even OFF.
2. Follow-up Fix 1 explicitly supersedes the earlier user handoff's unknown-total EWMA skip. Provisional OBSERVE timing samples are admitted without a node classifier; ACTIVE remains blocked. Provisional tags persist through configuration flips and reseed is required before future ACTIVE certification.
3. Follow-up Fix 2 adds the bounded distribution hash and its reseed pattern beyond rev 1.1's original Redis model; this is explicitly authorized, not an implicit spec edit.
4. Missing either timing message still omits executionTiming entirely, so cached count is unavailable for those skipped successes: no histogram field is invented for an unknown count. Known candidate count/reliability remains in completion logs.
5. Existing queue-cleanup result maps to cleanup failure, not a distinct queue-timeout counter. Stage 1 results/cancel semantics remain unchanged.
6. Shared-GPU measurement remains an approximate registry BUSY proxy with local-completion alignment, 1s polling and unknown start state when not observed. Sibling membership is a start-of-job snapshot; group edits/new siblings mid-job are not rediscovered. No physical-utilization measurement, clock synchronization or capacity enforcement.
7. Baseline/config defaults and extra aggregate metadata remain engineering choices documented above; no production calibration or certification claimed.
8. EWMA/refresh serialization is per connection/process only; no cross-process statistics lock. Redis failures can drop observations; corrupt current keys are logged/dropped rather than overwritten. Errors before the waiter are not counted by this sampler.
9. ACTIVE readiness conditions beyond the hard node/cache/pool gate remain operator review requirements (sample coverage, error bound, stability, distribution review, probe behavior). No outlier threshold selected, no raw retention, warm-cache affinity or reliability score.

### Follow-up verification

Results below refer to actual local-service runs, not the original delivery's earlier counts.

Dispatcher units, exit 0: `pnpm --filter @aivastra/dispatcher test`
(`/tmp/perf-followup-unit.log`):

```text
 Test Files  13 passed (13)
      Tests  188 passed (188)
   Start at  15:51:56
   Duration  1.81s (transform 356ms, setup 0ms, collect 921ms, tests 631ms, environment 0ms, prepare 40ms)
```

Focused integrations, exit 0:
`pnpm --filter @aivastra/dispatcher test:integration test/integration/performance-samples.test.ts test/integration/performance-probe-backoff.test.ts test/integration/performance-reseed.test.ts test/integration/performance-routing.test.ts`
(`/tmp/perf-followup-focused.log`):

```text
 Test Files  4 passed (4)
      Tests  43 passed (43)
   Start at  15:52:09
   Duration  2.18s (transform 124ms, setup 27ms, collect 249ms, tests 1.67s, environment 0ms, prepare 40ms)
```

`pnpm typecheck`, exit 0 (`/tmp/perf-followup-workspace-typecheck.log`):

```text
apps/api typecheck$ tsc --noEmit
apps/catalogues-web typecheck$ tsc --noEmit
apps/chatbot typecheck$ tsc --noEmit
apps/shopify typecheck$ tsc -b
apps/chatbot typecheck: Done
apps/catalogues-web typecheck: Done
apps/shopify typecheck: Done
apps/api typecheck: Done
```

Explicit dispatcher check `pnpm --filter @aivastra/dispatcher exec tsc --noEmit` also exited 0,
with empty output (`/tmp/perf-followup-dispatcher-typecheck.log`).

Initial `pnpm lint` exited 1 (`/tmp/perf-followup-lint.log`):

```text
Checked 1197 files in 717ms. No fixes applied.
Found 2 errors.
Found 751 warnings.
Found 12 infos.
```

The first log's diagnostic limit hid the errors, so a targeted Biome check identified:

```text
apps/dispatcher/scripts/reseed-performance-routing.mts format
  × Formatter would have printed the following content:
apps/dispatcher/test/integration/performance-samples.test.ts:1:1 assist/source/organizeImports
  × Sort these imports.
```

Formatted only those two files and reran `pnpm lint`, exit 0
(`/tmp/perf-followup-lint-final.log`):

```text
The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 743.
Checked 1197 files in 722ms. No fixes applied.
Found 751 warnings.
Found 12 infos.
```

Intentional corruption tests emit caught WRONGTYPE warnings; those tests passed, not suppressed.
No unit or focused integration failures occurred in this follow-up. No API suite rerun in the
follow-up (no API files changed). Original relevant API verification remains above.

Local-service health verification: first command used an incorrect filename and exited 1:

```text
open /home/manikanta-srinivas-gunnam/Projects/aivastra/infra/docker-compose.dev.yml: no such file or directory
```

Read `package.json` and reran its actual local compose path, exit 0:
`docker compose -f infra/docker-compose.yml --env-file .env ps --format '{{.Name}} {{.Status}}'`

```text
aivastra-minio Up 3 days (healthy)
aivastra-postgres Up 3 days (healthy)
aivastra-redis Up 3 days (healthy)
```

No environment values were printed. Spec hash rechecked unchanged.

Full dispatcher integration, exit 0:
`pnpm --filter @aivastra/dispatcher test:integration`
(`/tmp/perf-followup-integration.log`):

```text
 Test Files  35 passed (35)
      Tests  165 passed (165)
   Start at  15:52:33
   Duration  353.94s (transform 778ms, setup 118ms, collect 3.94s, tests 349.54s, environment 0ms, prepare 40ms)
```

Focused integration counts overlap the full suite and must not be added to it. No follow-up
integration failures occurred. Final whitespace validation (`git diff --check`) passed.

**Explicit not done:** commits, push, deployment, OBSERVE/ACTIVE rollout, production data/schema
or configuration access, migrations, reliable executable-node classification, ACTIVE readiness
certification, selecting an outlier cache threshold, raw-sample storage, capacity/affinity/
reliability routing, Stage 1 changes, automatic repair of corrupt Redis keys, cross-process
statistics locking and a fresh API suite rerun. Only review artifacts are copied to VPS `/tmp/`.

Final documentation-stage `pnpm lint` also exited 0 (`/tmp/perf-followup-lint-delivery.log`):

```text
Diagnostics not shown: 743.
Checked 1197 files in 711ms. No fixes applied.
Found 751 warnings.
Found 12 infos.
```

## Authorized PR delivery

The user subsequently authorized committing the verified feature and opening a PR into `dev`.
Earlier no-commit/no-push statements describe the implementation/review phase. Deployment and
OBSERVE/ACTIVE enablement remain unauthorized in this delivery step. Refreshed `origin/dev`
contains 22 newer commits with no dispatcher source overlap; only progress/observability docs
overlap this feature. Combined-branch validation will be recorded after integrating the target.
