# Fabric-to-Garment Feature Port (from propicly)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work the tasks in order — each one builds on the previous (DB → types → API → dispatcher → admin-web → catalogues-web).

**Goal:** Port the "Fabric to Garment" standalone generation tool from the sister repo `propicly` (`/home/chaitanyag/Projects/propicly`) into `aivastra`. A user uploads a flat fabric photo, picks an admin-curated garment-type preset (Shirt, Kurti, Anarkali, …), and a ComfyUI workflow stitches the fabric into that garment's shape — the preset's prompt text drives what shape it becomes. Same single-image-in/single-image-out shape as every other admin-curated-preset generation tool.

**Source of truth for every file referenced below:** `/home/chaitanyag/Projects/propicly`. Every task names the exact propicly file to read before writing the aivastra equivalent — these two repos are forks of the same original codebase (aivastra → propicly, per `propicly/CLAUDE.md`'s branding-cleanup note), so the propicly implementation is a working, shipped reference, not a sketch.

## Why this isn't a pure copy-paste

`aivastra` and `propicly` diverged significantly after the fork. Three concrete differences shape every task below — read this before starting Task 1:

1. **No "standalone creative tool" family exists in aivastra yet.** propicly has eight single-purpose tool pages (background-removal, shadow, product-mannequin, fabric-to-garment, bw-background, blur-background, instant-blur, redchief) sharing a `_shared/` dev-tool-page infrastructure in `apps/propicly-web`. aivastra's `apps/catalogues-web` has none of this — it only has the Studio wizard. Porting fabric-to-garment means also porting a trimmed slice of that shared infra (Task 9), not just the one feature's files.
2. **aivastra's worker routing is coarse; propicly's is granular.** propicly gives every tool its own `selectWorker(redis, '<kind>')` string, validated against nothing (it's a free-form `text[]` column). aivastra constrains `workers.allowedJobTypes` to exactly five values via `WORKER_POOL` (`catalogue`, `tryon`, `saree`, `shopify`, `merchant`) — see `packages/types/src/job-taxonomy.ts`. This plan routes fabric-to-garment jobs through the existing `WORKER_POOL.CATALOGUE` pool rather than inventing a sixth pool value — see the Decisions table below.
3. **aivastra's admin RBAC is permission-based, not role-array-based.** propicly's admin routes gate with `requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN'])`. aivastra gates with `requirePermission('<resource>.<action>')`, backed by a `permissions` / `role_permissions` table that must be seeded via migration (see `packages/db/src/migrations/0167_permissions.sql` and `0205_curvy_sersi.sql` for the exact pattern) — a permission with no seeded grant locks out every role, including `SUPER_ADMIN`. Task 1 seeds `fabricGarmentTypes.read` / `.write` / `.delete`.

Also note: aivastra's `workflow_templates.garmentPhasePromptNode` is already `NOT NULL` (propicly's is nullable) and `workflow_templates.poseNodeId` is `NOT NULL` in both — both columns being reused here are already shaped correctly; **no schema change to `workflow_templates` itself is needed**, only a new `fabric_garment_types` table.

## Decisions (resolve before or during Task 1 — each has a recommendation, not a mandate)

| Decision | Options | Recommendation |
|---|---|---|
| **GPU worker pool for fabric-to-garment jobs** | (A) Route through existing `WORKER_POOL.CATALOGUE` — zero new pool, works immediately on any worker that already serves Studio/catalogue jobs, *if* that worker's ComfyUI install has whatever custom nodes the fabric-to-garment workflow JSON needs (propicly's reference workflow uses `TextEncodeQwenImageEditPlus` nodes — confirm these are already installed on aivastra's catalogue-pool GPU boxes before relying on this). (B) Add a sixth `WORKER_POOL.FABRIC_TO_GARMENT` value, mirroring propicly's per-tool isolation — correct if this workflow needs boxes none of the existing pools cover, but means **zero workers accept these jobs until an admin explicitly flags one**, so nothing dispatches post-deploy without that follow-up step. | **(A)** for the first clean port — fastest to ship, correct once node/model availability is confirmed on at least one catalogue worker (check against the `aivastra-gpu` repo's per-box inventory). Revisit (B) only if ops decides this workflow needs isolated capacity. This plan implements (A); if you choose (B), s/WORKER_POOL.CATALOGUE/WORKER_POOL.FABRIC_TO_GARMENT/ in Task 7 and additionally extend `WORKER_POOL`, `workerPoolSchema`, the Lua script comment in `apps/dispatcher/src/worker/selector.ts`, and `WorkersPage.tsx`'s job-type checkboxes/labels. |
| **"Paste an image URL" upload path** | propicly's shared `useProductUpload()` hook supports both a file picker and a server-side URL-fetch path (`POST /v1/uploads/from-url`, backed by an SSRF-guard + Pinterest-og:image extractor in `apps/api/src/lib/ssrf-guard.ts`). aivastra has neither the route nor the guard today. (A) Port file-upload only for this feature (simpler, no new attack surface). (B) Port the full URL-paste path too (`ssrf-guard.ts`, `upload-limits-config.ts`'s `webGarmentMaxBytes`, the `/v1/uploads/from-url` route), for exact UX parity with propicly. | **(A)**. The URL-paste path is a general upload-UX feature, not something specific to fabric-to-garment, and deserves its own dedicated security review rather than riding in on this port. Task 9 below ports a trimmed `useProductUpload`/`ImageUploadCard` with the URL input removed. Add it later as its own task if wanted — propicly's `apps/api/src/modules/uploads/routes.ts` (the `/v1/uploads/from-url` handler) and `apps/api/src/lib/ssrf-guard.ts` are the exact files to port at that point. |

**Not a decision — settled by precedent:** the uploaded fabric photo's R2 key is stored on **`jobInputs.upperGarmentKey`** (not a new `productImageKey` column). aivastra has no generic single-image column — propicly added `productImageKey` for this exact purpose, but aivastra's `job_inputs.upperGarmentKey` is already read generically as "the uploaded garment image" by every admin/results viewer (tryon, saree mannequin, extension, merchant-tryon, dev-catalog jobs all reuse it) and rendered under a generic "Upper" label. Reusing it for fabric-to-garment needs zero migration and matches exactly how every other single-garment-image job kind already works in this codebase.

---

### Task 1: Database — `fabric_garment_types` table + RBAC permissions

**Files:**
- Modify: `packages/db/src/schema/models.ts` (add table, mirroring propicly's `packages/db/src/schema/models.ts:196-219`)
- Generate: new migration under `packages/db/src/migrations/` (next index after `0215_milky_wraith.sql` → `0216_*`)
- Reference only (do not copy structure, just the column shapes): `propicly/packages/db/src/schema/models.ts:191-219`
- Reference only (permission-seeding pattern): `packages/db/src/migrations/0205_curvy_sersi.sql`, `0167_permissions.sql`

- [ ] **Step 1: Add the `fabricGarmentTypes` table to `packages/db/src/schema/models.ts`**

Add near the other admin-curated-asset tables (e.g. right after `garmentSubcategories` or near `workflowTemplates`), matching propicly's column shapes exactly:

```ts
// Fabric-to-Garment feature — admin-curated garment-type presets (Shirt, Kurti,
// Anarkali, etc). Each preset carries the text prompt (and optional negative
// prompt override) injected into the shared 'fabric_to_garment' workflow
// template's garmentPhasePromptNode / facePhasePromptNode at dispatch time —
// see apps/dispatcher/src/job/processor.ts::processFabricToGarmentJob.
export const fabricGarmentTypes = pgTable(
  'fabric_garment_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    // 'men' | 'women' only (not the system-wide men/women/boys/girls GenderSlug) —
    // validated at the zod layer, not a DB enum.
    genderSlug: text('gender_slug'),
    label: text('label').notNull(),
    thumbnailKey: text('thumbnail_key'),
    prompt: text('prompt').notNull(),
    negativePrompt: text('negative_prompt'), // null = keep the workflow's baked-in default
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqSlugGender: unique().on(table.slug, table.genderSlug),
  }),
);
```

Confirm `unique` is already imported from `drizzle-orm/pg-core` at the top of the file (it is, used elsewhere).

- [ ] **Step 2: Generate the migration**

```bash
cd /home/chaitanyag/Projects/aivastra
pnpm db:generate
```

This produces `packages/db/src/migrations/0216_<auto-name>.sql` (the CREATE TABLE) plus the matching `meta/0216_snapshot.json` and a `_journal.json` entry. Open the generated SQL and hand-append the permission seed (same file, one more `--> statement-breakpoint` block — or append as a *second* migration if you prefer one concern per file; either is fine, but seed the permissions in the same deploy as the table so the admin UI isn't ever reachable-but-unauthorized):

```sql
--> statement-breakpoint
INSERT INTO "permissions" ("key", "description") VALUES
  ('fabricGarmentTypes.read', 'View Fabric-to-Garment garment-type presets'),
  ('fabricGarmentTypes.write', 'Create and update Fabric-to-Garment garment-type presets'),
  ('fabricGarmentTypes.delete', 'Delete Fabric-to-Garment garment-type presets')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, p."id"
FROM "permissions" p
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('MODERATOR'), ('ADMIN')) AS r(role)
WHERE p."key" IN ('fabricGarmentTypes.read', 'fabricGarmentTypes.write')
ON CONFLICT ("role", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, p."id"
FROM "permissions" p
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('MODERATOR')) AS r(role)
WHERE p."key" = 'fabricGarmentTypes.delete'
ON CONFLICT ("role", "permission_id") DO NOTHING;
```

(Grants mirror propicly's own role split for this feature: `SUPER_ADMIN`/`MODERATOR`/`ADMIN` can read+write, only `SUPER_ADMIN`/`MODERATOR` can delete — see `propicly/apps/api/src/modules/admin/fabric-garment-types.routes.ts:23-24`.)

- [ ] **Step 3: Apply locally and verify**

```bash
pnpm docker:up   # if not already running
pnpm db:migrate
```

Confirm no error, and that `SELECT * FROM fabric_garment_types;` and `SELECT key FROM permissions WHERE key LIKE 'fabricGarmentTypes%';` both work against the local DB.

---

### Task 2: Shared types (`packages/types`)

**Files:**
- Modify: `packages/types/src/job-taxonomy.ts`
- Modify: `packages/types/src/admin.ts`
- Modify: `packages/types/src/jobs.ts`
- Reference: `propicly/packages/types/src/admin.ts:150-220,460-535,808-844`, `propicly/packages/types/src/jobs.ts:276-282`

- [ ] **Step 1: Register the job source**

In `packages/types/src/job-taxonomy.ts`, add to the `JOB_SOURCE` object:

```ts
  FABRIC_TO_GARMENT: 'fabric_to_garment',
```

(Anywhere in the object; alphabetical-ish grouping isn't enforced elsewhere in the file.) Nothing else in this file needs a change — `WORKER_POOL` is untouched per the Decisions table (Option A).

- [ ] **Step 2: Add the workflow-type enum value + superRefine branch + CRUD schemas in `packages/types/src/admin.ts`**

Add `'fabric_to_garment'` to **both** places the workflow-type enum is declared (grep to confirm you caught all — there are exactly two in the current file):
- `CreateWorkflowBody`'s `workflowType` enum (currently `['regular', 'tryon', 'saree_step1', 'saree_step1_two_input', 'two_stage', 'regeneration']`)
- `ParseWorkflowBody`'s `workflowType` enum (same list)

In `CreateWorkflowBody`'s `.superRefine(...)`, add a new branch. Insert it anywhere before the final fallback (the unconditional `if (!val.poseNodeId) { ... 'poseNodeId is required for regular workflows' ... }` block) — that fallback is what every unmatched `workflowType` falls through to, so this branch must `return` to avoid it:

```ts
    if (val.workflowType === 'fabric_to_garment') {
      // Single-image-in/out, no face/bg/pose roles. poseNodeId is reused as the
      // input-image node; garmentPhasePromptNode is reused as the positive prompt
      // node (overwritten per-job with the picked fabric_garment_types preset's
      // prompt); facePhasePromptNode is reused as the OPTIONAL negative prompt
      // node. See apps/dispatcher/src/job/processor.ts::processFabricToGarmentJob.
      if (!val.poseNodeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['poseNodeId'],
          message: 'poseNodeId (input image node) is required for fabric_to_garment workflows',
        });
      }
      if (!val.garmentPhasePromptNode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['garmentPhasePromptNode'],
          message: 'garmentPhasePromptNode is required for fabric_to_garment workflows',
        });
      }
      return;
    }
```

Then, near the end of the file (alongside the other feature-config blocks in whatever the aivastra equivalent of propicly's big admin-config object schema is — grep for where `tryon: z.object({ creditCost: ... })`-shaped entries live, likely in an `AdminConfig`/similar schema), add:

```ts
  fabricToGarment: z
    .object({
      creditCost: z.number().int().positive().max(1_000),
    })
    .optional(),
```

Finally, add the CRUD body schemas (copy verbatim from `propicly/packages/types/src/admin.ts:808-844` — these have no propicly-specific dependencies):

```ts
// ── Fabric-to-Garment garment-type presets ────────────────────────────────
// Admin-curated presets (Shirt, Kurti, Anarkali, …) — each carries the
// prompt text injected into the shared 'fabric_to_garment' workflow
// template's garmentPhasePromptNode (and optionally facePhasePromptNode) at
// dispatch time. See apps/dispatcher/src/job/processor.ts::processFabricToGarmentJob.

// Separate from the system-wide GenderSlug (men/women/boys/girls) — fabric-to-garment
// presets are deliberately scoped to just these two.
export const FabricGarmentGenderEnum = z.enum(['men', 'women']);

export const CreateFabricGarmentTypeBody = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  genderSlug: FabricGarmentGenderEnum,
  label: z.string().min(1).max(120),
  thumbnailKey: z.string().optional(),
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(4000).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export const PatchFabricGarmentTypeBody = z.object({
  genderSlug: FabricGarmentGenderEnum.optional(),
  label: z.string().min(1).max(120).optional(),
  thumbnailKey: z.string().nullable().optional(),
  prompt: z.string().min(1).max(4000).optional(),
  negativePrompt: z.string().max(4000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export const PresignFabricGarmentTypeThumbnailBody = z.object({
  contentType: AssetContentType,
});
```

(`AssetContentType` already exists in this file.)

- [ ] **Step 2b: `UpdateWorkflowBody` — no change needed**

Confirm (don't assume) that `UpdateWorkflowBody` doesn't re-declare a `workflowType` enum (it shouldn't — workflow type is immutable after creation in both repos). If it does, add `'fabric_to_garment'` there too.

- [ ] **Step 3: Add the job-creation request schema in `packages/types/src/jobs.ts`**

Near the other `Create<X>JobRequest` schemas (e.g. near `CreateShadowJobRequest` if one exists, or any other single-image-in request), add:

```ts
export const CreateFabricToGarmentJobRequest = z.object({
  productImageKey: z.string().min(1),
  fabricGarmentTypeId: z.string().uuid(),
});
```

Check whether this file has an `INPUT_GARMENT_KEY` regex constant like propicly's (`propicly/packages/types/src/jobs.ts:254-256` uses `.regex(INPUT_GARMENT_KEY)` for product-image keys) — if aivastra's `jobs.ts` has an equivalent key-shape regex already used elsewhere, use it instead of the bare `.min(1)` above for consistency.

- [ ] **Step 4: Typecheck the types package**

```bash
pnpm --filter @aivastra/types build
```

Fix any compile errors before moving on — every downstream task imports from here.

---

### Task 3: Storage key builder

**Files:**
- Modify: `packages/storage/src/keys.ts`
- Reference: `propicly/packages/storage/src/keys.ts:50`

- [ ] Add one key builder alongside the others:

```ts
  fabricGarmentTypeThumb: (id: string) => `fabric-garment-types/${id}.thumb.jpg`,
```

---

### Task 4: API — workflow node auto-detection + admin CRUD routes

**Files:**
- Create: `apps/api/src/modules/admin/fabric-detect.ts` (near-verbatim copy of `propicly/apps/api/src/modules/admin/fabric-detect.ts`)
- Create: `apps/api/src/modules/admin/fabric-garment-types.routes.ts` (adapt from `propicly/apps/api/src/modules/admin/fabric-garment-types.routes.ts`)
- Modify: `apps/api/src/modules/admin/workflows.routes.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Port `fabric-detect.ts` verbatim**

Read `propicly/apps/api/src/modules/admin/fabric-detect.ts` in full and copy it to `apps/api/src/modules/admin/fabric-detect.ts` unchanged. It only imports `classifyNode`, `normaliseTitle`, `ParsedNode` from `./workflow-detect.js` — all three already exist with the same signatures in aivastra's `apps/api/src/modules/admin/workflow-detect.ts` (verified: `export type NodeCategory`, `export interface ParsedNode`, `export function classifyNode`, `export function normaliseTitle`, `export function detectMappings` all present). No import-path changes needed.

- [ ] **Step 2: Wire `detectFabricMappings` into the workflow create-handler**

In `apps/api/src/modules/admin/workflows.routes.ts`, import `detectFabricMappings` from `./fabric-detect.js`. Inside `function extractWorkflowInsertFields(...)` (starts at line ~227), add a new `if (workflowType === 'fabric_to_garment') { ... }` branch — insert it next to the other single-image branches (e.g. right before the `if (workflowType === 'regeneration')` branch at line ~445). Model it closely on that `regeneration` branch (closest analog: single image in/out, reuses `tryonPersonNodeId`-style detection but for fabric-to-garment reuses `poseNodeId`/`garmentPhasePromptNode`/`facePhasePromptNode` instead):

```ts
  if (workflowType === 'fabric_to_garment') {
    // Single-image-in/out, no face/bg/pose roles. poseNodeId is reused as the
    // input-image node; garmentPhasePromptNode is reused as the positive prompt
    // node; facePhasePromptNode is reused as the OPTIONAL negative prompt node.
    const { detected: autoDetected } = detectFabricMappings(body.jsonContent);
    const inputNodeId = body.poseNodeId ?? autoDetected.inputNodeId ?? '';
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by superRefine
    const posNode = body.garmentPhasePromptNode!;
    const negNode = body.facePhasePromptNode ?? autoDetected.negativePromptNode ?? null;
    const resultNodeId = body.resultNodeId ?? autoDetected.resultNodeId ?? null;

    if (!inputNodeId)
      throw new AppError(
        'VALIDATION',
        400,
        'Could not detect input-image node — set poseNodeId manually',
      );

    validateNodeExists(body.jsonContent, inputNodeId, 'input image');
    validateNodeType(body.jsonContent, inputNodeId, 'image', 'input image');
    validateNodeExists(body.jsonContent, posNode, 'positive prompt');
    validateNodeType(body.jsonContent, posNode, 'prompt', 'positive prompt');
    if (negNode) {
      validateNodeExists(body.jsonContent, negNode, 'negative prompt');
      validateNodeType(body.jsonContent, negNode, 'prompt', 'negative prompt');
    }

    const { defaultFacePhasePrompt, defaultGarmentPhasePrompt } = extractDefaultPrompts(
      body.jsonContent,
      negNode,
      posNode,
    );

    return {
      slug: body.slug,
      label: body.label,
      jsonContent: body.jsonContent,
      workflowType,
      faceNodeId: null,
      poseNodeId: inputNodeId,
      bgNodeId: null,
      upperNodeIds: [],
      lowerNodeId: null,
      shoeNodeId: null,
      garmentView: 'front',
      thirdNodeId: null,
      fourthNodeId: null,
      accessoryNodeId: null,
      sizeNodeIds: [],
      latentSizeNodeIds: [],
      latentMaxPx: 4096,
      outputSizeNodeIds: [],
      outputMaxPx: 4096,
      resultNodeId,
      facePhasePromptNode: negNode,
      garmentPhasePromptNode: posNode,
      defaultFacePhasePrompt,
      defaultGarmentPhasePrompt,
      stage1PositivePromptNode: null,
      stage1NegativePromptNode: null,
      defaultStage1PositivePrompt: '',
      defaultStage1NegativePrompt: '',
      tryonPersonNodeId: null,
      tryonGarmentNodeId: null,
      tryonGarmentNodeId2: null,
      tryonOutputNodeId: null,
      samSegmentationPromptNode,
      defaultSamSegmentationPrompt,
    };
  }
```

`extractDefaultPrompts` already accepts `negativePromptNode: string | null` and handles `null` gracefully (returns `''`) — confirmed in its current implementation (`apps/api/src/modules/admin/workflows.routes.ts:148-161`), so no extra null-handling needed around that call.

- [ ] **Step 3: Wire detection into `POST /admin/workflows/parse`**

Same file, in the `/admin/workflows/parse` handler (~line 1366), add a branch:

```ts
      if (parseWorkflowType === 'fabric_to_garment') {
        const { detected, allImageNodes, allSaveImageNodes, allPromptNodes } =
          detectFabricMappings(jsonContent);
        return { detected, allImageNodes, allSaveImageNodes, allPromptNodes };
      }
```

(Note `detectFabricMappings` returns `allSaveImageNodes` in addition to `allImageNodes`/`allPromptNodes` — that's a real difference from `detectTryonMappings`'s return shape, carry it through.)

- [ ] **Step 4: Create the admin CRUD routes module**

Read `propicly/apps/api/src/modules/admin/fabric-garment-types.routes.ts` in full, then write `apps/api/src/modules/admin/fabric-garment-types.routes.ts` adapted for aivastra's conventions:
- `import { schema } from '@aivastra/db'` (not `@propicly/db`)
- `import { keys } from '@aivastra/storage'`
- Import the CRUD schemas from `@aivastra/types` (added in Task 2)
- Replace `import { requireAdmin } from './guard.js'` + `requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN'])` with aivastra's actual guard:

```ts
import { requirePermission } from './guard.js';
// ...
export async function adminFabricGarmentTypesRoutes(app: FastifyInstance) {
  const RW = requirePermission('fabricGarmentTypes.write');
  const D = requirePermission('fabricGarmentTypes.delete');
  const uuidParam = z.object({ id: z.string().uuid() });

  app.get('/admin/assets/fabric-garment-types', { preHandler: requirePermission('fabricGarmentTypes.read') }, async () => {
    // ...same body as propicly...
  });
  // POST .../presign, POST .../, PATCH .../:id all use { preHandler: RW }
  // DELETE .../:id uses { preHandler: D }
```

Everything else (the five route handlers' bodies: GET list, POST presign, POST create, PATCH update, DELETE) ports with **zero logic changes** — same table name (`schema.fabricGarmentTypes`), same storage calls (`app.storage.presignPut`, `app.storage.publicUrl`, `app.storage.deleteObject`), same `AppError` usage. Copy them as-is from the propicly file.

- [ ] **Step 5: Wire into `server.ts`**

In `apps/api/src/server.ts`, add:

```ts
import { adminFabricGarmentTypesRoutes } from './modules/admin/fabric-garment-types.routes.js';
// ...
await app.register(adminFabricGarmentTypesRoutes);
```

Place the registration near the other `admin*Routes` registrations.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @aivastra/api typecheck
```

---

### Task 5: API — credit-cost config (resolution-config + public config route)

**Files:**
- Modify: `apps/api/src/lib/resolution-config.ts`
- Modify: `apps/api/src/modules/admin/config.routes.ts`
- Reference: `propicly/apps/api/src/lib/resolution-config.ts:199-213`, `propicly/apps/api/src/modules/admin/config.routes.ts:67-75,158`

- [ ] **Step 1: Add the default cost constant + getter in `resolution-config.ts`**

Follow the exact pattern of the existing `getTryonCreditCost` function in this file (same `KEY`/`CONFIG_KEY` Redis blob, same try/catch-fallback shape):

```ts
export const FABRIC_TO_GARMENT_DEFAULT_COST = 8;

/**
 * Reads the admin-configured credit cost for a fabric-to-garment job from the
 * `config:system` Redis key. Falls back to FABRIC_TO_GARMENT_DEFAULT_COST if
 * nothing is stored yet, or the entry is missing/malformed.
 */
export async function getFabricToGarmentCreditCost(app: FastifyInstance): Promise<number> {
  try {
    const raw = await app.redis.get(KEY); // use whatever the file's existing Redis-key constant is named
    const cfg = raw ? JSON.parse(raw) : {};
    const cost = cfg.fabricToGarment?.creditCost;
    return typeof cost === 'number' ? cost : FABRIC_TO_GARMENT_DEFAULT_COST;
  } catch {
    return FABRIC_TO_GARMENT_DEFAULT_COST;
  }
}
```

Match the exact name of the existing Redis key constant in this file (it's `KEY = 'config:system'` in `config.routes.ts` — confirm whether `resolution-config.ts` imports that same constant or has its own; use whichever pattern `getTryonCreditCost` already follows in this file).

- [ ] **Step 2: Add the public `GET /v1/config/fabric-to-garment` route**

In `apps/api/src/modules/admin/config.routes.ts`, find where public (`preHandler`-less) `GET /v1/config/<feature>` routes live (e.g. `/v1/config/resolutions`, `/v1/config/free-plan`) and add:

```ts
  // Public — used by the Fabric to Garment page to show the credit cost
  // before the user clicks.
  app.get('/v1/config/fabric-to-garment', async () => {
    const raw = await app.redis.get(KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    return {
      creditCost: cfg.fabricToGarment?.creditCost ?? DEFAULT_FABRIC_TO_GARMENT_CONFIG.creditCost,
    };
  });
```

Add a matching `DEFAULT_FABRIC_TO_GARMENT_CONFIG = { creditCost: FABRIC_TO_GARMENT_DEFAULT_COST }` constant (import `FABRIC_TO_GARMENT_DEFAULT_COST` from `resolution-config.js`), following whatever pattern the existing `DEFAULT_TRYON_CONFIG` import/constant already uses in this file.

- [ ] **Step 3: Wire into the admin config GET/PUT handlers**

Find the admin `GET /admin/config` and `PUT /admin/config` handlers in the same file. In the GET handler, add a default-backfill line like the existing ones (e.g. `cfg.tryon = cfg.tryon ?? DEFAULT_TRYON_CONFIG;`):

```ts
    cfg.fabricToGarment = cfg.fabricToGarment ?? DEFAULT_FABRIC_TO_GARMENT_CONFIG;
```

In the PUT handler, make sure the request body's `fabricToGarment` field (added to the admin config zod schema in Task 2) is persisted the same way every other feature's config sub-object is (look at how `tryon`/`seller`/etc. are merged into the stored JSON blob and copy that exactly — don't invent a new merge strategy).

- [ ] **Step 4: Typecheck + manual check**

```bash
pnpm --filter @aivastra/api typecheck
```

---

### Task 6: API — job creation + public job routes

**Files:**
- Create: `apps/api/src/modules/jobs/createFabricToGarment.ts`
- Modify: `apps/api/src/modules/jobs/routes.ts`
- Modify: `apps/api/src/server.ts` (only if routes aren't already registered through `jobsRoutes` — confirm first)
- Reference: `propicly/apps/api/src/modules/jobs/createFabricToGarment.ts`, `propicly/apps/api/src/modules/jobs/routes.ts:346-369,439-470`

- [ ] **Step 1: Write `createFabricToGarment.ts`**

Adapt propicly's version with these exact substitutions:
- `import { schema } from '@aivastra/db'`, `import type { DB } from '@aivastra/db'`
- `import { jobsCreatedTotal } from '@aivastra/observability'`
- `import { CreateFabricToGarmentJobRequest, JOB_SOURCE } from '@aivastra/types'`
- Replace `assertOwnsUploadKey` import/call with aivastra's `verifyGarmentKey` (from `./create.js`) — call signature is `verifyGarmentKey(app, userId, productImageKey)` (it internally calls `assertOwnsUploadKey`, same ownership check propicly does directly).
- Replace the insert's `productImageKey` field with **`upperGarmentKey`** (per the Decisions table — no new column).
- Replace `source: 'fabric_to_garment'` with `source: JOB_SOURCE.FABRIC_TO_GARMENT`.
- `jobsCreatedTotal.inc({ priority: queueStream, kind: JOB_SOURCE.FABRIC_TO_GARMENT })`.
- Everything else — the credit-plan lookup, the transaction shape (`atomicDeduct` inside the same tx as the `jobs`/`jobInputs` insert), the `watermark = false` always, the Redis `XADD` + refund-on-failure try/catch — ports unchanged. Confirm `atomicDeduct`/`refund` import from `./ledger.js` relative to this file's location (same as propicly: `../credits/ledger.js`).

Resulting shape (fill in the parts marked, everything else copied from propicly's file with the substitutions above applied):

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import { type CreateFabricToGarmentJobRequest, JOB_SOURCE } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getFabricToGarmentCreditCost } from '../../lib/resolution-config.js';
import { atomicDeduct, refund } from '../credits/ledger.js';
import { verifyGarmentKey } from './create.js';

export async function createFabricToGarmentJob(
  app: FastifyInstance,
  userId: string,
  body: z.infer<typeof CreateFabricToGarmentJobRequest>,
) {
  const { productImageKey, fabricGarmentTypeId } = body;
  const COST = await getFabricToGarmentCreditCost(app);

  await verifyGarmentKey(app, userId, productImageKey);

  const [wf] = await app.db
    .select({ id: schema.workflowTemplates.id })
    .from(schema.workflowTemplates)
    .where(
      and(
        eq(schema.workflowTemplates.workflowType, 'fabric_to_garment'),
        eq(schema.workflowTemplates.isActive, true),
      ),
    )
    .limit(1);
  if (!wf) {
    throw new AppError('CONFIG', 400, 'no active fabric-to-garment workflow template configured');
  }

  const [preset] = await app.db
    .select()
    .from(schema.fabricGarmentTypes)
    .where(
      and(
        eq(schema.fabricGarmentTypes.id, fabricGarmentTypeId),
        eq(schema.fabricGarmentTypes.isActive, true),
      ),
    )
    .limit(1);
  if (!preset) {
    throw new AppError('VALIDATION', 400, 'garment type not found or inactive');
  }

  // Resolve queueStream/priority/watermark exactly the way this file's other
  // neighbors (createSareeMannequin.ts, create.ts) already do it for a plain
  // user-tier job — read one of those for the current helper name(s) rather
  // than reinventing the plan/tier → queueStream lookup here.
  const queueStream = /* ... */ 'normal';
  const priority = queueStream === 'priority';
  const watermark = false; // standalone generation, never watermarked — same rationale as every other single-image tool

  const catalogueId = randomUUID();
  const job = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId,
        catalogueId,
        status: 'QUEUED',
        priority,
        queueStream,
        watermark,
        creditsCharged: COST,
        source: JOB_SOURCE.FABRIC_TO_GARMENT,
      })
      .returning();
    await atomicDeduct(tx as unknown as DB, userId, COST, newJob.id);
    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      upperGarmentKey: productImageKey,
      params: {
        kind: 'fabric_to_garment',
        workflowTemplateId: wf.id,
        fabricGarmentTypeId: preset.id,
        prompt: preset.prompt,
        negativePrompt: preset.negativePrompt,
      },
    });
    return newJob;
  });

  const stream = `jobs:${queueStream}`;
  try {
    await app.redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', job.id, 'userId', userId);
    jobsCreatedTotal.inc({ priority: queueStream, kind: JOB_SOURCE.FABRIC_TO_GARMENT });
  } catch (err) {
    app.log.error({ err, jobId: job.id }, 'redis xadd failed — fabric-to-garment job will be refunded');
    await refund(app.db, userId, COST, job.id, 'REFUND_ENQUEUE_FAIL');
    await app.db
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode: 'ENQUEUE_FAIL' })
      .where(eq(schema.jobs.id, job.id));
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }

  return { jobId: job.id, catalogueId };
}
```

**Before filling in the `queueStream`/`priority` line**, open `apps/api/src/modules/jobs/createSareeMannequin.ts` and copy however it derives `queueStream` for a normal user job (the credit-plan → `queueStream` join) — don't guess at this, it's the one piece of this function that's genuinely aivastra-specific plumbing rather than a straight propicly port.

- [ ] **Step 2: Add the public routes in `apps/api/src/modules/jobs/routes.ts`**

Import `createFabricToGarmentJob` and `CreateFabricToGarmentJobRequest`, then add (near the other single-purpose job POST routes, or anywhere sensible in this file — there's no strict ordering convention):

```ts
  // POST /v1/jobs/fabric-to-garment — stitches an uploaded fabric photo into
  // the shape of the picked garment-type preset.
  app.post(
    '/v1/jobs/fabric-to-garment',
    { preHandler: app.requireUser, schema: { body: CreateFabricToGarmentJobRequest } },
    async (req, reply) => {
      const result = await withIdempotency(
        app,
        req.userId,
        req.headers['idempotency-key'] as string | undefined,
        () =>
          createFabricToGarmentJob(
            app,
            req.userId,
            req.body as z.infer<typeof CreateFabricToGarmentJobRequest>,
          ),
      );
      reply.code(201);
      return result;
    },
  );

  // GET /v1/fabric-garment-types?gender=men|women — active garment-type
  // presets for the Fabric to Garment picker. Rows with no genderSlug set
  // are included regardless of the requested gender.
  app.get('/v1/fabric-garment-types', { preHandler: app.requireUser }, async (req) => {
    const { gender } = req.query as { gender?: string };
    const genderCondition =
      gender === 'men' || gender === 'women'
        ? or(
            eq(schema.fabricGarmentTypes.genderSlug, gender),
            isNull(schema.fabricGarmentTypes.genderSlug),
          )
        : undefined;
    const rows = await app.db
      .select()
      .from(schema.fabricGarmentTypes)
      .where(
        genderCondition
          ? and(eq(schema.fabricGarmentTypes.isActive, true), genderCondition)
          : eq(schema.fabricGarmentTypes.isActive, true),
      )
      .orderBy(asc(schema.fabricGarmentTypes.sortOrder), asc(schema.fabricGarmentTypes.label));
    return {
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        genderSlug: r.genderSlug,
        label: r.label,
        thumbnailUrl: r.thumbnailKey ? app.storage.publicUrl(r.thumbnailKey) : null,
      })),
    };
  });
```

Confirm `or`, `isNull`, `asc` are already imported from `drizzle-orm` at the top of this file (they are, per the existing import line) — add any that aren't.

- [ ] **Step 3: Confirm route registration**

`jobsRoutes` is already registered in `server.ts` (it's one function covering many routes in aivastra, unlike propicly's narrower per-feature route files) — no new registration needed, these two routes live inside the existing `jobsRoutes` function.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @aivastra/api typecheck
```

---

### Task 7: Dispatcher — job processor

**Files:**
- Modify: `apps/dispatcher/src/job/processor.ts`
- Reference: `propicly/apps/dispatcher/src/job/processor.ts:296-309,2185-2420`

- [ ] **Step 1: Add the dispatch branch in `processJob`**

In `apps/dispatcher/src/job/processor.ts`, inside `processJob`, add a new branch alongside the existing `rawParams.kind === 'regenerate'` / `'saree_mannequin'` / `'saree'` checks (same `!inputs.faceId && !inputs.backgroundId && !inputs.poseId` guard shape):

```ts
  // Fabric-to-Garment jobs: single-image edit, no face/background/pose.
  // kind === 'fabric_to_garment' in jobInputs.params — see
  // apps/api/src/modules/jobs/createFabricToGarment.ts.
  if (
    !inputs.faceId &&
    !inputs.backgroundId &&
    !inputs.poseId &&
    rawParams.kind === 'fabric_to_garment'
  ) {
    await processFabricToGarmentJob(
      cfg,
      job,
      inputs,
      rawParams,
      userId,
      stream,
      messageId,
      jobLog,
      startedAt,
    );
    return;
  }
```

Place it before the `rawParams.personKey` branch check (fabric-to-garment params never set `personKey`, but placing it earlier avoids relying on that), and before the `'regenerate'`/`'saree_mannequin'`/`'saree'` checks — order among these doesn't matter functionally since each is a distinct, mutually-exclusive `kind` string, but grouping it near `'regenerate'` (closest analog) keeps the function readable.

- [ ] **Step 2: Add the `processFabricToGarmentJob` function**

Add this near the other per-kind processor functions (e.g. near `processRegenerateJob`). Port from `propicly/apps/dispatcher/src/job/processor.ts:2185-2420` with these substitutions:
- `productKey` is read from **`inputs.upperGarmentKey`**, not `inputs.productImageKey` (that column doesn't exist in aivastra).
- `selectWorker(redis, 'fabric_to_garment')` → **`selectWorker(redis, WORKER_POOL.CATALOGUE)`** (per the Decisions table, Option A). Import `WORKER_POOL` from `@aivastra/types`.
- Confirm the exact helper names in aivastra for things propicly's version calls directly — `transitionJob`, `markFailed`, `terminateJob`, `handleFailure`, `setWorkerStatus`, `uploadImageToComfy`, `submitPrompt`, `waitForCompletion`, `fetchHistory`, `downloadOutputImage`, `finalizeOutput`, `comfyRequestDuration`, `recordJobOutcome`, `MAX_QUEUE_WAIT_MS` — all of these already exist in aivastra's `processor.ts` (used by `processRegenerateJob`/`processSareeMannequinJob` etc.) with, as far as this port needs, the same signatures. Read the current `processRegenerateJob` in aivastra's file side-by-side with propicly's `processFabricToGarmentJob` while porting — the two functions are structurally the same shape (resolve workflow template's reused generic columns → upload input to ComfyUI → patch positive/optional-negative prompt + input image into the cloned workflow JSON → submit → wait → fetch result → `finalizeOutput`), so any helper-name mismatch will surface immediately as a typecheck error.

```ts
type FabricToGarmentJob = {
  id: string;
  creditsCharged: number;
  attempts: number;
  createdAt: Date;
  watermark: boolean;
};

// ── Fabric-to-Garment job processor ────────────────────────────────────────
// Stitches an uploaded fabric photo into the shape of the garment-type preset
// the user picked. Same single-image-in/out shape as processRegenerateJob,
// but UNLIKE regenerate this DOES patch the positive (and optionally
// negative) prompt node — with the prompt text createFabricToGarment.ts
// snapshotted onto job_inputs.params at creation time, not re-resolved here.
async function processFabricToGarmentJob(
  cfg: ProcessorConfig,
  job: FabricToGarmentJob,
  inputs: typeof schema.jobInputs.$inferSelect,
  params: Record<string, unknown>,
  userId: string,
  stream: string,
  messageId: string,
  jobLog: Logger,
  startedAt: number,
): Promise<void> {
  const { db, redis, pub, s3, r2Bucket } = cfg;
  const jobId = job.id;

  const workflowTemplateId = params.workflowTemplateId as string | undefined;
  const productKey = inputs.upperGarmentKey;
  const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
  const negativePrompt = typeof params.negativePrompt === 'string' ? params.negativePrompt.trim() : '';

  if (!workflowTemplateId || !productKey || !prompt) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'FABRIC_INPUTS_MISSING', jobLog, startedAt);
    return;
  }

  // poseNodeId is reused as the mandatory input-image node id.
  // garmentPhasePromptNode / facePhasePromptNode carry the positive/negative
  // prompt node ids — see workflows.routes.ts's 'fabric_to_garment' branch.
  const [template] = await db
    .select({
      jsonContent: schema.workflowTemplates.jsonContent,
      inputNodeId: schema.workflowTemplates.poseNodeId,
      resultNodeId: schema.workflowTemplates.resultNodeId,
      promptNodeId: schema.workflowTemplates.garmentPhasePromptNode,
      negativePromptNodeId: schema.workflowTemplates.facePhasePromptNode,
    })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, workflowTemplateId));

  if (!template) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'WORKFLOW_NOT_FOUND', jobLog, startedAt);
    return;
  }

  const inputNodeId = template.inputNodeId;
  const promptNodeId = template.promptNodeId;
  if (!inputNodeId || !promptNodeId) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'FABRIC_NODES_NOT_CONFIGURED', jobLog, startedAt);
    return;
  }

  await transitionJob(db, pub, jobId, userId, 'PREPROCESSING', {}, jobLog);

  const worker = await selectWorker(redis, WORKER_POOL.CATALOGUE);
  if (!worker) {
    if (Date.now() - job.createdAt.getTime() > MAX_QUEUE_WAIT_MS) {
      jobLog.warn('no idle catalogue worker — job exceeded max queue wait, terminating with refund');
      await terminateJob(cfg, jobId, userId, stream, messageId, 'NO_WORKER', job.creditsCharged, jobLog, startedAt);
    } else {
      jobLog.warn('no idle catalogue worker — re-enqueuing with backoff');
      await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', jobId, 'userId', userId);
      await redis.xack(stream, 'dispatcher-cg', messageId);
      recordJobOutcome('retried', startedAt);
    }
    return;
  }
  const w = worker;
  jobLog.info({ workerId: w.id }, 'worker claimed for fabric_to_garment');

  try {
    async function r2Download(key: string): Promise<Uint8Array> {
      const res = await s3.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
      if (!res.Body) throw new Error(`R2 object missing: ${key}`);
      return res.Body.transformToByteArray();
    }

    async function uploadToComfy(key: string, prefix: string): Promise<string> {
      const bytes = await r2Download(key);
      const rawExt = key.split('.').pop()?.toLowerCase() ?? '';
      const ext = rawExt === 'png' ? 'png' : rawExt === 'webp' ? 'webp' : 'jpg';
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return uploadImageToComfy(w.url, w.apiKey, bytes, `${prefix}_${jobId}.${ext}`, mime, jobLog);
    }

    const productFile = await uploadToComfy(productKey, 'fabric_input');

    const workflow = structuredClone(template.jsonContent) as Record<string, { inputs?: Record<string, unknown> }>;
    if (workflow[inputNodeId]?.inputs) {
      workflow[inputNodeId].inputs!.image = productFile;
    }
    if (workflow[promptNodeId]?.inputs) {
      workflow[promptNodeId].inputs!.prompt = prompt;
    }
    const negNodeId = template.negativePromptNodeId;
    if (negativePrompt && negNodeId && workflow[negNodeId]?.inputs) {
      workflow[negNodeId].inputs!.prompt = negativePrompt;
    }

    await transitionJob(db, pub, jobId, userId, 'GENERATING', { workerId: w.id }, jobLog);
    const clientUuid = randomUUID();
    const comfyStartedAt = Date.now();
    const { promptId } = await submitPrompt(w.url, w.apiKey, clientUuid, workflow, jobLog);

    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: {
        promptId,
        workerId: w.id,
        workerUrl: w.url,
        workflowTemplateId,
        inputs: { productKey, productFile, prompt, negativePrompt: negativePrompt || null },
      },
    });

    await waitForCompletion(
      w.url,
      w.apiKey,
      clientUuid,
      promptId,
      600_000,
      (update) => jobLog.debug(update, 'comfyui progress'),
      { info: jobLog.info.bind(jobLog), debug: jobLog.debug.bind(jobLog) },
    );
    comfyRequestDuration.observe((Date.now() - comfyStartedAt) / 1000);

    await transitionJob(db, pub, jobId, userId, 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(w.url, w.apiKey, promptId, jobLog, template.resultNodeId ?? undefined);
    const [firstImage] = outputImages;
    if (!firstImage) throw new Error('ComfyUI returned no output images for fabric-to-garment job');

    const imageBytes = await downloadOutputImage(w.url, w.apiKey, firstImage.filename);

    await finalizeOutput({ imageBytes, jobId, userId, jobWatermark: job.watermark, db, pub, s3, r2Bucket, jobLog });
    await redis.xack(stream, 'dispatcher-cg', messageId);
    await setWorkerStatus(redis, w.id, 'IDLE');
    recordJobOutcome('success', startedAt);
    jobLog.info('fabric-to-garment job completed successfully');
  } catch (err) {
    jobLog.error({ err }, 'fabric-to-garment job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    const errMsg = err instanceof Error ? err.message : String(err);
    await handleFailure(cfg, jobId, userId, stream, messageId, jobLog, startedAt, errMsg);
  }
}
```

Import `WORKER_POOL` from `@aivastra/types` at the top of the file if not already imported.

- [ ] **Step 3: Typecheck + run dispatcher unit tests**

```bash
pnpm --filter @aivastra/dispatcher typecheck
pnpm --filter @aivastra/dispatcher test
```

---

### Task 8: Admin-web — garment-type preset management UI

**Files:**
- Modify: `apps/admin-web/src/types.ts`
- Create: `apps/admin-web/src/pages/assets/FabricGarmentTypesTab.tsx`
- Modify: `apps/admin-web/src/pages/assets/AssetsContext.tsx`
- Modify: `apps/admin-web/src/pages/AssetsPage.tsx`
- Modify: `apps/admin-web/src/components/WorkflowUploadModal.tsx`
- Modify: `apps/admin-web/src/pages/SettingsPage.tsx`
- Reference: the matching propicly files at the same relative paths.

- [ ] **Step 1: Add the `FabricGarmentType` type**

In `apps/admin-web/src/types.ts`, add (copy from `propicly/apps/admin-web/src/types.ts:448` area):

```ts
export interface FabricGarmentType {
  id: string;
  slug: string;
  genderSlug: 'men' | 'women' | null;
  label: string;
  thumbnailKey: string | null;
  thumbnailUrl: string | null;
  prompt: string;
  negativePrompt: string | null;
  sortOrder: number;
  isActive: boolean;
}
```

Also add `'fabric_to_garment'` to whatever local `workflowType` string-union type exists in this file (propicly's `types.ts` has it in two places — grep `fabric_to_garment` in propicly's `types.ts` to find both, add the equivalents in aivastra's file at the matching unions).

- [ ] **Step 2: Port `FabricGarmentTypesTab.tsx`**

Read `propicly/apps/admin-web/src/pages/assets/FabricGarmentTypesTab.tsx` in full (it's self-contained — one file, no propicly-specific imports beyond `AssetThumb`, `Icon`, `Switch`, `apiErrorMessage`/`apiFetch`/upload-error helpers from `../../lib/data`, and `useAssetsContext` — **all of these already exist in aivastra with the same names**, confirmed: `apps/admin-web/src/components/AssetThumb.tsx`, `Switch.tsx` both present). Copy it to `apps/admin-web/src/pages/assets/FabricGarmentTypesTab.tsx` with **zero logic changes** — it needs none, every dependency already exists in aivastra under the same import paths.

- [ ] **Step 3: Wire the new tab into `AssetsContext.tsx` / `AssetsPage.tsx`**

In `apps/admin-web/src/pages/assets/AssetsContext.tsx`:
- Add `'fabric-garment-types'` to the `AssetTab` union type
- Add `'fabric-garment-types'` to the `VALID_TABS` array

In `apps/admin-web/src/pages/AssetsPage.tsx`:
- Import `FabricGarmentTypesTab` from `./assets/FabricGarmentTypesTab`
- Add `{ k: 'fabric-garment-types' as const, l: 'Fabric Garment Types' }` to the `TABS` array
- Add `{activeTab === 'fabric-garment-types' && <FabricGarmentTypesTab />}` to the render body, alongside the other `{activeTab === ... && <...Tab />}` lines

- [ ] **Step 4: Wire `fabric_to_garment` into `WorkflowUploadModal.tsx`**

Read `propicly/apps/admin-web/src/components/WorkflowUploadModal.tsx` at these exact locations (found via grep — use these line numbers as your starting points, they'll have drifted slightly in aivastra's file but the surrounding code is recognizable):
- `~66-74`: `DetectedFabricMappings` / `ParseFabricResult` local interfaces — add aivastra equivalents.
- `~171`: workflow-type string union — add `'fabric_to_garment'`.
- `~231,286`: `parsedFabric` state + reset-on-rebuild.
- `~365-368`: handling the `/admin/workflows/parse` response when `workflowType === 'fabric_to_garment'` — set `parsedFabric`, seed `poseNodeId`/prompt-node state from `detected`.
- `~482-483`: validation gate before allowing submit.
- `~587-596`: building the submit payload's `workflowType: 'fabric_to_garment'` branch.
- `~724-725,775,809-810`: workflow-type picker UI (label "Fabric to Garment", enabled/disabled submit condition).
- `~937`: whatever generic "is this a single-image-shape workflow type" boolean list this file keeps (shadow/background_removal/etc. all included) — add `'fabric_to_garment'` to it too, since the modal reuses one upload-step UI for every single-image-shape type.
- `~1572-1667`: the actual detection-results panel JSX for this workflow type — showing the detected input-image node, result node, positive/negative prompt nodes, each editable against `parsedFabric.allImageNodes` / `allSaveImageNodes` / `allPromptNodes`.

Find aivastra's `WorkflowUploadModal.tsx` equivalents of each of these (search for how the file already handles `'regeneration'` or `'two_stage'` — both are single/dual-image-shape types with their own detection panels, and the closest structural analogs to fabric-to-garment's panel) and add a parallel `fabric_to_garment` branch at each location, following the same shape propicly uses. This is the single largest remaining UI file to touch — budget real time for it, and diff carefully against propicly's working version rather than guessing at the modal's internal state shape.

- [ ] **Step 5: Add the credit-cost admin setting**

In `apps/admin-web/src/pages/SettingsPage.tsx`, find how `tryon`'s (or any other feature's) credit-cost setting is wired — state hook, the config-object field read in the `GET /admin/config` response handler, the field written in the `PUT /admin/config` payload, and the form control in the settings page JSX (propicly's equivalent is at `fabricToGarmentCreditCost` state + lines ~441,487,511,603,1502-1531 in propicly's file) — and add the matching `fabricToGarment` credit-cost control in aivastra's settings page, following whichever existing feature's pattern in this file is closest (there is no "shadow" feature to mirror in aivastra, so mirror `tryon`'s or another already-present single-number credit-cost field instead).

- [ ] **Step 6: Build + manual smoke test**

```bash
pnpm --filter @aivastra/admin build
pnpm --filter @aivastra/admin dev
```

Log into the admin panel, go to Assets → Fabric Garment Types, confirm the tab renders (empty state is fine — no presets yet). Go to Workflows → Upload, pick workflow type "Fabric to Garment", confirm the type appears in the picker and the detection panel renders once a JSON file is attached.

---

### Task 9: catalogues-web — shared dev-tool page infrastructure (trimmed)

**Files:**
- Create: `apps/catalogues-web/src/app/(app)/_shared/dev-tool-page-shell.tsx`
- Create: `apps/catalogues-web/src/app/(app)/_shared/dev-tool-empty-preview.tsx`
- Create: `apps/catalogues-web/src/app/(app)/_shared/image-upload-card.tsx`
- Create: `apps/catalogues-web/src/app/(app)/_shared/product-upload-section.tsx`
- Create: `apps/catalogues-web/src/app/(app)/_shared/use-product-upload.ts`
- Create: `apps/catalogues-web/src/lib/download-blob.ts`
- Reference: the five propicly files under `propicly/apps/propicly-web/src/app/(app)/_shared/` plus `propicly/apps/propicly-web/src/lib/download-blob.ts`

This infra doesn't exist in aivastra at all yet (aivastra only has the Studio wizard, no standalone tool pages) — this task creates it, trimmed per the Decisions table (file-upload only, no URL-paste).

- [ ] **Step 1: Port `dev-tool-page-shell.tsx` and `dev-tool-empty-preview.tsx` verbatim**

Read both propicly files in full and copy them unchanged into aivastra at the same relative paths. Both only depend on `@/components/tokens` (`C`), `@/components/topbar` (`TopBar`), and `../studio/shared-cards` (`sectionCardStyle`) — **all three already exist in aivastra** (`apps/catalogues-web/src/components/tokens.ts`, `components/topbar.tsx`, and `app/(app)/studio/shared-cards.tsx` exporting `sectionCardStyle`, `SectionHead`, `SelCard`, `GenderCard` — all confirmed present). Zero adaptation needed.

- [ ] **Step 2: Port `download-blob.ts` verbatim**

Copy `propicly/apps/propicly-web/src/lib/download-blob.ts` to `apps/catalogues-web/src/lib/download-blob.ts` unchanged — it's pure browser API, no imports at all.

- [ ] **Step 3: Port `image-upload-card.tsx`**

Read `propicly/apps/propicly-web/src/app/(app)/_shared/image-upload-card.tsx` in full (257 lines). Per the Decisions table (Option A — file upload only), strip the URL-input affordance: remove the `urlValue`/`onUrlChange`/`onUrlSubmit` props and the "or paste a URL" input row from the JSX, keeping the drag-and-drop/file-picker + preview + remove-button behavior intact. Everything it imports (icons, tokens, tooltip) already exists in aivastra under the same paths.

- [ ] **Step 4: Port a trimmed `use-product-upload.ts`**

Read `propicly/apps/propicly-web/src/app/(app)/_shared/use-product-upload.ts` in full. Port `uploadFile` unchanged (it already calls `/v1/uploads/presign`, which exists identically in aivastra — confirmed `apps/api/src/modules/uploads/routes.ts` is byte-for-byte the same route in both repos). **Drop `uploadFromUrl` and `urlInput`/`setUrlInput`** entirely (per the Decisions table) — along with the `ProductUploadApi` interface fields that only exist to support it. Keep `remove()`, the 4-second auto-clearing error state, and the file-size guard (propicly caps at 10MB client-side; keep that or check whatever `webGarmentMaxBytes`-equivalent ceiling aivastra's upload flow already enforces elsewhere in Studio and match it instead, for consistency).

- [ ] **Step 5: Port a trimmed `product-upload-section.tsx`**

Read `propicly/apps/propicly-web/src/app/(app)/_shared/product-upload-section.tsx` in full. Port unchanged except for dropping the two props/JSX wiring that fed `ImageUploadCard`'s now-removed `urlValue`/`onUrlChange`/`onUrlSubmit`. It imports `LightbulbIcon` from `@/components/icons` (confirmed present in aivastra) and `Tooltip` from `@/components/ui/tooltip` (confirmed present).

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @aivastra/web typecheck
```

---

### Task 10: catalogues-web — the fabric-to-garment feature page

**Files:**
- Create: `apps/catalogues-web/src/app/(app)/fabric-to-garment/page.tsx`
- Create: `apps/catalogues-web/src/app/(app)/fabric-to-garment/use-fabric-to-garment.ts`
- Create: `apps/catalogues-web/src/app/(app)/fabric-to-garment/fabric-to-garment-section.tsx`
- Create: `apps/catalogues-web/src/app/(app)/fabric-to-garment/fabric-to-garment-preview-panel.tsx`
- Modify: `apps/catalogues-web/src/components/sidebar.tsx`
- Reference: `propicly/apps/propicly-web/src/app/(app)/fabric-to-garment/*`

- [ ] **Step 1: Port all four files**

Read each of the four propicly files in full (already read in full during planning — they are `page.tsx`, `use-fabric-to-garment.ts`, `fabric-to-garment-section.tsx`, `fabric-to-garment-preview-panel.tsx`, totaling well under 400 lines combined) and copy them into aivastra at the matching paths with these substitutions only:
- `use-fabric-to-garment.ts`: change the download filename from `'propicly-fabric-to-garment.png'` to `'aivastra-fabric-to-garment.png'`. Nothing else changes — `/v1/config/fabric-to-garment`, `/v1/fabric-garment-types?gender=`, `/v1/jobs/fabric-to-garment`, `/v1/jobs/:id/result` are all routes this plan already created identically in aivastra's API (Tasks 5–6), and `useJobStream`/`api`/`downloadBlob` all resolve to aivastra equivalents already confirmed present (`@/hooks/use-job-stream`, `@/lib/api`, the `download-blob.ts` ported in Task 9).
- `fabric-to-garment-section.tsx` and `fabric-to-garment-preview-panel.tsx`: no changes — every import (`@/components/icons`, `@/components/tokens`, `@/components/ui/grad-btn`, `@/components/ui/tooltip`, `../studio/shared-cards`) resolves identically in aivastra.
- `page.tsx`: no changes — imports the four `_shared/` files ported in Task 9 plus the three files above.

- [ ] **Step 2: Add the sidebar entry**

In `apps/catalogues-web/src/components/sidebar.tsx`:
- Add `Shirt` to the `lucide-react` import list at the top.
- Add to the `NAV` array (anywhere among the other feature entries, e.g. right after the `tryon`/`developers` entries):
  ```ts
  { id: 'fabric-to-garment', href: '/fabric-to-garment', label: 'Fabric to Garment', icon: 'shirt' },
  ```
- Add `'fabric-to-garment'` to the `CREATE` group's filter list (currently `['studio', 'tryon', 'saree', 'catalogues', 'catalog-video', 'assets']`, in the `groups` array) — or a different group if you decide this fits better elsewhere; `CREATE` matches propicly's placement (it sits in propicly's single flat nav list right after the other generation tools).
- Add the icon-render branch, matching the existing ternary chain's style exactly:
  ```tsx
  ) : item.icon === 'shirt' ? (
    <Shirt size={16} style={{ color: isActive ? '#FFFFFF' : '#BABABB' }} />
  ) :
  ```

- [ ] **Step 3: No middleware change needed**

`apps/catalogues-web/src/middleware.ts` guards every non-`PUBLIC_PATHS` route generically and `/fabric-to-garment` isn't in `ALWAYS_BLOCKED_PATHS` — confirm this remains true, but no edit should be required.

- [ ] **Step 4: Typecheck + manual QA**

```bash
pnpm --filter @aivastra/web dev
```

Manually walk through: log in → sidebar shows "Fabric to Garment" → upload a fabric photo → pick a gender → (empty garment-type list expected until Task 11's seed step) → confirm the empty-state copy renders correctly.

---

### Task 11: Seed data + GPU worker provisioning (ops, not code)

This feature is non-functional end-to-end until an admin does the following in the deployed admin panel (not something this plan's code changes do automatically — note it so the port isn't declared "done" while silently broken):

- [ ] Upload a ComfyUI workflow JSON for `workflowType: 'fabric_to_garment'` via Workflows → Upload (Task 8's modal work makes this possible). This requires an actual ComfyUI workflow graph shaped like propicly's reference one (`LoadImage` in, one or two `TextEncode*`-family prompt nodes, `SaveImage` out) — check whether propicly's actual workflow JSON file (wherever it's stored — likely in `propicly`'s admin DB, not in the repo) can be exported and reused, or whether a new one needs to be authored for aivastra's ComfyUI setup.
- [ ] Confirm whichever GPU worker(s) end up in `WORKER_POOL.CATALOGUE` have the custom nodes that workflow needs installed (check the `aivastra-gpu` repo's per-box inventory) — if not, either install them or revisit the Decisions table's Option B (dedicated pool, specific boxes).
- [ ] Create at least one `fabric_garment_types` row per gender via Assets → Fabric Garment Types (Task 8's tab) so the user-facing page has something to show.
- [ ] Set a credit cost for the feature via Settings (Task 8's setting), or accept the `FABRIC_TO_GARMENT_DEFAULT_COST` fallback.

---

### Task 12: Tests

**Files:**
- Create: `apps/api/test/integration/fabric-to-garment.test.ts`
- Reference: any existing single-image-job integration test in aivastra's `apps/api/test/integration/` for the exact test-harness setup (`buildTestApp`, fresh-DB-per-file, etc.) — don't invent a different harness pattern.

- [ ] **Step 1: Write integration tests covering**
  - `POST /admin/assets/fabric-garment-types` (create) requires `fabricGarmentTypes.write`, rejects without it, succeeds with a `SUPER_ADMIN`/`ADMIN` session.
  - `GET /v1/fabric-garment-types?gender=men` returns only active, gender-matching (+ null-gender) rows, correctly excludes `women`-only rows.
  - `POST /v1/jobs/fabric-to-garment` with no active `fabric_to_garment` workflow template configured returns the `CONFIG` 400.
  - `POST /v1/jobs/fabric-to-garment` with a valid template + preset deducts credits, inserts a `jobs` row with `source = 'fabric_to_garment'` and a `job_inputs` row with `upperGarmentKey` set and `params.kind = 'fabric_to_garment'`, and XADDs to the correct Redis stream.
  - Ownership check: a `productImageKey` the calling user never presigned is rejected (mirrors the existing `assertOwnsUploadKey`/`verifyGarmentKey` test coverage elsewhere in the suite).

- [ ] **Step 2: Run the suite**

```bash
pnpm docker:up
pnpm --filter @aivastra/api test:integration -- fabric-to-garment
```

- [ ] **Step 3: Full regression pass**

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm --filter @aivastra/api test
pnpm --filter @aivastra/api test:integration
```

---

## After execution

Update `docs/progress.md` with a new dated entry at the top: what shipped, what's still open (notably Task 11's ops steps — this feature ships code-complete but non-functional until a workflow template + at least one preset exist), and any decision made differently from this plan's recommendations (especially if Option B was chosen for the worker pool, or the URL-paste upload path was added).
