# Accessory Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the studio wizard offer optional, admin-curated accessory images (necklaces, watches, belts, …) grouped into categories per garment type; selected images are vertically stacked into one composite and patched into a single optional ComfyUI node.

**Architecture:** Reuses the existing lower/shoe catalog machinery (`catalog_types` / `catalog_categories` / `catalog_items` / `catalog_item_subcategories`) verbatim with a new `'accessory'` type — **no new tables**. A new nullable `accessoryNodeId` column on `workflow_templates` marks which templates accept a stacked accessory image. The dispatcher resolves selected catalog items live at dispatch time (mirroring the *real*, undocumented lower/shoe behavior — see Global Constraints), vertically concatenates their bytes in memory with `sharp`, and uploads the single composite to ComfyUI. Unlike lower/shoe, accessories are **never mandatory** — a mapped `accessoryNodeId` with no selection just leaves that node untouched.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM, Postgres, Zod, sharp (image compositing), React (Next.js + Vite), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-01-accessory-images-design.md` — read it before starting; this plan implements it exactly.
- Scope is the studio wizard only (`apps/catalogues-web` → `/v1/jobs/tryon`). Shopify widget, kiosk, merchant catalogue flows, and the public dev API are explicitly out of scope — do not touch `apps/api/src/modules/catalog-options/build.ts` or `apps/api/src/modules/shopify/*`.
- Accessories are a free add-on — no credit-cost changes anywhere.
- **Dispatcher resolves catalog IDs → R2 keys live at dispatch time**, not the API at enqueue time — this is what `apps/dispatcher/src/job/processor.ts:590-619` actually does for `lowerCatalogId`/`shoeCatalogId` today, contradicting CLAUDE.md's stated invariant. Accessories follow this real behavior.
- Never introduce a raw `<select>` — `apps/catalogues-web` uses the existing picker components already used for lower/shoe; `apps/admin-web` uses `SearchableSelect`/`NodeSelect`, already in place for the files this plan touches.
- No DB writes against production. All migrations are applied locally via `pnpm db:migrate` against the dev docker-compose Postgres.
- Package manager is pnpm; never add npm/yarn lockfiles.

---

## Task 1: Database schema — accessory catalog type, node ID columns

**Files:**
- Modify: `packages/db/src/schema/jobs.ts` (add `accessoryCatalogIds` to `jobInputs`)
- Modify: `packages/db/src/schema/models.ts` (add `accessoryNodeId` to `workflowTemplates` and `workflowTemplateArchives`)
- Modify: `apps/dispatcher/src/workflow/resolve-template-version.ts` (carry `accessoryNodeId` through the archived-version fallback)
- Create: `packages/db/src/migrations/02XX_accessory_node_id.sql` (auto-generated, exact name TBD by drizzle-kit)
- Create: `packages/db/src/migrations/02XX_seed_accessory_catalog_type.sql` (hand-authored data seed)
- Modify: `packages/db/src/migrations/meta/_journal.json` (auto-updated by drizzle-kit for the first migration; manually appended for the second)
- Test: `packages/db/test/models-schema.test.ts`

**Interfaces:**
- Produces: `schema.jobInputs.accessoryCatalogIds: string[]` (uuid array, default `[]`), `schema.workflowTemplates.accessoryNodeId: string | null`, `schema.workflowTemplateArchives.accessoryNodeId: string | null`. Every later task reads these exact names.

- [ ] **Step 1: Write a failing test for the new column + seed row**

Add to `packages/db/test/models-schema.test.ts` (append a new `describe` block at the end of the file, following the existing `model_faces`/`model_backgrounds` pattern already in the file):

```ts
describe('accessory catalog type', () => {
  it('seeds the accessory catalog type', async () => {
    const [accessoryType] = await db
      .select()
      .from(schema.catalogTypes)
      .where(eq(schema.catalogTypes.slug, 'accessory'));
    expect(accessoryType).toBeTruthy();
    expect(accessoryType.label).toBeTruthy();
  });
});

describe('workflow_templates.accessoryNodeId', () => {
  it('accepts a nullable accessory node id', async () => {
    const [face] = await db
      .insert(schema.modelFaces)
      .values({
        gender: 'men',
        label: 'accessory-test-face',
        r2Key: 'faces/accessory-test.jpg',
        thumbnailKey: 'faces/accessory-test_thumb.jpg',
      })
      .returning();
    expect(face.id).toBeTruthy();

    const [tmpl] = await db
      .insert(schema.workflowTemplates)
      .values({
        slug: 'accessory_node_test',
        label: 'Accessory Node Test',
        jsonContent: {},
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
        accessoryNodeId: '3',
      })
      .returning();
    expect(tmpl.accessoryNodeId).toBe('3');
  });
});

describe('job_inputs.accessoryCatalogIds', () => {
  it('defaults to an empty array', async () => {
    const [face] = await db
      .insert(schema.modelFaces)
      .values({
        gender: 'men',
        label: 'job-inputs-accessory-test-face',
        r2Key: 'faces/job-inputs-accessory-test.jpg',
        thumbnailKey: 'faces/job-inputs-accessory-test_thumb.jpg',
      })
      .returning();
    const [job] = await db.insert(schema.jobs).values({ status: 'QUEUED' }).returning();
    const [inputs] = await db
      .insert(schema.jobInputs)
      .values({ jobId: job.id, faceId: face.id })
      .returning();
    expect(inputs.accessoryCatalogIds).toEqual([]);
  });
});
```

Add `eq` to the existing drizzle-orm import at the top of the file if not already imported (check the current import line first — it already imports from `vitest` and `../src/schema/index`; add `import { eq } from 'drizzle-orm';` if missing).

- [ ] **Step 2: Run the test to verify it fails**

Requires `pnpm docker:up` running first (Postgres on localhost). Run from repo root:

```bash
pnpm --filter @aivastra/db test
```

Expected: FAIL — `catalogTypes.slug = 'accessory'` not found, `accessoryNodeId` not a valid column (TypeScript compile error on `schema.workflowTemplates` insert), `accessoryCatalogIds` not a valid column.

- [ ] **Step 3: Add `accessoryCatalogIds` to `job_inputs`**

In `packages/db/src/schema/jobs.ts`, add `sql` to the existing drizzle-orm import (currently `import { boolean, index, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';` plus no `drizzle-orm` import — add a new line `import { sql } from 'drizzle-orm';` above it), then add the column to `jobInputs` right after `shoeCatalogId`:

```ts
  shoeCatalogId: uuid('shoe_catalog_id').references(() => catalogItems.id),
  // Selected accessory catalog items (at most one per category, zero or more
  // categories) — never mandatory, unlike lower/shoe. The dispatcher resolves
  // these to live R2 keys and vertically stacks them into one composite image
  // at dispatch time (see apps/dispatcher/src/job/processor.ts). See
  // docs/superpowers/specs/2026-10-01-accessory-images-design.md.
  accessoryCatalogIds: uuid('accessory_catalog_ids')
    .array()
    .notNull()
    .default(sql`ARRAY[]::uuid[]`),
  userHint: text('user_hint'),
```

- [ ] **Step 4: Add `accessoryNodeId` to `workflow_templates` and `workflow_template_archives`**

In `packages/db/src/schema/models.ts`, add to `workflowTemplates` right after `thirdNodeId`:

```ts
  thirdNodeId: text('third_node_id'), // nullable — a 3rd, generically-named uploaded garment role
  // Optional single node for a stacked accessory composite (see
  // apps/dispatcher/src/workflow/accessory-stack.ts). Unlike lowerNodeId/
  // shoeNodeId/thirdNodeId, a mapped accessoryNodeId is never mandatory — a
  // job with no accessories selected simply leaves this node untouched.
  accessoryNodeId: text('accessory_node_id'),
```

And to `workflowTemplateArchives` (same file, right after its own `thirdNodeId: text('third_node_id'),`):

```ts
    thirdNodeId: text('third_node_id'),
    accessoryNodeId: text('accessory_node_id'),
```

- [ ] **Step 5: Generate the schema migration**

From repo root:

```bash
pnpm db:generate
```

This produces a new `packages/db/src/migrations/02XX_<auto-name>.sql` (the next index after 0208) containing the three `ALTER TABLE ... ADD COLUMN` statements, and updates `meta/_journal.json` and the meta snapshot automatically. Confirm the generated SQL only adds the three nullable/defaulted columns — no unrelated drift.

- [ ] **Step 6: Hand-author the data-seed migration for the `accessory` catalog type**

From `packages/db`:

```bash
npx drizzle-kit generate --custom --name=seed_accessory_catalog_type
```

This creates an empty `packages/db/src/migrations/02XX_seed_accessory_catalog_type.sql` (next index after the one from Step 5) and appends its journal entry automatically. Write its contents, mirroring `packages/db/src/migrations/0006_catalog_types_seed.sql` exactly (idempotent, `ON CONFLICT DO NOTHING`):

```sql
-- seed catalog type for accessories (necklaces, watches, belts, etc.)
INSERT INTO catalog_types (slug, label)
VALUES
  ('accessory', 'Accessories')
ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 7: Carry `accessoryNodeId` through the archived-version fallback**

In `apps/dispatcher/src/workflow/resolve-template-version.ts`, add one line to the archived-version override object, right after `thirdNodeId: archived.thirdNodeId,`:

```ts
    thirdNodeId: archived.thirdNodeId,
    accessoryNodeId: archived.accessoryNodeId,
```

This is easy to miss and matters: without it, a job dispatched against a draining (replaced) workflow template version would silently lose its accessory node mapping.

- [ ] **Step 8: Apply migrations locally and run the test**

```bash
pnpm docker:up
pnpm db:migrate
pnpm --filter @aivastra/db test
```

Expected: PASS — all three new assertions succeed.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema/jobs.ts packages/db/src/schema/models.ts packages/db/src/migrations/ packages/db/test/models-schema.test.ts apps/dispatcher/src/workflow/resolve-template-version.ts
git commit -m "feat(db): add accessory catalog type and accessoryNodeId columns"
```

---

## Task 2: Shared types — accessoryCatalogIds, accessoryNodeId, hasAccessory

**Files:**
- Modify: `packages/types/src/jobs.ts` (`CreateTryOnJobInputsBase`)
- Modify: `packages/types/src/admin.ts` (`CreateWorkflowBody`, `UpdateWorkflowBody`)
- Modify: `apps/api/src/modules/models/garment-roles.ts` (`poseGarmentRoles`)
- Test: `packages/types/src/jobs.test.ts`
- Test: new `apps/api/src/modules/models/garment-roles.test.ts`

**Interfaces:**
- Consumes: nothing new (pure schema/type additions).
- Produces: `CreateTryOnJobInputsBase.accessoryCatalogIds?: string[]`, `CreateWorkflowBody.accessoryNodeId?: string`, `UpdateWorkflowBody.accessoryNodeId?: string | null`, `poseGarmentRoles(w).hasAccessory: boolean`. Tasks 6, 7, 8, 9 all depend on these exact names.

- [ ] **Step 1: Write a failing test for `poseGarmentRoles`**

Create `apps/api/src/modules/models/garment-roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { poseGarmentRoles } from './garment-roles.js';

describe('poseGarmentRoles', () => {
  it('reports hasAccessory true when accessoryNodeId is set', () => {
    const roles = poseGarmentRoles({
      upperNodeIds: ['1'],
      lowerNodeId: null,
      shoeNodeId: null,
      accessoryNodeId: '42',
    });
    expect(roles.hasAccessory).toBe(true);
  });

  it('reports hasAccessory false when accessoryNodeId is null or omitted', () => {
    expect(
      poseGarmentRoles({ upperNodeIds: [], lowerNodeId: null, shoeNodeId: null, accessoryNodeId: null }),
    ).toMatchObject({ hasAccessory: false });
    expect(
      poseGarmentRoles({ upperNodeIds: [], lowerNodeId: null, shoeNodeId: null }),
    ).toMatchObject({ hasAccessory: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @aivastra/api test garment-roles
```

Expected: FAIL — `accessoryNodeId` is not a valid property on the input type, `hasAccessory` is not on the return type.

- [ ] **Step 3: Extend `poseGarmentRoles`**

Replace the full contents of `apps/api/src/modules/models/garment-roles.ts`:

```ts
// Single derivation of which garment slots a resolved workflow consumes. `hasUpper`
// exists so a client can tell a lower-only ("sole lower hero") workflow apart from
// a full-outfit one — createJob rejects a sole-lower pose without a lower upload
// (jobs/create.ts), and hasLower alone can't distinguish the two.
export function poseGarmentRoles(w: {
  upperNodeIds?: string[] | null;
  lowerNodeId?: string | null;
  shoeNodeId?: string | null;
  accessoryNodeId?: string | null;
}) {
  return {
    hasUpper: (w.upperNodeIds?.length ?? 0) > 0,
    hasLower: w.lowerNodeId != null,
    hasShoes: w.shoeNodeId != null,
    hasAccessory: w.accessoryNodeId != null,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm --filter @aivastra/api test garment-roles
```

Expected: PASS.

- [ ] **Step 5: Write a failing test for `CreateTryOnJobInputsBase.accessoryCatalogIds`**

Add to `packages/types/src/jobs.test.ts` (append, following the file's existing style):

```ts
describe('CreateTryOnJobInputsBase accessoryCatalogIds', () => {
  it('accepts an array of uuids', () => {
    const result = CreateTryOnJobInputsBase.safeParse({
      faceId: '11111111-1111-1111-1111-111111111111',
      backgroundId: '22222222-2222-2222-2222-222222222222',
      poseIds: ['33333333-3333-3333-3333-333333333333'],
      accessoryCatalogIds: ['44444444-4444-4444-4444-444444444444'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accessoryCatalogIds).toEqual([
        '44444444-4444-4444-4444-444444444444',
      ]);
    }
  });

  it('rejects a non-uuid entry', () => {
    const result = CreateTryOnJobInputsBase.safeParse({
      faceId: '11111111-1111-1111-1111-111111111111',
      backgroundId: '22222222-2222-2222-2222-222222222222',
      poseIds: ['33333333-3333-3333-3333-333333333333'],
      accessoryCatalogIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });

  it('is optional', () => {
    const result = CreateTryOnJobInputsBase.safeParse({
      faceId: '11111111-1111-1111-1111-111111111111',
      backgroundId: '22222222-2222-2222-2222-222222222222',
      poseIds: ['33333333-3333-3333-3333-333333333333'],
    });
    expect(result.success).toBe(true);
  });
});
```

Add `CreateTryOnJobInputsBase` to the file's existing import from `./jobs.js` if not already imported.

- [ ] **Step 6: Run it to verify it fails**

```bash
pnpm --filter @aivastra/types test
```

Expected: FAIL — `accessoryCatalogIds` stripped/rejected as an unrecognized key is NOT how Zod `.object()` behaves by default (unknown keys are stripped silently, not rejected), so the first two assertions fail differently: `result.data.accessoryCatalogIds` is `undefined` instead of the array, and the "rejects a non-uuid" test fails because the whole field is silently dropped rather than validated. Confirm the failures look like that, not a crash.

- [ ] **Step 7: Add the field**

In `packages/types/src/jobs.ts`, add to `CreateTryOnJobInputsBase` right after `shoeCatalogId`:

```ts
  shoeCatalogId: z.string().uuid().optional(),
  // Selected accessory catalog items — at most one per category, zero or
  // more categories, never mandatory. Capped generously; the studio wizard
  // never offers anywhere near this many categories today.
  accessoryCatalogIds: z.array(z.string().uuid()).max(20).optional(),
});
```

(Replace the existing closing `});` for the object — this field becomes the new last field before it.)

- [ ] **Step 8: Run it to verify it passes**

```bash
pnpm --filter @aivastra/types test
```

Expected: PASS.

- [ ] **Step 9: Add `accessoryNodeId` to the admin workflow Zod schemas**

In `packages/types/src/admin.ts`, add to `CreateWorkflowBody` right after `thirdNodeId: z.string().min(1).optional(),` (inside the object started at `export const CreateWorkflowBody = z.object({`):

```ts
    thirdNodeId: z.string().min(1).optional(),
    accessoryNodeId: z.string().min(1).optional(),
```

And to `UpdateWorkflowBody` right after `thirdNodeId: z.string().min(1).nullable().optional(),`:

```ts
  thirdNodeId: z.string().min(1).nullable().optional(),
  accessoryNodeId: z.string().min(1).nullable().optional(),
```

No test added for this step alone — it's exercised end-to-end by Task 9's integration test.

- [ ] **Step 10: Typecheck**

```bash
pnpm --filter @aivastra/types run typecheck
pnpm --filter @aivastra/api run typecheck
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add packages/types/src/jobs.ts packages/types/src/jobs.test.ts packages/types/src/admin.ts apps/api/src/modules/models/garment-roles.ts apps/api/src/modules/models/garment-roles.test.ts
git commit -m "feat(types): add accessoryCatalogIds, accessoryNodeId, hasAccessory"
```

---

## Task 3: Dispatcher — vertical accessory stacking (pure function)

**Files:**
- Create: `apps/dispatcher/src/workflow/accessory-stack.ts`
- Test: `apps/dispatcher/src/workflow/accessory-stack.test.ts`

**Interfaces:**
- Produces: `stackAccessoryImages(images: Buffer[]): Promise<Buffer>` — Task 5 (processor.ts) calls this with R2-downloaded bytes in category-sortOrder, gets back one PNG buffer to upload to ComfyUI.

- [ ] **Step 1: Write the failing tests**

Create `apps/dispatcher/src/workflow/accessory-stack.test.ts`:

```ts
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { stackAccessoryImages } from './accessory-stack.js';

async function makeColorImage(
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

describe('stackAccessoryImages', () => {
  it('throws when given an empty array', async () => {
    await expect(stackAccessoryImages([])).rejects.toThrow(
      'stackAccessoryImages requires at least one image',
    );
  });

  it('returns the image unchanged in shape for a single input', async () => {
    const img = await makeColorImage(100, 60, { r: 255, g: 0, b: 0 });
    const result = await stackAccessoryImages([img]);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(60);
    expect(meta.format).toBe('png');
  });

  it('stacks two same-width images vertically, summing heights', async () => {
    const top = await makeColorImage(100, 40, { r: 255, g: 0, b: 0 });
    const bottom = await makeColorImage(100, 60, { r: 0, g: 0, b: 255 });
    const result = await stackAccessoryImages([top, bottom]);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });

  it('places images in input order, top to bottom', async () => {
    const top = await makeColorImage(40, 20, { r: 255, g: 0, b: 0 });
    const bottom = await makeColorImage(40, 20, { r: 0, g: 0, b: 255 });
    const result = await stackAccessoryImages([top, bottom]);

    const topPixel = await sharp(result)
      .extract({ left: 5, top: 5, width: 1, height: 1 })
      .raw()
      .toBuffer();
    const bottomPixel = await sharp(result)
      .extract({ left: 5, top: 25, width: 1, height: 1 })
      .raw()
      .toBuffer();

    expect(topPixel[0]).toBeGreaterThan(200); // red channel high → red image
    expect(bottomPixel[2]).toBeGreaterThan(200); // blue channel high → blue image
  });

  it('resizes a narrower image up to the widest selected image before stacking', async () => {
    const wide = await makeColorImage(200, 50, { r: 255, g: 0, b: 0 });
    const narrow = await makeColorImage(100, 50, { r: 0, g: 0, b: 255 });
    const result = await stackAccessoryImages([wide, narrow]);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @aivastra/dispatcher test accessory-stack
```

Expected: FAIL — `./accessory-stack.js` does not exist.

- [ ] **Step 3: Implement `stackAccessoryImages`**

Create `apps/dispatcher/src/workflow/accessory-stack.ts`:

```ts
import sharp from 'sharp';

/**
 * Vertically concatenates admin-curated accessory images into one composite —
 * a plain top-to-bottom stack (y-axis), never an overlay/z-axis composite.
 * Images are resized to the widest input's width (preserving aspect ratio)
 * before stacking, since admin-uploaded accessory images are expected to
 * share a close-to-common width but aren't guaranteed to match exactly. See
 * docs/superpowers/specs/2026-10-01-accessory-images-design.md.
 */
