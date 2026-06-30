# Saree Try-On — Design

**Date:** 2026-06-30
**Status:** Draft — awaiting user review of written spec
**Scope:** Temporary feature. Single vertical slice, reuses the existing `tryon`
infrastructure (tables, queue, SSE, cost, presign) with a new `workflowType='saree'`
value and one new `saree_settings` table. No schema changes to `jobs`, `job_inputs`,
`users`, `credits`, or `worker_job_types`.

## Summary

Adds a Saree Try-On flow parallel to (but isolated from) the existing virtual
tryon. The user uploads **one** image (a flat saree), clicks generate, and gets
back a draped-saree result. The model image (the "person") is **static** — set
once by an admin, reused across all jobs. The ComfyUI workflow JSON is uploaded
once by the admin and auto-detected for the `person` (static) and `garment` /
`saree` (user-uploaded) `LoadImage` nodes.

The reference workflow is `templates/saree.json` (Qwen-Image-Edit-2509 + 3 LoRAs,
with a 3-step preprocessing chain: `RMBG` background removal → `AISareeSplitter`
to separate body + pallu → resize/crop/transform). It is GPU-heavy but ships
with a 4-step Lightning LoRA so inference is fast on a qualified worker.

The user-facing page sits at `/saree`. The admin page sits in a new "Saree"
sidebar entry. Both mirror the existing `tryon` UI shapes.

## Reference: saree workflow structure

From `templates/saree.json` (556 lines, 26 nodes):

| Role | Node ID | `class_type` | Title |
|------|---------|--------------|-------|
| output | `950` | `SaveImage` | `save-result` |
| static person input | `951` | `LoadImage` | `person` (image `1782279578.png` baked in) |
| user saree input | `952` | `LoadImage` | `flatsaree` (image `image (1).jpg` baked in) |
| preprocessing chain | `954`–`1014:1007` | `RMBG`, `AISareeSplitter`, `ImageScaleToTotalPixels`, `Bounded Image Crop with Mask`, `ClothesSegment`, `ImageRotate`, `Crop (mtb)`, `Transform Image (mtb)`, `ResizeAndPadImage`, `GetImageSize+`, `easy mathInt` | (untitled preprocessing) |
| model + LoRAs | `949:37`–`949:499` | `UNETLoader`, `CLIPLoader`, `VAELoader`, `LoraLoader` ×3 | (Qwen 2509 + 3 LoRAs) |
| model sampling | `949:66`, `949:75` | `ModelSamplingAuraFlow`, `CFGNorm` | (shift=100, strength=1) |
| prompts | `949:111`, `949:110` | `TextEncodeQwenImageEditPlus` | positive + negative |
| sampler | `949:3` | `KSampler` | (steps=8, cfg=1, dpmpp_2m, karras) |
| decode | `949:8` | `VAEDecode` | (final) |
| latent | `949:874` | `EmptyLatentImage` | (1536×2048) |

**At job time, the dispatcher patches two nodes:**
- `951` (person) → admin's static model image URL
- `952` (flatsaree) → user's uploaded saree image URL
- All other nodes are left exactly as the admin uploaded them.

## Architecture

A new vertical slice, parallel to tryon.

```
admin (SareePage)            api (Fastify)                  dispatcher              worker (ComfyUI)
─────────────────            ─────────────                  ──────────              ─────────────────
1. Upload saree.json    →    POST /admin/saree-workflows    xadd jobs:normal/      pull jobs:saree
   (auto-detect nodes)        validate via detect           jobs:priority          (jobType='saree')
                               store workflow_templates                              load template
2. Set model image      →    POST /admin/saree-settings                               patch person node
   (1 presign + PATCH)        /presign                                                 w/ admin model R2 key
                               PATCH /admin/saree-settings                             patch saree node
3. Worker selection     →    GET  /admin/saree-workers         (read-only)            w/ user saree R2 key
   (informational list)       filter workers where
                              'saree' in job_types

user (Saree page)
─────────────────
1. Upload saree image   →   POST /v1/uploads/presign  (garment)
2. Click Generate       →   POST /v1/jobs/saree
                              ├─ validate: saree_settings.model_image_key set
                              ├─ lookup active workflow_templates (workflowType='saree')
                              ├─ atomicDeduct SIMPLE_TRYON_COST
                              ├─ insert job + jobInputs { garmentKey, params: { modelKey, workflowTemplateId, kind: 'saree' } }
                              └─ xadd jobs:normal or jobs:priority
3. SSE                  ←   /v1/jobs/stream → COMPLETED → GET /v1/jobs/:id/result
```

