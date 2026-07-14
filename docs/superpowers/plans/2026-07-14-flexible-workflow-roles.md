# Flexible Workflow Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins upload ComfyUI workflows for lower-wear/inner-wear-only generation (no face/background/upper-garment node required) and let the job-creation API run them safely end-to-end — including regeneration, catalogue history, and results display — without ever submitting an `undefined` image to ComfyUI or silently generating a wrong-garment output.

**Architecture:** Relax `workflow_templates`/`job_inputs` nullability, then thread "which garment/face/background roles does this specific resolved workflow actually declare" through every layer that currently assumes all roles exist: admin validation (create + PATCH), admin UI, job-creation cross-validation, dispatcher patching (fail closed on any mapped-but-unfulfilled role), dispatcher upload orchestration, regeneration, and the two read-only surfaces that display a job's source garment.

**Tech Stack:** Drizzle ORM/Postgres, Fastify 5 + Zod, Vitest integration tests (real Postgres via `apps/api/test/helpers/containers.ts`), Vitest unit tests for the dispatcher patcher, React (admin-web).

**Spec:** `docs/superpowers/specs/2026-07-14-flexible-workflow-roles-design.md` (Revision 2 — read this first; it documents 8 gaps found in a prior review and why each fix below exists).

**Note:** this replaces the original version of this plan (Revision 1), which was written against Revision 1 of the spec before an independent review found 8 confirmed gaps in that design — several severe enough to block (undefined reaching ComfyUI, a missing admin UI, no fail-closed behavior). This revision implements the corrected design.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema/models.ts` | Relax `workflow_templates.faceNodeId`/`bgNodeId`/`facePhasePromptNode` to nullable |
| `packages/db/src/schema/jobs.ts` | Relax `job_inputs.upperGarmentKey` to nullable |
| `packages/db/src/migrations/01NN_*.sql` (generated) | Migration for both column relaxations |
| `packages/types/src/admin.ts` | `CreateWorkflowBody`'s floor validation |
| `packages/types/src/jobs.ts` | `CreateTryOnJobInputs.upperGarmentKey` optional, drop the redundant refine |
| `apps/api/src/modules/admin/workflows.routes.ts` | POST conditional validation; PATCH merge-then-validate |
| `apps/api/test/integration/admin-workflows.test.ts` (new) | Covers POST/PATCH floor + merge-validation |
| `apps/admin-web/src/components/WorkflowUploadModal.tsx` | Client-side validation matches the new floor |
| `apps/api/src/modules/jobs/create.ts` | Per-pose `upperNodeIds` cross-validation |
| `apps/api/test/integration/jobs-create-looks.test.ts` | Covers the new upper-required-when-mapped case |
| `apps/dispatcher/src/workflow/patcher.ts` | Fail closed (throw) on any mapped-but-unfulfilled role, for all of face/bg/upper/lower/shoe |
| `apps/dispatcher/src/workflow/patcher.test.ts` | Covers the new throw behavior |
| `apps/dispatcher/src/job/processor.ts` | Conditional ComfyUI uploads; catch the new throw and route to `markFailed` |
| `apps/api/src/modules/jobs/regenerate.ts` | Drop the `upperGarmentKey` hard requirement |
| `apps/api/test/integration/regenerate.test.ts` | Covers regenerating a lower-only job |
| `apps/api/src/modules/jobs/routes.ts` | `/v1/catalogues/:id` resolves hero garment from whichever source is present |
| `apps/api/src/modules/results/routes.ts` | Ops dashboard select includes `lowerGarmentKey` |
| `docs/progress.md` | Log entry |

---

### Task 1: Schema — nullable columns + migration

**Files:**
- Modify: `packages/db/src/schema/models.ts:88-106` (`workflowTemplates` table)
- Modify: `packages/db/src/schema/jobs.ts:56` (`jobInputs` table)
- Create: `packages/db/src/migrations/01NN_<generated>.sql`

- [ ] **Step 1: Relax the three `workflow_templates` columns**

In `packages/db/src/schema/models.ts`, change:

```ts
  faceNodeId: text('face_node_id').notNull(),
```
to
```ts
  faceNodeId: text('face_node_id'),
```

Change (same table, a couple lines down):
```ts
  bgNodeId: text('bg_node_id').notNull(),
```
to
```ts
  bgNodeId: text('bg_node_id'),
```

Change:
```ts
  facePhasePromptNode: text('face_phase_prompt_node').notNull(),
```
to
```ts
  facePhasePromptNode: text('face_phase_prompt_node'),
```

Leave `poseNodeId`, `garmentPhasePromptNode`, and `upperNodeIds` (the array column itself, not its validation) untouched — they stay `.notNull()`.

- [ ] **Step 2: Relax `job_inputs.upper_garment_key`**

In `packages/db/src/schema/jobs.ts`, change:
```ts
  upperGarmentKey: text('upper_garment_key').notNull(),
```
to
```ts
  upperGarmentKey: text('upper_garment_key'),
```

- [ ] **Step 3: Generate the migration**

Ensure Postgres is up (`pnpm docker:up` if not already running), then run:

```bash
pnpm db:generate
```

Expected: a new file `packages/db/src/migrations/01NN_<adjective>_<name>.sql` (next index after 0108 at the time this plan was written — check `packages/db/src/migrations/meta/_journal.json`'s last `idx` to confirm) containing exactly four `ALTER TABLE ... DROP NOT NULL` statements: `workflow_templates.face_node_id`, `workflow_templates.bg_node_id`, `workflow_templates.face_phase_prompt_node`, `job_inputs.upper_garment_key`. If anything else appears, stop and check for unrelated uncommitted schema changes first.

- [ ] **Step 4: Apply the migration locally**

```bash
pnpm db:migrate
```

Expected: applies with no errors.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @aivastra/db typecheck
git add packages/db/src/schema/models.ts packages/db/src/schema/jobs.ts packages/db/src/migrations/01NN_*.sql packages/db/src/migrations/meta/
git commit -m "feat(db): relax workflow_templates and job_inputs for lower/inner-only workflows"
```

---

### Task 2: Zod validation — `packages/types`

**Files:**
- Modify: `packages/types/src/admin.ts:158-212` (`CreateWorkflowBody`)
- Modify: `packages/types/src/jobs.ts:36-63` (`CreateTryOnJobInputs`)

- [ ] **Step 1: Relax `CreateWorkflowBody`'s floor**

In `packages/types/src/admin.ts`, replace the `superRefine` (lines 191-212):

