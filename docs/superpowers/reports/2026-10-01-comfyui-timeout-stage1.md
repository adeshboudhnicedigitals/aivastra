> Commit preparation update: the user authorized one complete commit and no push. The unchanged specification now lives at `docs/superpowers/specs/2026-09-30-comfyui-timeout-from-execution-start-design-rev4.4.9.md`; its SHA-256 was verified before and after relocation. Earlier no-commit/root-location statements describe the original review snapshot. Future PR target: `dev`. Cancellation quarantine remains an open question in `docs/progress.md`.

# ComfyUI execution-start timeout: Stage 1 working-tree report

Branch: `feat/comfy-timeout-execution-start`, directly off `dev`; HEAD and dev remain
`bf469d9e1176ddc4b4e54b9b171c9e3d8608e75f`. No commits, staging, pushes or production access.
Spec unchanged; verified SHA-256:
`ca30211627405593bf05ba41af601b0c1208f88c15bac9fd2265227df46e2199`.

## Contract mapping

| Spec section | Implementation |
|---|---|
| Delivery Stage 1 / PRE_START / RUNNING / LEGACY_FALLBACK | `apps/dispatcher/src/comfyui/progress.ts`: history-first, PRE_START queue polling, sticky RUNNING, execution clock from `firstObservedRunningAt`, three consecutive queue errors or unknown grace enter sticky fallback with `max(submittedAt + timeoutMs, legacyEnteredAt + timeoutMs)`. |
| Queue-budget exhaustion | PRE_START checks `now > submittedAt + maxQueueWaitMs` after history; the review-approved extension reconciles history/queue, attempts live-authorized scoped deletion, then observes and retries within `queueCleanupTimeoutMs`. Completion and running observations take precedence. Confirmed absence requires grace and a final history read. Terminal exhaustion still returns `queue_cleanup_failed`; no requeue. |
| Typed results / responsibility split / callers | `comfyui/completion-result.ts` exhaustively consumes Stage 1 results; all seven direct sites in `job/processor.ts` use it and return before output handling on exhaustion. `job/mannequin-phase.ts` switches exhaustively and translates to `cleanup_failed`; the processor owns termination/refund. Existing mannequin `no_worker` policy remains. |
| Cleanup exhaustion release | `worker/registry.ts`: bounded, retried atomic BUSY→IDLE release, DRAINING preserved; failure metric and ERROR log. Used by migrated processor releases and mannequin finally. |
| Capability model / mutation transition table | `packages/types/src/worker-capabilities.ts`: strict schema, configured/not_configured/unreadable distinction, keys, shared mutation checks. `apps/api/src/modules/admin/{worker-capabilities,workers.routes}.ts`: GET/PUT/DELETE capability routes; permission guards, audit-before-write, gate-off/clear/version/rename protections, lifecycle moves/deletion. Scoped interrupt enablement requires `validationReference` for a recorded two-real-prompts test. |
| Version guard / drift | `worker/capabilities.ts`, `worker/health-monitor.ts`: fresh reported version match, 60s TTL, DRAINING probes without renewing health, budget-independent drift detector. Stats-body failures preserve existing HTTP-status routing health. API lists warnings; `apps/admin-web/src/pages/WorkersPage.tsx` displays them. |
| Live authorization / cancellation | `comfyui/cancel.ts`, `comfyui/client.ts`, `worker/bounded-read.ts`: per-operation capability/version rechecks, scoped delete + interrupt, bounded history/queue confirmation, pending delete retries, conservative ratchet, fresh authorization even for LEGACY unscoped interrupt. HTTP errors cannot turn a cancel into a workflow failure. Outer deadline starts before the first cancel-time read. |
| Configuration | `config/comfy-timeout.ts`: live `config:comfy-timeout` JSON per submission, positive queue budget, retained engineering defaults, invalid/unreadable/unset budget disables queue-aware timeout. Review-approved cleanup adds a 30s default budget and the grace-plus-two-polls validation constraint; only positive `maxQueueWaitMs` needs explicit configuration. |
| Metrics / alerts | `packages/observability/src/metrics.ts`: queue wait, exhaustion, fallback entry, unreadable capability/context, version mismatch, gate drift, config loss, live authorization skips by operation, cancel mode/outcome, delete failures. Existing release-failure counter reused. `docs/observability.md` gives alert conditions using the repo's existing manual Grafana Cloud process. |
| Tests / mock | Rewritten `comfyui/progress.test.ts` (58 tests) with URL-specific responses and mutable capability/version state; config, health, release and admin mutation tests; mock pending/running scheduling, scoped deletion/interrupt, failures/counters, finish-time history, version, per-request hook and prompt reset. Real local caller integrations exercise refunds, unchanged attempts, no requeue/output and atomic release; scan rule rejects bare awaits. |

