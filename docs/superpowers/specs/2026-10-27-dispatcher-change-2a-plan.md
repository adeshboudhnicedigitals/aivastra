# Dispatcher Change 2a — minimal implementation plan

> **For agentic workers:** After review and explicit implementation authorization, use `superpowers:executing-plans` one complete phase at a time. Check off a phase's steps only after its verification passes; wait for production verification before starting the next phase.

**Goal:** Preserve paid Comfy jobs across dispatcher replacement with exclusive ownership, recoverable submissions and idempotent settlement.

**Architecture:** Two additive Postgres tables hold job authority and phase-attempt evidence. Redis retains transport and token-checked worker reservations; recovery adopts existing prompts through lane admission.

**Tech stack:** Existing TypeScript/ESM dispatcher, Drizzle/Postgres, ioredis/Redis Streams, S3-compatible storage and Vitest. No new worker service or dependency is proposed.

Date: 2026-10-27. Status: revised after review, awaiting confirmation. **Design and plan only; no implementation, migration, test execution, commit or push is authorized by this document.**

The [Change 2 analysis](2026-10-27-dispatcher-graceful-shutdown-safe-redelivery-design.md) remains the analysis record. Where it proposes broader machinery or a different policy, this narrower plan supersedes it. Implement and verify one complete phase at a time; do not commit unfinished pieces of a phase. After local checks, each phase goes through PR → `dev`/staging verification → promotion → production verification before the next phase.

## 1. Fixed decisions and scope

These decisions are approved and are not open questions:

- Persist a deterministic client ID and SUBMITTING intent before each ComfyUI POST. For uncertain acceptance, search `/queue` and `/history` for **60–120 seconds**, configurable, then adopt a match or count a failed attempt and start a new attempt. Exhaustion produces one transactional refund. Duplicate GPU execution is an accepted cost; a second charge and a second published output are not.
- Drain for **0–5 seconds** on shutdown, only to finish DB writes/storage PUTs already underway. Adoption handles the remaining work. Proposed default: 3 seconds; validation accepts only 0–5000ms.
- First rollout uses **admin inactivity/DRAINING**, waits for zero GPU PEL and no PREPROCESSING/GENERATING/UPLOADING jobs, deploys at a quiet time, then reactivates workers. No producer hold, process freezing or maintenance-window replacement procedure is part of 2a.
- Review revision: retain the existing output layout with a pre-PUT lease guard; retain per-attempt input filenames; make reservation cleanup scheduled and mandatory; split ownership (B1) from settlement consolidation (B2). Phase A must measure added pre-submit latency and duplicated workflow storage.