```ts
  .superRefine((val, ctx) => {
    const required =
      val.workflowType === 'regular'
        ? ([
            'faceNodeId',
            'poseNodeId',
            'bgNodeId',
            'upperNodeIds',
            'facePhasePromptNode',
            'garmentPhasePromptNode',
          ] as const)
        : (['facePhasePromptNode', 'garmentPhasePromptNode'] as const);
    for (const field of required) {
      if (!val[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required for ${val.workflowType} workflows`,
        });
      }
    }
  });
```

with:

```ts
  .superRefine((val, ctx) => {
    if (val.workflowType === 'tryon') {
      for (const field of ['facePhasePromptNode', 'garmentPhasePromptNode'] as const) {
        if (!val[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required for tryon workflows`,
          });
        }
      }
      return;
    }
    // Regular workflow floor: pose + garment-phase prompt always required, plus
    // at least one garment slot (upper and/or lower). Face is fully optional, but
    // if present it must carry its own prompt node.
    if (!val.poseNodeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['poseNodeId'],
        message: 'poseNodeId is required for regular workflows',
      });
    }
    if (!val.garmentPhasePromptNode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['garmentPhasePromptNode'],
        message: 'garmentPhasePromptNode is required for regular workflows',
      });
    }
    const hasUpper = (val.upperNodeIds?.length ?? 0) > 0;
    const hasLower = !!val.lowerNodeId;
    if (!hasUpper && !hasLower) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['upperNodeIds'],
        message: 'at least one garment role (upperNodeIds or lowerNodeId) is required',
      });
    }
    if (val.faceNodeId && !val.facePhasePromptNode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['facePhasePromptNode'],
        message: 'facePhasePromptNode is required when faceNodeId is set',
      });
    }
  });
```

Also change `upperNodeIds` from `.min(1)` to no minimum, since an empty array is now a valid "no upper role" signal:

```ts
    upperNodeIds: z.array(z.string().min(1)).max(8).optional(),
```

- [ ] **Step 2: Relax `CreateTryOnJobInputs`**

In `packages/types/src/jobs.ts`, change:

```ts
export const CreateTryOnJobInputs = z
  .object({
    upperGarmentKey: z.string().regex(INPUT_GARMENT_KEY),
```

to:

```ts
export const CreateTryOnJobInputs = z
  .object({
    upperGarmentKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
```

Do **not** add a "at least one of upperGarmentKey/lowerGarmentKey" refine here — per the spec, this request-level check is insufficient (it doesn't know which workflow the selected pose resolves to) and is superseded entirely by Task 6's per-pose check in `create.ts`, which runs against the actually-resolved workflow. The existing `.refine((d) => Boolean(d.backgroundId && d.poseIds) !== Boolean(d.looks), ...)` at the bottom of the object is unrelated and stays unchanged.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @aivastra/types typecheck
git add packages/types/src/admin.ts packages/types/src/jobs.ts
git commit -m "feat(types): relax workflow and job-creation validation for optional garment roles"
```

---

### Task 3: Admin workflow POST route — conditional validation

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts:277-`(end of the regular-workflow insert block)

- [ ] **Step 1: Replace the non-null-asserted block**

Replace (currently lines 277-309):

```ts
      // Regular workflow — full node validation.
      // CreateWorkflowBody.superRefine() requires these fields for workflowType 'regular',
      // but the zod type itself keeps them optional — safe to assert here.
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const faceNodeId = body.faceNodeId!;
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const poseNodeId = body.poseNodeId!;
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const bgNodeId = body.bgNodeId!;
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const upperNodeIds = body.upperNodeIds!;
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const facePhasePromptNode = body.facePhasePromptNode!;
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const garmentPhasePromptNode = body.garmentPhasePromptNode!;

      validateNodeExists(body.jsonContent, faceNodeId, 'face');
      validateNodeExists(body.jsonContent, poseNodeId, 'pose');
      validateNodeExists(body.jsonContent, bgNodeId, 'background');
      for (const uid of upperNodeIds) {
        validateNodeExists(body.jsonContent, uid, 'upper garment');
      }
      if (body.lowerNodeId) validateNodeExists(body.jsonContent, body.lowerNodeId, 'lower garment');
      if (body.shoeNodeId) validateNodeExists(body.jsonContent, body.shoeNodeId, 'shoes');
      for (const uid of body.sizeNodeIds ?? []) {
        validateNodeExists(body.jsonContent, uid, 'size');
      }
      validateNodeExists(body.jsonContent, facePhasePromptNode, 'negative prompt');
      validateNodeExists(body.jsonContent, garmentPhasePromptNode, 'positive prompt');

      validateNodeType(body.jsonContent, faceNodeId, 'image', 'face');
      validateNodeType(body.jsonContent, poseNodeId, 'image', 'pose');
      validateNodeType(body.jsonContent, bgNodeId, 'image', 'background');
```

with:

```ts
      // Regular workflow — full node validation.
      // CreateWorkflowBody.superRefine() guarantees poseNodeId, garmentPhasePromptNode,
      // at least one garment slot, and facePhasePromptNode-if-faceNodeId. Everything
      // else (faceNodeId, bgNodeId, upperNodeIds) is genuinely optional now.
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const poseNodeId = body.poseNodeId!;
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const garmentPhasePromptNode = body.garmentPhasePromptNode!;
      const upperNodeIds = body.upperNodeIds ?? [];

      validateNodeExists(body.jsonContent, poseNodeId, 'pose');
      validateNodeType(body.jsonContent, poseNodeId, 'image', 'pose');
      if (body.faceNodeId) {
        validateNodeExists(body.jsonContent, body.faceNodeId, 'face');
        validateNodeType(body.jsonContent, body.faceNodeId, 'image', 'face');
      }
      if (body.bgNodeId) {
        validateNodeExists(body.jsonContent, body.bgNodeId, 'background');
        validateNodeType(body.jsonContent, body.bgNodeId, 'image', 'background');
      }
      for (const uid of upperNodeIds) {
        validateNodeExists(body.jsonContent, uid, 'upper garment');
      }
      if (body.lowerNodeId) validateNodeExists(body.jsonContent, body.lowerNodeId, 'lower garment');
      if (body.shoeNodeId) validateNodeExists(body.jsonContent, body.shoeNodeId, 'shoes');
      for (const uid of body.sizeNodeIds ?? []) {
        validateNodeExists(body.jsonContent, uid, 'size');
      }
      validateNodeExists(body.jsonContent, garmentPhasePromptNode, 'positive prompt');
      validateNodeType(body.jsonContent, garmentPhasePromptNode, 'prompt', 'positive prompt');
      if (body.facePhasePromptNode) {
        validateNodeExists(body.jsonContent, body.facePhasePromptNode, 'negative prompt');
        validateNodeType(body.jsonContent, body.facePhasePromptNode, 'prompt', 'negative prompt');
      }
```

Read the lines immediately after this block (validation continues past line 309 in the current file — there was more `validateNodeType` and the upper-node-type-check loop, plus the final `.insert(schema.workflowTemplates).values({...})` call) and:
1. Remove any now-duplicate `validateNodeType(body.jsonContent, faceNodeId, ...)` / `bgNodeId` calls that referenced the old asserted `faceNodeId`/`bgNodeId` consts (they're replaced by the conditional blocks above).
2. In the `.values({...})` insert call, change `faceNodeId,` to `faceNodeId: body.faceNodeId ?? null,`, change `bgNodeId,` to `bgNodeId: body.bgNodeId ?? null,`, change `upperNodeIds,` to `upperNodeIds,` (already defaults to `[]` from the const above, keep as-is), and change `facePhasePromptNode,` to `facePhasePromptNode: body.facePhasePromptNode ?? null,`.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @aivastra/api typecheck
```

Expected: no errors. If `validateNodeType`'s signature requires a non-null string and TypeScript complains about `body.faceNodeId` inside the `if (body.faceNodeId)` block, that's a narrowing issue — TypeScript should narrow `string | undefined` to `string` inside the truthy check; if not, assign to a local `const faceNodeId = body.faceNodeId;` first inside the block.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/admin/workflows.routes.ts
git commit -m "feat(admin): allow creating regular workflows with no face/background/upper role"
```

---

### Task 4: Admin workflow PATCH route — merge-then-validate

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts` (PATCH handler, starts at line 396)
- Test: `apps/api/test/integration/admin-workflows.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

No integration test file for `/admin/workflows` currently exists. Create `apps/api/test/integration/admin-workflows.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin workflows — floor validation', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  const jsonContent = {
    pose_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'pose' } },
    lower_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'lower' } },
    positive_node: {
      inputs: { prompt: 'default' },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'positive_prompt' },
    },
  };

  it('creates a lower-only regular workflow with no face/background/upper node', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `lower_only_${Date.now()}`,
        label: 'Lower only',
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.faceNodeId ?? null).toBeNull();
    expect(body.upperNodeIds).toEqual([]);
  });

  it('rejects a regular workflow with neither upperNodeIds nor lowerNodeId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `no_garment_role_${Date.now()}`,
        label: 'No garment role',
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects faceNodeId set without facePhasePromptNode', async () => {
    const withFace = {
      ...jsonContent,
      face_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'face' } },
    };
    const response = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `face_no_prompt_${Date.now()}`,
        label: 'Face no prompt',
        jsonContent: withFace,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
        faceNodeId: 'face_node',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('PATCH rejects clearing the last garment role on an existing workflow', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `patch_target_${Date.now()}`,
        label: 'Patch target',
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    const id = createRes.json().id as string;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${id}`,
      headers,
      payload: { lowerNodeId: null },
    });
    expect(patchRes.statusCode).toBe(400);

    const [row] = await app.db
      .select({ lowerNodeId: schema.workflowTemplates.lowerNodeId })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    expect(row?.lowerNodeId).toBe('lower_node');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts test/integration/admin-workflows.test.ts --reporter=verbose
```

Expected: the first three tests pass already once Task 2/3 land (they test the create-side floor, already implemented by then) — the 4th test (`PATCH rejects clearing the last garment role`) FAILS, since the PATCH handler has no merge-validation yet (it will return 200 and actually clear `lowerNodeId` to null).

- [ ] **Step 3: Implement merge-then-validate in PATCH**

In `apps/api/src/modules/admin/workflows.routes.ts`, inside the PATCH handler, after the existing per-field `if (body.xxx) validateNodeExists(...)` block (ends around line 468) and before the `updateValues` construction, add:

```ts
      // Merge-then-validate: individual fields can each be valid in isolation while
      // the resulting final row breaks the create-time floor (e.g. clearing the last
      // garment role, or clearing facePhasePromptNode while faceNodeId survives).
      const mergedUpperNodeIds = body.upperNodeIds ?? existing.upperNodeIds;
      const mergedLowerNodeId =
        body.lowerNodeId !== undefined ? body.lowerNodeId : existing.lowerNodeId;
      const mergedFaceNodeId =
        body.faceNodeId !== undefined ? body.faceNodeId : existing.faceNodeId;
      const mergedFacePhasePromptNode =
        body.facePhasePromptNode !== undefined
          ? body.facePhasePromptNode
          : existing.facePhasePromptNode;

      if (existing.workflowType === 'regular') {
        const hasUpper = mergedUpperNodeIds.length > 0;
        const hasLower = !!mergedLowerNodeId;
        if (!hasUpper && !hasLower) {
          throw new AppError(
            'VALIDATION',
            400,
            'cannot clear the last garment role — at least one of upperNodeIds/lowerNodeId must remain set',
          );
        }
        if (mergedFaceNodeId && !mergedFacePhasePromptNode) {
          throw new AppError(
            'VALIDATION',
            400,
            'cannot leave faceNodeId set without facePhasePromptNode',
          );
        }
      }
```

Place this after `const json = existing.jsonContent as Record<string, unknown>;` and the per-field validation block, using `existing` (already fetched earlier in the handler) as the merge base.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts test/integration/admin-workflows.test.ts --reporter=verbose
```

Expected: all 4 tests pass.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @aivastra/api typecheck
git add apps/api/src/modules/admin/workflows.routes.ts apps/api/test/integration/admin-workflows.test.ts
git commit -m "feat(admin): validate the merged workflow shape on PATCH, not just the patch body"
```

---

### Task 5: Admin UI — relax `WorkflowUploadModal.tsx`

**Files:**
- Modify: `apps/admin-web/src/components/WorkflowUploadModal.tsx:246-259` (`handleSubmit` validation), `:280-300` (payload construction)

- [ ] **Step 1: Relax client-side validation**

Replace (currently lines 246-259):

```ts
    } else {
      if (!parsed) return;
      if (!faceNodeId || !poseNodeId || !bgNodeId || !positivePromptNode || !negativePromptNode) {
        setError(
          'Face, pose, background, positive prompt, and negative prompt nodes are all required',
        );
        return;
      }
      const validUpperIds = upperNodeIds.filter(Boolean);
      if (validUpperIds.length === 0) {
        setError('At least one upper garment node is required');
        return;
      }
    }
```

with:

```ts
    } else {
      if (!parsed) return;
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
        setError(
          'At least one garment role is required — set an upper garment node or a lower garment node',
        );
        return;
      }
    }
```

- [ ] **Step 2: Don't send empty-string face/background node IDs**

In the payload construction for the regular-workflow branch (currently around lines 280-300), change:

```ts
          faceNodeId,
          poseNodeId,
          bgNodeId,
```

to:

```ts
          faceNodeId: faceNodeId || undefined,
          poseNodeId,
          bgNodeId: bgNodeId || undefined,
```

(matching the existing `lowerNodeId: lowerNodeId || undefined` convention two lines below it in the same object).

- [ ] **Step 3: Add a discoverability hint**

Near the node-mapping section of the form (find the `NodeSelect` for `faceNodeId` — search for `label="Face"` or similar in the render body below line 300), add a short helper line directly under it. If the existing markup renders `NodeSelect` components in a list/grid, insert a `<p>` or `<span>` immediately after the face `NodeSelect` with:

```tsx
<span style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginTop: 4 }}>
  Leave face and background blank for a lower/inner-wear-only workflow — at least one of
  upper or lower garment node is still required.
</span>
```

- [ ] **Step 4: Typecheck, lint, and manual check**

```bash
cd apps/admin-web && pnpm exec tsc --noEmit
pnpm --filter @aivastra/admin lint
pnpm --filter @aivastra/admin dev
```

Navigate to Assets → Workflows → New workflow, parse a JSON file with no face/background nodes and a `lower_garment`-titled node, and confirm the form now lets you save without a face/background/upper mapping (as long as pose + positive prompt + lowerNodeId are set).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/components/WorkflowUploadModal.tsx
git commit -m "feat(admin-web): allow uploading lower/inner-only workflows through the create form"
```

---

### Task 6: Job creation — per-pose garment-slot cross-validation

**Files:**
- Modify: `apps/api/src/modules/jobs/create.ts:258-267` (`mappingPoseWorkflows` select), `:319-331` (its return shape), `:338-390` (`poseWorkflowRows` select + fallback map), `:395-402` (validation loop)
- Test: `apps/api/test/integration/jobs-create-looks.test.ts`

- [ ] **Step 1: Write the failing test**

Add these tests to `apps/api/test/integration/jobs-create-looks.test.ts` (reuse this file's existing `seedFaceAndTwoBackgrounds`/`seedTwoPoses`/`registerUser`/`grantCredits`/`bindUploadKey`/`seedCreditPlan` helpers as-is):

```ts
  it('rejects a lower-only submission against a pose whose workflow requires an upper garment', async () => {
    await seedCreditPlan('free', false);
    const { token, userId } = await registerUser('looks-upper-required@x.com');
    await grantCredits(userId, 100);
    const { faceId, bgAId } = await seedFaceAndTwoBackgrounds();
    const { poseAId } = await seedTwoPoses();
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: `upper-required-${poseAId}`, label: 'Upper required' })
      .returning();
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `upper-required-workflow-${poseAId}`,
        label: 'Upper required workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
      })
      .returning();
    await app.db
      .update(schema.modelPoseAssets)
      .set({ workflowTemplateId: workflow.id })
      .where(eq(schema.modelPoseAssets.id, poseAId));

    const garmentKey = `inputs/${userId}/lower-only.jpg`;
    await bindUploadKey(userId, garmentKey);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          lowerGarmentKey: garmentKey,
          faceId,
          garmentTypeId: garmentType.id,
          looks: [{ poseId: poseAId, backgroundId: bgAId }],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('accepts a lower-only submission against a lower-primary workflow with no upper role', async () => {
    await seedCreditPlan('free', false);
    const { token, userId } = await registerUser('looks-lower-primary@x.com');
    await grantCredits(userId, 100);
    const { faceId, bgAId } = await seedFaceAndTwoBackgrounds();
    const { poseAId } = await seedTwoPoses();
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: `lower-primary-${poseAId}`, label: 'Lower primary' })
      .returning();
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `lower-primary-workflow-${poseAId}`,
        label: 'Lower primary workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: [],
        lowerNodeId: '7',
        garmentPhasePromptNode: '6',
      })
      .returning();
    await app.db
      .update(schema.modelPoseAssets)
      .set({ workflowTemplateId: workflow.id })
      .where(eq(schema.modelPoseAssets.id, poseAId));

    const garmentKey = `inputs/${userId}/lower-primary.jpg`;
    await bindUploadKey(userId, garmentKey);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          lowerGarmentKey: garmentKey,
          faceId,
          garmentTypeId: garmentType.id,
          looks: [{ poseId: poseAId, backgroundId: bgAId }],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });
    expect(response.statusCode).toBe(201);
  });
```

If `seedFaceAndTwoBackgrounds`/`seedTwoPoses` are defined with different names in the current file, use the file's actual existing helper names instead — check the top of `jobs-create-looks.test.ts` before writing these.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts test/integration/jobs-create-looks.test.ts --reporter=verbose
```

Expected: the first new test (`rejects a lower-only submission...`) FAILS — currently nothing validates `upperNodeIds`, so the request succeeds with 201 instead of the expected 400. The second test should already pass once Task 2 lands (upperGarmentKey is optional), since nothing currently blocks a lower-primary submission either — but confirm it passes for the right reason after Step 3, not by accident.

- [ ] **Step 3: Implement — carry `upperNodeIds` through both `poseWorkflows` branches**

In `apps/api/src/modules/jobs/create.ts`, add `upperNodeIds` to the `mappingPoseWorkflows` select (inside the block starting at line 248):

```ts
        const rows = await app.db
          .select({
            poseId: schema.catalogueTemplateLooks.poseAssetId,
            backgroundId: schema.catalogueTemplateLooks.backgroundId,
            workflowTemplateId: schema.catalogueTemplatePoseWorkflows.workflowTemplateId,
            promptGarmentPhase: schema.catalogueTemplatePoseWorkflows.promptGarmentPhase,
            upperNodeIds: schema.workflowTemplates.upperNodeIds,
            lowerNodeId: schema.workflowTemplates.lowerNodeId,
            shoeNodeId: schema.workflowTemplates.shoeNodeId,
            sizeNodeIds: schema.workflowTemplates.sizeNodeIds,
          })
```

and carry it into the returned per-pose objects:

```ts
          return {
            poseId,
            workflowTemplateId: row.workflowTemplateId,
            promptGarmentPhase: row.promptGarmentPhase,
            upperNodeIds: row.upperNodeIds,
            lowerNodeId: row.lowerNodeId,
            shoeNodeId: row.shoeNodeId,
            sizeNodeIds: row.sizeNodeIds,
          };
```

For the non-mapped `poseWorkflowRows` fallback, add `defaultUpperNodeIds`/`overrideUpperNodeIds` to that select (mirroring the existing `defaultLowerNodeId`/`overrideLowerNodeId` pattern):

```ts
  const poseWorkflowRows = await app.db
    .select({
      poseId: schema.modelPoseAssets.id,
      defaultWorkflowTemplateId: schema.modelPoseAssets.workflowTemplateId,
      defaultUpperNodeIds: defaultWorkflow.upperNodeIds,
      defaultLowerNodeId: defaultWorkflow.lowerNodeId,
      defaultShoeNodeId: defaultWorkflow.shoeNodeId,
      defaultSizeNodeIds: defaultWorkflow.sizeNodeIds,
      configWorkflowTemplateId: schema.poseGarmentConfigs.workflowTemplateId,
      configIsActive: schema.poseGarmentConfigs.isActive,
      overrideUpperNodeIds: overrideWorkflow.upperNodeIds,
      overrideLowerNodeId: overrideWorkflow.lowerNodeId,
      overrideShoeNodeId: overrideWorkflow.shoeNodeId,
      overrideSizeNodeIds: overrideWorkflow.sizeNodeIds,
    })
```

and in the fallback `.map(...)` (the `poseWorkflows = mappingPoseWorkflows ?? poseWorkflowRows.map(...)` block):

```ts
  const poseWorkflows =
    mappingPoseWorkflows ??
    poseWorkflowRows.map((r) => ({
      poseId: r.poseId,
      workflowTemplateId: r.configWorkflowTemplateId ?? r.defaultWorkflowTemplateId,
      promptGarmentPhase: null,
      upperNodeIds:
        r.configWorkflowTemplateId != null ? (r.overrideUpperNodeIds ?? []) : (r.defaultUpperNodeIds ?? []),
      lowerNodeId:
        r.configWorkflowTemplateId != null ? r.overrideLowerNodeId : r.defaultLowerNodeId,
      shoeNodeId: r.configWorkflowTemplateId != null ? r.overrideShoeNodeId : r.defaultShoeNodeId,
      sizeNodeIds:
        r.configWorkflowTemplateId != null ? r.overrideSizeNodeIds : r.defaultSizeNodeIds,
    }));
```

- [ ] **Step 4: Implement — the cross-validation check itself**

Replace the validation loop (currently lines 395-402):

```ts
  for (const pw of poseWorkflows) {
    if (pw.lowerNodeId && !lowerCatalogId && !lowerGarmentKey) {
      throw new AppError('VALIDATION', 400, 'lower garment required for this pose');
    }
    if (pw.shoeNodeId && !shoeCatalogId) {
      throw new AppError('VALIDATION', 400, 'shoe catalog item required for this pose');
    }
  }
```

with:

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

This runs before credit deduction, same as the existing lower/shoe checks, and correctly handles a workflow with both `upperNodeIds` non-empty and `lowerNodeId` set (Decision 1's "mixed" case) — both branches fire independently against the same `pw`.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts test/integration/jobs-create-looks.test.ts --reporter=verbose
```

Expected: all tests in the file pass, including both new ones.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm --filter @aivastra/api typecheck
git add apps/api/src/modules/jobs/create.ts apps/api/test/integration/jobs-create-looks.test.ts
git commit -m "feat(jobs): reject a job when the resolved workflow's upper role has no matching upload"
```

---

### Task 7: Dispatcher patcher — fail closed on any mapped-but-unfulfilled role

**Files:**
- Modify: `apps/dispatcher/src/workflow/patcher.ts:74-126` (`applyWorkflowPatch`), `:49-64` (`WorkflowInputs`)
- Test: `apps/dispatcher/src/workflow/patcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/dispatcher/src/workflow/patcher.test.ts`, reusing the existing `makeWorkflow`/`makeTemplate`/`BASE_INPUTS` fixtures:

```ts
describe('fail-closed on missing garment input for a mapped role', () => {
  it('throws when upperNodeIds is mapped but upperGarmentFile is missing', () => {
    const wf = makeWorkflow();
    const { upperGarmentFile, ...inputsWithoutUpper } = BASE_INPUTS;
    expect(() =>
      applyWorkflowPatch(wf, makeTemplate({ faceNodeId: null, bgNodeId: null }), inputsWithoutUpper),
    ).toThrow(/upper/i);
  });

  it('throws when lowerNodeId is mapped but lowerGarmentFile is missing (no fallback to upper)', () => {
    const wf = makeWorkflow();
    expect(() =>
      applyWorkflowPatch(wf, makeTemplate({ lowerNodeId: '1331' }), BASE_INPUTS),
    ).toThrow(/lower/i);
  });

  it('throws when faceNodeId is mapped but faceSideFile is missing', () => {
    const wf = makeWorkflow();
    const { faceSideFile, ...inputsWithoutFace } = BASE_INPUTS;
    expect(() =>
      applyWorkflowPatch(wf, makeTemplate({ bgNodeId: null }), inputsWithoutFace),
    ).toThrow(/face/i);
  });

  it('does not throw for an unmapped role even when its input is absent', () => {
    const wf = makeWorkflow();
    const { upperGarmentFile, ...inputsWithoutUpper } = BASE_INPUTS;
    expect(() =>
      applyWorkflowPatch(
        wf,
        makeTemplate({ faceNodeId: null, bgNodeId: null, upperNodeIds: [], lowerNodeId: '1331' }),
        { ...inputsWithoutUpper, lowerGarmentFile: 'lower_abc123.jpg' },
      ),
    ).not.toThrow();
  });

  it('patches the lower node with its own file, not a fallback, when both are provided', () => {
    const wf = makeWorkflow();
    applyWorkflowPatch(wf, makeTemplate(), { ...BASE_INPUTS, lowerGarmentFile: 'lower_xyz.jpg' });
    expect(wf['1331']?.inputs.image).toBe('lower_xyz.jpg');
  });
});
```

Note: `makeTemplate({ faceNodeId: null, ... })` requires `WorkflowTemplate['faceNodeId']` to accept `null` — this is already true once Task 1's schema change lands, since `$inferSelect` for the Drizzle table reflects the nullable column.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @aivastra/dispatcher test
```

Expected: the throw-based tests FAIL (current code either silently skips or falls back to the upper garment instead of throwing); the "does not throw" and "patches with its own file" tests should already pass.

- [ ] **Step 3: Implement**

Replace `applyWorkflowPatch`'s body (currently lines 80-126) — the required-node section, upper-garment loop, and lower/shoe fallback blocks — with:

```ts
  // Required image nodes — every mapped role must have a matching input, or fail
  // closed rather than submit a stale/placeholder image from the template JSON.
  if (tmpl.faceNodeId) {
    if (!inputs.faceSideFile) {
      throw new Error(`Workflow "${tmpl.slug}" maps a face node but no face image was provided`);
    }
    requireNode(workflow, tmpl.faceNodeId, 'face').inputs.image = inputs.faceSideFile;
  }
  requireNode(workflow, tmpl.poseNodeId, 'pose').inputs.image = inputs.poseFile;
  if (tmpl.bgNodeId) {
    if (!inputs.backgroundFile) {
      throw new Error(
        `Workflow "${tmpl.slug}" maps a background node but no background image was provided`,
      );
    }
    requireNode(workflow, tmpl.bgNodeId, 'bg').inputs.image = inputs.backgroundFile;
  }

  // Upper garment — patch all mapped nodes with the same file
  if (tmpl.upperNodeIds.length > 0) {
    if (!inputs.upperGarmentFile) {
      throw new Error(
        `Workflow "${tmpl.slug}" maps ${tmpl.upperNodeIds.length} upper garment node(s) but no upper garment image was provided`,
      );
    }
    for (const uid of tmpl.upperNodeIds) {
      requireNode(workflow, uid, 'upper garment').inputs.image = inputs.upperGarmentFile;
    }
  }

  // Lower garment — no fallback to the upper garment. A mapped-but-unfulfilled
  // role fails the job rather than submit the wrong garment for a customer charge.
  if (tmpl.lowerNodeId) {
    if (!inputs.lowerGarmentFile) {
      throw new Error(
        `Workflow "${tmpl.slug}" maps a lower garment node but no lower garment image was provided`,
      );
    }
    requireNode(workflow, tmpl.lowerNodeId, 'lower garment').inputs.image = inputs.lowerGarmentFile;
  } else if (inputs.lowerGarmentFile) {
    log?.warn(
      `patchWorkflow: lower garment provided but workflow "${tmpl.slug}" has no lower_node_id — skipping`,
    );
  }

  // Shoe — same fail-closed pattern as lower garment
  if (tmpl.shoeNodeId) {
    if (!inputs.shoeGarmentFile) {
      throw new Error(
        `Workflow "${tmpl.slug}" maps a shoe node but no shoe image was provided`,
      );
    }
    requireNode(workflow, tmpl.shoeNodeId, 'shoes').inputs.image = inputs.shoeGarmentFile;
  } else if (inputs.shoeGarmentFile) {
    log?.warn(
      `patchWorkflow: shoe garment provided but workflow "${tmpl.slug}" has no shoe_node_id — skipping`,
    );
  }
```

Note `requireNode` already throws if the node ID isn't present in the JSON at all (pre-existing behavior, unchanged) — the new checks above throw for the *different* case of "node exists in the JSON and is mapped, but no input file was supplied," which `requireNode` alone doesn't catch since it only inspects the workflow object, not `inputs`.

- [ ] **Step 4: Update `WorkflowInputs`**

In the same file, change the interface (currently lines 49-64):

```ts
export interface WorkflowInputs {
  workflowTemplateId: string;
  upperGarmentFile: string;
  faceSideFile: string;
  poseFile: string;
  backgroundFile: string;
  lowerGarmentFile?: string;
  shoeGarmentFile?: string;
  promptFacePhase?: string;
  promptGarmentPhase?: string;
  aspectRatio?: string;
  outputWidth?: number;
  outputHeight?: number;
}
```

to:

```ts
export interface WorkflowInputs {
  workflowTemplateId: string;
  poseFile: string;
  upperGarmentFile?: string;
  faceSideFile?: string;
  backgroundFile?: string;
  lowerGarmentFile?: string;
  shoeGarmentFile?: string;
  promptFacePhase?: string;
  promptGarmentPhase?: string;
  aspectRatio?: string;
  outputWidth?: number;
  outputHeight?: number;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @aivastra/dispatcher test
```

Expected: all tests pass, including the pre-existing ones (which all provide every field via `BASE_INPUTS`, so the fail-closed checks don't fire for them).

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm --filter @aivastra/dispatcher exec tsc --noEmit
git add apps/dispatcher/src/workflow/patcher.ts apps/dispatcher/src/workflow/patcher.test.ts
git commit -m "feat(dispatcher): fail closed instead of stale-image fallback for any unmapped garment input"
```

---

### Task 8: Dispatcher processor — conditional uploads + catch missing-input failures

**Files:**
- Modify: `apps/dispatcher/src/job/processor.ts` (around lines 260-420 — the section between resolving `workflowTemplateId` and calling `patchWorkflow`)

- [ ] **Step 1: Fetch the resolved template's role flags before building the upload list**

Immediately after the existing block:

```ts
  const workflowTemplateId = effectiveWorkflowTemplateId;
  if (!workflowTemplateId) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_WORKFLOW', jobLog, startedAt);
    return;
  }
```

add:

```ts
  const [tmplRoles] = await db
    .select({
      faceNodeId: schema.workflowTemplates.faceNodeId,
      bgNodeId: schema.workflowTemplates.bgNodeId,
      upperNodeIds: schema.workflowTemplates.upperNodeIds,
    })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, workflowTemplateId));
  const needsFace = !!tmplRoles?.faceNodeId;
  const needsBg = !!tmplRoles?.bgNodeId;
  const needsUpper = (tmplRoles?.upperNodeIds.length ?? 0) > 0;
