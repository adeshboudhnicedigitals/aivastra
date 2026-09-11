# SAM3 Segmentation Node Prompt — Design

## Problem

Some catalog (`workflowType: 'regular'`) workflow templates contain a SAM3
Segmentation node whose `prompt`/`text` input names the segmentation target
(e.g. "person", "garment"). Today that value is only editable by hand-editing
the template's raw `jsonContent` — there's no admin-facing way to view or edit
it, unlike the face-phase, garment-phase, and stage-1 prompt nodes, which
already have dedicated node-ID columns, admin API fields, and an edit UI.

This adds the same capability for the SAM3 node: an admin-configurable node ID
plus an editable default prompt, following the existing pattern most closely
matched by `stage1PositivePromptNode`/`defaultStage1PositivePrompt`.

## Confirmed decisions

- **Template-level only** — one admin-editable default prompt per workflow
  template. No per-pose or per-garment-type override (unlike
  `garmentPhasePrompt` via `pose_garment_configs`), and no per-job snapshot
  into `job_inputs.params`. A segmentation target string is a property of the
  graph, not of the pose/garment-type combination running through it.
- **Consequence: zero dispatcher changes.** Editing the prompt writes directly
  into the template's own `jsonContent` (via the existing `writePromptText`
  helper), the same mechanism `stage1PositivePrompt`/`stage1NegativePrompt`
  already use. `apps/dispatcher/src/workflow/patcher.ts` never touches either
  of those fields today, and won't need to touch this one — the dispatcher
  just submits whatever `jsonContent` currently holds.
- **No type-based node validation.** The existing `validateNodeType(json, id,
  'prompt', role)` helper requires `class_type` to contain `"TextEncode"`
  (`classifyNode` in `apps/api/src/modules/admin/workflow-detect.ts`). A SAM3
  segmentation node's `class_type` won't match that, and hard-coding its exact
  custom `class_type` string would be fragile if the node is ever renamed.
  Validation for this field checks only that the node ID exists in the JSON —
  reading and writing its text reuse `extractPromptText`/`writePromptText`
  unchanged, which already try `inputs.prompt` then `inputs.text`.
- **No auto-detection.** The existing detector (`workflow-detect.ts`) finds
  positive/negative prompt nodes by tracing which `TextEncode*` node feeds a
  `KSampler*`'s `positive`/`negative` input. A SAM3 node doesn't feed a
  KSampler, so that technique doesn't apply. The admin enters the node ID
  directly, the same manual-entry UX `ksamplerOverrides[].nodeId` already uses.

## Design

### 1. Data model (`packages/db/src/schema/models.ts`)

Add to `workflowTemplates`:

```ts
samSegmentationPromptNode: text('sam_segmentation_prompt_node'), // nullable — most templates have no SAM3 node
defaultSamSegmentationPrompt: text('default_sam_segmentation_prompt').notNull().default(''),
```

Add the same two columns to `workflowTemplateArchives`, so an archived
(draining) version keeps its own snapshot — matching every other node-ID /
default-prompt field already duplicated on that table.

New Drizzle migration. Backward-compatible: every existing row gets
`samSegmentationPromptNode = NULL`, `defaultSamSegmentationPrompt = ''` — no
observable change until an admin sets a node ID.

### 2. Admin API (`apps/api/src/modules/admin/workflows.routes.ts`)

**`POST /admin/workflows`** (and the `saree_step1_two_input` / `two_stage` /
`regeneration` creation branches that build their own insert-field object):
accept optional `samSegmentationPromptNode` in the body. When present,
`validateNodeExists(json, id, 'SAM3 segmentation prompt')` (existence only —
no `validateNodeType` call, per the decision above), then extract
`defaultSamSegmentationPrompt: extractPromptText(json[samSegmentationPromptNode])`.
Absent → both new columns take their defaults (`null` / `''`).

**`PATCH /admin/workflows/:id`**: body gains two optional fields —

```ts
samSegmentationPromptNode?: string; // set/replace the node ID
samSegmentationPrompt?: string;     // edit the node's text
```

- `body.samSegmentationPromptNode` present → `validateNodeExists`, then
  `updateValues.samSegmentationPromptNode = body.samSegmentationPromptNode`.
