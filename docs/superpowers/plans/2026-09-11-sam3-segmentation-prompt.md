# SAM3 Segmentation Node Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin view and edit the text prompt of a workflow template's SAM3 Segmentation node, the same way `stage1PositivePromptNode`/`garmentPhasePromptNode` are already editable today.

**Architecture:** Two new columns on `workflow_templates` (and its archive table) — a nullable node-ID pointer and a `NOT NULL DEFAULT ''` default-prompt text — following the existing `stage1PositivePromptNode`/`defaultStage1PositivePrompt` pattern exactly: template-level only, no per-pose override, no dispatcher involvement (editing the prompt writes straight into the template's own `jsonContent`, same as every other admin-editable prompt field). Validation only checks the node exists (no `class_type` check, since a SAM3 node won't classify as `'prompt'` under the existing `TextEncode`-based check), and there is no auto-detection — the admin types the node ID directly.

**Tech Stack:** Fastify 5 + Zod (API), Drizzle ORM + PostgreSQL (schema/migration), React + Vite (admin-web), Vitest (integration tests).

## Global Constraints

- No schema or migration work against production — run `pnpm db:generate`/`pnpm db:migrate` locally only (per `CLAUDE.md` Production safety).
- Never inline-mutate a workflow template's `jsonContent` — always read → clone/patch → write back (the existing route code already follows this; new code must too).
- No raw `<select>` — this feature adds only `<input>`/`<textarea>` fields, so this doesn't apply, but don't introduce one.
- `pnpm --filter @aivastra/api test:integration` requires `pnpm docker:up` running first.
- Commit only complete, working units (schema+migration together, each route change with its tests, each UI component with a working build) — not one-line fragments.

---

### Task 1: Database schema + migration

**Files:**
- Modify: `packages/db/src/schema/models.ts:189-269` (`workflowTemplates` table)
- Modify: `packages/db/src/schema/models.ts:277-327` (`workflowTemplateArchives` table)
- Create: `packages/db/src/migrations/0198_*.sql` (name chosen by `drizzle-kit generate`)

**Interfaces:**
- Produces: `schema.workflowTemplates.samSegmentationPromptNode` (`text`, nullable), `schema.workflowTemplates.defaultSamSegmentationPrompt` (`text`, `NOT NULL DEFAULT ''`), and the same two columns on `schema.workflowTemplateArchives` — consumed by Tasks 3-5.

- [ ] **Step 1: Add the two columns to `workflowTemplates`**

In `packages/db/src/schema/models.ts`, find:

```ts
  stage1PositivePromptNode: text('stage1_positive_prompt_node'),
  stage1NegativePromptNode: text('stage1_negative_prompt_node'),
```

(inside the `workflowTemplates` table definition, around line 222-223) and add immediately after:

```ts
  stage1PositivePromptNode: text('stage1_positive_prompt_node'),
  stage1NegativePromptNode: text('stage1_negative_prompt_node'),

  // SAM3 Segmentation node — names the segmentation target (e.g. "person",
  // "garment"). Nullable: most templates have no SAM3 node. Template-level
  // only — no per-pose override, no dispatcher patching. Editing the prompt
  // writes straight into jsonContent, same as stage1PositivePrompt above.
  samSegmentationPromptNode: text('sam_segmentation_prompt_node'),
```

Then find:

```ts
  defaultStage1PositivePrompt: text('default_stage1_positive_prompt').notNull().default(''),
  defaultStage1NegativePrompt: text('default_stage1_negative_prompt').notNull().default(''),
```

(around line 228-229) and add immediately after:

```ts
  defaultStage1PositivePrompt: text('default_stage1_positive_prompt').notNull().default(''),
  defaultStage1NegativePrompt: text('default_stage1_negative_prompt').notNull().default(''),
  defaultSamSegmentationPrompt: text('default_sam_segmentation_prompt').notNull().default(''),
```

- [ ] **Step 2: Add the same two columns to `workflowTemplateArchives`**

In the same file, find (inside `workflowTemplateArchives`, around line 300-307):

```ts
    facePhasePromptNode: text('face_phase_prompt_node'),
    garmentPhasePromptNode: text('garment_phase_prompt_node').notNull(),
    stage1PositivePromptNode: text('stage1_positive_prompt_node'),
    stage1NegativePromptNode: text('stage1_negative_prompt_node'),
    defaultFacePhasePrompt: text('default_face_phase_prompt').notNull().default(''),
    defaultGarmentPhasePrompt: text('default_garment_phase_prompt').notNull().default(''),
    defaultStage1PositivePrompt: text('default_stage1_positive_prompt').notNull().default(''),
    defaultStage1NegativePrompt: text('default_stage1_negative_prompt').notNull().default(''),
```

Replace with:

```ts
    facePhasePromptNode: text('face_phase_prompt_node'),
    garmentPhasePromptNode: text('garment_phase_prompt_node').notNull(),
    stage1PositivePromptNode: text('stage1_positive_prompt_node'),
    stage1NegativePromptNode: text('stage1_negative_prompt_node'),
    samSegmentationPromptNode: text('sam_segmentation_prompt_node'),
    defaultFacePhasePrompt: text('default_face_phase_prompt').notNull().default(''),
    defaultGarmentPhasePrompt: text('default_garment_phase_prompt').notNull().default(''),
    defaultStage1PositivePrompt: text('default_stage1_positive_prompt').notNull().default(''),
    defaultStage1NegativePrompt: text('default_stage1_negative_prompt').notNull().default(''),
    defaultSamSegmentationPrompt: text('default_sam_segmentation_prompt').notNull().default(''),
```

- [ ] **Step 3: Generate the migration**

Run (requires `pnpm docker:up` running so drizzle-kit can introspect the dev DB):

```bash
pnpm --filter @aivastra/db db:generate
```

Expected: a new file `packages/db/src/migrations/0198_<random-name>.sql` containing 4 `ALTER TABLE` statements (2 columns × 2 tables), and `packages/db/src/migrations/meta/_journal.json` gains a new entry. Open the generated SQL and confirm it looks like:

```sql
ALTER TABLE "workflow_templates" ADD COLUMN "sam_segmentation_prompt_node" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "default_sam_segmentation_prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_template_archives" ADD COLUMN "sam_segmentation_prompt_node" text;--> statement-breakpoint
ALTER TABLE "workflow_template_archives" ADD COLUMN "default_sam_segmentation_prompt" text DEFAULT '' NOT NULL;
```

If drizzle-kit orders or splits the statements differently, that's fine — just confirm all 4 `ADD COLUMN`s are present and no unrelated table is touched.

- [ ] **Step 4: Apply the migration locally**

```bash
pnpm db:migrate
```