export async function stackAccessoryImages(images: Buffer[]): Promise<Buffer> {
  if (images.length === 0) {
    throw new Error('stackAccessoryImages requires at least one image');
  }

  const metas = await Promise.all(images.map((img) => sharp(img).metadata()));
  const targetWidth = Math.max(...metas.map((m) => m.width ?? 0));
  if (targetWidth <= 0) {
    throw new Error('stackAccessoryImages: could not read image dimensions');
  }

  const layers = await Promise.all(
    images.map(async (img, i) => {
      const meta = metas[i];
      if (meta?.width === targetWidth) {
        return { buffer: img, height: meta.height ?? 0 };
      }
      const resized = await sharp(img).resize({ width: targetWidth }).toBuffer();
      const resizedMeta = await sharp(resized).metadata();
      return { buffer: resized, height: resizedMeta.height ?? 0 };
    }),
  );

  const totalHeight = layers.reduce((sum, layer) => sum + layer.height, 0);

  let top = 0;
  const composites = layers.map((layer) => {
    const entry = { input: layer.buffer, top, left: 0 };
    top += layer.height;
    return entry;
  });

  return sharp({
    create: {
      width: targetWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @aivastra/dispatcher test accessory-stack
```

Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dispatcher/src/workflow/accessory-stack.ts apps/dispatcher/src/workflow/accessory-stack.test.ts
git commit -m "feat(dispatcher): add stackAccessoryImages vertical compositor"
```

---

## Task 4: Dispatcher — patch the accessory node in `patcher.ts`

**Files:**
- Modify: `apps/dispatcher/src/workflow/patcher.ts`
- Test: `apps/dispatcher/src/workflow/patcher.test.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks (standalone node-patching logic).
- Produces: `WorkflowInputs.accessoryGarmentFile?: string`. Task 5 (processor.ts) passes this field into `patchWorkflow(...)`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/dispatcher/src/workflow/patcher.test.ts` (new `describe` block near the existing "Shoes"/"Third garment" blocks — add after whichever of those two comes last in the file):

```ts
// ── Accessories ───────────────────────────────────────────────────────────

describe('accessories', () => {
  function makeWorkflowWithAccessoryNode() {
    return { ...makeWorkflow(), '1370': { inputs: { image: 'placeholder_accessory.png' }, class_type: 'LoadImage', _meta: { title: 'accessory' } } };
  }

  it('patches the accessory node with the provided accessoryGarmentFile', () => {
    const wf = makeWorkflowWithAccessoryNode();
    const tmpl = makeTemplate({ accessoryNodeId: '1370' });
    applyWorkflowPatch(wf, tmpl, { ...BASE_INPUTS, accessoryGarmentFile: 'accessory_stack_abc.png' });
    expect(wf['1370']?.inputs.image).toBe('accessory_stack_abc.png');
  });

  it('leaves the accessory node untouched when no accessory was selected', () => {
    const wf = makeWorkflowWithAccessoryNode();
    const tmpl = makeTemplate({ accessoryNodeId: '1370' });
    applyWorkflowPatch(wf, tmpl, BASE_INPUTS);
    // No throw, and the template's own placeholder survives unchanged —
    // unlike lower/shoe/third, a mapped-but-unselected accessory is valid.
    expect(wf['1370']?.inputs.image).toBe('placeholder_accessory.png');
  });

  it('warns when an accessory file is provided but no accessoryNodeId is mapped', () => {
    const wf = makeWorkflowWithAccessoryNode();
    const warn = vi.fn();
    const tmpl = makeTemplate({ accessoryNodeId: null });
    applyWorkflowPatch(
      wf,
      tmpl,
      { ...BASE_INPUTS, accessoryGarmentFile: 'accessory_stack_abc.png' },
      { warn },
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no accessory_node_id'));
    expect(wf['1370']?.inputs.image).toBe('placeholder_accessory.png');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @aivastra/dispatcher test patcher
```

Expected: FAIL — `accessoryNodeId` is not a valid `WorkflowTemplate` override field, `accessoryGarmentFile` is not a valid `WorkflowInputs` field.

- [ ] **Step 3: Add `accessoryGarmentFile` to `WorkflowInputs` and patch logic**

In `apps/dispatcher/src/workflow/patcher.ts`, add to the `WorkflowInputs` interface right after `thirdGarmentFile?: string;`:

```ts
  thirdGarmentFile?: string;
  /** Pre-stacked composite of every selected accessory image (see
   *  stackAccessoryImages) — a single file regardless of how many accessory
   *  categories were selected. */
  accessoryGarmentFile?: string;
```

Add the patch branch in `applyWorkflowPatch`, right after the existing `thirdNodeId` block (after the `}` closing the `else if (inputs.thirdGarmentFile) { log?.warn(...) }` block, before the "Positive prompt" comment):

```ts
  // Accessories are never mandatory, unlike lower/shoe/third above: a mapped
  // accessoryNodeId with nothing selected simply leaves the node untouched,
  // carrying whatever placeholder the template's JSON shipped with.
  if (tmpl.accessoryNodeId) {
    if (inputs.accessoryGarmentFile) {
      requireNode(workflow, tmpl.accessoryNodeId, 'accessory').inputs.image =
        inputs.accessoryGarmentFile;
    }
  } else if (inputs.accessoryGarmentFile) {
    log?.warn(
      `patchWorkflow: accessory image provided but workflow "${tmpl.slug}" has no accessory_node_id — skipping`,
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @aivastra/dispatcher test patcher
```

Expected: PASS — all 3 new tests, and the full existing suite still green (no fixture mutated).

- [ ] **Step 5: Commit**

```bash
git add apps/dispatcher/src/workflow/patcher.ts apps/dispatcher/src/workflow/patcher.test.ts
git commit -m "feat(dispatcher): patch optional accessory node in applyWorkflowPatch"
```

---

## Task 5: Dispatcher — resolve, stack, upload, and dispatch accessories in `processor.ts`

**Files:**
- Modify: `apps/dispatcher/src/job/processor.ts`
- Test: new `apps/dispatcher/test/integration/accessory-dispatch.test.ts`

**Interfaces:**
- Consumes: `stackAccessoryImages` (Task 3), `accessoryGarmentFile` on `WorkflowInputs` (Task 4), `schema.jobInputs.accessoryCatalogIds` and `schema.workflowTemplates.accessoryNodeId` (Task 1).
- Produces: nothing new consumed elsewhere — this is the dispatch-time integration point.

- [ ] **Step 1: Add `inArray` to the existing drizzle-orm import**

In `apps/dispatcher/src/job/processor.ts`, change:

```ts
import { and, eq, sql } from 'drizzle-orm';
```

to:

```ts
import { and, eq, inArray, sql } from 'drizzle-orm';
```

- [ ] **Step 2: Import `stackAccessoryImages`**

Add near the existing `import { patchWorkflow } from '../workflow/patcher.js';` line:

```ts
import { stackAccessoryImages } from '../workflow/accessory-stack.js';
import { patchWorkflow } from '../workflow/patcher.js';
```

- [ ] **Step 3: Resolve accessory catalog items and build the stacked buffer**

In `processJob` (the function containing the existing lower/shoe resolution), add this block right after the existing shoe-resolution block (right after its closing `}` at what is currently line 619, before the `// 3. Claim a worker` comment):

```ts
  // Resolve selected accessory catalog items → fetch bytes, vertically stack
  // into one composite. Unlike lower/shoe above, a missing item here fails
  // the whole job rather than silently skipping — the user explicitly chose
  // these, so dropping one silently would produce a result they didn't ask
  // for. Category sortOrder (not selection order) decides the stack order.
  let accessoryBytes: Buffer | null = null;
  const accessoryCatalogIds = inputs.accessoryCatalogIds ?? [];
  if (accessoryCatalogIds.length > 0) {
    const accessoryRows = await db
      .select({
        id: schema.catalogItems.id,
        r2Key: schema.catalogItems.r2Key,
        sortOrder: schema.catalogCategories.sortOrder,
      })
      .from(schema.catalogItems)
      .innerJoin(
        schema.catalogCategories,
        eq(schema.catalogCategories.id, schema.catalogItems.categoryId),
      )
      .where(inArray(schema.catalogItems.id, accessoryCatalogIds));

    const rowsById = new Map(accessoryRows.map((r) => [r.id, r]));
    const missing = accessoryCatalogIds.filter((id) => !rowsById.has(id));
    if (missing.length > 0) {
      throw new Error(`accessory catalog item(s) not found: ${missing.join(', ')}`);
    }

    const ordered = [...accessoryRows].sort((a, b) => a.sortOrder - b.sortOrder);
    const accessoryBuffers = await Promise.all(
      ordered.map(async (r) => Buffer.from(await r2Download(r.r2Key))),
    );
    accessoryBytes = await stackAccessoryImages(accessoryBuffers);
  }
```

**Important:** `r2Download` is defined further down in the same function (inside the `try` block starting with `// 4. Download images from R2`), as a closure over `s3`/`r2Bucket`. Move the `accessoryBytes` resolution block above to execute **after** that closure is defined — concretely, place it immediately after the `async function r2Download(...)` and `async function uploadToComfy(...)` closures are declared (right after the `uploadToComfy` function definition, before the `// 4. Upload only the images that ComfyUI actually needs.` comment), not before the `// 3. Claim a worker` comment as a literal line-by-line instruction — the important constraint is "after `r2Download` exists, before `baseTasks` is built," since the block calls `r2Download`.

- [ ] **Step 4: Upload the stacked composite and extract the resulting filename**

In the `baseTasks` construction block, add right after `if (inputs.thirdGarmentKey) baseTasks.push(uploadToComfy(inputs.thirdGarmentKey, 'third'));`:

```ts
    if (accessoryBytes) {
      baseTasks.push(
        uploadImageToComfy(w.url, w.apiKey, accessoryBytes, `accessory_${jobId}.png`, 'image/png', jobLog),
      );
    }
```

And in the `idx`-based extraction block, add right after `const thirdGarmentFile = inputs.thirdGarmentKey ? uploaded[idx++] : undefined;`:

```ts
    const accessoryGarmentFile = accessoryBytes ? uploaded[idx++] : undefined;
```

Add `accessoryGarmentFile` to the `jobLog.info({ upperGarmentFile, faceSideFile, poseFile, backgroundFile, lowerGarmentFile, shoeGarmentFile, thirdGarmentFile }, 'inputs uploaded');` call's object (append `accessoryGarmentFile,` to that list).

- [ ] **Step 5: Pass `accessoryGarmentFile` into `patchWorkflow` and the dispatch-event log**

In the `patchWorkflow({...})` call, add `accessoryGarmentFile,` right after `thirdGarmentFile,`.

In the `jobEvents` insert's `payload.inputs` object, add `accessoryGarmentFile: accessoryGarmentFile ?? null,` right after its `thirdGarmentFile,` entry, and in the nested `_r2Keys` object add `accessoryCatalogIds: accessoryCatalogIds.length > 0 ? accessoryCatalogIds : null,` right after `thirdGarmentKey: inputs.thirdGarmentKey,`.

- [ ] **Step 6: Write the integration test**

Create `apps/dispatcher/test/integration/accessory-dispatch.test.ts`. Base its harness setup (fresh Postgres DB + migrations, fresh MinIO bucket, a mock ComfyUI HTTP server, worker registry seeding) on the existing pattern in `apps/dispatcher/test/integration/merchant-widget-two-input.test.ts` — read that file first to copy its exact `beforeAll`/`afterAll` scaffolding (DB creation, MinIO bucket creation, mock ComfyUI server, worker insert) verbatim, then adapt the job setup to this shape:

```ts
// Follow merchant-widget-two-input.test.ts's harness setup exactly (fresh DB,
// fresh MinIO bucket, mock ComfyUI server, worker registry) — only the job
// setup and assertions below are accessory-specific.

it('stacks two selected accessory items and patches the single accessory node', async () => {
  // 1. Seed a workflow_templates row with accessoryNodeId set to a real
  //    LoadImage node id present in its jsonContent fixture.
  // 2. Seed two catalog_categories (type='accessory') with distinct
  //    sortOrder, and one catalog_items row in each, each with a real PNG
  //    uploaded to the test MinIO bucket under its r2Key.
  // 3. Create a job + job_inputs row with accessoryCatalogIds set to both
  //    item ids, and the other required fields (faceId, poseId,
  //    backgroundId, upperGarmentKey) pointing at minimal valid fixtures.
  // 4. Run processJob (or XADD + the stream consumer, matching how other
  //    integration tests in this directory drive a job through) and wait
  //    for it to reach a terminal status.
  // 5. Assert against the mock ComfyUI server's recorded /prompt submission:
  //    the patched node's `image` input is the uploaded accessory composite
  //    filename (not either individual item's), and exactly one
  //    accessory_*.png upload hit the mock ComfyUI /upload/image endpoint
  //    (not two).
});

it('fails the job (with refund) when a selected accessory catalog item no longer exists', async () => {
  // Same setup as above, but one of the two accessoryCatalogIds points at a
  // catalog_items row that is then deleted before dispatch. Assert the job
  // ends FAILED and the user's credit balance is refunded — accessories
  // diverge from lower/shoe's lenient "not found — skipping" behavior here.
});
```

Write out both test bodies fully, following the exact DB/MinIO/mock-ComfyUI-server setup idioms from `merchant-widget-two-input.test.ts` (same imports, same `createTestDb`/bucket helpers, same mock server library) — do not invent a different harness style.

- [ ] **Step 7: Run the integration test**

```bash
pnpm docker:up
npx vitest run --config vitest.integration.config.ts accessory-dispatch
```

(run from `apps/dispatcher`). Expected: PASS — both tests green.

- [ ] **Step 8: Run the full dispatcher suite to confirm no regressions**

```bash
pnpm --filter @aivastra/dispatcher test
pnpm --filter @aivastra/dispatcher test:integration
```

- [ ] **Step 9: Commit**

```bash
git add apps/dispatcher/src/job/processor.ts apps/dispatcher/test/integration/accessory-dispatch.test.ts
git commit -m "feat(dispatcher): resolve, stack, and dispatch selected accessory images"
```

---

## Task 6: API — `/v1/catalog/:type` accepts `accessory`

**Files:**
- Modify: `apps/api/src/modules/catalog/routes.ts`
- Test: new `apps/api/test/integration/catalog-accessory.test.ts`

**Interfaces:**
- Consumes: `schema.workflowTemplates.accessoryNodeId` (Task 1).
- Produces: `GET /v1/catalog/accessory` returns the same `{ type, tree }` shape as `lower`/`shoe` — Task 12 (studio wizard) calls this directly.

- [ ] **Step 1: Widen the type enum**

In `apps/api/src/modules/catalog/routes.ts`, change:

```ts
        params: z.object({ type: z.enum(['lower', 'shoe']) }),
```

to:

```ts
        params: z.object({ type: z.enum(['lower', 'shoe', 'accessory']) }),
```

- [ ] **Step 2: Widen the pose-gating node-field resolution**

Change the `nodeField` ternary:

```ts
        const nodeField =
          type === 'lower'
            ? schema.workflowTemplates.lowerNodeId
            : schema.workflowTemplates.shoeNodeId;
```

to:

```ts
        const nodeField =
          type === 'lower'
            ? schema.workflowTemplates.lowerNodeId
            : type === 'shoe'
              ? schema.workflowTemplates.shoeNodeId
              : schema.workflowTemplates.accessoryNodeId;
```

- [ ] **Step 3: Select `accessoryNodeId` alongside `lowerNodeId`/`shoeNodeId`**

In the `poseWorkflowRows` select, add `accessoryNodeId: schema.workflowTemplates.accessoryNodeId,` right after `shoeNodeId: schema.workflowTemplates.shoeNodeId,`.

In the `configMap` type declaration, add `accessoryNodeId: string | null` to the object type, and in its populating `configs` select + `.map(...)`, add `accessoryNodeId: schema.workflowTemplates.accessoryNodeId,` to the select and `accessoryNodeId: c.accessoryNodeId ?? null,` to the mapped object.

- [ ] **Step 4: Widen `hasSupportingPose`**

Change:

```ts
        const hasSupportingPose = poseWorkflowRows.some((pose) => {
          const cfg = configMap.get(pose.id);
          const lowerNodeId = cfg !== undefined ? cfg.lowerNodeId : pose.lowerNodeId;
          const shoeNodeId = cfg !== undefined ? cfg.shoeNodeId : pose.shoeNodeId;
          return type === 'lower' ? lowerNodeId != null : shoeNodeId != null;
        });
```

to:

```ts
        const hasSupportingPose = poseWorkflowRows.some((pose) => {
          const cfg = configMap.get(pose.id);
          const lowerNodeId = cfg !== undefined ? cfg.lowerNodeId : pose.lowerNodeId;
          const shoeNodeId = cfg !== undefined ? cfg.shoeNodeId : pose.shoeNodeId;
          const accessoryNodeId =
            cfg !== undefined ? cfg.accessoryNodeId : pose.accessoryNodeId;
          if (type === 'lower') return lowerNodeId != null;
          if (type === 'shoe') return shoeNodeId != null;
          return accessoryNodeId != null;
        });
```

- [ ] **Step 5: Write the integration test**

Create `apps/api/test/integration/catalog-accessory.test.ts`, mirroring `apps/api/test/integration/catalog.test.ts`'s exact harness (`buildTestApp`/`startContainers`/`getToken` via register+login) verbatim:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('catalog-accessory', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function getToken(email: string) {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { displayName: 'Catalog Accessory User', email, password: 'password123' },
    });
    const [user] = await app.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (!user) throw new Error('user not found');
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user.id));
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    return login.json().accessToken as string;
  }

  it('returns an empty tree when no selected pose has an accessoryNodeId mapped', async () => {
    const token = await getToken('catalog-accessory-empty@x.com');
    const unique = Date.now();
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `catalog-accessory-none-${unique}`,
        label: 'No accessory node workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
        accessoryNodeId: null,
      })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'No accessory pose',
        genderSlug: 'men',
        r2Key: `no-accessory-pose-${unique}.jpg`,
        thumbnailKey: `no-accessory-pose-${unique}-thumb.jpg`,
        workflowTemplateId: workflow.id,
      })
      .returning();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/catalog/accessory?gender=men&poseIds=${pose.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ type: 'accessory', tree: [] });
  });

  it('returns the accessory category tree when a selected pose supports it', async () => {
    const token = await getToken('catalog-accessory-present@x.com');
    const unique = Date.now() + 1;
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `catalog-accessory-yes-${unique}`,
        label: 'Accessory node workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
        accessoryNodeId: '9',
      })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Accessory pose',
        genderSlug: 'men',
        r2Key: `accessory-pose-${unique}.jpg`,
        thumbnailKey: `accessory-pose-${unique}-thumb.jpg`,
        workflowTemplateId: workflow.id,
      })
      .returning();
    const [item] = await app.db
      .insert(schema.catalogItems)
      .values({
        type: 'accessory',
        genderSlug: 'men',
        label: `Necklace ${unique}`,
        r2Key: `necklace-${unique}.jpg`,
        thumbnailKey: `necklace-${unique}-thumb.jpg`,
        isActive: true,
      })
      .returning();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/catalog/accessory?gender=men&poseIds=${pose.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json().tree)).toContain(item.label);
  });
});
```

- [ ] **Step 6: Run the test**

```bash
pnpm docker:up
npx vitest run --config vitest.integration.config.ts catalog-accessory
```

(from `apps/api`). Expected: PASS.

- [ ] **Step 7: Run the full catalog route suite to confirm lower/shoe are unaffected**

```bash
npx vitest run --config vitest.integration.config.ts catalog
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/catalog/routes.ts apps/api/test/integration/catalog-accessory.test.ts
git commit -m "feat(api): accept accessory in GET /v1/catalog/:type"
```

---

## Task 7: API — pose/look accessory role in `/v1/models/poses` and `/v1/models/catalogue-templates`

**Files:**
- Modify: `apps/api/src/modules/models/routes.ts`
- Test: `apps/api/test/integration/models-poses-garment-roles.test.ts` (existing file — extend it)

**Interfaces:**
- Consumes: `poseGarmentRoles` (Task 2), `schema.workflowTemplates.accessoryNodeId` (Task 1).
- Produces: `hasAccessory: boolean` on each item returned by `GET /v1/models/poses` and on each look returned by `GET /v1/models/catalogue-templates` — Task 12 (studio wizard) reads `p.hasAccessory` / `l.hasAccessory`.

- [ ] **Step 1: Write the failing test**

In `apps/api/test/integration/models-poses-garment-roles.test.ts`, extend the existing `workflow(...)` helper to accept an optional `accessoryNodeId`:

```ts
  async function workflow(
    slug: string,
    upperNodeIds: string[],
    lowerNodeId: string | null,
    accessoryNodeId: string | null = null,
  ) {
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug,
        label: slug,
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds,
        lowerNodeId,
        accessoryNodeId,
        garmentPhasePromptNode: '6',
      })
      .returning();
    if (!wf) throw new Error('workflow not created');
    return wf;
  }
