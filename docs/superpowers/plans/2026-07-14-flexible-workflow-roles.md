# Flexible Workflow Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note for this plan specifically:** implementation will be done externally (Codex), not by an agentic worker following this plan directly in this session. This plan is written to the same bite-sized, zero-placeholder standard so it can be handed off as-is. After Codex implements, the reviewer's job is to diff the actual changes against every task/step below — see "Review Checklist" at the end.

**Goal:** Let an admin upload a ComfyUI workflow for lower-wear-only or inner-wear-only generation (no upper garment, optionally no face/background node), and let a job be submitted to it without an upper-garment upload — without touching the studio wizard at all.

**Architecture:** A workflow's roles become implicit in which node-ID columns are populated, instead of a fixed required-set keyed off `workflowType`. `poseNodeId` and `garmentPhasePromptNode` stay mandatory (pose selects the workflow; every workflow has a garment phase); `faceNodeId`, `bgNodeId`, `facePhasePromptNode` become nullable, and `upperNodeIds` may be empty as long as `lowerNodeId` is set (or vice versa). `faceId`/`backgroundId` stay mandatory at job-creation — the studio always asks for them regardless of workflow shape; only `upperGarmentKey` becomes optional. The dispatcher patcher and processor gain conditional guards so a workflow missing a role simply isn't patched for it. Because `job_inputs.upper_garment_key` is a column shared by every job type (catalog, saree, tryon-direct, widget, shopify), making it nullable ripples into several other read sites — each has been individually verified as either already-safe or in need of a small defensive guard (see Task 6).

**Tech Stack:** Drizzle ORM/Postgres, Fastify 5 + Zod, Vitest (unit + integration against the docker-compose Postgres/Redis/MinIO), Node/TypeScript dispatcher.

**Spec:** `docs/superpowers/specs/2026-07-14-flexible-workflow-roles-design.md`

---

### Task 1: Schema — nullable workflow/job-input columns

**Files:**
- Modify: `packages/db/src/schema/models.ts:80-124`
- Modify: `packages/db/src/schema/jobs.ts:52-68`

- [ ] **Step 1: Relax `workflow_templates` columns**

In `packages/db/src/schema/models.ts`, find:

```ts
  // Node ID mappings (ComfyUI node IDs as strings — may contain colons e.g. "1345:111")
  faceNodeId: text('face_node_id').notNull(),
  poseNodeId: text('pose_node_id').notNull(),
  bgNodeId: text('bg_node_id').notNull(),
  upperNodeIds: text('upper_node_ids').array().notNull(),
```

Replace with:

```ts
  // Node ID mappings (ComfyUI node IDs as strings — may contain colons e.g. "1345:111").
  // faceNodeId/bgNodeId are nullable — a workflow's roles are implicit in which of
  // these are populated (see docs/superpowers/specs/2026-07-14-flexible-workflow-roles-
  // design.md). poseNodeId stays mandatory: it's the only mechanism that selects which
  // workflow runs for a job (model_pose_assets.workflowTemplateId).
  faceNodeId: text('face_node_id'),
  poseNodeId: text('pose_node_id').notNull(),
  bgNodeId: text('bg_node_id'),
  // Empty array = no upper role. At least one of upperNodeIds/lowerNodeId must be
  // set (enforced at the admin API layer, not here).
  upperNodeIds: text('upper_node_ids').array().notNull(),
```

Then find:

```ts
  // Prompt node IDs
  facePhasePromptNode: text('face_phase_prompt_node').notNull(),
  garmentPhasePromptNode: text('garment_phase_prompt_node').notNull(),
```

Replace with:

```ts
  // Prompt node IDs. facePhasePromptNode is nullable and required only when
  // faceNodeId is set (no face role without a prompt driving it). garmentPhasePromptNode
  // stays mandatory — every workflow has at least one garment slot, hence a garment phase.
  facePhasePromptNode: text('face_phase_prompt_node'),
  garmentPhasePromptNode: text('garment_phase_prompt_node').notNull(),
```

- [ ] **Step 2: Relax `job_inputs.upper_garment_key`**

In `packages/db/src/schema/jobs.ts`, find:

```ts
  upperGarmentKey: text('upper_garment_key').notNull(),
```

Replace with:

```ts
  // Nullable — a lower-wear-primary job has no upper upload at all. See
  // docs/superpowers/specs/2026-07-14-flexible-workflow-roles-design.md for the full
  // list of read sites this affects (most are already null-safe).
  upperGarmentKey: text('upper_garment_key'),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`

Expected: a new file `packages/db/src/migrations/01NN_<adjective>_<name>.sql` (next index after whatever `ls packages/db/src/migrations | grep -E '^[0-9]{4}_' | sort | tail -1` currently shows — 0106 at the time this plan was written) containing four `ALTER TABLE` statements dropping `NOT NULL`: `workflow_templates.face_node_id`, `workflow_templates.bg_node_id`, `workflow_templates.face_phase_prompt_node`, `job_inputs.upper_garment_key`.

Verify with `cat` on the generated file — confirm it contains ONLY these four statements, nothing else swept in.

- [ ] **Step 4: Apply the migration locally**

Run: `pnpm db:migrate`

Expected: the new migration's hash applied with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/models.ts packages/db/src/schema/jobs.ts packages/db/src/migrations/
git commit -m "feat(db): relax NOT NULL on optional workflow node roles and upperGarmentKey"
```

---

### Task 2: Zod validation — `packages/types`

**Files:**
- Modify: `packages/types/src/admin.ts:158-249`
- Modify: `packages/types/src/jobs.ts:36-62`

- [ ] **Step 1: Relax `CreateWorkflowBody`'s floor and its `upperNodeIds` array**

In `packages/types/src/admin.ts`, find:

```ts
export const CreateWorkflowBody = z
  .object({
    slug: z
      .string()
      .regex(
        /^[a-z0-9_]+$/,
        'Slug must be snake_case (lowercase letters, digits, underscores only)',
      ),
    label: z.string().min(1).max(120),
    jsonContent: z.record(z.any()),
    workflowType: z.enum(['regular', 'tryon']).default('regular'),
    // Regular workflow fields (required when workflowType = 'regular')
    faceNodeId: z.string().min(1).optional(),
    poseNodeId: z.string().min(1).optional(),
    bgNodeId: z.string().min(1).optional(),
    upperNodeIds: z.array(z.string().min(1)).min(1).max(8).optional(),
    lowerNodeId: z.string().min(1).optional(),
    shoeNodeId: z.string().min(1).optional(),
    sizeNodeIds: z.array(z.string().min(1)).optional(),
    // Dual-size-group templates (build_model_main v2+) — server-computed from node
    // titles at parse time, not manually edited via the admin form.
    latentSizeNodeIds: z.array(z.string().min(1)).length(2).optional(),
    latentMaxPx: z.number().int().positive().optional(),
    outputSizeNodeIds: z.array(z.string().min(1)).length(2).optional(),
    outputMaxPx: z.number().int().positive().optional(),
    resultNodeId: z.string().min(1).optional(),
    facePhasePromptNode: z.string().min(1).optional(),
    garmentPhasePromptNode: z.string().min(1).optional(),
    // Tryon workflow fields (required when workflowType = 'tryon')
    tryonPersonNodeId: z.string().min(1).optional(),
    tryonGarmentNodeId: z.string().min(1).optional(),
    tryonOutputNodeId: z.string().min(1).optional(),
  })
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

Replace with:

