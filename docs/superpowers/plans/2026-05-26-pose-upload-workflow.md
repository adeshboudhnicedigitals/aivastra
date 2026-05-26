# Pose Upload — Multi-Workflow & Finer Asset Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace batch pose upload with single-pose upload that captures side-face, inline face/background upload-or-select, workflow template selection, and editable per-pose prompts; wire all new fields through patcher and dispatcher.

**Architecture:** DB gets 4 new columns on `model_poses`. A new `GET /admin/workflows` endpoint serves template metadata with default prompts extracted from the JSON files. `PoseUploadModal` replaces `BatchPoseUploadModal` with a richer single-pose form. The patcher becomes multi-template and uses `faceSideR2Key` (not display face) for the ComfyUI face node.

**Tech Stack:** Drizzle ORM, Fastify + Zod, React + TypeScript, R2/S3 presigned PUTs

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `templates/onepiece.json` | Create (copy) | ComfyUI onepiece workflow |
| `templates/hijab.json` | Create (copy) | ComfyUI hijab workflow |
| `packages/storage/src/keys.ts` | Modify | Add `modelPoseFaceSide` key |
| `packages/db/src/migrations/0008_pose_workflow_columns.sql` | Create | Add 4 columns to model_poses |
| `packages/db/src/migrations/meta/_journal.json` | Modify | Register migration idx 8 |
| `packages/db/src/schema/models.ts` | Modify | Add 4 fields to modelPoses |
| `packages/types/src/admin.ts` | Modify | Update Pose Zod schemas |
| `apps/api/src/modules/admin/models.routes.ts` | Modify | presign/confirm + GET /admin/workflows |
| `apps/dispatcher/src/workflow/patcher.ts` | Rewrite | Multi-template, faceSideFile, prompts |
| `apps/dispatcher/src/job/processor.ts` | Modify | Pass new pose fields to patcher |
| `apps/admin/src/types.ts` | Modify | ModelPose + WorkflowTemplate types |
| `apps/admin/src/components/PoseUploadModal.tsx` | Create | New single-pose upload modal |
| `apps/admin/src/pages/AssetsPage.tsx` | Modify | Swap BatchPoseUploadModal → PoseUploadModal |

---

## Task 1: Copy workflow templates to `/templates/`

**Files:**
- Create: `templates/onepiece.json`
- Create: `templates/hijab.json`

- [ ] **Step 1: Copy files**

```bash
cp /mnt/vol1/PycharmProjects/aivastra_v1/data/api/onepiece.json \
   /mnt/vol1/PycharmProjects/aivastra_v1/templates/onepiece.json

cp /mnt/vol1/PycharmProjects/aivastra_v1/data/api/hijab.json \
   /mnt/vol1/PycharmProjects/aivastra_v1/templates/hijab.json
```

- [ ] **Step 2: Verify**

```bash
ls templates/
# Expected: hijab.json  onepiece.json  virtual-tryon-v1.json  virtual-tryon-v2.json
```

- [ ] **Step 3: Commit**

```bash
git add templates/onepiece.json templates/hijab.json
git commit -m "feat: add onepiece and hijab workflow templates"
```

---

## Task 2: Add `modelPoseFaceSide` storage key

**Files:**
- Modify: `packages/storage/src/keys.ts`

- [ ] **Step 1: Add key**

In `packages/storage/src/keys.ts`, add `modelPoseFaceSide` after `modelPoseThumb`:

```ts
export const keys = {
  inputGarment: (jobId: string) => `inputs/${jobId}/garment.jpg`,
  output: (jobId: string) => `outputs/${jobId}/result.png`,
  catalogItem: (typeSlug: string, id: string) => `catalog/${typeSlug}/${id}.jpg`,
  catalogThumb: (typeSlug: string, id: string) => `catalog/${typeSlug}/${id}.thumb.jpg`,
  modelFace: (id: string) => `models/faces/${id}.jpg`,
  modelFaceThumb: (id: string) => `models/faces/${id}.thumb.jpg`,
  modelBackground: (id: string) => `models/backgrounds/${id}.jpg`,
  modelBackgroundThumb: (id: string) => `models/backgrounds/${id}.thumb.jpg`,
  modelPose: (id: string) => `models/poses/${id}.jpg`,
  modelPoseThumb: (id: string) => `models/poses/${id}.thumb.jpg`,
  modelPoseFaceSide: (id: string) => `models/poses/${id}.faceside.jpg`,
  subcategoryTemplate: (id: string) => `models/templates/${id}.jpg`,
  subcategoryTemplateThumb: (id: string) => `models/templates/${id}.thumb.jpg`,
};
```

- [ ] **Step 2: Build storage package**

```bash
pnpm --filter @aivastra/storage build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/storage/src/keys.ts
git commit -m "feat(storage): add modelPoseFaceSide key"
```

---

## Task 3: DB migration — add 4 columns to `model_poses`

**Files:**
- Create: `packages/db/src/migrations/0008_pose_workflow_columns.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/models.ts`

- [ ] **Step 1: Write SQL migration**

Create `packages/db/src/migrations/0008_pose_workflow_columns.sql`:

```sql
ALTER TABLE "model_poses"
  ADD COLUMN "workflow_template" text NOT NULL DEFAULT 'twopiece',
  ADD COLUMN "prompt_face_phase" text,
  ADD COLUMN "prompt_garment_phase" text,
  ADD COLUMN "face_side_r2_key" text;
```

- [ ] **Step 2: Register in journal**

In `packages/db/src/migrations/meta/_journal.json`, add entry after idx 7:

```json
{
  "idx": 8,
  "version": "7",
  "when": 1748300100000,
  "tag": "0008_pose_workflow_columns",
  "breakpoints": true
}
```

- [ ] **Step 3: Apply migration to running Postgres**

```bash
docker exec aivastra-postgres psql -U tryon -d tryon_dev -c "
ALTER TABLE model_poses
  ADD COLUMN IF NOT EXISTS workflow_template text NOT NULL DEFAULT 'twopiece',
  ADD COLUMN IF NOT EXISTS prompt_face_phase text,
  ADD COLUMN IF NOT EXISTS prompt_garment_phase text,
  ADD COLUMN IF NOT EXISTS face_side_r2_key text;
"
```

Expected: `ALTER TABLE`

- [ ] **Step 4: Verify columns exist**