Cover the eight paid Comfy submit sites in [`processor.ts`](../../../apps/dispatcher/src/job/processor.ts), the in-job mannequin submit in [`mannequin-phase.ts`](../../../apps/dispatcher/src/job/mannequin-phase.ts#L136), and intent/correlation instrumentation for the Comfy classify submit in [`classify/process.ts`](../../../apps/dispatcher/src/classify/process.ts#L149). Classify's reservation recovery remains deferred; adding its intent does not make it a paid/replayed job. PixVerse is excluded from the new job protocol and uncertain-submission policy.

Initial operating assumptions: one active dispatcher container, healthy Postgres for acquiring authority, and workers retaining queue/history long enough for the bounded search. Existing deployment has one named dispatcher container; multi-dispatcher correctness is not claimed. Values below other than the approved policy bounds are proposed implementation defaults, not measurements.

## 2. Read findings that constrain the plan

The relevant local source matches main `72a2a56e`; the checkout is still `eb3997c5` with documentation changes. No branch name is used as deployed-code evidence.

| Read source | Consequence |
| --- | --- |
| [`index.ts:86`](../../../apps/dispatcher/src/index.ts#L86) selects only active workers; [`registry.ts:119`](../../../apps/dispatcher/src/worker/registry.ts#L119) removes entries absent from that list and resets included ones to IDLE at line 142. | An inactive worker is **removed**, not preserved as DRAINING, at current startup. A Redis-only drain does not survive startup; DB `isActive=false` does. Reservation rebuilding must precede any IDLE exposure. |
| [`registry.ts:106`](../../../apps/dispatcher/src/worker/registry.ts#L105) prevents an ordinary release from changing DRAINING back to IDLE. | Admin inactivity can let currently executing work finish without reopening admission. The 5s cached cap in [`consumer.ts`](../../../apps/dispatcher/src/stream/consumer.ts#L92) eventually becomes zero only if **all workers counted by that shared cap** are drained. |
| [`workers.routes.ts:422`](../../../apps/api/src/modules/admin/workers.routes.ts#L422) sets DRAINING on inactivity; reactivation changes an **existing** Redis entry only. [`syncToRedis`](../../../apps/api/src/modules/admin/workers.routes.ts#L84), called when `allowedJobTypes` is present at line 415, can restore a missing entry. | For phases before reservation-aware startup, reactivate through the existing admin PATCH with `isActive:true` **and the unchanged allowedJobTypes value**. The server supplies URL/key from its DB row; operators must not copy credentials. A bare activity toggle after startup can leave the worker absent forever. |
| [`workers.routes.ts:618`](../../../apps/api/src/modules/admin/workers.routes.ts#L618) has a separate Redis-only drain/undrain endpoint. | Do not substitute that endpoint for persistent inactivity in the approved first-rollout procedure. |
| [`processor.ts:228`](../../../apps/dispatcher/src/job/processor.ts#L227) treats in-progress redelivery as a crash; [`recovery.ts`](../../../apps/dispatcher/src/stream/recovery.ts#L22) invokes processing outside lane accounting. | Adoption and the redelivery classifier are one complete release. Faster claiming must wait until that release is present. |
| [`state.ts:56`](../../../apps/dispatcher/src/job/state.ts#L56) has no QUEUED acquisition CAS; nine processor PREPROCESSING calls ignore its boolean. One, [`processor.ts:1115`](../../../apps/dispatcher/src/job/processor.ts#L1115), belongs to PixVerse. | There are **eight paid-Comfy PREPROCESSING sites**, plus the mannequin phase within an already-owned job. Put acquisition before those branches and remove their independent transitions. The ninth processor call remains on the deferred video path; covering all nine Comfy submissions does not mean adding PixVerse recovery. |
| [`registry.ts:48`](../../../apps/dispatcher/src/worker/registry.ts#L48) releases any BUSY worker; startup clears ownership. | Token-safe releases and rebuild must ship before adoption can be enabled. |
| [`processor.ts:136`](../../../apps/dispatcher/src/job/processor.ts#L136) sleeps 10s, then separately XADDs/XACKs; generic retry does likewise at line 3810. | Fix transport handoffs in phase F; retain the backoff and promotion policy. |
| [`sweeper.ts`](../../../apps/dispatcher/src/stream/sweeper.ts#L33) uses a 15-minute age; [`index.ts`](../../../apps/dispatcher/src/index.ts#L163) schedules it every 5m. | Ownership needs a live-lease guard immediately, not several phases later. Adoption-aware terminal decisions replace the age-only behavior when adoption ships. |
| [`finalize.ts`](../../../apps/dispatcher/src/workflow/finalize.ts#L114) and [widget finalization](../../../apps/dispatcher/src/job/processor.ts#L3158) PUT predictable keys before output/status commit. [`r2.ts:35`](../../../packages/storage/src/r2.ts#L35) permits 60s requests; [`StorageProvider`](../../../packages/storage/src/index.ts#L14) exposes no per-call abort argument. | Keep existing keys in 2a and guard each new PUT with a fresh DB lease check. Do not describe that check as fencing a storage request already in flight. |
| [`saree-step2-promoter.ts:122`](../../../apps/dispatcher/src/job/saree-step2-promoter.ts#L122) guesses `keys.output(mannequinJobId)`; [comparison cleanup](../../../apps/dispatcher/src/workflow/comparison-finalize.ts) enumerates known output forms. | Keeping output keys unchanged removes the need to touch the promoter, routing, erasure, export and cleanup for this change. Their redesign remains deferred. |
| [`client.ts:147`](../../../apps/dispatcher/src/comfyui/client.ts#L147) uploads inputs with `overwrite=true`. | Recovery must use immutable per-attempt/content filenames: a late upload cannot overwrite the replacement prompt's input. This needs no worker change. |
| [`mannequin-phase.ts:140`](../../../apps/dispatcher/src/job/mannequin-phase.ts#L140) and several processor COMFY_DISPATCH events store the patched workflow as `payload.prompt`; [`processor.ts:1957`](../../../apps/dispatcher/src/job/processor.ts#L1957) does not include that field on the fabric path. | The attempt contract duplicates workflow data on paths already recording it. Measure actual bytes by path/job instead of assuming every event contains a second full copy. Preserve current event shapes in A, apart from correlation fields. |

The original analysis records the read-only production incident and verified 30-minute claim configuration. This planning task makes no new assertion about that job's current state or worker configuration.

### Remaining implementation choices

The approved customer/shutdown/rollout policies above are fixed. These smaller engineering choices determine how to implement them:

| Choice | Developer cost/benefit | User cost/benefit | Recommendation |
| --- | --- | --- | --- |
| Ownership columns on jobs vs one control table vs separate session table | Jobs columns reduce joins but spread internal authority into a broad public model; one control row isolates locks; another session table adds lifecycle/migration surface. | Equivalent fencing when implemented correctly; more moving parts increase rollout risk. | One control table plus attempts; row-level retirement and DB leases avoid a session table. |
| Redis token plus attempt rebuild vs DB reservation table | Redis reuse is smaller but requires fail-closed startup/reset handling and one active dispatcher; DB reservation rows add locking and cross-store coordination. | Both protect supported paid work; DB reservations become useful for future concurrent dispatchers. | Redis token mirror, given the explicitly supported single process. |
| Split B1/B2 vs combined ownership/settlement | Split adds a release and narrow ownership-check plumbing in existing transactions, but isolates changes to payer arithmetic and settlement boundaries in B2; combined is fewer releases with a larger money review. | Same final behavior; split reduces the size of each credit-risk review at the cost of another quiet-time drain. | B1 ownership/guards/yield, then B2 settlement consolidation before adoption. |

## 3. Small durable model: two tables

Create through a normal Drizzle migration, using the next available migration number at implementation time. Do not generate or edit production schema directly. Export through the existing `@aivastra/db` schema convention.

### `dispatcher_job_control` — one row per paid Comfy job

| Column | Why it is needed |
| --- | --- |
| `job_id uuid PK/FK jobs` | A single lock/acquisition point, including retries and duplicate deliveries. |
| `owner_session uuid NULL` | Random process incarnation that currently owns this job. A hostname is diagnostic, not authority. |
| `generation bigint NOT NULL DEFAULT 0` | Monotonically fences former owners; increment on acquisition/takeover/new retry authority. Never reset because `jobs.attempts` was reset. |
| `lease_until timestamptz NULL` | Postgres-time expiry. Proposed renewal every 5s, duration 30s. No Redis TTL makes a live DB owner dead. |
| `owner_retired boolean NOT NULL DEFAULT false` | Clean shutdown/yield makes work immediately eligible, without waiting for lease expiry. Reset only on a successful acquisition. |
| `active_attempt_id uuid NULL` | Identifies the only phase attempt allowed to publish. Old unknown attempts cannot win after a new attempt begins. Validate job identity on every pointer update. |

No separate instance table: retire this session's owned rows in one bounded update. A Redis per-session heartbeat/retired marker, with a proposed 30s TTL, is only a transport hint for **claimed-but-unstarted entries with no control row yet**. If it disappears early, DB acquisition still prevents stealing a valid owner; no external work is allowed before acquiring the control row. Unique consumer names are `<boot-session-uuid>:gpu` and `:inhouse`.

### `execution_attempts` — one record per actual phase submission attempt

| Column/group | Why it is needed |
| --- | --- |
| `id uuid PK`; `job_id uuid NULL`; `request_id uuid NULL` | Paid job or classify request; CHECK exactly one parent kind. Classify needs intent recording for the “all submit paths” requirement, not a synthetic charged job/control row. |
| `attempt_no integer`; `phase text`; `client_id text UNIQUE` | Monotonic per-job attempt sequence assigned under its lock, plus explicit main/mannequin/classify phase. Unique `(job_id,attempt_no,phase)` and equivalent request constraint. Sequence never derives solely from resettable `jobs.attempts`. |
| `state text` | PREPARING, SUBMITTING, ACCEPTED, OUTPUT_READY, SUCCEEDED, FAILED or UNKNOWN_RETRIED. Distinguishes “no request could have been sent” from ambiguity. |
| `worker_id text NULL`; `worker_url text NULL` | Rebuild the reservation and contact the original worker. No copied API key. Endpoint must match an approved existing worker configuration; removal/rotation is reported, never solved by sending a secret to an arbitrary URL. |
| `prompt_id text NULL` | Receipt after acceptance or discovery. Adoption reuses it; never POST the same SUBMITTING attempt again. |
| `uncertain_deadline timestamptz NULL` | Persist the first bounded-check deadline; restarts must not reset it indefinitely. Default 90s, allowed 60–120s. |
| `contract jsonb NOT NULL` | Versioned frozen workflow/version reference, input identities/uploaded filenames, result-node selection, finalizer kind, compression/watermark policy and mannequin continuation needed to resume this phase. May record the existing output keys/hash/type/length to verify or repeat finalization; no new output-key layout. Not a generic effects/outbox document. |
| `created_at`, `updated_at`, `resolved_at` | Auditing, bounded search, retention and distinguishing active reservations from history. `resolved_at` means remote work is resolved or deliberately yielded by the approved uncertainty policy; a business failure alone does not prove the GPU is idle. |

Index paid unresolved attempts by worker and job; index control lease/retirement for bounded recovery scans. The enum/check and required contract fields must reject an ACCEPTED record without a prompt ID. A control/attempt join must verify the pointer belongs to that same job.

**No DB reservation table, outbox, refund table or session table in 2a.** Original billing stays in jobs/ledgers. From B2, all 2a terminal helpers lock the job/control row and check all existing terminal refund reasons before inserting a ledger row; per-reason uniqueness is supplemental protection, not the only double-refund guard. B1 adds ownership checks to existing transactions without claiming to close their pre-existing split-settlement gaps.

### Common interfaces to define, not implement in this task

- `acquireComfyJob(jobId, session, delivery): Acquired<OwnerToken> | LiveOwner | Terminal | Recoverable` — one transaction; QUEUED CAS and control lease check both required, even when a sleeping no-worker job is QUEUED.
- `OwnerToken = { jobId, session, generation, attemptId? }`; owned processor status/attempt/terminal/refund mutations validate it plus expected current state. A terminal CANCELLED/COMPLETED row cannot be overwritten by an old owner. C's reservation maintenance has one narrow diagnostic exception: fill a missing receipt/deadline under the attempt-row lock after verifying immutable client/worker identity and current service/reservation identity. It cannot change attempt/business state, job ownership/generation, active pointer, retry budget or money, and does not impersonate the dead owner.
- `submitRecordedPhase(owner, phaseContract): Receipt | Uncertain` — creates/updates SUBMITTING and a `COMFY_SUBMIT_STARTED` audit record **in the pre-request transaction**, then makes one HTTP POST and records the receipt/COMFY_DISPATCH. No fetch retry repeats the same intent.
- `resumeComfyAttempt(owner, attempt): observed/finalized/uncertain/retry-required` — never calls fresh submission for a SUBMITTING/ACCEPTED attempt.
- `settleComfyJob(owner, completedOutput | terminalFailure): won/lost` — status, output row/audit and refund if needed in one transaction. SSE/webhook remain existing post-commit effects.
- `yieldComfyJob(owner, retryPatch): yielded/lost` — fenced transaction changes retry/status metadata and retires authority before any replacement message is published. Introduced in B1, reused by F.
- `assertStorageWriteLease(owner, minimumRemainingMs): authorized/lost` — immediately before each paid output/thumbnail PUT, validate session, generation, active attempt, nonterminal job and remaining DB lease; DB errors or insufficient time prohibit starting the PUT. Introduced in D; no storage-interface or key-layout change.

Use deterministic client IDs such as `av:<jobId>:<attempt_no>:<phase>` and `av:classify:<requestId>:<attempt_no>`; classify currently uses the request ID alone. Allocate the sequence under the job row lock (classify: request-scoped transaction lock), with the unique constraint as a backstop. No new UUID library is needed. IDs are not credentials. Adoption keeps the same attempt/client ID; a retry always allocates a new attempt sequence. Classify uses structured request logs/attempt rows, not a fabricated job_events parent.

## 4. Runtime rules and accepted limits

### Redelivery, retries and financial settlement

| State | 2a decision |
| --- | --- |
| Live unretired DB lease | No processing, status change, attempt increment or refund. Do not ACK the canonical live delivery. |
| Retired/expired, known prompt | Acquire a new generation; restore its worker reservation/lane occupancy; observe and finalize the same phase attempt. Preserve started_at and original execution budget. |
| Retired/expired, SUBMITTING with no known prompt | Search exact worker queue and retained history for persisted client ID until the persisted deadline. Adopt a match immediately. Search history again around queue/history transitions; a truncated page is not absence. |
| Uncertain deadline reached without a match | Mark old attempt UNKNOWN_RETRIED, increment the existing job failure budget exactly once, and allocate a new attempt if below `MAX_ATTEMPTS=2`. Read failures are recorded distinctly from verified absence but do not extend the approved bounded policy indefinitely. A later old receipt/output is recorded diagnostically and cannot publish. |
| Before submission | Resume/restart preparation after acquiring ownership; there was no committed intent permitting a prior POST. |
| Terminal or retry budget exhausted | Terminal replay only ACKs/finishes existing cleanup. Exhaustion settles FAILED and one transactional refund to the correct original account; no new charge. |

`jobs.attempts` remains the whole job's failure budget, including uncertain failures in a compound mannequin/final pipeline. It is not the attempt sequence, Redis delivery count, no-worker retryCount or owner generation. A successful mannequin is checkpointed and reused; a final-phase retry must not rerun a completed mannequin unnecessarily.

For a known accepted prompt, preserve its original execution deadline in the frozen contract. At that deadline, do a final queue/history reconciliation; a successful prompt goes to finalization, a confirmed failure or missing/lost prompt goes through the existing counted retry/exhaustion policy under the fence. Do not turn owner death into a new timeout budget or retain a reservation indefinitely because a prompt is absent. Temporary observation/download errors are retried within the applicable existing bounds before settlement.

The bounded policy permits an old delayed submission to execute after a new attempt begins, including possible temporary worker contention. That is the approved cost. Only the active attempt and current generation may select/publish a result. No POST is intentionally repeated within one attempt; a replacement has a new client ID and consumes budget. Known accepted prompt adoption does not consume an attempt.

### Minimal worker reservation choice

Choose a **Redis reservation token plus rebuild from Postgres** for the supported single-dispatcher topology:

1. Allocate the PREPARING attempt/control pointer before selecting a worker. Token identity includes attempt ID, owner generation and session.
2. The atomic worker-claim Lua stores that token in a separate `worker:reservations` hash and marks the registry entry BUSY. It rejects an existing token even if an admin status update says IDLE. Keeping the token outside the registry JSON prevents existing admin read/modify/write operations from erasing it. Persist worker ID/URL on the attempt under the fence **before any upload/POST**. A crash between provisional Lua claim and that DB write has no remote execution to adopt; clear only its matching provisional token on rebuild.
3. All release paths require the expected token, including probe rejection, exception and `finally` paths. A paid owner release additionally requires current DB authority and evidence that no submission happened, remote work ended, or the approved bounded uncertainty policy yielded that reservation. A SUBMITTING/ACCEPTED exception must retain the reservation for reconciliation, not unconditionally release in `finally`. C's mandatory reconciler may release a dead owner's matching token after proving that exact prompt ended, or after its persisted bounded deadline plus successful client-absence checks in queue and subsequent history. It may persist a diagnostic receipt/deadline but cannot change the job, refund, publish or start a replacement attempt. It validates the current service session, attempt identity and unchanged reservation token, rather than impersonating the dead owner. Retain DRAINING on release. A late old owner cannot release an adopted token; the bounded-absence path explicitly retains the delayed-acceptance overlap risk documented in C.
4. Startup disables fresh admission, reads active paid attempts, and reconstructs reservations before any worker is exposed as IDLE. Here active includes unresolved remote work even if its parent job is now terminal or its active-attempt pointer changed; a terminal DB status alone is not evidence that the GPU stopped. Include inactive DB workers with active attempts for observation, but keep them DRAINING and excluded from admission. Prefer retaining other inactive entries as DRAINING too, so normal admin reactivation works after phase C.
5. A Redis reset/missing active-session/registry marker closes fresh admission until rebuild finishes. Fail closed on DB/Redis errors. Old queued claim/release commands carry a session/token check and cannot mutate the new mirror. An active-session Redis guard rejects an accidental second current dispatcher; 2a does not implement a multi-replica election protocol.

A third DB table is not needed because active paid attempts already identify worker and execution, Redis serializes current claims, and replacement bootstrap runs before new admission. A future multi-dispatcher design must add stronger cross-instance worker reservation coordination rather than assume each replica can independently rebuild this mirror.

After a bounded uncertain search permits a retry, the old reservation may be yielded conditionally; the new attempt gets a different token. This is the explicit exception to guaranteed physical exclusivity caused by the approved duplicate-GPU policy, not permission for a stale release to free the new token. Keep its old client/prompt reference for diagnostics.

Classify must pass a transient returned token through release so it cannot free a paid job's token; its **durable reservation rebuilding/reconciliation is deferred**, even though intent is recorded. Its early ACK can still leave untracked remote work after a crash. Do not count classify intent rows as paid reservations at boot.

Do not rename/delete/repoint a worker with an unresolved paid attempt during the rollout. Recovery quarantines a mismatched identity/endpoint instead of silently using a different GPU. This is an operating restriction, not a claim that all existing admin lifecycle operations have been redesigned.

### Output publication keeps the current storage layout

Keep the existing `keys.output`, `keys.outputThumb` and widget output keys. No per-attempt or generation-scoped output keys, shared key-builder changes, promoter edits, storage routing changes, or erasure/export/cleanup changes are part of 2a. The winning current generation/active attempt alone may commit `job_outputs` and COMPLETED. A resumed finalizer reads the same prompt result and uses the recorded compression/watermark contract, including the resolved effective settings, so configuration changes do not intentionally produce different bytes on adoption.

Immediately before **each** output and thumbnail PUT, call `assertStorageWriteLease` after encoding or any other lengthy work. Proposed minimum remaining lease: 10s within the 30s lease, measured using DB time and subtracting elapsed monotonic time since the check; renew under the same fence and recheck if needed. No intervening network/encoding work is allowed before starting PUT. An expired/retired/wrong-generation owner, terminal job, changed active attempt or unavailable DB aborts before storage. A lost-ownership error must escape the thumbnail's existing best-effort catch too; it cannot be converted into successful completion without a thumbnail. Recheck authority in the final DB transaction as usual.

This implements the reviewed single-dispatcher tradeoff. Normal replacement ends the old process within the short shutdown bound; adoption reuses the same attempt/prompt/result, while a new uncertain retry occurs after the previous owner has gone. **Assumption:** frozen same-attempt finalization produces equivalent bytes and there is no concurrently active old process performing a different attempt's finalization. Per-attempt input filenames remain required because a late worker-side upload could otherwise replace an input.

The guard is authorization to **start** a write, not a hard storage fence or a guarantee that PUT finishes within 10s. The current provider allows 60s requests and has no per-call cancellation option; SDK/server completion after lease loss cannot be ruled out by a preflight SELECT. A pause immediately after authorization is also a residual window. These limitations are explicit: 2a does not claim protection against every partition/frozen-owner/in-flight-store race. Revisit generation-scoped output keys and stronger storage fencing with multi-dispatcher support; do not silently restore the removed storage-layout work in D.

After a crash between PUT and COMPLETED, verify/reuse the existing object against recorded expected content, or repeat download/encoding/PUT from the same known prompt under the new lease. HEAD lacks a checksum; use GET/hash when content verification is needed. Do not rerun the GPU just because finalization was interrupted. Tests must distinguish a stale owner rejected **before** PUT from an already-issued PUT completing; the latter is not proof that the guard provides storage-level fencing.

## 5. Deployment phases and why this order is safe

Reorder the suggested reservation/adoption steps: **A intent → B1 ownership → B2 settlement → C reservations → D adoption → E short shutdown/fast takeover → F handoff**. Adoption cannot safely precede tokenized release and BUSY rebuilding. Move the minimum live-lease guards into B1, consolidate settlement in B2, and move adoption-aware sweeper decisions into D, rather than leaving an unsafe intermediate release until E.

“Safe alone” means each phase is a complete, runnable release that does not depend on unshipped code for its new behavior. It does not mean phase A already fixes every old crash defect. The remaining legacy failure/notification risks are explicit below. Do not enable faster recovery or deliberately test paid production crashes before D and E have shipped.

### Phase A — additive schema and complete submission intent

**Complete unit:** one migration, schema/export changes, a small recorded-submission helper and every submit caller. Normal processing, retry, recovery and shutdown behavior otherwise stay as they are.

**Files:** create `packages/db/src/schema/dispatcher-execution.ts` and `apps/dispatcher/src/job/submission.ts`; modify the DB schema export, normal migration/journal, `job/processor.ts` (eight submits), `job/mannequin-phase.ts`, `classify/process.ts`; add `test/integration/submission-intent.test.ts` and persistent fake-worker helper support. Migration number assigned at implementation time, not guessed here.

**Steps:**
- [ ] **Step 1:** Write tests proving a SUBMITTING row/client ID exists when the fake worker receives POST; failing the DB transaction produces **zero** POSTs. Parameterize all nine paid submits plus classify. Assert request workflow/output policy is unchanged.
- [ ] **Step 2:** Implement deterministic sequence/client allocation and intent commit, then record prompt ID and the existing COMFY_DISPATCH event afterward. An accepted response lost before recording leaves SUBMITTING, not a fabricated rejection receipt. Contract fields distinguish main/mannequin and capture continuation/result selection. Instrument existing success/failure exits to resolve attempt rows; recording must not change the legacy business decision. Persist the patched prompt and resolved inputs, not just a mutable template ID.
- [ ] **Step 3:** Measure the added pre-submit transaction separately with a structured timing stage (`submit_intent_commit`) and attempt/client correlation, without logging workflow contents or credentials. Compare matched staging enqueue → consume, consume → worker claim and claim → submit samples before/after, recording sample count and p50/p95 for the new transaction. The review's 5–10ms estimate is a hypothesis, not a measurement or an automatic pass. Report actual overhead and investigate material regression before promotion; preserve workflow/output policy and existing submission behavior apart from durable intent/client correlation.
- [ ] **Step 4:** Record per-job contract bytes and duplicated COMFY_DISPATCH workflow bytes using the read-only size query below, with counts/mean/p95/max and schema/index storage growth. Keep the existing event payload for compatibility in A; no deduplication/retention redesign is bundled into this phase.
- [ ] **Step 5:** Run focused tests, dispatcher suites, DB build/migration checks and typechecking. Commit the whole migration/helper/caller/test/measurement unit only after passing.

**Fixes alone:** durable evidence for future recovery and no network submit without intent. **Must not break:** credit deduction, normal images, existing retry budget or classify's early-ACK/response contract. It deliberately retains today's crash policy; it does not claim adoption yet.

**Staging → production:** use the approved drain procedure below for the first transition. Staging checks intent-before-POST, lost response with the fake worker, measured pre-submit overhead and per-job storage cost. Production checks every new accepted paid prompt has a corresponding row/correlation, no new submission errors, timing/size consistent with staging, and **every previously active drained worker restored in the registry** after the reactivation PATCH. Do not apply new-table queries before CI migration verification passes. Estimated **7–10 files, 1–1.5 engineering days**, excluding review/deploy observation. Phase A implementation starts only after this revised plan is confirmed; no later phase is authorized by confirming/implementing A.

### Phase B1 — common acquisition, leases and ownership guards

**Complete unit:** common paid-Comfy acquisition, renewal, live-owner no-op, sweeper ownership guards and retry yield. Existing payer/refund algorithms remain in their current helpers. B1 must be deployable before B2; adoption and fast takeover remain disabled.

**Files:** create `job/ownership.ts`; modify `processor.ts`, `job/state.ts`, `workflow/finalize.ts`, `job/mannequin-phase.ts`, `stream/recovery.ts`, `stream/sweeper.ts`, `index.ts`; add `test/integration/ownership.test.ts`. Existing refund transactions receive only token/row-lock checks and typed lost-ownership propagation, not a rewrite of payer selection, amounts, ledger reasons or transaction boundaries.

**Steps:**
- [ ] **Step 1:** Write real-DB races for duplicate deliveries across all eight paid-Comfy PREPROCESSING paths plus mannequin continuation, expired generation callbacks, live-owner recovery/sweeper and an immediately consumed retry replacement. Only the acquisition winner may upload/POST. Verify PixVerse retains its existing contract.
- [ ] **Step 2:** Implement `acquireComfyJob` before paid branching and remove independent Comfy PREPROCESSING writes. Separate provider classification from the early in-progress check. Require current tokens for status/output/attempt mutations. Renewal uses DB time and cannot revive an expired/retired owner.
- [ ] **Step 3:** Add a narrow `assertOwnerInTransaction(tx, owner)` check under control/job row locks at the start of **each existing** dispatcher/sweeper refund transaction, plus the corresponding status transaction. Recheck terminal job state. An outside-the-transaction precheck is insufficient. Preserve the existing financial SQL and fail closed when authority is lost. When the legacy sweeper/recovery handles an expired owned job, it must acquire a fresh generation first; it may not supply the dead owner's token or refund a live owner. For ownerless legacy rows, acquire control before any mutation.
- [ ] **Step 4:** Live-owner redelivery is a no-op; the sweeper skips live leases. Keep the slow recovery cadence/legacy dead-owner failure policy until D. B1 does **not** claim to fix existing merchant/Shopify/sweeper refund-then-status crash gaps; B2 closes those before adoption is enabled.
- [ ] **Step 5:** Both retry paths call `yieldComfyJob` before their existing XADD/XACK sequence. Keep renewal during the no-worker 10s sleep, then retire authority before publishing. A replacement consumed immediately must acquire successfully. Handoff transport atomicity remains F.
- [ ] **Step 6:** Run focused/full dispatcher suites and existing payer/cancellation regressions. Commit acquisition, all guard callers, yield and tests together; never commit common CAS without its callers.

**Fixes alone:** duplicate acquisition, stale-generation mutations and live jobs attacked by recovery/sweeping. **Must not break:** current payer selection/amounts, transaction behavior, refunds on ordinary failure, API terminal cancellation, video, retry visibility or no-worker backoff. Existing split-refund gaps and abandoned-prompt recovery remain explicit legacy limitations until B2/D; no partial settlement rewrite is presented as complete.

**Staging → production:** fake duplicate/live lease, expiry during status/refund callbacks and immediate retry consumption; run all three payer happy/failure fixtures without changing expected balances. Production verifies one owner, renewal, live-lease skips and unchanged ledger amounts on the release cohort. Use admin drain; no induced production crash. Estimated **9–12 files, 1–1.5 days**.

### Phase B2 — fenced terminal/refund transaction

**Complete unit:** consolidate completion/terminal settlement and all three payer families behind `settleComfyJob`, using B1's transaction-level owner guard. This is the only phase that rewrites refund algorithms and combines their settlement boundaries.

**Files:** create `job/settlement.ts`; modify `processor.ts`, `job/state.ts`, `workflow/finalize.ts`, `stream/sweeper.ts`, ownership helper as needed; add `test/integration/fenced-settlement.test.ts` and relevant API cancellation/refund fixtures. No schema change beyond A and no cancellation contract redesign.

**Steps:**
- [ ] **Step 1:** Test user, merchant-owning-user and Shopify-store failure/refund, zero cost, completion versus cancellation/failure, a stale generation, duplicate terminal calls with different refund reasons, and process death between ledger/balance/status writes. Assert an all-or-nothing transaction and at most the original debit returned.
- [ ] **Step 2:** Move status, terminal event, selected output and refund ledger/balance writes into the shared fenced transaction. Lock control/job in the same order as B1, validate current generation/active attempt and terminal state, resolve the original payer and check **all** terminal refund reasons. Preserve zero-cost behavior and store cap cleanup semantics; do not re-charge on a retry.
- [ ] **Step 3:** Route dispatcher and sweeper settlement through that helper; keep SSE/webhook/cap effects in their existing post-commit contracts. A lost owner performs no terminal effect. Existing API cancellation can win first and must not be overwritten or refunded twice.
- [ ] **Step 4:** Run focused/full dispatcher suites and relevant existing API integrations, then commit shared helper, every affected caller and tests as one unit. Do not ship an unused helper while old refund callers remain active.

**Fixes alone:** closes the existing split monetary/status crash gaps in the owned dispatcher/sweeper paths and cross-reason duplicate refund risk. **Must not break:** B1 acquisition/lease/yield, payer routing, successful images, merchant/store credit balances or zero-cost jobs. Adoption and fast recovery remain off; the legacy dead-owner failure behavior still exists until D.

**Staging → production:** actual child SIGTERM/SIGKILL around each settlement boundary with each payer fixture; check committed state/ledger after restart and stale callbacks. Production reads the settled cohort's statuses/debits/refunds and confirms no duplicate ledger/balance movement. Quiet/admin-drained deployment, then verification before C. Estimated **6–9 files, 1–1.5 days**.

### Phase C — token-safe reservations, startup rebuild and receipt discovery

**Complete unit:** claim/release token propagation at every worker caller, startup reconstruction from paid attempts and mandatory scheduled reservation cleanup, including SUBMITTING attempts with no prompt ID. Discovery changes only reservation bookkeeping, a persisted search deadline and diagnostic receipt; no adoption, finalization, job status change, refund, failure-budget increment, new attempt or POST. The job's outcome stays on the legacy policy until D.

**Files:** create `worker/reservation-reconciler.ts` and **`comfyui/reconcile.ts`** here; modify `worker/registry.ts`, `worker/selector.ts`, `index.ts`, `env.ts`, `processor.ts`, `job/mannequin-phase.ts`, `classify/process.ts`, submission/ownership helpers and `packages/observability/src/metrics.ts`; add `test/integration/worker-reservation-rebuild.test.ts` and `test/integration/reservation-receipt-discovery.test.ts` using the persistent fake-worker/child-process harness; update affected registry/selector tests. Add `COMFY_UNCERTAIN_CHECK_MS` in **C**, default **90000**, allowed **60000–120000**; D consumes it unchanged. No schema beyond A: reuse `uncertain_deadline`, `client_id`, worker identity and nullable `prompt_id`. A transient classify token remains API compatibility only, not classify recovery.

**Read-only adapter:** `findPromptByClientId(worker, clientId, deadline): FoundReceipt | NotFound | Unavailable`, implemented in `comfyui/reconcile.ts`. FoundReceipt includes the exact prompt ID and queued/running/succeeded/failed observation; NotFound includes whether no entry in either queue list matches the persisted client ID, after a fresh successful fully parsed queue read and a successful history read was completed **after** that queue snapshot. Unavailable covers failed, unreachable, malformed, truncated/unverifiable or ambiguous results; it never counts as absence. Search exact persisted client identity in raw queue/history metadata; existing `fetchPromptOutcome` requires a known prompt ID and is insufficient for discovery. Each tick performs bounded observations rather than blocking the entire cleanup loop for 90s. Validate the adapter on staging against actual deployed workers' queue/history shapes and retained `client_id` metadata before promotion; do not infer that shape from the fake or current client helper. Complete history discovery/retention remains an explicit assumption, with uncertainty handled below.

**Steps:**
- [ ] **Step 1:** Write the existing late-release/token, provisional-claim crash, Redis-rebuild, DRAINING and admin reactivation races. Add lost-response tests with a real child SIGKILL after the fake worker receives `/prompt` and before any receipt is recorded: found finished → release; found failed → release; found running/queued → hold, then release after completion; never accepted → release only after the persisted deadline with confirmed absence of that client in the queue. Assert no business state, ledger, attempts budget, new POST or output publication changes from cleanup.
- [ ] **Step 2:** Allocate PREPARING attempt before selection, persist worker identity before uploads, and implement token-checked releases against the separate reservation hash. All probe/exception/finally paths honor token/authority checks. An admin status edit must not make an existing reservation claimable. Preserve inactivity and current job/credit behavior.
- [ ] **Step 3:** Load active/inactive configuration and unresolved paid attempts before opening admission; reconstruct BUSY/DRAINING and reconcile immediately at boot. Missing Redis/session state closes fresh admission until rebuild. Start `reconcileWorkerReservations` every **10s** in bounded nonoverlapping batches, independently of 30-minute job recovery. Known prompt IDs still use exact queue/history observations: confirmed completion/failure releases only the matching token; running/queued work remains held.
- [ ] **Step 4:** For a dead/retired owner's SUBMITTING attempt without a prompt ID, initialize `uncertain_deadline` once under an attempt-row lock using DB time plus `COMFY_UNCERTAIN_CHECK_MS` if NULL; thereafter preserve it across ticks/restarts. Use `findPromptByClientId` with the persisted worker/client/deadline. Do not classify a live owner's submission as abandoned or release it by the bounded-absence rule. Revalidate attempt/worker identity and the reservation token after network reads.
- [ ] **Step 5:** If found, atomically record the discovered prompt ID and a `COMFY_RECEIPT_DISCOVERED` audit event as a **diagnostic receipt**. Lock the attempt row; fill a missing receipt only, accept an identical existing receipt without another event, and hold/alert on a conflicting receipt. Preserve existing attempt/business state and job ownership; this is not acquisition or adoption. Record correlation (attempt/client/phase/worker), not credentials or full workflow. Found succeeded/failed → conditionally release the exact reservation, retaining DRAINING; found queued/running → retain it and let normal cleanup release when it ends. A receipt discovered in C remains available for D to adopt later, even if C already released its token.
- [ ] **Step 6:** If not found, release only after **all** conditions hold: the persisted deadline has passed; no entry in `queue_running` or `queue_pending` matches the persisted `client_id`, from a fresh, successful, fully parsed queue read; history is successfully read again **after that queue read** and contains no matching client; no read used for that absence decision failed or was malformed/incomplete; the exact reservation token still matches. Search history on each check so a queue-to-history transition can be found. A matching client entry, failed/unreachable worker or malformed response keeps the reservation. Foreign clients in the queue do not block release once every other condition holds. Earlier failed rounds do not reset the deadline, but cannot authorize release: a subsequent complete successful client-absence queue/history sequence is required. No new attempt, retry-budget change, job settlement or POST follows this reservation-only release.
- [ ] **Step 7:** Test queue → history between reads, deadline surviving SIGKILL/restart, unreachable worker (held and alerted), malformed queue/history (held), foreign work in the queue does not block release once there is no matching client and the deadline has passed, token replacement during search (new token untouched), receipt persistence/event idempotency and delayed acceptance after a not-found release (diagnostic only, no publish). Use the persistent HTTP fake with real Redis/Postgres and actual child SIGKILL gates; do not simulate restart by rejecting a mocked promise. Run all lost-response variants from Step 1 with those services.
- [ ] **Step 8:** Emit structured cleanup outcomes and the worker-only metrics below. Alert at **120s** for unverifiable reads, a confirmed finished/failed prompt still holding its token, or an unresolved unknown-acceptance hold. Verify alert delivery through the normal authorized monitoring route before C is complete; an error log is not delivery evidence. Run focused/full suites plus activity/drain regressions and commit token callers, rebuild, adapter, scheduled cleanup, alert instrumentation and tests together. No CI workflow change.

**Fixes alone:** known finished/failed prompts release on schedule, and the lost-response gap no longer creates an automatic indefinite hold when the bounded search succeeds or valid client-absence evidence from queue and subsequent history is established. Discovered receipts survive for D. Unreachable/malformed/unverifiable workers remain held and alerted, never declared free by a failed read. **Must not break:** B1/B2 ownership/settlement, inactive workers/DRAINING, token safety, routing tags or existing job outcomes. C never adopts, finalizes, refunds or initiates a replacement attempt. Estimated **11–15 files, 1.75–2.5 days** (roughly 0.25–0.5 day moves here from D; overlapping files counted per phase).

**Staging → production:** first validate raw queue/history/client metadata against actual deployed workers using read-only requests; log only validation results/correlation, not payloads or secrets. With the persistent fake, SIGKILL at POST-before-receipt and verify each discovery/absence/error/race outcome, deadline persistence, diagnostic-only PG writes, unchanged charges/status, token replacement safety and 120s alert delivery. Confirm normal startup/Redis rebuild and inactive-worker reactivation. Production reads/observes scheduled 10s cleanup, discovered receipts, no-client-match-after-deadline release outcomes, still-running holds and unverifiable/unknown alerts; verify no new POST/refund/finalization is caused by cleanup. Use naturally occurring cases, not induced production failures or manual queue/data edits. If reads cannot verify a hold, investigate worker connectivity/response validation through existing operational checks and wait for valid evidence; do not manually free its token merely because 120s elapsed. Admin-drained deployment remains required.

**Cleanup interfaces/signals:** `reconcileWorkerReservations(cfg): Promise<void>` does reservation reconciliation and diagnostic receipt/deadline recording only. `startReservationReconciler(cfg): () => void` installs the nonoverlapping 10s schedule and returns its stop function. Keep `dispatcher_reservation_reconcile_stale_seconds`, `dispatcher_reservation_finished_hold_seconds` and `dispatcher_reservation_unknown_hold_seconds`, labeled by worker ID only. The unknown-hold gauge now measures a **still-held** token with no discovered receipt: healthy bounded search normally resolves it before 120s; a matching client entry or unverifiable evidence may keep it held beyond the deadline and must alert with that reason. Repeated failed reads/ticks must not reset the 120s age; reset/clear only after verified resolution, receipt classification or matching-token release. On found running work, clear the unknown-hold condition and track successful observation normally; it is not a reservation leak. The stale-read and finished-hold alerts remain independent. Reconcile at startup immediately, not after one full tick.

**Accepted bounded-search risk:** a delayed `/prompt` can be accepted after a not-found release. The worker is then considered free and that remote prompt may briefly overlap a new job. This is the same approved duplicate-GPU cost as D's bounded policy; the remote execution and C cleanup cannot add a customer charge or publish an output. A later receipt is diagnostic only in C. Any later cleanup for the old attempt still checks its old token and cannot release the new job's token. The old job's outcome stays with legacy handling until D; D, not C, starts any replacement attempt. Do not claim that a no-client-match queue snapshot prevents future delayed acceptance.

### Phase D — adoption, bounded uncertainty and adoption-aware sweeper

**Complete unit:** redelivery classification, reusable phase observer/finalizer, bounded uncertainty retry, pre-PUT lease guard and the minimum sweeper integration. It depends only on A, B1, B2 and C already deployed.

**Files:** create `job/adoption.ts`; reuse C's `comfyui/reconcile.ts` adapter and `COMFY_UNCERTAIN_CHECK_MS` unchanged; refactor common Comfy observe/finalize continuations from `processor.ts`/`mannequin-phase.ts`; modify recovery/loop scheduler interfaces, ownership/state/settlement, existing finalizers and input-name generation; add `adoption.test.ts`, `uncertain-submission.test.ts`, `storage-write-lease.test.ts`. No output-key/storage-provider/promoter/cleanup/erasure/export/routing edits.

**Reconciliation interface:** reuse C's `findPromptByClientId(worker, clientId, deadline): FoundReceipt | NotFound | Unavailable` and staging-validated metadata parsing unchanged. Use receipts already discovered in C; do not clear or regenerate them. Retain an existing persisted deadline rather than starting a fresh window. D's approved retry decision remains distinct from C's conservative reservation-only successful client-absence release gate: unavailable/expired history still follows D's bounded retry policy, with a diagnostic distinction from verified absence. Adoption/finalization/retry are introduced only here, not in the shared read-only adapter.

**Steps:**
- [ ] **Step 1:** Write tests for running and finished prompt adoption, accepted POST with lost response/event, empty/unreadable history until deadline, restart during the check, multiple matching receipts, and main/mannequin continuation. The fake worker persists queue/history independently of child dispatcher lifetime.
- [ ] **Step 2:** Replace the in-progress crash branch with section 4's classifier. Use the common lease/generation acquisition. Adopt known prompts without POST or attempt increment. Preserve original execution timeout, result node and policy. Completing a mannequin phase records its SUCCEEDED checkpoint/artifact and atomically selects the next phase; it does not complete/refund the parent job. Recovery after that commit starts only the unfinished phase.
- [ ] **Step 3:** Reuse C's persisted uncertainty deadline, initializing it only if still NULL. A match or diagnostic receipt already recorded in C is adopted. Only if still unmatched at the deadline, atomically mark UNKNOWN_RETRIED, increment `jobs.attempts` once and fence out that old attempt. If budget remains, prepare a new client/attempt; otherwise transactionally fail/refund once. Never repeat the same SUBMITTING attempt. An old late success cannot select its output.
- [ ] **Step 4:** Recovery uses a common lane ticket/task entry rather than direct `processJob`. Restore accepted attempts' occupancy before any fresh read, including placeholders for attempts not yet eligible under the old recovery threshold. Observation may proceed with a recovery ticket when cap is zero or a worker is DRAINING, because the prompt already occupies that worker; cap prevents **new execution**, not observation of existing work. Bound observation work by the number of persisted attempts and a configurable I/O limit; do not claim unlimited pending jobs into memory. Before E, the old cadence/threshold controls when reconciliation starts, not whether known occupancy is counted.
- [ ] **Step 5:** The sweeper now routes expired paid jobs to this same reconciliation entry. Skip live leases; a successful history is finalized, not age-failed. Genuine terminal decisions acquire/recheck ownership in the same settlement transaction. Remove the paid-Comfy in-progress DISPATCHER_CRASH path; old behavior remains only on explicitly deferred providers.
- [ ] **Step 6:** Keep output keys unchanged. Implement `assertStorageWriteLease` immediately before each paid output/thumbnail PUT; stale/retired/insufficient lease or DB failure results in zero new PUTs. Test expiry after encoding and before PUT, delayed DB response, thumbnail lost-ownership propagation and fenced completion after lease loss. Adoption of the same attempt reuses its frozen output policy and recorded existing key; no GPU rerun for an interrupted storage write.
- [ ] **Step 7:** Use per-attempt/content-derived **input** filenames, retaining the worker's returned name in the contract. Test a delayed old upload after a replacement uploaded different bytes; neither prompt's inputs may change. No output layout compatibility work.
- [ ] **Step 8:** Run all new races and full suites, including existing comparison/saree regressions. Commit the complete adoption/guard/sweeper unit.

**Fixes alone:** a crashed accepted attempt can be adopted when the existing recovery scan reaches it; uncertainty is bounded and charged once; a stale owner cannot start a PUT after failing the lease check or commit selected output metadata. **Must not break:** lane isolation, existing output paths/bytes, cancellation terminal-state guard or correct zero/positive refunds. Recovery is still slow until E. The storage guard's residual in-flight/pause window is explicitly retained, not solved with a hidden key-layout change. Estimated **8–12 files, 1.25–1.5 days**; the adapter/metadata validation moved to C, not into an extra phase.

**Staging → production:** actual child SIGKILL during each failure-matrix phase, adopted running/finished output, stale owner blocked before storage and immutable input naming. Verify ordinary output URLs and existing comparison/saree behavior without layout changes. Check all payer ledgers. In production use a quiet/admin-drained rollout, verify no new paid in-progress DISPATCHER_CRASH decisions and inspect naturally adopted jobs; no manufactured production failures or data edits.

### Phase E — 0–5s shutdown and prompt takeover

**Complete unit:** track/yield owned Comfy tasks, retire session rows, unique consumer/session identity and recovery scheduling independent of the 30-minute threshold. Never reintroduce direct recovery processing.

**Files:** `index.ts`, `env.ts`, `stream/loop.ts`, GPU/in-house consumers, `stream/recovery.ts`, ownership/adoption helpers, dispatcher Compose entries; add `shutdown-takeover.test.ts` and child-process harness. Keep shared-loop video behavior unchanged and do not advertise video adoption.

**Steps:**
- [ ] **Step 1:** Spawn real old/new child processes around the persistent HTTP fake. SIGTERM and SIGKILL at every matrix boundary; assert no new claim after stop, 0–5s drain, retirement/expiry eligibility and same-attempt adoption. Test a claim whose response is lost after old session exit.
- [ ] **Step 2:** Stop claims/renewal acquisition first. Allow only already-started DB writes/PUTs up to configured drain. Hand off observation without business failure/refund; retire owned control rows and the Redis session marker, keep the original PEL, then close dependencies. Start no new PUT after retirement; callbacks fail their DB fence. An already-issued store request cannot be retracted by retirement, as documented above. No copy handback machinery is needed.
- [ ] **Step 3:** Recovery scans at startup and every 5s, in bounded nonoverlapping batches. Retired rows are immediately eligible; expired leases are eligible without 30 minutes of Redis idle. For PEL-only claims, unique session retirement/TTL is a hint and DB CAS is decisive. Use targeted XPENDING/XCLAIM, not blanket theft of live PELs based on idle age.
- [ ] **Step 4:** Rebuild occupancy and reservations before fresh admission. Explicitly configure a short container stop grace (proposed 10s) exceeding the maximum 5s application drain; do not introduce a 20/120s pickup outage. SIGKILL falls back to 30s lease expiry; after readiness a healthy retired takeover should be scheduled within one 5s tick.
- [ ] **Step 5:** Run signal/fault tests and full suites; commit shutdown, takeover and scheduler integration together.

**Fixes alone:** planned deploys stop abandoning paid Comfy work for 15–30 minutes; claimed-but-unstarted messages become promptly eligible. **Must not break:** new-message priority/pickup, zero-cap behavior or existing video/classify/webhook contracts. Those task families retain their explicitly deferred crash risks; do not silently change their ACK/retry semantics. Estimated **7–10 files, 1–1.5 days**.

**Staging → production:** verify real container SIGTERM grace/exit time as well as child tests, known-prompt adoption, late claim, expired owner, cap zero and unchanged legacy provider behavior. First E deployment still uses the previous binary's shutdown, so use the approved admin-drain procedure; only later deploys may rely on E's short drain/adoption.

### Phase F — conditional replacement-message handoff

**Complete unit:** one shared append-before-ACK Lua handoff and both no-worker/normal retry callers, preserving original fields. No new delayed queue or effects outbox.

**Files:** create `stream/handoff.ts`; modify retry helpers in `processor.ts` and ownership handoff boundary; add `test/integration/requeue-handoff.test.ts`. Keep 10s sleep and existing retry-promotion/stream selection rules.

**Steps:**
- [ ] **Step 1:** Test actual Redis append failure, lost success response, wrong pending owner, recovery racing handoff, unknown stream fields, missing userId, retryCount update and priority promotion/in-house exclusion. Assert a successful repeated script call appends no second replacement.
- [ ] **Step 2:** Reuse B1's `yieldComfyJob`: keep the lease alive during the 10s no-worker sleep, even though the DB public status is QUEUED, then retire/relinquish it **before** making the replacement visible. Otherwise a fast reader would classify the replacement as live-owned and postpone it until later recovery. A recovery race can claim the original; the script's expected-consumer check then returns a no-op.
- [ ] **Step 3:** Lua verifies the exact original is still pending under the caller, reads its original field/value array, applies only intentional overrides (e.g. retryCount), XADDs to the selected target, then XACKs the source. No ACK if append fails; no assumption of MULTI/Lua rollback. Partial append/ACK failure may leave duplicates, which B1's acquisition prevents from double-dispatching.
- [ ] **Step 4:** A crash after DB relinquishment but before the script leaves the original pending for recovery. A crash after successful script execution leaves the replacement. Redis transport counters need not count an uncompleted handoff as an extra failed execution; never spend MAX_ATTEMPTS for a no-worker handoff.
- [ ] **Step 5:** Run focused/full suites and commit script plus both callers/tests together.

**Fixes alone:** removes the normal XADD/XACK crash gap and avoids a replacement/lease race. **Must not break:** field fidelity, one billing charge, priority promotion or the existing 10s backoff/cap behavior. Estimated **3–5 files, 0.5–1 day**.

**Staging → production:** race old/new child handoff and inject Redis failures in staging; production observes existing no-worker retries and checks for orphaned QUEUED controls or duplicate processing, without changing queue contents manually.

Estimated total: **7.5–11 engineering days (roughly 8–11)**, with overlapping files counted per phase, plus reviewer/CI/staging/production observation time and the extra B1/B2 release. This is a rough planning estimate, not a delivery promise. Do not make a separate commit for one status call, one Lua line or a migration without its caller changes.

## 6. Failure matrix — completed 2a, paid Comfy paths only

All rows start with the one existing API charge. “Retry” below means a new counted attempt, not a second charge. SSE/webhook delivery durability is explicitly deferred.

| Crash/SIGTERM boundary | Job and Redis message | Credits | Shopper/result |
| --- | --- | --- | --- |
| Before claim | QUEUED/unread; next eligible owner acquires normally. | Original charge only. | Short deploy pickup interruption. |
| After claim, before PREPROCESSING | Original PEL survives. Retired session/TTL permits targeted claim; DB CAS admits one owner. No external work preceded acquisition. | No new charge/refund. | Prompt pickup after readiness/lease eligibility and available capacity. |
| During input upload | PREPARING/owned control; resume/restart preparation with frozen identity. PEL transfers through recovery lane ticket. | Held; process death consumes no failure attempt. | No false DISPATCHER_CRASH. Changed/missing inputs before any accepted intent can still cause a genuine transactional failure/refund. |
| After accepted POST, before receipt/event | Durable SUBMITTING/client ID remains; search until persisted 60–120s deadline. Found → adopt; no match → counted new attempt or exhaustion settlement. | No second debit; one refund on exhaustion. | Original result if found; otherwise a replacement may run. Duplicate GPU cost is accepted, but old attempt cannot publish after replacement becomes active. |
| During GPU execution | New owner adopts exact known prompt; restores worker token and lane occupancy. Canonical message remains pending. | Held, no attempt increment for adoption. | Same prompt completes/finalizes after takeover. |
| After output PUT, before COMPLETED | Verify/reuse the existing per-job object or re-download the same prompt output and repeat PUT after the lease guard; fenced completion selects one active result. | No extra debit. | Same-attempt output becomes available through the existing key. Stale owners are blocked before new PUTs; already-issued store writes retain the documented residual window. |
| After COMPLETED, before XACK | Terminal replay ACKs without GPU or monetary work. Token-checked release is retried/rebuilt as needed. | Original charge remains spent. | REST result exists. SSE/webhook may still be missed or duplicated because outbox is deferred. |

SIGTERM uses up to 5s only for in-progress writes/PUTs; SIGKILL uses expired-lease recovery. During phases A–C, the old abandoned-prompt timing remains a known limitation; the final matrix is not a claim about those intermediate versions. Explicit customer cancellation and PixVerse/classify/provider outcomes are not redefined by this matrix.

## 7. Rollout procedure shared by the phases

Use the approved **persistent admin inactivity** procedure for initial/partial upgrades, including the E deployment whose old process cannot yet short-drain safely:

1. Inventory all shared GPU workers and in-house workers, including workers that accept multiple types. Persist `isActive=false` through the admin API/UI so registry entries become DRAINING. Drain every worker counted by the corresponding lane caps; draining only merchant-tagged workers does not zero the shared cap if catalogue/other shared workers remain active. Capture original active flags/tags without printing keys. No direct production SQL/Redis writes.
2. Wait at least one registry refresh (currently 5s), and for active work and the current 10s requeue sleeps to settle. Require XPENDING **total** zero for `jobs:priority`, `jobs:normal`, `jobs:low` and relevant `jobs:inhouse`, plus zero paid Comfy jobs in PREPROCESSING/GENERATING/UPLOADING. Repeat the observations to cover a read already in flight. Unread QUEUED work may remain; XLEN is not unread depth. New customer requests may queue during the quiet-time window; this plan adds no producer hold.
3. Check actual worker queue/history for the jobs just drained, and explicitly account for video/classify work because their crash recovery is deferred. A GPU cap of zero does not drain the independent video lane. If deferred live work would be interrupted, wait for the quiet condition instead of claiming 2a protects it.
4. **If the zero condition cannot be reached, do not deploy.** Existing orphaned PELs can require the old 30-minute recovery before A–D; the sweeper does not ACK them, and draining does not cure them. Old age/recovery failures remain a risk during that wait. Surface this with the job IDs and stop the rollout; do not invent a repair, clear PELs, force a refund, use SIGSTOP or bypass the approved prerequisites.
5. Deploy via normal CI/CD at the quiet time. The additive migration goes only through `db:migrate:prod`. Verify migrations and the executed container code/build, not just the branch name.
6. **Before phase C:** startup filters inactive workers out and deletes their registry entries. Reactivate via existing admin PATCH including `isActive:true` plus unchanged `allowedJobTypes`, which triggers `syncToRedis` and restores the entry with server-side URL/key. Test this exact sequence on staging. **From phase C:** reservation-aware startup retains inactive workers as DRAINING; reactivate normally and verify any active token remains protected. Do not use a second unplanned restart to make reactivation work.
7. Verify registry/cap recovery, ordinary output and billing on the user's authorized production cohort, no new loop/fencing errors, and phase-specific read checks below. Only proceed to the next phase after production verification. Later post-E normal deployments can use short drain/adoption; multi-dispatcher rolling deploys are still excluded.

Rollback is phase-aware: A's additive tables can remain; never drop them. Before D, rollback any ownership/reservation-aware process only after the same zero-work drain. After D/E, prefer roll-forward or rollback to a previously verified **adoption-aware** version with compatible records; never launch an unfenced older binary while newer attempts remain active. No destructive migration rollback or direct production data edits.

## 8. Verification commands and read-only production queries

For each implementation phase: write the named regression tests first, see the relevant failure, implement the complete unit, and run the focused test plus required suites. Example commands (to execute during implementation, not this planning task):

```bash
pnpm --filter @aivastra/dispatcher test:integration test/integration/submission-intent.test.ts
pnpm --filter @aivastra/dispatcher test
pnpm --filter @aivastra/dispatcher test:integration
pnpm --filter @aivastra/dispatcher exec tsc --noEmit
pnpm --filter @aivastra/db build
git diff --check
```

Use real local docker-compose Redis/Postgres/MinIO with isolated DBs, buckets and key namespaces; no testcontainers. The fake worker is a separate HTTP process whose queue/history and request counters survive dispatcher child restarts. Signal tests must send real SIGTERM/SIGKILL to child dispatchers; manually rejecting a mocked promise is insufficient. Child harness passes test-only endpoints and isolated credentials; it must not load production environment files or real worker URLs.

| Phase | Required process-level tests, in addition to that phase's races |
| --- | --- |
| A | `intent-before-post`, `intent-db-failure-zero-posts`, `accepted-response-lost`: gate before intent commit, before POST and after fake acceptance; SIGTERM and SIGKILL each child. Check persisted identity, receipt or SUBMITTING ambiguity, unchanged charge and legacy outcome. No assertion of adoption yet. |
| B1 | `duplicate-live-owner`, `stale-owner-write-rejected`, `retry-visible-after-yield`: kill or terminate an owner during upload/after acceptance; prove live leases are skipped, stale callbacks cannot mutate status/ledger and immediate replacement acquisition works. Existing payer outcomes remain unchanged; split-settlement crash gaps are not claimed fixed. |
| B2 | `fenced-settlement-all-payers`, `completion-vs-refund`, `refund-crash-rolls-back`: real SIGTERM/SIGKILL between balance/ledger/status statements for user, merchant and store, including zero cost and a prior cancellation refund. Assert one transaction, one refund and no terminal effect from a stale owner. |
| C | `rebuild-before-idle`, `late-release-token`, `admin-reactivate-reserved-worker`, `scheduled-history-cleanup`, `cleanup-alert-120s`; plus `lost-receipt-finished`, `lost-receipt-running`, `lost-receipt-never-accepted`, `queue-to-history-discovery`, `deadline-survives-restart`, `unreachable-held-alerted`, `malformed-held`, `foreign-queue-does-not-block-release`, `search-token-replaced`, `late-acceptance-diagnostic-only`. Use real child SIGKILL after POST reaches the persistent fake and before receipt persistence; restart against real Redis/Postgres. Verify receipt/event idempotency, running holds, completed releases, successful no-client-match queue/history checks after the unchanged deadline, failed-read holds/alerts and no new token release or business effect. No adoption yet. |
| D | `adopt-running`, `adopt-finished`, `uncertain-deadline-survives-restart`, `lease-check-before-put`, `late-input-upload-isolated`: SIGTERM and SIGKILL at every matrix boundary; then advance the old recovery eligibility in the **test configuration**, not by production edits. Assert same-attempt adoption, bounded retry budget, fenced selected output, correct ledger, unchanged output keys and isolated input names. A held already-issued PUT test documents the residual window; it must not assert that a pre-PUT check fences storage completion. |
| E | `retired-owner-immediate`, `killed-owner-lease-expiry`, `late-claim-after-stop`, `adoption-at-zero-cap`: both signals at every matrix boundary with real child restarts. Assert configured drain bound, no claims after stop, no renewal after retirement, occupied tickets before fresh admission and no 30-minute delay. Verify the real staging container too. |
| F | `lost-handoff-reply`, `append-fails-no-ack`, `recovery-races-yield`: SIGTERM/SIGKILL before/after DB yield and before/after Lua execution. One durable original/replacement remains; replay cannot append again; only one owner dispatches and all original fields survive. |

Use explicit HTTP/DB/storage gates for these tests, not sleeps intended to hit a race by chance. The fake worker can delay an accepted response, retain completed history, transition queue → history between reads and count POSTs per client ID. Gate before the lease check and before PUT initiation to prove unauthorized writes never start; separately hold an already-issued isolated PUT to characterize its limit. No application tests or signal experiments were run for this document.

The following are proposed **SELECT-only** checks against the new schema. Run only once that phase's migration/behavior exists. Restrict to the release cohort/time as appropriate; report counts/IDs without payloads or credentials.

**Drain gate, existing schema, all phases:**

```sql
SELECT id, source, status, started_at
FROM jobs
WHERE status IN ('PREPROCESSING','GENERATING','UPLOADING')
  AND source IS DISTINCT FROM 'catalog_video';
```

Also read XPENDING summaries on each GPU stream; both totals and in-progress rows must be zero. Review video independently rather than silently ignoring it in the global process.

**Expired paid ownership, B1 onward; prompt recovery SLO, E onward:**

```sql
SELECT j.id, j.status, c.owner_session, c.generation, c.lease_until,
       c.owner_retired, a.state, a.prompt_id
FROM jobs j
JOIN dispatcher_job_control c ON c.job_id = j.id
LEFT JOIN execution_attempts a ON a.id = c.active_attempt_id
WHERE j.status IN ('PREPROCESSING','GENERATING','UPLOADING')
  AND (c.owner_retired OR c.lease_until <= clock_timestamp())
ORDER BY c.lease_until;
```

Expiry is transiently expected during recovery, not instant proof of a stuck job. In E, investigate rows persisting beyond two 5s recovery ticks after eligibility/readiness under healthy dependencies. Uncertainty may stay unresolved until its recorded deadline, but a current reconciler must own/renew it. Count missing control rows separately for legacy jobs; do not mistake a missing lease for a healthy one.

```sql
SELECT j.id, j.source, j.status
FROM jobs j
LEFT JOIN dispatcher_job_control c ON c.job_id = j.id
WHERE j.status IN ('PREPROCESSING','GENERATING','UPLOADING')
  AND j.source IS DISTINCT FROM 'catalog_video'
  AND (c.job_id IS NULL OR c.owner_session IS NULL OR c.lease_until IS NULL);
```

Expect zero in the newly acquired paid-Comfy cohort. Explicitly label any old/deferred provider rows rather than classifying them as a healthy lease.

**No new in-progress crash failures, D onward:**

```sql
SELECT id, source, status, error_code, completed_at
FROM jobs
WHERE error_code = 'DISPATCHER_CRASH'
  AND completed_at >= :deployment_started_at
  AND source IS DISTINCT FROM 'catalog_video';
```

Expect zero for controlled paid-Comfy cohort rows. Also inspect structured logs for `job found in-progress after reclaim`/DISPATCHER_CRASH because the old first retry may not leave that error on a terminal row. Exclude historical/explicitly deferred provider cases, not new Comfy failures.

**Adopted attempts, D onward:**

```sql
SELECT payload->>'phase' AS phase, count(*) AS adoptions,
       count(DISTINCT payload->>'attemptId') AS distinct_attempts
FROM job_events
WHERE event_type = 'COMFY_ADOPT'
  AND created_at >= :deployment_started_at
GROUP BY payload->>'phase';
```

Record COMFY_ADOPT once per successful ownership transfer with attempt ID/generation and outcome; it is audit data, not a new effects table. Correlate with eventual result/ledger and prove no new POST for adoption.

**One send decision and at most one known receipt per accepted attempt, A onward:**

```sql
SELECT a.id, a.job_id, a.client_id,
       count(*) FILTER (WHERE e.event_type = 'COMFY_SUBMIT_STARTED') AS sends,
       count(DISTINCT e.payload->>'promptId') FILTER
         (WHERE e.event_type IN ('COMFY_DISPATCH','COMFY_RECEIPT_DISCOVERED')) AS receipts
FROM execution_attempts a
LEFT JOIN job_events e ON e.payload->>'attemptId' = a.id::text
WHERE a.job_id IS NOT NULL AND a.prompt_id IS NOT NULL
  AND a.created_at >= :deployment_started_at
GROUP BY a.id, a.job_id, a.client_id
HAVING count(*) FILTER (WHERE e.event_type = 'COMFY_SUBMIT_STARTED') <> 1
    OR count(DISTINCT e.payload->>'promptId') FILTER
         (WHERE e.event_type IN ('COMFY_DISPATCH','COMFY_RECEIPT_DISCOVERED')) > 1;
```

Expect zero for new protocol rows; imported legacy rows are separately labeled/excluded. A DB send-decision event is **not proof of physical HTTP delivery**. Verify one actual `/prompt` per accepted attempt using structured caller logs carrying attempt/client ID and worker request/history correlation; in staging assert the fake worker's actual POST counter equals one. Multiple attempt IDs for one job after the approved uncertainty retry are allowed; multiple POSTs for the same attempt are not. Investigate more than one worker prompt matched to a client ID rather than silently choosing an arbitrary output.

**Attempt-contract storage cost, A onward:**

```sql
WITH per_job AS (
  SELECT a.job_id,
         sum(pg_column_size(a.contract)) AS contract_bytes,
         sum(coalesce(e.workflow_bytes, 0)) AS event_workflow_bytes
  FROM execution_attempts a
  LEFT JOIN LATERAL (
    SELECT sum(pg_column_size(je.payload->'prompt')) AS workflow_bytes
    FROM job_events je
    WHERE je.job_id = a.job_id
      AND je.event_type = 'COMFY_DISPATCH'
      AND je.payload->>'attemptId' = a.id::text
  ) e ON true
  WHERE a.job_id IS NOT NULL AND a.created_at >= :deployment_started_at
  GROUP BY a.job_id
)
SELECT count(*) AS jobs,
       avg(contract_bytes) AS mean_contract_bytes,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY contract_bytes) AS p95_contract_bytes,
       max(contract_bytes) AS max_contract_bytes,
       avg(event_workflow_bytes) AS mean_duplicate_event_workflow_bytes,
       avg(contract_bytes + event_workflow_bytes) AS mean_combined_value_bytes
FROM per_job;

SELECT pg_total_relation_size('execution_attempts') AS attempts_table_toast_index_bytes,
       pg_total_relation_size('dispatcher_job_control') AS control_table_toast_index_bytes;
```

Report per-job means/p95/max and cohort size, including multi-phase jobs; record classify request size separately. Value-byte measurements illustrate duplicate workflow cost but are not an exact physical disk allocation per job (JSON extraction, TOAST/compression and index overhead differ). Capture total relation-size deltas as well. Measure on staging first, then read the production release cohort; retain workflow payloads in the existing event for A compatibility and do not print them. No production SQL writes or storage-retention changes.

For refunds, join the cohort's original JOB_DISPATCH debit and all JOB_FAIL_REFUND/JOB_CANCEL_REFUND/REFUND_ADMIN_CANCEL ledger rows in the correct user/store ledger; expect at most the original charged amount returned and matching terminal status. Merchant jobs use their original user ledger. Read balances/ledger only; no SQL UPDATE/DELETE/repair. Exact payer/zero-cost fixtures belong in B1 regression/B2 settlement tests, not a production credit experiment.

## 9. Explicit deferrals and the risk left open

| Deferred change | Risk remaining after 2a |
| --- | --- |
| Webhook and SSE outbox | Completion can commit before notification enqueue/publication; notifications may be lost or duplicated. REST output is authoritative. No claim of exactly-once external delivery. |
| Cancellation contract redesign | Existing Redis cancellation TTL and unconfirmed-cancellation outcomes remain; a crash can lose a request or leave physical execution uncertain. 2a prevents stale dispatcher writes over terminal states but does not redefine cancel/refund timing or safe interruption semantics. |
| Classify reservations | Intent and transient release tokens exist, but early-ACK recognition has no durable reservation takeover. A classifier crash can leave remote work occupying an apparently idle worker; overlapping classify/paid worker configurations retain that known risk. |
| PixVerse recovery | Existing task/creation uncertainty and shutdown risks remain. The approved GPU retry-after-search policy must **not** be applied to PixVerse. |
| Saree step-2 promoter redesign | Its CAS-to-XADD gap can still strand a dependent job. The existing output layout stays intact, so 2a requires no promoter edit or compatibility-key migration. |
| Admin retry lifecycle | Full lifecycle-aware retry semantics and stale external admin actions remain. 2a never reuses its monotonic attempt sequence and preserves refund history, but operator retries must be tested/handled cautiously; no claim of a new admin retry API contract. |
| Multi-dispatcher support | No distributed worker-reservation table/election/rolling deployment. Run one active dispatcher; reject an accidental second active session. Rebuild assumptions must be revisited before scaling dispatcher replicas. |
| Generation-scoped output keys | Deferred with multi-dispatcher/stronger storage fencing. Existing per-job output keys remain. The pre-PUT lease guard blocks newly unauthorized writes but cannot fence already-issued storage work or an arbitrary pause immediately after authorization. No per-attempt output layout, routing or deletion redesign in 2a. |

Also unchanged: 10s no-worker backoff holds admission slots, pool-aware admission, delayed retry scheduling and the normal non-owned provider cancellation behavior. These remain Change 3/other follow-ups.

## 10. Review focus and separate open work

Before implementation, verify especially: A records hot-path latency and workflow storage cost without implying classify recovery; B1 guards existing writers and yields before replacement publication; B2 alone consolidates financial settlement before adoption; C rebuilds before IDLE, discovers lost receipts without business effects, persists deadlines across restart and releases unknown holds only after successful no-client-match queue/history-after-queue checks, with 120s unverifiable-hold alerts and token protection; D reuses C's adapter/receipts/deadline without changing the approved retry policy, keeps output keys unchanged, checks the lease before PUT and routes the sweeper to adoption; E restores adopted occupancy even at cap zero; F preserves durable message handoff. Named phase tests cover these conditions, including queue-to-history and delayed-acceptance races. Review the real admin inactive → startup removal → reactivation sequence on staging before the first release.

The original long-drain, never-resubmit, outbox/session/reservation-table and process-freeze recommendations remain in the earlier analysis as historical proposals; they are **not** instructions for 2a.

Separate open work, not prerequisites or silently completed here: the run-3 worker-stall report (~5s post-job stall still unexplained), and the 24-hour pickup-fix remeasurement due 2026-10-28. This plan does not schedule an automation or claim either report has been delivered.