```

Then add a new test, right after the existing `'reports hasUpper=false for a sole-lower workflow and true for a full outfit'` test:

```ts
  it('reports hasAccessory based on the resolved workflow template', async () => {
    const sfx = Date.now() + 3;
    const withAccessory = await workflow(`roles-accessory-yes-${sfx}`, ['1'], null, '9');
    const withoutAccessory = await workflow(`roles-accessory-no-${sfx}`, ['1'], null, null);
    const pWith = await pose(`roles-p-accessory-yes-${sfx}`, withAccessory.id);
    const pWithout = await pose(`roles-p-accessory-no-${sfx}`, withoutAccessory.id);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/poses?gender=boys',
      headers: { authorization: `Bearer ${await token(`roles-accessory-${sfx}@x.com`)}` },
    });
    expect(res.statusCode).toBe(200);
    const byId = new Map(
      (res.json().items as { id: string; hasAccessory: boolean }[]).map((i) => [i.id, i]),
    );
    expect(byId.get(pWith.id)).toMatchObject({ hasAccessory: true });
    expect(byId.get(pWithout.id)).toMatchObject({ hasAccessory: false });
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm docker:up
npx vitest run --config vitest.integration.config.ts models-poses-garment-roles
```

(from `apps/api`). Expected: FAIL — `hasAccessory` is `undefined` on both items.

- [ ] **Step 3: Wire `accessoryNodeId` through `GET /v1/models/poses`**

In `apps/api/src/modules/models/routes.ts`:

a. In the base `items` select (the one starting `id: schema.modelPoseAssets.id, ... lowerNodeId: schema.workflowTemplates.lowerNodeId, shoeNodeId: schema.workflowTemplates.shoeNodeId,`), add `accessoryNodeId: schema.workflowTemplates.accessoryNodeId,` right after `shoeNodeId: schema.workflowTemplates.shoeNodeId,`.

b. In the `configMap` type declaration (`Map<string, { upperNodeIds: ...; lowerNodeId: ...; shoeNodeId: ...; sizeNodeIds: ...; garmentView: ... }>`), add `accessoryNodeId: string | null` to the object type.

c. In the `configs` select (the `poseGarmentConfigs` join query), add `accessoryNodeId: schema.workflowTemplates.accessoryNodeId,` right after its own `shoeNodeId: schema.workflowTemplates.shoeNodeId,`.

d. In the `configMap` population `.map(...)`, add `accessoryNodeId: c.accessoryNodeId ?? null,` right after `shoeNodeId: c.shoeNodeId ?? null,`.

e. In the final per-item map, add `const accessoryNodeId = cfg !== undefined ? cfg.accessoryNodeId : i.accessoryNodeId;` right after the existing `const shoeNodeId = ...` line, and add `accessoryNodeId` to the `poseGarmentRoles({ upperNodeIds, lowerNodeId, shoeNodeId })` call, making it `poseGarmentRoles({ upperNodeIds, lowerNodeId, shoeNodeId, accessoryNodeId })`.

- [ ] **Step 4: Wire `accessoryNodeId` through `GET /v1/models/catalogue-templates`**

In the same file's `lookRows` select (the one joining `catalogueTemplateLooks`/`modelPoseAssets`/`workflowTemplates`), add `accessoryNodeId: schema.workflowTemplates.accessoryNodeId,` right after `shoeNodeId: schema.workflowTemplates.shoeNodeId,`. The downstream `...poseGarmentRoles(r)` call needs no change — it already spreads the whole row object, so the new field flows through automatically once selected.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run --config vitest.integration.config.ts models-poses-garment-roles
```

