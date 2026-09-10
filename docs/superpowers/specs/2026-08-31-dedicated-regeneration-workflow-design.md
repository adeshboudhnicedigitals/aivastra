# Dedicated Regeneration Workflow

**Status:** Approved design, not yet implemented.
**Date:** 2026-08-31

## 1. Problem Statement

Today, "regenerate" (`apps/api/src/modules/jobs/regenerate.ts`) re-runs the
**entire original job** through whichever pipeline created it
(`createJob`/`createSimpleTryonJob`/`createSareeJob`), with only the prompt
text swapped for an admin-configured alternate matched to the reason the user
picked. Every `workflow_templates` row carries its own
`regenerationReasonPrompts` (reason → alternate prompt), and
`resolveEffectiveWorkflowTemplateId` re-derives which template the *original*
job would dispatch through today, purely to look up that template's own
reason list.

This is being replaced with a single dedicated ComfyUI workflow (source:
`regen.json`, root of the repo) that every regenerate click runs, regardless
of what produced the original image. Its only input is the **original job's
own generated output**; its only variable is the **reason-selected prompt**.
No other workflow template carries regeneration reasons any more — this
concept now lives in exactly one place.

## 2. The `regen.json` graph

Confirmed clean (an earlier version of this file, `regeneration.json`,
contained a second disconnected node cluster — `FashionSegmentClothing` nodes
with no wired image input — that has been removed from `regen.json`).

Active chain: `151` `LoadImage` (title `"person"` — the image being
regenerated) → `142` `ImageScaleToTotalPixels` → `154`
`TextEncodeQwenImageEditPlusPro_lrzjason` (`prompt` = reason text, patched;
`instruction` fixed) → `146` `KSampler` (using `149` `CLIPTextEncode` as the
fixed, never-patched negative) → `145` `VAEDecode` → `150` `Save Image With
Callback` (result).

One input image, one output, one prompt node — simpler than every existing
workflow type (`regular`, `tryon`, `saree`, `two_stage`, ...), all of which
require at least a garment node.

## 3. Workflow template: new `workflowType = 'regeneration'`

Reuses existing `workflow_templates` columns — no new columns:

| Column | Value for this type |
|---|---|
| `tryonPersonNodeId` | `151` (source image = original job's output) |
| `garmentPhasePromptNode` | `154` (reason prompt — patched) |
| `facePhasePromptNode` | `149` (negative — never patched, stored for reference) |
| `tryonOutputNodeId` | `150` (result) |
| `regenerationReasonPrompts` | reason → prompt pairs, now meaningful **only** on this template |

Extends the *generic* admin workflow system rather than adding a bespoke page
(the way `saree` has one): saree's dedicated page
(`apps/api/src/modules/admin/saree.routes.ts`) exists because saree needs
*extra* config (model image, sample image) beyond the template row itself;
regeneration needs nothing beyond the template, so it fits the generic
`CreateWorkflowBody`/`extractWorkflowInsertFields` system and inherits
replace/archive/versioning for free.

- `packages/types/src/admin.ts`: add `'regeneration'` to the `workflowType`
  enum in `CreateWorkflowBody` and `ParseWorkflowBody`; add a `superRefine`
  branch requiring `tryonPersonNodeId`, `tryonOutputNodeId`,
  `garmentPhasePromptNode`, `facePhasePromptNode` (mirrors the `tryon` branch,
  minus the garment-node requirement).
- `apps/api/src/modules/admin/workflows.routes.ts`
  `extractWorkflowInsertFields`: add a `workflowType === 'regeneration'`
  branch modeled on the existing `'tryon'` branch — reuse `detectTryonMappings`
  for auto-detection (node `151`'s title `"person"` matches the same
  convention `tryon` already detects on), validate `personNodeId` +
  `outputNodeId` + both prompt nodes exist and are the right type, no
  `garmentNodeId` requirement.
- **Single-active enforcement**: mirror `saree.routes.ts`'s "demote existing
  active row in the same transaction" pattern — a small conditional inside the
  generic create-workflow transaction, only triggered when
  `workflowType === 'regeneration'`. There is always at most one active
  regeneration template.
- Admin UI (`apps/admin-web/src/pages/WorkflowsPage.tsx`): add `'regeneration'`
  to the type dropdown with its own node-id fields (source image / reason
  node / negative node / output node). Gate the existing
  `regenerationReasonPrompts` editor section to render **only** when
  `workflowType === 'regeneration'` — today it renders unconditionally for
  every template.

## 4. Cleanup migration

A migration sets `regeneration_reason_prompts = '[]'::jsonb` for every row
where `workflow_type != 'regeneration'` (i.e. every row that exists today,
since the type doesn't exist yet). Combined with the admin UI change above
(which stops writing to it for other types going forward), this field becomes
meaningful on exactly one row.

## 5. API: `regenerate.ts` rewrite

`regenerateJob` collapses from three branches (saree / tryon-direct /
studio-catalogue, each reconstructing and replaying the original creation
request) to one path:

1. Validate `reason` via `promptGuard` (unchanged).
2. Load the original job: ownership, `status === 'COMPLETED'`, not already
   downloaded, free-daily-limit check (all unchanged from today).
3. Resolve the original's output key:
   `job_outputs.resultKey ?? keys.output(originalJobId)` — same fallback
   `createCatalogVideoJob` already uses for "reuse a completed job's own
   result as an input image."
4. Look up the single active `workflowType = 'regeneration'` template
   (`WHERE workflow_type = 'regeneration' AND is_active = true LIMIT 1`,
   same query shape as `createSaree.ts`'s active-saree-workflow lookup).
   `AppError('CONFIG', 400, 'regeneration is not configured by admin')` if
   none found — same convention as saree's `NOT_CONFIGURED`.
5. Match `reason` against the template's `regenerationReasonPrompts`. A
   non-empty match becomes the prompt override; no match (or a blank
   configured prompt, e.g. "Other") means no override — the workflow's own
   baked-in default prompt text runs unchanged. This is the same "empty
   prompt = no override" convention already documented on the column and
   already implemented in the patch step (`if (prompt?.trim()) { ... }`).
6. Insert `jobs` + `job_inputs` in one transaction:
   - `jobs`: new `source: JOB_SOURCE.REGENERATE`, `creditsCharged: 0` always
     (regenerate has never had a paid fallback — it's free-within-daily-limit
     or blocked, never charge-then-refund — so the `waiveCost` plumbing
     through `createJob`/`createSimpleTryonJob`/`createSareeJob` is no longer
     needed for this call site), `parentJobId` set directly at insert (no
     separate `setParentJobId` call after the fact).
   - `job_inputs`: no `faceId`/`backgroundId`/`poseId`/`garmentTypeId`;
     `params: { kind: 'regenerate', sourceImageKey, sourceJobId: originalJobId,
     workflowTemplateId, dispatchTemplateVersion, promptOverride? }`.
7. `XADD` to `jobs:${queueStream}`, log the `REGENERATE_REASON` job event,
   increment the free-regenerate counter — all unchanged.

Deleted as dead code: `resolveEffectiveWorkflowTemplateId`,
`pickRegenerationPrompt`, the old per-template `getRegenerationReasonPrompts`.

`getRegenerateReasons` simplifies to: look up the one active regeneration
template, return `regenerationReasonPrompts.map(p => p.reason)`. It no longer
needs to inspect the original job's pose/garment-type/workflow at all — kept
taking `(app, userId, jobId)` for API compatibility and so an unowned/missing
job still 404s before any reasons are returned.

## 6. Dispatcher: new `processRegenerateJob`

New routing branch in `apps/dispatcher/src/job/processor.ts`'s dispatch
chain, alongside the existing `params.personKey` / `params.kind === 'saree'` /
`params.kind === 'video'` branches:

```
if (!inputs.faceId && !inputs.backgroundId && !inputs.poseId
    && rawParams.kind === 'regenerate') {
  await processRegenerateJob(...);
  return;
}
```

`processRegenerateJob` is modeled closely on `processTryonDirectJob`
(same file, `~line 911`) but simpler — one image upload/patch instead of two,
no garment-node requirement:

- Resolve the template via `resolveWorkflowTemplateVersion` (honors
  `dispatchTemplateVersion` snapshot, same as every other job kind).
- Fail `REGEN_NODES_NOT_CONFIGURED` if `tryonPersonNodeId` or
  `tryonOutputNodeId` is missing on the resolved template.
- Claim a worker from `WORKER_POOL.TRYON` — reuses the existing pool rather
  than adding a new one. This is a design assumption to revisit if these GPU
  boxes turn out to need model files the plain-tryon pool doesn't already
  have; splitting into a dedicated pool later is a config-only change
  (`workers.allowed_job_types`), not a code change.
- Upload `sourceImageKey` to ComfyUI, patch it into `tryonPersonNodeId`.
- Patch `params.promptOverride` into `garmentPhasePromptNode` only if it's a
  non-empty string (mirrors the existing "skip when falsy" convention in
  `applyWorkflowPatch`).
- `submitPrompt` → `waitForCompletion` → `fetchHistory(outputNodeId)` →
  `downloadOutputImage` → `finalizeOutput` (`outputFormat: 'webp'`, matching
  the tryon-direct convention for this class of job — a direct edit of an
  existing image, not a from-scratch catalogue render) → `XACK` / worker
  `IDLE` / `recordJobOutcome`.
- Same try/catch → `handleFailure` error handling as every other processor in
  this file.

## 7. Taxonomy

Add `JOB_SOURCE.REGENERATE = 'regenerate'` to
`packages/types/src/job-taxonomy.ts`. During implementation, check every
switch/map keyed exhaustively off `JOB_SOURCE` (credit-analysis reporting,
`apps/api/src/modules/admin/job-type.ts`'s coarse grouping, the
`results/routes.ts` `jobType` filter added in the in-flight, unrelated
`fix/regen` branch work) and slot the new value in. Default: it falls into
the "tryon" bucket wherever a binary tryon/catalog split is made, since
`'regenerate'` never matches a `%catalog%` pattern.

## 8. What does NOT change

- Ownership, `COMPLETED`-only, already-downloaded, and free-daily-limit
  guardrails on who can regenerate what, and how often.
- `jobs.parentJobId` linking a regenerated job back to its source — already
  exists, reused as-is. Regenerating a regenerated job's output works
  naturally (the new job's own `job_outputs.resultKey` becomes the input for
  a further regenerate) with no special-casing, since step 3 above always
  reads from whichever job id is passed in.
- The public API surface (`getRegenerateReasons`/`regenerateJob` signatures,
  the `/v1/jobs/:id/regenerate*` routes) — only their internals change.