## Scope decisions and findings

- Your clarification overrides the full Stage 2 enablement formula: Stage 1 needs
  only explicit `maxQueueWaitMs`. Following review, you explicitly approved changing exhaustion handling and adding cleanup. Cleanup now defaults to 30s and validates the grace-plus-two-polls constraint. Safe cancel remains independent of both the gate and budgets.
- The requested spec path was absent. The supplied root file has the exact required
  hash. It was not edited or moved; move it under `docs/superpowers/specs/` before a
  future commit, as requested.
- Stage 1's completion union is deliberately `completed | queue_cleanup_failed`.
  The Stage 2 `queue_capacity_timeout` member and its requeue policy are absent:
  the approved extension can now confirm absence, but retains the terminal/refund policy rather than adding capacity requeue.
- **C/test fixture:** a reused API Redis test index retained a routing flag; the
  test expecting `ungated` received `unavailable`. The fixture now establishes its
  gate state before asserting. No routing implementation changed.
- **Test fixtures:** merchant billing fixture lacked a user-credit row. The
  exhaustion helper seeds billing accounts before checking refunds. The existing
  happy-path stream-message fixture used an invalid `mock-msg-id`; it now uses
  a valid Redis stream ID. Dispatcher fixtures use test-only key prefixes so the
  local dev registry is preserved.
- **C:** history transport aborts still escape the ordinary poll and enter the
  existing attempt/failure path. A regression test explicitly preserves this.
- **D:** revocation remains best-effort at the next authorization check; requests
  already sent cannot be recalled. Queue exhaustion and conservative/unconfirmed
  cancel may orphan work. Protection depends on the queue gate; Redis loss can
  remove that protection. No quarantine was added.

## Behaviors that change for every ComfyUI job

Every caller now uses the rewritten waiter, reads the submission's capability/config
snapshot, logs the effective mode and consumes a typed result. Processor worker
releases now use bounded atomic BUSY→IDLE with retry. The monitor maintains version
keys and probes DRAINING workers even when features are dormant.

The timeout split is implemented in the rewritten loop, but **queue-aware clocks
activate only with configured identity/delete capabilities, a fresh matching version,
the queue gate and a positive queue budget**. All other submissions retain the
submission-based execution allowance and never poll `/queue` for timeout tracking.
Once queue-aware, queue time does not consume the 300s execution budget; fallback
entered mid-flight gets a full allowance. Normal polling deadlines remain soft.

**SAFE_SCOPED cancel activates with all three capabilities and version match only**;
it needs neither the gate nor budgets. Otherwise configured/unreadable/lost validation
is CONSERVATIVE, while never-configured LEGACY uses a freshly authorized unscoped
interrupt. All cancellation HTTP failures still end as `JobCancelledError`.

## Validation: actual output

The commands below were run, not inferred from source. Full stdout/stderr is available
in the linked local logs. All integration services and mock worker URLs were local.

`pnpm --filter @aivastra/dispatcher test`
([full output](/tmp/comfy-dispatcher-tests-final.log)):

```text
 Test Files  8 passed (8)
      Tests  134 passed (134)
   Start at  17:38:24
   Duration  1.44s (transform 250ms, setup 0ms, collect 692ms, tests 501ms, environment 0ms, prepare 47ms)
```

`pnpm --filter @aivastra/api test`
([full output](/tmp/comfy-api-tests.log)):

```text
 Test Files  82 passed (82)
      Tests  749 passed (749)
   Start at  17:01:51
   Duration  37.00s (transform 4.23s, setup 2.06s, collect 211.01s, tests 229.01s, environment 30ms, prepare 9.22s)
```

`pnpm --filter @aivastra/api test:integration test/integration/admin-workers.test.ts test/integration/admin-audit-logs.test.ts`
([full output](/tmp/comfy-api-integration-final.log)):

```text
 Test Files  2 passed (2)
      Tests  22 passed (22)
   Start at  17:30:30
   Duration  9.95s (transform 1.32s, setup 36ms, collect 5.55s, tests 6.81s, environment 0ms, prepare 133ms)
```

`pnpm --filter @aivastra/dispatcher test:integration test/integration/happy-path.test.ts test/integration/tryon-direct-webp.test.ts test/integration/regenerate-job.test.ts test/integration/saree-mannequin.test.ts test/integration/saree-step2-workflow-override.test.ts test/integration/merchant-widget-two-input.test.ts test/integration/shopify.test.ts test/integration/mannequin-capacity.test.ts`
([full output](/tmp/comfy-dispatcher-integration-final.log)):