Expected: PASS.

- [ ] **Step 6: Run the full models route suite**

```bash
npx vitest run --config vitest.integration.config.ts models
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/models/routes.ts apps/api/test/integration/
git commit -m "feat(api): project hasAccessory on poses and catalogue-template looks"
```

---

## Task 8: API — accept and validate `accessoryCatalogIds` in job creation

**Files:**
- Modify: `apps/api/src/modules/jobs/create.ts`
- Test: new `apps/api/test/integration/jobs-accessory.test.ts`

**Interfaces:**
- Consumes: `CreateTryOnJobInputsBase.accessoryCatalogIds` (Task 2).
- Produces: `TryonPlanLook.accessoryCatalogIds: string[]`, persisted to `job_inputs.accessoryCatalogIds` — Task 5's dispatcher reads this column directly, no further API-side interface needed.

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/test/integration/jobs-accessory.test.ts`, mirroring `apps/api/test/integration/jobs-create.test.ts`'s exact harness (`buildTestApp`/`startContainers`, `registerUser`, `seedFaceAndLook`, `seedCreditPlan`, `bindUploadKey`, `grantCredits` — copy those five helpers verbatim from that file) plus one new local helper:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('jobs-accessory', () => {
  let c: Containers;
  let app: TestApp;
  let realHeadObject: typeof app.storage.headObject | undefined;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    realHeadObject = app.storage.headObject?.bind(app.storage);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  beforeEach(async () => {
    await app.redis.del('jobs:normal');
    await app.redis.del('jobs:priority');
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    if (realHeadObject) app.storage.headObject = realHeadObject;
  });

  let registerUserIpCounter = 0;
  async function registerUser(email: string) {
    const remoteAddress = `192.0.2.${++registerUserIpCounter}`;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      remoteAddress,
      payload: { displayName: 'Jobs Accessory User', email, password: 'password123' },
    });
    const [user] = await app.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (!user) throw new Error('user not found');
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user.id));
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress,
      payload: { email, password: 'password123' },
    });
    return {
      token: login.json().accessToken,
      userId: JSON.parse(atob(login.json().accessToken.split('.')[1])).sub,
    };
  }

  async function seedFaceAndLook(suffix = '') {
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: `Face${suffix}`,
        r2Key: `f${suffix}.jpg`,
        thumbnailKey: `f${suffix}.jpg`,
      })
      .returning();
    const [background] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ label: `Bg${suffix}`, r2Key: `b${suffix}.jpg`, thumbnailKey: `b${suffix}.jpg` })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({ label: `Pose${suffix}`, r2Key: `p${suffix}.jpg`, thumbnailKey: `p${suffix}.jpg` })
      .returning();
    return { faceId: face.id, backgroundId: background.id, poseId: pose.id };
  }

  async function seedCreditPlan(slug: string) {
    await app.db
      .insert(schema.creditPlans)
      .values({ slug, name: slug, credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
  }

  async function bindUploadKey(userId: string, key: string) {
    await app.redis.set(`upload:owner:${key}`, userId, 'EX', 3600);
  }

  async function grantCredits(userId: string, amount: number) {
    await app.db
      .insert(schema.userCredits)
      .values({ userId, balance: amount })
      .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: amount } });
  }

  async function seedAccessoryItem(suffix: string, opts: { categoryId?: number; isActive?: boolean } = {}) {
    const [item] = await app.db
      .insert(schema.catalogItems)
      .values({
        type: 'accessory',
        genderSlug: 'women',
        label: `Accessory ${suffix}`,
        r2Key: `accessory-${suffix}.jpg`,
        thumbnailKey: `accessory-${suffix}-thumb.jpg`,
        isActive: opts.isActive ?? true,
        categoryId: opts.categoryId ?? null,
      })
      .returning();
    return item;
  }

  it('accepts a valid accessory catalog item and stores it on job_inputs', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('accessory-ok@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('-ok');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);
    const item = await seedAccessoryItem('ok');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId,
          looks: [{ poseId, backgroundId }],
          accessoryCatalogIds: [item.id],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });

    expect(res.statusCode).toBe(201);
    const { jobIds } = res.json();
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobIds[0]));
    expect(inputs.accessoryCatalogIds).toEqual([item.id]);
  });

  it('rejects an inactive accessory catalog item', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('accessory-inactive@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('-inactive');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);
    const item = await seedAccessoryItem('inactive', { isActive: false });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId,
          looks: [{ poseId, backgroundId }],
          accessoryCatalogIds: [item.id],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects two selected items from the same accessory category', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('accessory-dup-category@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('-dup');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);
    const [accessoryType] = await app.db
      .select()
      .from(schema.catalogTypes)
      .where(eq(schema.catalogTypes.slug, 'accessory'));
    const [category] = await app.db
      .insert(schema.catalogCategories)
      .values({ typeId: accessoryType.id, slug: 'necklaces-dup-test', label: 'Necklaces' })
      .returning();
    const itemA = await seedAccessoryItem('dup-a', { categoryId: category.id });
    const itemB = await seedAccessoryItem('dup-b', { categoryId: category.id });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId,
          looks: [{ poseId, backgroundId }],
          accessoryCatalogIds: [itemA.id, itemB.id],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('does not require accessoryCatalogIds even when the resolved pose workflow has an accessoryNodeId', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('accessory-optional@x.com');
    await grantCredits(userId, 100);
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `accessory-optional-wf-${Date.now()}`,
        label: 'Accessory optional workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
        accessoryNodeId: '9',
      })
      .returning();
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({ gender: 'women', label: 'Face-opt', r2Key: 'f-opt.jpg', thumbnailKey: 'f-opt.jpg' })
      .returning();
    const [background] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ label: 'Bg-opt', r2Key: 'b-opt.jpg', thumbnailKey: 'b-opt.jpg' })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Pose-opt',
        r2Key: 'p-opt.jpg',
        thumbnailKey: 'p-opt.jpg',
        workflowTemplateId: workflow.id,
      })
      .returning();
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId: face.id,
          looks: [{ poseId: pose.id, backgroundId: background.id }],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });

    expect(res.statusCode).toBe(201);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm docker:up
npx vitest run --config vitest.integration.config.ts jobs-accessory
```

