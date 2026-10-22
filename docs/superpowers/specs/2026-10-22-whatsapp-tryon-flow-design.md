# WhatsApp bot — try-on flow (pose pool, no catalogue templates)

Date: 2026-10-22 · Status: draft for approval · Builds on `feat/whatsapp-early-classify-and-pose-cards`.

## Goal
Replace the bot's catalogue-job path (garment type, face, background, look templates) with the
direct **try-on** path: one garment photo plus one admin-curated pose image per output, each
pose carrying its own try-on workflow. The seller answers three questions: garment photo,
gender, how many poses. The bot draws the poses, so no pose browsing and no template mapping.

The current catalogue flow stays in the code, untouched, behind a switch. It is removed only
after this flow is approved.

## Decisions (user, 2026-10-22)
1. **Chat flow:** upload garment → gender (Men / Women / Boys / Girls) → pose count (1 / 3 / 5) → generate. Credits are shown on the count options; tapping a count is the agreement to spend (D45), so there is no separate confirm step.
2. **Pose pool lives in `model_pose_assets`** (reuse, no new pose table). A new admin view over those rows, with Full and Half sections.
3. **Back poses are out for now.** The API rejects a back-view pose without a photo of the garment's back (`jobs/create.ts`, `garmentView === 'back'`), and the bot will not ask for one yet.
4. **Split per count, Full drawn first:** 1 → 1 Full · 3 → 2 Full + 1 Half · 5 → 3 Full + 2 Half.
5. **Each pose has a try-on workflow and a gender tag.** The bot filters by the tapped gender and uses the pose's own workflow.
6. **Old code is kept**; the new flow is added beside it.

Assumptions to confirm (not stated by the user): no garment-type step and no recognition step in this flow; closing buttons are *Make more* / *New garment* / *Menu*; no Retry-failed button in v1 (failed jobs are refunded by the dispatcher).

## What already exists and is reused
- **Direct try-on job shape** (`apps/api/src/modules/dev/create-job.ts`, `createDevJobCore`): `job_inputs.upperGarmentKey` + `params.personKey` + `params.workflowTemplateId`, run by the dispatcher's `processTryonDirectJob`. Insert, credit deduct, enqueue and refund-on-enqueue-failure are in `createDevJobCore`.
- **Cost:** `getTryonCreditCost(app)` (admin-configurable, default `SIMPLE_TRYON_COST` = 5 per image).
- **Delivery:** `messaging_runs` is a list of job ids; `deliverRun` / `deliveryTick` send any finished job's output and then the closing message. Nothing in it is catalogue-specific except `failedPoseIds` (reads `job_inputs.poseId`, which direct try-on jobs leave null).
- **Pose columns:** `model_pose_assets` already has `shot_type` (`full` | `half` | `closeup`, validated in Zod), `gender_slug`, `workflow_template_id`, `r2_key`, `is_active`, `deleted_at`, `scope`.
- **Engine/infra:** pure state machine `(session, event) → (session, messages)` with I/O through `EngineDeps`, Redis sessions, nonce on every button id, WhatsApp limits (button ≤ 20, list row ≤ 24, list ≤ 10 rows).

## Data
One migration on `model_pose_assets`:
- `whatsapp_pool boolean not null default false` — the bot draws only from rows where this is true.

Eligible for the draw (all must hold): `whatsapp_pool`, `is_active`, `deleted_at is null`, `workflow_template_id` not null and that template active, `shot_type in ('full','half')`, `gender_slug` set.
`closeup` and `scope` are untouched. Migrations are generated and applied locally/staging only (CLAUDE.md, Production safety).

Gender mapping: the four chat choices use the existing gender slugs (`men`, `women`, `boys`, `girls`) already used by `listGarmentTypes` and the studio.

## Pose draw (pure function, `engine/rules.ts`)
`SPLIT = { 1: {full:1, half:0}, 3: {full:2, half:1}, 5: {full:3, half:2} }`.
`drawPoses(pool, gender, n, shuffle) → PoolPose[]`: filter by gender, group by shot type, shuffle each group with the injected `deps.shuffle`, take `SPLIT[n].full` then `SPLIT[n].half`. A short category yields what exists. Available counts for a gender: an option `n` is offered only if the gender's pool can fill `SPLIT[n]` exactly and the balance covers `n × perImage`.

## Engine (new module, selected by flag)
`WHATSAPP_BOT_FLOW` env (`catalogue` default | `tryon`), read in `deps.ts`/`conversation.ts` to choose the engine. The new engine is `engine/tryon-engine.ts` with its own states:

`MAIN_MENU → ASK_GARMENT_PHOTO → ASK_GENDER → ASK_POSE_COUNT → GENERATING → DELIVERED` (+ `NO_CREDITS`).

