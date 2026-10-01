# Start the ComfyUI timeout at execution start, not at submission — design spec (rev 4.4.9, implementation contract)

Follow-up to `2026-09-30-queue-aware-worker-routing-design.md` (already implemented as PRs #436–#439; the facts
this document needs from it are inlined below). Rev 4.4.9 replaces all earlier revisions; implement from this
document alone. Treat the design as **frozen after the Stage 1 implementation spike**: findings should be
classified (see "Classifying findings") and become a revision only if the spec contradicts itself.

Changes in 4.4.9 vs 4.4.8 (revision history before 4.4.9 is in git/pulled copies and intentionally removed):
- **Delivery stages added** (Stage 1 / Stage 2, below). Implement Stage 1 first; Stage 2 only if Stage 1's metrics
  show queue-budget exhaustion actually happens.
- **Mid-flight LEGACY_FALLBACK fix.** A fallback entered from PRE_START (3 `/queue` errors or unknown-state grace)
  no longer uses `submittedAt + timeoutMs` (which re-created the original bug for a prompt queued 250s). Its
  deadline is `max(submittedAt + timeoutMs, legacyEnteredAt + timeoutMs)`. A submission that *starts* in LEGACY
  because the feature is not effective keeps today's `submittedAt + timeoutMs`.
- **Two-real-concurrent-prompts test is a hard precondition** for setting `promptScopedInterruptValidated`.
- **Parent-spec facts inlined** ("Facts from the parent spec"), so this document is self-contained.
- Proposed starting values for the two global budgets (to confirm against the timeout-class data).

## Context

`waitForCompletion` (`apps/dispatcher/src/comfyui/progress.ts`) starts its 300s deadline the moment it is
called, right after `POST /prompt`. Every current call site passes `300_000` (this checkout: 7 in
`processor.ts`, 1 in `mannequin-phase.ts`). Time a prompt spends **queued** inside ComfyUI therefore counts
against the generation budget.