(from `apps/api`). Expected: FAIL — `accessoryCatalogIds` is accepted by Zod (Task 2 already added it) but silently ignored; job_inputs never gets the value; the duplicate-category and inactive-item tests get no rejection.

- [ ] **Step 3: Validate `accessoryCatalogIds` in `resolveTryonPlan`**

In `apps/api/src/modules/jobs/create.ts`, add `accessoryCatalogIds: rawAccessoryCatalogIds` to the destructure at the top of `resolveTryonPlan` (the block currently reading `const { faceId, garmentTypeId, catalogueTemplateMappingId, lowerCatalogId, lowerGarmentKey, lowerGarmentBackKey, thirdGarmentKey, shoeCatalogId } = body.inputs;`) — rename to avoid shadowing, e.g.:

```ts
  const {
    faceId,
    garmentTypeId,
    catalogueTemplateMappingId,
    lowerCatalogId,
    lowerGarmentKey,
    lowerGarmentBackKey,
    thirdGarmentKey,
    shoeCatalogId,
    accessoryCatalogIds: rawAccessoryCatalogIds,
  } = body.inputs;
  const accessoryCatalogIds = rawAccessoryCatalogIds ?? [];
```

Add the validation block right after the existing S6 catalog-check block (right after the `if (opts.cache) { if (lowerCatalogId ...) ... }` block that follows the `catalogChecks` array, i.e. after what is currently the code around line 584-588):

