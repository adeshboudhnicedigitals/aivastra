# Admin cancellation Stage 1 — 2026-10-02

Working tree on `fix/admin-cancel-reaches-gpu`, branched from refreshed `origin/dev` (`065e613d`). No commits, push or production access. Tests used local Docker PostgreSQL, Redis and MinIO.

## Requirements and files

| Requirement | Implementation |
| --- | --- |
| R1: signal in-flight catalogue cancellation | `apps/api/src/modules/admin/jobs.routes.ts`: PREPROCESSING/GENERATING catalogue jobs set `job:cancel:{id}` EX 600 and return `{ ok: true, pending: true }`, without changing the row/refunding. Queued, terminal and other-source behavior retained. |
| Pending admin UX | `apps/admin-web/src/pages/JobsPage.tsx`: pending response displays “Cancellation requested” and waits for existing SSE/polling updates rather than marking the row CANCELLED immediately. |
| R2: one refund regardless of winning path | `apps/dispatcher/src/job/processor.ts`: terminateJob locks the job row, checks all three refund reasons, skips a prior refund but still transitions. Completed jobs are ACKed without cancellation/refund. `apps/api/src/modules/credits/ledger.ts`: admin-cancel refunds use the same lock/check so the reverse race also pays once. |
| R3: preserve CANCELLED, suppress output/delivery | `apps/dispatcher/src/job/state.ts`: guarded status update, output upsert and event insertion share a transaction. A rejected update warns, returns false and publishes nothing. Intermediate writes also preserve CANCELLED so UPLOADING cannot defeat the completion guard. FAILED → QUEUED remains allowed. |
| All eight completion paths | `apps/dispatcher/src/workflow/finalize.ts` delegates output metadata to the guarded transaction and returns its completion result. `processor.ts` consumes the result in catalogue, video, direct tryon, regenerate, mannequin, saree, widget and Shopify paths. Rejected completion ACKs and returns; widget custom completion SSE and webhook are suppressed. |

Tests changed: `apps/api/test/integration/admin-jobs-cancel-inflight.test.ts` (new), `apps/dispatcher/test/integration/cancelled-state.test.ts` (new), `apps/dispatcher/test/integration/happy-path.test.ts`, and `apps/dispatcher/test/integration/merchant-widget-two-input.test.ts`. Documentation changed: this report and `docs/progress.md`.

Coverage includes admin queued/catalogue pending/non-catalogue/terminal behavior; prompt-id-scoped GPU cancellation; cancellation after completion; completion after DB cancellation; exactly one refund with either refund reason already present; concurrent cancellation/completion; FAILED retry; and widget output/SSE/webhook suppression plus ACK.

## Interpretations and limits

- Admin pending retains HTTP 200, matching the existing admin transport. The user route uses 202; the requested admin response shape did not require that status change.
- R2 required a symmetric admin refund check, beyond the dispatcher-only instruction, to satisfy “whichever path wins.” It changes only REFUND_ADMIN_CANCEL handling in the shared refund helper.
- R3 guards intermediate writes as well as completion because an unconditional UPLOADING write would otherwise erase CANCELLED before the completion guard runs.
- The audit file is intentionally gitignored/untracked. The user supplied its graceful-abort rationale and explicitly authorized continuing from the catalogue-only route comment. It was not restored.
- **C — existing gap:** admin cancel does not write an audit log. Auditing was deliberately unchanged as instructed.
- **D — residual risk:** result bytes may already have been uploaded privately before cancellation rejects completion. No job_outputs or completion delivery is created, but an unreferenced storage object can remain.
- Existing cancel authorization, scoped delete/interrupt, ratchet and confirmation semantics are unchanged.

## Actual verification output

`pnpm --filter @aivastra/dispatcher test` — exit 0:

```text
 Test Files  9 passed (9)
      Tests  157 passed (157)
   Start at  16:28:13
   Duration  1.86s (transform 364ms, setup 0ms, collect 881ms, tests 702ms, environment 0ms, prepare 50ms)
```

