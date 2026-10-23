# Workflow comparison sweeper — design

Date: 2026-10-22. Status: draft for approval. No product code has been written.

## Intent and why

The admin team wants to know whether the **general** try-on workflow can replace
the many specialised workflows. Today there is no way to see that on real traffic.

The feature: a disableable sweeper that watches completed jobs, re-runs each one's
inputs through the general workflow on an in-house worker, and shows the input
images, the original result and the general result together on one page.

The general workflow already exists in production: `tryon_categories` and
`dev_tryon_categories` both have an active `general` row pointing at the template
`tryon22102026` (version 1, created 2026-10-22). It takes one person image
(node 143) and one garment image (node 20147) and outputs node 29132.

## Goals

- Automatically replay eligible completed jobs through the general workflow.
- Link each replay to its source job by ID and show both results next to the inputs.
- Show jobs that could not be replayed in the list with their reason, so unsupported
  job types are visible and not silently missing.
- Be switchable on and off from the admin, with clear behaviour for work already in flight.

## Non-goals (version 1)

- Replaying jobs that use face / background / pose, saree, catalogue, regenerate, video or
  fabric-to-garment inputs. These are recorded as `UNSUPPORTED` with a reason code.
- Any review, verdict, notes or scoring. The joined page is the end of the workflow; judging is done by looking.
- Strict priority over manual in-house tests, or preempting a running comparison.
- Any customer-visible effect.

## Anti-goals (failures even if it technically works)

- A comparison job ever charges, refunds or otherwise touches a customer's credits.
- A comparison job appears in any customer's history, notifications, webhooks or exports.
- Comparison jobs inflating production analytics or queue-capacity numbers.
- A comparison run stranding a customer's image beyond its erasure.
- A replay loop (comparison jobs being collected as sources).

## Approach

Reuse the normal job pipeline instead of building a second execution path. The
sweeper creates a **real `jobs` row** for each replay, on the existing `jobs:inhouse`
lane, and a link table ties it to its source. Earlier drafts used a separate
execution path (own table, own consumer); that was dropped because the existing
processor, retry, stuck-job sweeper and result storage all work unchanged.

Trade-off accepted: reusing normal jobs means each place that reads `jobs` must be
checked and given an explicit exclusion (see "Paths to handle"). A separate executor
would avoid that, at the cost of owning another execution lifecycle.

### Components