```bash
docker exec aivastra-postgres psql -U tryon -d tryon_dev -c "\d model_poses" | grep -E 'workflow|prompt|face_side'
```

Expected: 4 rows showing the new columns.

- [ ] **Step 5: Update Drizzle schema**

In `packages/db/src/schema/models.ts`, update `modelPoses` table definition. Add 4 fields after `isTemplate`:

```ts
export const modelPoses = pgTable('model_poses', {
  id: uuid('id').primaryKey().defaultRandom(),
  subcategoryId: uuid('subcategory_id').notNull().references(() => garmentSubcategories.id),
  faceId: uuid('face_id').notNull().references(() => modelFaces.id),
  backgroundId: uuid('background_id').notNull().references(() => modelBackgrounds.id),
  label: text('label').notNull(),
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key').notNull(),
  showsLower: boolean('shows_lower').notNull().default(false),
  showsShoes: boolean('shows_shoes').notNull().default(false),
  isTemplate: boolean('is_template').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  workflowTemplate: text('workflow_template').notNull().default('twopiece'),
  promptFacePhase: text('prompt_face_phase'),
  promptGarmentPhase: text('prompt_garment_phase'),
  faceSideR2Key: text('face_side_r2_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  subcategoryIdx: index('model_poses_subcategory_id_idx').on(table.subcategoryId),
  faceIdx: index('model_poses_face_id_idx').on(table.faceId),
  backgroundIdx: index('model_poses_background_id_idx').on(table.backgroundId),
  templateIdx: uniqueIndex('model_poses_template_idx')
    .on(table.subcategoryId, table.faceId, table.backgroundId)
    .where(sql`is_template = true`),
}));
```

- [ ] **Step 6: Build db package**

```bash
pnpm --filter @aivastra/db build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/0008_pose_workflow_columns.sql \
        packages/db/src/migrations/meta/_journal.json \
        packages/db/src/schema/models.ts
git commit -m "feat(db): add workflow_template, prompts, face_side_r2_key to model_poses"
```

---

## Task 4: Update `@aivastra/types` — Pose Zod schemas

**Files:**
- Modify: `packages/types/src/admin.ts`

- [ ] **Step 1: Replace pose schemas**

In `packages/types/src/admin.ts`, replace the three Pose schemas with:

```ts
export const WorkflowTemplateEnum = z.enum(['twopiece', 'onepiece', 'hijab']);

// Poses are per (subcategory × face × background) combo, e.g. m1bg1p1
export const PresignModelPoseBody = z.object({
  subcategoryId: z.string().uuid(),
  // Exactly one of faceId (existing) or newFaceContentType (upload new)
  faceId: z.string().uuid().optional(),
  newFaceContentType: AssetContentType.optional(),
  // Exactly one of backgroundId (existing) or newBgContentType (upload new)
  backgroundId: z.string().uuid().optional(),
  newBgContentType: AssetContentType.optional(),
  // Pose body image
  contentType: AssetContentType,
  // Side/tilt face for ComfyUI (always required)
  faceSideContentType: AssetContentType,
}).refine(
  (d) => Boolean(d.faceId) !== Boolean(d.newFaceContentType),
  'Provide either faceId or newFaceContentType, not both',
).refine(
  (d) => Boolean(d.backgroundId) !== Boolean(d.newBgContentType),
  'Provide either backgroundId or newBgContentType, not both',
);

export const ConfirmModelPoseBody = z.object({
  subcategoryId: z.string().uuid(),
  // Exactly one of faceId (existing) or newFace (inline upload)
  faceId: z.string().uuid().optional(),
  newFace: z.object({
    r2Key: z.string().min(1),
    thumbnailKey: z.string().min(1),
    filename: z.string().min(1),  // used as auto-label
  }).optional(),
  // Exactly one of backgroundId (existing) or newBackground (inline upload)
  backgroundId: z.string().uuid().optional(),
  newBackground: z.object({
    r2Key: z.string().min(1),
    thumbnailKey: z.string().min(1),
    filename: z.string().min(1),
  }).optional(),
  // Pose body image
  label: z.string().min(1).max(120),
  r2Key: z.string().min(1),
  thumbnailKey: z.string().min(1),
  // Side/tilt face (backend only — goes to ComfyUI face node)
  faceSideR2Key: z.string().min(1),
  // Workflow
  workflowTemplate: WorkflowTemplateEnum,
  promptFacePhase: z.string().min(1),
  promptGarmentPhase: z.string().min(1),
  // Existing fields
  showsLower: z.boolean().default(false),
  showsShoes: z.boolean().default(false),
  isTemplate: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
}).refine(
  (d) => Boolean(d.faceId) !== Boolean(d.newFace),
  'Provide either faceId or newFace, not both',
).refine(
  (d) => Boolean(d.backgroundId) !== Boolean(d.newBackground),
  'Provide either backgroundId or newBackground, not both',
);

export const PatchModelPoseBody = z.object({
  label: z.string().min(1).max(120).optional(),
  faceId: z.string().uuid().optional(),
  backgroundId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  showsLower: z.boolean().optional(),
  showsShoes: z.boolean().optional(),
  workflowTemplate: WorkflowTemplateEnum.optional(),
  promptFacePhase: z.string().min(1).optional(),
  promptGarmentPhase: z.string().min(1).optional(),
});
```

- [ ] **Step 2: Build types package**

```bash
pnpm --filter @aivastra/types build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/admin.ts
git commit -m "feat(types): update pose schemas for workflow + faceSide + inline upload"
```

---

## Task 5: Update pose presign/confirm API + add GET /admin/workflows

**Files:**
- Modify: `apps/api/src/modules/admin/models.routes.ts`

- [ ] **Step 1: Add imports at top of models.routes.ts**

Replace the existing imports block with:

```ts
import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, count, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keys } from '@aivastra/storage';
import {
  PresignModelFaceBody, ConfirmModelFaceBody, PatchModelFaceBody,
  PresignModelBackgroundBody, ConfirmModelBackgroundBody, PatchModelBackgroundBody,
  PresignModelPoseBody, ConfirmModelPoseBody, PatchModelPoseBody,
  WorkflowTemplateEnum,
} from '@aivastra/types';
import { requireAdmin } from './guard.js';
import { AppError } from '../../lib/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../../../../templates');

type WorkflowNode = { inputs: Record<string, unknown>; class_type: string };
type WorkflowJson = Record<string, WorkflowNode>;

const WORKFLOW_CONFIG = {
  twopiece: {
    file: 'virtual-tryon-v2.json',
    label: 'Two-Piece (Upper + Lower)',
    facePhaseNode: '1345:111',
    garmentPhaseNode: '1341:1199',
  },
  onepiece: {
    file: 'onepiece.json',
    label: 'One-Piece / Full Outfit',
    facePhaseNode: '1308:111',
    garmentPhaseNode: '1315:1199',
  },
  hijab: {
    file: 'hijab.json',
    label: 'Hijab / Head Cover',
    facePhaseNode: '1383:111',
    garmentPhaseNode: '1381:1199',
  },
} as const;

function getWorkflowDefaults(template: keyof typeof WORKFLOW_CONFIG): { defaultFacePhasePrompt: string; defaultGarmentPhasePrompt: string } {
  const cfg = WORKFLOW_CONFIG[template];
  const raw = JSON.parse(readFileSync(resolve(TEMPLATES_DIR, cfg.file), 'utf-8')) as WorkflowJson;
  const facePrompt = (raw[cfg.facePhaseNode]?.inputs?.['prompt'] ?? '') as string;
  const garmentPrompt = (raw[cfg.garmentPhaseNode]?.inputs?.['prompt'] ?? '') as string;
  return { defaultFacePhasePrompt: facePrompt, defaultGarmentPhasePrompt: garmentPrompt };
}
```

- [ ] **Step 2: Add GET /admin/workflows route**

Inside `adminAssetsRoutes`, before the Faces section, add:

```ts
  // ── Workflows metadata ────────────────────────────────────────────────────

  app.get('/admin/workflows', { preHandler: W }, async () => {
    return Object.entries(WORKFLOW_CONFIG).map(([value, cfg]) => {
      const defaults = getWorkflowDefaults(value as keyof typeof WORKFLOW_CONFIG);
      return {
        value,
        label: cfg.label,
        defaultFacePhasePrompt: defaults.defaultFacePhasePrompt,
        defaultGarmentPhasePrompt: defaults.defaultGarmentPhasePrompt,
      };
    });
  });
```

- [ ] **Step 3: Replace pose presign route**

Replace the existing `app.post('/admin/assets/poses/presign', ...)` block with:

```ts
  app.post('/admin/assets/poses/presign', {
    preHandler: W,
    schema: { body: PresignModelPoseBody },
  }, async (req) => {
    const body = req.body as z.infer<typeof PresignModelPoseBody>;
    const { subcategoryId, contentType, faceSideContentType } = body;

    // Validate subcategory exists
    const [sub] = await app.db.select().from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, subcategoryId));
    if (!sub) throw new AppError('NOT_FOUND', 404, 'subcategory not found');

    // Validate existing face if provided
    if (body.faceId) {
      const [face] = await app.db.select({ id: schema.modelFaces.id })
        .from(schema.modelFaces).where(eq(schema.modelFaces.id, body.faceId));
      if (!face) throw new AppError('NOT_FOUND', 404, 'face not found');
    }

    // Validate existing background if provided
    if (body.backgroundId) {
      const [bg] = await app.db.select({ id: schema.modelBackgrounds.id })
        .from(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.id, body.backgroundId));
      if (!bg) throw new AppError('NOT_FOUND', 404, 'background not found');
    }

    const newId = randomUUID();
    const r2Key = keys.modelPose(newId);
    const thumbKey = keys.modelPoseThumb(newId);
    const faceSideKey = keys.modelPoseFaceSide(newId);

    const presignTasks: Promise<{ url: string }>[] = [
      app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
      app.storage.presignPut(thumbKey, contentType, 1_000_000, 300),
      app.storage.presignPut(faceSideKey, faceSideContentType, 10_000_000, 300),
    ];

    // New face upload
    const newFaceId = body.newFaceContentType ? randomUUID() : null;
    const newFaceR2Key = newFaceId ? keys.modelFace(newFaceId) : null;
    const newFaceThumbKey = newFaceId ? keys.modelFaceThumb(newFaceId) : null;
    if (newFaceId && body.newFaceContentType && newFaceR2Key && newFaceThumbKey) {
      presignTasks.push(app.storage.presignPut(newFaceR2Key, body.newFaceContentType, 10_000_000, 300));
      presignTasks.push(app.storage.presignPut(newFaceThumbKey, body.newFaceContentType, 1_000_000, 300));
    }

    // New background upload
    const newBgId = body.newBgContentType ? randomUUID() : null;
    const newBgR2Key = newBgId ? keys.modelBackground(newBgId) : null;
    const newBgThumbKey = newBgId ? keys.modelBackgroundThumb(newBgId) : null;
    if (newBgId && body.newBgContentType && newBgR2Key && newBgThumbKey) {
      presignTasks.push(app.storage.presignPut(newBgR2Key, body.newBgContentType, 10_000_000, 300));
      presignTasks.push(app.storage.presignPut(newBgThumbKey, body.newBgContentType, 1_000_000, 300));
    }

    const results = await Promise.all(presignTasks);
    let idx = 0;
    const uploadUrl = results[idx++]!.url;
    const thumbnailUploadUrl = results[idx++]!.url;
    const faceSideUploadUrl = results[idx++]!.url;

    const response: Record<string, unknown> = {
      uploadUrl, r2Key, thumbnailUploadUrl, thumbnailKey: thumbKey,
      faceSideUploadUrl, faceSideR2Key: faceSideKey,
    };

    if (newFaceId && newFaceR2Key && newFaceThumbKey) {
      response['newFaceUploadUrl'] = results[idx++]!.url;
      response['newFaceR2Key'] = newFaceR2Key;
      response['newFaceThumbnailUploadUrl'] = results[idx++]!.url;
      response['newFaceThumbnailKey'] = newFaceThumbKey;
    }

    if (newBgId && newBgR2Key && newBgThumbKey) {
      response['newBgUploadUrl'] = results[idx++]!.url;
      response['newBgR2Key'] = newBgR2Key;
      response['newBgThumbnailUploadUrl'] = results[idx++]!.url;
      response['newBgThumbnailKey'] = newBgThumbKey;
    }

    return response;
  });
```

- [ ] **Step 4: Replace pose confirm route**

Replace the existing `app.post('/admin/assets/poses/confirm', ...)` block with:

```ts
  app.post('/admin/assets/poses/confirm', {
    preHandler: W,
    schema: { body: ConfirmModelPoseBody },
  }, async (req) => {
    const body = req.body as z.infer<typeof ConfirmModelPoseBody>;

    const row = await app.db.transaction(async (tx) => {
      // Resolve faceId — create new face row if inline upload
      let resolvedFaceId = body.faceId!;
      if (body.newFace) {
        // Look up subcategory gender for face gender
        const [sub] = await tx.select({ genderSlug: schema.garmentSubcategories.genderSlug })
          .from(schema.garmentSubcategories)
          .where(eq(schema.garmentSubcategories.id, body.subcategoryId));
        const gender = sub?.genderSlug ?? 'men';
        const autoLabel = body.newFace.filename.replace(/\.[^.]+$/, '');
        const [newFaceRow] = await tx
          .insert(schema.modelFaces)
          .values({
            label: autoLabel,
            gender,
            r2Key: body.newFace.r2Key,
            thumbnailKey: body.newFace.thumbnailKey,
            sortOrder: 0,
          })
          .returning({ id: schema.modelFaces.id });
        resolvedFaceId = newFaceRow!.id;
      }

      // Resolve backgroundId — create new background row if inline upload
      let resolvedBgId = body.backgroundId!;
      if (body.newBackground) {
        const autoLabel = body.newBackground.filename.replace(/\.[^.]+$/, '');
        const [newBgRow] = await tx
          .insert(schema.modelBackgrounds)
          .values({
            label: autoLabel,
            r2Key: body.newBackground.r2Key,
            thumbnailKey: body.newBackground.thumbnailKey,
            sortOrder: 0,
          })
          .returning({ id: schema.modelBackgrounds.id });
        resolvedBgId = newBgRow!.id;
      }

      // Unset previous template in cell if setting new template
      if (body.isTemplate) {
        await tx.update(schema.modelPoses)
          .set({ isTemplate: false, updatedAt: new Date() })
          .where(and(
            eq(schema.modelPoses.subcategoryId, body.subcategoryId),
            eq(schema.modelPoses.faceId, resolvedFaceId),
            eq(schema.modelPoses.backgroundId, resolvedBgId),
            eq(schema.modelPoses.isTemplate, true),
          ));
      }

      const [inserted] = await tx
        .insert(schema.modelPoses)
        .values({
          subcategoryId: body.subcategoryId,
          faceId: resolvedFaceId,
          backgroundId: resolvedBgId,
          label: body.label,
          r2Key: body.r2Key,
          thumbnailKey: body.thumbnailKey,
          faceSideR2Key: body.faceSideR2Key,
          workflowTemplate: body.workflowTemplate,
          promptFacePhase: body.promptFacePhase,
          promptGarmentPhase: body.promptGarmentPhase,
          showsLower: body.showsLower,
          showsShoes: body.showsShoes,
          isTemplate: body.isTemplate,
          sortOrder: body.sortOrder,
        })
        .returning();
      return inserted;
    });

    return row;
  });
```

- [ ] **Step 5: Restart API and verify new endpoint**

```bash
curl -s http://localhost:4000/admin/workflows \
  -H "Cookie: $(cat /tmp/admin-cookie.txt 2>/dev/null || echo '')" | python3 -m json.tool | head -30
```

Expected: JSON array with 3 workflow objects each having `value`, `label`, `defaultFacePhasePrompt`, `defaultGarmentPhasePrompt`.