```ts
export const CreateWorkflowBody = z
  .object({
    slug: z
      .string()
      .regex(
        /^[a-z0-9_]+$/,
        'Slug must be snake_case (lowercase letters, digits, underscores only)',
      ),
    label: z.string().min(1).max(120),
    jsonContent: z.record(z.any()),
    workflowType: z.enum(['regular', 'tryon']).default('regular'),
    // Regular workflow fields. poseNodeId + garmentPhasePromptNode + at least one of
    // (upperNodeIds non-empty | lowerNodeId) are required for workflowType='regular'
    // — enforced below, not by .min(1)/non-optional here, since which combination is
    // valid depends on which OTHER fields are present (see superRefine).
    faceNodeId: z.string().min(1).optional(),
    poseNodeId: z.string().min(1).optional(),
    bgNodeId: z.string().min(1).optional(),
    upperNodeIds: z.array(z.string().min(1)).max(8).optional(),
    lowerNodeId: z.string().min(1).optional(),
    shoeNodeId: z.string().min(1).optional(),
    sizeNodeIds: z.array(z.string().min(1)).optional(),
    // Dual-size-group templates (build_model_main v2+) — server-computed from node
    // titles at parse time, not manually edited via the admin form.
    latentSizeNodeIds: z.array(z.string().min(1)).length(2).optional(),
    latentMaxPx: z.number().int().positive().optional(),
    outputSizeNodeIds: z.array(z.string().min(1)).length(2).optional(),
    outputMaxPx: z.number().int().positive().optional(),
    resultNodeId: z.string().min(1).optional(),
    facePhasePromptNode: z.string().min(1).optional(),
    garmentPhasePromptNode: z.string().min(1).optional(),
    // Tryon workflow fields (required when workflowType = 'tryon')
    tryonPersonNodeId: z.string().min(1).optional(),
    tryonGarmentNodeId: z.string().min(1).optional(),
    tryonOutputNodeId: z.string().min(1).optional(),
  })
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
    // workflowType === 'regular'
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
    const hasLower = Boolean(val.lowerNodeId);
    if (!hasUpper && !hasLower) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['upperNodeIds'],
        message: 'at least one garment slot (upperNodeIds or lowerNodeId) is required',
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

- [ ] **Step 2: Let `UpdateWorkflowBody` clear the now-nullable fields**

In the same file, find:

```ts
export const UpdateWorkflowBody = z.object({
  label: z.string().min(1).max(120).optional(),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, 'slug must be lowercase alphanumeric with underscores')
    .optional(),
  isActive: z.boolean().optional(),
  // Regular workflow node mappings (not the JSON itself)
  faceNodeId: z.string().min(1).optional(),
  poseNodeId: z.string().min(1).optional(),
  bgNodeId: z.string().min(1).optional(),
  upperNodeIds: z.array(z.string().min(1)).min(1).max(8).optional(),
  lowerNodeId: z.string().min(1).nullable().optional(),
  shoeNodeId: z.string().min(1).nullable().optional(),
  sizeNodeId: z.string().min(1).nullable().optional(),
  sizeNodeIds: z.array(z.string().min(1)).optional(),
  latentSizeNodeIds: z.array(z.string().min(1)).length(2).optional(),
  latentMaxPx: z.number().int().positive().optional(),
  outputSizeNodeIds: z.array(z.string().min(1)).length(2).optional(),
  outputMaxPx: z.number().int().positive().optional(),
  resultNodeId: z.string().min(1).nullable().optional(),
  facePhasePromptNode: z.string().min(1).optional(),
  garmentPhasePromptNode: z.string().min(1).optional(),
  // Tryon workflow node IDs
  tryonPersonNodeId: z.string().min(1).nullable().optional(),
  tryonGarmentNodeId: z.string().min(1).nullable().optional(),
  tryonOutputNodeId: z.string().min(1).nullable().optional(),
});
```

Replace with:

```ts
export const UpdateWorkflowBody = z.object({
  label: z.string().min(1).max(120).optional(),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, 'slug must be lowercase alphanumeric with underscores')
    .optional(),
  isActive: z.boolean().optional(),
  // Regular workflow node mappings (not the JSON itself). faceNodeId/bgNodeId/
  // facePhasePromptNode are nullable so an admin can explicitly clear a role after
  // creation, mirroring lowerNodeId/shoeNodeId below.
  faceNodeId: z.string().min(1).nullable().optional(),
  poseNodeId: z.string().min(1).optional(),
  bgNodeId: z.string().min(1).nullable().optional(),
  upperNodeIds: z.array(z.string().min(1)).max(8).optional(),
  lowerNodeId: z.string().min(1).nullable().optional(),
  shoeNodeId: z.string().min(1).nullable().optional(),
  sizeNodeId: z.string().min(1).nullable().optional(),
  sizeNodeIds: z.array(z.string().min(1)).optional(),
  latentSizeNodeIds: z.array(z.string().min(1)).length(2).optional(),
  latentMaxPx: z.number().int().positive().optional(),
  outputSizeNodeIds: z.array(z.string().min(1)).length(2).optional(),
  outputMaxPx: z.number().int().positive().optional(),
  resultNodeId: z.string().min(1).nullable().optional(),
  facePhasePromptNode: z.string().min(1).nullable().optional(),
  garmentPhasePromptNode: z.string().min(1).optional(),
  // Tryon workflow node IDs
  tryonPersonNodeId: z.string().min(1).nullable().optional(),
  tryonGarmentNodeId: z.string().min(1).nullable().optional(),
  tryonOutputNodeId: z.string().min(1).nullable().optional(),
});
```

- [ ] **Step 3: `CreateTryOnJobInputs.upperGarmentKey` becomes optional**

In `packages/types/src/jobs.ts`, find:

```ts
export const CreateTryOnJobInputs = z
  .object({
    upperGarmentKey: z.string().regex(INPUT_GARMENT_KEY),
    faceId: z.string().uuid(),
    // Legacy/custom form: a single shared background applied to every pose.
    backgroundId: z.string().uuid().optional(),
    poseIds: z.array(z.string().uuid()).min(1).optional(),
    // Template form: each pose carries its own background. Exactly one of
    // (backgroundId + poseIds) or looks must be provided — enforced below.
    looks: z
      .array(
        z.object({
          poseId: z.string().uuid(),
          backgroundId: z.string().uuid(),
        }),
      )
      .min(1)
      .max(12)
      .optional(),
    garmentTypeId: z.string().uuid().optional(),
    lowerCatalogId: z.string().uuid().optional(),
    lowerGarmentKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
    shoeCatalogId: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.backgroundId && d.poseIds) !== Boolean(d.looks), {
    message: 'Provide either (backgroundId + poseIds) or looks, not both',
  });
```

Replace with:

```ts
export const CreateTryOnJobInputs = z
  .object({
    // Optional — a lower-wear-primary job has no upper upload at all. At least one
    // of upperGarmentKey/lowerGarmentKey must be present (enforced below). faceId/
    // backgroundId stay mandatory: the studio always asks for them regardless of
    // which workflow ends up handling the job — see
    // docs/superpowers/specs/2026-07-14-flexible-workflow-roles-design.md.
    upperGarmentKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
    faceId: z.string().uuid(),
    // Legacy/custom form: a single shared background applied to every pose.
    backgroundId: z.string().uuid().optional(),
    poseIds: z.array(z.string().uuid()).min(1).optional(),
    // Template form: each pose carries its own background. Exactly one of
    // (backgroundId + poseIds) or looks must be provided — enforced below.
    looks: z
      .array(
        z.object({
          poseId: z.string().uuid(),
          backgroundId: z.string().uuid(),
        }),
      )
      .min(1)
      .max(12)
      .optional(),
    garmentTypeId: z.string().uuid().optional(),
    lowerCatalogId: z.string().uuid().optional(),
    lowerGarmentKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
    shoeCatalogId: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.backgroundId && d.poseIds) !== Boolean(d.looks), {
    message: 'Provide either (backgroundId + poseIds) or looks, not both',
  })
  .refine((d) => Boolean(d.upperGarmentKey) || Boolean(d.lowerGarmentKey), {
    message: 'Provide at least one of upperGarmentKey or lowerGarmentKey',
  });
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @aivastra/types typecheck`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/admin.ts packages/types/src/jobs.ts
git commit -m "feat(types): flexible workflow role validation, optional upperGarmentKey"
```