`pnpm --filter @aivastra/dispatcher test:integration` — exit 0:

```text
 Test Files  31 passed (31)
      Tests  120 passed (120)
   Start at  16:31:07
   Duration  352.08s (transform 891ms, setup 135ms, collect 4.29s, tests 347.28s, environment 0ms, prepare 47ms)
```

After adding the widget cancellation race, ran `pnpm --filter @aivastra/dispatcher test:integration test/integration/merchant-widget-two-input.test.ts` — exit 0:

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  16:38:06
   Duration  20.98s (transform 492ms, setup 29ms, collect 1.17s, tests 19.50s, environment 0ms, prepare 51ms)
```

The full suite preceded this extra test; it was not repeated afterward. The five targeted tests overlap four tests already in the full run.

`pnpm --filter @aivastra/api test` — exit 0:

```text
 Test Files  83 passed (83)
      Tests  752 passed (752)
   Start at  16:28:17
   Duration  103.93s (transform 23.95s, setup 14.26s, collect 811.52s, tests 449.79s, environment 185ms, prepare 55.72s)
```

`pnpm --filter @aivastra/api test:integration test/integration/admin-jobs-cancel-inflight.test.ts test/integration/admin-jobs-cancel-store-billed.test.ts test/integration/jobs-cancel-inflight.test.ts` — exit 0:

```text
 Test Files  3 passed (3)
      Tests  21 passed (21)
   Start at  16:30:02
   Duration  16.27s (transform 2.48s, setup 388ms, collect 17.81s, tests 9.19s, environment 8ms, prepare 2.88s)
```

Typechecks exited 0: `pnpm --filter @aivastra/api typecheck`, `pnpm --filter @aivastra/dispatcher exec tsc --noEmit`, `pnpm --filter @aivastra/admin exec tsc --noEmit`. TypeScript emitted no errors. Rebuilt stale ignored DB package artifacts with `pnpm --filter @aivastra/db build`; no schema generation or migration was performed.

`pnpm lint` — exit 0 (after the extra widget test):

```text
The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 743.
Checked 1183 files in 6s. No fixes applied.
Found 751 warnings.
Found 12 infos.
```

`git diff --check` passed. Full terminal logs are retained locally under `/tmp/admin-cancel-*.log` (unit, integration, typecheck and lint logs).

Initial failures, resolved before reporting passes:

- Two new cancellation tests initially asserted a hardcoded mock prompt ID; the shared mock counter yielded different IDs. Assertions now compare the exact submitted prompt ID, preserving scoped deletion/interrupt checks. Initial result: 6 passed, 2 failed; corrected tests passed in the full integration run.
- Initial dispatcher typecheck reported missing accessory columns from stale local DB build artifacts. Building the existing DB package corrected the generated artifacts; subsequent typecheck passed. No source/schema workaround was introduced.

Initial failing output excerpts (full logs: `/tmp/admin-cancel-happy.log`, `/tmp/admin-cancel-tsc-initial.log`):

```text
AssertionError: expected [ [ 'mock-prompt-4' ] ] to deeply equal [ [ 'mock-prompt-0' ] ]
AssertionError: expected [ [ 'mock-prompt-5' ] ] to deeply equal [ [ 'mock-prompt-0' ] ]
src/job/processor.ts(730,51): error TS7006: Parameter 'id' implicitly has an 'any' type.
```

The same initial typecheck also emitted TS2339 for missing `accessoryCatalogIds`/`accessoryNodeId` and TS2353 for `accessoryNodeId`; full diagnostic type shapes remain in the log.

## Explicitly not done

No production reads/writes, real GPU calls, deployment, commits, push, migrations or schema changes. No changes to progress.ts/cancel.ts, timeout/queue-gate code, or cancellation callbacks at the other seven waitForCompletion sites. Widget and merchant GPU cancellation remains Stage 2; their DB cancellation is now protected from completion overwrite. No browser verification of the admin UI. No full API integration suite beyond the three relevant files. No audit fix, storage orphan cleanup or unrelated architectural hardening.
