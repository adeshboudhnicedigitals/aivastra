# Dispatcher capability Redis connection isolation — class A regression

The user reported 4.4–5.8s submission-to-completion-mode gaps in LEGACY and 9.6s in queue-aware mode, plus false version mismatch/monitor errors on a correctly configured worker. Production was not accessed to reproduce these observations.

## Change

`index.ts` creates one `redis.duplicate()` connection named `comfyRedis`, installs the same error-handler pattern as existing Redis clients, supplies it to processor configuration and the health monitor, and disconnects it during shutdown. It never carries a blocking stream read.

`ProcessorConfig`, `MannequinPhaseConfig` and `CompletionContext` require `comfyRedis`. All seven processor wait sites and the mannequin wait site pass it explicitly. Submission capability/config/version/gate reads and cancel/timeout-cleanup authorization reads use that context connection. The existing user-cancel predicate at the regular wait site also uses it. The monitor's version writes, registry/health operations and drift reads run on it, keeping version publication and comparison away from the parked main socket. Consumer BLOCK durations are unchanged. Existing selector queue-gate logic is unchanged.

Integration fixture configuration now supplies the required field; fixtures without blocking consumers reuse their existing non-blocking test client. The regression itself uses two real sockets against localhost docker-compose Redis and waits for CLIENT LIST to confirm main is parked in a 2s XREADGROUP BLOCK. It verifies:

- Sequential capability/config/version/gate reads plus detectCapabilityDrift finish in less than 200ms, while a control GET on main is still pending.
- A correct configured worker emits no version-mismatch increment or error log; monitoring renews health/version and completes drift diagnostics in less than 200ms.
- Live cancellation authorization completes in less than 200ms using CompletionContext, without error logging.

Each test's total duration includes waiting for main's 2s BLOCK to complete during teardown; the less-than-200ms assertion measures the feature operations only.

## Actual verification output

Local docker-compose PostgreSQL, Redis and MinIO were verified running and healthy. No production calls, commits, staging or pushes. Dispatcher `tsc --noEmit` and `git diff --check` exit 0.

### Dispatcher unit suite

Command: `pnpm --filter @aivastra/dispatcher test`. [Full output](/tmp/comfy-nonblocking-unit-final.log).

```text
 Test Files  8 passed (8)
      Tests  141 passed (141)
   Start at  12:34:16
   Duration  1.57s (transform 285ms, setup 0ms, collect 786ms, tests 536ms, environment 0ms, prepare 41ms)

```

### Full dispatcher integration suite

Command: `pnpm --filter @aivastra/dispatcher test:integration`. [Full output](/tmp/comfy-nonblocking-integration.log).

```text
 Test Files  1 failed | 28 passed (29)
      Tests  1 failed | 108 passed (109)
   Start at  12:36:24
   Duration  329.63s (transform 1.07s, setup 152ms, collect 6.47s, tests 322.58s, environment 0ms, prepare 58ms)

/home/manikanta-srinivas-gunnam/Projects/aivastra/apps/dispatcher:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @aivastra/dispatcher@0.0.1 test:integration: `vitest run --config vitest.integration.config.ts`
Exit status 1
```

### Corrected retry fixture and strengthened isolation regression rerun

Command: `pnpm --filter @aivastra/dispatcher test:integration test/integration/comfy-redis-isolation.test.ts test/integration/retry.test.ts`. [Full output](/tmp/comfy-nonblocking-integration-rerun.log).

```text
 Test Files  2 passed (2)
      Tests  4 passed (4)
   Start at  12:43:55
   Duration  23.43s (transform 3.45s, setup 26ms, collect 7.08s, tests 15.95s, environment 0ms, prepare 42ms)

```

### Lint

Command: `pnpm lint`. [Full output](/tmp/comfy-nonblocking-lint-final.log).

```text
The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 743.
Checked 1172 files in 6s. No fixes applied.
Found 751 warnings.
Found 12 infos.
```

## Failures and deviations

- **C, pre-existing fixture:** the full integration run had 108 passed and one failure in retry.test.ts: `ERR Invalid stream ID specified as stream command argument`. The fixture passed `msg-1`/`msg-2` to XACK; changed to valid `1-1`/`2-1`. The corrected fixture and isolation regression passed on rerun (4 tests). The entire suite was not rerun after this fixture-only correction; its prior full-run failure is reported above, not represented as a complete green run.
- The first isolation fixture attempt failed (3 tests) because ioredis prefixes XREADGROUP stream keys but not XGROUP subcommand keys. It now creates the group using the explicit unique prefix; the corrected regression passes.
- An initial source typecheck caught an inadvertently added required property on RequeueForNoWorkerArgs; removed it because that path does not need the feature connection. Final typecheck passes. Formatting errors were corrected; final lint passes with the existing 751 warnings and 12 infos.
- The first sandbox-only unit run failed on localhost mock sockets; the socket-enabled rerun passes (141 tests).