---

### Task 3: Admin workflow routes — floor validation + nullable-clear

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts`
- Test: `apps/api/test/integration/admin-workflows-flexible-roles.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/integration/admin-workflows-flexible-roles.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

function lowerOnlyWorkflowJson() {
  return {
    '1': { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'pose' } },
    '2': { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'lower_garment' } },
    '3': {
      inputs: { prompt: 'default positive' },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'positive_prompt' },
    },
  };
}

describe('admin workflows — flexible roles', () => {
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

  it('creates a lower-only regular workflow with no face/bg/upper nodes', async () => {
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `lower_only_${Date.now()}`,
        label: 'Lower Only',
        jsonContent: lowerOnlyWorkflowJson(),
        workflowType: 'regular',
        poseNodeId: '1',
        lowerNodeId: '2',
        garmentPhasePromptNode: '3',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const [row] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, body.id));
    expect(row?.faceNodeId).toBeNull();
    expect(row?.bgNodeId).toBeNull();
    expect(row?.upperNodeIds).toEqual([]);
    expect(row?.lowerNodeId).toBe('2');
    expect(row?.poseNodeId).toBe('1');
  });

  it('rejects a regular workflow with neither upperNodeIds nor lowerNodeId', async () => {
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `no_garment_${Date.now()}`,
        label: 'No Garment',
        jsonContent: lowerOnlyWorkflowJson(),
        workflowType: 'regular',
        poseNodeId: '1',
        garmentPhasePromptNode: '3',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a regular workflow missing poseNodeId', async () => {
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `no_pose_${Date.now()}`,
        label: 'No Pose',
        jsonContent: lowerOnlyWorkflowJson(),
        workflowType: 'regular',
        lowerNodeId: '2',
        garmentPhasePromptNode: '3',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects faceNodeId without facePhasePromptNode', async () => {
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const json = {
      ...lowerOnlyWorkflowJson(),
      '4': { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'face' } },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `face_no_prompt_${Date.now()}`,
        label: 'Face No Prompt',
        jsonContent: json,
        workflowType: 'regular',
        poseNodeId: '1',
        lowerNodeId: '2',
        garmentPhasePromptNode: '3',
        faceNodeId: '4',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH can explicitly clear faceNodeId back to null', async () => {
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const json = {
      ...lowerOnlyWorkflowJson(),
      '4': { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'face' } },
      '5': {
        inputs: { prompt: 'negative' },
        class_type: 'CLIPTextEncode',
        _meta: { title: 'negative_prompt' },
      },
    };
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `clearable_face_${Date.now()}`,
        label: 'Clearable Face',
        jsonContent: json,
        workflowType: 'regular',
        poseNodeId: '1',
        lowerNodeId: '2',
        garmentPhasePromptNode: '3',
        faceNodeId: '4',
        facePhasePromptNode: '5',
      },
    });
    expect(createRes.statusCode).toBe(200);
    const { id } = createRes.json();

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${id}`,
      headers,
      payload: { faceNodeId: null, facePhasePromptNode: null },
    });
    expect(patchRes.statusCode).toBe(200);

    const [row] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    expect(row?.faceNodeId).toBeNull();
    expect(row?.facePhasePromptNode).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aivastra/api exec vitest run --config vitest.integration.config.ts test/integration/admin-workflows-flexible-roles.test.ts --reporter=verbose`