```

- [ ] **Step 2: Make the upload list conditional**

Replace (currently around lines 359-368):

```ts
    jobLog.info('uploading inputs to ComfyUI');
    const baseTasks: Promise<string>[] = [
      uploadToComfy(inputs.upperGarmentKey, 'garment'),
      uploadToComfy(faceSideKey, 'face'),
      uploadToComfy(poseKey, 'pose'),
      uploadToComfy(bgKey, 'bg'),
    ];
    if (lowerKey) baseTasks.push(uploadToComfy(lowerKey, 'lower'));
    if (shoeKey) baseTasks.push(uploadToComfy(shoeKey, 'shoe'));
    const uploaded = await Promise.all(baseTasks);

    let idx = 0;
    // biome-ignore lint/style/noNonNullAssertion: baseTasks always produces these 4 entries in order
    const upperGarmentFile = uploaded[idx++]!;
    // biome-ignore lint/style/noNonNullAssertion: baseTasks always produces these 4 entries in order
    const faceSideFile = uploaded[idx++]!;
    // biome-ignore lint/style/noNonNullAssertion: baseTasks always produces these 4 entries in order
    const poseFile = uploaded[idx++]!;
    // biome-ignore lint/style/noNonNullAssertion: baseTasks always produces these 4 entries in order
    const backgroundFile = uploaded[idx++]!;
    const lowerGarmentFile = lowerKey ? uploaded[idx++] : undefined;
    const shoeGarmentFile = shoeKey ? uploaded[idx++] : undefined;
