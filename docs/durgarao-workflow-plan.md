# Plan: Onboarding `Durgarao_Workflow.json` + Pose-Driven Output Sizing

**Status:** Planning / not yet implemented
**Date:** 2026-06-23
**Workflow file:** `Durgarao_Workflow.json` (root) → to be versioned into `templates/`
**Scope:** dispatcher patcher, `workflow_templates` + `model_pose_assets` schema, admin pose/workflow upload, template registration.

---

## 1. Background

`Durgarao_Workflow.json` is the API-format export of a new Qwen-Image-Edit try-on
graph ("build_model"). It replaces the older template family with a single graph
that:

- segments the **face/head** from the model face image (subgraph `651:*`),
- segments and stitches the **outfit** (upper / lower / shoes) with switch logic
  for closeup / halfbody / fullbody (subgraph `691:*`),
- runs **DWPose** over the pose image to drive the generation pose (`876`),
- generates with a 4-step **Qwen-Image-Lightning** stack
  (`1044:*` — UnetLoaderGGUF, CLIPLoader, dual LoRA, KSampler, VAEDecode),
- resizes/pads the decoded image to a delivery size and saves it (`737` → `739`).

This document captures every decision made while reviewing the workflow and the
PHP `resize_to_max` function, plus the concrete changes required before the
template can be wired into production.

---

## 2. Node map (the IDs that matter)

| Node ID | class_type | Title | Role |
|---------|-----------|-------|------|
| `615` | LoadImage | face | **faceNodeId** — model face image |
| `875` | LoadImage | pose | **poseNodeId** — pose reference (drives DWPose + canvas aspect) |
| `626` | LoadImage | background | **bgNodeId** |
| `686` | LoadImage | upper garment | **upperNodeIds[0]** |
| `680` | LoadImage | lower garment | **lowerNodeId** |
| `679` | LoadImage | footwear | **shoeNodeId** |
| `733` | PrimitiveInt = 2048 | max-width | **generation width** → EmptyLatentImage + DWPose resolution |
| `734` | PrimitiveInt = 2048 | max-height | **generation height** → EmptyLatentImage |
| `1034` | PrimitiveInt = 1024 | result-width | **delivery width** → ResizeAndPadImage target |
| `736` | PrimitiveInt = 1024 | result-height | **delivery height** → ResizeAndPadImage target |
| `1044:1040` | TextEncodeQwenImageEditPlusPro | — | **garmentPhasePromptNode** (positive, `inputs.prompt`) |
| `1044:1038` | CLIPTextEncode | — | **facePhasePromptNode** (negative, never patched) |
| `1044:1031` | EmptyLatentImage | — | generation canvas; `width←733`, `height←734` |
| `876` | DWPreprocessor | DWPose Estimator | `resolution←733` (shares generation width) |
| `1044:1030` | VAEDecode | — | decoded result; fans out to `617` **and** `737` |
| `737` | ResizeAndPadImage | — | delivery resize; `target_width←1034`, `target_height←736` |
| `739` | SaveImage | customer-result-Image | **the only saved output** |
| `617` | PreviewImage | model-result | UI-only preview of raw VAEDecode (not collected) |
| `1032` | Get Date Time String | — | feeds `739.filename_prefix` (keep) |

> Subgraphs `651:*` (face extract) and `691:*` (outfit stitch) are internal — the
> patcher never touches them. They contain their own `ResizeAndPadImage` nodes
> (`691:674` = 512×512 footwear, `691:673` = garment) that **must not** be treated
> as output-size nodes. See §6.

---

## 3. The two output images (decided)

The graph produces two image sinks off the same `VAEDecode` (`1044:1030`):

1. **`617` — `PreviewImage` "model-result"** — the raw decoded image at the
   *generation* size. ComfyUI emits previews as `type: "temp"`.
2. **`739` — `SaveImage` "customer-result-Image"** — the decoded image after
   `737` resize+pad to the *delivery* size. ComfyUI emits saves as `type: "output"`.