**Reuses (no changes):**
- `POST /v1/uploads/presign` — generic presign endpoint
- `GET /v1/jobs/stream` — user-level SSE
- `GET /v1/jobs/:id/result` and `/thumbnail` — presigned result URLs
- `assertOwnsUploadKey` — Redis-bound upload ownership check
- `atomicDeduct` / `refund` — credit ledger
- `SIMPLE_TRYON_COST` (35 credits) — pricing
- `jobs:normal` / `jobs:priority` — Redis streams driven by `credit_plans.queueStream`
- `workerJobTypes` — workers self-declare `job_types`; dispatcher routes by it
- `classifyNode` / `normaliseTitle` from `workflow-detect.ts` — node detection

**Reuses (extended, no behavior change for existing tryon):**
- `workflowTemplates` table — adds a new `workflowType` value `'saree'`. The column
  is `text` with no CHECK constraint, so the only change is documentation + the
  admin workflows GET filter (`workflowType === 'tryon' | 'saree'`).
- `tryon-detect.ts` — wrapped by a new `saree-detect.ts` that maps `flatsaree` /
  `saree` titles to the `garment` slot, and exposes the `person` node as
  `modelImageNode` instead of `personNode`.

**New files (this feature):**
- `packages/db/src/schema/saree.ts` — `sareeSettings` table
- `packages/db/src/schema/index.ts` — re-export
- `packages/db/src/migrations/0071_saree_tables.sql` — table DDL
- `packages/types/src/saree.ts` — Zod schemas + types
- `packages/types/src/index.ts` — re-export
- `apps/api/src/modules/admin/saree-detect.ts` — node detection wrapper
- `apps/api/src/modules/admin/saree-detect.test.ts` — detection tests
- `apps/api/src/modules/admin/saree.routes.ts` — admin routes
- `apps/api/src/modules/saree/settings.ts` — single-row settings helper
- `apps/api/src/modules/jobs/createSaree.ts` — job creator
- `apps/api/src/modules/jobs/createSaree.test.ts` — job creator tests
- `apps/api/src/server.ts` — register new routes (one line per router)
- `apps/web/src/app/(app)/saree/page.tsx` — user page
- `apps/admin/src/pages/SareePage.tsx` — admin page
- `apps/admin/src/components/Sidebar.tsx` — new nav entry
- `apps/web/src/components/sidebar.tsx` — new nav entry
- `apps/web/src/app/(app)/saree/saree-icon.svg` — placeholder icon
- `apps/admin/src/App.tsx` — wire the new page

## Data model

### New table `saree_settings`

```sql
CREATE TABLE saree_settings (
  id                    uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  model_image_key       text,
  model_image_thumb_key text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
```

Single-row pattern, mirroring `tryon_settings`. Drizzle table in
`packages/db/src/schema/saree.ts`.

### New enum value `workflowType='saree'`

No schema change. `workflowTemplates.workflowType` is `text` (no CHECK
constraint). At the API layer we filter `where workflowType = 'saree'` for
saree lookups and `in ('tryon','saree')` for combined lookups.

### No changes to existing tables

`jobs`, `job_inputs`, `users`, `credits`, `worker_job_types`, `model_pose_assets`,
`catalog_*` — all untouched. The saree job is a normal `QUEUED` job with a
`jobInputs` row whose `params` JSON has `kind: 'saree'` and the model/workflow
keys.

## API surface

### Admin routes (prefix `/admin`, role: SUPER_ADMIN or MODERATOR)