Observed 2026-09-30, job `ffa5ab6e-8ce9-4347-b222-5948eb35d03f` on w4 (from w4's `/history`):

| Event | UTC |
|---|---|
| foreign prompt `51a6ec69…` starts (not in dispatcher logs) | 13:42:11 |
| our prompt submitted | 13:42:59 |
| foreign prompt finishes / ours `execution_start` | 13:46:04 / 13:46:05 |
| dispatcher deadline fires (throws) | 13:48:03 |
| ours `execution_success` | 13:49:43 |

Generation took 217s (same as w1's 221s). Queue wait was 3m06s. The timeout threw, `handleFailure` consumed
attempt 1 of `MAX_ATTEMPTS = 2`, and the job re-ran on w1. A sibling job hit the same failure on w3. A second
such timeout would have failed the job and refunded the customer while a valid image existed on the worker.

The queue gate (parent spec) reduces this by not claiming busy workers, but cannot close it: a prompt can still
be queued behind work submitted between the gate's probe and our `POST /prompt`, and gates start off per worker.

A second, independent bug exists today: the cancel path (`progress.ts`, `isCancelled` branch) calls
`interruptPrompt`, an unscoped worker-wide interrupt, from inside the poll loop. If a user cancels while their
prompt is still **queued** behind a developer's run, the interrupt kills the developer's job.

## Delivery stages

**Stage 1 (implement first, own PR):**
- `waitForCompletion` rewrite: PRE_START / RUNNING / LEGACY_FALLBACK, `/queue` polling, execution deadline from
  `firstObservedRunningAt`, typed results, caller migration, no-bare-`await` rule.
- Capability model, version guard, live authorization, and **cancellation (SAFE_SCOPED / LEGACY / CONSERVATIVE)**,
  because scoped-only cancel needs them. Admin capability routes, drift detector, tests, metrics.
- **Queue-budget exhaustion in Stage 1 does NOT delete and does NOT requeue.** At `now > submittedAt +
  maxQueueWaitMs` in PRE_START, return `{ status: 'queue_cleanup_failed' }` immediately (callers terminate +
  refund, never requeue; worker released per the Cleanup-exhaustion rule; ERROR log, metric, alert). The
  orphaned pending prompt is left to run; the queue gate (prerequisite) keeps new work off that worker. This is
  the accepted Stage 1 cost of deferring delete.
- The Containment rule trivially holds (no network I/O after the deadline).

**Stage 2 (separate PR, only if `queue_cleanup_failed` from queue-budget exhaustion is observed in practice):**
PRE-DELETE RECONCILE, delete, POST-DELETE RECONCILE, CLEANUP, `queue_capacity_timeout` requeue,
`queueCleanupTimeoutMs`, containment-phase tests, and the final-history rule. Stage 2 replaces Stage 1's
immediate `queue_cleanup_failed` at the budget deadline.

Sections below describe the **complete (Stage 2) design**; the Stage 1 deviation above takes precedence where
they differ. Tests are tagged by stage in the Tests section's headings only where it matters: the containment,
boundary and cleanup tests are Stage 2; everything else is Stage 1.

## Facts from the parent spec (queue gate, already implemented)

- After a worker is claimed (Lua atomic IDLE→BUSY), the dispatcher live-probes `GET /prompt`
  (`exec_info.queue_remaining === 0`, fail closed, up to 4 probes, 2s timeout each) and excludes/releases a
  worker whose ComfyUI queue is non-empty (`releaseWorkerIfBusy`, atomic Lua; never overrides DRAINING).
- The gate is a per-worker flag `worker:routing-config:{id}` (missing = off), set via admin
  `PUT /admin/workers/:id/queue-gate`. A display snapshot `worker:queue:{id}` and metrics exist.
- Worker state: Redis `worker:registry` (IDLE/BUSY/DRAINING), health key `worker:health:{id}` (30s TTL, probed
  every 15s via `/system_stats`). `registerWorkers` resets all to IDLE on dispatcher boot.
- The gate cannot close the queue-wait problem (race between probe and `POST /prompt`; gates default off).

## Verified behavior (w7, ComfyUI 0.37.0, 2026-10-01)

Run from the dispatcher VPS against `https://w7.aivastra.com` (through nginx, with the worker `X-Api-Key`), on a
drained worker. Runbook: `2026-10-01-comfyui-queue-validation-runbook.md` (not yet saved as a file).

| Check | Result |
|---|---|
| `GET /queue`: our prompt id at item index 1 in `queue_running` and `queue_pending` | PASS |
| `POST /queue {"delete":[id]}` on a pending prompt: HTTP 200, removes only that prompt, running prompt unaffected, deleted prompt never executes (no history) | PASS |
| `POST /queue {"delete":[id]}` on a **running** prompt | HTTP 200, **no-op**, prompt kept running |
| `POST /interrupt {"prompt_id": <non-matching id>}` | HTTP 200, running prompt **not** interrupted (checked at 3s and 18s) |
| `POST /interrupt {"prompt_id": <running id>}` | stopped within 5s; history status `error` with `execution_interrupted` |

Scope: **w7 / ComfyUI 0.37.0 only.** These results must not be applied automatically to workers running another
ComfyUI version or a different proxy/auth configuration. Other workers remain unvalidated. Limits of the
evidence: one run on one worker; the interrupt check used a non-matching id against a running prompt, not two
real prompts at once; observations at 3s/5s/15s are consistent, not an exhaustive guarantee.

## Goals

- Queue wait must not consume the generation budget.
- A prompt that is genuinely stuck or never runs must still be bounded.
- Never knowingly start a duplicate generation because of a queue-capacity timeout.
- Cancellation must never interrupt someone else's running prompt on a worker under queue-aware control, even
  if its configuration becomes unreadable, is revoked, or disappears mid-flight.
- No change to success or execution-error semantics.

## Non-goals

- Interrupting or cancelling foreign prompts.
- Changing the 300s execution budget itself (217–221s healthy, 410s observed cold on w7; revisit with data).
- Changing **execution-timeout** behavior. A prompt that has entered RUNNING can still time out through the
  existing execution-failure path (`handleFailure`, attempt consumed, retry), including today's possibility that
  the abandoned prompt keeps running. Separate follow-up work.
- Cancel behavior on **never-validated** workers (unchanged; see Cancellation, interim risk).
- A quarantine state for workers. Considered and rejected (see Cleanup exhaustion).
- A general fix for renaming any worker while `BUSY` (pre-existing; see Key lifecycle, follow-up).
- An atomic emergency stop. Revocation is best-effort immediate (see Live authorization, TOCTOU).
- WebSocket progress (`progress.ts` documents why polling was chosen).

## Capability model (per worker) and dormant semantics

Capabilities are **operator assertions** that a specific worker has been manually validated. There is no
automatic self-test (testing delete requires submitting a real prompt). Setting one is audited, like the
queue-gate toggle, and done only after the runbook passes for that worker.

Stored in a **new** Redis key, `worker:capabilities:{workerId}` (JSON), written by the admin API:

```
{
  "queuePromptIdentityValidated": boolean,
  "queueDeleteValidated": boolean,
  "promptScopedInterruptValidated": boolean,
  "validatedComfyVersion": "0.37.0",
  "validatedAt": "2026-10-01"
}
```

**Not** stored in `worker:routing-config:{id}`: the existing `PUT /admin/workers/:id/queue-gate` route
overwrites that whole key with `{queueGateEnabled}`, so capability fields stored there would be wiped on every
gate toggle.

### Reading capabilities: three outcomes

```ts
type CapabilityRead =
  | { status: 'not_configured' }                              // key definitively absent, or present with no capability true
  | { status: 'configured'; capabilities: WorkerCapabilities } // at least one validation boolean is true
  | { status: 'unreadable' };                                  // Redis error, timeout, non-JSON, wrong shape
```

- **"Configured"** means **at least one** of the three validation booleans is `true`. An all-false placeholder
  object is `not_configured`.
- **Unreadable is not "not configured".** Treating a failed or malformed read as "all false" would route
  cancellation to LEGACY (the unscoped interrupt) exactly when the dispatcher can no longer tell whether the
  worker was validated. See Cancellation.
- **Timeout feature fails closed to legacy** on any non-`configured` read (it is merely less capable).
- Only w7 is `configured` (validated 0.37.0, 2026-10-01). Every other worker stays `not_configured` until
  validated individually.

### Key lifecycle (capability mutation)

The admin API enforces, for `worker:capabilities:{id}` writes:

| Change | Required |
|---|---|
| any validation capability **`false → true`** | queue gate currently **ON**, regardless of whether another capability is already true; audited |
| **partial `true → false`** (at least one capability remains `true`) | **allowed immediately**; audited; takes effect at the next authorization check (see Live authorization). This is the emergency lever. |
| **configured → unconfigured** by any means (all `false`, `{}`, `DELETE`) — a manual clear | worker `DRAINING` + operator verifies the ComfyUI queue is empty; audited |
| **`validatedComfyVersion` change** | worker `DRAINING` + queue empty + revalidation (the runbook already requires a drained worker); audited |
| `validatedAt`-only change | allowed; audited |
| unconfigured → unconfigured (e.g. all `false`, `{}`) | allowed |
| **unreadable / malformed key → anything** (repair, clear, or overwrite with a valid value) | worker `DRAINING` + operator verifies the ComfyUI queue is empty; audited. Its previous state is unknown, so it is treated as protected. |

Required operator order for a new worker: enable gate → drain and validate → write capabilities.

Why partial revocation is not drain-gated: it only makes the system **more conservative** (cancel moves to
CONSERVATIVE; new timeout submissions go legacy). A worker with at least one capability still `true` stays
configured, so cancellation never reverts to LEGACY. Only a **complete** clear can (that is why it requires
`DRAINING`: otherwise an operator could write three `false` values, disable the gate, and leave an in-flight job
heading toward cleanup exhaustion unprotected). Requiring `DRAINING` for partial revocation would also not
protect an already-snapshotted in-flight submission; the live authorization checks below do.

- **Rename** (`PATCH /admin/workers/:id` with a new id): on a **configured** worker the API rejects the rename
  unless the worker is `DRAINING` (and the operator has verified the queue is empty). When renaming, move
  `worker:capabilities:{id}` to the new id exactly as the route already moves `worker:routing-config:{id}` and
  the health key, so the renamed worker keeps its validation and the old id leaves no orphan record that could
  be inherited if that id is reused. (`worker:comfy-version:{id}` is monitor-written and rebuilds itself.)
  An in-flight submission holding the old id is covered by the cancel ratchet (below), so its cancel cannot
  downgrade to LEGACY when the old-id capability read comes back empty.
- **Pre-existing rename bug (verified by reading `workers.routes.ts`; not caused by this spec):** a rename copies
  the registry entry — including its `BUSY` status — to the new id and deletes the old one. The in-flight job
  later releases by the **old** id, and `setWorkerStatus` returns with no effect when the entry is missing, so
  the renamed worker stays `BUSY` until a dispatcher restart. **Follow-up (separate change):** reject a rename of
  any worker while it is `BUSY`, mirroring delete.
- **Worker deletion:** `DELETE /admin/workers/:id` already returns `409 WORKER_BUSY` for a `BUSY` worker, so a
  worker with a dispatcher-claimed in-flight job cannot be deleted. No new force-delete guard. The residual case
  (a `DRAINING` worker with in-flight work) follows the normal drain procedure. The worker-deletion operation
  deletes the capability key unconditionally, with the routing-config key; the `DRAINING` rule above applies
  to an operator *manually clearing* capabilities, not to deleting the worker.
- **Gate off:** see Queue-gate protection.

### Version-drift guard

A capability is an assertion about a ComfyUI version, and workers can be upgraded. The health monitor probes
`/system_stats` every 15s and also writes `worker:comfy-version:{id}` (the reported `comfyui_version`, 60s TTL).
**The monitor must keep writing the version key for `DRAINING` workers too.** Today `health-monitor.ts` skips
draining workers entirely, so their version key would expire about 60s after a drain and silently disable safe
cancel (and the timeout feature) for in-flight work on that worker. Probing a draining worker only to record its
version is display/guard-only and must not renew `worker:health:{id}` (a draining worker is still not routable).

Capabilities are **effective only while the reported version equals `validatedComfyVersion`**. A missing or stale
version key (monitor down, probe failing, actual upgrade) means not effective.

### Effective enablement

```
versionOK(worker) = worker:comfy-version:{id} present AND equals validatedComfyVersion

timeoutFeature(worker) =                              // decides a NEW submission's starting mode
    read.status == 'configured'
    AND capabilities.queuePromptIdentityValidated
    AND capabilities.queueDeleteValidated
    AND versionOK(worker)
    AND queueGateEnabled(worker)                      // prerequisite, see Queue-gate protection
    AND maxQueueWaitMs valid positive                 (global runtime config)
    AND queueCleanupTimeoutMs valid positive          (global runtime config)
    AND queueCleanupTimeoutMs >= queueStateUnknownGraceMs + 2 * POLL_INTERVAL_MS   // exact; see CLEANUP config constraint

safeCancel(worker) =                                  // mode SAFE_SCOPED: the COMPLETE validated cancel protocol
    read.status == 'configured'
    AND capabilities.queuePromptIdentityValidated
    AND capabilities.queueDeleteValidated
    AND capabilities.promptScopedInterruptValidated
    AND versionOK(worker)
```

`safeCancel` does not depend on the budgets or the gate, so the live cancel bug can be fixed without waiting for
Ops to choose timeout values. It depends on identity because cancel confirmation reads `ourId` from `/queue`.
**SAFE_SCOPED means the complete protocol is available; a partially validated or partially revoked worker is
CONSERVATIVE** (no destructive ComfyUI cancel calls, no per-operation combinations such as delete-only).

- **Timeout feature: fail closed to legacy.** Unset or unreadable budgets, or any non-`configured` read, =
  disabled; `waitForCompletion` follows today's submission-based behavior and never calls `/queue` for this
  feature. Do not guess defaults.
- **Cancel does NOT fail closed to legacy.** Today's cancel *is* the bug; see Cancellation.
- **Per-submission snapshot.** At the start of `waitForCompletion`, record the effective timeout mode, the budget
  values used, and `legacyCancelEligibleAtStart = (startCapabilityRead.status === 'not_configured')`. The timeout
  mode and budgets do not change mid-wait. **The version check and capability state are not snapshotted for
  destructive actions**: each destructive call re-authorizes from current state (below).
- **Global runtime config** (budgets, grace) lives in Redis in the style of `getImageCompressionConfig`
  (`apps/dispatcher/src/config/image-compression.ts`), read at call time, no restart needed. Per-worker
  capability/enablement is separate (above).
- **Engineering parameters** (not SLAs, defaults allowed): `POLL_INTERVAL_MS = 3_000` (the existing poll
  cadence), `queueStateUnknownGraceMs = 10_000`, `cancelConfirmationTimeoutMs = 20_000`,
  `cancelAbsentRecheckMs = 2_000`, `requestTimeoutMs = 5_000` (the *maximum* timeout of one HTTP call on the
  cancel, cleanup and confirmation paths: delete, interrupt, `/queue`, `/history`; each call's actual timeout is
  clamped to the remaining outer deadline, see Cancellation).
- **Log and expose the effective mode** per submission (`mode=legacy|queue_aware`, and why) and per cancel
  (`cancel_mode=legacy|safe_scoped|conservative`, and why) so nobody assumes a feature is active when it is not.

Implementation verification (tests against the mock) and external compatibility verification (the real-worker
runbook) are separate. Green mock tests show correctness *given* the assumptions in this spec; only the runbook
permits enabling a worker.

## Live authorization before destructive calls

The starting mode of a submission is a snapshot; **permission to send a destructive request is not**. Immediately
before each destructive call the dispatcher re-reads capabilities and the version key:

```
authorizeDelete(worker) =                       // timeout path: only identity + delete needed
    read.status == 'configured'
    AND capabilities.queuePromptIdentityValidated
    AND capabilities.queueDeleteValidated
    AND versionOK(worker)

authorizeSafeCancel(worker) = safeCancel(worker)   // cancel path: the complete protocol, rechecked per call
```

**Timeout path.** Before **every** `POST /queue {"delete":[id]}` (the first, and each CLEANUP retry):

- `authorizeDelete` true → send the delete.
- false, revoked, or read `unreadable` → **do not send**; treat the delete as unconfirmed and use CLEANUP in
  **observation-only** mode: keep polling `/history` and `/queue` and let the prompt resolve naturally:
  history completes → `completed`; becomes running → RUNNING (execution clock starts); confirmed absent →
  `queue_capacity_timeout` (safe requeue policy); still pending at the cleanup deadline →
  `queue_cleanup_failed` (terminate + refund, worker released, alert). This preserves the no-duplicate invariant
  without using an API the operator revoked.
- **Operational consequence, stated precisely:** if delete is revoked while submissions are already queue-aware,
  a prompt that **stays pending through its queue budget and cleanup window** cannot be safely removed and ends
  as `QUEUE_CLEANUP_FAILED` (terminate + refund). Prompts that start, finish, or become confirmed absent during
  reconciliation take their normal safe transitions. **New** submissions fall back to legacy timeout mode
  immediately because `timeoutFeature` requires `queueDeleteValidated`.

**Cancel path (SAFE_SCOPED).** Evaluate `safeCancel` at cancel time; if false → CONSERVATIVE (zero destructive
calls). If true, recheck `safeCancel` **immediately before the delete** and again **immediately before the
interrupt**:

```
cancel requested
  evaluate safeCancel now
    false -> CONSERVATIVE (no ComfyUI cancel calls)
    true  -> recheck immediately before DELETE
               no longer safe -> CONSERVATIVE: skip ALL destructive calls
               still safe     -> POST /queue {"delete":[ourId]}
                                 recheck immediately before INTERRUPT
                                   no longer safe -> skip the interrupt; continue confirmation safely
                                   still safe     -> POST /interrupt {"prompt_id": ourId}
```

Property: **a denied, revoked, unreadable or version-invalid authorization must never cause a fallback to a
less-safe destructive operation, and every destructive call is independently authorized against current
state.** If the interrupt capability is revoked after the delete was sent, the delete is not undone and the
interrupt is not sent; confirmation then proceeds (and expires unconfirmed if the prompt keeps running, per the
Cancellation rules). Denial is **not sticky**: if an operator legitimately restores a capability, a later call is
authorized on its own merits. Sticky denial would add state without a safety benefit.

**TOCTOU limit (accepted).** Revocation takes effect at the *next authorization check*. There is an inherent
window between the Redis read and the HTTP request, and a request already on the wire cannot be recalled.
Eliminating it would need transactional coordination between capability mutation and worker API calls, which is
out of scope. The accurate claim is "best-effort immediate", not "atomic".

## Queue-gate protection (prerequisite and operational invariant)

When cleanup (timeout or cancel) cannot confirm that our prompt is gone, the worker is **released** (see
Cleanup exhaustion). That is only acceptable because the queue gate's live `/prompt` probe will skip the
worker while the stray prompt is still queued or running (`queue_remaining` counts both). So the gate must be on
for every worker under queue-aware control (timeout feature or safe cancel), from first enablement onward:

- **Start condition.** Any capability `false → true` requires the gate currently ON (Key lifecycle, above).
- **Admin rule.** Define `capabilityStateRequiresProtection = (read.status !== 'not_configured')`, i.e.
  `configured` **or `unreadable`/malformed**. On such a worker the API rejects
  (a) `PUT /admin/workers/:id/queue-gate` with `enabled:false`, (b) a manual clear to unconfigured
  (`DELETE`, `{}`, all-`false`), (c) a `validatedComfyVersion` change, (d) a rename, and (e) any repair or
  overwrite of an `unreadable` key, unless the worker is `DRAINING`. Partial revocation and `validatedAt`-only
  changes are exempt; worker deletion itself is exempt. This is a **static** rule keyed on the capability
  state, not on "feature currently effective": a rule keyed on effectiveness is bypassable (remove a budget →
  feature off → disable the gate → an in-flight job later reaches cleanup exhaustion with the gate off).
  Treating `unreadable` as "not configured enough" would let the gate be disabled while a queue-aware job is
  heading to cleanup exhaustion, so it is fail-closed here exactly as it is in cancellation. An `unreadable`
  capability key also raises an alert. If the admin API's own read of the key fails (e.g. Redis down), the
  guarded mutation is rejected rather than allowed.
- **`DRAINING` does not prove the worker is idle.** Draining a busy worker leaves its in-flight job running, and
  the registry status stays `DRAINING` either way. Safe sequence for an operator: drain → wait for
  dispatcher-owned work to finish → verify the worker's ComfyUI `/queue` is empty (0 running, 0 pending) →
  change the gate/capabilities/version/id → restore. The API enforces only `DRAINING`; emptiness is an operator
  step. (An API check against the display queue snapshot would require `queue-sampler.ts` to also sample
  `DRAINING` workers, which it skips today. Optional; display-only.)
- **Drift detector.** If a worker is **configured** AND its `queueGateEnabled` is missing or off → ERROR log,
  metric, and an admin Workers-view warning. **It does not depend on the global budgets**: safe cancel is
  budget-independent and its unconfirmed-release path relies on the gate too. It does not strand capacity; it
  keeps the condition from being silent.
- **Accepted fail-open.** If routing configuration is lost outside the controlled path (Redis data loss), cleanup
  exhaustion may release a worker whose ComfyUI queue is not confirmed empty, and routing reverts to the existing
  ungated collision risk. This matches the parent spec's documented fail-open for the gate flag; it is surfaced
  by the drift detector and alerts, not prevented. (The same Redis loss would also remove the capability key;
  the cancel ratchet keeps in-flight cancellations safe regardless.)

## Four independent budgets

**Proposed starting values (confirm against the timeout-class data before enabling):** `maxQueueWaitMs` 900_000
(15 min: well above the observed 3m06s wait behind a developer run, bounded so a stuck worker still frees the
job), `queueCleanupTimeoutMs` 30_000 (Stage 2 only; must satisfy the `>= grace + 2*POLL_INTERVAL_MS` constraint),
`timeoutMs` stays 300_000 (execution only). These are proposals, not measured optima.


| Budget | Question | Scope | Value |
|---|---|---|---|
| **Job capacity wait** | How long may this *job* wait for a worker, across requeues? | `MAX_QUEUE_WAIT_MS` (existing) | unchanged (3h) |
| **Prompt queue wait** | How long may *one submitted prompt* sit pending in ComfyUI before it starts? | `maxQueueWaitMs` | required config, no default, until Ops/Product choose |
| **Execution** | How long may the prompt *run* once started? | `timeoutMs` (existing) | 300s, unchanged |
| **Cleanup confirmation (timeout path)** | How long may we try to confirm a timed-out prompt is gone? | `queueCleanupTimeoutMs` | required config, no default; a reconciliation bound, not a workload SLA; keep short |

Cancel has its own bound, `cancelConfirmationTimeoutMs`, and does not use `queueCleanupTimeoutMs`.

## Queue-capacity invariant

> **Never requeue a queue-capacity-timed-out submission unless the dispatcher has confirmed that the original
> ComfyUI prompt is neither pending nor running.**

> **Containment rule.** Containment begins at the PRE_START deadline check (step 1b), before any network I/O. Once queue-budget exhaustion begins, the submission is in a queue-capacity containment
> phase. It must not transition to `LEGACY_FALLBACK`, or to the ordinary retry/failure/attempt path, solely
> because a `/history` or `/queue` read fails at the transport level. Allowed exits are only: `completed`,
> `queue_capacity_timeout` (confirmed absence **and** a successful empty final `/history` read),
> `queue_cleanup_failed`, `JobCancelledError`, or an authoritative `status_str: error` history entry.

Scope: the queue-capacity path only. It does not change execution-timeout behavior.

## Key fact: `/history` cannot show "started"

ComfyUI adds a `/history/{id}` entry when a prompt **finishes** (or errors). While queued or running it returns
`{}`; `execution_start` appears in `status.messages` only afterward. Live state comes from `GET /queue`
(verified on w7: item index 1 is the prompt id):

- `queue_pending` contains the prompt → queued
- `queue_running` contains the prompt → executing
- in neither, and no history entry → see "Unknown state"

## Design

### Responsibility split

```
progress.ts       detects prompt state; returns a typed result or throws
mannequin-phase   owns the mannequin worker lifecycle; translates results; no job policy
processor.ts      owns the main worker lifecycle and ALL job policy: age check, requeue,
                  terminate, attempts, refund
```

```ts
type WaitForCompletionResult =
  | { status: 'completed' }
  | { status: 'queue_capacity_timeout' }   // prompt confirmed gone from ComfyUI; safe to requeue
  | { status: 'queue_cleanup_failed' };    // cleanup window exhausted; prompt state NOT confirmed
```

Execution errors, execution timeouts and cancellation keep their current behavior (thrown errors /
`JobCancelledError`). Only queue-capacity outcomes become typed results (the `MANNEQUIN_NO_WORKER` lesson).

### Modes

| Mode | Polls | Deadline |
|---|---|---|
| **PRE_START** (initial, feature effective) | `/history` then `/queue` | queue budget `submittedAt + maxQueueWaitMs` |
| **RUNNING** (sticky) | `/history` only | execution budget `firstObservedRunningAt + timeoutMs` |
| **LEGACY_FALLBACK** (sticky; also the mode whenever the feature is not effective) | `/history` only | starts in LEGACY (feature not effective): `submittedAt + timeoutMs` (today's behavior). Entered mid-flight from PRE_START: `max(submittedAt + timeoutMs, legacyEnteredAt + timeoutMs)` |
| **CLEANUP** | `/history`, `/queue`, delete retries (each re-authorized) | `queueCleanupTimeoutMs` from entry |

Transitions: PRE_START → RUNNING | LEGACY_FALLBACK | CLEANUP. CLEANUP → RUNNING | completed |
`queue_capacity_timeout` | `queue_cleanup_failed`. **RUNNING never returns to PRE_START**, and once in RUNNING
the deadline is never reverted to the submission-based one. LEGACY_FALLBACK is sticky for that submission.

**Mid-flight fallback must not re-create the original bug.** Falling back after the prompt has already queued
(3 `/queue` errors, or unknown-state grace) must not leave the prompt only `timeoutMs - elapsedQueueTime` to run:
the deadline is `max(submittedAt + timeoutMs, legacyEnteredAt + timeoutMs)`, so execution always gets a full
`timeoutMs` after the fallback. `legacyEnteredAt` is recorded and logged at the transition. Residual risk
(accepted): in LEGACY nothing observes queue state, so a prompt still pending at that deadline can time out into
`handleFailure`; the metric below counts those. Test: queued 250s then fallback does not time out at 300s from
submission, only `timeoutMs` after fallback.

### PRE_START poll (every 3s)

```
1. cancel check                                    (see Cancellation)
1b. if mode == PRE_START and now > submittedAt + maxQueueWaitMs
      -> queue-budget exhaustion (PRE-DELETE RECONCILE) NOW, before any ordinary read; this is where
         containment begins. Steps 2-3 below do not run in this iteration.
2. GET /history/{id}                               ALWAYS FIRST
     status_str == 'error' -> throw (unchanged)
     outputs present       -> return { status: 'completed' }
3. GET /queue
     id in queue_running -> firstObservedRunningAt = now; mode = RUNNING; unknownSince = unset
     id in queue_pending -> unknownSince = unset; consecutiveQueueErrors = 0
     in neither          -> "Unknown state"
     read failure        -> "Queue read failure"
(No step 4: the budget deadline is step 1b, checked before network I/O. Steps 2-3 only run while the budget
 has not expired, so their transport-failure rules never apply after exhaustion.)
```

### RUNNING poll

```
cancel check -> /history (error -> throw; outputs -> completed) -> if now > firstObservedRunningAt + timeoutMs
-> throw execution timeout (existing message and path)
```

`/queue` is not polled once RUNNING, so a later `/queue` outage cannot affect a running prompt. If the prompt
vanishes after starting (ComfyUI restart/crash), `/history` stays empty and the execution deadline fires
normally; such a loss is noticed only then (accepted). `firstObservedRunningAt` is the first poll at which the
dispatcher *noticed* the prompt running, so the effective execution budget is `timeoutMs` plus up to ~3s.

**Normal polling requests are finite but their deadlines are soft.** The existing client already gives the
`/history` poll `AbortSignal.timeout(10_000)` (`progress.ts`); the new PRE_START `/queue` poll uses the same
10s bound (and all other existing ComfyUI calls keep their current finite timeouts). The queue-budget and
execution deadlines are checked once per loop iteration, so unlike cancel and CLEANUP they are **detection
deadlines, not hard outer bounds**: detection can occur after the nominal deadline by roughly one poll interval
(3s) plus the request timeouts in that cycle (about 13s in RUNNING, about 23s in PRE_START with default values).
Do not promise a tighter number.

**Existing `/history` failure behavior (pre-existing; not changed by this spec).** The poll has no `try/catch`:
a `/history` transport error or abort-timeout throws out of `waitForCompletion` and enters the normal failure
path (`handleFailure`, attempt consumed, retry), even though the original prompt may still be queued or running.
The queue-capacity invariant is deliberately limited to queue-capacity timeouts and does not cover this. Making
history polling resilient to transient errors changes duration, retry timing, attempt consumption and refund
timing, so it is a separate follow-up (see Follow-ups).

### Unknown state

```
if known (pending or running): unknownSince = unset
else:                          unknownSince ??= now
                               if now - unknownSince >= queueStateUnknownGraceMs -> LEGACY_FALLBACK
```

A known observation resets the timer. The duration of the "finished but not yet in history" window is
unverified (see Unverified).

### Queue read failure

- `consecutiveQueueErrors` counts failures and resets on any successful read.
- At `>= 3` consecutive errors in PRE_START: LEGACY_FALLBACK, log once at warn. **This rule applies to
  PRE_START polling only.** After queue-budget exhaustion begins (PRE-DELETE, POST-DELETE, CLEANUP) the
  counter is not used and LEGACY_FALLBACK is unreachable (see the Containment rule).
- In RUNNING `/queue` is not read, so this does not apply.

### Queue-budget exhaustion

Entered at step 1b when `now > submittedAt + maxQueueWaitMs` in PRE_START (before any ordinary read). **Never delete based on the previous poll's
state.** The worker stays BUSY throughout.

```
PRE-DELETE RECONCILE
  (each step below first checks isCancelled(); true => run the Cancellation state machine, throw JobCancelledError)
  GET /history -> outputs  => return completed (no delete)
               -> error    => throw (unchanged; authoritative status_str: error only)
               -> transport failure => unconfirmed: enter CLEANUP; no throw, no attempt consumed
  GET /queue   -> running  => mode = RUNNING, firstObservedRunningAt = now (no delete)
               -> pending  => continue to DELETE
               -> neither  => re-check once after queueStateUnknownGraceMs; still neither and no history
                              => confirmed absent => FINAL GET /history/{id}: outputs => return completed
                                 (error => throw); empty => return queue_capacity_timeout (no delete);
                                 transport failure => NOT confirmed: enter CLEANUP (never queue_capacity_timeout)
               -> read failure => unconfirmed: do not delete blindly, do NOT count toward LEGACY_FALLBACK;
                                  enter CLEANUP (observation-only until a read succeeds)

RULE (all timeout-path exits): every return of `queue_capacity_timeout` that follows an absence confirmation —
here, after the post-delete confirmation, and in CLEANUP — performs the final /history read first.

DELETE   (only if authorizeDelete(worker) is true NOW; otherwise skip to CLEANUP observation-only)
  authorizeDelete reads  bounded by requestTimeoutMs; timeout / read failure => unauthorized => CLEANUP
                         observation-only (this runs BEFORE CLEANUP's clock starts, so it needs its own bound)
  POST /queue {"delete":[id]}   (never /interrupt here: the timeout path only removes a pending prompt)
                         bounded by requestTimeoutMs
  timeout / network error / non-2xx / unconfirmed => CLEANUP (do NOT return queue_capacity_timeout)

POST-DELETE RECONCILE   (required: the prompt may have started between reconcile and delete; on 0.37.0 the
                         delete of a running prompt is a verified no-op that still returns HTTP 200, so neither
                         the status code nor one absent read proves the delete worked)
  (isCancelled() checked before each read, as above)
  GET /history -> outputs  => return completed
               -> error    => throw (unchanged)
               -> transport failure => CLEANUP
  GET /queue   -> running  => delete lost the race => mode = RUNNING, firstObservedRunningAt = now
               -> pending  => delete did not take effect => CLEANUP (do NOT requeue)
               -> absent   => NOT yet confirmed => CLEANUP confirmation path (set unknownSince = now); only the
                              normal confirmed-absence rule (two absent reads at least queueStateUnknownGraceMs
                              apart, no history) returns queue_capacity_timeout
               -> read failure => CLEANUP
```

Consistency: the pre-delete reconcile, the post-delete reconcile and CLEANUP all use the **same**
confirmed-absence rule. A single absent read is never final anywhere on the timeout path.

### CLEANUP mode

Entered when the delete failed or was not authorized, the post-delete reconcile still shows pending **or shows
the prompt absent (not yet confirmed)**, or `/queue` is unreadable during reconciliation. Bounded by `queueCleanupTimeoutMs`. **Keep the worker BUSY** during
it: releasing it would let another job land behind a possibly-undeleted pending prompt. Each poll: `/history`
first, then `/queue`; while the prompt is pending, **re-run `authorizeDelete` before every retry** and retry the
delete only if it is true (otherwise remain observation-only).

```
every iteration, before any read: isCancelled() true => run the Cancellation state machine (same modes,
                            authorization and ratchet as RUNNING), throw JobCancelledError; the cancel's own
                            bounds apply. Precedence: until a cancel is observed, CLEANUP's deadline governs the loop; once observed,
                            control transfers to the Cancellation state machine, `cancelConfirmationTimeoutMs`
                            governs, and the function ends as JobCancelledError (queue_cleanup_failed cannot win)
history outputs          -> return completed
history error            -> throw (unchanged; authoritative status_str: error only)
history transport failure-> log + metric (queue_capacity_read_failures_total{endpoint=history}); stay in CLEANUP;
                            treat the prompt state as unconfirmed this iteration (no absence credit)
queue transport failure  -> log + metric ({endpoint=queue}); stay in CLEANUP; unknownSince = unset (a failed read
                            is not an absent read); never LEGACY_FALLBACK
id running               -> mode = RUNNING, firstObservedRunningAt = now; unknownSince = unset
id absent, confirmed     -> one final GET /history/{id}: outputs => return completed (error => throw);
                            empty => return queue_capacity_timeout; final read transport failure => not
                            confirmed: keep polling (retry the final read next iteration), do NOT return
                            queue_capacity_timeout
id absent, unconfirmed   -> keep polling; do NOT re-delete (nothing is pending); unknownSince ??= now
id pending               -> unknownSince = unset; if authorizeDelete(now): retry delete; continue
                            (observation only otherwise)
cleanupTimeoutMs elapsed -> return queue_cleanup_failed   (also the outcome when reads keep failing: terminate +
                            refund, never requeue, never the ordinary retry path)
```

"Absent" counts as confirmed only per the Unknown-state grace rule (two absent reads at least
`queueStateUnknownGraceMs` apart, no history, and no pending/running observation in between). **Consumer
slot:** `waitForCompletion` runs inside the consumer, so CLEANUP holds a consumer slot for up to
`queueCleanupTimeoutMs`; keep it short and alert on `queue_cleanup_failed`. Because every normal deletion now
passes through the confirmation path, a normal queue-capacity timeout holds its slot about
`queueStateUnknownGraceMs` longer than in rev 4.4.

**Config constraint (exact).**

```ts
queueCleanupTimeoutMs >= queueStateUnknownGraceMs + 2 * POLL_INTERVAL_MS   // default: 10_000 + 2 * 3_000 = 16_000
```

Reason: the first absent read lands on a poll, and the second must be at least `queueStateUnknownGraceMs`
later, which rounds up to the next poll boundary (up to 12s with the default 10s grace and 3s polling); the
second poll interval is margin. Otherwise confirmation cannot complete in time and every normal deletion would
end as `queue_cleanup_failed` (terminate + refund). If the configured value violates the inequality, treat the
budgets as invalid: the timeout feature stays disabled (legacy) and the reason is logged. Validation and tests
assert the identical boundary (`>=`). The arithmetic assumes **healthy request latency**: if `/queue` or
`/history` requests hang toward their bound, confirmation may not finish inside the window and a normal deletion
can end as `queue_cleanup_failed`. That is the safe outcome (terminate + refund, worker released, alert); do not
widen the constraint to cover outages.

Authorization reads made **inside CLEANUP** are bounded by CLEANUP's remaining deadline (`queueCleanupTimeoutMs`
from entry). The pre-delete and post-delete reconciles, **and the first `authorizeDelete` and the first
`POST /queue delete`**, are **outside** CLEANUP: each only needs a finite per-request timeout
(`requestTimeoutMs`) and does not consume the cleanup budget. `queueCleanupTimeoutMs` starts when CLEANUP is
actually entered.

**The pre-CLEANUP phase is not instantaneous.** Worst case, several calls each bounded by `requestTimeoutMs`
(two pre-delete reconcile reads, two authorization reads, the delete, two post-delete reconcile reads) can add up
to tens of seconds before CLEANUP starts while the worker stays BUSY. That is acceptable but must not be assumed
away when sizing consumer capacity or timeouts.

### Cleanup exhaustion: release, no quarantine

On `queue_cleanup_failed` the customer job is terminated with a refund (never requeued), **and the worker is
released to IDLE** with the atomic release primitive, an ERROR log, a metric and an alert. There is **no runtime
gate read** at release and **no quarantine**:

- Holding the worker BUSY is a quarantine in all but name, with no recovery path except a dispatcher restart,
  and `registerWorkers` resets every worker to IDLE on boot (possibly with the stray prompt still pending). It
  also costs capacity. On an ungated worker the ungated collision risk is already the accepted baseline.
- On a gated worker (required for any worker under queue-aware control) the live `/prompt` probe skips the
  worker while the stray prompt exists, so releasing is safe. The dependency is protected by the Queue-gate
  protection section.

The same release rule applies when cancel confirmation expires unconfirmed, and in CONSERVATIVE cancel.

### Cancellation

Cancel today (`progress.ts`): `isCancelled()` → `interruptPrompt` (unscoped, worker-wide) → `JobCancelledError`.
The unscoped interrupt is the bug. Cancellation therefore has **three modes**, chosen per worker at cancel time:

| Mode | When | Behavior |
|---|---|---|
| **LEGACY** | `legacyCancelEligibleAtStart` **AND** the cancel-time capability read is definitively `not_configured` (never validated) | unscoped `/interrupt`, **live-authorized immediately before it** (`authorizeLegacyInterrupt`, below). Known interim risk (below) until the worker is validated. |
| **SAFE_SCOPED** | `safeCancel(worker)` effective now (read `configured`, all three capabilities true, version matches) | scoped delete + scoped interrupt + confirmation (below), each destructive call re-authorized |
| **CONSERVATIVE** | anything else: `configured` but `safeCancel` not effective (version key missing/stale/mismatched, or only some capabilities validated or remaining after a partial revocation); **or** the read is `unreadable` at start or at cancel time; **or** `legacyCancelEligibleAtStart` is false but the current read is `not_configured` | **never send an unscoped interrupt, and send no ComfyUI cancel calls at all** (below); still `JobCancelledError`; version-drift / config-loss metric + alert |

`cancelDeadline = now() + cancelConfirmationTimeoutMs` is set **at cancel entry, before the first cancel-time
capability read**; it is not restarted after the delete or interrupt, so "confirmation timeout" has one meaning.

**One-way ratchet.** `legacyCancelEligibleAtStart = (start read is not_configured)`, so
`LEGACY = legacyCancelEligibleAtStart && (cancel-time read is not_configured)`; every other combination is
SAFE_SCOPED or CONSERVATIVE. Any evidence that the worker is, or was, under queue-aware control — configured
now, configured at start, or unreadable at either time — makes cancellation at least CONSERVATIVE. A submission
that began on a validated worker can therefore never be downgraded to the unscoped interrupt by loss, rename,
corruption, revocation or unavailability of its configuration. (The reverse — `not_configured` at start,
`configured` at cancel — simply uses the current evaluation: SAFE_SCOPED if all conditions hold, else
CONSERVATIVE.)

**CONSERVATIVE rationale.** A worker that was validated but whose version or configuration is now unknown,
partial or different may run a ComfyUI whose `/interrupt` ignores `prompt_id` (worker-wide) — exactly the
foreign-job-kill bug. So we must not invoke an API whose semantics we no longer claim are validated. Cost,
accepted: our own prompt may keep running or stay queued after the user cancels (orphaned GPU work). It cannot
kill someone else's workflow. The queue gate (required for any configured worker) then keeps routing off the
worker until the stray prompt drains. Handling: throw `JobCancelledError` (refund as today), release the worker
per the Cleanup-exhaustion rule, ERROR log + metric + alert. (No delete-only or interrupt-only variants: each
claim is validated only on the tested version, and per-operation combinations multiply states and tests.)

**SAFE_SCOPED** sends **both operations with our own prompt id**, rechecking `safeCancel` before each (see Live
authorization); each is idempotent and harmless when it does not apply (verified on 0.37.0: delete of a running
prompt and interrupt with a non-matching id are no-ops):

```
cancel requested
  1. [recheck safeCancel] POST /queue {"delete":[ourId]}        removes it if pending; no-op if running
  2. [recheck safeCancel] POST /interrupt {"prompt_id": ourId}  stops it if running; no-op if not
  3. confirm, until cancelConfirmationTimeoutMs elapses:
       GET /history/{ourId}
         any entry (outputs, or status error / execution_interrupted) -> RESOLVED
       GET /queue
         ourId pending or running -> unresolved, keep polling
         ourId absent             -> recheck after cancelAbsentRecheckMs;
                                     absent again and still no contrary history -> RESOLVED
         /queue unreadable        -> rely on /history; keep polling
  4. throw JobCancelledError (unchanged caller handling)
```

- **History semantics differ in cancel mode.** In normal execution `status_str == 'error'` is a workflow failure
  (thrown). During cancel confirmation, `error` / `execution_interrupted` and `completed` are all *resolved*
  states: cancellation has already been requested and the caller still applies cancel semantics (refund,
  `JobCancelledError`), including when the prompt had already finished.
- The two-read absence rule (`cancelAbsentRecheckMs`) is an engineering safeguard, not a proven ComfyUI
  guarantee; the transient window is unmeasured. It is deliberately shorter than the 10s unknown-state grace so
  routine cancels stay fast.
- No `/queue` read is needed *before* acting, so an unreadable `/queue` never blocks a cancel and never causes
  an unscoped interrupt.
- **HTTP failure semantics.** Every request on this path is wrapped so that a thrown error, timeout, or non-2xx
  response never escapes as a job error:
  - **delete fails** → log + metric; **re-authorize `safeCancel` and still attempt the scoped interrupt** if
    authorized; continue to confirmation. While confirmation observes the prompt still **pending**, **retry the
    delete** each poll (the interrupt does nothing for a pending prompt), re-running `safeCancel` before every
    retry, as the timeout path does in CLEANUP.
  - **interrupt fails** → log + metric; continue to confirmation (it may still resolve via history, queue
    absence, or the delete).
  - Cancellation **always** ends as `JobCancelledError`, whatever the request outcomes. If the prompt is still
    unresolved when `cancelConfirmationTimeoutMs` elapses, the unconfirmed rule below applies.
- **The outer deadline is authoritative; the per-request timeout is clamped to it.**
  `cancelConfirmationTimeoutMs` is a hard outer confirmation bound and `requestTimeoutMs` is only the maximum
  timeout of an individual call. Before **every** `/history`, `/queue`, delete and interrupt call:

  ```ts
  const remainingMs = deadline - now();
  if (remainingMs <= 0) { /* confirmation exhausted: stop, apply the unconfirmed rule */ }
  const callTimeoutMs = Math.min(requestTimeoutMs, remainingMs);   // skip the call if remainingMs is negligible
  ```

  Example: with a 20s bound and 5s request timeout, a call starting at t=19.5s is aborted at t=20s, not 24.5s,
  and two sequential hanging calls cannot push the total to ~29s. Small scheduler/event-loop overshoot is not a
  contractual guarantee. The identical rule applies to CLEANUP and `queueCleanupTimeoutMs` (delete and reads).

  The deadline also bounds **live-authorization I/O**: the capability read and the version-key read are each
  limited to the remaining outer deadline (for example `Promise.race` against `remainingMs`), independent of any
  client-level Redis timeout. A read that times out is treated as `unreadable`, i.e. not authorized, so the
  destructive call is skipped (fail closed). **No live-authorization I/O may block beyond the remaining outer
  deadline.** Worker release after the deadline keeps its own bounded retry and failure metric.
- Worker stays BUSY until resolved. If unresolved when `cancelConfirmationTimeoutMs` elapses (including when a
  destructive call was skipped because authorization weakened): still throw `JobCancelledError` (the user
  cancelled; refund as today), then apply the Cleanup-exhaustion release rule (release, ERROR log, metric,
  alert).
- Cancel is not gated by the budgets or the queue gate; it depends only on the mode above.

**LEGACY is live-authorized too.** The mode is chosen from two reads, so without a recheck there is a window in
which an operator enables validated capabilities (the validation procedure drains a worker that may still hold an
in-flight job) between the decision and the HTTP call, and the unscoped interrupt then fires on a worker that is
now under queue-aware control. Immediately before the unscoped `/interrupt`:

```
authorizeLegacyInterrupt(worker) =
    legacyCancelEligibleAtStart
    AND a FRESH capability read (bounded by the remaining cancelDeadline) is definitively not_configured

true                                  -> send the unscoped interrupt (existing behavior)
configured / unreadable / timed out   -> downgrade to CONSERVATIVE: send nothing, JobCancelledError, alert
```

The Redis-read-to-HTTP TOCTOU window remains and is accepted exactly as for the other destructive calls.

**LEGACY interim risk, stated plainly:** on a never-validated worker, cancelling while the prompt is queued
behind a foreign run interrupts the foreign run, and cancelling when ownership cannot be proven may orphan our
own GPU work. This remains until each worker is validated. It is the existing behavior, not a regression.

### Caller responsibilities

| Result | `processor.ts` direct call sites | `mannequin-phase.ts` | `processJob` (for mannequin) |
|---|---|---|---|
| `completed` | continue as today | continue as today | — |
| `queue_capacity_timeout` | release worker (safe primitive); existing terminate-or-requeue: age check against `MAX_QUEUE_WAIT_MS` with the site's own anchor, `NO_WORKER` terminate + refund past it, else `requeueForNoWorker`; **no `attempts`** | release its worker; return `{ status: 'no_worker' }` | existing mannequin `no_worker` handling (Project A) does terminate-or-requeue |
| `queue_cleanup_failed` | release worker (safe primitive, ERROR log + metric + alert); **terminate** with `QUEUE_CLEANUP_FAILED`, refund, **no requeue**; no `attempts` | release its worker; return `{ status: 'cleanup_failed' }` (new `MannequinPhaseResult` member, **not** `no_worker`) | terminate with `QUEUE_CLEANUP_FAILED` + refund, **no requeue** |

- `mannequin-phase.ts` must not learn job age, refund, or re-`XADD` policy.
- **Never call `requeueForNoWorker` directly**: without the age check a job that repeatedly times out in
  ComfyUI's queue would requeue forever.
- Mapping `queue_cleanup_failed` to `no_worker` would requeue and break the invariant.
- Worker release uses the atomic, retried BUSY→IDLE primitive from the routing work (`releaseWorkerIfBusy`),
  never `setWorkerStatus`; DRAINING is preserved.
- `QUEUE_CLEANUP_FAILED` has no friendly UI mapping (reported by the implementer's search of `apps/` and
  `packages/`; not independently verified): it will surface as a raw error code until separate UI work.
- Queue-age anchors differ per site today (`createdAt` vs `queuedAt ?? createdAt`); each site keeps its own.
  Use one shared helper taking the caller context as arguments. Anchor normalization stays a separate change.

### Typed-result enforcement

TypeScript will not force a caller that ignores the return value of `await waitForCompletion(...)`, and an
ignored `queue_capacity_timeout` would look like success and continue into output-fetch. Rules:

- No call site may invoke `waitForCompletion` without consuming and exhaustively switching on `status`
  (`assertNever` default). Review/CI check: grep for bare `await waitForCompletion(`; there must be none.
- Update every current call site (this checkout has 8; do not hard-code the count).

### Orphaned prompts

Today a prompt abandoned by an execution timeout keeps running on the worker. Out of scope. The queue-capacity
and SAFE_SCOPED cancel paths delete/interrupt their own prompt by id. Whether to send a scoped `/interrupt` on an
*execution* timeout is separate: now plausible on validated workers (our id), left as follow-up.

### State machine (explanatory only)

```
PRE_START --id in queue_running--------------------------> RUNNING --history outputs--> completed
   |  \--/queue unreadable x3 or unknown grace--> LEGACY_FALLBACK --submittedAt+timeoutMs--> timeout
   |                                              RUNNING --execution budget--> EXECUTION_TIMEOUT
   +--queue budget exceeded--> reconcile --> [authorizeDelete?] delete --> reconcile
          running -> RUNNING          absent (post-delete) -> CLEANUP confirmation (two reads, grace apart)
          history -> completed        pending / delete failed / not authorized -> CLEANUP
   CLEANUP: observe; retry delete only while authorizeDelete(now)
          completed | RUNNING | absent -> queue_capacity_timeout | window exhausted -> queue_cleanup_failed
   Cancel (any mode):
          LEGACY       (not_configured at start AND at cancel evaluation) -> [fresh capability recheck,
                       authorizeLegacyInterrupt] still not_configured: unscoped interrupt -> JobCancelledError;
                       configured / unreadable / timed out: CONSERVATIVE (no interrupt)
          SAFE_SCOPED  [recheck] delete(ourId) -> [recheck] interrupt(ourId) -> confirm (history + 2-read absence)
                       -> JobCancelledError   (unconfirmed after cancelConfirmationTimeoutMs -> same, release + alert)
          CONSERVATIVE (configured but not safe, partial, unreadable, or configured at start && now missing)
                       no ComfyUI calls -> JobCancelledError -> release + alert
   (RUNNING never returns to PRE_START; the cancel ratchet only moves LEGACY -> CONSERVATIVE, never back;
    a denied/revoked/unreadable authorization never falls back to a less-safe destructive API)
```

## Tradeoffs

| | Developers | Users |
|---|---|---|
| **A. Do nothing, rely on the gate** | No work. Gap remains where the gate is off or races. | Jobs can still burn an attempt and duplicate GPU work; cancel can kill a developer's run. |
| **B. Just raise the timeout** (e.g. 600s) | One constant. Hides real hangs longer; a stuck job holds a worker 10 min. | Fewer false timeouts, slower failure on real hangs. |
| **C. Four budgets via `/queue` + safe cancel (this spec)** | More logic in one function, one extra `/queue` GET per poll while queued, every call site edited, per-worker capability state, a version guard, a gate-protection rule and a live-authorization helper to maintain, validation per worker/version. Dormant until enabled. | Queue wait stops causing retries; real hangs still fail after 300s of execution; no knowing duplicates; cancel no longer kills foreign runs on validated workers. |
| **D. `/history` only, extend if `/prompt` `queue_remaining > 0`** | Cheaper, no prompt-id matching, but cannot tell whether *our* prompt is running. | Coarser: a long foreign queue extends our wait unless capped. |

Cleanup-exhaustion handling:

| | Developers | Users |
|---|---|---|
| **A1. Release + gate prerequisite + admin guard + alert (chosen)** | No new state, no runtime gate read. One predicate term, one admin rule, one drift alert. | Capacity recovers; a gated worker's stray prompt is skipped by the live probe. |
| A2. Release only if gate currently ON, else hold BUSY | Extra Redis read and a stuck-BUSY mode with no recovery path (restart resets it). | Narrow extra safety, at the cost of lost capacity. |
| B. Quarantine key checked by the selector | New key, Lua change, operator workflow, alerting; highest blast radius. | Safest in theory; a worker can sit out until someone acts. |

Cancel when validation state is unknown, changed, partial or lost:

| | Developers | Users |
|---|---|---|
| **Conservative (zero destructive calls) + ratchet + live recheck per call (chosen)** | Three understandable modes; no per-operation combinations; one start-of-submission boolean. | Cannot kill a foreign workflow; in an emergency partial-revocation state our own prompt may orphan until drained (the gate keeps the worker unused). |
| Per-operation authorization (delete-only, interrupt-only) | More states and tests; mode names stop describing behavior. | Finer control during partial revocation. Rejected for cancel; the timeout-path delete is still authorized independently. |
| Fall back to legacy unscoped interrupt | Simplest. | Re-enables the foreign-job-kill bug exactly when validation state is unknown. |

Capability revocation:

| | Developers | Users |
|---|---|---|
| **Immediate partial revocation + live authorization before destructive calls (chosen)** | Simple admin rule; one authorization helper called in two paths. | Operator can switch an unsafe capability off instantly and in-flight jobs honor it at the next call. |
| `DRAINING` + empty queue for every revocation | One admin rule, but does not stop an already-snapshotted job and delays an emergency stop. | Slow emergency stop. |

Recommendation: **C**, implemented dormant, enabled per worker after validation, with **A1** for cleanup.

## Validation (pre-enable, per worker and per ComfyUI version)

Coding and CI may proceed before validation; **production enablement may not.** Run
`2026-10-01-comfyui-queue-validation-runbook.md` on each worker (drained first), through the real
dispatcher → `https://wN.aivastra.com` → nginx path. Enable the queue gate first, then write that worker's
capability key (audited).

| Worker | ComfyUI | Identity | Delete | Delete on running = no-op | Scoped interrupt | Date |
|---|---|---|---|---|---|---|
| w7 (`woker-7`) | 0.37.0 | PASS | PASS | PASS | PASS | 2026-10-01 |
| all others | ? | not validated | not validated | not validated | not validated | — |

Record each result in `docs/progress.md`.

## Unverified until tested

- The duration of the transient window in which a completed prompt appears in neither `/queue` nor `/history`
  (sets whether the 10s grace and the 2s cancel recheck are sufficient).
- Behavior on workers with a different ComfyUI version or proxy config.
- Interrupt/delete behavior with two *real* concurrent prompts of other users (w7 test used a non-matching id).
  **This is a hard precondition, not a footnote:** `promptScopedInterruptValidated` must not be set true for a
  worker until the following is run on that worker/version and recorded in `docs/progress.md`: run two real
  prompts (A running, B pending); `POST /interrupt {"prompt_id": B}` must leave A running and untouched; then
  `POST /interrupt {"prompt_id": A}` must interrupt only A. Admin tooling should refuse to set the flag without
  a recorded validation reference.

## Tests

`apps/dispatcher/src/comfyui/progress.test.ts` stubs one `fetch` response for every URL; it must be **rewritten
as part of this change** (polling `/queue` breaks it). The ComfyUI mock (`apps/dispatcher/test/helpers/
comfy-mock.ts`) needs: `/queue` listing the submitted prompt as pending then running on a schedule, a start
delay, controllable `/queue` failures, `POST /queue` delete (with call counter and failure injection; deleting a
running id is a no-op, matching 0.37.0), `POST /interrupt` honoring `prompt_id` (non-matching id is a no-op;
a matching interrupt writes a history entry with `status_str: error` and `execution_interrupted`), history
written on finish, and a `/system_stats` `comfyui_version`. The test harness also needs a way to **change the
capability/version state between steps** of one `waitForCompletion` (to test live authorization).
**The mock encodes assumptions; its tests do not validate them.**

PRE_START / RUNNING
- Queued 400s then runs 100s → completes (was: timeout at 300s).
- Runs longer than `timeoutMs` after first observed running → execution timeout, attempt consumed.
- Queued 250s → running → `/queue` starts returning 500 → full `timeoutMs` from `firstObservedRunningAt`;
  `/queue` is not polled in RUNNING.
- Running prompt vanishes from `/queue`, no history → waits to the execution deadline, then execution timeout.
- Finishes between polls (history outputs, not in queue) → completes, not "lost".
- Execution error in history → unchanged error path.

Dormant / capability
- Budgets unset or unreadable → legacy behavior; `/queue` never called; effective mode logged.
- Capabilities `not_configured` / `unreadable` / identity false / delete false → legacy timeout.
- Queue gate off or missing → timeout feature legacy (even with capabilities and budgets).
- Reported ComfyUI version differs from `validatedComfyVersion`, or version key missing/stale → timeout legacy.
- w7-style capabilities + gate ON + budgets set → queue-aware.
- **A `DRAINING` worker keeps its version key** (monitor probes version for draining workers without renewing the
  health key) → `safeCancel` stays effective for in-flight work during a drain.
- Per-submission snapshot: budgets changed mid-wait do not change that submission's starting mode.

Unknown / failure
- One transient `/queue` 500 while queued → continues, no fallback.
- 3 consecutive `/queue` failures, never observed running → LEGACY_FALLBACK (sticky), no further `/queue` calls.
- `pending, unknown 3s, pending, unknown 3s` → grace timer resets.

Queue-budget exhaustion
- Still pending at reconcile → delete called; **first** post-delete read absent → **not yet** final; a second
  absent read at least `queueStateUnknownGraceMs` later, no history → `queue_capacity_timeout`.
- Reconcile shows running → no delete, execution clock starts.
- Reconcile shows history outputs → completes, no delete.
- **Delete race:** pending at reconcile, starts before delete, post-delete reconcile sees running → RUNNING; no
  `queue_capacity_timeout`, no requeue.
- **Delete race, harder variant:** pending at reconcile; the prompt starts before the delete; the delete returns
  HTTP 200 as a no-op; the **first post-delete `/queue` read is absent** (transient); a **later read shows
  running** → transitions to RUNNING; **not** `queue_capacity_timeout`, **not** requeued.
- Normal deletion: delete succeeds, first post-delete read absent, second confirmed-absence read after the
  grace also absent, no history → `queue_capacity_timeout` (and the caller's capacity policy applies).
- **Final history read:** second absent read confirmed, but the final `/history/{id}` read now shows outputs →
  `completed`, **not** `queue_capacity_timeout`.
- **Initial authorization bound:** the first `authorizeDelete` Redis read hangs → bounded by `requestTimeoutMs`,
  treated as unauthorized, CLEANUP entered observation-only, no delete sent.
- **Initial delete bound:** the first `POST /queue delete` hangs (or throws / non-2xx) → bounded by
  `requestTimeoutMs`, CLEANUP entered; `queue_capacity_timeout` is not returned.
- CLEANUP, absent but unconfirmed → keeps polling; **no second delete is sent**.
- **Config constraint (exact boundary):** with the default 10s grace and 3s poll, `queueCleanupTimeoutMs`
  **15,999 → rejected** (timeout feature disabled, legacy mode, reason logged) and **16,000 → accepted**;
  generally `queueCleanupTimeoutMs >= queueStateUnknownGraceMs + 2 * POLL_INTERVAL_MS`. The validator and the
  test assert the same `>=` boundary.
- **Delete failure:** `POST /queue` 500 → CLEANUP; no `queue_capacity_timeout`; worker stays BUSY during CLEANUP.
- CLEANUP: delete eventually succeeds → `queue_capacity_timeout`; starts → RUNNING; finishes → completed.
- CLEANUP window exhausted → `queue_cleanup_failed`; worker **released**, job terminated + refunded, ERROR log and
  metric emitted.

Live authorization (timeout path)
- Submission started queue-aware; **delete capability revoked before queue exhaustion** → `POST /queue delete` is
  **never sent**; CLEANUP is observation-only.
- Same, and the prompt then **starts** → RUNNING (execution clock starts); **finishes** → completed; **is
  confirmed absent** → `queue_capacity_timeout`; **stays pending to the cleanup deadline** →
  `queue_cleanup_failed` (terminate + refund, worker released, alert).
- CLEANUP entered with delete authorized; **delete revoked before a retry** → the retry is suppressed.
- `authorizeDelete` read is `unreadable` → delete not sent; observation-only.
- Version key lost/changed before the delete → delete not sent.
- A new submission after revocation → legacy timeout mode.

Cancellation
- **SAFE_SCOPED**, cancel while pending → delete(ourId) + interrupt(ourId); confirmed gone; `JobCancelledError`;
  **no unscoped interrupt**; a foreign running prompt on the same mock keeps running.
- SAFE_SCOPED, cancel while running → our prompt stops (history `error`/`execution_interrupted` counts as
  resolved, not as a workflow failure); `JobCancelledError`.
- Absent from `/queue` once, then present again at the recheck → not resolved; keeps confirming.
- Absent twice `cancelAbsentRecheckMs` apart → resolved.
- `/queue` unreadable but `/history` shows the interrupted entry → resolved via history.
- `/queue` unreadable and no history → unresolved until `cancelConfirmationTimeoutMs`; `JobCancelledError`,
  worker released, ERROR log + metric.
- Prompt had already completed when cancel landed → resolved; `JobCancelledError` (cancel semantics preserved).
- **Live recheck:** delete capability revoked **before the delete call** → **neither** the delete nor the
  interrupt is sent (CONSERVATIVE), no unscoped call, `JobCancelledError`, alert.
- **Live recheck:** interrupt capability revoked **between the delete and the interrupt** → the delete was sent,
  the interrupt is **not** sent; confirmation proceeds; unresolved prompt → `JobCancelledError` after the window,
  worker released, alert.
- **HTTP failure:** SAFE_SCOPED cancel + **delete returns HTTP 500** → the scoped interrupt is **still
  attempted if `safeCancel` still holds**, confirmation runs, `JobCancelledError`; no error escapes.
- **HTTP failure:** SAFE_SCOPED cancel + **delete throws (network error / timeout)** → same as above.
- **HTTP failure:** SAFE_SCOPED cancel + **interrupt returns HTTP 500 or throws** → confirmation runs,
  `JobCancelledError`.
- **Delete retry:** SAFE_SCOPED cancel, prompt pending, first delete fails → the delete is **retried during
  confirmation** (re-authorized each time); prompt then removed → resolved → `JobCancelledError`. If
  `safeCancel` is revoked before a retry → the retry is **not** sent.
- **Outer deadline:** a hanging delete/interrupt/`/queue`/`/history` request is aborted at
  `min(requestTimeoutMs, remaining deadline)`; confirmation does not intentionally exceed
  `cancelConfirmationTimeoutMs`, and a call is not sent when the deadline is exhausted. Same test for CLEANUP and
  `queueCleanupTimeoutMs`. (Two sequential hanging requests starting near the deadline must not extend it.)
- **Authorization read hangs:** a live-authorization Redis read (capabilities or version key) that hangs near the
  deadline is bounded by the remaining deadline, treated as `unreadable`, the destructive call is skipped, and
  cancellation does not intentionally exceed `cancelConfirmationTimeoutMs` (same for CLEANUP).
- **Log semantics:** authorization fails before any destructive call → `cancel_mode = conservative`; delete sent
  then interrupt skipped because authorization weakened → `cancel_mode = safe_scoped`,
  `cancel_outcome = authorization_weakened`, `skipped_operation = interrupt`.
- **CONSERVATIVE:** configured, version key missing → no unscoped `/interrupt`, no ComfyUI cancel calls,
  `JobCancelledError`, version-drift metric + alert, worker released.
- **CONSERVATIVE:** version key present but different from `validatedComfyVersion` → same expectations.
- **CONSERVATIVE:** only some capabilities `true` (e.g. identity only, or after a partial revocation) → same
  expectations; **no per-operation calls**.
- **CONSERVATIVE:** capability read **unreadable** (Redis error, malformed JSON, wrong shape) → same
  expectations; **never LEGACY**.
- **Ratchet:** configured at submission start, capability key then missing/renamed away at cancel time → **no
  unscoped interrupt**, CONSERVATIVE, config-loss alert.
- **Ratchet:** **unreadable at start**, `not_configured` at cancel time → **CONSERVATIVE, never LEGACY**.
- **Ratchet:** configured at start, version changes mid-wait → CONSERVATIVE at cancel time.
- **LEGACY:** `not_configured` at start AND at cancel → existing unscoped behavior (documents the interim risk).
- **LEGACY live recheck (regression):** `not_configured` at submission start **and** at the initial cancel-time
  evaluation, then capabilities become **configured before the unscoped interrupt** → the unscoped interrupt is
  **not sent**; mode downgrades to CONSERVATIVE; `JobCancelledError`; alert.
- **LEGACY live recheck:** the fresh pre-interrupt capability read is `unreadable` or times out → unscoped
  interrupt not sent (CONSERVATIVE).
- `not_configured` at start, `configured` + all valid at cancel → SAFE_SCOPED (current evaluation).
- Worker stays BUSY until resolved or the confirmation window elapses.

Capability mutation and gate protection (admin API)
- **`false → true` while the gate is off/missing → rejected, including when another capability is already `true`
  (e.g. identity true, delete false → true with the gate missing → rejected); with the gate on → accepted.**
- **Partial `true → false`** (e.g. delete true → false while identity stays true), with the worker `IDLE` or
  `BUSY` (not `DRAINING`) → **allowed immediately** and audited.
- **Configured → all three `false`, `{}`, or `DELETE` (a manual clear) when not `DRAINING` → rejected; when
  `DRAINING` → allowed.**
- **`validatedComfyVersion` change when not `DRAINING` → rejected; when `DRAINING` → allowed.**
- **`validatedAt`-only update → allowed and audited.**
- Unconfigured → unconfigured (`{}`, all `false`) → allowed.
- Disable the gate on a configured worker not `DRAINING` → rejected; when `DRAINING` → allowed.
- Disable the gate on an unconfigured worker → allowed (unchanged).
- **Unreadable capability key (malformed JSON / wrong shape), worker not `DRAINING`:** disable the gate →
  **rejected**; rename → **rejected**; manual clear → **rejected**; repair/overwrite with a valid value →
  **rejected**; the same operations when `DRAINING` → allowed. An alert is raised for the unreadable key.
- **Admin-side read failure** (e.g. Redis down while reading the capability key) → the guarded mutation is
  **rejected**, not allowed.
- **Rename a configured worker not `DRAINING` → rejected.** Rename when `DRAINING` → capability key moves to the
  new id, old key gone; version key rebuilds.
- Rename an unconfigured worker → allowed (existing behavior; the `BUSY` rename follow-up is separate).
- **Delete a worker (not `BUSY`) → the capability key is deleted unconditionally.** Delete a `BUSY` worker →
  existing `409 WORKER_BUSY` (unchanged).
- **Drift:** configured and gate missing/off → warning metric/log and admin warning, **with global budgets
  unset** (drift does not depend on budgets).

Callers
- `queue_capacity_timeout` at a direct site: worker released (atomic primitive), `attempts` unchanged, requeued;
  older than `MAX_QUEUE_WAIT_MS` → `NO_WORKER` terminate with refund.
- `queue_cleanup_failed` at a direct site: terminate `QUEUE_CLEANUP_FAILED` + refund, **no requeue**.
- **Boundary tests (4.4.8):** (a) last successful PRE_START `/queue` read = pending, clock advanced past
  `maxQueueWaitMs`, next `/history` times out → enters CLEANUP, no exception escapes, no attempt consumed, no
  LEGACY_FALLBACK, no `/prompt` resubmission, and no ordinary `/history` read preceded the reconcile; (b) budget
  expired, reconcile history empty, `/queue` fails → CLEANUP, `consecutiveQueueErrors` untouched; (c) prompt
  started during the last poll interval → reconcile observes running → RUNNING, no delete.
- **Containment tests (4.4.7):** (1) pre-delete `/history` timeout → enters CLEANUP, no exception escapes, no
  attempt consumed, no `/prompt` resubmission; (2) repeated pre-delete/post-delete `/queue` failures (≥3) never
  enter LEGACY_FALLBACK; (3) CLEANUP `/history` and `/queue` transport failures stay in CLEANUP and end as
  `queue_cleanup_failed` at the deadline if never resolved; (4) final `/history` transport failure after two
  absent `/queue` reads does not return `queue_capacity_timeout` (retried in CLEANUP; succeeds → returns it);
  (5) `isCancelled()` true during pre-delete reconcile and during CLEANUP runs the cancellation state machine
  and throws `JobCancelledError`. A history entry with `status_str: error` in these phases still throws.
- Mannequin `queue_capacity_timeout` → `no_worker` → `processJob` terminate-or-requeue; mannequin
  `queue_cleanup_failed` → `cleanup_failed` → terminate, **not** requeue.
- **Typed-result handling:** for every migrated call site both non-`completed` results never fall through into
  output-fetch/success logic (plus the no-bare-`await` grep rule).

## Metrics

`comfy_prompt_queue_wait_seconds` (submission → first observed running) per worker; counters for
`queue_capacity_timeout`, `queue_cleanup_failed`, delete failures, LEGACY_FALLBACK entries (label `midflight` vs `start`), version-guard
mismatches, gate-drift detections, capability-read `unreadable` events, config-loss ratchet triggers,
**destructive calls skipped by live authorization (by operation)**, `queue_capacity_read_failures_total` (by endpoint, post-exhaustion transport failures), and cancels by mode and outcome (legacy /
safe_scoped confirmed / safe_scoped unconfirmed / conservative); `dispatcher_worker_release_failures_total`
reused. These also measure how often foreign work delays production jobs. Alert on any `queue_cleanup_failed`,
any unconfirmed cancel, any CONSERVATIVE cancel, any destructive call skipped by authorization, a version
mismatch for a configured worker, **any capability-read `unreadable` event** (labelled with `workerId` and the
operation context: cancel, delete authorization, admin mutation, monitor), and gate drift. "Configured" cannot
be established from an unreadable read, so the unreadable alert does not depend on it.

## Rollout

1. Rotate the w7 key (it was exposed during validation) and restore w7 to IDLE.
2. Implement dormant (flags, config, admin rules, authorization helper, mock, tests); CI green.
3. Validate each remaining worker/version with the runbook; for each, **enable the queue gate first**, then set
   its capability key (audited).
4. Configure the global budgets (Ops/Product values).
5. Enable gradually, one worker first; watch capacity-timeout/cleanup-failed rates, requeues, NO_WORKER rate,
   and cancel outcomes by mode.

## Follow-ups (separate changes)

- Reject renaming **any** worker while `BUSY` (pre-existing stranding bug, mirrors the delete guard).
- Scoped `/interrupt` on execution timeout.
- **History polling resilience:** distinguish transient `/history` transport errors/timeouts from workflow
  failure; consider bounded consecutive-error tolerance before invoking the existing failure/retry path, while
  preserving an overall execution bound. Pre-existing behavior (see RUNNING poll); changes duration, retry
  timing, attempt consumption and refund timing, so it needs its own small design and tests.
- Queue-age anchor normalization (product-visible: delays some `NO_WORKER` refunds).
- Friendly UI mapping for `QUEUE_CLEANUP_FAILED`.

## Classifying findings during implementation review

When review of the implementation finds something odd, classify it first, so old weaknesses do not get pulled
into this feature indefinitely:

- **A.** A regression introduced by this change.
- **B.** A spec/implementation mismatch.
- **C.** A pre-existing bug exposed by the review (e.g. a `/history` timeout escaping `waitForCompletion`);
  record it under Follow-ups, do not fix it here.
- **D.** An intentional residual risk or non-goal (e.g. the Redis-read-to-HTTP TOCTOU window).

## Open questions

- Values for `maxQueueWaitMs` and `queueCleanupTimeoutMs` (Ops/Product; required config, no defaults).
- Whether the admin guard should also require a fresh, empty queue snapshot for `DRAINING` workers (needs
  `queue-sampler.ts` to sample draining workers; display-only change).
- Who ran prompt `51a6ec69…` on w4? Match against `job_events` `COMFY_DISPATCH` and the pre-restart
  dispatcher's logs. Not done.
