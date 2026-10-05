# Selector skip logging context — implementation report

Branch: `fix/selector-skip-log-context`, created from refreshed `origin/dev` at
`ae13e002` (PR #469 merged). Working-tree changes only; no commits or pushes.
No deployment, production DB/Redis/GPU access, or manual routing configuration changes.
Only local Docker services and mock HTTP servers are used for verification. The sole remote
write planned is delivery of the review artifacts to the explicitly requested VPS `/tmp/`.

## What changed

- `apps/dispatcher/src/worker/selector.ts`: optional fourth `ctx` parameter with `jobId` and
  `log`. Skip, release-failure, backoff-write-failure and no-worker messages use the provided
  job logger or the existing module logger. The internal queue probe now returns availability
  and diagnostic fields; only exact numeric zero is available, as before.
- `apps/dispatcher/src/job/processor.ts`: all seven existing selectors pass `{ jobId, log: jobLog }`.
- `apps/dispatcher/src/job/mannequin-phase.ts`: its selector passes the same context.
- New `apps/dispatcher/src/worker/selector.test.ts`: module-logger fallback, context logger,
  fail-closed classifications, timeout duration, release retries, probe cap, unchanged metric
  label, secret/URL absence, gate-off behavior and all eight context-bearing callers.
- New `apps/dispatcher/test/integration/selector-skip-log-context.test.ts`: real isolated Redis
  registry plus existing ComfyMock; queue-busy redirect, HTTP 500, ordered all-busy/mixed-reason
  exhaustion, no-health summary, release/claim state and captured payload secret/URL absence.
- `apps/dispatcher/src/comfyui/progress.test.ts`: user-approved source regex now requires the
  fourth context argument at all seven processor sites and the one mannequin site; existing
  no-bare-await/completion-result assertions are unchanged.
- This report and a new dated `docs/progress.md` entry.

## Exact log fields

`worker busy or unreadable in ComfyUI — skipping` (INFO, original message unchanged):

| Field | Value |
| --- | --- |
| `workerId` | Skipped worker ID only |
| `jobId` | Optional explicit context ID; processor job loggers also retain existing bindings |
| `pool` | Unmodified `jobType` / worker-pool string |
| `attempt` | Existing selector loop index plus one (1–4) |
| `reason` | `queue_not_empty` for a readable numeric nonzero count; `unreadable` for HTTP errors, timeout/fetch exceptions, parse failure or missing/non-numeric field |
| `queueRemaining` | Only included for a readable numeric nonzero `/prompt` `exec_info.queue_remaining`; omitted for unreadable responses |
| `probeMs` | Milliseconds from just before the existing HTTP probe through body parsing; excludes Redis gate read and release |
| `selectionMode` | Existing effective mode already returned by `CLAIM_LUA`; no additional read |

`no eligible worker after probes` (INFO, once on either null return):
`pool`, optional `jobId`, `skippedWorkers` (IDs in order), `reasons` (parallel array in the same
order). Empty arrays mean no eligible registry candidate; Redis/selector exceptions retain
existing propagation and do not masquerade as a null return.

Persistent release-failure (ERROR) and backoff-write-failure (WARN) retain their existing
`err`/`workerId` payload and message, routed through the job logger when supplied. No claimed
or registry worker object, URL, query data or API-key field is added to any log.

## Behavior preservation and permitted omissions

- Verified `CLAIM_LUA` is byte-for-byte identical to the dev baseline.
- Verified the `ClaimedWorker` construction, including optional `performance`, is unchanged.
- Same Redis EVAL arguments/exclusions, eligibility, atomic BUSY, gate read, HTTP request,
  2s AbortSignal timeout, four-probe bound, release retries, backoff condition/TTL and scoring.
- Rejection metric still uses exactly `{ reason: 'queue_not_empty_or_unreadable' }`. No metrics
  file, label, mode key or statistics code changed. Existing performance tests may manipulate
  their local Redis fixture config as before; no production/manual mode changes are made.
- Omitted context uses the module logger and preserves routing/return behavior. Required log
  enrichment and the new null summary apply there too; this is the task's intended logging
  change, not a claim that old log payload bytes remain identical.
- **Item 5 skipped under its explicit allowance:** seven processor paths already have a
  worker-claimed line. The selector owns the skip count and has no existing way to supply it
  to those lines without changing return values or adding a callback/mutable context channel.
  Those interfaces are forbidden/not requested; no duplicate success log was added. Mannequin
  likewise gains no extra success log. Skip/exhaustion events are traceable without that count.
- Existing selector/performance/queue-gate integration tests are unchanged. The original
  caller regex in `progress.test.ts` expected exactly three selectWorker arguments;
  the user explicitly approved updating only that regex to require `{ jobId, log: jobLog }`
  at all eight sites. This is the sole exception to the existing-test rule and strengthens
  the source guard. No routing/behavior assertion was changed.

## Actual verification

Local services: PostgreSQL, Redis and MinIO healthy. An initial Docker health command in the
sandbox failed with `permission denied ... /var/run/docker.sock ... operation not permitted`;
rerunning with approved Docker access succeeded:

```text
aivastra-minio Up 41 minutes (healthy)
aivastra-postgres Up 41 minutes (healthy)
aivastra-redis Up 41 minutes (healthy)
```

New logging units: exit 0.
`pnpm --filter @aivastra/dispatcher test src/worker/selector.test.ts`
(`/tmp/selector-log-unit-focused.log`):

```text
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  10:54:32
   Duration  326ms (transform 68ms, setup 0ms, collect 98ms, tests 13ms, environment 0ms, prepare 46ms)
```

Focused selector integrations: exit 0.
`pnpm --filter @aivastra/dispatcher test:integration test/integration/selector-skip-log-context.test.ts test/integration/selector.test.ts test/integration/selector-queue-gate.test.ts test/integration/performance-routing.test.ts test/integration/performance-probe-backoff.test.ts`
(`/tmp/selector-log-integration-focused.log`):

```text
 Test Files  4 passed (4)
      Tests  41 passed (41)
   Start at  10:54:35
   Duration  654ms (transform 104ms, setup 29ms, collect 222ms, tests 166ms, environment 0ms, prepare 38ms)
```

There is no existing integration file named `selector.test.ts`; the command matched four
actual files. All logging, performance-ranking, probe-backoff and queue-gate tests in those
files passed. Counts overlap the full suite and must not be added to it.

Initial full dispatcher units: exit 1 (resolved below).
`pnpm --filter @aivastra/dispatcher test` (`/tmp/selector-log-unit.log`):

```text
 FAIL  src/comfyui/progress.test.ts > typed caller enforcement > all production call sites consume completion results before output-fetch; no bare await
AssertionError: Target cannot be null or undefined.
 ❯ src/comfyui/progress.test.ts:609:88

 Test Files  1 failed | 13 passed (14)
      Tests  1 failed | 197 passed (198)
   Start at  10:56:19
   Duration  1.86s (transform 345ms, setup 0ms, collect 914ms, tests 627ms, environment 0ms, prepare 54ms)
```

This was the unchanged three-argument source regex; all other units passed. No behavior assertion
failed. The user subsequently approved its context-bearing update; actual full rerun below.

`pnpm typecheck`: exit 0 (`/tmp/selector-log-typecheck.log`). Explicit dispatcher
`pnpm --filter @aivastra/dispatcher exec tsc --noEmit` also exited 0 with empty output
(`/tmp/selector-log-dispatcher-typecheck.log`). Workspace final output:

```text
packages/types typecheck: Done
apps/api typecheck$ tsc --noEmit
apps/chatbot typecheck$ tsc --noEmit
apps/shopify typecheck$ tsc -b
apps/catalogues-web typecheck$ tsc --noEmit
apps/chatbot typecheck: Done
apps/catalogues-web typecheck: Done
apps/shopify typecheck: Done
apps/api typecheck: Done
```

`pnpm lint`: exit 0 (`/tmp/selector-log-lint.log`):

```text
The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 747.
Checked 1212 files in 871ms. No fixes applied.
Found 754 warnings.
Found 13 infos.
```

Full dispatcher integration: exit 0.
`pnpm --filter @aivastra/dispatcher test:integration` (`/tmp/selector-log-integration.log`):

```text
 Test Files  36 passed (36)
      Tests  170 passed (170)
   Start at  10:56:16
   Duration  325.94s (transform 883ms, setup 98ms, collect 3.86s, tests 321.43s, environment 0ms, prepare 96ms)
```

All unchanged selector/performance/queue-gate integration files passed. No integration failure.
Final `git diff --check` passed. Individual lint-warning ancestry was not audited.

## Not done / outstanding

No commit, push, PR, deployment, production config or mode changes, schema changes, worker
calls, new metrics, scoring/backoff/routing changes, duplicate success logs or API test rerun.
The initial source-guard failure is resolved by the explicitly approved regex-only update;
all 198 units now pass. Final review patch includes the new tests/report and approved guard edit. Artifacts are prepared for transfer to VPS `/tmp/`; no
production application checkout is modified.

Final documentation-stage `pnpm lint` also exited 0 (`/tmp/selector-log-lint-final.log`):

```text
Diagnostics not shown: 747.
Checked 1212 files in 729ms. No fixes applied.
Found 754 warnings.
Found 13 infos.
```

## Approved caller-guard correction and final units

The user answered "Yes—update the caller guard". Updated only the source regex to require
`{ jobId, log: jobLog }`, preserving exact seven-plus-one counts and all other assertions.
No runtime code changed after the full integration run, so its 170-pass result applies to
this final implementation. No complete integration repeat was needed for a regex-only test edit.

Full unit rerun, exit 0:
`pnpm --filter @aivastra/dispatcher test` (`/tmp/selector-log-unit-final.log`):

```text
 Test Files  14 passed (14)
      Tests  198 passed (198)
   Start at  11:03:54
   Duration  1.53s (transform 275ms, setup 0ms, collect 757ms, tests 508ms, environment 0ms, prepare 48ms)
```

Current deviations: optional success enrichment omitted as allowed in item 5; one existing
source-guard assertion updated with explicit user authorization. No unresolved implementation
blocker. No claim that unreadable responses expose a queue length: that field is omitted.

Final lint after the approved caller-guard update, exit 0 (`/tmp/selector-log-lint-delivery.log`):

```text
Diagnostics not shown: 747.
Checked 1212 files in 719ms. No fixes applied.
Found 754 warnings.
Found 13 infos.
```