| method | path | purpose |
|---|---|---|
| `GET` | `/admin/saree-workflows/active` | Returns the current active saree workflow: `{ id, slug, label, jsonContent, detected: { modelImageNode, sareeImageNode, outputNode, positivePromptNode, negativePromptNode, defaultPositivePrompt, defaultNegativePrompt } }`. 404 if none. |
| `POST` | `/admin/saree-workflows` | Body: `{ label, slug, jsonContent }`. Server runs `detectSareeMappings`, requires `modelImageNode` and `sareeImageNode` to be detected, validates JSON parses, marks the new row `isActive=true` and demotes any prior active saree workflow to `isActive=false`. |
| `DELETE` | `/admin/saree-workflows/:id` | Sets `isActive=false` (soft delete — keeps the row for audit). |
| `GET` | `/admin/saree-settings` | Returns `{ modelImageUrl, modelImageThumbUrl, isConfigured: boolean }` (presigned URL or null). |
| `POST` | `/admin/saree-settings/presign` | Body: `{ contentType: string }`. Returns `{ r2Key, uploadUrl, thumbnailKey, thumbnailUploadUrl }`. |
| `PATCH` | `/admin/saree-settings` | Body: `{ modelImageKey?: string, modelImageThumbKey?: string }`. Upserts the single row. |
| `GET` | `/admin/saree-workers` | Returns `Array<{ id, hostname, status, jobTypes: string[] }>` filtered to workers whose `job_types` includes `'saree'`. Read-only informational. |

### User routes (prefix `/v1`, role: any authenticated user)

| method | path | purpose |
|---|---|---|
| `GET` | `/v1/saree/config` | Returns `{ modelImageUrl: string\|null, isConfigured: boolean, creditsCost: 35 }`. The user page uses this to render the empty state and disable the generate button when `isConfigured === false`. |
| `POST` | `/v1/jobs/saree` | Body: `{ garmentKey: string }`. Validates: user owns the key, saree is configured, active workflow exists, user not banned. Deducts 35 credits, inserts job+inputs, xadds to `jobs:{queueStream}`. Returns `{ jobId, catalogueId }`. Refunds on enqueue failure. |

### Types package additions (`@aivastra/types`)

```ts
// packages/types/src/saree.ts
export const SareeConfigResponse = z.object({
  modelImageUrl: z.string().url().nullable(),
  isConfigured: z.boolean(),
  creditsCost: z.literal(35),
});

export const CreateSareeJobRequest = z.object({
  garmentKey: z.string().min(1).max(512),
});

export const AdminSareeWorkflow = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  label: z.string(),
  isActive: z.boolean(),
  detected: SareeDetectedNodes,
  jsonContent: z.record(z.unknown()),
});

export const SareeDetectedNodes = z.object({
  modelImageNode: z.string().nullable(),
  sareeImageNode: z.string().nullable(),
  outputNode: z.string().nullable(),
  positivePromptNode: z.string().nullable(),
  negativePromptNode: z.string().nullable(),
  defaultPositivePrompt: z.string(),
  defaultNegativePrompt: z.string(),
});

export const AdminSareeSettings = z.object({
  modelImageKey: z.string().nullable(),
  modelImageThumbKey: z.string().nullable(),
});
```

## Saree node detection

New file `apps/api/src/modules/admin/saree-detect.ts`. Wraps
`workflow-detect.ts` (shared `classifyNode` + `normaliseTitle`) and the existing
`tryon-detect.ts` mapping. Adds one alias: `normaliseTitle('flatsaree')` and
`normaliseTitle('saree')` both normalize to the `garment` slot, so the
existing detector picks it up.

The saree detector exposes a typed shape distinct from tryon:

```ts
export interface DetectedSareeMappings {
  modelImageNode: string | null;   // the "person" LoadImage (admin's static image)
  sareeImageNode: string | null;   // the "flatsaree"/"saree" LoadImage (user's image)
  outputNode: string | null;
  positivePromptNode: string | null;
  negativePromptNode: string | null;
  defaultPositivePrompt: string;
  defaultNegativePrompt: string;
}
```

The admin's "Upload ComfyUI JSON" action calls `detectSareeMappings(json)` and
rejects the upload (400) if `modelImageNode` or `sareeImageNode` is `null`.
The detected IDs are stored in `workflow_templates` columns when relevant;
otherwise the JSON is stored whole and detection is re-run by the worker at
job time. We do **not** add new columns to `workflow_templates` for saree
node IDs in the temporary scope — the JSON itself is the source of truth.

## Dispatcher / worker integration

The api does not talk to ComfyUI. The dispatcher reads from the
`jobs:normal` / `jobs:priority` streams, picks a worker whose
`job_types` includes the job's kind, and hands the job to that worker.

The new path is:

1. Worker calls `GET /internal/saree-runtime` (a new internal api endpoint, no
   auth — same pattern as the tryon internal endpoint) → returns
   `{ workflowTemplate: { jsonContent, slug }, modelImageR2Key }`. Cached for
   30 s.
2. Worker patches the JSON: sets `951.inputs.image` to the presigned URL of
   `saree_settings.model_image_key`, and `952.inputs.image` to the presigned
   URL of the user's `garmentKey`.
3. Worker POSTs the patched JSON to its ComfyUI instance, waits for
   completion, and writes the result R2 object via the existing
   `keys.output(jobId)` path. The `job_outputs` row is created with
   `thumbnailKey` set after a thumbnail is generated.

The `internal` endpoint is reachable by all workers (no auth) and is the
same pattern used by the existing tryon worker flow. The dispatcher itself
needs no changes — it already routes by `params.kind` once we add the value
to its `JOB_KIND` allow-list (one constant in the dispatcher source).

If the dispatcher code does not currently branch on `params.kind` (i.e. it
infers kind from `workflowType` or other heuristics), we add a single line
in the dispatcher to recognize `kind: 'saree'` and pick workers whose
`job_types` contains `'saree'`. This is verified during planning.

### Worker job type

Workers self-declare `job_types` like `['tryon', 'saree']` in the `workers`
table. The existing `workerJobTypes` column is a `text[]` so no schema
change is required. Admin edits this from the existing Workers page
(not the new Saree page — the Saree page only shows the resulting list).

## User page (`/saree`)

Layout: 2-column grid, identical to `/tryon`.

- **Left card** — single upload zone for the saree image.
  - Label: "Upload Saree Image"
  - Tip: "Use a flat, top-down photo of the saree for best results."
  - Drag-and-drop + "Browse Image" button
  - Sample image hover (info icon, top-right) showing the admin's model image
- **Right card** — preview pane.
  - Header: "Your Saree Try-On Preview"
  - Empty state: spinner (when generating) or "No saree generated yet"
  - Result image on COMPLETED
- **Footer** — "Uses 35 credits (N available)" + "Generate Saree Try-On" button.
  Disabled when: not configured, no saree uploaded, generating, banned.
- **Contact-Us side cards** — copy-paste from `/tryon` (Integrate + Kiosk).
- **Error banner** — same red pill shape as tryon.

### Data flow

```ts
// On mount
const { data: cfg } = useQuery({
  queryKey: ['saree-config'],
  queryFn: () => api.get('/v1/saree/config'),
  staleTime: 5 * 60_000,
});

// On generate
const presign = await api.post('/v1/uploads/presign', {
  contentType: sareeFile.type, contentLength: sareeFile.size,
});
await api.uploadToR2WithProgress(presign.uploadUrl, sareeFile, setProgress);
const { jobId } = await api.post('/v1/jobs/saree', { garmentKey: presign.r2Key });
setPendingJobId(jobId);

// On SSE COMPLETED
const { url } = await api.get(`/v1/jobs/${jobId}/result`);
setResultUrl(url);
```

The `useJobStream` hook is reused without changes.

### Not-configured empty state

If `cfg.isConfigured === false`, the left upload card shows a top banner:
"Saree try-on is not yet configured by the admin. Check back soon."
The upload zone is dimmed and disabled.

## Admin page (`/saree` in admin)

Single page, 3 stacked sections, all under one `<SareePage>` component:

### Section 1: ComfyUI Workflow

- **Current state**: show active workflow as a card with:
  - Slug + label
  - Node detection summary:
    `Person (static): 951 · Saree (user): 952 · Output: 950 · Prompts: 949:111 / 949:110`
  - `Active` / `Inactive` pill
- **Actions**:
  - "Upload new JSON" button → opens a modal with a file input (accept `.json`)
    + label/slug fields. On submit, server runs `detectSareeMappings`; if
    either required node is missing, the modal shows the error and the row
    is not created.
  - "Deactivate" button (when active): soft-deletes (sets `isActive=false`).

### Section 2: Model Image

- Single 100×100 thumbnail preview of the current model image, or
  `Icon.Image` placeholder.
- "Upload" / "Replace" file input → calls presign + PUT (full + thumb) +
  PATCH `/admin/saree-settings`.
- "Remove" button → PATCH with both keys set to `null`.