Expected: output includes the new migration file name with no error.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/models.ts packages/db/src/migrations/
git commit -m "feat(db): add SAM3 segmentation prompt columns to workflow_templates"
```

---

### Task 2: Zod schemas (`packages/types`)

**Files:**
- Modify: `packages/types/src/admin.ts:409-560` (`CreateWorkflowBody`, `UpdateWorkflowBody`)
- Test: `packages/types/src/admin.test.ts`

**Interfaces:**
- Consumes: nothing new (pure Zod schema change).
- Produces: `CreateWorkflowBody` accepts optional `samSegmentationPromptNode: string`. `UpdateWorkflowBody` accepts optional `samSegmentationPromptNode: string` and `samSegmentationPrompt: string` — consumed by Task 3 (create) and Task 4 (patch).

- [ ] **Step 1: Write the failing test**

Open `packages/types/src/admin.test.ts` and add a new `describe` block (the file currently only tests `ReplaceWorkflowBody`; add this alongside the existing one, same file):

```ts
import { CreateWorkflowBody, UpdateWorkflowBody } from './admin.js';

describe('CreateWorkflowBody — samSegmentationPromptNode', () => {
  const base = {
    slug: 'test_workflow',
    label: 'Test workflow',
    jsonContent: {},
    workflowType: 'regular' as const,
    poseNodeId: 'pose_node',
    upperNodeIds: ['upper_node'],
    garmentPhasePromptNode: 'positive_node',
  };

  it('accepts an optional samSegmentationPromptNode', () => {
    const result = CreateWorkflowBody.safeParse({
      ...base,
      samSegmentationPromptNode: 'sam_node',
    });
    expect(result.success).toBe(true);
  });

  it('parses fine when samSegmentationPromptNode is omitted', () => {
    const result = CreateWorkflowBody.safeParse(base);
    expect(result.success).toBe(true);
  });
});