## Not done

No API changes/tests, production latency measurement or deployment, BLOCK-duration changes, cancellation quarantine, commits or pushes. The unrelated pre-existing untracked root rev 4.4.8 specification is untouched.

## Files changed

- `apps/dispatcher/src/comfyui/cancel.ts`
- `apps/dispatcher/src/comfyui/progress.test.ts`
- `apps/dispatcher/src/comfyui/progress.ts`
- `apps/dispatcher/src/index.ts`
- `apps/dispatcher/src/job/mannequin-phase.ts`
- `apps/dispatcher/src/job/processor.ts`
- `apps/dispatcher/test/integration/catalog-video.test.ts`
- `apps/dispatcher/test/integration/happy-path.test.ts`
- `apps/dispatcher/test/integration/mannequin-capacity.test.ts`
- `apps/dispatcher/test/integration/merchant-catalog-mannequin.test.ts`
- `apps/dispatcher/test/integration/merchant-refund.test.ts`
- `apps/dispatcher/test/integration/merchant-widget-two-input.test.ts`
- `apps/dispatcher/test/integration/merchant-widget-webp.test.ts`
- `apps/dispatcher/test/integration/pose-garment-config-workflow-override.test.ts`
- `apps/dispatcher/test/integration/processor-held-release-queue-wait.test.ts`
- `apps/dispatcher/test/integration/recovery-store-billed.test.ts`
- `apps/dispatcher/test/integration/recovery.test.ts`
- `apps/dispatcher/test/integration/regenerate-job.test.ts`
- `apps/dispatcher/test/integration/retry.test.ts`
- `apps/dispatcher/test/integration/saree-mannequin.test.ts`
- `apps/dispatcher/test/integration/saree-step2-promoter.test.ts`
- `apps/dispatcher/test/integration/saree-step2-workflow-override.test.ts`
- `apps/dispatcher/test/integration/shopify.test.ts`
- `apps/dispatcher/test/integration/tryon-direct-webp.test.ts`
- `apps/dispatcher/test/integration/video-lane.test.ts`
- `apps/dispatcher/test/integration/watermark-fail-closed.test.ts`
- `apps/dispatcher/test/integration/watermark-snapshot.test.ts`
- `apps/dispatcher/test/integration/workflow-replace-drain.test.ts`
- `apps/dispatcher/test/integration/comfy-redis-isolation.test.ts`
- `docs/superpowers/reports/2026-10-02-comfyui-redis-isolation.md`
- `docs/progress.md`

## Authorized commit batches and lifecycle follow-up

The user subsequently authorized committing on the current branch, with no push. Code and tests are committed in `217c6fc6`; this report and the progress log form the second documentation batch. Earlier no-commit statements describe the pre-authorization snapshot.

`makeComfyRedis()` in `src/lib/redis.ts` now centralizes connection construction. It duplicates main with `lazyConnect: true`, `enableOfflineQueue: false`, `maxRetriesPerRequest: 1`, and `commandTimeout: 5000`, and attaches an error handler. Startup explicitly awaits connect before use; shutdown disconnects it. Authorization commands therefore fail while disconnected rather than accumulating for replay. Commands already sent may still complete later; finite client-side waits do not cancel server-side commands.

The isolation test uses this actual factory. A fourth regression disconnects its socket and verifies GET rejects in less than 200ms. An initial test teardown attempted reconnect before the socket had ended and failed (`Redis is already connecting/connected`); the fixture now waits for the end state before reconnecting. The corrected run passes. The retry fixture changed only its configuration and `msg-1`/`msg-2` to `1-1`/`2-1`; no assertion was removed or weakened. Selector atomic claim/release implementations remain unchanged.

Latest dispatcher typecheck, lint and staged whitespace checks pass. Pre-commit code checks pass with one existing non-null assertion warning in the catalog-video fixture. No production access, deployment, capability changes or push. The pre-existing root rev 4.4.8 spec remains excluded from commits.

### Latest units

[Full output](/tmp/comfy-commit-unit.log).

```text
 Test Files  8 passed (8)
      Tests  141 passed (141)
   Start at  12:50:30
   Duration  1.94s (transform 378ms, setup 0ms, collect 978ms, tests 621ms, environment 0ms, prepare 85ms)

```

### Latest targeted integrations

[Full output](/tmp/comfy-commit-integration-final.log).

```text
 Test Files  2 passed (2)
      Tests  5 passed (5)
   Start at  12:51:32
   Duration  18.96s (transform 463ms, setup 39ms, collect 1.10s, tests 17.53s, environment 0ms, prepare 53ms)

```

### Latest lint

[Full output](/tmp/comfy-commit-lint.log).

```text
The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 743.
Checked 1172 files in 5s. No fixes applied.
Found 751 warnings.
Found 12 infos.
```
