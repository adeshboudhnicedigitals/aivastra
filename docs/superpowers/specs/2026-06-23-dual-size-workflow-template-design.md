# Dual-Size Workflow Template Support (build_model_main v2)

**Date:** 2026-06-23
**Status:** Draft

## Summary

The new ComfyUI workflow design (`templates/build_model_main 2206.json`) replaces the single-size-group patching model with **two independent dimension pairs** computed two different ways: a latent/diffusion size derived via `resizeToMax` from the raw `aspectRatio` numbers (capped at 2048), and a final-output size that uses the **literal `ASPECT_DIMENSIONS` lookup** — the exact pixel dimensions the studio's aspect-ratio picker already maps to — so the delivered image always matches what the user actually selected, not a re-derived approximation. It also has two `SaveImage` nodes where the current dispatcher's "grab the first output image" logic would silently pick the wrong one. This spec covers the schema, patcher, and admin UI changes needed to support this template shape without breaking existing single-size-group templates.

## Motivation

Current `workflow_templates.sizeNodeIds[]` is patched uniformly with one `{width,height}` pair from a static `ASPECT_DIMENSIONS` lookup (`apps/dispatcher/src/workflow/patcher.ts:58-63, 151-178`). The new template needs **two** dimension pairs, both derived from the **same user-selected `aspectRatio` enum** (`1:1`/`2:3`/`3:4`/`4:5`) but capped at different max edges:
- `733`/`734` (`max-width`/`max-height`, `PrimitiveInt`) → `EmptyLatentImage` (`1044:1031`) — the diffusion-latent size. Computed via `resizeToMax(ratioW, ratioH, latentMaxPx)` from the raw `aspectRatio` numbers (e.g. `"3:4"` → `3, 4`), capped at 2048. This is just the diffusion canvas — it doesn't need to match any fixed enum value.
- `1034`/`736` (`result-width`/`result-height`, `PrimitiveInt`) → `ResizeAndPadImage` (`737`) — the final delivered-image size. Set directly from `ASPECT_DIMENSIONS[aspectRatio]` (the existing lookup table already used by the legacy single-group path) — **not** `resizeToMax`. This guarantees the delivered image is exactly the dimensions the studio's aspect-ratio picker promises, regardless of what max edge the latent canvas happened to use.

The latent aspect ratio is **not** derived from the pose image's real pixel dimensions — it's the same ratio the user picked, just rendered via a different calculation than the output group. No image-dimension probing needed.

Node IDs for these four roles aren't picked manually per template — they're auto-detected from each node's `_meta.title` at upload-parse time (`max-width`/`max-height`/`result-width`/`result-height`), the same mechanism the admin upload modal already uses to auto-detect `faceNodeId`/`poseNodeId`/etc. Node IDs differ between template JSONs; the *titles* are the stable convention.

Additionally, `617` ("model-result") and `739` ("customer-result-Image") are both `SaveImage` nodes in this transitional template. `apps/dispatcher/src/job/client.ts:62-65` + `processor.ts:392-396` take `Object.values(entry.outputs)` and download the *first* `type:"output"` image — there's no guarantee `739` (the correctly padded/reframed image) sorts before `617` (the raw, unresized model output). Node `617` will be removed from future template JSONs, making this moot long-term, but `resultNodeId` is kept as a cheap transitional safety net (and as a no-cost fallback for any template author who forgets to delete it).

## Database Changes

### `resize_to_max` utility (new file, no DB change)

`apps/dispatcher/src/workflow/resize-to-max.ts` — direct TS port of the PHP function:

```ts
export function resizeToMax(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error(`resizeToMax: invalid dimensions ${width}x${height}`);
  if (width === height) return { width: max, height: max };
  if (width > height) {
    const ratio = height / width;
    return { width: max, height: Math.round(max * ratio) };
  }
  const ratio = width / height;
  return { width: Math.round(max * ratio), height: max };
}
```

### `workflow_templates` table — new columns