1. **`workflow_comparisons` table** (new, via the normal migration flow — never written
   to production by hand).
   - `id`, `source_job_id` (FK `jobs`), `general_job_id` (FK `jobs`, nullable until dispatched)
   - `template_id`, `template_version` — the general template frozen for this run
   - `status`: `COLLECTED`, `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `UNSUPPORTED`, `EXPIRED`, `CANCELLED`
   - `unsupported_reason` (machine-readable code, e.g. `NO_PERSON_IMAGE`, `FACE_POSE_BG_JOB`)
   - `source_workflow_template_id`, `source_source` (the original job's `jobs.source`) for filtering
   - **Unique** `(source_job_id, template_id, template_version)` so overlapping sweeps
     cannot duplicate a run, while a later general-template version can be compared on purpose.
2. **Collector** — records eligible completed source jobs as `COLLECTED` (or
   `UNSUPPORTED` with a reason), up to the backlog cap. Independent of capacity, so busy
   periods do not cause source jobs to be missed.
3. **Dispatcher-side creation** (in the api process) — when capacity is free, creates one
   linked job from the oldest `COLLECTED` row and sets it `QUEUED`.
4. **Admin tab** — settings, a list, and a detail page.

Both loops run in the api process, started in `apps/api/src/main.ts` after `listen`
(like the existing loops), each `setInterval` + re-entrancy guard, exporting its tick
function for tests.

### Eligibility (decided from stored inputs, not from which app made the job)

A source job is eligible if it is `COMPLETED`, has a result in `job_outputs`, is not
itself a comparison job, is not already using the general template, and its stored
inputs contain a usable person image and one garment image:

- direct try-on jobs: `job_inputs.params.personKey` + `upperGarmentKey`, with no
  `faceId` / `backgroundId` / `poseId`;
- widget (merchant / Shopify) jobs: `jobs.customerPhotoKey` + the garment key. **How
  widget jobs store the garment must be confirmed by the builder** (not verified here).

Anything else is recorded `UNSUPPORTED` with a reason code. Classification is by
stored shape — the same discriminators `processJob` uses to route jobs
(`apps/dispatcher/src/job/processor.ts`, around lines 215-330).

### Creating the replay job

A new creation function (not `createDevTryonJob` / `createDevJobCore`, which call
`atomicDeduct`):

- `cost = 0`, no `credit_ledger` row, no `atomicDeduct`.
- Owned by a dedicated **system user** (created by migration or a seed, not by hand);
  no `merchantId`, no `shopifyStoreId`, no API key.
- New `JOB_SOURCE` value, `comparison`. Adding it will trip every exhaustive map over
  `JOB_SOURCE` (e.g. `packages/types/src/image-compression.ts`,
  `apps/api/src/lib/queue-capacity-config.ts`, the job-taxonomy registry test); each needs an
  explicit entry.
- `job_inputs`: reuses the **source job's object keys** (person, garment) — it does not
  copy the images. `params`: `personKey`, `workflowTemplateId`, `dispatchTemplateVersion`
  (both frozen), `inhouse: true`. **Do not set `primaryWorkerIds`.** Verified: a job
  with pinned workers fails terminally (`PREFERRED_WORKERS_UNAVAILABLE`) the moment none is
  claimable, with no requeue. Pool-only dispatch (`selectWorker` on the `inhouse` pool)
  requeues with backoff and only dead-letters after 3 hours (`MAX_QUEUE_WAIT_MS`).
  "Worker 2 as preference" therefore comes from being the only worker tagged `inhouse`
  today, not from pinning. A second in-house worker later works with no change.
- `lane: 'inhouse'`, enqueued to `jobs:inhouse`. Existing consumer, retries and
  stuck-job sweeper apply unchanged.

### Version pinning

The general template is resolved **once, at collection**, from the active `general`
category; its template ID and version are stored on the comparison row and written into
the job as `workflowTemplateId` + `dispatchTemplateVersion`. The dispatcher's
`resolveWorkflowTemplateVersion(db, id, snapshotVersion)` already resolves a snapshot
version, so retries stay on the same version even if the template is edited. (Builder's
call, marked as mine: pin at collection, not at dispatch. A backlog that waits days
runs on the older version; the retention limit below bounds that, and an admin
"re-run on current version" action creates a new row, which the unique key permits.)

### Dispatch rule (version 1, honest about its limits)

Create at most one comparison job at a time, and only when all hold:
- the feature is enabled;
- no comparison job is `QUEUED` / in progress;
- no non-comparison in-house job is `QUEUED` / in progress (checked in Postgres by status
  and `params.inhouse`, not by reading Redis);
- an `inhouse` worker is healthy and idle.

This is **not** strict priority. A manual in-house test that arrives right after the
check waits behind the comparison that just started, and a running comparison always
finishes. Strict priority would need scheduler changes; preemption more. Accepted for
version 1.

### Settings

Stored with whatever settings mechanism the admin already uses (builder to match
existing patterns): `enabled`, `backlog_cap`, and `retention_days` (collected rows older than this go
`EXPIRED`; completed comparisons and their output images are deleted after it).

### Toggle behaviour

| State of comparison | Turning the feature **off** | Turning it back **on** |
|---|---|---|
| Not yet seen source jobs | Collector stops; nothing is recorded | Collecting resumes from "now"; jobs completed while off are not back-filled |
| `COLLECTED` | Stay as they are; no new jobs created | Dispatch resumes from the oldest; rows past retention are `EXPIRED` first |
| `QUEUED` (job created, not started) | Left to run — they are normal jobs. Admin gets an explicit **Cancel queued comparisons** action that uses the existing `CANCELLED` termination path | n/a |
| Running | Always finishes; never interrupted | n/a |
| `COMPLETED` | Unaffected; page keeps working | Unaffected |

The settings panel shows the remaining backlog (collected, queued, running) while off, so
"disabled" is never mistaken for "empty".

### Admin tab

Follows `docs/admin-url-routing-standard.md`; any dropdown uses `SearchableSelect`.
- **Settings and controls** at the top: on/off, backlog cap, retention, cancel queued.
- **List:** one row per comparison with source workflow, status (unsupported rows show
  their reason) and a status / source-workflow filter.
- **Detail page:** input person + garment, original result, general result, plus the
  source and general workflow/worker, template version, timings and any error.
- Needs an admin permission via `requirePermission`; settings changes and cancel write
  `audit_logs` through `recordAudit(tx, …)` per the existing invariant.

## Paths to handle (verified vs not)

| Path | Finding | Required action |
|---|---|---|
| Credits / refund | `terminateJob` only refunds when `creditsCharged > 0`; with 0 nothing is written to `credit_ledger` or `user_credits`. **Verified** (`processor.ts` ~3576–3668) | Creation function must not call `atomicDeduct` |
| Webhooks | Outbound webhooks are queued only for jobs with a `merchantId` (`processor.ts` ~3463–3492; consumer `stream/webhooks.ts`). **Verified** | None, as long as the system user has no merchant |
| SSE | Publishes to `sse:events:{userId}` and `sse:events:admin`. **Verified** | None; the admin feed seeing them is fine |
| Customer history/lists, emails, WhatsApp delivery | **Not verified** | Builder audits each reader of `jobs` by user; system-user ownership should hide them, but confirm |
| Analytics / metrics | `jobs` is referenced ~250 times across admin, dev analytics, credit analysis, queue-capacity config and metrics. **Not audited** | Builder audits; known candidates: `admin/credit-analysis.routes.ts`, `lib/queue-capacity-config.ts`, `dev/analytics.ts`, `packages/observability/src/metrics.ts` (`recordJobOutcome`), `admin/jobs.routes.ts`, `admin/job-type.ts` |
| Upload sweeper | Deletes `inputs/` objects not referenced by any `job_inputs` garment column after 24h. **Verified** | Shared keys stay protected while any job references them; no change expected, but confirm for `personKey` |
| Shopify GDPR erasure | Deletes `customerPhotoKey` and `job_outputs` result/thumbnail keys per shopper/store (`shopify/gdpr.ts`). **Verified** | Must also delete the **general job's output** objects for any erased source job, and mark the comparison `EXPIRED` if inputs are gone before it ran |
| Admin user deletion | `jobs.user_id` cascades on user delete; the system-owned replay would not be reached. **Partly verified** (`admin/users.routes.ts` ~586–623 not read in full) | Deleting a user's jobs must also remove their linked replay job and outputs |
| Retention | None exists for this data | Sweep comparison jobs/outputs after `retention_days` |

Privacy stance: a replay reuses the source object keys rather than copying inputs, so no
new copy of a person's photo exists; only the **new output** is extra personal data and
must follow the same erasure and retention rules as the source's output.

## Constraints

- Postgres schema changes ship through push → CI/CD → `db:migrate:prod`; never run against production by hand.
- Credit deduct + job insert stay one transaction for real jobs; comparison jobs sit outside that flow (cost 0).
- `workflow_templates.jsonContent` is never mutated; the dispatcher already clones and patches.
- A single in-house worker means one comparison at a time; throughput, not correctness, is the limit.

## Left to the builder

- Exact settings storage mechanism; table/column names; reason-code list.
- How widget (merchant/Shopify) jobs store garment and person keys.
- The analytics/read-path audit and the exact exclusion for each.
- Collector cursor mechanics (e.g. by `completed_at`) and tick intervals.
- Retention default (suggested: 30 days).