```ts
  // Accessories are validated but never made mandatory — no per-pose workflow
  // node check here, unlike lower/shoe below. The dispatcher decides at
  // dispatch time whether the resolved pose's workflow actually has an
  // accessoryNodeId to patch; a selection that doesn't apply there is simply
  // not a node-mapping collision anyone needs to catch earlier.
  if (accessoryCatalogIds.length > 0) {
    const accessoryRows = await app.db
      .select({ id: schema.catalogItems.id, categoryId: schema.catalogItems.categoryId })
      .from(schema.catalogItems)
      .where(
        and(
          inArray(schema.catalogItems.id, accessoryCatalogIds),
          eq(schema.catalogItems.type, 'accessory'),
          eq(schema.catalogItems.isActive, true),
        ),
      );
    const foundIds = new Set(accessoryRows.map((r) => r.id));
    const missingIds = accessoryCatalogIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new AppError('BAD_CATALOG', 400, 'accessory catalog item not found or inactive');
    }
    const seenCategories = new Set<number>();
    for (const row of accessoryRows) {
      if (row.categoryId == null) continue;
      if (seenCategories.has(row.categoryId)) {
        throw new AppError(
          'VALIDATION',
          400,
          'only one accessory item per category may be selected',
        );
      }
      seenCategories.add(row.categoryId);
    }
  }
```

- [ ] **Step 4: Add `accessoryCatalogIds` to `TryonPlanLook` and populate it per look**

In the `TryonPlanLook` interface, add right after `shoeCatalogId: string | null;`:

```ts
  shoeCatalogId: string | null;
  accessoryCatalogIds: string[];
```

In the `looks_` map (the block building each `TryonPlanLook` return value), add `accessoryCatalogIds,` right after `shoeCatalogId: effectiveShoeCatalogId,` — unconditionally the same array for every look, since (unlike lower/shoe) nothing here depends on that look's resolved workflow having a matching node:

```ts
      shoeCatalogId: effectiveShoeCatalogId,
      accessoryCatalogIds,
```

- [ ] **Step 5: Persist it in `createJob`'s `job_inputs` insert**

In `createJob` (the function containing `await tx.insert(schema.jobInputs).values({ jobId: job.id, upperGarmentKey: look.upperGarmentKey, ... })`), add `accessoryCatalogIds: look.accessoryCatalogIds,` right after `shoeCatalogId: look.shoeCatalogId,`.

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run --config vitest.integration.config.ts jobs-accessory
```

Expected: PASS — all 4 tests.

- [ ] **Step 7: Run the full jobs integration suite to confirm no regressions**

```bash
npx vitest run --config vitest.integration.config.ts jobs
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/jobs/create.ts apps/api/test/integration/jobs-accessory.test.ts
git commit -m "feat(api): validate and persist accessoryCatalogIds on job creation"
```

---

## Task 9: API admin — `accessoryNodeId` through workflow template CRUD

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts`
- Test: `apps/api/test/integration/admin-workflows.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `CreateWorkflowBody.accessoryNodeId`, `UpdateWorkflowBody.accessoryNodeId` (Task 2), `schema.workflowTemplates.accessoryNodeId` (Task 1).
- Produces: nothing new consumed elsewhere — this closes the admin CRUD loop so Task 10's `NodeSelect` field has somewhere to save to.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/integration/admin-workflows.test.ts`, find the existing tests covering `thirdNodeId` (create, validate-node-exists, update, detail-serialize, replace/archive) and add a parallel `accessoryNodeId` case for each, following the exact same arrange/act/assert shape as the `thirdNodeId` one it sits next to:

```ts
it('accepts accessoryNodeId on create and validates it exists in the JSON', async () => {
  // Mirror the existing thirdNodeId create test, substituting accessoryNodeId
  // and a node id actually present in the fixture jsonContent.
});

it('rejects accessoryNodeId pointing at a non-existent node', async () => {
  // Mirror the existing thirdNodeId "not found" validation test.
});

it('updates accessoryNodeId via PATCH /admin/workflows/:id', async () => {
  // Mirror the existing thirdNodeId PATCH test.
});

it('includes accessoryNodeId in the workflow detail response', async () => {
  // Mirror the existing thirdNodeId detail-serialize assertion.
});

it('carries accessoryNodeId into the archived row on replace', async () => {
  // Mirror the existing thirdNodeId replace/archive test.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm docker:up
npx vitest run --config vitest.integration.config.ts admin-workflows
```

(from `apps/api`). Expected: FAIL — `accessoryNodeId` round-trips to `null`/`undefined` everywhere.

- [ ] **Step 3: Mirror `thirdNodeId` at every site in `workflows.routes.ts`**

Run this to re-confirm every current line number before editing (line numbers shift as earlier edits land):

```bash
grep -n "thirdNodeId" apps/api/src/modules/admin/workflows.routes.ts
```

For **each** match, add an `accessoryNodeId` line immediately adjacent using the exact same shape as that occurrence:

1. The 4 `thirdNodeId: null,` literals (default-value spots in response-shaping helpers) → add `accessoryNodeId: null,` next to each.
2. The create-handler validation block:
   ```ts
   if (body.thirdNodeId) {
     validateNodeExists(body.jsonContent, body.thirdNodeId, 'third garment');
     validateNodeType(body.jsonContent, body.thirdNodeId, 'image', 'third garment');
   }
   ```
   → add directly after:
   ```ts
   if (body.accessoryNodeId) {
     validateNodeExists(body.jsonContent, body.accessoryNodeId, 'accessory');
     validateNodeType(body.jsonContent, body.accessoryNodeId, 'image', 'accessory');
   }
   ```