```

with:

```ts
    jobLog.info({ needsFace, needsBg, needsUpper }, 'uploading inputs to ComfyUI');
    const baseTasks: Promise<string>[] = [uploadToComfy(poseKey, 'pose')];
    if (needsUpper && inputs.upperGarmentKey) baseTasks.push(uploadToComfy(inputs.upperGarmentKey, 'garment'));
    if (needsFace) baseTasks.push(uploadToComfy(faceSideKey, 'face'));
    if (needsBg) baseTasks.push(uploadToComfy(bgKey, 'bg'));
    if (lowerKey) baseTasks.push(uploadToComfy(lowerKey, 'lower'));
    if (shoeKey) baseTasks.push(uploadToComfy(shoeKey, 'shoe'));
    const uploaded = await Promise.all(baseTasks);

    let idx = 0;
    // biome-ignore lint/style/noNonNullAssertion: baseTasks always produces the pose entry first
    const poseFile = uploaded[idx++]!;
    const upperGarmentFile = needsUpper && inputs.upperGarmentKey ? uploaded[idx++] : undefined;
    const faceSideFile = needsFace ? uploaded[idx++] : undefined;
    const backgroundFile = needsBg ? uploaded[idx++] : undefined;
    const lowerGarmentFile = lowerKey ? uploaded[idx++] : undefined;
    const shoeGarmentFile = shoeKey ? uploaded[idx++] : undefined;