- **Photo:** stored with the existing `storeGarmentPhoto`; session keeps `garmentKey`.
- **Gender:** list of four; tap sets `gender`, loads the eligible pool, and goes to the count list.
- **Count:** list rows `"1 pose (5 credits)"`, `"3 poses (15 credits)"`, `"5 poses (25 credits)"` (titles ≤ 24 chars). Only affordable and fillable options are listed. Nothing affordable → `NO_CREDITS` (existing top-up path). Nothing fillable for the gender → message that no poses are set up yet (admin alert via the existing `reportUnavailable` hook).
- **Generate (count tap):** balance rechecked, poses drawn, jobs created (below), `messaging_runs` row written, `GENERATING` message. A stale tap (old nonce) re-renders the current step.
- **DELIVERED:** summary (images delivered, credits used, remaining balance) then buttons *Make more* (→ `ASK_POSE_COUNT`, same photo and gender), *New garment* (→ `ASK_GARMENT_PHOTO`), *Menu*. The runFinished event carries delivered/failed counts; failed jobs are already refunded.

Copy follows the Flow 2 style (`engine/copy.ts`), new keys only; the old keys stay.

## Job creation (`modules/messaging/tryon-jobs.ts`)
`createWhatsappTryonJobs(app, { userId, accountId, garmentKey, poses }) → { jobIds }`:
- For each pose: call `createDevJobCore` with `apiKeyId: null`, `source` = a new `JOB_SOURCE.WHATSAPP_TRYON` value, `cost = getTryonCreditCost`, `watermark: false`, and `buildJobInputs` returning `{ upperGarmentKey: garmentKey, params: { personKey: pose.r2Key, workflowTemplateId: pose.workflowTemplateId, dispatchTemplateVersion } }`.
- Garment key ownership is verified the same way as today (`verifyGarmentKey` equivalent for the WhatsApp upload).
- Preflight before any charge: workflow template active, a tryon-capable worker exists. A failure at pose *k* leaves jobs 1..k−1 created and charged; they are delivered normally and the rest is reported as not started (refund for those is not needed since they were never charged). The message tells the seller how many were created.
- The merchant job rate limit (`assertMerchantJobRateLimit`) is applied once per run, not per pose.

## Admin
- **API** (`modules/admin/models.routes.ts`, same permission as pose assets): `GET /admin/whatsapp-poses` (pool rows with shot type, gender, workflow, thumbnail, plus per-gender × category counts), `PATCH /admin/whatsapp-poses/:id` (`whatsappPool`, and the existing `genderSlug` / `workflowTemplateId` / `shotType` edits are reused, not duplicated). Audit via `recordAudit` like other pose edits.
- **Admin UI** (`apps/admin-web`, new tab *WhatsApp Poses* next to Pose Assets): two sections *Full* and *Half*; each lists pool poses (thumbnail, gender chip, workflow chip, remove), plus *Add from Pose Assets* (picker of eligible-but-not-in-pool poses). A header strip shows, per gender, pose counts per category and flags a gender that cannot fill the 5-pose split. Uses `PremiumSelect`-style rules for admin-web (`SearchableSelect`), no raw `<select>`.

## Not in scope
Back poses and any back-photo step; garment recognition/kind confirmation; face, background and catalogue-template choices; Retry-failed buttons; removing the old catalogue flow; Messenger/Instagram.

## Risks / open items
- Delivery for non-catalogue runs: `failedPoseIds` is empty for these jobs; the new engine reads counts from the run, not poses. To confirm when planning (small change in `deliverRun`'s runFinished event, or a flow-aware branch).
- `JOB_SOURCE` gets a new value; the admin jobs list and metrics label it by source, so check they tolerate an unknown source.
- Pool thin for a gender → fewer count options; surfaced to admins by the strip and `reportUnavailable`.
- Workflow quality per pose is the admin's responsibility (a pose with a bad workflow produces bad images); the pool toggle is the kill switch.
- Real-device WhatsApp check of the list rows and the draw is still needed before approval.

## Tests
- Unit: `drawPoses` (splits, gender filter, short categories, shuffle injected); available-count rules (fillable + affordable); engine state transitions with fake deps, including stale nonce, NO_CREDITS, no poses for gender, Make more keeps photo and gender.
- Integration (API, real Postgres/Redis): `createWhatsappTryonJobs` creates N jobs with the right inputs and charges `N × cost`; partial failure charges only created jobs; admin pool routes (list, toggle, validation of eligibility); delivery of direct try-on jobs through `deliverRun`.
- Admin-web: component render of the tab sections and the per-gender strip.
