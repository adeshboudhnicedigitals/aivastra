# Flexible Workflow Roles — Design (Sub-project A of Wear-Type Support)

> **Revision 2.** The original version of this spec (see git history) was reviewed by Codex before implementation and found to have 8 confirmed gaps, several severe enough to block: a garment-slot cross-validation hole that lets `undefined` reach ComfyUI, a completely missing admin-UI change (the feature would be backend-only and unusable), no fail-closed behavior for missing runtime garment inputs (risk of charging for wrong-garment output), and three call sites (`regenerate.ts`, catalogue history, results listing) that were "null-safe" but not functionally correct for the new job shape. This revision incorporates all 8 fixes. Every claim below was independently re-verified against the current codebase, not just carried over from the original.

## Problem

Every "regular" `workflow_templates` row today hard-requires `faceNodeId`, `poseNodeId`, `bgNodeId`, and a non-empty `upperNodeIds` (enforced by `CreateWorkflowBody`'s `superRefine`, `packages/types/src/admin.ts:191-212`). This makes it impossible to upload a workflow for a garment type that isn't "upper garment on a full-body model shot" — specifically, lower-wear-only or inner-wear-only generation, where the hero garment is the lower/inner slot and there may be no face node at all.

This is Sub-project A of a two-part feature. **Sub-project B** (not this spec) is the studio wizard's gender → wear-type → garment-type selection UX, which depends on A existing first. A's job: make flexible workflows genuinely uploadable via admin and runnable end-to-end via the job-creation API — including regeneration and result/history display, not just first-generation — fully testable without touching the studio page.

## Confirmed decisions from brainstorming

- Inner wear reuses the **upper** node role — no new node field. The upper/inner distinction is a catalog/UX classification (Sub-project B's concern), not a different ComfyUI node structure.
- Lower/inner-primary generation shows **only** that garment as the hero (not paired with a separate upper item) — confirmed by the user.
- **Pose stays mandatory** for every regular workflow — it's the only mechanism that selects which workflow runs (`model_pose_assets.workflowTemplateId`, overridable per garment type via `pose_garment_configs`, or per catalogue-template-mapping via `catalogue_template_pose_workflows`). Making pose skippable is out of scope.
- **`faceId` and `backgroundId` stay mandatory at the job-creation API.** More precisely (revision — see Finding 8 below): every **look** (`{poseId, backgroundId}`) always carries a `backgroundId`, whether submitted via the legacy top-level `backgroundId` field or per-entry in `looks[]`; `faceId` is always a single top-level field. Neither becomes optional at any layer. A workflow with no `faceNodeId`/`bgNodeId` simply never patches those images into anything — the studio still asks for them.
- **`upperGarmentKey` is the only job-creation field that becomes optional**, gated by what the *actually resolved* workflow for each look requires (see Finding 1 below) — not by a request-level "at least one of upper/lower" check alone.
- **A workflow may declare both an upper role and a lower role simultaneously** (Decision 1, confirmed) — this already matches every existing production workflow's shape and requires no new schema capability; it falls out naturally from Finding 1's fix once job-creation checks `upperNodeIds`/`lowerNodeId` independently rather than as a single combined "at least one" check. A lower/inner-primary workflow simply has empty `upperNodeIds`.
- **Missing runtime garment/face/background input for a node the resolved workflow actually maps is a hard job failure with refund — never a silent fallback or stale-image submission** (Decision 3, confirmed — see Finding 4 below). This applies uniformly to upper, lower, and shoe roles, superseding the pre-existing lower/shoe "fall back to upper garment" patcher behavior, which has the same wrong-image-charged-to-customer risk this spec is otherwise fixing.
- **Sub-project A's scope includes regeneration, catalogue history, and results/admin display of lower-only jobs** (Decision 2, confirmed) — shipping generation-only would mean the first regenerate click or catalogue view breaks or misrepresents a real lower-only job. Not deferred to B.
- **The admin create-workflow UI must change** (Decision 4, confirmed — this was already this spec's own acceptance criterion in the Problem statement; the original revision simply failed to include it). **The admin edit-workflow UI (node-mapping fields via PATCH) stays out of scope** — it is *already* limited to label/slug today (`WorkflowsPage.tsx:633-689`, confirmed by direct inspection; no UI anywhere currently sends `faceNodeId`/`upperNodeIds`/etc. to `PATCH /admin/workflows/:id`, even though the route itself accepts them). This feature doesn't need to expand that surface — admins fix a wrong role-shape via delete + re-upload, same as today. The PATCH endpoint's merge-validation fix (Finding 3) still applies at the API layer regardless, as defense against direct API use.
- **Rollout order matters** (Finding 7, confirmed) — see the new "Rollout" section below.

## Design

### 1. Data model

`workflow_templates`: relax to nullable —
- `faceNodeId`
- `bgNodeId`
- `facePhasePromptNode`

Stay `NOT NULL`: `poseNodeId`, `garmentPhasePromptNode`. `upperNodeIds` stays a `NOT NULL` array column; only the *validation* requiring it non-empty is relaxed (empty array = "no upper role").

`job_inputs`: relax `upperGarmentKey` to nullable.

Both migrations are backward-compatible — every existing row already has real values, no backfill.

### 2. Admin workflow create — backend (`POST /admin/workflows`)

**Zod floor** (`CreateWorkflowBody`'s `superRefine`, `packages/types/src/admin.ts:191-212`): for `workflowType: 'regular'`, require `poseNodeId` + `garmentPhasePromptNode`, plus at least one garment slot (`upperNodeIds` non-empty OR `lowerNodeId` set). Dependent rule: if `faceNodeId` is provided, `facePhasePromptNode` must be too. `bgNodeId` has no dependents. `workflowType: 'tryon'` is untouched.

**Route handler** (`apps/api/src/modules/admin/workflows.routes.ts:277-309`) — revision, this was missing from the original spec: the handler currently does unconditional `const faceNodeId = body.faceNodeId!;` (non-null-asserted, justified only by the old superRefine's unconditional requirement) followed by unconditional `validateNodeExists`/`validateNodeType` calls for face/pose/bg/upper. These must become conditional — mirror the pattern the **PATCH** handler already uses one function below (`if (body.faceNodeId) { validateNodeExists(...); validateNodeType(...); }`), and the DB insert must write `faceNodeId: body.faceNodeId ?? null` etc. instead of the asserted values. `poseNodeId` and `garmentPhasePromptNode` stay unconditionally validated (still required by the floor).

### 3. Admin workflow PATCH — merge-then-validate (Finding 3)

`PATCH /admin/workflows/:id` (`workflows.routes.ts:396-...`) currently validates each field in isolation when present in the request body, with no check on the resulting final row. Before persisting, compute the merged shape (`{ faceNodeId: body.faceNodeId ?? existing.faceNodeId, upperNodeIds: body.upperNodeIds ?? existing.upperNodeIds, lowerNodeId: body.lowerNodeId !== undefined ? body.lowerNodeId : existing.lowerNodeId, ... }` — careful with the nullable-clear fields, where `body.field === null` must mean "clear it," distinct from `undefined` meaning "not touched," same distinction already established in the mapped-template-pose-workflow PATCH endpoint reviewed and shipped earlier) and re-run the same floor check as create: at least one garment slot, `facePhasePromptNode` present if `faceNodeId` present. Reject with `AppError('VALIDATION', 400, ...)` if the merged shape would violate it. This applies even though no UI currently drives this endpoint's node-mapping fields (see "admin edit-workflow UI... out of scope" above) — it's a correctness fix at the API boundary regardless of caller.

### 4. Admin workflow create — UI (`apps/admin-web/src/components/WorkflowUploadModal.tsx`)

**Confirmed blocking gap, not in the original spec.** `handleSubmit` (`WorkflowUploadModal.tsx:246-258`) client-side hard-requires `faceNodeId`, `poseNodeId`, `bgNodeId`, both prompt nodes, and non-empty `upperNodeIds` for every non-tryon workflow, returning an error before the request is ever sent. This must relax to mirror the new backend floor exactly: `poseNodeId` + both prompt-node-dependent rules + at least one garment slot. Concretely:

```ts
if (!poseNodeId || !positivePromptNode) {
  setError('Pose and positive prompt nodes are required');
  return;
}
if (faceNodeId && !negativePromptNode) {
  setError('Negative prompt node is required when a face node is set');
  return;
}
const validUpperIds = upperNodeIds.filter(Boolean);
if (validUpperIds.length === 0 && !lowerNodeId) {
  setError('At least one garment role is required — set an upper garment node or a lower garment node');
  return;
}
```

The payload construction (`WorkflowUploadModal.tsx:280-...`) already conditionally includes `lowerNodeId`/`shoeNodeId` (`lowerNodeId || undefined`) — extend the same pattern to `faceNodeId`/`bgNodeId` so an admin who leaves them blank doesn't send an empty string. Add a short inline hint near the node-mapping section (e.g. "Leave face and background blank for a lower/inner-wear-only workflow — at least one of upper or lower garment node is required") so the relaxed requirement is discoverable, not just permitted.

### 5. Job creation — garment-slot cross-validation (Finding 1, the most severe gap)

**The original spec's refine was wrong.** A request-level "at least one of `upperGarmentKey`/`lowerGarmentKey`" check is insufficient — it doesn't know which workflow the selected pose actually resolves to. Confirmed via direct trace: `apps/dispatcher/src/workflow/patcher.ts:86-89`'s upper-node loop does `upperNode.inputs.image = inputs.upperGarmentFile` unconditionally whenever `tmpl.upperNodeIds` is non-empty — if a job reaches the dispatcher with `upperGarmentFile` undefined (because the resolved workflow needed it but the request never provided it), this assigns `undefined` straight into the ComfyUI submission.

Fix: `CreateTryOnJobInputs.upperGarmentKey` still becomes optional, and `assertOwnsUploadKey` is still only called for `upperGarmentKey` when present. **Drop the "at least one of upper/lower" refine entirely** — it's redundant with, and weaker than, the correct fix below. Instead, extend the existing per-pose validation loop in `apps/api/src/modules/jobs/create.ts:395-402` (which today only checks `lowerNodeId`/`shoeNodeId`) with a symmetric check against `upperNodeIds`:

```ts
for (const pw of poseWorkflows) {
  if (pw.upperNodeIds.length > 0 && !upperGarmentKey) {
    throw new AppError('VALIDATION', 400, 'upper garment required for this pose');
  }
  if (pw.lowerNodeId && !lowerCatalogId && !lowerGarmentKey) {
    throw new AppError('VALIDATION', 400, 'lower garment required for this pose');
  }
  if (pw.shoeNodeId && !shoeCatalogId) {
    throw new AppError('VALIDATION', 400, 'shoe catalog item required for this pose');
  }
}
```

This requires `upperNodeIds` to be added to the `poseWorkflows` shape (both the `mappingPoseWorkflows` branch and the `poseWorkflowRows.map(...)` fallback branch in `create.ts`, mirroring how `lowerNodeId`/`shoeNodeId`/`sizeNodeIds` are already carried through both branches) — pulled from `schema.workflowTemplates.upperNodeIds` in the same joins that already resolve `lowerNodeId`/`shoeNodeId`. Because this check runs per-pose against the *actually resolved* workflow (not a request-level flag), it correctly handles the both-upper-and-lower ("mixed") workflow case from Decision 1 automatically — both checks fire independently.

Runs *before* credit deduction, same as the existing lower/shoe checks — a bad request never reaches the transaction.

### 6. Dispatcher patcher — fail closed, not stale-image (Finding 4, revises the original design)

The original spec proposed: "guard the lower/shoe fallback-to-upper logic so it never injects `undefined`... fall back to leaving the node's existing value untouched (skip the patch, log a warning) instead." **This is now rejected per Decision 3.** Leaving a mapped node's original value untouched means ComfyUI generates output using whatever placeholder/sample image is baked into the admin's uploaded workflow JSON — the job completes "successfully," credits are charged, and the customer receives a wrong-garment image with no error anywhere.

New rule, applied uniformly to every garment/face/background role: **if a node is mapped (`upperNodeIds` non-empty / `lowerNodeId` set / `shoeNodeId` set / `faceNodeId` set / `bgNodeId` set) but the corresponding input file is not provided, `applyWorkflowPatch` throws** — same failure class as the existing `requireNode` (missing node in JSON). This *also* replaces the pre-existing lower/shoe "fall back to upper garment" behavior (`patcher.ts:96,114`, `?? inputs.upperGarmentFile`) with a hard throw — that fallback predates this spec but has the identical risk profile Decision 3 is meant to close, and job-creation's Finding-1 fix means `lowerGarmentFile`/`shoeGarmentFile` should already always be resolved whenever those nodes are mapped, so the throw path becomes a rare defense-in-depth case, not a normal-operation path.

`WorkflowInputs.upperGarmentFile`, `faceSideFile`, and `backgroundFile` all become optional (`string | undefined`), each gated by whether the resolved template actually maps that role (`upperNodeIds` non-empty / `faceNodeId` set / `bgNodeId` set) — this is a correction from an earlier draft of this revision, which said face/background "stay required" while also specifying (Section 7) that the processor skips uploading them when unmapped; those two statements were contradictory, since a field can't be required in the type while legitimately absent at runtime. `poseFile` stays required — pose is unconditionally mandatory per the unchanged confirmed decision above. `applyWorkflowPatch`'s face/bg `requireNode` calls (`patcher.ts:81,83`) become conditional on `tmpl.faceNodeId`/`tmpl.bgNodeId` being set — when set, the corresponding input file must also be present or the same throw applies (face/background are still always collected by the studio per the unchanged confirmed decision above, so the "mapped but missing file" case should be unreachable in normal operation, but the invariant must hold structurally).

The processor (`apps/dispatcher/src/job/processor.ts`) wraps the `patchWorkflow` call in a way that catches this new "missing garment input" throw distinctly and calls the existing `markFailed(...)` path with a new error code (e.g. `MISSING_GARMENT_INPUT`) — same transactional-refund mechanism already used for `CATALOG_NOT_FOUND` (`processor.ts:203-206`). No new refund plumbing needed, just a new error code routed through the existing path.

### 7. Dispatcher processor — conditional uploads (unchanged from original)

Face/background/pose resolution (`processor.ts:165-206`) stays unchanged — always queried, `CATALOG_NOT_FOUND` on missing. Only the upload step (`processor.ts:350-361`) changes: upload `upperGarmentKey` to ComfyUI only when present; skip uploading face/background images when the resolved workflow has no `faceNodeId`/`bgNodeId`.

### 8. Regeneration (Finding 5 — the original spec was factually wrong here)

`apps/api/src/modules/jobs/regenerate.ts:67` does not merely risk a crash on null `upperGarmentKey` — it explicitly rejects: `if (!inputs.poseId || !inputs.faceId || !inputs.backgroundId || !inputs.upperGarmentKey) throw new AppError('VALIDATION', 400, 'original job is missing required inputs to regenerate');`. Every lower-only job would be permanently non-regenerable under the original design.

Fix: drop `|| !inputs.upperGarmentKey` from this check — require only `poseId`/`faceId`/`backgroundId` at this layer. The reconstructed `CreateTryOnJobRequest` this function builds (lines 70-81) already passes `upperGarmentKey: inputs.upperGarmentKey` (which can now legitimately be `undefined`/`null`) alongside `lowerGarmentKey`/`lowerCatalogId` — the downstream `createJob` call performs the real per-workflow slot validation from Finding 1's fix. `regenerate.ts` doesn't need to duplicate that logic; it just needs to stop pre-emptively blocking the case Finding 1 now handles correctly.

### 9. Catalogue history and results display (Finding 6 — expanded scope per Decision 2)

**`apps/api/src/modules/jobs/routes.ts:367-382`** (`GET /v1/catalogues/:id`): the "hero garment" resolution for a catalogue currently selects only `upperGarmentKey` from any one job's inputs and presigns it as `garmentUrl`. Extend the select to also pull `lowerGarmentKey`/`lowerCatalogId`, and resolve `garmentUrl` from whichever hero source is actually present: `upperGarmentKey` (presigned upload) if set, else `lowerGarmentKey` (presigned upload) if set, else a catalog-item thumbnail lookup via `lowerCatalogId` if that's how the lower garment was sourced. A lower-only catalogue must show *some* source-garment image, not a blank state.

**`apps/api/src/modules/results/routes.ts:145`**: the result-listing select currently pulls only `upperGarmentKey`. Add `lowerGarmentKey` alongside it in the select and in whatever response shape consumes it, so a lower-only job's result entry can present its actual source garment instead of silently omitting it.

Exact response-shape naming (e.g. a unified `heroGarmentUrl` vs. separate `upperGarmentUrl`/`lowerGarmentUrl` fields) is a plan-level decision — the design requirement is: **no lower-only job may render with an empty/missing source-garment image anywhere a user or admin can view it.**

### 10. Rollout order (Finding 7 — new section, not in the original spec)

`api` and `dispatcher` deploy independently in this environment (per CLAUDE.md's worker/dispatcher restart flow — there is no evidence of an existing feature-flag mechanism in this codebase, so this spec does not propose adding one for a single rollout). If `api` starts accepting/writing `NULL upper_garment_key` before `dispatcher` has the null-tolerant patcher/processor changes deployed, an old dispatcher instance will hit exactly the unguarded read sites this spec identifies and crash or misbehave on that job.

Required deploy order: **(1) migration** (nullable columns — safe on its own, no behavior change) → **(2) dispatcher** (patcher + processor changes from sections 6–7, deployed and confirmed healthy against existing all-upper-required traffic, which is unaffected since it's backward compatible) → **(3) api + admin-web** (the only layer that can actually start producing `NULL upper_garment_key` rows, via Section 5's relaxed validation and Section 4's UI change). Step 3 must not ship before step 2 is confirmed live.

## Out of scope for A (explicitly deferred to Sub-project B)

- `garment_subcategories` gaining a wear-type classification.
- Any studio wizard / frontend changes.
- `backgroundId`/`faceId` becoming optional at any layer.
- `lowerCatalogId` as an alternate "hero" source (catalog-pick instead of upload) at job-creation — regeneration reads an existing `lowerCatalogId` (Section 8) but nothing in A adds the ability to newly submit one as an upload alternative.
- The `(backgroundId+poseIds)` vs `looks` XOR requirement — unchanged.
- Admin edit-workflow UI for node mappings (see "Confirmed decisions" above — stays label/slug-only; PATCH's merge-validation fix is still applied at the API layer as defense-in-depth).
- A feature-flag mechanism — deploy-ordering discipline (Section 10) is used instead for this single rollout.
