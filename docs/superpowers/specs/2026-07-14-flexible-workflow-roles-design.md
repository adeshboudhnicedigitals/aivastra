# Flexible Workflow Roles — Design (Sub-project A of Wear-Type Support)

## Problem

Every "regular" `workflow_templates` row today hard-requires `faceNodeId`, `poseNodeId`, `bgNodeId`, and a non-empty `upperNodeIds` (enforced by `CreateWorkflowBody`'s `superRefine`, `packages/types/src/admin.ts:191-212`). This makes it impossible to upload a workflow for a garment type that isn't "upper garment on a full-body model shot" — specifically, lower-wear-only or inner-wear-only generation, where the hero garment is the lower/inner slot and there may be no face node at all.

This is Sub-project A of a two-part feature. **Sub-project B** (not this spec) is the studio wizard's gender → wear-type → garment-type selection UX, which depends on A existing first — you can't let a user pick "Lower Wear" if no lower-primary workflow can exist and no job can be submitted without an upper upload. A's job is narrower: make flexible workflows *uploadable via admin and runnable via the job-creation API*, fully testable without touching the studio page at all.

## Confirmed decisions from brainstorming

- Inner wear reuses the **upper** node role — no new node field. The upper/inner distinction is a catalog/UX classification (Sub-project B's concern), not a different ComfyUI node structure.
- Lower/inner-primary generation shows **only** that garment as the hero (not paired with a separate upper item) — confirmed by the user.
- **Pose stays mandatory** for every regular workflow — it's the only mechanism that selects which workflow runs (`model_pose_assets.workflowTemplateId`, overridable per garment type via `pose_garment_configs`). Making pose skippable would require designing a whole new workflow-selection path; out of scope.
- **`faceId` and `backgroundId` stay mandatory at the job-creation API** — they're chosen by the studio wizard unconditionally today, independent of which workflow ends up handling the job (matches CLAUDE.md's stated input model). A workflow with no `faceNodeId`/`bgNodeId` simply never patches those images into anything; the studio still asks for them. This was a correction made mid-design after tracing `processor.ts:165-206` — the original framing ("faceId becomes optional too") was wrong and is superseded by this.
- **`upperGarmentKey` is the only job-creation field that becomes optional.** It's the actual signal for "did the user upload something for the upper slot."

## Design

### 1. Data model

`workflow_templates`: relax to nullable —
- `faceNodeId`
- `bgNodeId`
- `facePhasePromptNode`

Stay `NOT NULL`: `poseNodeId`, `garmentPhasePromptNode` (every workflow has a garment slot, hence a garment phase). `upperNodeIds` stays a `NOT NULL` array column; only the *validation* requiring it non-empty is relaxed (empty array = "no upper role").

`job_inputs`: relax `upperGarmentKey` to nullable.

Both migrations are backward-compatible — every existing row already has real values, no backfill.

### 2. Admin workflow upload/update (`/admin/workflows`)

Replace the fixed required-field list for `workflowType: 'regular'` with a floor: **`poseNodeId` + `garmentPhasePromptNode` required, plus at least one garment slot** (`upperNodeIds` non-empty OR `lowerNodeId` set). Dependent rule: if `faceNodeId` is provided, `facePhasePromptNode` must be too (no face role without a prompt driving it). `bgNodeId` has no dependents. `workflowType: 'tryon'` is untouched — different node shape entirely.

`PATCH /admin/workflows/:id` gains the ability to explicitly clear `faceNodeId`/`bgNodeId`/`facePhasePromptNode` back to `null` (mirroring the existing `lowerNodeId`/`shoeNodeId` nullable-clear pattern), so an admin isn't locked into whatever role-shape a workflow was created with.

### 3. Job creation (`POST /v1/jobs/tryon` → `createJob`)

`CreateTryOnJobInputs.upperGarmentKey` becomes optional; add a refine requiring **at least one of `upperGarmentKey` / `lowerGarmentKey`** (there must be *some* uploaded hero garment). `assertOwnsUploadKey` is only called for `upperGarmentKey` when present (the `lowerGarmentKey` call is already conditional today). The existing "lower garment required for this pose" validation (`create.ts`, checks `pw.lowerNodeId && !lowerCatalogId && !lowerGarmentKey`) already correctly makes a lower-primary workflow's lower key mandatory — no change needed there.

`lowerCatalogId`-as-hero (picking a lower garment from the admin catalog instead of uploading one) is explicitly **out of scope for A** — the refine only recognizes uploads. Catalog-as-hero is a studio-UX convenience that belongs in B.

### 4. Dispatcher patcher (`applyWorkflowPatch`)

Guard the face and background `requireNode` calls (`patcher.ts:81-83`) behind `if (tmpl.faceNodeId)` / `if (tmpl.bgNodeId)` — pose's call stays unconditional. The upper-node loop already handles an empty `upperNodeIds` array correctly with zero changes (a `for...of` over `[]` just does nothing). Guard the lower/shoe fallback-to-upper logic (`patcher.ts:96,114`, `?? inputs.upperGarmentFile`) so it never injects `undefined` when there's no upper file — fall back to leaving the node's existing value untouched (skip the patch, log a warning) instead. `WorkflowInputs.upperGarmentFile` becomes optional; `faceSideFile`/`backgroundFile`/`poseFile` stay required (matches "always resolved" above).

### 5. Dispatcher processor (the regular catalog-flow logic inline in `processJob`, `processor.ts:180-460` — not a separately named function; `processJob` branches internally to `processSareeJob`/`processWidgetJob`/etc. for other job types, but this path stays inline)

Face/background/pose resolution (`processor.ts:165-206`) is **unchanged** — always queried, `CATALOG_NOT_FOUND` on missing. Only the upload step (`processor.ts:350-361`) changes: upload `upperGarmentKey` to ComfyUI only when present; skip uploading the face/background images when the resolved workflow template has no `faceNodeId`/`bgNodeId` (nothing would use them — a real, if minor, waste to upload otherwise). `WorkflowInputs` construction updates to match the now-optional fields.

### 6. Ripple effect from the `job_inputs.upper_garment_key` column becoming nullable

This column is shared by every job type (catalog, saree, tryon-direct, widget, shopify, merchant, kiosk), not just the flow this spec changes. Traced every read site:

**Already null-safe, no change needed:** `regenerate.ts` (`if (!inputs.upperGarmentKey)` guard already present), `jobs/routes.ts` (`/v1/catalogues/:id`, `/v1/assets` — both already null-guard before presigning), `results/routes.ts` (`presign()` helper already typed `string | null`), `admin/jobs.routes.ts` (`pu()` helper already typed `string | null | undefined`), `processor.ts`'s `processSareeJob` and `processShopifyJob` (both already have an existing `!garmentKey`-style guard before use).

**Write-only sites, unaffected:** `createSaree.ts`, `create.ts`'s `createSimpleTryonJob`, `kiosk/create-job.ts`, `kiosk/jobs.routes.ts`, `merchant/create-job.ts`, `shopify/customer.routes.ts` — all always assign a real computed string from their own mandatory request fields; never null in practice regardless of this column's nullability.

**Needs a new guard (currently unguarded reads that would become TypeScript errors and, if bypassed, runtime crashes):** `processor.ts`'s `processTryonDirectJob` (checks `!workflowTemplateId` but not `!garmentKey` before use) and `processWidgetJob` (`r2Download(inputs.upperGarmentKey)` and `.split('.')` called directly, no guard at all). Both get a defensive `if (!garmentKey) { markFailed/markWidgetFailed(...); return; }` added — purely defensive since these job types never actually produce a null value (only `createJob`'s flow can), but required for both type-safety and to fail loudly rather than crash if the invariant is ever violated.

## Out of scope for A (explicitly deferred to Sub-project B)

- `garment_subcategories` gaining a wear-type classification.
- Any studio wizard / frontend changes.
- `backgroundId`/`faceId` becoming optional at any layer.
- `lowerCatalogId` as an alternate "hero" source (catalog-pick instead of upload).
- The `(backgroundId+poseIds)` vs `looks` XOR requirement — unchanged.