**Decision:** `617` was changed from `SaveImage` → `PreviewImage` and the orphan
`618` (Get Date Time String feeding 617's filename) was removed.

**Why it matters:** `fetchHistory` in `apps/dispatcher/src/comfyui/client.ts`
collects **all** `type === "output"` images. With two `SaveImage` nodes the
dispatcher would pick a non-deterministic "first" image. With `617` as a preview,
only `739` is `type: "output"`, so `fetchHistory` deterministically returns the
customer result. `739` is what gets uploaded to R2 as the job result.

---

## 4. Output sizing — two `PrimitiveInt` pairs

Output dimensions are controlled by **four `PrimitiveInt` nodes**, grouped into
two independent pairs that serve different purposes:

| Pair | Width node | Height node | Default | Purpose |
|------|-----------|-------------|---------|---------|
| **Generation** | `733` | `734` | 2048×2048 | High-res canvas the model is generated on (also DWPose resolution `876`). |
| **Delivery** | `1034` | `736` | 1024×1024 | Final size `737` resizes+pads the decode to, then `739` saves. |

These are intentionally **different scales**: generate large (2048) for quality,
deliver smaller (1024) for web. They must share the **same aspect ratio** — only
the longest-side cap differs.

---

## 5. The `resize_to_max` function (decided approach)

### What it does

Given a source `width`/`height`, it scales the **longest side to `max`** and the
shorter side proportionally — preserving aspect ratio. Reference PHP from the
senior:

```php
function resize_to_max($width, $height, $max = 2048) {
    if ($width <= 0 || $height <= 0) return false;
    if ($width == $height) return ['width' => $max, 'height' => $max];
    if ($width > $height) {                 // landscape
        $ratio = $height / $width;
        return ['width' => $max, 'height' => round($max * $ratio)];
    }
    $ratio = $width / $height;              // portrait
    return ['width' => round($max * $ratio), 'height' => $max];
}
```

### Decision: feed it the **actual pose image pixel dimensions**, not abstract ratio presets

The generated model adopts the **pose**, so the output's natural aspect ratio is
the pose image's aspect ratio. Therefore we compute both size pairs from the pose
image's real pixels:

```
gen      = resizeToMax(poseWidth, poseHeight, 2048)   → patch 733 / 734
delivery = resizeToMax(poseWidth, poseHeight, 1024)   → patch 1034 / 736
```

This replaces the current `ASPECT_DIMENSIONS` preset lookup (`1:1`, `2:3`, `3:4`,
`4:5` → fixed dims) for this workflow. Presets are abstract guesses; the pose's
real dimensions are ground truth and keep `gen` and `delivery` perfectly
consistent.

### TypeScript port (to add to the patcher)

```ts
export function resizeToMax(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: max, height: max };
  if (width === height) return { width: max, height: max };
  if (width > height) return { width: max, height: Math.round(max * (height / width)) };
  return { width: Math.round(max * (width / height)), height: max };
}
```

---

## 6. Current behaviour if the patcher is NOT changed (the bug)

The current patcher (`apps/dispatcher/src/workflow/patcher.ts`) only patches what
is listed in `tmpl.sizeNodeIds`, using `ASPECT_DIMENSIONS[aspectRatio]` and the
rule `i === 0 → width, else → height`. Two things break for this workflow:

1. **Single-pair assumption.** The `i === 0 → width` logic handles exactly one
   width+height pair. It cannot express "733/734 at max 2048 **and** 1034/736 at
   max 1024." Whatever subset is listed, the second pair gets the wrong values or
   none.

2. **Auto-detect picks the wrong nodes.** `detectMappings` in
   `apps/api/src/modules/admin/workflow-detect.ts` builds `sizeNodeIds` from
   **class_type** (`SIZE_CLASS_TYPES` = EmptyLatentImage, ResizeAndPadImage, …).
   In this graph that would select `1044:1031` (EmptyLatent), `737` (delivery
   resize), **and the internal `691:674` / `691:673` resizes**, while *missing*
   the actual control nodes (the `PrimitiveInt`s, which classify as `other`).
   Worse, the EmptyLatent/ResizeAndPad nodes read their dims from the
   `PrimitiveInt`s via **link arrays** (e.g. `"width": ["733", 0]`); writing a raw
   integer there would overwrite the wiring and could squish the 512×512 footwear
   crop.

**Net effect today:** if registered as-is, the delivery pair (`1034`/`736`) is
never patched and stays at its hardcoded **1024×1024**. Every customer result is a
1024×1024 square — distorted for any non-square pose — regardless of the user's
aspect-ratio selection. The generation canvas may or may not be touched depending
on what auto-detect grabbed, but the *saved* image is always a square.

---

## 7. Changes required

### 7.1 Workflow JSON (DONE)

- [x] Repaired 6 corrupted `LoadImage` nodes (`615`, `626`, `679`, `680`, `686`,
      `875`) — they had `"UNKNOWN": "image"` and no `class_type`; fixed to
      `{"class_type":"LoadImage","inputs":{"image":""}}`.
- [x] Changed `617` `SaveImage` → `PreviewImage` so only `739` is collected.
- [x] Removed orphan `618` (date-time node that only fed 617).

### 7.2 Schema — `model_pose_assets` (pose dimensions)

Add the pose image's pixel dimensions so the dispatcher can compute sizing:

```ts
// packages/db/src/schema/models.ts → modelPoseAssets
width:  integer('width'),   // nullable — populated at upload; null for legacy rows
height: integer('height'),
```

Populated at upload via `sharp(bytes).metadata()` (sharp is already a dispatcher
dependency and is available in the API upload path). Generate + apply a migration.

### 7.3 Schema — `workflow_templates` (two size pairs)

The flat `sizeNodeIds: string[]` cannot encode pairs with different max values.
Add a structured column (JSONB, additive — keeps `sizeNodeIds` for other
templates):

```ts
// packages/db/src/schema/models.ts → workflowTemplates
sizePairs: jsonb('size_pairs')
  .$type<{ widthNodeId: string; heightNodeId: string; maxSize: number }[]>()
  .notNull()
  .default(sql`'[]'::jsonb`),
```

For Durgarao:

```json
[
  { "widthNodeId": "733",  "heightNodeId": "734", "maxSize": 2048 },
  { "widthNodeId": "1034", "heightNodeId": "736", "maxSize": 1024 }
]
```

### 7.4 Patcher redesign (`apps/dispatcher/src/workflow/patcher.ts`)

- Add `resizeToMax` (§5).
- Add `poseWidth?` / `poseHeight?` to `WorkflowInputs`.
- Replace the `ASPECT_DIMENSIONS` size block with: **if `sizePairs` is non-empty
  and pose dims are known**, for each pair set the two `PrimitiveInt` node values
  from `resizeToMax(poseWidth, poseHeight, pair.maxSize)`:

```ts
if (tmpl.sizePairs?.length && inputs.poseWidth && inputs.poseHeight) {
  for (const pair of tmpl.sizePairs) {
    const { width, height } = resizeToMax(inputs.poseWidth, inputs.poseHeight, pair.maxSize);
    const wNode = workflow[pair.widthNodeId];
    const hNode = workflow[pair.heightNodeId];
    if (wNode?.class_type === 'PrimitiveInt') wNode.inputs.value = width;
    if (hNode?.class_type === 'PrimitiveInt') hNode.inputs.value = height;
  }
} else if (inputs.aspectRatio && tmpl.sizeNodeIds.length > 0) {
  // legacy ASPECT_DIMENSIONS path — unchanged for older templates
}
```

- **Fallback:** if pose dims are missing (legacy pose rows) or `sizePairs` is
  empty, fall through to the existing `ASPECT_DIMENSIONS` behaviour so old
  templates keep working. Log a warning when falling back.

### 7.5 Processor (`apps/dispatcher/src/job/processor.ts`)

- Add `width`/`height` to the `modelPoseAssets` select (around line 131).
- Pass `poseWidth`/`poseHeight` into the `patchWorkflow(...)` call (line 318).

### 7.6 Admin pose upload (`apps/admin/src/components/PoseUploadModal.tsx` + API)

- Capture and persist the uploaded pose image's `width`/`height` (read with sharp
  server-side at upload time — do not trust client-reported values).