- `body.samSegmentationPrompt !== undefined` → requires a node ID already
  resolved (either just-set in this same request or pre-existing on `existing`),
  same guard shape as `stage1PositivePrompt`/`stage1NegativePrompt`:

  ```ts
  const newSamNode = body.samSegmentationPromptNode ?? existing.samSegmentationPromptNode;
  if (body.samSegmentationPrompt !== undefined) {
    if (!newSamNode) {
      throw new AppError(
        'VALIDATION', 400,
        'cannot set samSegmentationPrompt: this workflow has no SAM3 segmentation prompt node',
      );
    }
    writePromptText(json, newSamNode, body.samSegmentationPrompt);
  }
  ```

- Re-derive `defaultSamSegmentationPrompt` from `json[newSamNode]` whenever
  either `samSegmentationPromptNode` or `samSegmentationPrompt` was part of the
  request, same conditional-recompute shape used for the other prompt pairs.
- `updateValues.jsonContent = json` already gets set whenever any prompt text
  changed — extend that condition to include `body.samSegmentationPrompt !== undefined`.

**Replace-workflow route** (`POST /admin/workflows/:id/replace`): thread
`samSegmentationPromptNode`/default-prompt extraction through the same way
`stage1PositivePromptNode` is, and copy both columns into the archive row
alongside the other node-ID fields already archived there.

**Detail/list read endpoints**: include `samSegmentationPromptNode` and
`defaultSamSegmentationPrompt` in the selected columns returned to the admin
UI (`GET /admin/workflows`, `GET /admin/workflows/:id`).

### 3. Admin UI

**`apps/admin-web/src/components/WorkflowUploadModal.tsx`** and
**`ReplaceWorkflowModal.tsx`**: one new optional text input, "SAM3
segmentation node ID (optional)", alongside the stage-1 node-ID inputs. Free
text, no dropdown/auto-detect (per decision above). Included in the create /
replace payload only when non-empty.

**`apps/admin-web/src/pages/WorkflowsPage.tsx`**:
- `WorkflowDetail` interface gains `samSegmentationPromptNode: string | null`
  and `defaultSamSegmentationPrompt: string`.
- Edit form state gains `samSegmentationPrompt`, initialized from
  `editingWf.defaultSamSegmentationPrompt` when opening the drawer.
- The Edit drawer renders a "SAM3 segmentation prompt" textarea whenever
  `editingWf?.samSegmentationPromptNode` is truthy — same gating pattern as
  the existing `stage1PositivePromptNode`/`stage1NegativePromptNode` fields
  (lines ~1398, ~1412 today).
- `handleEditSave` includes `patch.samSegmentationPrompt` in the PATCH body
  under the same `if (editingWf.samSegmentationPromptNode)` gate used for the
  stage-1 fields, and updates local state optimistically the same way.
- Read-only detail view (`viewingDetail`) adds a "SAM3 segmentation prompt
  node" row to the node-ID summary list and, when set, a prompt-preview block
  alongside the existing face/garment-phase prompt previews.

### 4. Testing

Extend `apps/api/test/integration/admin-workflows.test.ts`, which already
covers `POST`/`PATCH /admin/workflows`:

- Creating a workflow with `samSegmentationPromptNode` set extracts and
  stores the correct `defaultSamSegmentationPrompt`.
- `PATCH` setting `samSegmentationPromptNode` alone (no prompt text) succeeds
  and re-extracts the default from the JSON's current value.
- `PATCH` setting `samSegmentationPrompt` when no node ID is configured is
  rejected with a clear validation error.
- `PATCH` setting `samSegmentationPrompt` when a node ID *is* configured
  writes into `jsonContent` at that node (checking whichever of
  `inputs.prompt`/`inputs.text` the node already used) and updates
  `defaultSamSegmentationPrompt`.
- Replacing a workflow's JSON carries the SAM3 node fields into the archive
  row, matching the existing archive-field assertions for other node IDs.

## Out of scope

- Per-pose / per-garment-type override of the SAM3 prompt (see Confirmed
  decisions).
- Any dispatcher (`apps/dispatcher`) change — the value is baked into
  `jsonContent` at edit time, never patched per-job.
- Auto-detection of the SAM3 node ID from the uploaded JSON.
