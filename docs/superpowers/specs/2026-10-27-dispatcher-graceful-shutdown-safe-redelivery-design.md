# Dispatcher graceful shutdown and safe redelivery — Change 2

Date: 2026-10-27. Status: proposed design for review; not approved for implementation.

This document proposes application and deployment changes only. No application code, migration, production mutation, worker change, commit or push was performed while preparing it.

## 1. Recommendation and contract

Use **a short drain followed by adoption**, with **Postgres as the authority for job ownership, submission records and worker reservations**. Redis Streams remain delivery and wake-up mechanisms. A new dispatcher resumes an accepted prompt or its finalization; it does not infer failure from a delivery, an old consumer name or a process exit.

Proposed initial defaults, chosen for this design rather than measured production limits:

| Control | Initial value | Meaning |
| --- | --- | --- |
| Cooperative drain | 20 seconds | Finish short remaining work while keeping dependencies and leases alive. |
| Compose `stop_grace_period` | 45 seconds | Allow drain, bounded local cleanup and durable handoff before SIGKILL. |
| Instance and job heartbeat | 5 seconds | Renew through a dedicated, bounded Postgres connection. |
| Lease duration | 30 seconds | An expired job lease permits a fenced takeover, not a new GPU execution. |
| Recovery scheduling | Startup, then every 5 seconds | Schedule eligible recovery through the same task supervisor as fresh work. |
| Orphan message minimum idle | 0 after its session is proven retired/expired | Do not add a second 30-minute wait after ownership has expired. |
| Reconciliation sweep | 30 seconds | Find missed recovery, effect and settlement obligations; age alone cannot refund. |
| Recovery observer budget | 16 concurrently active observers, configurable | Bound HTTP/DB work; already-running prompts keep their reservations even while awaiting an observer. |

These values must pass staging tests. The normal healthy-dependency target is eligibility for recovery within 35 seconds of a crash, or within one recovery tick after an explicit handoff and successor readiness. This excludes container build/start time and is not a hard network-partition guarantee. With the current stop-before-start deploy, there is still a pickup outage during the old process's drain and new process's bootstrap.

Required invariants:

1. Only the current, unexpired ownership generation may change a job, settle its money, submit a new prompt, publish its durable completion decision or release its worker reservation.
2. Every potentially accepted external submission has a durable identity and intent **before** the request starts. A handoff is not an execution failure and consumes no retry attempt.
3. A worker reservation survives owner death until its prompt is resolved and its required output is durable. Lease expiry never means the GPU is free.
4. A duplicate delivery is classified against durable state. It cannot reset a live job, dispatch it twice, increment attempts or issue a refund.
5. Completion metadata, terminal state and notification obligations commit together. Terminal failure/cancellation and its one permitted refund commit together.
6. Uncertain acceptance is a distinct recoverable condition. Neither silence nor an HTTP timeout authorizes a second execution.

The guarantee covers dispatcher replacement or failure while the worker retains the accepted prompt/history or recoverable output. **It cannot guarantee recovery after the worker itself loses all history and output**, or prove that an arbitrarily delayed request will never be accepted, without a stronger worker receipt/idempotency contract. This design does not claim exactly-once execution.

## 2. Scope and evidence

### Scope

Cover paid job ownership, shutdown, recovery, finalization, refunds and the transport/effect gaps directly exposed by redelivery. Cover GPU shared and in-house lanes; retain video as a separate lane with provider-specific resumption. Track classify and webhook tasks during shutdown so closing shared dependencies cannot abandon them silently.

Do not change workflows, GPU-worker code, the `aivastra-gpu` repository, queue pickup latency, worker-pool admission policy or the 10-second delayed-retry algorithm. The durable delayed-retry scheduler remains Change 3. An atomic replacement-message handoff is included here because its crash window already produces duplicate deliveries.

### Verified repository baseline

The local checkout is feature commit `eb3997c5`; the relevant dispatcher, DB, Compose and deployment files have no diff from main `72a2a56e`. References below are to that code, not assumptions based on the branch name.