```text
 Test Files  8 passed (8)
      Tests  33 passed (33)
   Start at  17:33:04
   Duration  113.45s (transform 386ms, setup 34ms, collect 1.42s, tests 111.73s, environment 0ms, prepare 39ms)
```

After adding the execution-timeout caller policy test,
`pnpm --filter @aivastra/dispatcher test:integration test/integration/happy-path.test.ts`
([full output](/tmp/comfy-dispatcher-timeout-policy.log)):

```text
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  17:38:29
   Duration  10.54s (transform 258ms, setup 18ms, collect 717ms, tests 9.56s, environment 0ms, prepare 41ms)
```

`pnpm --filter @aivastra/dispatcher exec tsc --noEmit` emitted no output and exited 0
([output](/tmp/comfy-dispatcher-typecheck-final.log)).
`pnpm --filter @aivastra/api typecheck` emitted its normal command header and exited 0
([output](/tmp/comfy-api-typecheck-final.log)).
`pnpm --filter @aivastra/admin exec tsc --noEmit` emitted no output and exited 0
([output](/tmp/comfy-admin-typecheck.log)). Shared types/observability/DB packages were
built locally before checking; stale generated DB types initially caused errors and
were resolved by rebuilding, without schema changes.

`pnpm lint` exited 0 ([full output](/tmp/comfy-lint-final.log)):

```text
The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 743.
Checked 1171 files in 717ms. No fixes applied.
Found 751 warnings.
Found 12 infos.
```

`git diff --check` passed. Bare-await scan has no production matches, and is also
asserted by a unit test.

### Earlier failures, subsequently addressed

- Initial API/socket-limited dispatcher runs failed inside the sandbox:
  `Error: connect EPERM 127.0.0.1:5432` and mock-server socket errors. Reran with
  approval for local networking; dispatcher initial output is retained
  [here](/tmp/comfy-dispatcher-tests.log).
- `pnpm docker:up` first lacked Docker-socket permission. The approved retry failed:
  `minio-bootstrap Error error from registry: unauthorized`, followed by
  `Error response from daemon: error from registry: unauthorized` and exit 1.
  Local compose `ps` confirmed all three required services already healthy; tests
  used them without changing the compose image or pulling credentials.
- API routing fixture failure ([full output](/tmp/comfy-api-integration.log)):
  `AssertionError: expected 'unavailable' to be 'ungated'`. Fixed fixture isolation;
  all 22 relevant integration tests passed on rerun.
- Initial dispatcher integration run ([full output](/tmp/comfy-dispatcher-integration.log)):
  `Test Files 4 failed | 4 passed (8)`, `Tests 9 failed | 23 passed (32)`.
  It caught the missing credit-row fixture and loaded an older mock while files
  were being edited (`TypeError: comfy.resetPrompts is not a function`). This was
  corrected and rerun after edits; all eight files passed.
- Adding fake abort-signal timers exposed a test expectation mismatch:
  `AssertionError: expected 'aborted' to be 'request timed out'`. The assertion
  now checks the actual abort, preserving history-failure behavior; the final
  progress and full dispatcher suites passed.

## Explicitly not done

- Stage 2 PRE-/POST-delete reconciliation, timeout delete, CLEANUP,
  `queue_capacity_timeout` requeue, cleanup budget/constraint, final-history rule,
  containment/boundary/cleanup tests or Stage 2-only metrics.
- History polling resilience, BUSY-worker rename fix, queue-gate changes or queue-age normalization.
- Production access, capability enablement, budget configuration, real-worker
  compatibility/two-real-prompts validation, key rotation, Grafana Cloud provisioning,
  deployments, commits or pushes. Alert conditions are documented, not installed live.
- Spec relocation completed before the authorized commit, with unchanged SHA-256. No specification edits.
- Unrelated full integration suites, whole-monorepo build/typecheck or paused admin-mobile work.

## Files changed