### 7.7 Workflow auto-detect (`apps/api/src/modules/admin/workflow-detect.ts`)

The class_type heuristic does not fit `PrimitiveInt`-driven sizing. Options:

- **(A, recommended)** Add a title-based detection pass for size `PrimitiveInt`
  nodes — match `_meta.title` ∈ {`max-width`, `max-height`, `result-width`,
  `result-height`} and assemble `sizePairs` (generation = max/2048, result =
  delivery/1024). Falls back to the existing latent-class detection when no such
  titles exist.
- **(B)** Leave detection as-is and set `sizePairs` manually during registration
  for this template.

### 7.8 Register the template

- Copy `Durgarao_Workflow.json` → `templates/` with a versioned name
  (e.g. `templates/build-model-2026-06.json`).
- Create the `workflow_templates` row:

| Column | Value |
|--------|-------|
| `faceNodeId` | `615` |
| `poseNodeId` | `875` |
| `bgNodeId` | `626` |
| `upperNodeIds` | `["686"]` |
| `lowerNodeId` | `680` |
| `shoeNodeId` | `679` |
| `garmentPhasePromptNode` | `1044:1040` |
| `facePhasePromptNode` | `1044:1038` |
| `sizePairs` | `[{733,734,2048},{1034,736,1024}]` (see §7.3) |
| `sizeNodeIds` | `[]` (unused for this template) |
| `workflowType` | `regular` |