3. The create-handler's returned field object: `thirdNodeId: body.thirdNodeId ?? null,` → add `accessoryNodeId: body.accessoryNodeId ?? null,` right after.
4. The replace-handler's validation block (same shape as #2, operating on `json` instead of `body.jsonContent`) → same mirrored addition.
5. The PATCH handler: `if ('thirdNodeId' in body) updateValues.thirdNodeId = body.thirdNodeId ?? null;` → add `if ('accessoryNodeId' in body) updateValues.accessoryNodeId = body.accessoryNodeId ?? null;` right after.
6. The detail-serialize object: `thirdNodeId: r.thirdNodeId,` → add `accessoryNodeId: r.accessoryNodeId,` right after.
7. The replace-handler's archive-insert object: `thirdNodeId: existing.thirdNodeId,` → add `accessoryNodeId: existing.accessoryNodeId,` right after.

**Deliberately do NOT touch** `apps/api/src/modules/jobs/create.ts`'s `thirdNodeId` occurrences — those drive the `requiresThirdUpload` mandatory-upload check, which does not apply to accessories (handled already, correctly, in Task 8).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run --config vitest.integration.config.ts admin-workflows
```

Expected: PASS.

- [ ] **Step 5: Run the full admin-workflows suite and typecheck**

```bash
npx vitest run --config vitest.integration.config.ts admin-workflows
pnpm --filter @aivastra/api run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/workflows.routes.ts apps/api/test/integration/admin-workflows.test.ts
git commit -m "feat(api): mirror accessoryNodeId through workflow template admin CRUD"
```

---

## Task 10: Admin-web — Accessories catalog tab

**Files:**
- Modify: `apps/admin-web/src/pages/assets/AssetsContext.tsx`
- Modify: `apps/admin-web/src/pages/AssetsPage.tsx`
- Modify: `apps/admin-web/src/pages/assets/CatalogTab.tsx`
- Modify: `apps/admin-web/src/components/BatchCatalogUploadModal.tsx`

**Interfaces:**
- Consumes: nothing new — the existing generic `/admin/catalog/*` routes (already `typeSlug: z.string()`, verified to need no change) and `catalog_item_subcategories` mapping (already generic).
- Produces: an "Accessories" tab in the admin asset picker, functionally identical to the existing lower/shoe tabs.

No automated test exists for this app (confirmed: zero `*.test.*` files under `apps/admin-web`). Verification is manual, in-browser, per CLAUDE.md's UI-change testing guidance.

- [ ] **Step 1: Widen `AssetTab` and `VALID_TABS`**

In `apps/admin-web/src/pages/assets/AssetsContext.tsx`, find the `AssetTab` union type (containing `| 'lower' | 'shoe'`) and add `| 'accessory'` right after `| 'shoe'`. Find the `VALID_TABS` array (containing `'lower', 'shoe',`) and add `'accessory',` right after `'shoe',`.

- [ ] **Step 2: Add the tab entry and render guard**

In `apps/admin-web/src/pages/AssetsPage.tsx`, find the `TABS` array entry `{ k: 'shoe' as const, l: 'Shoes' },` and add right after it:

```ts
  { k: 'accessory' as const, l: 'Accessories' },
```

Find the render guard `{(activeTab === 'lower' || activeTab === 'shoe') && <CatalogTab />}` and widen it to:

```tsx
      {(activeTab === 'lower' || activeTab === 'shoe' || activeTab === 'accessory') && (
        <CatalogTab />
      )}
```

- [ ] **Step 3: Generalize `CatalogTab.tsx`'s type-derivation ternaries**

In `apps/admin-web/src/pages/assets/CatalogTab.tsx`, change:

```ts
  const typeSlug = activeTab === 'shoe' ? 'shoe' : 'lower';
```

to:

```ts
  const typeSlug = activeTab === 'shoe' ? 'shoe' : activeTab === 'accessory' ? 'accessory' : 'lower';
```

Change:

```ts
  const tabLabel = activeTab === 'shoe' ? 'Shoes' : 'Lower garments';
```

to:

```ts
  const tabLabel =
    activeTab === 'shoe' ? 'Shoes' : activeTab === 'accessory' ? 'Accessories' : 'Lower garments';
```

Change the "Add {...} category" button copy:

```tsx
              <Icon.Add /> Add {activeTab === 'lower' ? 'lower' : 'shoe'} category
```

to:

```tsx
              <Icon.Add /> Add{' '}
              {activeTab === 'lower' ? 'lower' : activeTab === 'shoe' ? 'shoe' : 'accessory'} category
```

And the empty-state copy using the same ternary:

```tsx
                No categories yet. Click &ldquo;Add {activeTab === 'lower' ? 'lower' : 'shoe'}{' '}
                category&rdquo; to create one.
```

to:

```tsx
                No categories yet. Click &ldquo;Add{' '}
                {activeTab === 'lower' ? 'lower' : activeTab === 'shoe' ? 'shoe' : 'accessory'}{' '}
                category&rdquo; to create one.
```

Everything else in this file (category CRUD, item upload, per-item garment-type mapping checklist, bulk mapping, delete confirmations) is already generic over `typeSlug`/`activeTab` and needs no change.

- [ ] **Step 4: Widen `BatchCatalogUploadModal`'s `typeSlug` prop type**

In `apps/admin-web/src/components/BatchCatalogUploadModal.tsx`, change:

```ts
  typeSlug: 'lower' | 'shoe';
```

to:

```ts
  typeSlug: 'lower' | 'shoe' | 'accessory';
```

Change:

```ts
  const typeLabel = typeSlug === 'lower' ? 'lower garment' : 'shoe';
```

to:

```ts
  const typeLabel =
    typeSlug === 'lower' ? 'lower garment' : typeSlug === 'shoe' ? 'shoe' : 'accessory';
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @aivastra/admin run typecheck
```

Expected: no errors.

- [ ] **Step 6: Manual verification in browser**

```bash
pnpm docker:up
pnpm --filter @aivastra/api dev &
pnpm --filter @aivastra/admin dev
```

Navigate to the admin panel's Assets page. Confirm:
- An "Accessories" tab appears alongside "Lower garments" and "Shoes".
- Clicking it shows the (initially empty) category list with an "Add accessory category" button.
- Create a category, open it, batch-upload an item, toggle its active state, map it to a garment type via the existing per-item checklist, and confirm it persists after a page reload.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/pages/assets/AssetsContext.tsx apps/admin-web/src/pages/AssetsPage.tsx apps/admin-web/src/pages/assets/CatalogTab.tsx apps/admin-web/src/components/BatchCatalogUploadModal.tsx
git commit -m "feat(admin-web): add Accessories catalog tab"
```

---

## Task 11: Admin-web — accessory node ID field in the workflow editor

**Files:**
- Modify: `apps/admin-web/src/types.ts`
- Modify: `apps/admin-web/src/pages/WorkflowsPage.tsx`
- Modify: `apps/admin-web/src/components/WorkflowUploadModal.tsx`
- Modify: `apps/admin-web/src/components/ReplaceWorkflowModal.tsx`

**Interfaces:**
- Consumes: `CreateWorkflowBody.accessoryNodeId` / `UpdateWorkflowBody.accessoryNodeId` (Task 2), the mirrored admin routes (Task 9).
- Produces: nothing new consumed elsewhere — this is the admin-facing leaf of the workflow-config chain.

No automated test exists for this app. Verification is manual, in-browser.

- [ ] **Step 1: Add the field to the shared workflow detail type**

In `apps/admin-web/src/types.ts`, find `thirdNodeId: string | null;` (in the workflow template type) and add right after:

```ts
  accessoryNodeId: string | null;
```

- [ ] **Step 2: Show it in the workflow detail view**

In `apps/admin-web/src/pages/WorkflowsPage.tsx`, find `thirdNodeId: string | null;` (the local type mirroring the detail response) and add `accessoryNodeId: string | null;` right after. Find `['Third node', viewingDetail.thirdNodeId ?? '—'],` (in the detail-rows array) and add right after:

```ts
                          ['Accessory node', viewingDetail.accessoryNodeId ?? '—'],
```

- [ ] **Step 3: Add the field to `WorkflowUploadModal`**

In `apps/admin-web/src/components/WorkflowUploadModal.tsx`:

a. Add `accessoryNodeId?: string;` to the props/detected-fields type right after `thirdNodeId?: string;`.
b. Add `const [accessoryNodeId, setAccessoryNodeId] = useState('');` right after `const [thirdNodeId, setThirdNodeId] = useState('');`.
c. In the effect that seeds state from an existing detected/loaded workflow (`setThirdNodeId(d.thirdNodeId ?? '');`), add right after: `setAccessoryNodeId(d.accessoryNodeId ?? '');`.
d. In the save-payload object (`thirdNodeId: thirdNodeId || undefined,`), add right after: `accessoryNodeId: accessoryNodeId || undefined,`.
e. In the JSX, add a new `NodeSelect` right after the existing "Third garment node (optional)" one:

```tsx
              <NodeSelect
                label="Accessory node (optional)"
                nodes={nodes.image}
                value={accessoryNodeId}
                onChange={setAccessoryNodeId}
                disabled={saving}
                hint='Title convention: "accessory". Only patched when the user selects at least one accessory; left untouched otherwise.'
              />
```

Do **not** add auto-detection heuristics for this field (no entry in whatever `parsed.detected.*` title-matching logic exists) — this is a deliberate scope limit; the admin picks it manually via the dropdown like every other optional node today requires when auto-detection doesn't recognize it.

- [ ] **Step 4: Mirror the same 5 changes in `ReplaceWorkflowModal.tsx`**

In `apps/admin-web/src/components/ReplaceWorkflowModal.tsx`, apply the identical pattern at its own four `thirdNodeId` occurrences (prop type, `useState`, the `setThirdNodeId(d.thirdNodeId ?? '')` seed, the save payload) plus the `NodeSelect` JSX, exactly mirroring Step 3 above but in this file.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @aivastra/admin run typecheck
```

- [ ] **Step 6: Manual verification in browser**

In the admin panel's Workflows page, open an existing workflow's detail view and confirm "Accessory node" shows `—`. Open the upload/replace modal for a workflow whose JSON contains a spare `LoadImage` node, pick it in the new "Accessory node (optional)" dropdown, save, and confirm the detail view now shows that node id.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/types.ts apps/admin-web/src/pages/WorkflowsPage.tsx apps/admin-web/src/components/WorkflowUploadModal.tsx apps/admin-web/src/components/ReplaceWorkflowModal.tsx
git commit -m "feat(admin-web): add accessory node id field to workflow editor"
```

---

## Task 12: Catalogues-web — accessory selection step in the studio wizard

**Files:**
- Create: `apps/catalogues-web/src/app/(app)/studio/accessory-step.tsx`
- Modify: `apps/catalogues-web/src/app/(app)/studio/page.tsx`

**Interfaces:**
- Consumes: `GET /v1/catalog/accessory` (Task 6), `hasAccessory` on poses/looks (Task 7), `accessoryCatalogIds` on `/v1/jobs/tryon` (Task 8).
- Produces: nothing new consumed elsewhere — this is the user-facing leaf of the whole feature.

No automated test exists for this app. Verification is manual, in-browser.

- [ ] **Step 1: Create the `AccessoryStep` component**

Create `apps/catalogues-web/src/app/(app)/studio/accessory-step.tsx`. This takes the same `CatalogNode` tree shape the existing `lowerCatalog`/`shoesCatalog` queries already produce (one node per category, each with its own `items`), and renders one row per category with a single-select grid, matching the visual language already used for the lower/shoe pickers elsewhere in `page.tsx` (reuse whatever the existing item-thumbnail/selectable-card component in that file is called — inspect the lower/shoe picker JSX around the `lowerNodes.flatMap(flattenNode)` usage to find its exact name and props before writing this, and use that same component here rather than inventing a new one):

```tsx
'use client';

import { C } from '@/components/tokens';

export interface AccessoryItem {
  id: string;
  label: string;
  thumbnailUrl: string;
}

export interface AccessoryCategory {
  id: number;
  label: string;
  items: AccessoryItem[];
}

interface AccessoryStepProps {
  categories: AccessoryCategory[];
  selectedIds: string[];
  onToggle: (categoryId: number, itemId: string) => void;
}

/**
 * One row per accessory category, each a single-select grid. Unlike lower/
 * shoe, every selection here is optional — clicking an already-selected item
 * clears it, and the whole step can be skipped entirely.
 */