(If cookie not set, just verify API starts without errors from the dev log.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/models.routes.ts
git commit -m "feat(api): pose presign/confirm support inline upload, side face, workflow + GET /admin/workflows"
```

---

## Task 6: Rewrite patcher — multi-template, faceSideFile, prompt patching

**Files:**
- Rewrite: `apps/dispatcher/src/workflow/patcher.ts`

- [ ] **Step 1: Rewrite patcher**

Replace entire contents of `apps/dispatcher/src/workflow/patcher.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../../../templates');

type WorkflowNode = { inputs: Record<string, unknown>; class_type: string; _meta?: unknown };
type Workflow = Record<string, WorkflowNode>;

export type WorkflowTemplate = 'twopiece' | 'onepiece' | 'hijab';

interface TemplateConfig {
  file: string;
  nodes: {
    face: string;
    pose: string;
    bg: string;
    upper: string[];
    lower: string | null;
    facePhasePromptNode: string;
    garmentPhasePromptNode: string;
  };
}

const TEMPLATE_CONFIG: Record<WorkflowTemplate, TemplateConfig> = {
  twopiece: {
    file: 'virtual-tryon-v2.json',
    nodes: {
      face: '1332',
      pose: '1333',
      bg: '1334',
      upper: ['1340', '1352'],
      lower: '1331',
      facePhasePromptNode: '1345:111',
      garmentPhasePromptNode: '1341:1199',
    },
  },
  onepiece: {
    file: 'onepiece.json',
    nodes: {
      face: '1302',
      pose: '1313',
      bg: '1310',
      upper: ['1314'],
      lower: '1323',
      facePhasePromptNode: '1308:111',
      garmentPhasePromptNode: '1315:1199',
    },
  },
  hijab: {
    file: 'hijab.json',
    nodes: {
      face: '1392',
      pose: '1379',
      bg: '1391',
      upper: ['1382'],
      lower: null,
      facePhasePromptNode: '1383:111',
      garmentPhasePromptNode: '1381:1199',
    },
  },
};

// Cache loaded templates
const templateCache = new Map<string, Workflow>();

function loadTemplate(file: string): Workflow {
  if (templateCache.has(file)) return templateCache.get(file)!;
  const raw = JSON.parse(readFileSync(resolve(TEMPLATES_DIR, file), 'utf-8')) as Workflow;
  templateCache.set(file, raw);
  return raw;
}

export interface WorkflowInputs {
  workflowTemplate: WorkflowTemplate;
  upperGarmentFile: string;
  /** Side/tilt face image — patched into the face LoadImage node for ComfyUI */
  faceSideFile: string;
  poseFile: string;
  backgroundFile: string;
  lowerGarmentFile?: string;
  /** If provided, overwrites the template default */
  promptFacePhase?: string;
  /** If provided, overwrites the template default */
  promptGarmentPhase?: string;
}

/**
 * Deep-clones the selected workflow template and patches LoadImage nodes
 * with filenames previously uploaded to ComfyUI via /upload/image.
 * Also patches positive prompt nodes if overrides are provided.
 * Returns the object suitable for the `prompt` field in POST /prompt.
 */
export function patchWorkflow(inputs: WorkflowInputs): Record<string, unknown> {
  const cfg = TEMPLATE_CONFIG[inputs.workflowTemplate];
  const template = loadTemplate(cfg.file);
  const workflow = JSON.parse(JSON.stringify(template)) as Workflow;
  const n = cfg.nodes;

  // Patch image nodes
  workflow[n.face]!.inputs['image'] = inputs.faceSideFile;
  workflow[n.pose]!.inputs['image'] = inputs.poseFile;
  workflow[n.bg]!.inputs['image'] = inputs.backgroundFile;
  for (const nodeId of n.upper) {
    if (workflow[nodeId]) workflow[nodeId]!.inputs['image'] = inputs.upperGarmentFile;
  }
  if (n.lower && inputs.lowerGarmentFile && workflow[n.lower]) {
    workflow[n.lower]!.inputs['image'] = inputs.lowerGarmentFile;
  }

  // Patch positive prompts if overridden
  if (inputs.promptFacePhase && workflow[n.facePhasePromptNode]) {
    workflow[n.facePhasePromptNode]!.inputs['prompt'] = inputs.promptFacePhase;
  }
  if (inputs.promptGarmentPhase && workflow[n.garmentPhasePromptNode]) {
    workflow[n.garmentPhasePromptNode]!.inputs['prompt'] = inputs.promptGarmentPhase;
  }

  return workflow as unknown as Record<string, unknown>;
}
```

- [ ] **Step 2: Build dispatcher types check**

```bash
pnpm --filter @aivastra/dispatcher typecheck 2>&1 | head -20
```

Expected: errors only in `processor.ts` about `faceFile` → fix in next task. No patcher errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dispatcher/src/workflow/patcher.ts
git commit -m "feat(dispatcher): multi-template patcher with faceSideFile and prompt overrides"
```

---

## Task 7: Update dispatcher processor — use `faceSideR2Key` + new patcher signature

**Files:**
- Modify: `apps/dispatcher/src/job/processor.ts`

- [ ] **Step 1: Update DB select for pose**

In `processor.ts`, find the pose resolution block (around step 2 "Resolve face / background / pose IDs → R2 keys"). Replace:

```ts
  const [faceRow] = await db.select({ r2Key: schema.modelFaces.r2Key }).from(schema.modelFaces).where(eq(schema.modelFaces.id, inputs.faceId));
  const [bgRow] = await db.select({ r2Key: schema.modelBackgrounds.r2Key }).from(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.id, inputs.backgroundId));
  const [poseRow] = await db.select({ r2Key: schema.modelPoses.r2Key }).from(schema.modelPoses).where(eq(schema.modelPoses.id, inputs.poseId));
```

With:

```ts
  const [faceRow] = await db.select({ r2Key: schema.modelFaces.r2Key }).from(schema.modelFaces).where(eq(schema.modelFaces.id, inputs.faceId));
  const [bgRow] = await db.select({ r2Key: schema.modelBackgrounds.r2Key }).from(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.id, inputs.backgroundId));
  const [poseRow] = await db.select({
    r2Key: schema.modelPoses.r2Key,
    faceSideR2Key: schema.modelPoses.faceSideR2Key,
    workflowTemplate: schema.modelPoses.workflowTemplate,
    promptFacePhase: schema.modelPoses.promptFacePhase,
    promptGarmentPhase: schema.modelPoses.promptGarmentPhase,
  }).from(schema.modelPoses).where(eq(schema.modelPoses.id, inputs.poseId));
```

- [ ] **Step 2: Update key resolution**

Replace:

```ts
  const modelKey = faceRow.r2Key;
  const bgKey = bgRow.r2Key;
  const poseKey = poseRow.r2Key;
```

With:

```ts
  const bgKey = bgRow.r2Key;
  const poseKey = poseRow.r2Key;
  // Use pose's side-face key for ComfyUI; fall back to display face for legacy poses
  const faceSideKey = poseRow.faceSideR2Key ?? faceRow?.r2Key ?? null;
  if (!faceSideKey) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_FACE_IMAGE', jobLog);
    return;
  }
  const workflowTemplate = (poseRow.workflowTemplate ?? 'twopiece') as 'twopiece' | 'onepiece' | 'hijab';
```

- [ ] **Step 3: Update upload tasks**

Replace:

```ts
    const uploadTasks: Promise<string>[] = [
      uploadToComfy(inputs.upperGarmentKey, 'garment'),
      uploadToComfy(modelKey, 'face'),
      uploadToComfy(poseKey, 'pose'),
      uploadToComfy(bgKey, 'bg'),
    ];
    if (lowerKey) uploadTasks.push(uploadToComfy(lowerKey, 'lower'));
    const [upperGarmentFile, faceFile, poseFile, backgroundFile, lowerGarmentFile] = await Promise.all(uploadTasks);
    jobLog.info({ upperGarmentFile, faceFile, poseFile, backgroundFile, lowerGarmentFile }, 'inputs uploaded');
```

With:

```ts
    const uploadTasks: Promise<string>[] = [
      uploadToComfy(inputs.upperGarmentKey, 'garment'),
      uploadToComfy(faceSideKey, 'faceside'),
      uploadToComfy(poseKey, 'pose'),
      uploadToComfy(bgKey, 'bg'),
    ];
    if (lowerKey) uploadTasks.push(uploadToComfy(lowerKey, 'lower'));
    const [upperGarmentFile, faceSideFile, poseFile, backgroundFile, lowerGarmentFile] = await Promise.all(uploadTasks);
    jobLog.info({ upperGarmentFile, faceSideFile, poseFile, backgroundFile, lowerGarmentFile }, 'inputs uploaded');
```

- [ ] **Step 4: Update patchWorkflow call**

Replace:

```ts
    const prompt = patchWorkflow({
      upperGarmentFile: upperGarmentFile!,
      faceFile: faceFile!,
      poseFile: poseFile!,
      backgroundFile: backgroundFile!,
      lowerGarmentFile,
    });
```

With:

```ts
    const prompt = patchWorkflow({
      workflowTemplate,
      upperGarmentFile: upperGarmentFile!,
      faceSideFile: faceSideFile!,
      poseFile: poseFile!,
      backgroundFile: backgroundFile!,
      lowerGarmentFile,
      promptFacePhase: poseRow.promptFacePhase ?? undefined,
      promptGarmentPhase: poseRow.promptGarmentPhase ?? undefined,
    });
```

- [ ] **Step 5: Typecheck dispatcher**

```bash
pnpm --filter @aivastra/dispatcher typecheck 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dispatcher/src/job/processor.ts
git commit -m "feat(dispatcher): use pose.faceSideR2Key + workflowTemplate in job processing"
```

---

## Task 8: Update admin TypeScript types

**Files:**
- Modify: `apps/admin/src/types.ts`

- [ ] **Step 1: Update ModelPose interface**

Find `interface ModelPose` in `apps/admin/src/types.ts` and replace with:

```ts
export type WorkflowTemplate = 'twopiece' | 'onepiece' | 'hijab';

export interface WorkflowOption {
  value: WorkflowTemplate;
  label: string;
  defaultFacePhasePrompt: string;
  defaultGarmentPhasePrompt: string;
}

// Poses are per (subcategory × face × background) combo
// isTemplate: exactly one pose per face×background cell is the thumbnail shown to users
export interface ModelPose {
  id: string;
  subcategoryId: string;
  faceId: string;
  backgroundId: string;
  label: string;
  thumbnailKey: string;
  r2Key: string;
  faceSideR2Key: string | null;
  workflowTemplate: WorkflowTemplate;
  promptFacePhase: string | null;
  promptGarmentPhase: string | null;
  showsLower: boolean;
  showsShoes: boolean;
  isTemplate: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/src/types.ts
git commit -m "feat(admin/types): add WorkflowOption, faceSideR2Key + prompt fields to ModelPose"
```

---

## Task 9: Create `PoseUploadModal` component

**Files:**
- Create: `apps/admin/src/components/PoseUploadModal.tsx`

- [ ] **Step 1: Create component**

Create `apps/admin/src/components/PoseUploadModal.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import { Icon } from './Icons';
import { Switch } from './Switch';
import { apiFetch } from '../lib/data';
import type { ModelFace, ModelBackground, ModelPose, WorkflowOption } from '../types';

interface PresignResult {
  uploadUrl: string;
  r2Key: string;
  thumbnailUploadUrl: string;
  thumbnailKey: string;
  faceSideUploadUrl: string;
  faceSideR2Key: string;
  // Present only when newFaceContentType was provided
  newFaceUploadUrl?: string;
  newFaceR2Key?: string;
  newFaceThumbnailUploadUrl?: string;
  newFaceThumbnailKey?: string;
  // Present only when newBgContentType was provided
  newBgUploadUrl?: string;
  newBgR2Key?: string;
  newBgThumbnailUploadUrl?: string;
  newBgThumbnailKey?: string;
}

interface Props {
  subcategoryId: string;
  subcategoryGenderSlug: string;
  faces: ModelFace[];
  backgrounds: ModelBackground[];
  onDone: (added: ModelPose) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

async function putFile(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

export function PoseUploadModal({ subcategoryId, subcategoryGenderSlug: _genderSlug, faces, backgrounds, onDone, onClose, toast }: Props) {
  // Workflow
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [workflowTemplate, setWorkflowTemplate] = useState<string>('twopiece');
  const [promptFacePhase, setPromptFacePhase] = useState('');
  const [promptGarmentPhase, setPromptGarmentPhase] = useState('');

  // Face selection
  const [faceMode, setFaceMode] = useState<'existing' | 'new'>('existing');
  const [faceId, setFaceId] = useState(faces[0]?.id ?? '');
  const [newFaceFile, setNewFaceFile] = useState<File | null>(null);
  const newFaceRef = useRef<HTMLInputElement>(null);

  // Background selection
  const [bgMode, setBgMode] = useState<'existing' | 'new'>('existing');
  const [bgId, setBgId] = useState(backgrounds[0]?.id ?? '');
  const [newBgFile, setNewBgFile] = useState<File | null>(null);
  const newBgRef = useRef<HTMLInputElement>(null);

  // Pose image + side face
  const [poseFile, setPoseFile] = useState<File | null>(null);
  const [faceSideFile, setFaceSideFile] = useState<File | null>(null);

  // Metadata
  const [label, setLabel] = useState('');
  const [showsLower, setShowsLower] = useState(true);
  const [showsShoes, setShowsShoes] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);
  const [isTemplate, setIsTemplate] = useState(false);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load workflow options on mount
  useEffect(() => {
    apiFetch<WorkflowOption[]>('/admin/workflows').then((wfs) => {
      setWorkflows(wfs);
      if (wfs.length > 0) {
        const first = wfs[0]!;
        setWorkflowTemplate(first.value);
        setPromptFacePhase(first.defaultFacePhasePrompt);
        setPromptGarmentPhase(first.defaultGarmentPhasePrompt);
      }
    }).catch(() => toast({ kind: 'error', title: 'Failed to load workflow options' }));
  }, [toast]);

  // When workflow changes, fill in defaults (only if user hasn't typed yet — always override for simplicity)
  const handleWorkflowChange = (val: string) => {
    setWorkflowTemplate(val);
    const wf = workflows.find((w) => w.value === val);
    if (wf) {
      setPromptFacePhase(wf.defaultFacePhasePrompt);
      setPromptGarmentPhase(wf.defaultGarmentPhasePrompt);
    }
  };

  const handleUpload = async () => {
    if (!poseFile || !faceSideFile) { setError('Pose image and side face are required'); return; }
    if (faceMode === 'existing' && !faceId) { setError('Select a model face'); return; }
    if (faceMode === 'new' && !newFaceFile) { setError('Upload a new face image'); return; }
    if (bgMode === 'existing' && !bgId) { setError('Select a background'); return; }
    if (bgMode === 'new' && !newBgFile) { setError('Upload a new background image'); return; }
    if (!promptFacePhase.trim() || !promptGarmentPhase.trim()) { setError('Both prompts are required'); return; }
    if (!label.trim()) { setError('Label is required'); return; }

    setUploading(true);
    setError(null);

    try {
      // 1. Presign
      const presignBody: Record<string, unknown> = {
        subcategoryId,
        contentType: poseFile.type,
        faceSideContentType: faceSideFile.type,
      };
      if (faceMode === 'existing') presignBody['faceId'] = faceId;
      else presignBody['newFaceContentType'] = newFaceFile!.type;
      if (bgMode === 'existing') presignBody['backgroundId'] = bgId;
      else presignBody['newBgContentType'] = newBgFile!.type;

      const presign = await apiFetch<PresignResult>('/admin/assets/poses/presign', {
        method: 'POST',
        body: JSON.stringify(presignBody),
      });

      // 2. Upload all files in parallel
      const uploads: Promise<void>[] = [
        putFile(presign.uploadUrl, poseFile),
        putFile(presign.thumbnailUploadUrl, poseFile),
        putFile(presign.faceSideUploadUrl, faceSideFile),
      ];
      if (faceMode === 'new' && presign.newFaceUploadUrl && presign.newFaceThumbnailUploadUrl) {
        uploads.push(putFile(presign.newFaceUploadUrl, newFaceFile!));
        uploads.push(putFile(presign.newFaceThumbnailUploadUrl, newFaceFile!));
      }
      if (bgMode === 'new' && presign.newBgUploadUrl && presign.newBgThumbnailUploadUrl) {
        uploads.push(putFile(presign.newBgUploadUrl, newBgFile!));
        uploads.push(putFile(presign.newBgThumbnailUploadUrl, newBgFile!));
      }
      await Promise.all(uploads);

      // 3. Confirm
      const confirmBody: Record<string, unknown> = {
        subcategoryId,
        label: label.trim(),
        r2Key: presign.r2Key,
        thumbnailKey: presign.thumbnailKey,
        faceSideR2Key: presign.faceSideR2Key,
        workflowTemplate,
        promptFacePhase: promptFacePhase.trim(),
        promptGarmentPhase: promptGarmentPhase.trim(),
        showsLower,
        showsShoes,
        isTemplate,
        sortOrder,
      };
      if (faceMode === 'existing') {
        confirmBody['faceId'] = faceId;
      } else {
        confirmBody['newFace'] = {
          r2Key: presign.newFaceR2Key,
          thumbnailKey: presign.newFaceThumbnailKey,
          filename: newFaceFile!.name,
        };
      }
      if (bgMode === 'existing') {
        confirmBody['backgroundId'] = bgId;
      } else {
        confirmBody['newBackground'] = {
          r2Key: presign.newBgR2Key,
          thumbnailKey: presign.newBgThumbnailKey,
          filename: newBgFile!.name,
        };
      }

      const pose = await apiFetch<ModelPose>('/admin/assets/poses/confirm', {
        method: 'POST',
        body: JSON.stringify(confirmBody),
      });

      toast({ title: `Pose "${pose.label}" uploaded` });
      onDone(pose);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const canSubmit = !uploading && poseFile && faceSideFile && label.trim() &&
    (faceMode === 'existing' ? Boolean(faceId) : Boolean(newFaceFile)) &&
    (bgMode === 'existing' ? Boolean(bgId) : Boolean(newBgFile)) &&
    promptFacePhase.trim() && promptGarmentPhase.trim();

  return (
    <div className="modal-overlay" onClick={uploading ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, calc(100vw - 40px))' }}>
        <div className="modal-head">
          <h3>Upload pose</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={uploading} style={{ marginLeft: 'auto' }}>
            <Icon.Close />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '72vh', overflowY: 'auto' }}>

          {/* Pose image */}
          <div className="field">
            <label>Pose image <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0] ?? null; setPoseFile(f); if (f && !label) setLabel(f.name.replace(/\.[^.]+$/, '')); }}
              style={{ fontSize: 13 }} />
            {poseFile && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{poseFile.name} ({(poseFile.size / 1024).toFixed(0)} KB)</span>}
          </div>

          {/* Side / tilt face (backend only) */}
          <div className="field">
            <label>
              Side / tilt face <span style={{ color: 'var(--danger)' }}>*</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>(backend only — sent to ComfyUI face node)</span>
            </label>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
              onChange={(e) => setFaceSideFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: 13 }} />
            {faceSideFile && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{faceSideFile.name} ({(faceSideFile.size / 1024).toFixed(0)} KB)</span>}
          </div>

          {/* Model face (display / filter) */}
          <div className="field">
            <label>Model face (display &amp; filter)</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className={`btn sm ${faceMode === 'existing' ? 'primary' : 'ghost'}`} disabled={uploading} onClick={() => setFaceMode('existing')}>Use existing</button>
              <button className={`btn sm ${faceMode === 'new' ? 'primary' : 'ghost'}`} disabled={uploading} onClick={() => setFaceMode('new')}>Upload new</button>
            </div>
            {faceMode === 'existing' ? (
              <select className="select" value={faceId} disabled={uploading} onChange={(e) => setFaceId(e.target.value)}>
                {faces.map((f) => <option key={f.id} value={f.id}>[{f.gender}] {f.label}</option>)}
              </select>
            ) : (
              <>
                <input ref={newFaceRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
                  onChange={(e) => setNewFaceFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
                {newFaceFile && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{newFaceFile.name}</span>}
              </>
            )}
          </div>

          {/* Background */}
          <div className="field">
            <label>Background</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className={`btn sm ${bgMode === 'existing' ? 'primary' : 'ghost'}`} disabled={uploading} onClick={() => setBgMode('existing')}>Use existing</button>
              <button className={`btn sm ${bgMode === 'new' ? 'primary' : 'ghost'}`} disabled={uploading} onClick={() => setBgMode('new')}>Upload new</button>
            </div>
            {bgMode === 'existing' ? (
              <select className="select" value={bgId} disabled={uploading} onChange={(e) => setBgId(e.target.value)}>
                {backgrounds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            ) : (
              <>
                <input ref={newBgRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
                  onChange={(e) => setNewBgFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
                {newBgFile && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{newBgFile.name}</span>}
              </>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          {/* Workflow */}
          <div className="field">
            <label>Workflow template</label>
            <select className="select" value={workflowTemplate} disabled={uploading || workflows.length === 0}
              onChange={(e) => handleWorkflowChange(e.target.value)}>
              {workflows.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              {workflows.length === 0 && <option value="twopiece">Loading…</option>}
            </select>
          </div>

          {/* Prompts */}
          <div className="field">
            <label>Face phase prompt (positive)</label>
            <textarea
              className="input"
              value={promptFacePhase}
              disabled={uploading}
              rows={5}
              onChange={(e) => setPromptFacePhase(e.target.value)}
              style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
            />
          </div>
          <div className="field">
            <label>Garment phase prompt (positive)</label>
            <textarea
              className="input"
              value={promptGarmentPhase}
              disabled={uploading}
              rows={5}
              onChange={(e) => setPromptGarmentPhase(e.target.value)}
              style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
            />
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          {/* Label + toggles */}
          <div className="field">
            <label>Pose label <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input className="input" value={label} disabled={uploading} placeholder="e.g. Front view, Standing pose…"
              onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 0 }}>
              <Switch checked={showsLower} onChange={() => { if (!uploading) setShowsLower((v) => !v); }} />
              <label style={{ margin: 0 }}>Shows lower garment</label>
            </div>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 0 }}>
              <Switch checked={showsShoes} onChange={() => { if (!uploading) setShowsShoes((v) => !v); }} />
              <label style={{ margin: 0 }}>Shows shoes</label>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Sort order</label>
              <input className="input" type="number" min={0} value={sortOrder} disabled={uploading}
                onChange={(e) => setSortOrder(Number(e.target.value))} style={{ width: 100 }} />
            </div>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 'auto 0 0' }}>
              <input type="checkbox" id="isTemplate" checked={isTemplate} disabled={uploading}
                onChange={(e) => setIsTemplate(e.target.checked)} />
              <label htmlFor="isTemplate" style={{ margin: 0 }}>Set as template for this cell</label>
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 13, color: 'var(--danger)', padding: '8px 12px', background: 'var(--danger-soft)', borderRadius: 6 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={uploading}>Cancel</button>
          <button className="btn primary" onClick={handleUpload} disabled={!canSubmit}>
            <Icon.Upload />
            {uploading ? 'Uploading…' : 'Upload pose'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @aivastra/admin typecheck 2>&1 | head -20
```

Expected: no errors in PoseUploadModal.tsx.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/components/PoseUploadModal.tsx
git commit -m "feat(admin): PoseUploadModal — single pose with side face, workflow, prompts, inline upload"
```

---

## Task 10: Wire `PoseUploadModal` into `AssetsPage`

**Files:**
- Modify: `apps/admin/src/pages/AssetsPage.tsx`

- [ ] **Step 1: Replace import**

In `apps/admin/src/pages/AssetsPage.tsx`, replace:

```ts
import { BatchPoseUploadModal } from '../components/BatchPoseUploadModal';
```

With:

```ts
import { PoseUploadModal } from '../components/PoseUploadModal';
```

- [ ] **Step 2: Replace modal render**

Find the `{showBatchPoseUpload && subView.kind === 'subcategory' && (` block and replace it:

```tsx
      {showBatchPoseUpload && subView.kind === 'subcategory' && (
        <PoseUploadModal
          subcategoryId={subView.sub.id}
          subcategoryGenderSlug={subView.sub.genderSlug}
          faces={faces}
          backgrounds={backgrounds}
          onDone={(added) => { setShowBatchPoseUpload(false); setPoses((prev) => [...prev, added]); }}
          onClose={() => setShowBatchPoseUpload(false)}
          toast={toast}
        />
      )}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @aivastra/admin typecheck 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Build admin**

```bash
pnpm --filter @aivastra/admin build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/AssetsPage.tsx
git commit -m "feat(admin): wire PoseUploadModal into AssetsPage, remove BatchPoseUploadModal usage"
```

---

## Task 11: Build all packages + smoke test

- [ ] **Step 1: Build all packages**

```bash
pnpm --filter "./packages/*" build
```

Expected: all 4 packages build without errors.

- [ ] **Step 2: Verify API starts**

Start dev and watch for errors:

```bash
pnpm --filter @aivastra/api dev 2>&1 | head -20
```

Expected: API starts on port 4000, no import errors.

- [ ] **Step 3: Verify dispatcher starts**

```bash
pnpm --filter @aivastra/dispatcher dev 2>&1 | head -20
```

Expected: starts without `ERR_MODULE_NOT_FOUND` or type errors.

- [ ] **Step 4: Test GET /admin/workflows endpoint**

With dev running, get an admin cookie and test:

```bash
# Login first
curl -s -c /tmp/admin-cookie.txt -X POST http://localhost:4000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change_me_dev_only"}' > /dev/null

curl -s http://localhost:4000/admin/workflows \
  -b /tmp/admin-cookie.txt | python3 -m json.tool
```

Expected: JSON array with 3 objects:
```json
[
  { "value": "twopiece", "label": "Two-Piece (Upper + Lower)", "defaultFacePhasePrompt": "...", "defaultGarmentPhasePrompt": "..." },
  { "value": "onepiece", "label": "One-Piece / Full Outfit", "defaultFacePhasePrompt": "...", "defaultGarmentPhasePrompt": "..." },
  { "value": "hijab", "label": "Hijab / Head Cover", "defaultFacePhasePrompt": "...", "defaultGarmentPhasePrompt": "..." }
]
```

- [ ] **Step 5: Verify admin UI loads pose upload modal**

Open `http://localhost:5173` → login → Assets → Subcategories → select any subcategory → click "Upload poses". The new modal should appear with workflow dropdown, prompt text areas, face/bg toggle buttons, and side-face upload field.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: build + integration verified for pose workflow feature"
git push origin master
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ DB migration with 4 columns
- ✅ Templates copied (onepiece, hijab)
- ✅ `GET /admin/workflows` endpoint with defaults from JSON
- ✅ Presign handles inline face/bg upload or existing select
- ✅ Confirm creates face/bg rows inline if new upload
- ✅ Side face stored as `faceSideR2Key` on pose
- ✅ Patcher parameterized by `workflowTemplate`
- ✅ `faceSideFile` (not display face) patched into ComfyUI face node
- ✅ Both positive prompts patched into correct nodes
- ✅ Processor uses `poseRow.faceSideR2Key`, falls back to display face for legacy
- ✅ Admin `PoseUploadModal` — workflow dropdown auto-fills prompts
- ✅ Shows lower/shoes toggles enabled
- ✅ `faceId` (display) still stored on pose for frontend filtering
- ✅ BatchPoseUploadModal replaced (not deleted — still exists but unused, can be cleaned up later)