| Claim | Read evidence and qualification |
| --- | --- |
| Shutdown does not drain | [`index.ts`](../../../apps/dispatcher/src/index.ts#L189) stops consumers, closes clients and DB, then exits; [`loop.ts`](../../../apps/dispatcher/src/stream/loop.ts#L84) does not expose the active task promises to shutdown. |
| Replacement has a short stop window | [CI deploy](../../../.github/workflows/ci.yml#L539) uses `up -d --no-deps --force-recreate`. Neither [production](../../../infra/docker-compose.prod.yml#L147) nor staging dispatcher defines `stop_grace_period`. Live inspection found no configured StopTimeout and an empty StopSignal. Compose's documented default is 10 seconds; longer grace would not stop the current application from exiting immediately. |
| Names change on recreate | GPU/recovery use `hostname()`; video/in-house append lane suffixes. The live replacement hostname was `ee49ff0ffc75`. A changing consumer name does not make entries inaccessible; the missing ownership-aware takeover is the defect. |
| Recovery waits and bypasses admission | [`recovery.ts`](../../../apps/dispatcher/src/stream/recovery.ts#L22) uses pending age, `XCLAIM`, and serial awaited calls directly to `processJob`. [`index.ts`](../../../apps/dispatcher/src/index.ts#L140) invokes it before starting consumers, then every 60 seconds. Production `XPENDING_CLAIM_THRESHOLD_MS` was read as `1800000`; [code default](../../../apps/dispatcher/src/env.ts#L40) is `60000`. |
| In-progress redelivery means crash today | [`processor.ts`](../../../apps/dispatcher/src/job/processor.ts#L227) sends PREPROCESSING/GENERATING/UPLOADING to generic `handleFailure`, which increments attempts and retries or terminates. It does not establish owner death. This is also not a safe billing dispatcher for store-billed jobs: recovered work must use the persisted billing kind rather than this generic user path. |
| There is no exclusive acquisition | [`state.ts`](../../../apps/dispatcher/src/job/state.ts#L56) guards cancellation, not an expected QUEUED state. The nine PREPROCESSING calls in `processor.ts` at lines 685, 1115, 1246, 1567, 1873, 2261, 2550, 2951 and 3318 ignore the returned boolean. |
| Requeue can duplicate | [`requeueForNoWorker`](../../../apps/dispatcher/src/job/processor.ts#L136) writes QUEUED, sleeps 10 seconds, then separately appends and acknowledges. [`handleFailure`](../../../apps/dispatcher/src/job/processor.ts#L3809) has a similar separate retry append/ack. |
| Submission is recorded too late | [Shopify submission](../../../apps/dispatcher/src/job/processor.ts#L3409) generates a random client UUID, submits, then inserts COMFY_DISPATCH with prompt ID, worker ID/URL and inputs. [`submitPrompt`](../../../apps/dispatcher/src/comfyui/client.ts#L30) sends `client_id` and has a 15-second timeout. It does not persist that ID. |
| Sweeping is based on age | [`sweeper.ts`](../../../apps/dispatcher/src/stream/sweeper.ts#L11) uses 15 minutes from `coalesce(started_at, created_at)`, and runs every five minutes. It does not establish owner death, inspect a prompt or share one terminal/refund transaction on all billing paths. Therefore the practical age threshold is roughly 15–20 minutes, subject to scheduling. |
| Finalization has only partial idempotency | [`finalize.ts`](../../../apps/dispatcher/src/workflow/finalize.ts#L114) uploads before [`transitionJob`](../../../apps/dispatcher/src/job/state.ts#L69) upserts `job_outputs`. The row's [primary key](../../../packages/db/src/schema/jobs.ts#L140) prevents multiple output rows, but repeated status events, stale object overwrites and lost post-commit notifications remain possible. |

Additional constraints read during review:

- [`registerWorkers`](../../../apps/dispatcher/src/worker/registry.ts#L130) rewrites every registered worker to IDLE on boot. Adoption must change this; otherwise a replacement can allocate a still-running GPU to another job.
- [`releaseWorkerIfBusy`](../../../apps/dispatcher/src/worker/registry.ts#L48) checks BUSY only, not a job/token. Its own retry comment warns that a late release can free a newly claimed worker. All claim/release callers, including classify, must participate in reservation tokens.
- [`terminateJob`](../../../apps/dispatcher/src/job/processor.ts#L3696) already combines regular-user refund and terminal status under a job lock. Merchant-widget and Shopify failure paths refund first and transition separately; the sweeper does likewise. Per-reason unique indexes exist in migrations [0074](../../../packages/db/src/migrations/0074_credit_ledger_job_reason_uniq.sql) and [0151](../../../packages/db/src/migrations/0151_shopify_store_credits.sql); they do not by themselves prevent refunds under two different reasons.
- Merchants use their owning user's ledger, not a separate merchant balance: [`merchant/ledger.ts`](../../../apps/api/src/modules/merchant/ledger.ts#L7). Adoption must never replay a charge or a Shopify billing purchase.
- [Saree promotion](../../../apps/dispatcher/src/job/saree-step2-promoter.ts#L106) CASes PENDING_MANNEQUIN to QUEUED before input updates and XADD. Concurrent promotion is guarded, but a crash after that CAS can strand a QUEUED job; its comment overstates crash safety.
- [Widget completion](../../../apps/dispatcher/src/job/processor.ts#L3163) commits COMPLETED before SSE/webhook enqueue/XACK. The [webhook consumer](../../../apps/dispatcher/src/stream/webhooks.ts#L98) has no stable public event identifier or pending recovery. A completed redelivery today ACKs and can leave a lost webhook unrepaired.
- [Mannequin subphase](../../../apps/dispatcher/src/job/mannequin-phase.ts#L136) also submits and records COMFY_DISPATCH; it must be adopted as a phase, not mistaken for the final job prompt. [Video](../../../apps/dispatcher/src/job/processor.ts#L1121) records a `PIXVERSE_DISPATCH` task ID after creation, and can resume polling a known ID. [Classify](../../../apps/dispatcher/src/classify/consumer.ts#L15) deliberately ACKs early and is ephemeral; this design does not turn expired recognition requests into paid durable jobs.
- [Cancellation](../../../apps/dispatcher/src/comfyui/cancel.ts#L70) currently throws the same `JobCancelledError` for confirmed, denied and unconfirmed outcomes. [API cancellation](../../../apps/api/src/modules/jobs/routes.ts#L1169) signals in-progress work with a Redis TTL key. Neither is the durable, outcome-aware cancellation contract proposed below. [Classify's Comfy path](../../../apps/dispatcher/src/classify/process.ts#L149) submits using requestId as client ID and unconditionally releases its worker in `finally`; early ACK does not make that remote prompt disappear after a crash.

### Verified incident snapshot

Read-only production SELECTs, Redis reads and worker GETs confirmed:

| Item | Observed value |
| --- | --- |
| Job | `65aab75d-d8e3-4fdf-babf-58d1f2ff15b1`, store billed, 5 credits |
| DB creation / Redis enqueue | `06:01:00.887879Z` / `06:01:00.923Z` |
| PREPROCESSING / GENERATING | `06:01:02.855828Z` / `06:01:05.634660Z` event times |
| COMFY_DISPATCH | `06:01:06.674361Z`, worker `woker-7`, prompt `e52e851e-5204-49aa-9204-cb34279267f2` |
| Replacement container start | `06:01:13.636473Z`; this is a verified start time, not an independently measured old-process stop time |
| Worker outcome | Retained history reports success/completed, one image-output node; worker-reported execution success is `06:01:16.195Z` |
| Persisted correlation | Event has prompt/worker references; no client UUID. The retained worker prompt tuple does contain `client_id`. |
| DB snapshot during this review | Still GENERATING, attempts 0, no completed timestamp or error |
| Redis at `06:16:41.318Z` | Entry `1793080860923-0`, pending under `0acf9a3a290c`, one delivery |

The worker finished successfully; this is stronger evidence than “probably finished.” It does not prove the image is downloadable or that the shopper received it: no image download, output repair or refund mutation was performed. Worker and application timestamps are reported as observed; historical clock synchronization was not independently audited. These snapshots are not a claim about the job's later sweeper outcome.

### External protocol references and assumptions

The incident worker reported ComfyUI `0.37.0`. The matching [v0.37.0 server](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.0/server.py) preserves `client_id` in prompt metadata and exposes queue/history reads. It also accepts a supplied prompt UUID, but that is **not** a deduplication guarantee. The matching [execution source](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.0/execution.py) holds queue/history in process memory and bounds history. These upstream sources are not proof that every deployed worker is unmodified or has the same version; rollout must verify the recovery contract per worker. No worker implementation change is proposed.

[Docker Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period) documents the stop grace. [Redis XAUTOCLAIM](https://redis.io/docs/latest/commands/xautoclaim/) transfers entries by idle time, without selecting a particular dead consumer. [XINFO CONSUMERS](https://redis.io/docs/latest/commands/xinfo-consumers/) reports stream interaction age, not an application heartbeat; its idle semantics differ before Redis 7.2. Never use that age as proof that a busy dispatcher died.

## 3. Decision 1 — drain versus adopt

| Option | Developer benefit / cost | User benefit / cost |
| --- | --- | --- |
| Long drain only, e.g. 120 seconds | Smallest first implementation: expose/await task promises and keep dependencies open. Does not solve SIGKILL, crashes, ambiguous submission or a longer-than-expected job. | Most ordinary 12–40s and ~95s cold jobs can finish. Stop-before-start makes that wait a pickup outage, potentially two minutes per deploy; crashes still lose work. Durations here are supplied operating estimates, not rebenchmarked. |
| Adopt only, very short shutdown | Keeps deploy interruption short. Requires persisted attempts, ownership, output recovery and worker reservations everywhere before it is safe. | Running GPU work continues through a replacement; more jobs temporarily show recovery while finalization moves to the successor. |
| **Short drain plus adopt** | More work than draining alone, but one recovery mechanism covers both planned and unplanned exits. Requires bounded task cancellation and explicit handoff results. | Short tails finish without a transfer; longer jobs survive. Pickup interruption is bounded by the short drain/bootstrap rather than the cold-job duration. |

**Recommend the combination**, initially 20s drain / 45s Compose grace. Keep the current one-container topology; zero pickup outage would require an overlapping/rolling deployment and is not promised here.

### Shutdown protocol

1. An idempotent signal handler changes the instance to DRAINING and marks readiness false. Stop new stream claims, recovery acquisitions, step-2 promotions and other job-producing ticks. Keep heartbeats, command Redis, DB, storage and already-running task/effect handlers alive. Liveness can remain healthy during drain.
2. The supervisor owns all active promises, including GPU, video, in-house, classify and webhook/effect tasks. Await outstanding reads sufficiently to learn any returned claim. A plain wake read may be interrupted safely; a group read must not be assumed unclaimed because its socket was closed. An unobserved claim is found through the retired session's PEL.
3. For up to 20s, finish accepted work normally, with all writes fenced. Renew both instance and job leases. No new prompt/phase begins once drain starts; work that has not submitted yields its durable preparation state instead.
4. At the drain deadline, stop local observation/download activity using a distinct `ShutdownHandoff` outcome. This must bypass ordinary `catch → handleFailure`, attempt increments, refunds, XACK and unconditional `finally → releaseWorker`. **Never send ComfyUI interrupt or delete merely because of SIGTERM.** Existing customer cancellation remains a separate durable request.
5. Persist the last known phase, submission intent/receipt and output obligation, then revoke this owner's authority by advancing its fencing generation and yielding its lease. Keep the worker reservation attached to the execution. An outstanding POST may still be accepted after this point; it remains SUBMISSION_UNKNOWN and must be reconciled, not repeated. Bounded local abort does not prove remote cancellation.
6. Mark the session RETIRED, stop heartbeats, close readers and shared dependencies only after tasks have settled or been durably yielded/fenced. Budget up to 15s for bounded request/local cleanup and 10s for handoff/close within the 45s container grace. A storage operation that cannot be cancelled may finish late; immutable artifact keys and DB fencing must make that harmless. A second signal may shorten local waiting, not manufacture a failure/refund.
7. If the process cannot persist handoff, leave the PEL and durable attempt intact. The successor waits for the 30s lease, not the old 30-minute pending age. SIGKILL uses this same path by omission.

### Admission and worker accounting during adoption

Recovery must enter the supervisor's lane/task accounting; it must not call `processJob` recursively or directly from a separate unlimited loop. Classify records as `resume preparation`, `observe existing prompt`, `resume output`, `finish terminal effects` or `fresh execution` before launching them.

- A fresh or safely restarted preparation uses the ordinary lane cap. A recovered GPU job stays in its original shared/in-house lane; video stays in video. Pool policy is unchanged.
- An already accepted prompt already consumes real worker capacity. Restore its lane occupancy and durable worker reservation **before** opening fresh admission. Observing it cannot wait for an IDLE GPU slot, since it owns the occupied GPU. Use a bounded recovery-observer budget, count these tasks in the lane, and block fresh starts when restored occupancy meets/exceeds the current cap. Do not discard an adoption because capacity has dropped to zero, a worker is DRAINING or the worker is temporarily unhealthy.
- Reserve the worker through output materialization/finalization, as today. Only a fenced resolution may free it. Bootstrap reads reservations before registry refresh and reconciles the Redis mirror; `registerWorkers` must preserve/reconstruct BUSY reservations rather than reset them to IDLE. A missing health key or an empty Comfy queue does not erase a reservation.
- All worker claim/release code uses a reservation token and ownership generation, including early probe rejection, exceptions, classify and admin/drain paths. An old owner's late `finally` cannot free an adopted worker. Health probes only update health; they never decide job ownership.
- With multiple dispatchers, local caps remain a load bound, while the DB reservation's unique active worker constraint prevents aggregate over-allocation. This does not solve pool-specific queue head-of-line blocking; that remains Change 3.

## 4. Decision 2 — ownership and the replacement redelivery branch

### Choices

| Option | Developer benefit / cost | User benefit / cost |
| --- | --- | --- |
| QUEUED CAS only | Small change, but must be checked by every caller. Cannot distinguish an abandoned in-progress job or fence late finalizers/releases. | Prevents simultaneous initial starts, but still leaves crashed jobs stranded. |
| Redis TTL lease plus DB CAS | Cheap heartbeat and familiar token-checked Lua. DB status/money and Redis ownership cannot commit together; eviction, restore or failover can erase the authority independently. Needs additional durable fencing to be safe. | Fast handoff when Redis is healthy; partitions can otherwise produce false death and conflicting owners. |
| **Postgres lease and generation, plus CAS** | Migration and recurring DB writes; larger refactor. Ownership, status, output and refunds can share a transaction and one clock. Redis becomes rebuildable transport/cache. | Stronger protection against duplicate execution decisions and refunds; DB outage pauses progress safely rather than inventing a second owner. |

**Recommend Postgres leases and fencing.** Use DB time for eligibility, not process clock comparisons. A heartbeat is evidence of authority, not evidence that GPU work is progressing.

### Proposed durable records — migration required

Names are provisional, responsibilities are not. Use typed columns for state, IDs and indexed deadlines; use versioned JSON only for the frozen execution contract.

| Record | Required contents and constraints |
| --- | --- |
| `dispatcher_instances` | Random boot/session UUID, diagnostic hostname/build SHA, STARTING/READY/DRAINING/RETIRED, heartbeat/lease times, lane consumer names. Register before any group claim. |
| `job_executions` — one control row per job | Current lifecycle sequence, owner session, monotonic fencing generation, lease/heartbeat/progress/deadline timestamps, lane, canonical delivery reference, recovery condition/next reconciliation, durable lifecycle-scoped cancellation request, original billing owner/debit/amount and durable refund marker. Billing settlement survives later lifecycle resets. Index expired/ownerless nonterminal work. |
| `execution_attempts` | Job/lifecycle/attempt/phase identity, or an ephemeral classify request identity; immutable submission correlation; provider, worker/endpoint/config reference; PREPARING, SUBMITTING, ACCEPTED, OUTPUT_READY, FINALIZING, RESOLVED or SUBMISSION_UNKNOWN; prompt/task receipt; frozen workflow version, input identities, output-node selection, output policy and stage timestamps. A constraint requires exactly one parent kind: paid job or ephemeral request, not a fabricated jobs row for classify. One active phase attempt per execution/request; attempt numbers do not increase on adoption. |
| `worker_reservations` | Unique active reservation per physical worker; execution/phase or ephemeral classify request, owner generation, unique reservation token, endpoint reference, resolution/release state. Owner lease expiry does not expire the reservation. |
| `job_effect_outbox` | Stable effect ID, job/lifecycle/state version, effect kind/destination, minimal payload, due/delivery state and claim lease. Unique logical effect key. Used for notifications, step-2 enqueue, worker/cap release obligations and durable transport retries, not Change 3's delayed scheduler. |

Store credential references, not copied API keys, in recovery records/events. Worker IDs must not be reused for a different physical endpoint while a reservation is unresolved. Historical endpoints require an approved credential/config version; never send today's secret to an arbitrary recorded URL after a configuration change. Missing/rotated credentials block reconciliation and alert rather than silently selecting a different GPU.

### Acquisition and fencing rules

At the common processor entry, lock the job/control row in a short transaction. For QUEUED, conditionally acquire the control row and transition QUEUED → PREPROCESSING with a new fencing generation. Only the winner receives an execution context. Every one of the nine paths must honor failure to acquire; preferably remove their independent PREPROCESSING writes and route through this common entry. No input upload, worker allocation or provider call precedes acquisition.

Every status update, attempt update, output commit, terminal/refund transaction and release verifies job/lifecycle/owner/generation and an eligible lease. Use a fixed lock order: job/control, worker reservation, then billing balance/ledger rows. Do not hold a DB transaction open across HTTP/storage work. Renew before a remote write and give it a bounded timeout, but retain an uncertainty state for a request whose acceptance cannot be known.

For worker selection, the current Redis selector can nominate/provisionally mark a candidate, but it grants no authority to submit. Commit the unique DB reservation under the execution fence before any upload/POST; a loser conditionally clears only its own provisional Redis token. Reconciliation repairs failed cache writes from DB truth. Release also compares the reservation token/generation, so delayed Redis commands cannot release a newer reservation.

If renewal fails, stop starting effects. On expiry or a rejected generation check, unwind with `LostOwnership`; do not fail, refund, acknowledge the canonical delivery or interrupt the prompt. Already-issued HTTP/storage operations may finish, which is why durable intent and immutable outputs are required in addition to a lease.

### Redelivery classification

| Durable state | Action |
| --- | --- |
| Missing job / invalid message | Audit and ACK that transport entry; do not invent billing ownership. |
| QUEUED, no valid owner | Acquire once, then resume preparation or start the first attempt through lane admission. |
| Valid live owner, any public in-progress status | No processing, failure or attempt increment. Leave its canonical entry pending. A distinct duplicate entry may be ACKed once durable control/recovery responsibility is established; never ACK the live canonical entry as a shortcut. |
| Expired/yielded owner, before submission intent | Acquire a new generation; resume preparation using its frozen inputs. |
| Expired/yielded owner, SUBMITTING/unknown acceptance | Acquire for reconciliation only; search for the original submission. Do not POST again. |
| Expired/yielded owner, accepted prompt / pending output | Acquire for observation or finalization of the same attempt. Preserve original start/deadline and phase. |
| Terminal job | Do not rerun or rewrite its result. Repair outstanding outbox/release obligations, then ACK the stale delivery. |

Redis delivery counters, no-worker `retryCount`, ownership generations and genuine execution failure attempts are different values. Only a definitively failed execution changes the failure-attempt budget. Adoption does not.

The existing admin retry endpoint resets a FAILED job to QUEUED without charging again. It must explicitly create a new execution lifecycle/fence under the same lock, preserve any prior refund marker, and emit a durable enqueue obligation. Delayed messages/effects from the previous lifecycle cannot act on the reopened job. This preserves the existing free admin-retry behavior rather than accidentally issuing another refund.

## 5. Decision 3 — consumer identity and pending-list recovery

| Option | Developer benefit / cost | User benefit / cost |
| --- | --- | --- |
| Stable consumer name | Easy to reread that consumer's pending entries, but a name does not make them appear in `>` reads. Overlapping processes share a PEL identity; replicas require stable slots plus separate incarnation leases. | Can speed a single-instance restart, but does not prevent two live owners or recover accepted prompts on its own. |
| Startup/global XAUTOCLAIM with a short idle threshold | Simple bounded cursor API; no dead-consumer filter. It can transfer a live job's entry while its consumer is busy and not reading. Ownership checks would prevent execution but not transport churn. | Faster old pending pickup, with unnecessary interference and confusing pending ownership under load. |
| **Unique session/lane names plus instance/job leases and targeted claims** | More metadata and a bounded scan. Separates stream delivery from actual execution ownership and works across replicas/restarts. | Prompt takeover of abandoned deliveries while healthy jobs keep running. |

Recommend consumer names such as `<session UUID>:gpu`, `:video`, `:inhouse`, retaining hostname for diagnostics. Keep old consumers until their PEL is empty; never use `XGROUP DELCONSUMER` to “clean up” a nonempty PEL.

At startup and every recovery tick:

1. Reconcile durable nonterminal executions/reservations, not only the PEL. This recovers accepted work even if Redis loses or trims a message.
2. Enumerate consumer candidates with XINFO/XPENDING in bounded batches. Instance lease/RETIREMENT and job authority determine eligibility; Redis idle/inactive is diagnostic only. A live session with an expired job lease can lose that individual job without treating every session job as dead.
3. For a retired/expired session's unstarted delivery, target its entry with XCLAIM, with no extra idle delay. Recheck current transport owner where necessary and then use the DB acquisition decision. Competing recovery processes may race to claim, but only one acquires the job generation. Keep a bounded cursor and schedule through the lane supervisor, never the current direct serial processor loop.
4. A live job owner wins over a misleading/stale PEL owner. Do not steal its entry merely because its Redis idle exceeds 30 seconds. Unknown legacy names are not automatically dead in a mixed-version deployment; the first-rollout procedure below establishes which old process has exited.
5. A missing/trimmed entry is an operational alarm, not permission to abandon the DB execution. The supervisor can adopt from the durable attempt and rebuild delivery metadata. Admission and attempt counts do not depend on XLEN/PEL being complete.

XAUTOCLAIM remains a possible bounded transport repair tool after ownership checks are universal; it is not the primary liveness mechanism. Redis 7 can remove missing entries from the PEL during claiming, so durable recovery must not depend on receiving their old fields.

## 6. Decision 4 — late-claim handback

| Option | Developer benefit / cost | User benefit / cost |
| --- | --- | --- |
| **Retain original pending entry and retire/yield its owner** | Fewer moving parts; preserves the original entry and fields. Requires the new prompt recovery path to be active and lease-aware. | Next dispatcher can claim promptly without waiting 30 minutes; crash recovery also works. |
| Lua copy-and-ACK handback | Makes an unstarted job visible as a fresh delivery immediately, even to a basic reader. Adds another enqueue path, ordering changes and partial-command failure cases; does not replace ownership. | Can save one recovery tick, but has little benefit once takeover is fast and safe. |

Recommend **no copy handback in the initial Change 2 implementation**. A clean exit retires its session and yields control; a crash expires it. A late claim whose ID the old process never received is recovered by the same scan, so correctness does not depend on a successful handback RPC.

If an optional handback is later added, its contract is:

- Only an unstarted delivery, after this owner's authority is yielded. Never use it to replace adoption of an accepted prompt.
- One Lua call checks XPENDING for the exact original ID and expected consumer, reads the exact entry with XRANGE, and preserves **all** field/value pairs, including unknown fields, retryCount, lifecycle/effect identities and user/store omission conventions.
- If no longer pending under that consumer, return a no-op. If the original entry is missing, do not ACK away the evidence; schedule DB reconciliation.
- Append the replacement before acknowledging the original. If append fails, ACK must not run. After a successful append/ACK, retrying the call does nothing because the original is no longer pending.
- Lua and MULTI do not provide rollback of earlier successful commands on runtime errors. If append succeeds but a later command fails, duplicates may remain; exclusive job acquisition makes them harmless. If strict transport deduplication across such partial failures is required, add a durable original-ID → replacement-ID record and repair protocol rather than claiming the script alone provides it.
- A lost response after successful completion is safe to retry. Requeueing moves the message to the stream tail; it is not a FIFO-preserving transfer.

## 7. Decision 5 — accepted but not recorded

### Durable submission sequence

For each job lifecycle, execution attempt and phase, generate and persist a unique `submission_id` and `client_id` **before POST**. A deterministic UUID from those components is acceptable; deriving it only from job ID is not, because retries and mannequin/final phases must differ. Reuse it on adoption of that attempt, not on a genuinely new attempt.

Persist worker reservation/endpoint reference, resolved input keys and hashes, uploaded filenames, patched workflow/version identity, result-node selection and finalization policy. Freeze the execution actually being submitted; adoption must not resolve a newly edited live template or change the result node, compression/watermark policy or input image behind the shopper's original request. Do not store secrets in this snapshot.

Then:

1. Under the current fence, commit a SUBMITTING intent with submission/correlation IDs and request start/deadline. No code path may send `/prompt` first and persist intent later.
2. Send the same frozen workflow and client ID once. On a successful response, commit the receipt (`prompt_id`) and COMFY_DISPATCH audit in one fenced transaction, then observe it. Preserve a returned receipt for a reconciler even if the sender has lost ownership; this is an append-only matching receipt, not authority to finalize.
3. On network timeout, abort, process exit or an ambiguous response, mark/leave SUBMISSION_UNKNOWN. Do not call ordinary retry/failure code. HTTP timeout does not mean ComfyUI rejected the request.
4. When a prompt ID is known, GET that exact history and queue identity. If success exists, materialize its output; if queued/running, observe it. If the receipt is missing, inspect queue/history for the exact persisted client ID and execution contract, not merely the same garment or timestamp. Fetch history again after an empty queue response to cover a queue-to-history transition. Search in bounded, cached batches; a truncated history page is not proof of absence.

### Identity choices

| Option | Developer benefit / cost | User benefit / cost |
| --- | --- | --- |
| Persist client ID, search retained metadata | Uses an existing request field and works on the inspected history. Needs bounded discovery and per-worker response-shape validation. | Recovers a lost response without intentionally repeating GPU work; discovery can take longer than a direct lookup. |
| Also persist and send a caller-chosen prompt UUID | Direct lookup when the existing worker API supports it. Must validate that capability per deployed worker; supplying an ID still does not make repeated POSTs idempotent. | Faster unambiguous lookup; cannot safely enable based only on an upstream version string. |
| Retry immediately when no receipt was saved | Smallest code, no reconciliation. | Can run and bill the same generation twice; rejected. |

Recommend persisted client correlation as the mandatory baseline; add a caller-chosen prompt UUID only for a positively validated existing API capability. No worker upgrade is required or proposed. More than one match is a reconciliation incident: retain reservations, record all receipts and do not choose an arbitrary output or launch a third prompt.

### If neither queue nor history contains the submission

Use evidence, not an absence timeout:

- An attempt still PREPARING, with no committed submission intent, can be restarted after takeover. A definitive protocol validation rejection with a valid response can become a normal failed attempt.
- A SUBMITTING intent may have been sent even if its response was lost. Keep it SUBMISSION_UNKNOWN. Continue read-only reconciliation; do not release the worker or resubmit merely after two empty reads, 30 seconds, a worker restart or a history-retention gap.
- Proposed escalation: alert after 60 seconds unresolved; page/escalate at 15 minutes. The shopper should see a delayed/recovering state, not a fabricated GPU failure. The job retains its original financial charge while no terminal decision is established. A terminal “irrecoverable result” or customer cancellation must use the transactional settlement path, never an unrecorded manual balance edit.
- If all receipt/history/output evidence has been lost, operator resolution is required. Finite automatic refund/compensation while continuing recovery is a separate product policy, not silently assumed here. The tradeoff is a potentially long hold rather than a duplicate generation or false failure. This limit must be accepted at design review; implementing a worker-side durable receipt service would exceed the constraints.

Legacy COMFY_DISPATCH events with a known prompt ID can be imported into a recovery attempt under a new fence, provided job/lifecycle, worker endpoint and phase match. Missing output-node metadata must be reconstructed from the recorded workflow plus its pinned template version; ambiguity blocks recovery rather than selecting the first unrelated output. A legacy acceptance without either event or durable client ID may be diagnosable from logs, but logs are not a guaranteed recovery store.

## 8. Decision 6 — recovery and sweeper timing

| Option | Developer benefit / cost | User benefit / cost |
| --- | --- | --- |
| Keep 30-minute pending claim / 15-minute failure SLA | Little implementation change, but contradictory timers remain. | The sweeper can fail/refund a successfully finished prompt before recovery gets a chance. |
| Lower only the pending threshold | Small change; live long-running messages are also “idle.” | Faster crash pickup with a new risk of attacking healthy work; rejected. |
| **Lease-driven recovery and evidence-driven terminal decisions** | Requires the shared ownership/reconciliation path and metrics. More explicit states, less heuristic failure handling. | Recover within seconds of a proven handoff/dead lease, while preserving healthy or completed prompts. |

Recommend replacing the old recovery loop, not running a faster loop beside it. Deprecate `XPENDING_CLAIM_THRESHOLD_MS` for ownership-aware jobs; use zero additional transport age only after eligibility is established by Postgres. Old binary recovery must not remain active concurrently with the new protocol.

Retain the existing execution/cancellation budgets per job/provider, frozen at submission. They measure an execution phase, not the age of a delivery. Adoption does not reset them. When a budget expires, the current owner first reconciles history/queue and uses the existing capability-authorized cancellation protocol if appropriate; a successful prompt is finalized, and an unknown response stays unresolved. Never issue an unscoped interrupt during recovery or shutdown.

The 15-minute age becomes an **alert/escalation threshold**, not unconditional fail/refund authority. A 30-second reconciler:

- Schedules expired/yielded owners for takeover through the supervisor.
- Reports live owners with no meaningful progress beyond a stage budget and asks that owner to reconcile; a heartbeat alone cannot conceal a permanently stuck stage.
- Repairs terminal notification/release obligations and finds nonterminal work with missing transport entries.
- Finalizes a verified failure and refund only after acquiring the same fence/lock used by normal processing. A selection made before a renewal/completion is rechecked transactionally; a stale sweeper candidate cannot overwrite a healthy COMPLETED job or refund it.

Recovery ticks must not overlap unboundedly. Multiple replicas can use short `FOR UPDATE SKIP LOCKED` candidate transactions and per-job generations, then perform network work outside the transaction. Store progress and next-reconcile timestamps durably so restarts do not reset retries or create hot loops.

### Cancellation is separate from process shutdown and remote resolution

All user/admin cancellation entry points must persist a cancellation request keyed by job and lifecycle, with actor/reason/time, in Postgres before returning acceptance. Redis can remain a wake-up hint; losing its TTL key cannot forget the request. A stale request cannot cancel a later free admin-retry lifecycle.

Recommend an authorized cancellation decision may commit CANCELLED and its one refund promptly, even if the GPU cannot yet confirm cancellation. The shared terminal transaction locks job/control, checks whether completion already won, persists cancellation, advances the fence to revoke the former runner, and records a durable `RECONCILE_CANCEL`/cleanup obligation. If COMPLETED already committed, cancellation is a no-op with no refund. If cancellation wins, later success cannot publish an image as COMPLETED; it is cleanup work for the cancelled execution. This deliberately accepts possible wasted GPU work to give the customer a timely cancellation/refund.

**Financial settlement and physical worker release are separate decisions.** A cancelled job may be ACKed after its cancellation/refund and cleanup obligation commit, but its attempt/reservation remains active until remote state is resolved. The bounded recovery supervisor leases that cleanup independently of the now-terminal job. Retain and reconcile the reservation after an authorization denial, network timeout, malformed response or unconfirmed interruption; never treat the existing `JobCancelledError` as proof the worker is free.

Replace the cancellation result contract with explicit outcomes such as `confirmed_stopped`, `finished`, `pending_confirmation`, `authorization_denied` and `unknown`. Continue using existing live capability/version authorization for destructive requests; do not expand it or introduce an unscoped fallback for adoption. A definitive finished history allows cleanup/release without sending another interrupt; a known accepted prompt's validated disappearance can use the existing confirmation policy. For SUBMISSION_UNKNOWN, discover the exact prompt first: an empty queue/history or expired cancellation flag is not confirmation that the original request can never arrive.

Unknown cancellation cleanup follows the same 60s/15m alert/escalation policy, with its reservation retained. The shopper has the recorded cancellation/refund; capacity remains quarantined until safe resolution. Tests and dashboards must distinguish this from a leaked refund or a successfully interrupted worker.

## 9. Decision 7 — replacement message and ACK

| Option | Developer benefit / cost | User benefit / cost |
| --- | --- | --- |
| Leave every append/ACK fix to Change 3 | Smaller Change 2 diff, but deploy/crash redelivery still crosses a known duplicate-producing boundary. | Ownership prevents double dispatch, yet unnecessary duplicate work and confusing queue state remain. |
| **Fix immediate replacement handoffs here; defer delayed scheduling** | Small shared Lua handoff with fault tests. Retains the current sleep/backoff and admission behavior until Change 3. | Safer retries now without bundling a new scheduling policy into shutdown recovery. |

Recommend a conditional append-before-ACK script for `requeueForNoWorker` and normal execution retry handoffs, with the same field-preservation and partial-error rules as section 6. The existing PEL remains durable during the 10-second sleep; a shutdown yields it without counting as failure. A successful handoff leaves only the replacement pending/unread; a retry after success must not append again.

DB changes and Redis operations cannot be one atomic transaction. Commit a durable immediate-requeue obligation (lifecycle and retry payload) with the QUEUED transition; a dispatcher can retry the conditional transport handoff after a crash. A lost response may result in a duplicate transport delivery, which the job/lifecycle fence makes harmless. Do not ACK before the replacement is durable or the DB recovery obligation is committed. The due-time sorted set, removal of sleeping admission slots and pool-aware scheduling stay in Change 3.

## 10. Idempotency and settlement of every side effect

### Terminal transaction

Create one shared terminal/settlement helper used by dispatcher success/failure, sweeper, API cancellation, admin retry/cancel and mannequin-dependent failure. Lock job/control, validate lifecycle/fence and terminal preconditions, resolve the original billing snapshot, then commit:

- The one winning terminal state and monotonic state version/audit event.
- Successful output metadata, or the original charge's one permitted refund.
- Durable SSE/webhook, worker-release, store-cap-release and dependency-promotion obligations as appropriate.

For user and merchant refunds, inspect the original debit and all recognized terminal refund reasons while holding the job lock; insert ledger first with conflict protection, then change the balance only if inserted. Persist the resulting refund marker/reference on the control row. For Shopify use `shopify_credit_ledger` and the original store, in the same transaction as status. Zero-charged jobs do not get phantom positive/zero refund ledger entries. Missing billing ownership aborts and alerts; it does not ACK or pretend the refund happened.

The control row's refund settlement is **per original charge**, not per execution attempt or admin retry lifecycle. A FAILED→QUEUED free admin retry retains a prior refund. Never issue a second refund under a different reason or recharge during adoption. Keep Shopify charge/grant idempotency on external_ref untouched; a stranded purchase is not a job recovery action.

### Side-effect inventory

| Effect | Today | Required behavior under redelivery/adoption |
| --- | --- | --- |
| PREPROCESSING and intermediate statuses | Cancellation guard only; multiple call sites ignore result. | Expected-state + lifecycle/fence checks; one state-version/audit event per actual transition. Adoption does not reset started_at or emit a new generating lifecycle. |
| Worker claim/release | Redis BUSY flag, reset to IDLE at boot; release not job-bound. | Durable unique reservation and token-matched mirror/release. The reservation persists through unknown submission and output recovery. Repair a missed release from outbox; never let an old owner release a new reservation. |
| Input uploads | Job-based names, overwrite=true. | Attempt/phase-scoped filenames and persisted input identities/digests. Reupload only a pre-submission phase with matching input bytes; a changed source key is not silently substituted. Accepted prompt adoption never reuploads or reposts. |
| POST /prompt | No persisted pre-request identity. | One durable intent/correlation per phase attempt. Reconcile uncertain acceptance; client ID is correlation, not idempotency. No retries from shutdown exceptions. |
| Output PUTs | Predictable per-job keys can be written again before DB commit. | Persist an artifact intent; use immutable execution/artifact-scoped keys, including ownership generation where writers may overlap. Late old PUTs cannot overwrite the published artifact. Record expected byte length/hash and content policy; publish only a verified manifest under the current fence. |
| `job_outputs` | One row/upsert per job, but a late upsert can replace a valid result. | Keep one public row; update only in the winning fenced completion transaction. Once a lifecycle is COMPLETED, stale output writes cannot change it. An uploaded object with no completion is a recoverable obligation, not a reason to execute the GPU again. |
| Output validation/cleanup | `headObject` exposes length/type, not checksum. Comparison finalization has erasure locks. | HEAD is a presence hint; verify bytes with GET/hash when checksum is required, or explicitly extend the storage abstraction in implementation. Reuse a validated artifact intent or create a new immutable artifact; GC only unreferenced objects after the recovery retention window. Preserve comparison/source-erasure locks and tombstones; adoption cannot resurrect erased output. |
| User credit ledger | Per-job/reason uniqueness plus transactional regular termination. | No deduction on delivery/adoption. One refund across all terminal reasons for the original charge, guarded by the shared job lock/control settlement marker. Status, refund and notification obligation commit together. |
| Merchant credits | Merchant resolves to owning user; dispatcher refund/status are separate. | Pin original charged user/debit rather than trusting the message or a later merchant-owner change; use the same user settlement helper and cross-reason protection. |
| Shopify store credits and daily cap | Separate store refund transaction; cap release is Redis marker/DECR with 48h TTL and best-effort errors. | Original store/charge, atomic terminal/refund transaction; durable cap-release obligation with stable per-job marker. Retry until applied or the original counter has expired. Successful adoption does not release the consumed daily slot. |
| SSE | Publish after commit; no event identity; can be missed or duplicated. | Transactional outbox with stable event ID/state version. At-least-once publication; clients ignore stale/duplicate versions and refresh authoritative REST state on reconnect. Do not promise a replayable Pub/Sub history. Preserve user, admin, widget and store channels. |
| Merchant webhooks | XADD after completion; lost enqueue or duplicate POST possible; pending recovery absent. | Stable logical event ID in a backward-compatible header/payload, unique outbox obligation, bounded leased delivery/recovery and retry after crashes. Receiver deduplicates event ID. HTTP success with a lost response can cause another POST; exactly-once delivery is not promised. Preserve signature and URL/redirect safety checks. |
| Saree in-job mannequin phase | Intermediate key/cache and COMFY_DISPATCH exist, but replay can redo a phase. | Attempt has explicit phase and dependency; adopt mannequin prompt/output, commit phase-complete manifest, then begin final phase only once under its own intent/fence. Do not mark the whole job COMPLETED for mannequin success. |
| Saree step-2 promotion | CAS prevents concurrent promotion, but status/input/XADD are separate. | In one DB transaction lock/recheck dependency, CAS pending state, set actual persisted mannequin output key, create lifecycle/audit plus one enqueue outbox effect. Publish at least once with stable lifecycle/effect ID. A crash after CAS cannot strand the step; duplicate enqueue cannot double-dispatch. Dependency failure/refund uses the shared settlement transaction and original billing owner. |
| Thumbnail, cache warm, metrics and performance samples | Some best-effort side effects repeat; in-memory performance settlement does not survive restart. | Rebuild thumbnails as artifact effects where required; cache writes use the committed output identity. Deduplicate persistent performance samples by attempt; adoption is not a failed attempt. Metrics/logs may repeat and must not drive money or ownership. |
| XACK | Direct ACK; terminal redelivery can skip lost effects. | Keep the canonical job delivery pending until terminal settlement or a durable requeue handoff; acquisition alone is not a reason to ACK it. Terminal replay repairs obligations without GPU work. Terminal cancellation may ACK while a separately durable cleanup obligation retains the reservation. Missing transport does not delete the durable execution. Use expected consumer checks where a late owner could otherwise ACK a transferred entry. |

Changing output keys requires a consumer audit: the current step-2 promoter constructs `keys.output(mannequinJobId)` instead of reading `job_outputs`; comparison cleanup also enumerates known key forms. They must use the committed artifact reference/manifest, and retention/export/deletion must preserve its privacy rules. Add key builders in [storage keys](../../../packages/storage/src/keys.ts), preserve the `outputs/` or `widget-outputs/` routing root and job-ownership prefix, and audit [routing](../../../packages/storage/src/routing.ts) and every authorization/deletion consumer. Do not introduce an immutable-key scheme without updating those readers.

### Other task families

Known PixVerse task IDs resume polling through the existing provider client and consume video-lane occupancy, not GPU capacity. Persist its creation intent before calling the provider. The current client has no verified correlation/idempotency lookup for a lost creation response, so that case is SUBMISSION_UNKNOWN with explicit escalation, not an automatic second paid task; no new provider API guarantee is assumed. Provider adapter validation belongs in Change 2's implementation plan before claiming all video crash cases are solved.

Classify's early-ACK/short-lived response contract stays intact, but its **Comfy reservation is not ephemeral**. Before a Comfy request can be submitted, persist a reservation-linked `execution_attempts` record with requestId/clientId, owner generation, endpoint, immutable contract and request/response deadline. This record has an ephemeral-request parent and no paid-job/refund relationship. Save PREPARING before upload and SUBMITTING before POST, and save the returned prompt receipt. A crash or lost response is recovered by a reservation-only reconciler using the same exact identity rules as paid prompts.

If no submission intent exists, the reconciler may release an abandoned preparation reservation. If the prompt is queued/running, observe or safely cancel it; if finished, release after any required cleanup. If submission is uncertain or interruption unconfirmed, retain/quarantine and escalate rather than expiring the reservation. Never POST again merely to answer an expired chatbot request, publish a stale answer after its deadline, create a paid job, or change a credit ledger. The request's 8-second response budget is not a worker-availability proof. The resident HTTP classify-service path has no shared Comfy reservation; track its local promise without inventing a GPU lease for it.

Webhook tasks become leased effects and are yielded/retried independently of GPU jobs. A global “drained” result must account for all these task families, not just GPU `inFlight`.

## 11. Failure matrix

`Credits held` means the original debit remains unchanged. No acquisition/adoption charges again. Under the proposal, every genuine terminal failure/cancellation refunds once in the same transaction as its terminal decision; unresolved acceptance is not silently settled.

| Crash or SIGTERM point | Today: job, message, money, shopper | Proposed: job and message | Proposed: money and shopper |
| --- | --- | --- | --- |
| Before group claim | QUEUED/unread; original charge held; next dispatcher can read normally if capacity permits. | No job authority or external effect exists. The entry stays unread; next instance uses ordinary admission. | Same original charge; only the deploy pickup interruption. |
| After claim, before PREPROCESSING | QUEUED, PEL owned by old name; no sweeper for QUEUED; recovery may wait 30m. Shopper waits with credits held. | No submission can exist before durable acquisition. Retired/expired session's entry is targeted immediately; one successor CASes the job. An unknown claim response is recovered by session scan. | No new charge/refund; prompt pickup after handoff or lease expiry, subject to capacity. |
| During input upload | PREPROCESSING, old pending entry; partial worker inputs; later crash retry/failure or 15–20m sweep/refund. Shopper loses progress. | Short drain may finish; otherwise yield PREPARING. Resume uploads from frozen identities with attempt-scoped names, validate bytes, and submit once after acquisition. PEL retained/transferred. | Charge held; no failure attempt solely for the deploy. Changed/unavailable input before any accepted submission can become a verified terminal failure/refund. |
| After /prompt accepted, before COMFY_DISPATCH | GENERATING and pending, but no durable prompt receipt; random client ID only logged. Generic retry may duplicate GPU work; sweeper may refund and discard a successful image. | SUBMITTING intent and correlation already durable. Successor searches the exact worker for that submission, records its receipt and adopts. Absence is UNKNOWN, not rejected. | Charge unchanged during recovery. Shopper receives the original output when recoverable; ambiguous cases are visibly delayed/escalated, with no blind second generation. |
| During ComfyUI execution | Worker continues; DB GENERATING and old PEL can remain until sweep/recovery. Refund/failure can race successful GPU work. | Drain or transfer observation of the same prompt. Restore lane occupancy and reservation before new admission. Old owner cannot finalize/cancel/release after its fence is lost. | Original charge remains; completed image is delivered after observation/finalization. Only actual worker failure follows normal retry/refund policy. |
| After storage PUT, before COMPLETED | Object may exist with no output row or completion; sweep/retry may lose it or rerun GPU work. | Artifact intent/key and prompt identity survive. New owner validates the object or downloads the same completed prompt again, then commits one fenced completion. Old immutable uploads cannot overwrite it. | No extra charge. Shopper gets one committed result; a second GPU execution is unnecessary. |
| After COMPLETED, before XACK | Terminal redelivery ACKs. Output row may be fine, but SSE/webhook enqueue or worker release can be lost. | Completion/output and effect obligations are already committed. Reconciler retries effects/release and ACKs the stale message without changing terminal state. | Charge remains spent; no refund or redispatch. Shopper can poll the result; repeated SSE/webhooks carry stable identities. |
| Explicit cancellation during SUBMISSION_UNKNOWN or unconfirmed interruption, then process death | TTL cancellation can be lost. The same cancellation exception can release a GPU without confirmed stoppage; refund/status paths differ. | Persist the lifecycle cancellation and transactional settlement; keep the unresolved attempt/reservation under a durable cleanup lease, even after job ACK. Discover/cancel/observe the original prompt without resubmitting. | One cancellation refund if cancellation won the terminal race; no later success charge or delivered result. Shopper is not held financially while worker cleanup is unresolved. |
| Early-ACK classify request after accepted/ambiguous POST | No pending message or durable receipt is guaranteed; worker may keep running after `finally`/restart makes it available. Chatbot request may already have expired. | Reservation-linked ephemeral attempt retains correlation and is reconciled without replaying the request. Unknown remote work keeps the reservation quarantined; finished work safely releases it. | No job charge/refund exists. Expired answer is not republished; capacity returns only after physical resolution. |

The same phase boundaries must be exercised with SIGTERM and abrupt SIGKILL. SIGTERM can use the short drain; SIGKILL cannot. Neither is itself a business failure. A total worker/history/output loss is a separate irrecoverable-result incident and must not be disguised as ordinary dispatcher recovery.

## 12. Test plan — real Redis/Postgres, fake worker HTTP

Use docker-compose Redis/Postgres/MinIO and the existing isolated per-file DB/bucket helpers; no testcontainers. Run actual child dispatcher processes for signal tests, with deterministic barriers around durable state and fake worker HTTP routes. Do not mock Redis ownership, DB transactions, constraints or provider receipt persistence. Extend the Comfy HTTP fake to preserve queue/history across dispatcher restarts, correlate client IDs, count POSTs and model delayed/lost responses and stable output bytes.

### Required failure injection

For each row of the matrix: pause at the boundary; send SIGTERM; repeat with SIGKILL; start a successor with a different session; assert DB state, PEL ownership, worker reservation, ledger balance/refund count, output identity and emitted effect IDs. The old fake worker must keep executing when its dispatcher dies. Assert one `/prompt` for an accepted attempt and no `DISPATCHER_CRASH` business failure from a deployment.

Specific cases:

1. Adopt a still-running prompt and a completed-but-unfinalized prompt; verify no additional upload/POST and correct result-node selection. Cover shared GPU, in-house comparison, Shopify, merchant widget and each two-phase mannequin/final boundary.
2. Accept POST but suppress its response and stop before the event write; recover by persisted client ID. Repeat with worker-supplied prompt ID, supported caller-chosen ID, metadata mismatch, multiple matches, history pagination, worker restart/history loss and complete absence. Never automatically resubmit an uncertain attempt.
3. Duplicate entry while the job is live, duplicate canonical delivery after ownership transfer, two claimers racing QUEUED, two adopters racing lease expiry, a valid owner processing longer than Redis consumer idle, and a paused old owner resuming after its lease expires. Assert losers cause no status, attempt, charge, refund, worker-release or prompt effect.
4. Stop during a blocked wake/group read and after Redis claims but before the response is delivered. Retire the instance; recover an unstarted message without a 30-minute wait. Capacity zero and registry refresh must not strand already-running adoptions. Restore more adopted jobs than the new cap and assert no new executions until occupancy permits.
5. Kill during input upload, after object PUT with a lost response, during thumbnail PUT, between output metadata and completion (inside the DB transaction), after completion commit, after outbox enqueue and after an external webhook accepted but before its success receipt. Validate immutable artifact selection and at-least-once effects with stable IDs.
6. Race genuine failure, completion, cancellation, sweeper and admin retry. Test user, merchant-owner and Shopify ledgers, all terminal reason combinations, zero cost, unlimited-plan zero debit, existing legacy refund and a missing billing owner. Assert one original debit, at most its one refund, and no terminal failure committed without its refund obligation. Fault DB commit and retry; ensure no ACK discards unsettled work. Cancel during SUBMISSION_UNKNOWN; delete Redis cancellation hints; fail/deny scoped interruption; kill the cleanup owner. Cancellation/refund must survive while the worker reservation remains until confirmed resolution. A stale cancel cannot affect the next lifecycle.
7. Preserve original deadlines across three successive adoptions. A healthy long-running prompt is not swept merely at 15 minutes. Test unreachable/malformed queue/history, DB outage, Redis outage/restore, PEL trimming and missing entries. Leases fail closed and recovery does not flood connections or POSTs.
8. Restart with a BUSY worker; assert registry bootstrap never exposes it as IDLE. Delay the old owner's release command until the new owner/another execution holds a reservation; the old token must not release it. Include DRAINING/removed/changed-endpoint workers and classify's ephemeral reservations.
9. Kill saree promotion after CAS, input update, outbox commit and XADD response loss. A completed mannequin creates one logical step-2 enqueue with the actual committed output key; a failed mannequin creates one terminal refund. Replays do not recreate deleted comparison/customer data.
10. Fault replacement-message append and ACK separately. Append failure leaves original pending; successful call retries do not append again; ambiguous partial failure cannot double-dispatch. Keep unknown stream fields and retryCount intact. The 10-second delay/cap policy remains unchanged except that shutdown can yield its obligation.
11. Fake PixVerse running/finished task adoption, lost creation response and long task drain. Assert no second provider task for UNKNOWN acceptance. Test webhook and classify handlers during global drain so Redis/DB are not closed before tracked work finishes or yields. Kill classify after early ACK, during upload, after POST acceptance and before receipt, and after its response deadline; reconcile only its reservation, never POST again or publish an expired answer, and prove the reserved worker cannot be double-allocated or silently forgotten.
12. Two dispatchers on shared streams/DB, separate session UUIDs, simultaneous recovery and distinct new jobs. Confirm per-worker exclusivity, common lane accounting, bounded recovery observer work, and safe consumer cleanup only after PEL is empty.

Use deterministic barriers for ownership/acceptance windows rather than tight wall-clock assertions. Measure actual drain/recovery bounds with comfortable scheduling margins. Run dispatcher unit and integration suites, relevant API billing/cancel/admin-retry/saree tests, TypeScript/lint and migration checks. Tests are a plan here; none were added or run in this design-only task.

## 13. Rollout and rollback

### Safe first deployment: the old binary cannot drain

Adding a new stop grace in the incoming Compose file is insufficient: the old handler still exits. Do not first-deploy by an ordinary force-recreate while it owns active jobs, and do not run old and new paid-job processors concurrently: the old binary ignores the new fences and reservations.

There is a second first-rollout hazard: the old recovery and age-only sweeper remain active while an operator waits for a natural drain. An already-dead legacy prompt can cross its 15-minute threshold and be refunded/failed during that wait. Current code has no supported switch to stop those timers independently. Adding a new switch to the incoming binary cannot control the already-running old process.

| First-transition option | Developer/operations benefit and cost | User benefit and cost |
| --- | --- | --- |
| Natural drain under an admission hold | Simpler if there are no vulnerable legacy executions and every current job can finish before an unsafe old sweep. Requires proving those preconditions and continuously checking them; not a general solution for the cited incident. | Running jobs can finish in the old process, but waiting exposes abandoned accepted jobs to the old timers and can prolong maintenance. |
| **One-time stop-and-adopt maintenance transition** | Needs a reviewed operational fence that prevents all further old JavaScript execution before replacement, plus a tested legacy importer. Avoids relying on a nonexistent old-binary pause API. | Temporarily pauses pickup/finalization, but ComfyUI continues accepted work and old timers cannot newly fail it during deployment. Legacy submission identity gaps remain explicit UNKNOWN cases. |

Recommend the second option for the first production transition when legacy in-flight jobs exist. It is an **adopt-only bootstrap**, followed by the hybrid policy for subsequent deploys. A concrete candidate operational fence is SIGSTOP of the exact old Node process followed by SIGKILL **without SIGCONT** before replacement. The [Dockerfile](../../../apps/dispatcher/Dockerfile) uses exec-form Node as the main process; verify that exact PID/process layout in staging and production preflight. [Docker supports sending a chosen signal to the main process](https://docs.docker.com/reference/cli/docker/container/kill/), and [Linux signal semantics](https://man7.org/linux/man-pages/man7/signal.7.html) make STOP/KILL uncatchable. Do not substitute a Docker pause/stop/unpause sequence whose thawing behavior has not been proven: resuming old callbacks reopens the sweeper race.

This is a proposed, operator-reviewed runtime procedure, **not an action authorized by this design-only task**. Prove it on the staging runtime before relying on it. If the runtime cannot guarantee the old process stays stopped until termination, the first rollout is blocked until an equivalent supported process fence exists; do not experiment on production.

First-transition sequence:

1. Prebuild/test the new ownership-aware image and compatibility importer and prepare a usable new-protocol recovery image before the maintenance window. Review the additive migration; no legacy column removal. Apply schema only through push → CI/CD → `db:migrate:prod`. No direct production SQL, schema generation or data repair is part of this plan.
2. Establish a controlled hold on **all job producers**, using an API/operator mechanism delivered through normal releases or a reviewed maintenance rule that rejects before charging. Include scheduled/internal producers and temporarily hold mutating cancel/retry/delete endpoints until their new shared settlement helpers are installed; status/history/SSE remain available. A supported hold is a prerequisite if none exists today, not an assumed current capability. Capture a read-only inventory of legacy executions, current consumer entries, worker prompt identities and relevant correlation logs without exposing secrets.
3. Suppress automatic restart of the specifically identified old container for the transition, record the original runtime policy, then STOP its main process promptly. Pin container/PID/start identity so no later command can target the new replacement accidentally. This stops claims, the unsafe sweeper/recovery timers, promotions and old finalizers together. Do not wait for a long natural drain while those callbacks are still running. Already-issued DB requests may finish before the fence takes effect; observe committed state after process termination and never roll back an already-settled financial outcome by inference.
4. Terminate the stopped old process without resuming it; verify exit and closed DB sessions before the new application starts ownership work. Remote ComfyUI prompts keep running. Keep stream entries, history and artifacts intact. Preserve evidence of any in-flight legacy POST; match its COMFY_DISPATCH or recorded client correlation when possible. A missing legacy receipt/correlation remains UNKNOWN and quarantined, never silently treated as rejected. The pre-intent gap in an old binary cannot be retroactively eliminated.
5. The reviewed CI/CD procedure applies/verifies the additive migration and recreates the stopped container with the new image while the hold remains. Deploy the participating API terminal/cancel/retry helpers in this same protected transition; there must be no old unfenced mutating job writer left when the hold is released. Verify actual executed code and new ownership-aware recovery/sweeper before starting adoption. New startup reconstructs reservations before any registry IDLE exposure.
6. Bootstrap legacy attempts from verified matching COMFY_DISPATCH records, including prompts already completed on the GPU. Reconcile terminal legacy rows as terminal; do not undo an old refund or deliver a paid completion on top of a prior terminal decision without an explicit separate product action. Known accepted nonterminal jobs are adopted, not crash-failed. Unknown legacy cases use the audited recovery/operator path, not ad-hoc production data edits.
7. Verify leases, reservations, effect delivery and readiness; release the hold for a small cohort, restore the normal replacement container restart policy from Compose and monitor. On deployment failure, keep the hold and use the prepared new-protocol recovery image/roll-forward path; do not simply resume the old stopped process with active new-protocol work.

The one-time maintenance interruption includes migration/bootstrap and can exceed 95 seconds; do not promise a 120-second first rollout. After Change 2 is installed, normal deployments use the 20s drain/adoption protocol without waiting for the entire queue to empty or freezing the process.

### Staging acceptance

- Apply the additive migration to an isolated local/staging database and run all tests above. Inventory each deployed worker's existing recovery API shape and retained client correlation; no workflow/GPU changes.
- Start the old version with fake running and finished Comfy prompts, exercise the protected first-rollout admission hold and STOP/KILL-without-resume fence, then install the new version. Let an abandoned legacy job cross the old sweep threshold during the hold/fence; prove old callbacks cannot fail/refund it before adoption. Separately import a legacy COMFY_DISPATCH with an already finished result and verify it becomes the correct output with unchanged credits. Test the runtime restart-policy guard, a failed deployment and refusal to resume the unfenced old process.
- Deploy the new version twice with real HTTP-fake jobs crossing every boundary. Observe old-session retirement, bounded pickup interruption and takeover, unchanged accepted POST count, protected worker BUSY state and eventual empty/expected PEL.
- Run two instances, a forced kill, a 40–95s execution, a storage failure and a database/Redis partition. Inspect output and ledgers, not only a green health endpoint. Test real staging worker adoption only with an isolated authorized worker and test account, after the fake-worker contract is proven.
- Verify user/store/widget/admin status convergence, webhook retries/event IDs, comparison erasure and saree promotion. Capture enqueue → consume → claim → submit and recovery → visible-result separately; this release's goal is survival, not a claimed latency improvement.

### Production checks

Record deployed commit and executed asset hashes, configured grace/drain/lease/recovery settings and readiness behavior. Read configuration without printing credentials. Use the controlled first transition above; subsequent releases use the new drain.

Monitor `active_owned_jobs`, adopted/running/finished counts, lease renewal failures, lost-ownership rejections, unresolved submissions, oldest recoverable age, worker reservation/cache mismatches, pending entries by dead/live session, outbox lag and terminal refund conflicts. Alert on any POST for an already accepted attempt, in-progress “crash failure,” terminal transition without corresponding settlement, or old-token release accepted after takeover.

For a deployment cohort, verify that prompts accepted before replacement complete afterward, outputs resolve to the correct prompt, the original charge is unchanged on success and failures receive one transactional refund. Inspect browser/storefront status through its existing authenticated paths; do not treat SSE count alone as delivery proof. Audit the cited incident as a legacy-adoption fixture on staging; this design does not authorize repairing that production row.

### Rollback

Prefer rolling forward. Keep additive schema and attempt/outbox data. Pause fresh admission while leaving ownership-aware observation and settlement running. An old fence-unaware binary must not be rolled back into a fleet with active new-protocol attempts. If rollback is unavoidable, first use the new protocol to quiesce all current work and effects, verify no unresolved submissions/reservations, then use a separately reviewed compatibility rollback. Do not drop the new tables, clear PELs or release reservations as a rollback shortcut.

## 14. Review decisions and remaining limits

The proposed defaults and architecture are recommendations, not user-approved implementation choices. Review should confirm the 20s/45s and 5s/30s budgets, Postgres ownership/migration scope, omission of copy handback, the immediate replacement-handoff fix in Change 2, prompt refund with independently durable cancellation cleanup, durable classify reservation reconciliation, and the one-time maintenance process fence/legacy adoption bootstrap.

Explicit limits: worker history/output retention and response shape must be validated per worker; no external exactly-once guarantee exists; unresolved acceptance can require operator action and a separate compensation policy; PixVerse unknown-creation lookup is not verified; and same-host stop-before-start deploys retain a short pickup interruption. These are not reasons to keep failing known accepted prompts on dispatcher replacement.