describe('UpdateWorkflowBody — samSegmentationPromptNode / samSegmentationPrompt', () => {
  it('accepts both fields together', () => {
    const result = UpdateWorkflowBody.safeParse({
      samSegmentationPromptNode: 'sam_node',
      samSegmentationPrompt: 'person',
    });
    expect(result.success).toBe(true);
  });

  it('accepts samSegmentationPrompt alone (route handler enforces the node-id-exists rule, not Zod)', () => {
    const result = UpdateWorkflowBody.safeParse({ samSegmentationPrompt: 'person' });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @aivastra/types test admin.test.ts
```

Expected: FAIL — `samSegmentationPromptNode`/`samSegmentationPrompt` are stripped by Zod's default unknown-key handling only if the schema uses `.strict()`; check the actual failure. Since `CreateWorkflowBody`/`UpdateWorkflowBody` are plain `z.object()` (not `.strict()`), unknown keys are silently dropped, not rejected — so `safeParse` still returns `success: true` even before the fields exist. The two "accepts" tests will therefore pass vacuously; that's expected and fine here since the real behavioral test is at the route level (Tasks 3-4) where the value must actually be *used*. Confirm this test run passes for the "omitted"/"alone" cases (which don't depend on the new fields at all) and treat the "accepts" tests as a light schema-shape smoke check, not proof of wiring — the integration tests in Tasks 3-4 are what prove the field is read and acted on.

- [ ] **Step 3: Add the fields to the schemas**

In `packages/types/src/admin.ts`, find (inside `CreateWorkflowBody`, around line 459-460):

```ts
    stage1PositivePromptNode: z.string().min(1).optional(),
    stage1NegativePromptNode: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
```

Replace with:

```ts
    stage1PositivePromptNode: z.string().min(1).optional(),
    stage1NegativePromptNode: z.string().min(1).optional(),
    // SAM3 Segmentation node — optional on every workflow type, no superRefine
    // requirement (unlike stage1/tryon prompt nodes, nothing requires this to
    // be set). See docs/superpowers/specs/2026-09-11-sam3-segmentation-prompt-design.md.
    samSegmentationPromptNode: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
```

Then find (inside `UpdateWorkflowBody`, around line 597-598):

```ts
  stage1PositivePromptNode: z.string().min(1).optional(),
  stage1NegativePromptNode: z.string().min(1).optional(),
```

Replace with:

```ts
  stage1PositivePromptNode: z.string().min(1).optional(),
  stage1NegativePromptNode: z.string().min(1).optional(),
  samSegmentationPromptNode: z.string().min(1).optional(),
```

Then find (further down in `UpdateWorkflowBody`, around line 633-634):

```ts
  stage1PositivePrompt: z.string().optional(),
  stage1NegativePrompt: z.string().optional(),
```

Replace with:

```ts
  stage1PositivePrompt: z.string().optional(),
  stage1NegativePrompt: z.string().optional(),
  // No .min(1) — emptiness (and "no node configured yet") is enforced in the
  // route handler, same convention as the sibling prompt-text fields above.
  samSegmentationPrompt: z.string().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @aivastra/types test admin.test.ts
```

Expected: PASS (all 4 new tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/admin.ts packages/types/src/admin.test.ts
git commit -m "feat(types): add samSegmentationPromptNode/samSegmentationPrompt to workflow schemas"
```

---

### Task 3: API — create path + list endpoint

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts:196-687` (`extractWorkflowInsertFields`, `GET /admin/workflows`)
- Test: `apps/api/test/integration/admin-workflows.test.ts`

**Interfaces:**
- Consumes: `CreateWorkflowBody.samSegmentationPromptNode` (Task 2), `schema.workflowTemplates.samSegmentationPromptNode`/`defaultSamSegmentationPrompt` (Task 1), the existing module-private `validateNodeExists(json, nodeId, role)` and `extractPromptText(node)` helpers (already in this file, lines 79-115).
- Produces: `extractWorkflowInsertFields(body)` return objects now always include `samSegmentationPromptNode: string | null` and `defaultSamSegmentationPrompt: string` — consumed by Task 5's replace route (which calls the same function).

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/integration/admin-workflows.test.ts`, add a new `describe` block at the end of the file (after the last existing `describe`, at module scope, reusing the top-level `c`/`app`/`headers` from the file's own `beforeAll`/`afterAll` — this file has one shared `describe('admin workflows - floor validation', ...)` wrapping everything, so nest this new block *inside* that same outer describe, as a sibling to `describe('workflow replace with drain', ...)` and `describe('regeneration workflows', ...)`):

```ts
  describe('SAM3 segmentation prompt node', () => {
    const samJsonContent = {
      ...jsonContent,
      sam_node: {
        inputs: { prompt: 'person' },
        class_type: 'Sam3Segmentation',
        _meta: { title: 'sam3_segmentation' },
      },
    };

    it('creates a workflow with samSegmentationPromptNode and extracts its default prompt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_create_${Date.now()}`,
          label: 'SAM3 create test',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          samSegmentationPromptNode: 'sam_node',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.samSegmentationPromptNode).toBe('sam_node');
      expect(body.defaultSamSegmentationPrompt).toBe('person');
    });

    it('creates a workflow with no samSegmentationPromptNode — defaults stay null/empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_absent_${Date.now()}`,
          label: 'SAM3 absent test',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.samSegmentationPromptNode ?? null).toBeNull();
      expect(body.defaultSamSegmentationPrompt).toBe('');
    });

    it('rejects a nonexistent samSegmentationPromptNode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_bad_node_${Date.now()}`,
          label: 'SAM3 bad node test',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          samSegmentationPromptNode: 'does_not_exist',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('GET /admin/workflows list includes samSegmentationPromptNode/defaultSamSegmentationPrompt', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_list_${Date.now()}`,
          label: 'SAM3 list test',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          samSegmentationPromptNode: 'sam_node',
        },
      });
      const id = createRes.json().id as string;

      const listRes = await app.inject({ method: 'GET', url: '/admin/workflows', headers });
      expect(listRes.statusCode).toBe(200);
      const row = (listRes.json() as { id: string }[]).find((w) => w.id === id) as {
        samSegmentationPromptNode: string | null;
        defaultSamSegmentationPrompt: string;
      };
      expect(row.samSegmentationPromptNode).toBe('sam_node');
      expect(row.defaultSamSegmentationPrompt).toBe('person');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm docker:up
pnpm --filter @aivastra/api test:integration -- admin-workflows
```

Expected: FAIL — the first test fails on `expect(body.samSegmentationPromptNode).toBe('sam_node')` (actual: `undefined`, since the field is neither read from the body nor selected in the response yet); the third test fails because no validation runs for an unknown `samSegmentationPromptNode`, so it succeeds (200) instead of the expected 400; the fourth fails the same way as the first.

- [ ] **Step 3: Wire the field into `extractWorkflowInsertFields`**

In `apps/api/src/modules/admin/workflows.routes.ts`, find the top of the function (line 196-198):

```ts
function extractWorkflowInsertFields(body: z.infer<typeof CreateWorkflowBody>) {
  const workflowType = body.workflowType ?? 'regular';

  if (workflowType === 'saree_step1_two_input') {
```

Replace with:

```ts
function extractWorkflowInsertFields(body: z.infer<typeof CreateWorkflowBody>) {
  const workflowType = body.workflowType ?? 'regular';

  // SAM3 Segmentation node — generic across every workflow type, computed
  // once here rather than duplicated per branch below. No validateNodeType
  // call: a SAM3 node's class_type won't classify as 'prompt' under the
  // TextEncode-based check, so only existence is validated. See
  // docs/superpowers/specs/2026-09-11-sam3-segmentation-prompt-design.md.
  if (body.samSegmentationPromptNode) {
    validateNodeExists(body.jsonContent, body.samSegmentationPromptNode, 'SAM3 segmentation prompt');
  }
  const samSegmentationPromptNode = body.samSegmentationPromptNode ?? null;
  const defaultSamSegmentationPrompt = body.samSegmentationPromptNode
    ? extractPromptText(body.jsonContent[body.samSegmentationPromptNode] as WorkflowNode | undefined)
    : '';

  if (workflowType === 'saree_step1_two_input') {
```

Now add `samSegmentationPromptNode,` and `defaultSamSegmentationPrompt,` to each of the 5 `return { ... }` object literals in this function. Each one currently ends with a block like `tryonOutputNodeId: ...,\n    };` — add the two new lines right before the closing `};` in every branch:

Branch 1 (`saree_step1_two_input`, ends around line 271-275):
```ts
      tryonPersonNodeId: personNodeId || null,
      tryonGarmentNodeId: bodyNodeId,
      tryonGarmentNodeId2: palluNodeId,
      tryonOutputNodeId: outputNodeId,
      samSegmentationPromptNode,
      defaultSamSegmentationPrompt,
    };
  }
```

Branch 2 (`two_stage`, ends around line 373-377):
```ts
      tryonPersonNodeId: null,
      tryonGarmentNodeId: null,
      tryonGarmentNodeId2: null,
      tryonOutputNodeId: null,
      samSegmentationPromptNode,
      defaultSamSegmentationPrompt,
    };
  }
```

Branch 3 (`regeneration`, ends around line 445-449):
```ts
      tryonPersonNodeId: personNodeId,
      tryonGarmentNodeId: null,
      tryonGarmentNodeId2: null,
      tryonOutputNodeId: outputNodeId,
      samSegmentationPromptNode,
      defaultSamSegmentationPrompt,
    };
  }
```

Branch 4 (`tryon`/`saree_step1`, ends around line 519-523):
```ts
      tryonPersonNodeId: personNodeId || null,
      tryonGarmentNodeId: garmentNodeId,
      tryonGarmentNodeId2: null,
      tryonOutputNodeId: outputNodeId,
      samSegmentationPromptNode,
      defaultSamSegmentationPrompt,
    };
  }
```

Branch 5 (`regular`, the function's final `return`, ends around line 602-606):
```ts
      tryonPersonNodeId: null,
      tryonGarmentNodeId: null,
      tryonGarmentNodeId2: null,
      tryonOutputNodeId: null,
      samSegmentationPromptNode,
      defaultSamSegmentationPrompt,
    };
  }
```

(This last one closes the function itself, not an `if` block — same as it does today.)

- [ ] **Step 4: Add the two fields to the `GET /admin/workflows` list mapping**

Find (around line 681-684):

```ts
      stage1PositivePromptNode: r.stage1PositivePromptNode,
      stage1NegativePromptNode: r.stage1NegativePromptNode,
      defaultStage1PositivePrompt: r.defaultStage1PositivePrompt,
      defaultStage1NegativePrompt: r.defaultStage1NegativePrompt,
      createdAt: r.createdAt,
```

Replace with:

```ts
      stage1PositivePromptNode: r.stage1PositivePromptNode,
      stage1NegativePromptNode: r.stage1NegativePromptNode,
      defaultStage1PositivePrompt: r.defaultStage1PositivePrompt,
      defaultStage1NegativePrompt: r.defaultStage1NegativePrompt,
      samSegmentationPromptNode: r.samSegmentationPromptNode,
      defaultSamSegmentationPrompt: r.defaultSamSegmentationPrompt,
      createdAt: r.createdAt,
```

(`POST /admin/workflows` and `GET /admin/workflows/:id` both return `...row`/`...inserted` — a full spread of the DB row — so they pick up the two new columns automatically, with no code change needed.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @aivastra/api test:integration -- admin-workflows
```

Expected: PASS — all 4 new tests green, and no existing test in this file regresses (the new fields are additive; every existing `return` branch still returns every field it did before, plus these two).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/workflows.routes.ts apps/api/test/integration/admin-workflows.test.ts
git commit -m "feat(api): accept samSegmentationPromptNode on workflow creation"
```

---

### Task 4: API — PATCH route

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts:848-1189` (`PATCH /admin/workflows/:id`)
- Test: `apps/api/test/integration/admin-workflows.test.ts`

**Interfaces:**
- Consumes: `UpdateWorkflowBody.samSegmentationPromptNode`/`samSegmentationPrompt` (Task 2), module-private `validateNodeExists`, `extractPromptText`, `writePromptText` (lines 79-142, unchanged).
- Produces: `PATCH /admin/workflows/:id` can now set/change `samSegmentationPromptNode` and edit `samSegmentationPrompt` text, matching the `stage1PositivePromptNode`/`stage1PositivePrompt` pattern exactly.

- [ ] **Step 1: Write the failing tests**

Add to the same `describe('SAM3 segmentation prompt node', ...)` block from Task 3, inside `admin-workflows.test.ts`:

```ts
    async function createSamWorkflow(promptText = 'person') {
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_patch_${Date.now()}_${Math.random()}`,
          label: 'SAM3 patch test',
          jsonContent: {
            ...jsonContent,
            sam_node: {
              inputs: { prompt: promptText },
              class_type: 'Sam3Segmentation',
              _meta: { title: 'sam3_segmentation' },
            },
          },
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      return createRes.json().id as string;
    }

    it('PATCH rejects samSegmentationPrompt when no node is configured', async () => {
      const id = await createSamWorkflow();
      const response = await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${id}`,
        headers,
        payload: { samSegmentationPrompt: 'garment' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('PATCH sets samSegmentationPromptNode alone and recomputes the default from the JSON', async () => {
      const id = await createSamWorkflow('person');
      const response = await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${id}`,
        headers,
        payload: { samSegmentationPromptNode: 'sam_node' },
      });
      expect(response.statusCode).toBe(200);

      const detailRes = await app.inject({ method: 'GET', url: `/admin/workflows/${id}`, headers });
      const detail = detailRes.json();
      expect(detail.samSegmentationPromptNode).toBe('sam_node');
      expect(detail.defaultSamSegmentationPrompt).toBe('person');
    });

    it('PATCH edits samSegmentationPrompt once a node is configured, writing into jsonContent', async () => {
      const id = await createSamWorkflow('person');
      await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${id}`,
        headers,
        payload: { samSegmentationPromptNode: 'sam_node' },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${id}`,
        headers,
        payload: { samSegmentationPrompt: 'garment' },
      });
      expect(response.statusCode).toBe(200);

      const detailRes = await app.inject({ method: 'GET', url: `/admin/workflows/${id}`, headers });
      const detail = detailRes.json();
      expect(detail.defaultSamSegmentationPrompt).toBe('garment');
      expect(
        (detail.jsonContent as Record<string, { inputs: { prompt: string } }>).sam_node.inputs
          .prompt,
      ).toBe('garment');
    });

    it('PATCH rejects a nonexistent samSegmentationPromptNode', async () => {
      const id = await createSamWorkflow();
      const response = await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${id}`,
        headers,
        payload: { samSegmentationPromptNode: 'does_not_exist' },
      });
      expect(response.statusCode).toBe(400);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @aivastra/api test:integration -- admin-workflows
```

Expected: FAIL — the "rejects when no node configured" test gets 200 instead of 400 (the field is silently ignored today); the "sets node alone" and "edits prompt" tests fail because `detail.samSegmentationPromptNode`/`defaultSamSegmentationPrompt` are `undefined`; the "rejects nonexistent node" test gets 200 instead of 400.

- [ ] **Step 3: Implement the PATCH handler changes**

In `apps/api/src/modules/admin/workflows.routes.ts`, find the body type destructure (around line 857-894):

```ts
        stage1PositivePromptNode?: string;
        stage1NegativePromptNode?: string;
        stage1PositivePrompt?: string;
        stage1NegativePrompt?: string;
      };
```

Replace with:

```ts
        stage1PositivePromptNode?: string;
        stage1NegativePromptNode?: string;
        stage1PositivePrompt?: string;
        stage1NegativePrompt?: string;
        samSegmentationPromptNode?: string;
        samSegmentationPrompt?: string;
      };
```

Find the SAM3-adjacent validation block. Right after (around line 946-949):

```ts
      if (body.stage1NegativePromptNode) {
        validateNodeExists(json, body.stage1NegativePromptNode, 'stage-1 negative prompt');
        validateNodeType(json, body.stage1NegativePromptNode, 'prompt', 'stage-1 negative prompt');
      }
```

add:

```ts
      if (body.samSegmentationPromptNode) {
        // No validateNodeType call here — see extractWorkflowInsertFields's
        // comment (Task 3): a SAM3 node's class_type won't classify as
        // 'prompt' under the TextEncode-based check.
        validateNodeExists(json, body.samSegmentationPromptNode, 'SAM3 segmentation prompt');
      }
```

Find (around line 982-983):

```ts
      const newStage1PosNode = body.stage1PositivePromptNode ?? existing.stage1PositivePromptNode;
      const newStage1NegNode = body.stage1NegativePromptNode ?? existing.stage1NegativePromptNode;
```

Replace with:

```ts
      const newStage1PosNode = body.stage1PositivePromptNode ?? existing.stage1PositivePromptNode;
      const newStage1NegNode = body.stage1NegativePromptNode ?? existing.stage1NegativePromptNode;
      const newSamNode = body.samSegmentationPromptNode ?? existing.samSegmentationPromptNode;
```

Find (around line 1022-1031):

```ts
      if (body.stage1NegativePrompt !== undefined) {
        if (!newStage1NegNode) {
          throw new AppError(
            'VALIDATION',
            400,
            'cannot set stage1NegativePrompt: this workflow has no stage-1 negative prompt node',
          );
        }
        writePromptText(json, newStage1NegNode, body.stage1NegativePrompt);
      }
      for (const override of body.ksamplerOverrides ?? []) {
```

Replace with:

```ts
      if (body.stage1NegativePrompt !== undefined) {
        if (!newStage1NegNode) {
          throw new AppError(
            'VALIDATION',
            400,
            'cannot set stage1NegativePrompt: this workflow has no stage-1 negative prompt node',
          );
        }
        writePromptText(json, newStage1NegNode, body.stage1NegativePrompt);
      }
      if (body.samSegmentationPrompt !== undefined) {
        if (!newSamNode) {
          throw new AppError(
            'VALIDATION',
            400,
            'cannot set samSegmentationPrompt: this workflow has no SAM3 segmentation prompt node',
          );
        }
        writePromptText(json, newSamNode, body.samSegmentationPrompt);
      }
      for (const override of body.ksamplerOverrides ?? []) {
```

Find (around line 1049-1063):

```ts
      let defaultStage1PositivePrompt = existing.defaultStage1PositivePrompt;
      let defaultStage1NegativePrompt = existing.defaultStage1NegativePrompt;
      if (
        body.stage1PositivePromptNode ||
        body.stage1NegativePromptNode ||
        body.stage1PositivePrompt !== undefined ||
        body.stage1NegativePrompt !== undefined
      ) {
        defaultStage1PositivePrompt = extractPromptText(
          newStage1PosNode ? (json[newStage1PosNode] as WorkflowNode | undefined) : undefined,
        );
        defaultStage1NegativePrompt = extractPromptText(
          newStage1NegNode ? (json[newStage1NegNode] as WorkflowNode | undefined) : undefined,
        );
      }
```

Replace with:

```ts
      let defaultStage1PositivePrompt = existing.defaultStage1PositivePrompt;
      let defaultStage1NegativePrompt = existing.defaultStage1NegativePrompt;
      if (
        body.stage1PositivePromptNode ||
        body.stage1NegativePromptNode ||
        body.stage1PositivePrompt !== undefined ||
        body.stage1NegativePrompt !== undefined
      ) {
        defaultStage1PositivePrompt = extractPromptText(
          newStage1PosNode ? (json[newStage1PosNode] as WorkflowNode | undefined) : undefined,
        );
        defaultStage1NegativePrompt = extractPromptText(
          newStage1NegNode ? (json[newStage1NegNode] as WorkflowNode | undefined) : undefined,
        );
      }

      let defaultSamSegmentationPrompt = existing.defaultSamSegmentationPrompt;
      if (body.samSegmentationPromptNode || body.samSegmentationPrompt !== undefined) {
        defaultSamSegmentationPrompt = extractPromptText(
          newSamNode ? (json[newSamNode] as WorkflowNode | undefined) : undefined,
        );
      }
```

Find (around line 1065-1080):

```ts
      const updateValues: Record<string, unknown> = {
        updatedAt: new Date(),
        defaultFacePhasePrompt,
        defaultGarmentPhasePrompt,
        defaultStage1PositivePrompt,
        defaultStage1NegativePrompt,
      };
      if (
        body.garmentPhasePrompt !== undefined ||
        body.facePhasePrompt !== undefined ||
        body.stage1PositivePrompt !== undefined ||
        body.stage1NegativePrompt !== undefined ||
        (body.ksamplerOverrides?.length ?? 0) > 0
      ) {
        updateValues.jsonContent = json;
      }
```

Replace with:

```ts
      const updateValues: Record<string, unknown> = {
        updatedAt: new Date(),
        defaultFacePhasePrompt,
        defaultGarmentPhasePrompt,
        defaultStage1PositivePrompt,
        defaultStage1NegativePrompt,
        defaultSamSegmentationPrompt,
      };
      if (
        body.garmentPhasePrompt !== undefined ||
        body.facePhasePrompt !== undefined ||
        body.stage1PositivePrompt !== undefined ||
        body.stage1NegativePrompt !== undefined ||
        body.samSegmentationPrompt !== undefined ||
        (body.ksamplerOverrides?.length ?? 0) > 0
      ) {
        updateValues.jsonContent = json;
      }
```

Find (around line 1112-1115):

```ts
      if (body.stage1PositivePromptNode !== undefined)
        updateValues.stage1PositivePromptNode = body.stage1PositivePromptNode;
      if (body.stage1NegativePromptNode !== undefined)
        updateValues.stage1NegativePromptNode = body.stage1NegativePromptNode;
```

Replace with:

```ts
      if (body.stage1PositivePromptNode !== undefined)
        updateValues.stage1PositivePromptNode = body.stage1PositivePromptNode;
      if (body.stage1NegativePromptNode !== undefined)
        updateValues.stage1NegativePromptNode = body.stage1NegativePromptNode;
      if (body.samSegmentationPromptNode !== undefined)
        updateValues.samSegmentationPromptNode = body.samSegmentationPromptNode;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @aivastra/api test:integration -- admin-workflows
```

Expected: PASS — all 5 new PATCH tests green (4 new + the Task 3 create tests still passing), no regressions in the rest of the file.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/workflows.routes.ts apps/api/test/integration/admin-workflows.test.ts
git commit -m "feat(api): allow PATCH to set/edit the SAM3 segmentation prompt node"
```

---

### Task 5: API — replace route archive snapshot

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts:1263-1293` (`POST /admin/workflows/:id/replace` archive insert)
- Test: `apps/api/test/integration/admin-workflows.test.ts`

**Interfaces:**
- Consumes: `extractWorkflowInsertFields` (already updated in Task 3 — the replace route calls it at line 1213 and spreads the result into the updated row, so no separate change is needed there), `schema.workflowTemplateArchives.samSegmentationPromptNode`/`defaultSamSegmentationPrompt` (Task 1).
- Produces: an archived (draining) template version retains its own SAM3 node ID and default prompt, matching every other node-ID field already archived.

- [ ] **Step 1: Write the failing test**

Add to the same `describe('SAM3 segmentation prompt node', ...)` block, reusing the `seedNonTerminalJobOnTemplate`-style helper (declare a local copy, since the existing one is scoped inside the sibling `describe('workflow replace with drain', ...)` block and isn't accessible here):

```ts
    async function seedNonTerminalJobOnSamTemplate(workflowTemplateId: string, version: number) {
      const [user] = await app.db
        .insert(schema.users)
        .values({
          email: `sam3-drain-${Date.now()}-${Math.random()}@example.com`,
          passwordHash: null,
          tier: 'free',
        })
        .returning();
      const [job] = await app.db
        .insert(schema.jobs)
        .values({ userId: user.id, status: 'QUEUED', creditsCharged: 1 })
        .returning();
      await app.db.insert(schema.jobInputs).values({
        jobId: job.id,
        params: { workflowTemplateId, dispatchTemplateVersion: version },
      });
    }

    it('archives the SAM3 node ID and default prompt when a draining replace occurs', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_replace_${Date.now()}`,
          label: 'SAM3 replace test',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          samSegmentationPromptNode: 'sam_node',
        },
      });
      const id = createRes.json().id as string;
      const version = createRes.json().version as number;

      await seedNonTerminalJobOnSamTemplate(id, version);

      const replaceRes = await app.inject({
        method: 'POST',
        url: `/admin/workflows/${id}/replace`,
        headers,
        payload: {
          slug: `sam3_replace_${Date.now()}`,
          label: 'SAM3 replaced',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          samSegmentationPromptNode: 'sam_node',
          password: 'password123',
        },
      });
      expect(replaceRes.statusCode).toBe(200);
      expect(replaceRes.json().draining).not.toBeNull();

      const [archiveRow] = await app.db
        .select()
        .from(schema.workflowTemplateArchives)
        .where(eq(schema.workflowTemplateArchives.workflowTemplateId, id));
      expect(archiveRow?.samSegmentationPromptNode).toBe('sam_node');
      expect(archiveRow?.defaultSamSegmentationPrompt).toBe('person');
    });
```

Note: this test depends on `samJsonContent` from the `describe` block's top (defined in Task 3's Step 1) — no need to redefine it.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @aivastra/api test:integration -- admin-workflows
```

Expected: FAIL — `archiveRow?.samSegmentationPromptNode` is `undefined` (not `'sam_node'`), since the archive insert doesn't select these columns yet.

- [ ] **Step 3: Add the two fields to the archive insert**

In `apps/api/src/modules/admin/workflows.routes.ts`, find (around line 1287-1292):

```ts
            stage1PositivePromptNode: existing.stage1PositivePromptNode,
            stage1NegativePromptNode: existing.stage1NegativePromptNode,
            defaultFacePhasePrompt: existing.defaultFacePhasePrompt,
            defaultGarmentPhasePrompt: existing.defaultGarmentPhasePrompt,
            defaultStage1PositivePrompt: existing.defaultStage1PositivePrompt,
            defaultStage1NegativePrompt: existing.defaultStage1NegativePrompt,
          });
```

Replace with:

```ts
            stage1PositivePromptNode: existing.stage1PositivePromptNode,
            stage1NegativePromptNode: existing.stage1NegativePromptNode,
            samSegmentationPromptNode: existing.samSegmentationPromptNode,
            defaultFacePhasePrompt: existing.defaultFacePhasePrompt,
            defaultGarmentPhasePrompt: existing.defaultGarmentPhasePrompt,
            defaultStage1PositivePrompt: existing.defaultStage1PositivePrompt,
            defaultStage1NegativePrompt: existing.defaultStage1NegativePrompt,
            defaultSamSegmentationPrompt: existing.defaultSamSegmentationPrompt,
          });
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @aivastra/api test:integration -- admin-workflows
```

Expected: PASS.

- [ ] **Step 5: Run the full API integration suite once, to confirm no cross-test regressions**

```bash
pnpm --filter @aivastra/api test:integration
```

Expected: PASS (all files, including `admin-workflows.test.ts` in full).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/workflows.routes.ts apps/api/test/integration/admin-workflows.test.ts
git commit -m "feat(api): archive the SAM3 segmentation prompt node on workflow replace"
```

---

### Task 6: Admin UI — `WorkflowOption` type + `WorkflowsPage.tsx`

**Files:**
- Modify: `apps/admin-web/src/types.ts:84-113` (`WorkflowOption`)
- Modify: `apps/admin-web/src/pages/WorkflowsPage.tsx` (edit form state, both "Edit" button handlers, the edit drawer, the read-only detail view)

**Interfaces:**
- Consumes: `GET /admin/workflows` and `GET /admin/workflows/:id` now return `samSegmentationPromptNode`/`defaultSamSegmentationPrompt` (Task 3); `PATCH /admin/workflows/:id` accepts `samSegmentationPromptNode`/`samSegmentationPrompt` (Task 4).
- Produces: nothing consumed by a later task — this is the last admin-web piece touching the shared `WorkflowOption` type (Tasks 7-8 only need the type, already exported from `types.ts`).

No automated tests exist for `apps/admin-web` (no test script, no `.test.tsx` files in the package) — verification for this task and Tasks 7-8 is `pnpm --filter @aivastra/admin build`, which runs `tsc -b && vite build` and fails on any type error.

- [ ] **Step 1: Add the two fields to `WorkflowOption`**

In `apps/admin-web/src/types.ts`, find (around line 102-105):

```ts
  stage1PositivePromptNode: string | null;
  stage1NegativePromptNode: string | null;
  defaultStage1PositivePrompt: string;
  defaultStage1NegativePrompt: string;
```

Replace with:

```ts
  stage1PositivePromptNode: string | null;
  stage1NegativePromptNode: string | null;
  defaultStage1PositivePrompt: string;
  defaultStage1NegativePrompt: string;
  // SAM3 Segmentation node — template-level only, no per-pose override. See
  // docs/superpowers/specs/2026-09-11-sam3-segmentation-prompt-design.md.
  samSegmentationPromptNode: string | null;
  defaultSamSegmentationPrompt: string;
```

(`WorkflowDetail` in `WorkflowsPage.tsx` is declared as `interface WorkflowDetail extends WorkflowOption { ... }`, so it inherits these two fields automatically — no change needed there.)

- [ ] **Step 2: Add `samSegmentationPrompt` to the edit form state**

In `apps/admin-web/src/pages/WorkflowsPage.tsx`, find (around line 75-92):

```ts
  const [editForm, setEditForm] = useState({
    label: '',
    slug: '',
    garmentPhasePrompt: '',
    facePhasePrompt: '',
    regenerationReasonPrompts: [] as { reason: string; prompt: string; instruction: string }[],
    stage1PositivePrompt: '',
    stage1NegativePrompt: '',
    latentMaxPx: '',
    outputMaxPx: '',
    ksamplerOverrides: [] as {
      nodeId: string;
      steps: string;
      cfg: string;
      denoise: string;
      seed: string;
    }[],
  });
```

Replace with:

```ts
  const [editForm, setEditForm] = useState({
    label: '',
    slug: '',
    garmentPhasePrompt: '',
    facePhasePrompt: '',
    regenerationReasonPrompts: [] as { reason: string; prompt: string; instruction: string }[],
    stage1PositivePrompt: '',
    stage1NegativePrompt: '',
    samSegmentationPrompt: '',
    latentMaxPx: '',
    outputMaxPx: '',
    ksamplerOverrides: [] as {
      nodeId: string;
      steps: string;
      cfg: string;
      denoise: string;
      seed: string;
    }[],
  });
```

- [ ] **Step 3: Populate `samSegmentationPrompt` at both "Edit" button call sites**

There are two identical `setEditForm({...})` call sites (grid view and expanded/list view of the same workflow row), indented differently since they sit at different JSX nesting depths.

Call site 1 (around line 588-590 — 32-space indent), find:

```ts
                                stage1PositivePrompt: wf.defaultStage1PositivePrompt,
                                stage1NegativePrompt: wf.defaultStage1NegativePrompt,
                                latentMaxPx: String(wf.latentMaxPx ?? ''),
```

Replace with:

```ts
                                stage1PositivePrompt: wf.defaultStage1PositivePrompt,
                                stage1NegativePrompt: wf.defaultStage1NegativePrompt,
                                samSegmentationPrompt: wf.defaultSamSegmentationPrompt,
                                latentMaxPx: String(wf.latentMaxPx ?? ''),
```

Call site 2 (around line 882-884 — 30-space indent), find:

```ts
                              stage1PositivePrompt: wf.defaultStage1PositivePrompt,
                              stage1NegativePrompt: wf.defaultStage1NegativePrompt,
                              latentMaxPx: String(wf.latentMaxPx ?? ''),
```

Replace with:

```ts
                              stage1PositivePrompt: wf.defaultStage1PositivePrompt,
                              stage1NegativePrompt: wf.defaultStage1NegativePrompt,
                              samSegmentationPrompt: wf.defaultSamSegmentationPrompt,
                              latentMaxPx: String(wf.latentMaxPx ?? ''),
```

- [ ] **Step 4: Include `samSegmentationPrompt` in the PATCH payload from `handleEditSave`**

Find (around line 244-249):

```ts
      if (editingWf.stage1PositivePromptNode) {
        patch.stage1PositivePrompt = editForm.stage1PositivePrompt.trim();
      }
      if (editingWf.stage1NegativePromptNode) {
        patch.stage1NegativePrompt = editForm.stage1NegativePrompt.trim();
      }
```

Replace with:

```ts
      if (editingWf.stage1PositivePromptNode) {
        patch.stage1PositivePrompt = editForm.stage1PositivePrompt.trim();
      }
      if (editingWf.stage1NegativePromptNode) {
        patch.stage1NegativePrompt = editForm.stage1NegativePrompt.trim();
      }
      if (editingWf.samSegmentationPromptNode) {
        patch.samSegmentationPrompt = editForm.samSegmentationPrompt.trim();
      }
```

Then find the optimistic local-state update (around line 300-305):

```ts
                ...(editingWf.stage1PositivePromptNode
                  ? { defaultStage1PositivePrompt: editForm.stage1PositivePrompt.trim() }
                  : {}),
                ...(editingWf.stage1NegativePromptNode
                  ? { defaultStage1NegativePrompt: editForm.stage1NegativePrompt.trim() }
                  : {}),
```

Replace with:

```ts
                ...(editingWf.stage1PositivePromptNode
                  ? { defaultStage1PositivePrompt: editForm.stage1PositivePrompt.trim() }
                  : {}),
                ...(editingWf.stage1NegativePromptNode
                  ? { defaultStage1NegativePrompt: editForm.stage1NegativePrompt.trim() }
                  : {}),
                ...(editingWf.samSegmentationPromptNode
                  ? { defaultSamSegmentationPrompt: editForm.samSegmentationPrompt.trim() }
                  : {}),
```

- [ ] **Step 5: Render the "SAM3 segmentation prompt" textarea in the edit drawer**

Find (around line 1412-1425):

```tsx
            {editingWf?.stage1NegativePromptNode && (
              <div className="field">
                <label>Stage 1 negative prompt (build-person pass)</label>
                <textarea
                  className="input"
                  rows={4}
                  value={editForm.stage1NegativePrompt}
                  disabled={editSaving}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, stage1NegativePrompt: e.target.value }))
                  }
                />
              </div>
            )}
```

Add immediately after:

```tsx
            {editingWf?.samSegmentationPromptNode && (
              <div className="field">
                <label>SAM3 segmentation prompt</label>
                <textarea
                  className="input"
                  rows={2}
                  value={editForm.samSegmentationPrompt}
                  disabled={editSaving}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, samSegmentationPrompt: e.target.value }))
                  }
                />
              </div>
            )}
```

- [ ] **Step 6: Add a node-mapping row and a default-prompt preview to the read-only detail view**

Find the tryon-like node-mapping array (around line 998-999):

```ts
                          ['Output node', viewingDetail.tryonOutputNodeId ?? '—'],
                        ]
```

Replace with:

```ts
                          ['Output node', viewingDetail.tryonOutputNodeId ?? '—'],
                          ...(viewingDetail.samSegmentationPromptNode
                            ? [['SAM3 segmentation prompt node', viewingDetail.samSegmentationPromptNode]]
                            : []),
                        ]
```

Find the "regular"/else-branch node-mapping array (around line 1028-1030):

```ts
                          ['Negative prompt node', viewingDetail.facePhasePromptNode],
                          ['Positive prompt node', viewingDetail.garmentPhasePromptNode],
                        ]
```

Replace with:

```ts
                          ['Negative prompt node', viewingDetail.facePhasePromptNode],
                          ['Positive prompt node', viewingDetail.garmentPhasePromptNode],
                          ...(viewingDetail.samSegmentationPromptNode
                            ? [['SAM3 segmentation prompt node', viewingDetail.samSegmentationPromptNode]]
                            : []),
                        ]
```

Find the "Default prompts" section header condition (around line 1054-1055):

```tsx
                {(viewingDetail.defaultFacePhasePrompt ||
                  viewingDetail.defaultGarmentPhasePrompt) && (
```

Replace with:

```tsx
                {(viewingDetail.defaultFacePhasePrompt ||
                  viewingDetail.defaultGarmentPhasePrompt ||
                  viewingDetail.defaultSamSegmentationPrompt) && (
```

Find the end of that same block, right before its closing (around line 1126-1128):

```tsx
                      </div>
                    )}
                  </div>
                )}

                {/* Raw JSON */}
```

Replace with:

```tsx
                      </div>
                    )}
                    {viewingDetail.defaultSamSegmentationPrompt && (
                      <div style={{ marginTop: 10 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: 'var(--ink-2)',
                            marginBottom: 4,
                          }}
                        >
                          SAM3 segmentation prompt
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            fontSize: 11.5,
                            background: 'var(--subtle)',
                            padding: '10px 12px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            overflowX: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {viewingDetail.defaultSamSegmentationPrompt}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {/* Raw JSON */}
```

- [ ] **Step 7: Verify the build**

```bash
pnpm --filter @aivastra/admin build
```

Expected: succeeds with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/types.ts apps/admin-web/src/pages/WorkflowsPage.tsx
git commit -m "feat(admin-web): edit and view the SAM3 segmentation prompt on a workflow"
```

---

### Task 7: Admin UI — `WorkflowUploadModal.tsx`

**Files:**
- Modify: `apps/admin-web/src/components/WorkflowUploadModal.tsx`

**Interfaces:**
- Consumes: `POST /admin/workflows` now accepts `samSegmentationPromptNode` (Task 3).
- Produces: nothing consumed elsewhere — self-contained creation-form addition.

- [ ] **Step 1: Add state for the manually-entered node ID**

Find (around line 157-159):

```ts
  const [twoStageGarmentNodeId, setTwoStageGarmentNodeId] = useState('');
  const [stage1PositivePromptNode, setStage1PositivePromptNode] = useState('');
  const [stage1NegativePromptNode, setStage1NegativePromptNode] = useState('');
```

Replace with:

```ts
  const [twoStageGarmentNodeId, setTwoStageGarmentNodeId] = useState('');
  const [stage1PositivePromptNode, setStage1PositivePromptNode] = useState('');
  const [stage1NegativePromptNode, setStage1NegativePromptNode] = useState('');

  // SAM3 Segmentation node — no auto-detection (it doesn't feed a KSampler,
  // so the connection-tracing detector can't find it); the admin types the
  // node ID directly, same manual-entry UX as a ksamplerOverrides nodeId.
  const [samSegmentationPromptNode, setSamSegmentationPromptNode] = useState('');
```

- [ ] **Step 2: Include it in all three payload branches**

Find (around line 383-385, inside the tryon/saree/regeneration branch):

```ts
          facePhasePromptNode: negativePromptNode,
          garmentPhasePromptNode: positivePromptNode,
        };
      } else if (workflowType === 'two_stage') {
```

Replace with:

```ts
          facePhasePromptNode: negativePromptNode,
          garmentPhasePromptNode: positivePromptNode,
          ...(samSegmentationPromptNode.trim()
            ? { samSegmentationPromptNode: samSegmentationPromptNode.trim() }
            : {}),
        };
      } else if (workflowType === 'two_stage') {
```

Find (around line 401-403, inside the two_stage branch):

```ts
          stage1PositivePromptNode,
          stage1NegativePromptNode,
        };
      } else {
```

Replace with:

```ts
          stage1PositivePromptNode,
          stage1NegativePromptNode,
          ...(samSegmentationPromptNode.trim()
            ? { samSegmentationPromptNode: samSegmentationPromptNode.trim() }
            : {}),
        };
      } else {
```

Find (around line 424-426, inside the regular/else branch):

```ts
          facePhasePromptNode: negativePromptNode || undefined,
          garmentPhasePromptNode: positivePromptNode,
        };
      }