### Section 3: Worker Selection (informational)

- Table: `Hostname | Status | Job types | Saree-capable`
- "Saree-capable" badge on rows whose `job_types` includes `'saree'`.
- Hint text: "Edit a worker's job types from the Workers page to enable it
  for saree jobs."
- Link to the existing Workers page (router push).

### Sidebar entries

```ts
// apps/admin/src/components/Sidebar.tsx — add to `items` array
{ k: 'saree', label: 'Saree', icon: Icon.Workflow, roles: ['SUPER_ADMIN', 'MODERATOR'] }

// apps/web/src/components/sidebar.tsx — add to `NAV` array
{ id: 'saree', href: '/saree', label: 'Saree', icon: `${BASE}/assets/saree-icon.svg`, badge: 'New' }
```

A simple `saree-icon.svg` placeholder is added to `apps/web/public/assets/`
(an outline dress or saree silhouette; spec uses a 24×24 stroke-only SVG
matching the existing icons).

## Error handling

| Condition | HTTP / behavior |
|---|---|
| `garmentKey` missing or empty | 400 `VALIDATION` |
| `garmentKey` not owned by user (Redis upload binding) | 403 `FORBIDDEN` |
| Uploaded garment missing in R2 (HEAD fails) | 400 `BAD_UPLOAD` |
| Uploaded garment > 10 MB | 413 `BAD_UPLOAD` |
| No active saree workflow | 400 `CONFIG` |
| `saree_settings.model_image_key` is null | 400 `NOT_CONFIGURED` |
| User banned | 403 `FORBIDDEN` |
| Redis xadd fails (queue down) | 503 `ENQUEUE_FAIL`; refund credits, mark job `FAILED` |
| Invalid workflow JSON (parses fails) | 400 `VALIDATION` |
| Required node (`modelImageNode` or `sareeImageNode`) not detected | 400 `VALIDATION` with specific message |
| Slug collision on workflow insert | 409 `CONFLICT` |

All errors are surfaced as toasts in the admin UI and as inline red banners
in the user page (existing `AppError` shape; no changes to error handling
infrastructure).

## Testing

### Unit / integration tests (Vitest, mirrors tryon)

- **`apps/api/test/saree-detect.test.ts`** — runs `detectSareeMappings` on
  `templates/saree.json`, asserts:
  - `modelImageNode === '951'`
  - `sareeImageNode === '952'`
  - `outputNode === '950'`
  - `positivePromptNode === '949:111'`
  - `negativePromptNode === '949:110'`
  - `defaultPositivePrompt` contains "nivi Style"
  - `defaultNegativePrompt` contains "low quality"

- **`apps/api/test/saree-jobs.test.ts`** — integration test using the
  existing test harness (`apps/api/test/helpers/`):
  1. Seed `saree_settings` with a model image R2 key
  2. Seed an active `saree` workflow
  3. Presign a fake garment image, then call `POST /v1/jobs/saree`
  4. Assert: 201, jobId returned, `creditsCharged=35`, `jobInputs.params.kind='saree'`,
     redis stream entry exists
  5. **Refund path**: simulate enqueue failure (mock `redis.xadd` to throw),
     assert job marked FAILED with `errorCode='ENQUEUE_FAIL'` and credits refunded
  6. **Missing model**: clear `saree_settings`, assert 400 `NOT_CONFIGURED`
  7. **Missing workflow**: deactivate workflow, assert 400 `CONFIG`
  8. **Ownership check**: assert 403 when calling with another user's
     `garmentKey`

- **`apps/api/test/saree-admin.test.ts`** — admin routes:
  1. Upload JSON via `POST /admin/saree-workflows` with `templates/saree.json`,
     assert 201 + auto-detected nodes
  2. Upload JSON with a bad JSON, assert 400
  3. Upload JSON with valid JSON but no person/saree nodes, assert 400
  4. PATCH `/admin/saree-settings`, assert upsert
  5. Non-admin role (ADMIN, SUPPORT) gets 403 on `W` routes

### Manual test plan (recorded in `docs/progress.md`)

1. Admin uploads `templates/saree.json` → confirm detected node IDs
2. Admin uploads a model image → confirm thumbnail visible
3. Worker edits `job_types` to include `'saree'` from the Workers page
4. User opens `/saree` → confirms "not configured" state if model image
   missing, upload disabled state if not