```

`inputs.upperGarmentKey` is nullable after Task 1 — the `needsUpper && inputs.upperGarmentKey` guard means a workflow that needs an upper role but has no key (which Task 6 should already prevent at job-creation time) simply doesn't upload one; `applyWorkflowPatch`'s Task-7 fail-closed check then throws cleanly instead of silently omitting the role.

- [ ] **Step 3: Update the two places that reference `upperGarmentFile`/`faceSideFile`/`backgroundFile` downstream**

The `patchWorkflow(...)` call and the `jobEvents` insert both already destructure these same variable names (`upperGarmentFile`, `faceSideFile`, `backgroundFile`, `lowerGarmentFile`, `shoeGarmentFile`) — no further change needed there, since they now naturally carry `string | undefined` matching `WorkflowInputs`'s Task-7 signature.

- [ ] **Step 4: Catch the new fail-closed throw from `patchWorkflow` and route to `markFailed`**

The whole upload-through-submit sequence is already inside one `try { ... }` block (starts at line 337). Find that block's matching `catch` clause further down in the function (search for `} catch (` after the `waitForCompletion`/`finalizeOutput` calls). Inside that catch, before whatever generic retry/failure handling already exists, add a check for this specific error class:

```ts
  } catch (err) {
    if (err instanceof Error && /no .* image was provided|no .* garment image was provided/.test(err.message)) {
      jobLog.error({ err: err.message }, 'missing garment input for a mapped workflow role');
      await markFailed(
        cfg,
        jobId,
        userId,
        stream,
        messageId,
        'MISSING_GARMENT_INPUT',
        jobLog,
        startedAt,
      );
      return;
    }
    // ... existing catch body continues unchanged below ...
```

Read the existing catch body first to place this correctly relative to whatever's already there (e.g. retry-count logic via `handleFailure`) — this new branch must come first and `return` before any retry path, since retrying a data/config problem will fail identically every time and just wastes an attempt.

- [ ] **Step 5: Typecheck**

```bash
cd apps/dispatcher && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run the dispatcher's integration happy-path suite**

```bash
cd apps/dispatcher && pnpm exec vitest run --config vitest.integration.config.ts test/integration/happy-path.test.ts --reporter=verbose
```

Expected: passes unchanged — existing fixtures provide every role's input, so `needsFace`/`needsBg`/`needsUpper` are all true and behavior matches before this change. (If this environment can't run the dispatcher integration suite due to pre-existing setup issues unrelated to this change, note that explicitly rather than skip verification silently — see the prior review's note about `deregisterWorker` teardown failures in this harness.)

- [ ] **Step 7: Commit**

```bash
git add apps/dispatcher/src/job/processor.ts
git commit -m "feat(dispatcher): upload only the ComfyUI inputs the resolved workflow needs, fail closed on gaps"
```

---

### Task 9: Regeneration — stop hard-requiring `upperGarmentKey`

**Files:**
- Modify: `apps/api/src/modules/jobs/regenerate.ts:67`
- Test: `apps/api/test/integration/regenerate.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test to `apps/api/test/integration/regenerate.test.ts` that creates a lower-only original job (reuse this file's existing `registerUser`/`grantCredits`/`bindUploadKey` helpers and whatever seed helpers the file already has for faces/poses/backgrounds/workflows — read the rest of the file for the exact seeding pattern used by its other regenerate tests before writing this one, since `originalJobId`/`sourceJobId` wiring needs to match exactly) and asserts the regenerate endpoint returns 201, not the current 400.

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts test/integration/regenerate.test.ts --reporter=verbose
```

Expected: FAILS with the new test hitting the `'original job is missing required inputs to regenerate'` 400.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/jobs/regenerate.ts`, change line 67:

```ts
  if (!inputs.poseId || !inputs.faceId || !inputs.backgroundId || !inputs.upperGarmentKey) {
    throw new AppError('VALIDATION', 400, 'original job is missing required inputs to regenerate');
  }
```

to:

```ts
  if (!inputs.poseId || !inputs.faceId || !inputs.backgroundId) {
    throw new AppError('VALIDATION', 400, 'original job is missing required inputs to regenerate');
  }
```

The reconstructed `CreateTryOnJobRequest` a few lines below already passes `upperGarmentKey: inputs.upperGarmentKey` through as-is (now legitimately `null`/`undefined`-capable after Task 1/2) — the downstream `createJob` call performs the real per-workflow validation from Task 6.

- [ ] **Step 4: Run to verify it passes, typecheck, commit**

```bash
cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts test/integration/regenerate.test.ts --reporter=verbose
pnpm --filter @aivastra/api typecheck
git add apps/api/src/modules/jobs/regenerate.ts apps/api/test/integration/regenerate.test.ts
git commit -m "fix(jobs): allow regenerating a lower-only job"
```

---

### Task 10: Catalogue history + results display

**Files:**
- Modify: `apps/api/src/modules/jobs/routes.ts:367-403` (`/v1/catalogues/:id`)
- Modify: `apps/api/src/modules/results/routes.ts` (the `/results/data` select around line 145, and wherever `monitorHtml()` renders `upperGarmentKey`)

- [ ] **Step 1: `jobs/routes.ts` — resolve hero garment from whichever source is present**

Replace (currently around lines 369-389):

```ts
      const [anyInput] = await app.db
        .select({
          params: schema.jobInputs.params,
          upperGarmentKey: schema.jobInputs.upperGarmentKey,
        })
        .from(schema.jobInputs)
        .innerJoin(schema.jobs, eq(schema.jobInputs.jobId, schema.jobs.id))
        .where(and(eq(schema.jobs.catalogueId, id), eq(schema.jobs.userId, req.userId)))
        .limit(1);
      const aspectRatio =
        (anyInput?.params as { aspectRatio?: string } | null)?.aspectRatio ?? null;

      let garmentUrl: string | null = null;
      if (anyInput?.upperGarmentKey) {
        try {
          const { url } = await app.storage.presignGet(anyInput.upperGarmentKey, 3600);
          garmentUrl = url;
        } catch {
          // non-fatal
        }
      }
```

with:

```ts
      const [anyInput] = await app.db
        .select({
          params: schema.jobInputs.params,
          upperGarmentKey: schema.jobInputs.upperGarmentKey,
          lowerGarmentKey: schema.jobInputs.lowerGarmentKey,
          lowerCatalogId: schema.jobInputs.lowerCatalogId,
        })
        .from(schema.jobInputs)
        .innerJoin(schema.jobs, eq(schema.jobInputs.jobId, schema.jobs.id))
        .where(and(eq(schema.jobs.catalogueId, id), eq(schema.jobs.userId, req.userId)))
        .limit(1);
      const aspectRatio =
        (anyInput?.params as { aspectRatio?: string } | null)?.aspectRatio ?? null;

      // Hero garment source, in priority order: uploaded upper, uploaded lower,
      // catalog-picked lower. A lower-only job must still show a source image.
      let garmentUrl: string | null = null;
      const heroKey = anyInput?.upperGarmentKey ?? anyInput?.lowerGarmentKey ?? null;
      if (heroKey) {
        try {
          const { url } = await app.storage.presignGet(heroKey, 3600);
          garmentUrl = url;
        } catch {
          // non-fatal
        }
      } else if (anyInput?.lowerCatalogId) {
        const [catalogItem] = await app.db
          .select({ thumbnailKey: schema.catalogItems.thumbnailKey })
          .from(schema.catalogItems)
          .where(eq(schema.catalogItems.id, anyInput.lowerCatalogId));
        if (catalogItem?.thumbnailKey) garmentUrl = app.storage.publicUrl(catalogItem.thumbnailKey);
      }
```

- [ ] **Step 2: `results/routes.ts` — include `lowerGarmentKey` in the ops-dashboard select**

In the `/results/data` handler, find the select that currently has `upperGarmentKey: schema.jobInputs.upperGarmentKey,` (line 145) and add immediately after it:

```ts
          lowerGarmentKey: schema.jobInputs.lowerGarmentKey,
```

Then find wherever the row's `upperGarmentKey` is turned into a displayed thumbnail URL further down in this file (search for `upperGarmentKey` again after line 145 — likely near where `poseThumbKey`/`backgroundThumbKey` are presigned or turned into public URLs) and apply the same `?? lowerGarmentKey` fallback used in Step 1, presigning whichever is present.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @aivastra/api typecheck
git add apps/api/src/modules/jobs/routes.ts apps/api/src/modules/results/routes.ts
git commit -m "fix(jobs): show a lower-only job's actual source garment in catalogue history and ops results"
```

---

### Task 11: Progress log + rollout note

**Files:**
- Modify: `docs/progress.md`

- [ ] **Step 1: Add a dated entry**

Summarize: flexible workflow roles (lower/inner-primary generation) is implemented end-to-end — schema, admin create/PATCH validation, admin UI, job-creation cross-validation, dispatcher fail-closed patching, conditional ComfyUI uploads, regeneration, and catalogue/results display. Note explicitly: **deploy dispatcher (this branch) before deploying api/admin-web** — an old dispatcher receiving a job with `NULL upper_garment_key` before its own null-tolerant changes are live will hit the previously-unguarded upload/patch code paths this plan fixed. Migration is safe to apply at any time (backward compatible, no behavior change on its own).

- [ ] **Step 2: Commit**

```bash
git add docs/progress.md
git commit -m "docs(progress): log flexible workflow roles implementation"
```

---

## Self-Review

**Spec coverage:**
- §1 Data model → Task 1.
- §2 Admin create backend (Zod floor + route handler) → Task 2 (Zod), Task 3 (route handler — the part missing from the original plan).
- §3 Admin PATCH merge-then-validate → Task 4.
- §4 Admin create UI → Task 5.
- §5 Job-creation garment-slot cross-validation → Task 6.
- §6 Dispatcher patcher fail-closed → Task 7.
- §7 Dispatcher processor conditional uploads → Task 8.
- §8 Regeneration → Task 9.
- §9 Catalogue history + results display → Task 10.
- §10 Rollout order → Task 11 (documented; this plan doesn't enforce it mechanically since no feature-flag system exists in this codebase — deploy-ordering discipline is a human/ops process, called out explicitly so it isn't missed).
- "Confirmed decisions" — both-role workflows (Decision 1) validated by Task 6's independent upper/lower checks; fail-and-refund (Decision 3) implemented by Task 7 (throw) + Task 8 (catch → `markFailed`); admin edit-UI explicitly out of scope, matching Task 4's API-only fix with no corresponding UI task.

**Placeholder scan:** no TBD/TODO markers.

**Type consistency:** `WorkflowInputs.upperGarmentFile`/`faceSideFile`/`backgroundFile` all `string | undefined` (Task 7) matches the conditional extraction in Task 8 exactly. `pw.upperNodeIds: string[]` threaded consistently from the `mappingPoseWorkflows` select (Task 6) through the fallback branch to the validation loop. `markFailed`'s `errorCode: string` parameter (verified against `processor.ts`'s existing signature) accepts the new `'MISSING_GARMENT_INPUT'` literal with no signature change needed.