- `apps/admin-web/src/pages/WorkersPage.tsx`
- `apps/api/src/modules/admin/worker-capabilities.test.ts`
- `apps/api/src/modules/admin/worker-capabilities.ts`
- `apps/api/src/modules/admin/workers.routes.ts`
- `apps/api/test/integration/admin-workers.test.ts`
- `apps/dispatcher/src/comfyui/cancel.ts`
- `apps/dispatcher/src/comfyui/client.ts`
- `apps/dispatcher/src/comfyui/comfy-mock.test.ts`
- `apps/dispatcher/src/comfyui/completion-result.ts`
- `apps/dispatcher/src/comfyui/progress.test.ts`
- `apps/dispatcher/src/comfyui/progress.ts`
- `apps/dispatcher/src/config/comfy-timeout.test.ts`
- `apps/dispatcher/src/config/comfy-timeout.ts`
- `apps/dispatcher/src/job/mannequin-phase.ts`
- `apps/dispatcher/src/job/processor.ts`
- `apps/dispatcher/src/worker/bounded-read.ts`
- `apps/dispatcher/src/worker/capabilities.ts`
- `apps/dispatcher/src/worker/health-monitor.test.ts`
- `apps/dispatcher/src/worker/health-monitor.ts`
- `apps/dispatcher/src/worker/registry.test.ts`
- `apps/dispatcher/src/worker/registry.ts`
- `apps/dispatcher/test/helpers/comfy-mock.ts`
- `apps/dispatcher/test/helpers/queue-exhaustion.ts`
- `apps/dispatcher/test/integration/happy-path.test.ts`
- `apps/dispatcher/test/integration/mannequin-capacity.test.ts`
- `apps/dispatcher/test/integration/merchant-widget-two-input.test.ts`
- `apps/dispatcher/test/integration/regenerate-job.test.ts`
- `apps/dispatcher/test/integration/saree-mannequin.test.ts`
- `apps/dispatcher/test/integration/saree-step2-workflow-override.test.ts`
- `apps/dispatcher/test/integration/shopify.test.ts`
- `apps/dispatcher/test/integration/tryon-direct-webp.test.ts`
- `docs/observability.md`
- `docs/progress.md`
- `docs/superpowers/reports/2026-10-01-comfyui-timeout-stage1.md`
- `packages/observability/src/metrics.ts`
- `packages/types/src/index.ts`
- `packages/types/src/worker-capabilities.ts`

## Review fixes — latest results (supersedes original Stage 1 exhaustion rules above)

The user explicitly selected “Expand scope to change exhaustion handling and add cleanup”.
The immutable rev 4.4.9 spec is unchanged; this authorization supersedes its immediate,
no-I/O Stage 1 exhaustion rule.

1. **A, fixed:** history precedes exhaustion, including budgets smaller than the poll interval. Finished output wins. Exhaustion transport/JSON failures enter bounded cleanup; ordinary pre-exhaustion history failures remain unchanged.
2. **A, fixed:** all seven processor worker lifecycles release exactly once in `finally`, after terminal/failure handling. Mannequin already uses `finally`. A local integration injects terminal publication failure, verifies BUSY before the throw and exactly one release afterward.
3. **D, mitigated with approved scope expansion:** bounded cleanup reconciles before deletion, retries only pending prompts, live-checks identity/delete capabilities and version every time, never interrupts, holds BUSY throughout, observes running/completed states and confirms absence with grace plus final history. Cleanup has a configurable 30s default and a minimum of grace plus two polls. **Tradeoff:** confirmed deletion still terminates/refunds (no capacity requeue); this avoids another automatic submission but makes a queue-budget failure terminal for the user. Unreachable workers or revoked deletion authorization can still leave an orphan after the bound; the required existing queue gate continues to protect subsequent dispatch. `cleanupConfirmed` in the exhaustion log distinguishes confirmed deletion from unresolved cleanup.
4. **A, fixed:** admin display reads no longer increment drift/unreadable alerts or log mutation errors. Warnings remain visible; periodic monitor owns operational detection. Mutation reads retain fail-closed behavior and mutation metrics.
5. **A, fixed:** workers probe concurrently, each renews its health before drift diagnostics, drift reads share a finite 5s bound, worker errors are isolated, and monitor cycles cannot overlap. A delayed-draining-probe regression verifies prompt health renewal for a later healthy worker.

All capability-gated destructive behavior remains dormant without validated capabilities/version.
Queue-aware timeouts additionally require the gate and valid explicit maxQueueWaitMs. SAFE_SCOPED
cancel remains independent of gate/budgets. Every job uses the rewritten waiter; its disabled
mode retains submission-based legacy deadlines. Enabled jobs split queue and execution time,
measuring execution from first observed RUNNING.

Local Docker PostgreSQL, Redis and MinIO were verified running and healthy. No production
access, commits or pushes. Dispatcher/API type checks and diff whitespace check exit 0.

### Actual latest output

**Dispatcher units** — full log: [comfy-review-dispatcher-final.log](/tmp/comfy-review-dispatcher-final.log)

```text
 Test Files  8 passed (8)
      Tests  141 passed (141)
   Start at  18:09:37
   Duration  1.37s (transform 234ms, setup 0ms, collect 654ms, tests 476ms, environment 0ms, prepare 40ms)

```