5. User uploads a flat saree + clicks Generate
6. SSE updates the preview to "Generating…", then to result image
7. Verify the result image is the draped saree on the admin's model person
8. Verify credits deducted (35) and refund-on-fail path with a temporary
   redis kill

### Observability

- `jobsCreatedTotal.inc({ priority: queueStream, kind: 'saree' })` — add a
  `kind` label to the existing counter (the counter is in
  `packages/observability`; the existing definition is augmented in this
  feature, with a one-line schema note for the new label).
- All log lines in the saree job creator use
  `req.log.child({ jobId, userId, kind: 'saree' })`.
- No new dashboards in this scope.

## Migration & rollout

### Migration

New file `packages/db/src/migrations/0071_saree_tables.sql`:

```sql
CREATE TABLE saree_settings (
  id                    uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  model_image_key       text,
  model_image_thumb_key text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
```

This is the **only** DB change. No backfill, no data migration.

### Drizzle schema

New file `packages/db/src/schema/saree.ts` defining `sareeSettings` (single
text + uuid columns as above). Re-exported from
`packages/db/src/schema/index.ts`.

### Seed

None. The feature is intentionally unusable until admin uploads the JSON
and the model image. This also means `GET /v1/saree/config` returns
`isConfigured: false` until both are present.

### Rollout order

1. Apply migration (`pnpm db:migrate`)
2. Deploy api with new routes
3. Deploy web + admin with new pages and sidebar entries
4. **Workers** self-edit `job_types` to include `'saree'` (per-worker config
   change, no binary redeploy)
5. Admin uploads `templates/saree.json` + sets the model image
6. Users see the new sidebar entry and `/saree` page

### Rollback

- Drop `saree_settings` table (idempotent)
- Remove the 4 new files from `apps/api/src/modules/admin/saree*` and
  `apps/api/src/modules/jobs/createSaree.ts`
- Remove the 2 new page files
- Remove the sidebar entries
- Existing saree jobs in the `jobs` table are still visible in the Jobs
  page (with `creditsCharged=35`) but no worker will claim them — they sit
  in the stream until manually removed. We accept this for the temporary
  feature; a full migration is out of scope.

### Risk: stranded jobs

If a saree job is enqueued with no worker subscribed to `'saree'`, the
job sits in the queue forever. The existing dispatcher already has a
timeout for unclaimed tryon jobs (we will mirror the same timeout in the
saree branch) — to be confirmed during planning. The risk is bounded by
the fact that the admin is the one who flips on worker support, and the
saree user page shows `isConfigured: false` until admin has set both
pieces.

## Out of scope (explicit YAGNI)

- No saree categories (single workflow, not multiple)
- No per-category model image (single global model)
- No per-pose workflow overrides (the saree workflow is one JSON)
- No aspect-ratio selection (Qwen workflow pins 1536×2048 in
  `EmptyLatentImage`)
- No prompt override fields in the admin UI (the workflow's positive /
  negative prompts are what runs; the user cannot override)
- No history of past saree jobs beyond what `/v1/catalogues` already
  surfaces (saree jobs use the same `jobs` + `job_inputs` tables as
  tryon, so they appear in the existing catalogues list)
- No version pinning of the workflow (last upload wins)
- No analytics dashboard
- No a/b testing or staged rollout
- No prompt-safety sanitization beyond what the existing
  `promptGuard` does for regular jobs (saree job inputs contain no
  user-controlled text, so this is a non-issue)

## Open questions / decisions

- **Dispatcher job-type branch location** — to be confirmed during
  planning by reading the dispatcher source. The contract is
  "saree jobs route to workers with `saree` in their `job_types`";
  the implementation detail is the dispatcher's existing
  jobType-detection logic. If the existing dispatcher infers type
  from `workflowType` alone, we add a single mapping
  `workflowType='saree' → kind='saree'`. If it already handles kinds,
  we add the value to the allow-list.

- **Worker timeout for unclaimed saree jobs** — confirm the same
  timeout used for unclaimed tryon jobs (if any) applies to saree.

- **Dispatcher fetches workflow template** — confirm whether the
  worker-side fetch already exists as an internal endpoint and just
  needs a new `saree` kind added, or whether we add a new endpoint.
