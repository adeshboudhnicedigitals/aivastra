# Pose Upload — Multi-Workflow & Finer Asset Control

**Date:** 2026-05-26  
**Status:** Approved

---

## Overview

Replace the batch pose upload modal with a single-pose upload flow that gives admins finer control: upload/select face and background inline, upload a backend-only side/tilt face for ComfyUI, choose a workflow template (twopiece / onepiece / hijab), and edit per-pose positive prompts pre-filled from the template.

---

## What Changes

### 1. DB Migration — `model_poses` table

Add 4 columns:

```sql
ALTER TABLE model_poses
  ADD COLUMN workflow_template TEXT NOT NULL DEFAULT 'twopiece',
  ADD COLUMN prompt_face_phase TEXT,
  ADD COLUMN prompt_garment_phase TEXT,
  ADD COLUMN face_side_r2_key TEXT;
```

| column | type | description |
|---|---|---|
| `workflow_template` | `TEXT NOT NULL DEFAULT 'twopiece'` | Which JSON template dispatcher uses |
| `prompt_face_phase` | `TEXT` | Positive prompt for face/pose ComfyUI stage. Defaults to template value. |
| `prompt_garment_phase` | `TEXT` | Positive prompt for garment ComfyUI stage. Defaults to template value. |
| `face_side_r2_key` | `TEXT` | R2 key of side/tilt face image. Backend only — never shown to end users. |

### 2. Workflow Templates

Copy to `templates/`:
- `data/api/onepiece.json` → `templates/onepiece.json`
- `data/api/hijab.json` → `templates/hijab.json`

Existing `templates/virtual-tryon-v2.json` = `twopiece`.

**Template → ComfyUI node mapping:**

| template | face node | pose node | bg node | upper node | lower node | face_phase prompt node | garment_phase prompt node |
|---|---|---|---|---|---|---|---|
| `twopiece` | 1332 | 1333 | 1334 | 1340, 1352 | 1331 | `1345:111` | `1341:1199` |
| `onepiece` | 1302 | 1313 | 1310 | 1314 | 1323 | `1308:111` | `1315:1199` |
| `hijab` | 1392 | 1379 | 1391 | 1382 | — | `1383:111` | `1381:1199` |

**Face node is patched with `face_side_r2_key`** (side/tilt face), NOT the display face (`model_faces.r2Key`). The `faceId` FK remains on the pose for frontend display only.

### 3. `GET /admin/workflows` endpoint

Returns template metadata used by the upload modal to populate defaults:

```json
[
  {
    "value": "twopiece",
    "label": "Two-Piece (Upper + Lower)",
    "defaultFacePhasePrompt": "<text from 1345:111>",
    "defaultGarmentPhasePrompt": "<text from 1341:1199>"
  },
  {
    "value": "onepiece",
    "label": "One-Piece / Full Outfit",
    "defaultFacePhasePrompt": "<text from 1308:111>",
    "defaultGarmentPhasePrompt": "<text from 1315:1199>"
  },
  {
    "value": "hijab",
    "label": "Hijab / Head Cover",
    "defaultFacePhasePrompt": "<text from 1383:111>",
    "defaultGarmentPhasePrompt": "<text from 1381:1199>"
  }
]
```

Served from `apps/api/src/modules/admin/config.routes.ts` or a new `workflows.routes.ts`. No auth changes — existing `requireAdmin` guard.

### 4. Presign + Confirm API updates

**`POST /admin/assets/poses/presign`**

Add fields to request body:
- `hasFaceSide: boolean` — if true, returns `faceSideUploadUrl` + `faceSideR2Key`
- `newFaceContentType?: string` — if present, presigns new face upload → returns `newFaceUploadUrl` + `newFaceR2Key` + `newFaceThumbnailUploadUrl` + `newFaceThumbnailKey`
- `newBgContentType?: string` — same for background

**`POST /admin/assets/poses/confirm`**

Add body fields:
- `workflowTemplate: string`
- `promptFacePhase: string`
- `promptGarmentPhase: string`
- `faceSideR2Key: string`
- `newFace?: { label: string; gender: string; r2Key: string; thumbnailKey: string }` — if admin uploaded new face, creates `model_faces` row; label = filename (auto), gender = inferred from subcategory gender slug
- `newBackground?: { label: string; r2Key: string; thumbnailKey: string }` — same for background

### 5. Patcher update (`apps/dispatcher/src/workflow/patcher.ts`)

Replace hardcoded `virtual-tryon-v2.json` with dynamic template loading:

```ts
export interface WorkflowInputs {
  workflowTemplate: 'twopiece' | 'onepiece' | 'hijab';
  upperGarmentFile: string;
  faceSideFile: string;      // side/tilt face → patched into face node
  poseFile: string;          // body pose reference
  backgroundFile: string;
  lowerGarmentFile?: string;
  promptFacePhase?: string;  // if set, overwrites default from template
  promptGarmentPhase?: string;
}
```

Template file map:
```ts
const TEMPLATE_FILES = {
  twopiece: 'virtual-tryon-v2.json',
  onepiece: 'onepiece.json',
  hijab: 'hijab.json',
};
```

### 6. Admin UI — `PoseUploadModal` (replaces `BatchPoseUploadModal`)

Single-pose upload form. Fields:

1. **Pose image** — single file input (jpeg/png/webp)
2. **Model face (display)** — toggle: "Use existing" (dropdown of `model_faces`) | "Upload new" (file input). New upload: auto-labels from filename, gender inferred from subcategory gender slug. Creates `model_faces` row for future reuse.
3. **Background** — toggle: "Use existing" (dropdown of `model_backgrounds`) | "Upload new" (file input). Auto-label from filename.
4. **Side / tilt face** — file input (required). R2 key stored on pose. Never shown to end users. Label on field: "Side face for ComfyUI (backend only)".
5. **Workflow** — dropdown, populated from `GET /admin/workflows`.
6. **Face phase prompt** — textarea, pre-filled from workflow default, editable.
7. **Garment phase prompt** — textarea, pre-filled from workflow default, editable.
8. **Label** — text input (pose label, shown on pose edit page).
9. **Shows lower garment** — switch toggle.
10. **Shows shoes** — switch toggle.
11. **Sort order** — number input.
12. **Template** — checkbox: "Use as template for this face × background cell".

Upload flow:
1. Call presign with `hasFaceSide: true` + optional `newFaceContentType` / `newBgContentType`
2. PUT all files to presigned URLs
3. Call confirm with all metadata
4. New face/background rows created server-side if applicable
5. Toast success, call `onDone(pose)`

Error handling: if any PUT fails, show error per-field. Retry by resubmitting form.

### 7. `AssetsPage` integration

The subcategory pose list's "Add pose" button opens `PoseUploadModal` instead of `BatchPoseUploadModal`. Passes `faces`, `backgrounds`, `subcategoryId`, `subcategoryGenderSlug`.

---

## What Does NOT Change

- `model_faces` and `model_backgrounds` tables — no schema change
- Frontend (web app) — user-facing face selection unchanged; `faceId` still used for display
- Dispatcher job processing — only patcher internals change
- `virtual-tryon-v1.json` — kept in templates, can be added to dropdown later
- Batch upload for catalog items (`BatchCatalogUploadModal`) — unchanged

---

## Out of Scope

- Editing existing pose's side face / prompts (can be added later to `EditPoseModal`)
- V1 template in dropdown (add later)
- Negative prompt editing