**API units** — full log: [comfy-review-api-final.log](/tmp/comfy-review-api-final.log)

```text
 Test Files  82 passed (82)
      Tests  750 passed (750)
   Start at  18:05:13
   Duration  38.15s (transform 4.90s, setup 2.58s, collect 218.01s, tests 228.88s, environment 51ms, prepare 10.24s)

```

**Dispatcher integrations (eight affected files)** — full log: [comfy-review-integration.log](/tmp/comfy-review-integration.log)

```text
 Test Files  8 passed (8)
      Tests  35 passed (35)
   Start at  18:05:51
   Duration  169.28s (transform 379ms, setup 38ms, collect 1.52s, tests 167.43s, environment 0ms, prepare 40ms)

```

**API integrations (admin-workers and admin-audit-logs)** — full log: [comfy-review-api-integration.log](/tmp/comfy-review-api-integration.log)

```text
 Test Files  2 passed (2)
      Tests  22 passed (22)
   Start at  18:05:56
   Duration  8.53s (transform 1.38s, setup 17ms, collect 5.63s, tests 4.23s, environment 1ms, prepare 127ms)

```

**Lint** — full log: [comfy-review-lint-final.log](/tmp/comfy-review-lint-final.log)

```text
The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 743.
Checked 1171 files in 756ms. No fixes applied.
Found 751 warnings.
Found 12 infos.
```

Earlier review checks failed on formatting (11 errors, then one helper formatting error), corrected with targeted Biome formatting; final lint exits 0 with the listed existing warnings/info. The first unprivileged unit run timed out on the localhost mock; the socket-enabled rerun passed.

### Explicitly not done

- Full Stage 2 delivery: capacity-timeout typed result/requeue policy and its caller migrations/complete containment test matrix. This extension adds cleanup only while retaining terminal/refund policy.
- Quarantine or a durable orphan sweeper; cleanup remains bounded and fail-closed on revocation/unreachable workers.
- Ordinary pre-exhaustion `/history` transport-resilience fix; BUSY-worker rename bug; queue-gate changes.
- Production enablement, compatibility validation, Grafana provisioning, any production reads/writes.
- Spec edits/move, staging, commits or pushes.

### Files in the working tree

- `apps/admin-web/src/pages/WorkersPage.tsx`
- `apps/api/src/modules/admin/workers.routes.ts`
- `apps/api/test/integration/admin-workers.test.ts`
- `apps/dispatcher/src/comfyui/client.ts`
- `apps/dispatcher/src/comfyui/progress.test.ts`
- `apps/dispatcher/src/comfyui/progress.ts`
- `apps/dispatcher/src/job/mannequin-phase.ts`
- `apps/dispatcher/src/job/processor.ts`
- `apps/dispatcher/src/worker/health-monitor.ts`
- `apps/dispatcher/src/worker/registry.test.ts`
- `apps/dispatcher/src/worker/registry.ts`
- `apps/dispatcher/test/helpers/comfy-mock.ts`
- `apps/dispatcher/test/integration/happy-path.test.ts`
- `apps/dispatcher/test/integration/mannequin-capacity.test.ts`
- `apps/dispatcher/test/integration/merchant-widget-two-input.test.ts`
- `apps/dispatcher/test/integration/regenerate-job.test.ts`
- `apps/dispatcher/test/integration/saree-mannequin.test.ts`
- `apps/dispatcher/test/integration/saree-step2-workflow-override.test.ts`
- `apps/dispatcher/test/integration/shopify.test.ts`
- `apps/dispatcher/test/integration/tryon-direct-webp.test.ts`
- `docs/observability.md`
- `docs/progress.md`
- `packages/observability/src/metrics.ts`
- `packages/types/src/index.ts`
- `apps/api/src/modules/admin/worker-capabilities.test.ts`
- `apps/api/src/modules/admin/worker-capabilities.ts`
- `apps/dispatcher/src/comfyui/cancel.ts`
- `apps/dispatcher/src/comfyui/comfy-mock.test.ts`
- `apps/dispatcher/src/comfyui/completion-result.ts`
- `apps/dispatcher/src/config/comfy-timeout.test.ts`
- `apps/dispatcher/src/config/comfy-timeout.ts`
- `apps/dispatcher/src/worker/bounded-read.ts`
- `apps/dispatcher/src/worker/capabilities.ts`
- `apps/dispatcher/src/worker/health-monitor.test.ts`
- `apps/dispatcher/test/helpers/queue-exhaustion.ts`
- `docs/superpowers/reports/`
- `packages/types/src/worker-capabilities.ts`