---

## 8. Open questions / decisions to confirm

1. **Does the user's aspect-ratio selection still matter?** The decision is to
   size from the pose image. If the studio's aspect-ratio picker should still
   influence the output (e.g. crop/letterbox to a platform ratio), we need a
   separate step — it is **not** the source of the generation/delivery dims
   anymore. Current leaning: pose dims win; aspect ratio is informational only
   for this workflow.
2. **`maxSize` values.** 2048 (gen) / 1024 (delivery) are taken from the
   workflow's current PrimitiveInt defaults. Confirm these are the intended
   production caps.
3. **`sizePairs` vs auto-detect.** Confirm §7.7 option A (title-based PrimitiveInt
   detection) vs B (manual registration). A is more general; B is faster to ship.
4. **Legacy pose rows** without width/height: backfill with a one-off script
   (read each `r2Key` via sharp) or rely on the fallback path until re-uploaded?

---

## 9. Verification checklist

1. Register template; submit a job with a **portrait** pose (e.g. 832×1216).
2. Inspect the `COMFY_DISPATCH` job event → patched `prompt`:
   - `733`/`734` ≈ `1392×2048` (gen, longest side 2048).
   - `1034`/`736` ≈ `696×1024` (delivery, longest side 1024).
3. ComfyUI history returns exactly **one** `type:"output"` image (node `739`).
4. R2 result object is **non-square** and matches the pose aspect ratio (not
   1024×1024).
5. Submit a **square** pose → both pairs square (2048×2048, 1024×1024).
6. Legacy template (no `sizePairs`) still patches via `ASPECT_DIMENSIONS` —
   no regression.

---

## 10. File-change summary

| File | Change |
|------|--------|
| `Durgarao_Workflow.json` | DONE: LoadImage repair, 617→Preview, drop 618 |
| `templates/build-model-2026-06.json` | NEW: versioned copy |
| `packages/db/src/schema/models.ts` | `modelPoseAssets.width/height`; `workflowTemplates.sizePairs` |
| `packages/db/src/migrations/*` | generated migration |
| `apps/dispatcher/src/workflow/patcher.ts` | `resizeToMax`, `sizePairs` path, pose-dim inputs |
| `apps/dispatcher/src/job/processor.ts` | select + pass pose width/height |
| `apps/api/src/modules/admin/workflow-detect.ts` | (opt A) PrimitiveInt size-pair detection |
| `apps/admin/src/components/PoseUploadModal.tsx` + API | capture pose dimensions |
| `apps/dispatcher/src/workflow/patcher.test.ts` | tests for `resizeToMax` + dual-pair patch |