export function AccessoryStep({ categories, selectedIds, onToggle }: AccessoryStepProps) {
  if (categories.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {categories.map((category) => (
        <div key={category.id}>
          <h4 style={{ margin: '0 0 8px', fontSize: 14, color: C.text }}>{category.label}</h4>
          <div
            style={{
              display: 'flex',
              gap: 10,
              overflowX: 'auto',
              paddingBottom: 4,
            }}
          >
            {category.items.map((item) => {
              const selected = selectedIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onToggle(category.id, item.id)}
                  style={{
                    flex: '0 0 auto',
                    width: 96,
                    border: selected ? `2px solid ${C.pink}` : `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: 4,
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.thumbnailUrl}
                    alt={item.label}
                    width={88}
                    height={88}
                    style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 6 }}
                  />
                  <span
                    style={{
                      display: 'block',
                      marginTop: 4,
                      fontSize: 11,
                      color: C.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

Before finalizing this file, open `page.tsx` around its lower/shoe picker JSX (the `lowerNodes`/`shoeNodes` rendering block) and replace the inline `<button>`/`<img>` markup above with whatever shared card component it already uses, passing equivalent props — do not ship two visually inconsistent picker styles. Adjust imports accordingly (this plan's inline version is a safe fallback if no extractable shared component exists).

- [ ] **Step 2: Add accessory state and the data fetch to `page.tsx`**

In `apps/catalogues-web/src/app/(app)/studio/page.tsx`, add state right after `const [shoeCatalogId, setShoeCatalogId] = useState('');`:

```ts
  const [accessoryCatalogIds, setAccessoryCatalogIds] = useState<string[]>([]);
```

Add the `needsAccessory` derivation right after the existing `needsShoes` block:

```ts
  const needsAccessory =
    catalogueTemplateId === 'custom'
      ? selectedPoses.some((p) => p.hasAccessory)
      : selectedLooks.some((l) => l.hasAccessory);
```

Add the data fetch right after the `shoesCatalog` `useQuery` block, reusing the exact same `poseIdsParam`/`gender`/`garmentTypeId` query-building already used for `lowerCatalog`/`shoesCatalog`:

```ts
  const { data: accessoryCatalog } = useQuery<{ type: string; tree: CatalogNode[] }>({
    queryKey: ['catalog', 'accessory', gender, garmentTypeId, effectivePoseIds.join(',')],
    queryFn: () => {
      const params = [
        poseIdsParam,
        gender ? `gender=${gender}` : '',
        garmentTypeId ? `garmentTypeId=${garmentTypeId}` : '',
      ]
        .filter(Boolean)
        .join('&');
      return api.get(`/v1/catalog/accessory?${params}`);
    },
    enabled: needsAccessory,
  });
  const accessoryCategories = useMemo(
    () =>
      (accessoryCatalog?.tree.filter((n) => n.slug !== 'other') ?? []).map((node) => ({
        id: node.id,
        label: node.label,
        items: (node.items ?? []).map((item) => ({
          id: item.id,
          label: item.label,
          thumbnailUrl: item.thumbnailUrl,
        })),
      })),
    [accessoryCatalog],
  );
  const toggleAccessory = (categoryId: number, itemId: string) => {
    setAccessoryCatalogIds((prev) => {
      const category = accessoryCategories.find((c) => c.id === categoryId);
      const otherCategoryIds = category
        ? prev.filter((id) => !category.items.some((i) => i.id === id))
        : prev;
      return prev.includes(itemId) ? otherCategoryIds : [...otherCategoryIds, itemId];
    });
  };
```

(Confirm the exact shape of `CatalogNode` and its `items` field by reading its type definition near the top of `page.tsx` before writing this — adjust field names if they differ from `label`/`thumbnailUrl`/`id` assumed above.)

- [ ] **Step 3: Render the step**

Find where the existing lower/shoe picker sections render in the JSX (conditioned on `needsLower`/`needsShoes`) and add, right after them:

```tsx
            {needsAccessory && accessoryCategories.length > 0 && (
              <AccessoryStep
                categories={accessoryCategories}
                selectedIds={accessoryCatalogIds}
                onToggle={toggleAccessory}
              />
            )}
```

Add the import near the top of the file: `import { AccessoryStep } from './accessory-step';`.

- [ ] **Step 4: Include `accessoryCatalogIds` in all three submission payload sites**

In the `step2InputsBase` object (around the line currently reading `shoeCatalogId: effectiveShoesId,` followed by `thirdGarmentKey: thirdGarmentKey || undefined,`), add right after `shoeCatalogId: effectiveShoesId,`:

```ts
        accessoryCatalogIds: accessoryCatalogIds.length > 0 ? accessoryCatalogIds : undefined,
```

In `submitAmazonPose`'s first `/v1/jobs/tryon` call's `inputs` object (the one with `poseIds: [mainPoseId]`), add the identical line right after its own `shoeCatalogId: effectiveShoesId,`.

In `submitAmazonPose`'s second `/v1/jobs/tryon` call's `inputs` object (the one with `poseIds: remainingPoseIds`), add the identical line right after its own `shoeCatalogId: effectiveShoesId,`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @aivastra/web run typecheck
```

- [ ] **Step 6: Manual verification in browser**

```bash
pnpm docker:up
pnpm --filter @aivastra/api dev &
pnpm --filter @aivastra/web dev
```

In the Studio wizard:
1. Pick a garment type/pose combination whose resolved workflow has no `accessoryNodeId` mapped (everything from before this feature) — confirm no accessory step appears and submission still works.
2. Using the admin panel from Tasks 9-10, map an `accessoryNodeId` on a workflow template actually used by a pose, create an accessory category with two items, and map one item to the relevant garment type.
3. Reload the studio wizard with that garment type/pose selected — confirm the accessory step appears, shows the category with its mapped item, selecting it highlights it, clicking again deselects it, and the step never blocks submission either way.
4. Submit a job with an accessory selected and confirm (via the admin Jobs panel's `COMFY_DISPATCH` event payload) that `accessoryGarmentFile` is set and `_r2Keys.accessoryCatalogIds` lists the selected id.
5. Submit a job with the step left untouched and confirm the job still completes normally.

- [ ] **Step 7: Commit**

```bash
git add "apps/catalogues-web/src/app/(app)/studio/accessory-step.tsx" "apps/catalogues-web/src/app/(app)/studio/page.tsx"
git commit -m "feat(catalogues-web): add optional accessory selection step to studio wizard"
```

---

## Final verification

- [ ] Run the full test suite end to end:

```bash
pnpm docker:up
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @aivastra/api test:integration
pnpm --filter @aivastra/dispatcher test:integration
```

- [ ] Re-read `docs/superpowers/specs/2026-10-01-accessory-images-design.md` end to end and confirm every section has a corresponding completed task above.
- [ ] Follow `superpowers:finishing-a-development-branch` to decide how this lands (merge, PR, or further cleanup).