```

Replace with:

```ts
          facePhasePromptNode: negativePromptNode || undefined,
          garmentPhasePromptNode: positivePromptNode,
          ...(samSegmentationPromptNode.trim()
            ? { samSegmentationPromptNode: samSegmentationPromptNode.trim() }
            : {}),
        };
      }
```

- [ ] **Step 3: Render the input, common to every workflow type**

Find the end of the type-specific rendering, right before the top-level error banner (around line 1255-1258):

```tsx
          </>
        )}

        {error && (
```

Replace with:

```tsx
          </>
        )}

        {parsed && (
          <div className="field">
            <label>SAM3 segmentation node ID (optional)</label>
            <input
              className="input"
              placeholder="e.g. 42 — not auto-detected, enter manually"
              value={samSegmentationPromptNode}
              disabled={saving}
              onChange={(e) => setSamSegmentationPromptNode(e.target.value.trim())}
            />
          </div>
        )}

        {error && (
```

- [ ] **Step 4: Verify the build**

```bash
pnpm --filter @aivastra/admin build
```

Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/components/WorkflowUploadModal.tsx
git commit -m "feat(admin-web): let admins set the SAM3 segmentation node ID when creating a workflow"
```

---

### Task 8: Admin UI — `ReplaceWorkflowModal.tsx`

**Files:**
- Modify: `apps/admin-web/src/components/ReplaceWorkflowModal.tsx`

**Interfaces:**
- Consumes: `POST /admin/workflows/:id/replace` now accepts `samSegmentationPromptNode` (Task 3, via `extractWorkflowInsertFields` shared with create); `WorkflowOption.samSegmentationPromptNode` (Task 6) for pre-fill.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add state, pre-filled from the workflow being replaced**

Find (around line 116-118):

```ts
  // Two-stage fields
  const [twoStageGarmentNodeId, setTwoStageGarmentNodeId] = useState('');
  const [stage1PositivePromptNode, setStage1PositivePromptNode] = useState('');
  const [stage1NegativePromptNode, setStage1NegativePromptNode] = useState('');
```

Replace with:

```ts
  // Two-stage fields
  const [twoStageGarmentNodeId, setTwoStageGarmentNodeId] = useState('');
  const [stage1PositivePromptNode, setStage1PositivePromptNode] = useState('');
  const [stage1NegativePromptNode, setStage1NegativePromptNode] = useState('');

  // SAM3 Segmentation node — not auto-detected (see WorkflowUploadModal.tsx).
  // Pre-filled from the workflow being replaced, same convention as
  // slug/label above, since the new JSON usually keeps the same node ID.
  const [samSegmentationPromptNode, setSamSegmentationPromptNode] = useState(
    workflow.samSegmentationPromptNode ?? '',
  );
```

- [ ] **Step 2: Include it in all three payload branches**

Find (around line 310-312, inside the tryon/saree branch):

```ts
          facePhasePromptNode: negativePromptNode,
          garmentPhasePromptNode: positivePromptNode,
          password: password.trim(),
        };
      } else if (workflowType === 'two_stage') {
```

Replace with:

```ts
          facePhasePromptNode: negativePromptNode,
          garmentPhasePromptNode: positivePromptNode,
          ...(samSegmentationPromptNode.trim()
            ? { samSegmentationPromptNode: samSegmentationPromptNode.trim() }
            : {}),
          password: password.trim(),
        };
      } else if (workflowType === 'two_stage') {
```

Find (around line 327-330, inside the two_stage branch):

```ts
          stage1PositivePromptNode,
          stage1NegativePromptNode,
          password: password.trim(),
        };
      } else {
```

Replace with:

```ts
          stage1PositivePromptNode,
          stage1NegativePromptNode,
          ...(samSegmentationPromptNode.trim()
            ? { samSegmentationPromptNode: samSegmentationPromptNode.trim() }
            : {}),
          password: password.trim(),
        };
      } else {
```

Find (around line 349-352, inside the regular/else branch):

```ts
          facePhasePromptNode: negativePromptNode || undefined,
          garmentPhasePromptNode: positivePromptNode,
          password: password.trim(),
        };
      }
```

Replace with:

```ts
          facePhasePromptNode: negativePromptNode || undefined,
          garmentPhasePromptNode: positivePromptNode,
          ...(samSegmentationPromptNode.trim()
            ? { samSegmentationPromptNode: samSegmentationPromptNode.trim() }
            : {}),
          password: password.trim(),
        };
      }
```

- [ ] **Step 3: Render the input, common to every workflow type**

Find the end of the type-specific node-mapping section, right before the password-confirmation block (around line 870-874):

```tsx
            )}
          </div>
        )}

        {/* Password Confirmation */}
```

Replace with:

```tsx
            )}
          </div>
        )}

        {parsed && (
          <div className="field">
            <label>SAM3 segmentation node ID (optional)</label>
            <input
              className="input"
              placeholder="e.g. 42 — not auto-detected, enter manually"
              value={samSegmentationPromptNode}
              disabled={saving}
              onChange={(e) => setSamSegmentationPromptNode(e.target.value.trim())}
            />
          </div>
        )}

        {/* Password Confirmation */}
```

- [ ] **Step 4: Verify the build**

```bash
pnpm --filter @aivastra/admin build
```

Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/components/ReplaceWorkflowModal.tsx
git commit -m "feat(admin-web): let admins set the SAM3 segmentation node ID when replacing a workflow"
```

---

### Task 9: Final verification and progress log

**Files:**
- Modify: `docs/progress.md` (prepend a dated entry)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed elsewhere — closing task.

- [ ] **Step 1: Run the full typecheck and test suite**

```bash
pnpm typecheck
pnpm --filter @aivastra/api test:integration
pnpm --filter @aivastra/types test
pnpm --filter @aivastra/admin build
```

Expected: all four succeed with no errors.

- [ ] **Step 2: Add a `docs/progress.md` entry**

Open `docs/progress.md` and add a new dated section at the very top (above the `## 2026-09-11 — Workflow replace now clears stale prompt overrides...` entry, or same-day if today's date already has an entry — check the top of the file for today's date first and append under it if so):

```markdown
## 2026-09-11 — Admin can edit a workflow's SAM3 segmentation prompt

- **Change:** `workflow_templates`/`workflow_template_archives` gain
  `samSegmentationPromptNode`/`defaultSamSegmentationPrompt`, following the
  `stage1PositivePromptNode` pattern exactly — template-level only, no
  per-pose override, no dispatcher change (the value is baked into
  `jsonContent` at edit time, same as every other admin-editable prompt).
  `POST`/`PATCH /admin/workflows` and the replace route all support it; the
  admin-web workflow create/replace modals expose a manual node-ID input
  (no auto-detection — a SAM3 node doesn't feed a KSampler, so the existing
  connection-tracing detector can't find it), and the Edit drawer/detail
  view expose the prompt text once a node ID is configured.
- **Design:** `docs/superpowers/specs/2026-09-11-sam3-segmentation-prompt-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/progress.md
git commit -m "docs: log SAM3 segmentation prompt editing in progress.md"
```

- [ ] **Step 4: Hand off**

Implementation is complete on the `feature/sam3-segmentation-prompt-editing` branch. Next step is opening a PR into `dev` per `docs/version-control.md` — not part of this plan's scope (ask the user before opening the PR).