```sql
ALTER TABLE workflow_templates
  ADD COLUMN IF NOT EXISTS latent_size_node_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS latent_max_px integer NOT NULL DEFAULT 2048,
  ADD COLUMN IF NOT EXISTS output_size_node_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS result_node_id text;
-- output_max_px (added in 0057, defaulted to 2048 in 0058) is no longer read by the
-- patcher — the output group uses ASPECT_DIMENSIONS directly. Column left in place,
-- unused, rather than churning out another migration to drop it.
```

| Column | Type | Description |
|---|---|---|
| `latent_size_node_ids` (new) | `text[]`, default `{}` | `[widthNodeId, heightNodeId]` for the diffusion-latent size group (e.g. `733`, `734`). Auto-detected from node titles `max-width`/`max-height` at upload-parse time — not manually editable in the admin form. Patched via `resizeToMax(ratioW, ratioH, latentMaxPx)` using the same `aspectRatio` enum as the output group. Empty for templates that don't have a separate latent-size group (old templates keep using `sizeNodeIds`). |
| `latent_max_px` (new) | `integer`, default `2048` | Max edge for the latent-size calc. |
| `output_size_node_ids` (new) | `text[]`, default `{}` | `[widthNodeId, heightNodeId]` for the final-output size group (e.g. `1034`, `736`). Auto-detected from node titles `result-width`/`result-height`. Patched directly from `ASPECT_DIMENSIONS[aspectRatio]` — empty falls back to existing `sizeNodeIds` behavior. |
| `result_node_id` (new) | `text`, nullable | The `SaveImage` node ID holding the final deliverable image (`739` here). When set, dispatcher targets this node directly instead of taking the first `type:"output"` image found. Transitional — once template authors stop including a second `SaveImage` node (per plan, `617` goes away), this becomes a no-op safety net rather than a requirement. |

`sizeNodeIds`/`sizeNodeId` (existing columns) stay untouched and keep working for old single-size-group templates — the new columns are purely additive. A template uses either the old path (`sizeNodeIds` non-empty, new columns empty) or the new path (new columns non-empty), never both.

None of these five new columns are exposed as manual form fields in the admin upload UI — they're all either auto-detected by title-matching during JSON parse, or fixed defaults. See Admin UI section.

### Migration file

`packages/db/src/migrations/0057_dual_size_workflow_nodes.sql` — combine both ALTERs above into one file. Bump `_journal.json`'s `"when"` for idx 57 to a value greater than `0056`'s (the journal-skip bug from `b3882ec` makes this non-negotiable — always pick `when` strictly greater than the previous entry, never copy a historical timestamp).

## Patcher Changes (`apps/dispatcher/src/workflow/patcher.ts`)

No new fields on `WorkflowInputs` — both size groups derive entirely from the existing `inputs.aspectRatio` string, just at different max edges. Stays fully synchronous, no buffer plumbing, no `sharp` dependency in this file.

Inside `applyWorkflowPatch`, after the existing image-node patches:

```ts
function patchSizeGroup(workflow: Workflow, nodeIds: string[], ratio: string, max: number): void {
  const [widthId, heightId] = nodeIds;
  if (!widthId || !heightId) return;
  const [rw, rh] = ratio.split(':').map(Number);
  const dims = resizeToMax(rw, rh, max);
  const wNode = workflow[widthId];
  const hNode = workflow[heightId];
  if (wNode) wNode.inputs.value = dims.width;
  if (hNode) hNode.inputs.value = dims.height;
}

if (inputs.aspectRatio && (tmpl.latentSizeNodeIds.length === 2 || tmpl.outputSizeNodeIds.length === 2)) {
  // Latent group — derived via resizeToMax from the raw ratio numbers
  patchSizeGroup(workflow, tmpl.latentSizeNodeIds, inputs.aspectRatio, tmpl.latentMaxPx);

  // Output group — the literal selected dimensions, NOT resizeToMax
  if (tmpl.outputSizeNodeIds.length === 2) {
    const dims = ASPECT_DIMENSIONS[inputs.aspectRatio];
    if (dims) {
      const [widthId, heightId] = tmpl.outputSizeNodeIds;
      if (workflow[widthId]) workflow[widthId].inputs.value = dims.width;
      if (workflow[heightId]) workflow[heightId].inputs.value = dims.height;
    }
  }
} else if (inputs.aspectRatio && tmpl.sizeNodeIds.length > 0) {
  // existing single-group ASPECT_DIMENSIONS lookup, unchanged (lines 151-178)
}
```