Expected: FAIL — `poseNodeId`/`faceNodeId`/`bgNodeId`/`upperNodeIds`/`facePhasePromptNode` are still all required together per the old superRefine, so the lower-only creation (test 1) fails with 400, and the PATCH null-clear (test 5) is rejected by the old zod type (`faceNodeId: z.string().min(1).optional()` doesn't accept `null`).

- [ ] **Step 3: Update `extractDefaultPrompts` to accept a nullable negative-prompt node**

In `apps/api/src/modules/admin/workflows.routes.ts`, find:

```ts
function extractDefaultPrompts(
  json: Record<string, unknown>,
  negativePromptNode: string,
  positivePromptNode: string,
): { defaultFacePhasePrompt: string; defaultGarmentPhasePrompt: string } {
  const negNode = json[negativePromptNode] as WorkflowNode | undefined;
  const posNode = json[positivePromptNode] as WorkflowNode | undefined;
  return {
    defaultFacePhasePrompt: extractPromptText(negNode),
    defaultGarmentPhasePrompt: extractPromptText(posNode),
  };
}
```

Replace with:

```ts
function extractDefaultPrompts(
  json: Record<string, unknown>,
  negativePromptNode: string | null,
  positivePromptNode: string,
): { defaultFacePhasePrompt: string; defaultGarmentPhasePrompt: string } {
  const negNode = negativePromptNode
    ? (json[negativePromptNode] as WorkflowNode | undefined)
    : undefined;
  const posNode = json[positivePromptNode] as WorkflowNode | undefined;
  return {
    defaultFacePhasePrompt: extractPromptText(negNode),
    defaultGarmentPhasePrompt: extractPromptText(posNode),
  };
}
```

- [ ] **Step 4: Rewrite the POST `/admin/workflows` regular-branch validation**

In the same file, find (the entire "Regular workflow" block through the insert):

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
      for (const uid of upperNodeIds) {
        validateNodeType(body.jsonContent, uid, 'image', 'upper garment');
      }
      if (body.lowerNodeId)
        validateNodeType(body.jsonContent, body.lowerNodeId, 'image', 'lower garment');
      if (body.shoeNodeId) validateNodeType(body.jsonContent, body.shoeNodeId, 'image', 'shoes');
      validateNodeType(body.jsonContent, facePhasePromptNode, 'prompt', 'negative prompt');
      validateNodeType(body.jsonContent, garmentPhasePromptNode, 'prompt', 'positive prompt');

      const { defaultFacePhasePrompt, defaultGarmentPhasePrompt } = extractDefaultPrompts(
        body.jsonContent,
        facePhasePromptNode,
        garmentPhasePromptNode,
      );

      const [row] = await app.db
        .insert(schema.workflowTemplates)
        .values({
          slug: body.slug,
          label: body.label,
          jsonContent: body.jsonContent,
          workflowType: 'regular',
          faceNodeId,
          poseNodeId,
          bgNodeId,
          upperNodeIds,
          lowerNodeId: body.lowerNodeId ?? null,
          shoeNodeId: body.shoeNodeId ?? null,
          sizeNodeIds: body.sizeNodeIds ?? [],
          latentSizeNodeIds: body.latentSizeNodeIds ?? [],
          ...(body.latentMaxPx !== undefined ? { latentMaxPx: body.latentMaxPx } : {}),
          outputSizeNodeIds: body.outputSizeNodeIds ?? [],
          ...(body.outputMaxPx !== undefined ? { outputMaxPx: body.outputMaxPx } : {}),
          resultNodeId: body.resultNodeId ?? null,
          facePhasePromptNode,
          garmentPhasePromptNode,
          defaultFacePhasePrompt,
          defaultGarmentPhasePrompt,
        })
        .returning();
```

Replace with:

```ts
      // Regular workflow — floor validation: poseNodeId + garmentPhasePromptNode +
      // at least one garment slot (upperNodeIds non-empty or lowerNodeId) are
      // required (guaranteed by CreateWorkflowBody's superRefine — safe to assert
      // those two). face/background are genuinely optional per-workflow — see
      // docs/superpowers/specs/2026-07-14-flexible-workflow-roles-design.md.
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const poseNodeId = body.poseNodeId!;
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const garmentPhasePromptNode = body.garmentPhasePromptNode!;
      const upperNodeIds = body.upperNodeIds ?? [];
      const faceNodeId = body.faceNodeId ?? null;
      const bgNodeId = body.bgNodeId ?? null;
      const facePhasePromptNode = body.facePhasePromptNode ?? null;

      validateNodeExists(body.jsonContent, poseNodeId, 'pose');
      if (faceNodeId) validateNodeExists(body.jsonContent, faceNodeId, 'face');
      if (bgNodeId) validateNodeExists(body.jsonContent, bgNodeId, 'background');
      for (const uid of upperNodeIds) {
        validateNodeExists(body.jsonContent, uid, 'upper garment');
      }
      if (body.lowerNodeId) validateNodeExists(body.jsonContent, body.lowerNodeId, 'lower garment');
      if (body.shoeNodeId) validateNodeExists(body.jsonContent, body.shoeNodeId, 'shoes');
      for (const uid of body.sizeNodeIds ?? []) {
        validateNodeExists(body.jsonContent, uid, 'size');
      }
      if (facePhasePromptNode)
        validateNodeExists(body.jsonContent, facePhasePromptNode, 'negative prompt');
      validateNodeExists(body.jsonContent, garmentPhasePromptNode, 'positive prompt');

      validateNodeType(body.jsonContent, poseNodeId, 'image', 'pose');
      if (faceNodeId) validateNodeType(body.jsonContent, faceNodeId, 'image', 'face');
      if (bgNodeId) validateNodeType(body.jsonContent, bgNodeId, 'image', 'background');
      for (const uid of upperNodeIds) {
        validateNodeType(body.jsonContent, uid, 'image', 'upper garment');
      }
      if (body.lowerNodeId)
        validateNodeType(body.jsonContent, body.lowerNodeId, 'image', 'lower garment');
      if (body.shoeNodeId) validateNodeType(body.jsonContent, body.shoeNodeId, 'image', 'shoes');
      if (facePhasePromptNode)
        validateNodeType(body.jsonContent, facePhasePromptNode, 'prompt', 'negative prompt');
      validateNodeType(body.jsonContent, garmentPhasePromptNode, 'prompt', 'positive prompt');

      const { defaultFacePhasePrompt, defaultGarmentPhasePrompt } = extractDefaultPrompts(
        body.jsonContent,
        facePhasePromptNode,
        garmentPhasePromptNode,
      );

      const [row] = await app.db
        .insert(schema.workflowTemplates)
        .values({
          slug: body.slug,
          label: body.label,
          jsonContent: body.jsonContent,
          workflowType: 'regular',
          faceNodeId,
          poseNodeId,
          bgNodeId,
          upperNodeIds,
          lowerNodeId: body.lowerNodeId ?? null,
          shoeNodeId: body.shoeNodeId ?? null,
          sizeNodeIds: body.sizeNodeIds ?? [],
          latentSizeNodeIds: body.latentSizeNodeIds ?? [],
          ...(body.latentMaxPx !== undefined ? { latentMaxPx: body.latentMaxPx } : {}),
          outputSizeNodeIds: body.outputSizeNodeIds ?? [],
          ...(body.outputMaxPx !== undefined ? { outputMaxPx: body.outputMaxPx } : {}),
          resultNodeId: body.resultNodeId ?? null,
          facePhasePromptNode,
          garmentPhasePromptNode,
          defaultFacePhasePrompt,
          defaultGarmentPhasePrompt,
        })
        .returning();
```

- [ ] **Step 5: Widen the PATCH route's inline body type to accept nulls**

In the same file, find:

```ts
      const body = req.body as {
        label?: string;
        slug?: string;
        isActive?: boolean;
        faceNodeId?: string;
        poseNodeId?: string;
        bgNodeId?: string;
        upperNodeIds?: string[];
        lowerNodeId?: string | null;
        shoeNodeId?: string | null;
        sizeNodeIds?: string[];
        latentSizeNodeIds?: string[];
        latentMaxPx?: number;
        outputSizeNodeIds?: string[];
        outputMaxPx?: number;
        resultNodeId?: string | null;
        facePhasePromptNode?: string;
        garmentPhasePromptNode?: string;
        tryonPersonNodeId?: string | null;
        tryonGarmentNodeId?: string | null;
        tryonOutputNodeId?: string | null;
      };
```

Replace with:

```ts
      const body = req.body as {
        label?: string;
        slug?: string;
        isActive?: boolean;
        faceNodeId?: string | null;
        poseNodeId?: string;
        bgNodeId?: string | null;
        upperNodeIds?: string[];
        lowerNodeId?: string | null;
        shoeNodeId?: string | null;
        sizeNodeIds?: string[];
        latentSizeNodeIds?: string[];
        latentMaxPx?: number;
        outputSizeNodeIds?: string[];
        outputMaxPx?: number;
        resultNodeId?: string | null;
        facePhasePromptNode?: string | null;
        garmentPhasePromptNode?: string;
        tryonPersonNodeId?: string | null;
        tryonGarmentNodeId?: string | null;
        tryonOutputNodeId?: string | null;
      };
```

(The rest of the PATCH handler needs no further changes: its validation blocks already only run `if (body.X)` — truthy, so both `undefined` and `null` skip validation correctly — and its `updateValues` assignment already uses `if (body.X !== undefined) updateValues.X = body.X;`, which already writes `null` through correctly once the type allows it. Both are pre-existing code, unchanged by this task.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @aivastra/api exec vitest run --config vitest.integration.config.ts test/integration/admin-workflows-flexible-roles.test.ts --reporter=verbose`

Expected: PASS — all 5 tests green.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @aivastra/api typecheck`

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/admin/workflows.routes.ts apps/api/test/integration/admin-workflows-flexible-roles.test.ts
git commit -m "feat(api): floor validation for flexible workflow roles, nullable-clear on PATCH"
```

---

### Task 4: Job creation — optional `upperGarmentKey`

**Files:**
- Modify: `apps/api/src/modules/jobs/create.ts:53-96,320-374`
- Test: `apps/api/test/integration/jobs-create-lower-only.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/jobs-create-lower-only.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerifiedUserToken } from '../helpers/auth.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('POST /v1/jobs/tryon — lower-only (no upperGarmentKey)', () => {
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

  async function seedLowerOnlyPose() {
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `lower-only-${Date.now()}`,
        label: 'Lower Only',
        jsonContent: {},
        workflowType: 'regular',
        poseNodeId: '1',
        lowerNodeId: '2',
        upperNodeIds: [],
        garmentPhasePromptNode: '3',
      })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Lower Pose',
        r2Key: 'p.jpg',
        thumbnailKey: 'p.jpg',
        genderSlug: 'men',
        workflowTemplateId: wf.id,
      })
      .returning();
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({ label: 'F', genderSlug: 'men', r2Key: 'f.jpg', thumbnailKey: 'f.jpg' })
      .returning();
    const [bg] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ label: 'B', r2Key: 'b.jpg', thumbnailKey: 'b.jpg' })
      .returning();
    return { pose, face, bg };
  }

  it('creates a job with lowerGarmentKey and no upperGarmentKey', async () => {
    const email = `lower-only-${Date.now()}@x.com`;
    const { token, userId } = await createVerifiedUserToken(app, email);
    await app.db.insert(schema.userCredits).values({ userId, balance: 100 });
    const { pose, face, bg } = await seedLowerOnlyPose();
    const lowerGarmentKey = `inputs/${userId}/garment.jpg`;
    await app.redis.set(`upload:owner:${lowerGarmentKey}`, userId, 'EX', 3600);
    await app.storage.putObject(lowerGarmentKey, Buffer.from('x'), 'image/jpeg');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          faceId: face.id,
          backgroundId: bg.id,
          poseIds: [pose.id],
          lowerGarmentKey,
        },
        aspectRatio: '1:1',
        resolution: 'HD',
      },
    });
    expect(res.statusCode).toBe(201);

    const [jobInput] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.poseId, pose.id));
    expect(jobInput?.upperGarmentKey).toBeNull();
    expect(jobInput?.lowerGarmentKey).toBe(lowerGarmentKey);
  });

  it('rejects a job with neither upperGarmentKey nor lowerGarmentKey', async () => {
    const email = `neither-${Date.now()}@x.com`;
    const { token, userId } = await createVerifiedUserToken(app, email);
    await app.db.insert(schema.userCredits).values({ userId, balance: 100 });
    const { pose, face, bg } = await seedLowerOnlyPose();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          faceId: face.id,
          backgroundId: bg.id,
          poseIds: [pose.id],
        },
        aspectRatio: '1:1',
        resolution: 'HD',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @aivastra/api exec vitest run --config vitest.integration.config.ts test/integration/jobs-create-lower-only.test.ts --reporter=verbose`

Expected: FAIL — `upperGarmentKey` is still required by the zod schema (Task 2 not yet applied if run standalone) or `assertOwnsUploadKey(app, userId, upperGarmentKey)` throws on `undefined` (create.ts not yet updated).

- [ ] **Step 3: Make the upload-ownership check conditional**

In `apps/api/src/modules/jobs/create.ts`, find:

```ts
  // H2: keys are format-pinned by zod, but the format alone does not prove the
  // caller owns the object — another user's key has the same shape. Verify each
  // garment key was issued to THIS user by /v1/uploads/presign (Redis binding)
  // before any credit/DB mutation.
  await assertOwnsUploadKey(app, userId, upperGarmentKey);
  if (lowerGarmentKey) await assertOwnsUploadKey(app, userId, lowerGarmentKey);
```

Replace with:

```ts
  // H2: keys are format-pinned by zod, but the format alone does not prove the
  // caller owns the object — another user's key has the same shape. Verify each
  // garment key was issued to THIS user by /v1/uploads/presign (Redis binding)
  // before any credit/DB mutation. upperGarmentKey is optional (lower-wear-primary
  // jobs have no upper upload) — CreateTryOnJobInputs's refine already guarantees
  // at least one of upperGarmentKey/lowerGarmentKey is present.
  if (upperGarmentKey) await assertOwnsUploadKey(app, userId, upperGarmentKey);
  if (lowerGarmentKey) await assertOwnsUploadKey(app, userId, lowerGarmentKey);
```

- [ ] **Step 4: Write `upperGarmentKey` as an explicit `null` when absent**

In the same file, find:

```ts
      await tx.insert(schema.jobInputs).values({
        jobId: job.id,
        upperGarmentKey,
        faceId,
```

Replace with:

```ts
      await tx.insert(schema.jobInputs).values({
        jobId: job.id,
        upperGarmentKey: upperGarmentKey ?? null,
        faceId,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @aivastra/api exec vitest run --config vitest.integration.config.ts test/integration/jobs-create-lower-only.test.ts --reporter=verbose`

Expected: PASS — both tests green.

- [ ] **Step 6: Run the full unit suite + typecheck to confirm no regression**

Run: `pnpm --filter @aivastra/api test:unit`

Expected: all passing.

Run: `pnpm --filter @aivastra/api typecheck`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/jobs/create.ts apps/api/test/integration/jobs-create-lower-only.test.ts
git commit -m "feat(api): allow job creation without an upper garment upload"
```

---

### Task 5: Dispatcher patcher — guard optional face/background/upper roles

**Files:**
- Modify: `apps/dispatcher/src/workflow/patcher.ts`
- Test: `apps/dispatcher/src/workflow/patcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/dispatcher/src/workflow/patcher.test.ts`, inside a new `describe` block appended at the end of the file (after the existing closing of the last `describe`):

```ts
describe('optional roles (lower/inner-primary workflows)', () => {
  it('does not throw when faceNodeId is null and faceSideFile is not provided', () => {
    const wf = makeWorkflow();
    const tmpl = makeTemplate({ faceNodeId: null, upperNodeIds: [] });
    const inputs = {
      poseFile: 'pose_abc123.jpg',
      backgroundFile: 'bg_abc123.jpg',
      lowerGarmentFile: 'lower_abc123.jpg',
    };
    expect(() => applyWorkflowPatch(wf, tmpl, inputs)).not.toThrow();
    // Face node's image is untouched (still the empty string from the fixture).
    expect(wf['1332']?.inputs.image).toBe('');
  });

  it('does not throw when bgNodeId is null and backgroundFile is not provided', () => {
    const wf = makeWorkflow();
    const tmpl = makeTemplate({ bgNodeId: null, upperNodeIds: [] });
    const inputs = {
      faceSideFile: 'face_abc123.jpg',
      poseFile: 'pose_abc123.jpg',
      lowerGarmentFile: 'lower_abc123.jpg',
    };
    expect(() => applyWorkflowPatch(wf, tmpl, inputs)).not.toThrow();
    expect(wf['1334']?.inputs.image).toBe('');
  });

  it('leaves the lower node untouched (no fallback-to-upper crash) when there is no upper garment file', () => {
    const wf = makeWorkflow();
    const tmpl = makeTemplate({ upperNodeIds: [], faceNodeId: null, bgNodeId: null });
    const inputs = {
      poseFile: 'pose_abc123.jpg',
      lowerGarmentFile: 'lower_abc123.jpg',
    };
    applyWorkflowPatch(wf, tmpl, inputs);
    expect(wf['1331']?.inputs.image).toBe('lower_abc123.jpg');
  });

  it('still throws for pose, which stays mandatory', () => {
    const wf = makeWorkflow();
    const tmpl = makeTemplate({ poseNodeId: 'NODE_THAT_DOES_NOT_EXIST' });
    const inputs = { poseFile: 'pose_abc123.jpg', lowerGarmentFile: 'lower_abc123.jpg' };
    expect(() => applyWorkflowPatch(wf, tmpl, inputs)).toThrowError(/NODE_THAT_DOES_NOT_EXIST/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aivastra/dispatcher exec vitest run --config vitest.config.ts src/workflow/patcher.test.ts --reporter=verbose`

Expected: FAIL — the current `applyWorkflowPatch` calls `requireNode(workflow, tmpl.faceNodeId, 'face')` unconditionally, and `tmpl.faceNodeId` being `null` makes `requireNode` throw `Workflow node "null" (face) not found in JSON`. Also `WorkflowInputs`/its `Omit<...>` currently require `upperGarmentFile`/`faceSideFile`/`backgroundFile` as non-optional, so the new tests' inputs objects (which omit them) won't even type-check yet.

- [ ] **Step 3: Update `WorkflowInputs` and guard the patch logic**

In `apps/dispatcher/src/workflow/patcher.ts`, find:

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
  /** Custom pixel dimensions from the user — when present, override the
   *  ASPECT_DIMENSIONS enum lookup so the exact requested resolution is used. */
  outputWidth?: number;
  outputHeight?: number;
}
```

Replace with:

```ts
export interface WorkflowInputs {
  workflowTemplateId: string;
  // Optional — a lower/inner-primary workflow may have no upper role at all
  // (tmpl.upperNodeIds is empty) or no face/background role (tmpl.faceNodeId/
  // bgNodeId null). poseFile stays mandatory — pose is the one role every
  // workflow has. See docs/superpowers/specs/2026-07-14-flexible-workflow-roles-
  // design.md.
  upperGarmentFile?: string;
  faceSideFile?: string;
  poseFile: string;
  backgroundFile?: string;
  lowerGarmentFile?: string;
  shoeGarmentFile?: string;
  promptFacePhase?: string;
  promptGarmentPhase?: string;
  aspectRatio?: string;
  /** Custom pixel dimensions from the user — when present, override the
   *  ASPECT_DIMENSIONS enum lookup so the exact requested resolution is used. */
  outputWidth?: number;
  outputHeight?: number;
}
```

Then find:

```ts
  // Required image nodes — throw if any are missing from the JSON
  requireNode(workflow, tmpl.faceNodeId, 'face').inputs.image = inputs.faceSideFile;
  requireNode(workflow, tmpl.poseNodeId, 'pose').inputs.image = inputs.poseFile;
  requireNode(workflow, tmpl.bgNodeId, 'bg').inputs.image = inputs.backgroundFile;

  // Upper garment — patch all mapped nodes
  for (const uid of tmpl.upperNodeIds) {
    const upperNode = workflow[uid];
    if (upperNode) upperNode.inputs.image = inputs.upperGarmentFile;
  }

  // Lower garment — fall back to upper garment when not provided so ComfyUI
  // never receives a stale/empty filename from the original workflow design.
  if (tmpl.lowerNodeId) {
    const lowerNode = workflow[tmpl.lowerNodeId];
    if (lowerNode) {
      const lowerFile = inputs.lowerGarmentFile ?? inputs.upperGarmentFile;
      if (!inputs.lowerGarmentFile) {
        log?.warn(
          `patchWorkflow: lowerNodeId "${tmpl.lowerNodeId}" mapped but no lower garment provided — falling back to upper garment`,
        );
      }
      lowerNode.inputs.image = lowerFile;
    }
  } else if (inputs.lowerGarmentFile) {
    log?.warn(
      `patchWorkflow: lower garment provided but workflow "${tmpl.slug}" has no lower_node_id — skipping`,
    );
  }

  // Shoe — same fallback pattern as lower garment
  if (tmpl.shoeNodeId) {
    const shoeNode = workflow[tmpl.shoeNodeId];
    if (shoeNode) {
      const shoeFile = inputs.shoeGarmentFile ?? inputs.upperGarmentFile;
      if (!inputs.shoeGarmentFile) {
        log?.warn(
          `patchWorkflow: shoeNodeId "${tmpl.shoeNodeId}" mapped but no shoe garment provided — falling back to upper garment`,
        );
      }
      shoeNode.inputs.image = shoeFile;
    }
  } else if (inputs.shoeGarmentFile) {
    log?.warn(
      `patchWorkflow: shoe garment provided but workflow "${tmpl.slug}" has no shoe_node_id — skipping`,
    );
  }
```

Replace with:

```ts
  // Required image node — pose is the only role every workflow has (it's what
  // selected this workflow in the first place — see the spec).
  requireNode(workflow, tmpl.poseNodeId, 'pose').inputs.image = inputs.poseFile;

  // Face and background are optional per-workflow — only patch when the workflow
  // actually declares the role (tmpl.faceNodeId/bgNodeId non-null).
  if (tmpl.faceNodeId) {
    requireNode(workflow, tmpl.faceNodeId, 'face').inputs.image = inputs.faceSideFile ?? '';
  }
  if (tmpl.bgNodeId) {
    requireNode(workflow, tmpl.bgNodeId, 'bg').inputs.image = inputs.backgroundFile ?? '';
  }

  // Upper garment — patch all mapped nodes. Empty tmpl.upperNodeIds (lower/inner-
  // primary workflow) means this loop simply does nothing.
  for (const uid of tmpl.upperNodeIds) {
    const upperNode = workflow[uid];
    if (upperNode && inputs.upperGarmentFile) upperNode.inputs.image = inputs.upperGarmentFile;
  }

  // Lower garment — falls back to the upper garment file when not itself provided,
  // so an upper-primary workflow that also has a lower accessory node never gets a
  // stale/empty filename. When there's no upper file either (lower-primary job),
  // leave the node's existing value untouched rather than patching in "undefined".
  if (tmpl.lowerNodeId) {
    const lowerNode = workflow[tmpl.lowerNodeId];
    if (lowerNode) {
      const lowerFile = inputs.lowerGarmentFile ?? inputs.upperGarmentFile;
      if (lowerFile) {
        if (!inputs.lowerGarmentFile) {
          log?.warn(
            `patchWorkflow: lowerNodeId "${tmpl.lowerNodeId}" mapped but no lower garment provided — falling back to upper garment`,
          );
        }
        lowerNode.inputs.image = lowerFile;
      }
    }
  } else if (inputs.lowerGarmentFile) {
    log?.warn(
      `patchWorkflow: lower garment provided but workflow "${tmpl.slug}" has no lower_node_id — skipping`,
    );
  }

  // Shoe — same fallback pattern as lower garment
  if (tmpl.shoeNodeId) {
    const shoeNode = workflow[tmpl.shoeNodeId];
    if (shoeNode) {
      const shoeFile = inputs.shoeGarmentFile ?? inputs.upperGarmentFile;
      if (shoeFile) {
        if (!inputs.shoeGarmentFile) {
          log?.warn(
            `patchWorkflow: shoeNodeId "${tmpl.shoeNodeId}" mapped but no shoe garment provided — falling back to upper garment`,
          );
        }
        shoeNode.inputs.image = shoeFile;
      }
    }
  } else if (inputs.shoeGarmentFile) {
    log?.warn(
      `patchWorkflow: shoe garment provided but workflow "${tmpl.slug}" has no shoe_node_id — skipping`,
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @aivastra/dispatcher exec vitest run --config vitest.config.ts src/workflow/patcher.test.ts --reporter=verbose`

Expected: PASS — all tests green, including the pre-existing ones (the required-nodes `describe` block from before this task still exercises the unconditional pose patch plus face/bg/upper all being present in `BASE_INPUTS` and `makeTemplate()`'s defaults, so nothing there changes behavior).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @aivastra/dispatcher exec tsc -p tsconfig.json --noEmit`

Expected: no output, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dispatcher/src/workflow/patcher.ts apps/dispatcher/src/workflow/patcher.test.ts
git commit -m "feat(dispatcher): patcher guards optional face/background/upper roles"
```

---

### Task 6: Dispatcher processor — conditional uploads + defensive guards elsewhere

**Files:**
- Modify: `apps/dispatcher/src/job/processor.ts`
- Test: `apps/dispatcher/test/integration/lower-only.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `apps/dispatcher/test/integration/lower-only.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKER_ID = 'test-worker-lower-only';

describe('dispatcher — lower-only (no upper, no face, no bg node) job', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl);
    pub = new Redis(env.redisUrl);
    comfy = await startComfyMock();

    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url, apiKey: 'test-key' }]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');
  }, 60_000);

  afterAll(async () => {
    await deregisterWorker(redis, WORKER_ID);
    await comfy.close();
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  beforeEach(async () => {
    comfy.setOptions({});
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');
  });

  async function seedJob() {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `lower-only-${Date.now()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    await env.db.insert(schema.userCredits).values({ userId: user?.id, balance: 5 });

    const [wf] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `lower-only-dispatch-${Date.now()}`,
        label: 'Lower Only',
        jsonContent: {
          '1': { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'pose' } },
          '2': { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'lower' } },
          '3': { inputs: { prompt: 'x' }, class_type: 'CLIPTextEncode', _meta: { title: 'pos' } },
        },
        workflowType: 'regular',
        poseNodeId: '1',
        lowerNodeId: '2',
        upperNodeIds: [],
        garmentPhasePromptNode: '3',
      })
      .returning();

    const [face] = await env.db
      .insert(schema.modelFaces)
      .values({ label: 'F', genderSlug: 'men', r2Key: 'face/f.jpg', thumbnailKey: 'face/f.jpg' })
      .returning();
    const [bg] = await env.db
      .insert(schema.modelBackgrounds)
      .values({ label: 'B', r2Key: 'bg/b.jpg', thumbnailKey: 'bg/b.jpg' })
      .returning();
    const [pose] = await env.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'P',
        r2Key: 'pose/p.jpg',
        thumbnailKey: 'pose/p.jpg',
        genderSlug: 'men',
        workflowTemplateId: wf.id,
      })
      .returning();

    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId: user?.id, status: 'QUEUED', priority: false, creditsCharged: 1, source: 'catalog' })
      .returning();

    await env.db.insert(schema.jobInputs).values({
      jobId: job?.id,
      upperGarmentKey: null,
      lowerGarmentKey: `inputs/${job?.id}/garment.jpg`,
      faceId: face.id,
      backgroundId: bg.id,
      poseId: pose.id,
    });

    for (const key of ['face/f.jpg', 'bg/b.jpg', 'pose/p.jpg', `inputs/${job?.id}/garment.jpg`]) {
      await env.s3.send(
        new PutObjectCommand({
          Bucket: env.r2Bucket,
          Key: key,
          Body: Buffer.from('stub'),
          ContentType: 'image/jpeg',
        }),
      );
    }

    return { jobId: job?.id, userId: user?.id };
  }

  it('processes a job with no upper garment to COMPLETED, patches only the lower node', async () => {
    const { jobId, userId } = await seedJob();
    const log = createLogger('test');

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      'mock-msg-id',
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('COMPLETED');

    const sentPrompt = comfy.lastPrompt();
    expect(sentPrompt).not.toBeNull();
    // The lower node (id "2") got patched with an uploaded filename; nothing crashed
    // trying to patch a nonexistent upper/face/bg role.
    expect(sentPrompt?.prompt['2']?.inputs?.image).toMatch(/^uploaded-/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @aivastra/dispatcher exec vitest run --config vitest.integration.config.ts test/integration/lower-only.test.ts --reporter=verbose`

Expected: FAIL — `uploadToComfy(inputs.upperGarmentKey, 'garment')` is called unconditionally in `processor.ts`, and `inputs.upperGarmentKey` is `null` for this job, so the R2 download step throws (`GetObjectCommand` with a `null` Key).

- [ ] **Step 3: Make the upload step conditional on which keys are actually present**

In `apps/dispatcher/src/job/processor.ts`, find:

```ts
    // 4. Upload only the images that ComfyUI actually needs.
    // Display images (faceRow.r2Key, bgRow.r2Key) are UI-only and never sent to ComfyUI.
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

Replace with:

```ts
    // 4. Upload only the images that ComfyUI actually needs — a lower/inner-primary
    // workflow may have no upper role (inputs.upperGarmentKey null) and/or no face/
    // background role (tmpl.faceNodeId/bgNodeId null, resolved above into
    // effectiveWorkflowTemplateId's template — checked via tmpl below). Fixed
    // positions in the Promise.all array (not push()-based) so there's no manual
    // index bookkeeping to get wrong as more roles become optional.
    jobLog.info('uploading inputs to ComfyUI');
    const [tmplForUpload] = await db
      .select({ faceNodeId: schema.workflowTemplates.faceNodeId, bgNodeId: schema.workflowTemplates.bgNodeId })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, workflowTemplateId));
    const needsFace = Boolean(tmplForUpload?.faceNodeId);
    const needsBg = Boolean(tmplForUpload?.bgNodeId);

    const [upperGarmentFile, faceSideFile, poseFile, backgroundFile, lowerGarmentFile, shoeGarmentFile] =
      await Promise.all([
        inputs.upperGarmentKey ? uploadToComfy(inputs.upperGarmentKey, 'garment') : Promise.resolve(undefined),
        needsFace ? uploadToComfy(faceSideKey, 'face') : Promise.resolve(undefined),
        uploadToComfy(poseKey, 'pose'),
        needsBg ? uploadToComfy(bgKey, 'bg') : Promise.resolve(undefined),
        lowerKey ? uploadToComfy(lowerKey, 'lower') : Promise.resolve(undefined),
        shoeKey ? uploadToComfy(shoeKey, 'shoe') : Promise.resolve(undefined),
      ]);
```

- [ ] **Step 4: Update the `patchWorkflow` call site to match the now-optional fields**

In the same file, find:

```ts
    const { prompt, resultNodeId } = await patchWorkflow(
      {
        workflowTemplateId,
        upperGarmentFile,
        faceSideFile,
        poseFile,
        backgroundFile,
        lowerGarmentFile,
        shoeGarmentFile,
        promptFacePhase: effectivePromptFacePhase ?? undefined,
        promptGarmentPhase: effectivePromptGarmentPhase ?? undefined,
        aspectRatio: jobAspectRatio,
        outputWidth: jobOutputWidth,
        outputHeight: jobOutputHeight,
      },
      db,
      jobLog,
    );
```

This block needs no code change — `upperGarmentFile`/`faceSideFile`/`backgroundFile` are now typed `string | undefined` from Step 3's destructure, matching `WorkflowInputs`'s now-optional fields from Task 5. Confirm it still compiles (checked in Step 6 below).

- [ ] **Step 5: Add defensive null-guards to the two other processor functions that read `inputs.upperGarmentKey` unguarded**

These are unrelated job types (tryon-direct and widget) that never actually produce a null `upperGarmentKey` in practice — their own request schemas always require it — but the column is now nullable at the type level, so TypeScript needs an explicit narrowing, and a defensive runtime guard is the correct way to provide one.

In the same file, find (inside `processTryonDirectJob`):

```ts
  const personKey = params.personKey as string;
  const workflowTemplateId = params.workflowTemplateId as string;
  const garmentKey = inputs.upperGarmentKey;

  if (!workflowTemplateId) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_WORKFLOW', jobLog, startedAt);
    return;
  }
```

Replace with:

```ts
  const personKey = params.personKey as string;
  const workflowTemplateId = params.workflowTemplateId as string;
  const garmentKey = inputs.upperGarmentKey;

  if (!workflowTemplateId) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_WORKFLOW', jobLog, startedAt);
    return;
  }
  // Defensive — tryon-direct jobs always set upperGarmentKey to keys.output(sourceJobId)
  // at creation time (create.ts's createSimpleTryonJob), never null in practice. The
  // column is nullable at the type level because it's shared with the regular catalog
  // flow, where it genuinely can be null.
  if (!garmentKey) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'MISSING_GARMENT_KEY', jobLog, startedAt);
    return;
  }
```

Then find (inside `processWidgetJob`, after the `if (!job.customerPhotoKey) { ... }` block):

```ts
  if (!job.customerPhotoKey) {
    await markWidgetFailed(
```

Read enough of that existing block to locate its closing `}`, then insert immediately after it (same indentation level as the `if (!job.customerPhotoKey)` block):

```ts
  // Defensive — widget jobs always set upperGarmentKey from a real merchant-catalog
  // r2Key at creation time, never null in practice. The column is nullable at the
  // type level because it's shared with the regular catalog flow.
  if (!inputs.upperGarmentKey) {
    await markWidgetFailed(
      cfg,
      jobId,
      merchantId,
      creditsCharged,
      stream,
      messageId,
      'MISSING_GARMENT_KEY',
      jobLog,
      startedAt,
    );
    return;
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @aivastra/dispatcher exec vitest run --config vitest.integration.config.ts test/integration/lower-only.test.ts --reporter=verbose`

Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @aivastra/dispatcher exec tsc -p tsconfig.json --noEmit`

Expected: no output, no errors. If `processWidgetJob`'s downstream code (past your inserted guard) still shows a "possibly null" error for `inputs.upperGarmentKey`, it means the guard was inserted in the wrong place relative to where TypeScript's control-flow analysis re-reads `inputs.upperGarmentKey` vs a narrowed local — in that case, capture it into a local const right after the guard (`const garmentKey = inputs.upperGarmentKey;`) and use `garmentKey` for the rest of the function instead of re-reading `inputs.upperGarmentKey`.

- [ ] **Step 8: Run existing dispatcher integration tests to confirm no regression**

Run: `pnpm --filter @aivastra/dispatcher exec vitest run --config vitest.integration.config.ts test/integration/retry.test.ts test/integration/shopify.test.ts test/integration/watermark-fail-closed.test.ts test/integration/watermark-snapshot.test.ts --reporter=verbose`

Expected: same pass/fail status as before this plan's changes. (`happy-path.test.ts` and `recovery.test.ts` are pre-existing broken tests — per `apps/api/vitest.config.ts`'s own documented known-failures comment for the equivalent API-side issue, these dispatcher tests seed `job_inputs` with `modelCatalogId`/`poseCatalogId`/`backgroundCatalogId`, fields that don't exist in the current schema. That's a pre-existing bug unrelated to this plan — do not fix it here, and do not treat its failure as a regression caused by this task.)

- [ ] **Step 9: Commit**

```bash
git add apps/dispatcher/src/job/processor.ts apps/dispatcher/test/integration/lower-only.test.ts
git commit -m "feat(dispatcher): conditional uploads for optional workflow roles, defensive guards elsewhere"
```

---

### Task 7: Update progress log

**Files:**
- Modify: `docs/progress.md`

- [ ] **Step 1: Add a dated entry at the top**

Prepend to `docs/progress.md`:

```markdown
## 2026-07-14 - Flexible Workflow Roles (Sub-project A of wear-type support)

### Done
- `workflow_templates.faceNodeId`/`bgNodeId`/`facePhasePromptNode` relaxed to nullable; `upperNodeIds` may now be an empty array. `poseNodeId` and `garmentPhasePromptNode` stay mandatory — pose is the only mechanism that selects which workflow runs, and every workflow has at least one garment slot. A workflow's roles are now implicit in which node-ID columns are populated, replacing the old fixed `workflowType='regular'` required-field list.
- `job_inputs.upperGarmentKey` relaxed to nullable. `CreateTryOnJobInputs.upperGarmentKey` is now optional, with a new refine requiring at least one of `upperGarmentKey`/`lowerGarmentKey`. `faceId`/`backgroundId` deliberately stay mandatory — the studio always asks for them today regardless of which workflow ends up handling the job; only the garment upload itself varies.
- Admin `POST /admin/workflows` floor validation: `poseNodeId` + `garmentPhasePromptNode` + at least one garment slot required; `facePhasePromptNode` required only when `faceNodeId` is set. `PATCH /admin/workflows/:id` can now explicitly clear `faceNodeId`/`bgNodeId`/`facePhasePromptNode` back to null.
- Dispatcher patcher (`applyWorkflowPatch`) and the regular catalog-flow logic inline in `processJob` (`processor.ts`) both guard the now-optional roles — face/background are only patched/uploaded when the resolved workflow actually has that node.
- Traced the full ripple of `job_inputs.upperGarmentKey` becoming nullable across every job type sharing that column (saree, tryon-direct, widget, shopify, kiosk, merchant) — most read sites were already null-safe; added defensive guards to the two that weren't (`processTryonDirectJob`, `processWidgetJob` in the dispatcher), both purely for type-safety since those job types never produce a null value in practice.
- Spec: `docs/superpowers/specs/2026-07-14-flexible-workflow-roles-design.md`. Plan: `docs/superpowers/plans/2026-07-14-flexible-workflow-roles.md`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- This is Sub-project A of a two-part feature. Sub-project B — the studio wizard's gender → wear-type (upper/lower/inner/full-set) → garment-type selection UX, plus `garment_subcategories` gaining a wear-type classification — is a separate, not-yet-started spec/plan that depends on this one.
- `lowerCatalogId`-as-hero (picking a lower garment from the admin catalog instead of uploading one) is out of scope here; the job-creation refine only recognizes uploads (`upperGarmentKey`/`lowerGarmentKey`). Catalog-as-hero is a Sub-project B UX decision.
```

- [ ] **Step 2: Commit**

```bash
git add docs/progress.md
git commit -m "docs(progress): log flexible workflow roles feature"
```

---

## Review Checklist

Since Codex implements this plan externally, use this checklist when reviewing the actual diff against it:

1. **Task 1** — Confirm exactly four columns lost `NOT NULL` (`workflow_templates.face_node_id`, `bg_node_id`, `face_phase_prompt_node`; `job_inputs.upper_garment_key`) and nothing else. `pose_node_id` and `garment_phase_prompt_node` must still be `NOT NULL`.
2. **Task 2/3** — Does the new `CreateWorkflowBody` superRefine actually reject a workflow with neither `upperNodeIds` nor `lowerNodeId`? Does it reject `faceNodeId` set without `facePhasePromptNode`? Does `PATCH` genuinely persist an explicit `null` for `faceNodeId` (not just silently ignore it)?
3. **Task 4** — Confirm `faceId`/`backgroundId` were **not** touched — only `upperGarmentKey` became optional. If Codex also loosened `faceId`/`backgroundId`, that's scope creep beyond this plan and beyond what the processor/dispatcher changes actually support (their resolution logic was deliberately left unconditional).
4. **Task 5** — Confirm `poseNodeId`'s `requireNode` call is still unconditional (unguarded) — pose must never become skippable. Confirm the lower/shoe fallback no longer writes `undefined` into a node's `inputs.image` when there's no upper file.
5. **Task 6** — Confirm the upload step is genuinely conditional (not just wrapped in a try/catch that swallows the error) — the fixed-position `Promise.all` destructure should have `Promise.resolve(undefined)` in the skipped slots, not a `push()`-based array with manual index tracking (the old fragile pattern this task deliberately replaced).
6. **Task 6, Step 5** — Confirm the two defensive guards were added to the *correct* functions (`processTryonDirectJob`, `processWidgetJob`) and not, say, papered over with a blanket non-null assertion instead of an actual runtime check.
7. **General** — Nothing in this plan should touch `apps/catalogues-web` (the studio wizard) or `garment_subcategories` — both are explicitly Sub-project B. Flag any such change as out-of-scope.