The `else if` guard means old single-group templates (`sizeNodeIds` populated, new columns empty) keep behaving exactly as today; new dual-group templates skip the old block entirely. A template never has both populated, so there's no double-patch risk.

## Output-Node Targeting (`apps/dispatcher/src/job/client.ts`, `processor.ts`)

`fetchHistory` (or its caller in `processor.ts:392-396`) needs an optional `resultNodeId` parameter:

```ts
export async function fetchHistory(
  workerUrl: string, apiKey: string, promptId: string, log: Logger,
  resultNodeId?: string,
): Promise<OutputImage[]> {
  // ...
  if (resultNodeId) {
    const node = entry.outputs[resultNodeId];
    if (node?.images) return node.images.filter((img) => img.type === 'output');
    throw new Error(`fetchHistory: result node "${resultNodeId}" produced no output images`);
  }
  // existing scan-all-and-take-first behavior, unchanged, for templates without resultNodeId
  for (const node of Object.values(entry.outputs)) { /* ... */ }
}
```

`processor.ts:392` passes `tmpl.resultNodeId` through (mirrors the existing widget-job pattern at `processor.ts:612-634`, which already does exactly this for `outputNodeId` — same mechanism, reused for regular jobs).

## Admin UI Changes (`apps/admin`)

No manual pickers for any of the five new fields — confirmed not needed since these are either auto-calculated (sizes, from `aspectRatio` at job time) or auto-detected from fixed node titles at upload time. The new `PrimitiveStringMultiline` flag nodes (`closeup`/`halfbody`/`manique`/`garment type`/`full body`) also need zero admin UI — they're static per-JSON, set once when each template variant is authored, never touched after upload.

`WorkflowUploadModal.tsx`'s existing parse-on-upload step (the same logic that already auto-detects `faceNodeId`/`poseNodeId`/etc. by scanning `_meta.title`, ~line 188) gains four more title patterns to scan for: `max-width`, `max-height`, `result-width`, `result-height` → populate `latentSizeNodeIds`/`outputSizeNodeIds` silently, no new form fields rendered. `latentMaxPx`/`resultNodeId` stay at their column defaults (2048/null) unless a future need arises to override per-template — out of scope for this pass. `outputMaxPx` is no longer consulted by the patcher.

`packages/types/src/admin.ts` `CreateWorkflowBody`/`UpdateWorkflowBody` gain the fields as optional, server-computed-on-parse — not part of the user-facing form schema, just the persisted payload shape: `latentSizeNodeIds: z.array(z.string()).max(2).optional()`, `latentMaxPx: z.number().int().positive().optional()`, `outputSizeNodeIds: z.array(z.string()).max(2).optional()`, `resultNodeId: z.string().optional()`.

`WorkflowsPage.tsx` detail view (line ~471): add read-only rows for the five new fields alongside the existing `sizeNodeIds` display, for debugging visibility only.

## Backward Compatibility

- All new columns nullable/default-empty — every existing template row is unaffected, keeps using `sizeNodeIds` exactly as today.
- `applyWorkflowPatch` branches on which columns are populated; a template is either old-style or new-style, never partially both.
- `fetchHistory`'s `resultNodeId` param is optional — existing regular-job templates (no `resultNodeId` set) keep the current "first output image" behavior unchanged.

## Resolved Questions

- Node IDs for the size-group roles vary per template JSON; titles (`max-width`/`max-height`/`result-width`/`result-height`) are the stable convention, auto-detected at upload-parse time the same way other roles already are.
- Node `617` ("model-result") will be dropped from future template JSONs — `resultNodeId` stays as a cheap transitional safety net, not a hard requirement.
- The static `PrimitiveStringMultiline` flag nodes need no admin UI — confirmed they're fixed per-JSON; each distinct combination of flags gets its own template variant uploaded separately, never edited post-upload.
