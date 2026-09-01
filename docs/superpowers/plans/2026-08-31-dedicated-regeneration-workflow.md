# Dedicated Regeneration Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regenerate's "replay the original job's pipeline with a swapped prompt" with a single dedicated ComfyUI workflow (from `regen.json`) that every regenerate click runs, taking only the original job's own generated output as input and the reason-selected prompt as its one variable.

**Architecture:** A new `workflow_templates.workflow_type = 'regeneration'` value (no new columns — reuses `tryonPersonNodeId`/`tryonOutputNodeId`/`garmentPhasePromptNode`/`facePhasePromptNode`/`regenerationReasonPrompts`) slots into the existing generic admin workflow-template system (create/parse/patch, single-active enforcement mirroring `saree`). `regenerate.ts` collapses from three job-type-specific branches to one unified path. The dispatcher gets one new, simpler processor (`processRegenerateJob`) modeled on `processTryonDirectJob` minus the garment input.

**Tech Stack:** Fastify + Zod (`apps/api`), Drizzle/Postgres (`packages/db`), Redis Streams dispatcher (`apps/dispatcher`), React/Vite admin SPA (`apps/admin-web`), Vitest integration tests against docker-compose Postgres/Redis/MinIO.

**Spec:** `docs/superpowers/specs/2026-08-31-dedicated-regeneration-workflow-design.md`

## Global Constraints

- No new `workflow_templates` columns — `workflow_type` is plain `text`, not a Postgres enum, so a new value (`'regeneration'`) needs zero schema migration.
- Regeneration is a single global, admin-configured template: `WHERE workflow_type = 'regeneration' AND is_active = true` must resolve to at most one row at all times (mirrors `saree`'s single-active invariant — demote-on-create/activate, no DB constraint).
- `regenerationReasonPrompts` is meaningful **only** on the `'regeneration'`-type template going forward. Every other template's field gets cleared by migration and is never written to again by the admin UI.
- Regenerate jobs are always `creditsCharged: 0` — no paid fallback, ever (free-daily-limit or blocked, never charge-then-refund).
- `pnpm docker:up` must be running before any integration test task below (Postgres/Redis/MinIO on localhost — see CLAUDE.md Testing section). Every fresh-DB integration test run applies all migrations, so the seed migration in Task 1 means a `'regeneration'`-type template row with reason labels already exists in every test's DB by default — tests must not assume none exists.
- Run `pnpm --filter @aivastra/api test` for unit tests, `pnpm --filter @aivastra/api test:integration` (or `npx vitest run --config vitest.integration.config.ts <pattern>` from `apps/api`) for integration tests. Dispatcher integration tests: same pattern from `apps/dispatcher` — check `apps/dispatcher/package.json` for the exact script names before running (mirror whichever `test`/`test:integration` split it uses).

---

### Task 1: Migration — clear stale reasons, seed the live regeneration workflow

**Files:**
- Create: `packages/db/src/migrations/00NN_<name>.sql` (exact number/name chosen by drizzle-kit — see Step 1)
- Modify: `packages/db/src/migrations/meta/_journal.json` (auto-updated by drizzle-kit, do not hand-edit)

**Interfaces:**
- Produces: a live `workflow_templates` row with `workflow_type = 'regeneration'`, `is_active = true`, node ids `tryon_person_node_id = '151'`, `tryon_output_node_id = '150'`, `garment_phase_prompt_node = '154'`, `face_phase_prompt_node = '149'` — every later task (API, dispatcher) can rely on this row existing after migrations run.

- [ ] **Step 1: Scaffold an empty custom migration**

This is a pure-data change (no `schema.ts` edit), so `drizzle-kit generate` alone produces no diff. Use its custom-migration mode, matching how migration `0178_seed_default_regen_reasons.sql` was created:

Run (from `packages/db`):
```bash
npx drizzle-kit generate --custom --name=seed_regeneration_workflow
```
Expected: a new empty file `packages/db/src/migrations/0182_seed_regeneration_workflow.sql` (number may differ if other migrations landed first — use whatever drizzle-kit assigns) and a new entry appended to `packages/db/src/migrations/meta/_journal.json`.

- [ ] **Step 2: Write the migration SQL**

Replace the generated file's (empty) contents with:

```sql
-- Regeneration reasons are now meaningful on exactly one workflow template
-- (the dedicated 'regeneration' type) instead of on every template — clear
-- the field everywhere else so an admin can't mistake a 'regular'/'tryon'/
-- etc. template's reason list for something that still does anything. The
-- admin UI (WorkflowsPage.tsx) stops writing to this field for other types
-- going forward.
UPDATE workflow_templates
SET regeneration_reason_prompts = '[]'::jsonb
WHERE workflow_type <> 'regeneration';

-- Seed the live regeneration workflow from regen.json (repo root). Node
-- mapping — see docs/superpowers/specs/2026-08-31-dedicated-regeneration-workflow-design.md:
--   151 = source image (LoadImage, title "person") — the job output being regenerated
--   154 = reason prompt (TextEncodeQwenImageEditPlusPro_lrzjason, .inputs.prompt) — patched
--   149 = negative prompt (CLIPTextEncode, .inputs.text) — fixed, never patched
--   150 = result (Save Image With Callback)
INSERT INTO workflow_templates (
  slug, label, json_content, workflow_type,
  face_node_id, pose_node_id, bg_node_id, upper_node_ids,
  face_phase_prompt_node, garment_phase_prompt_node,
  default_face_phase_prompt, default_garment_phase_prompt,
  tryon_person_node_id, tryon_output_node_id,
  regeneration_reason_prompts, is_active
) VALUES (
  'regeneration_v1',
  'Regeneration',
  '{
    "140": {"inputs": {"lora_name": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", "strength_model": 1, "model": ["152", 0]}, "class_type": "LoraLoaderModelOnly", "_meta": {"title": "Load LoRA"}},
    "141": {"inputs": {"style": "%Y%m%d%H%M%S"}, "class_type": "Get Date Time String (JPS)", "_meta": {"title": "Get Date Time String (JPS)"}},
    "142": {"inputs": {"upscale_method": "lanczos", "megapixels": 2, "resolution_steps": 1, "image": ["151", 0]}, "class_type": "ImageScaleToTotalPixels", "_meta": {"title": "ImageScaleToTotalPixels"}},
    "143": {"inputs": {"clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors", "type": "qwen_image", "device": "default"}, "class_type": "CLIPLoader", "_meta": {"title": "Load CLIP"}},
    "144": {"inputs": {"vae_name": "Qwen_Image-VAE.safetensors"}, "class_type": "VAELoader", "_meta": {"title": "Load VAE"}},
    "145": {"inputs": {"samples": ["146", 0], "vae": ["144", 0]}, "class_type": "VAEDecode", "_meta": {"title": "VAE Decode"}},
    "146": {"inputs": {"seed": 12345, "steps": 4, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1, "model": ["140", 0], "positive": ["154", 0], "negative": ["149", 0], "latent_image": ["154", 1]}, "class_type": "KSampler", "_meta": {"title": "KSampler"}},
    "148": {"inputs": {"unet_name": "qwen-image-edit-2511-Q8_0.gguf"}, "class_type": "UnetLoaderGGUF", "_meta": {"title": "Unet Loader (GGUF)"}},
    "149": {"inputs": {"text": "nude, nude body, nude lower, nude upper, open chest, bare chest, exposed skin on torso, extra hands, duplicate hands, plastic hands, mannequin body,mannequin waist, mannequin hands, mannequin legs, 3 legs, 4 legs, extra legs, duplicate legs, extra head, duplicate head, extra buttons, extra zip, tucked upperwear, artifacts, frayed edges, threads, torn fabric, distorted sleeves, extra cloth, inside pants, tight waist fit, unnatural folds, compressed face, enlarged face, flattened face, plastic skin, wax figure, mannequin, doll-like, airbrushed skin, overly smooth skin, fake texture, unnatural skin tone, shiny skin, 3D render look, deformed chest, keep image1 sleeve, keep image1 neck type", "clip": ["143", 0]}, "class_type": "CLIPTextEncode", "_meta": {"title": "CLIP Text Encode (Prompt)"}},
    "150": {"inputs": {"filename_prefix": ["141", 0], "images": ["145", 0]}, "class_type": "Save Image With Callback", "_meta": {"title": "Save Image With Callback"}},
    "151": {"inputs": {"image": "20260825101708_00001_.png"}, "class_type": "LoadImage", "_meta": {"title": "person"}},
    "152": {"inputs": {"lora_name": "qwen_image_edit_2511_upscale.safetensors", "strength_model": 0.5, "model": ["148", 0]}, "class_type": "LoraLoaderModelOnly", "_meta": {"title": "Load LoRA"}},
    "154": {"inputs": {"prompt": "Remove extra footwear from image 1\n", "vl_resize_indexs": "0,1,2", "main_image_index": 1, "target_size": 1344, "target_vl_size": 384, "upscale_method": "lanczos", "crop_method": "pad", "instruction": "dont remove model footwear\n", "clip": ["143", 0], "vae": ["144", 0], "image1": ["142", 0]}, "class_type": "TextEncodeQwenImageEditPlusPro_lrzjason", "_meta": {"title": "TextEncodeQwenImageEditPlusPro lrzjason"}}
  }'::jsonb,
  'regeneration',
  '', '', '', ARRAY[]::text[],
  '149', '154',
  'nude, nude body, nude lower, nude upper, open chest, bare chest, exposed skin on torso, extra hands, duplicate hands, plastic hands, mannequin body,mannequin waist, mannequin hands, mannequin legs, 3 legs, 4 legs, extra legs, duplicate legs, extra head, duplicate head, extra buttons, extra zip, tucked upperwear, artifacts, frayed edges, threads, torn fabric, distorted sleeves, extra cloth, inside pants, tight waist fit, unnatural folds, compressed face, enlarged face, flattened face, plastic skin, wax figure, mannequin, doll-like, airbrushed skin, overly smooth skin, fake texture, unnatural skin tone, shiny skin, 3D render look, deformed chest, keep image1 sleeve, keep image1 neck type',
  'Remove extra footwear from image 1
',
  '151', '150',
  '[
    {"reason": "Multiple body parts", "prompt": ""},
    {"reason": "Nudity", "prompt": ""},
    {"reason": "Draping issue", "prompt": ""},
    {"reason": "Additional assets", "prompt": ""},
    {"reason": "Texture issue", "prompt": ""}
  ]'::jsonb,
  true
);
```

Note: `default_garment_phase_prompt`'s value above spans two lines to embed the real newline that node 154's `"Remove extra footwear from image 1\n"` JSON-escape represents — SQL string literals don't interpret `\n`, so a literal line break is used instead. Verify after insert (Step 4) that this column reads back as `Remove extra footwear from image 1\n` (with a trailing newline), not the literal two characters `\`+`n`.

- [ ] **Step 3: Apply the migration locally**

```bash
pnpm docker:up
pnpm db:migrate
```
Expected: no errors; migration `NNNN_seed_regeneration_workflow` appears applied.

- [ ] **Step 4: Verify the seeded row**

```bash
psql "$DATABASE_URL" -c "SELECT slug, workflow_type, is_active, tryon_person_node_id, tryon_output_node_id, garment_phase_prompt_node, jsonb_array_length(regeneration_reason_prompts) FROM workflow_templates WHERE workflow_type = 'regeneration';"
```
Expected: one row, `slug = regeneration_v1`, `is_active = t`, `tryon_person_node_id = 151`, `tryon_output_node_id = 150`, `garment_phase_prompt_node = 154`, reason count `5`.

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM workflow_templates WHERE workflow_type <> 'regeneration' AND regeneration_reason_prompts <> '[]'::jsonb;"
```
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations
git commit -m "$(cat <<'EOF'
feat(db): seed dedicated regeneration workflow template, clear reasons off other templates

EOF
)"
```

---

### Task 2: Admin API — `workflowType = 'regeneration'` support

**Files:**
- Modify: `packages/types/src/admin.ts` (`CreateWorkflowBody`, `ParseWorkflowBody`)
- Modify: `apps/api/src/modules/admin/workflows.routes.ts` (`extractWorkflowInsertFields`, `/admin/workflows/parse`, `POST /admin/workflows`, `PATCH /admin/workflows/:id`)
- Test: `apps/api/test/integration/admin-workflows.test.ts`

**Interfaces:**
- Consumes: `detectTryonMappings(json)` from `apps/api/src/modules/admin/tryon-detect.ts` — returns `{ detected: { personNodeId?, garmentNodeId?, outputNodeId?, positivePromptNode?, negativePromptNode?, defaultPositivePrompt, defaultNegativePrompt }, allImageNodes, allPromptNodes }`. Already auto-detects `regen.json` correctly with no changes needed: `personNodeId` from title `"person"`, `outputNodeId` from `class_type.includes('Save Image')`, prompt nodes via reverse-link detection into KSampler `positive`/`negative`.
- Consumes: `validateNodeExists(json, nodeId, role)`, `validateNodeType(json, nodeId, category, role)` (both already defined in `workflows.routes.ts`).
- Produces: `workflow_templates` rows insertable/patchable with `workflowType: 'regeneration'`.

- [ ] **Step 1: Add `'regeneration'` to the type enums in `packages/types/src/admin.ts`**

In `CreateWorkflowBody` (around line 356-358):
```ts
    workflowType: z
      .enum(['regular', 'tryon', 'saree_step1', 'saree_step1_two_input', 'two_stage', 'regeneration'])
      .default('regular'),
```

In `ParseWorkflowBody` (around line 477-479):
```ts
  workflowType: z
    .enum(['regular', 'tryon', 'saree_step1', 'saree_step1_two_input', 'two_stage', 'regeneration'])
    .optional(),
```

Add a `superRefine` branch (in `CreateWorkflowBody`, right after the existing `if (val.workflowType === 'two_stage') {...}` block, before the `tryon`/`saree_step1`/`saree_step1_two_input` block at line ~420):
```ts
    if (val.workflowType === 'regeneration') {
      for (const field of [
        'tryonPersonNodeId',
        'tryonOutputNodeId',
        'facePhasePromptNode',
        'garmentPhasePromptNode',
      ] as const) {
        if (!val[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required for regeneration workflows`,
          });
        }
      }
      return;
    }
```
Note: unlike the `tryon` branch, this requires `tryonPersonNodeId` (not optional — regeneration's *only* input is the source image, there is no "face is fixed inside the workflow" case) and does **not** require `tryonGarmentNodeId` (regeneration has no garment role).

- [ ] **Step 2: `extractWorkflowInsertFields` branch in `workflows.routes.ts`**

Add before the existing `if (workflowType === 'tryon' || workflowType === 'saree_step1') {` block (~line 380):
```ts
  if (workflowType === 'regeneration') {
    const { detected: autoDetected } = detectTryonMappings(body.jsonContent);
    const personNodeId = body.tryonPersonNodeId ?? autoDetected.personNodeId ?? '';
    const outputNodeId = body.tryonOutputNodeId ?? autoDetected.outputNodeId ?? '';
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by superRefine
    const negNode = body.facePhasePromptNode!;
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by superRefine
    const posNode = body.garmentPhasePromptNode!;

    if (!personNodeId)
      throw new AppError(
        'VALIDATION',
        400,
        'Could not detect source-image node — set tryonPersonNodeId manually',
      );
    if (!outputNodeId)
      throw new AppError(
        'VALIDATION',
        400,
        'Could not detect output node — set tryonOutputNodeId manually',
      );

    validateNodeExists(body.jsonContent, personNodeId, 'source image');
    validateNodeType(body.jsonContent, personNodeId, 'image', 'source image');
    validateNodeExists(body.jsonContent, outputNodeId, 'output');
    validateNodeExists(body.jsonContent, negNode, 'negative prompt');
    validateNodeExists(body.jsonContent, posNode, 'reason prompt');
    validateNodeType(body.jsonContent, negNode, 'prompt', 'negative prompt');
    validateNodeType(body.jsonContent, posNode, 'prompt', 'reason prompt');

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
      faceNodeId: '',
      poseNodeId: '',
      bgNodeId: '',
      upperNodeIds: [],
      lowerNodeId: null,
      shoeNodeId: null,
      thirdNodeId: null,
      sizeNodeIds: [],
      latentSizeNodeIds: [],
      latentMaxPx: 2048,
      outputSizeNodeIds: [],
      outputMaxPx: 2048,
      resultNodeId: null,
      facePhasePromptNode: negNode,
      garmentPhasePromptNode: posNode,
      defaultFacePhasePrompt,
      defaultGarmentPhasePrompt,
      stage1PositivePromptNode: null,
      stage1NegativePromptNode: null,
      defaultStage1PositivePrompt: '',
      defaultStage1NegativePrompt: '',
      tryonPersonNodeId: personNodeId,
      tryonGarmentNodeId: null,
      tryonGarmentNodeId2: null,
      tryonOutputNodeId: outputNodeId,
    };
  }

```

- [ ] **Step 3: `/admin/workflows/parse` endpoint branch**

In the `POST /admin/workflows/parse` handler (~line 634), extend the existing condition:
```ts
      const parseWorkflowType = (req.body as { workflowType?: string }).workflowType;
      if (
        parseWorkflowType === 'tryon' ||
        parseWorkflowType === 'saree_step1' ||
        parseWorkflowType === 'regeneration'
      ) {
        const { detected, allImageNodes, allPromptNodes } = detectTryonMappings(jsonContent);
        return { detected, allImageNodes, allPromptNodes };
      }
```

- [ ] **Step 4: Single-active demote + reason-prompt seeding in `POST /admin/workflows`**

Replace the create-transaction block (~line 673-703):
```ts
      // Every new workflow starts with the default reason pool (blank prompts —
      // "no override yet") so the regenerate reason picker is never empty — but
      // only for the one workflow type where reasons are actually used.
      // /replace intentionally never sets this field, so an existing workflow's
      // curated list survives a jsonContent swap untouched.
      const values = {
        ...extractWorkflowInsertFields(body),
        regenerationReasonPrompts:
          body.workflowType === 'regeneration' ? DEFAULT_REGENERATION_REASON_PROMPTS : [],
      };

      const row = await app.db.transaction(async (tx) => {
        // Single-active invariant: only one 'regeneration' template is ever
        // live — every regenerate click uses whichever one is active, with no
        // per-job selection. Mirrors admin/saree.routes.ts's demote-on-create.
        if (values.workflowType === 'regeneration') {
          await tx
            .update(schema.workflowTemplates)
            .set({ isActive: false, updatedAt: new Date() })
            .where(
              and(
                eq(schema.workflowTemplates.workflowType, 'regeneration'),
                eq(schema.workflowTemplates.isActive, true),
              ),
            );
        }

        const [inserted] = await tx.insert(schema.workflowTemplates).values(values).returning();
        if (!inserted)
          throw new AppError('INSERT_FAILED', 500, 'failed to insert workflow template');

        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'workflow.create',
          resourceType: 'workflow',
          resourceId: inserted.id,
          after: {
            id: inserted.id,
            slug: inserted.slug,
            label: inserted.label,
            workflowType: inserted.workflowType,
          },
          request: req,
        });

        return inserted;
      });
```
This requires importing `and` from `drizzle-orm` in this file if not already imported — check the existing `import { and, count, eq, ne, notInArray, or, sql } from 'drizzle-orm';` at the top (line 10): `and` is already imported, no change needed there.

- [ ] **Step 5: Single-active demote on `PATCH /admin/workflows/:id` activation**

In the PATCH handler's transaction (~line 1044-1055), add a demote step before the update when activating a regeneration template:
```ts
      await app.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(schema.workflowTemplates)
          .where(eq(schema.workflowTemplates.id, id))
          .for('update');
        if (!locked) throw new AppError('NOT_FOUND', 404, 'workflow not found');

        if (locked.workflowType === 'regeneration' && body.isActive === true) {
          await tx
            .update(schema.workflowTemplates)
            .set({ isActive: false, updatedAt: new Date() })
            .where(
              and(
                eq(schema.workflowTemplates.workflowType, 'regeneration'),
                eq(schema.workflowTemplates.isActive, true),
                ne(schema.workflowTemplates.id, id),
              ),
            );
        }

        await tx
          .update(schema.workflowTemplates)
          .set(updateValues)
          .where(eq(schema.workflowTemplates.id, id));

        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'workflow.update',
          resourceType: 'workflow',
          resourceId: id,
          before: locked,
          after: { ...locked, ...updateValues },
          request: req,
        });
      });
```
`ne` is already imported (line 10).

- [ ] **Step 6: Write integration tests**

Append to `apps/api/test/integration/admin-workflows.test.ts` (uses the same `jsonContent`/`headers` fixtures already in the file — see its top for `adminAuthHeader`):

```ts
  describe('regeneration workflows', () => {
    const regenJson = {
      person_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'person' } },
      positive_node: {
        inputs: { prompt: 'default reason prompt' },
        class_type: 'CLIPTextEncode',
        _meta: { title: 'positive_prompt' },
      },
      negative_node: {
        inputs: { text: 'default negative' },
        class_type: 'CLIPTextEncode',
        _meta: { title: 'negative_prompt' },
      },
      output_node: { inputs: {}, class_type: 'Save Image With Callback', _meta: { title: 'output' } },
    };

    it('creates a regeneration workflow with auto-detected person/output/prompt nodes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_${Date.now()}`,
          label: 'Regen test',
          jsonContent: regenJson,
          workflowType: 'regeneration',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.workflowType).toBe('regeneration');
      expect(body.tryonPersonNodeId).toBe('person_node');
      expect(body.tryonOutputNodeId).toBe('output_node');
    });

    it('rejects a regeneration workflow with no detectable source-image node', async () => {
      const { person_node: _drop, ...noPersonJson } = regenJson;
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_noperson_${Date.now()}`,
          label: 'Regen no person',
          jsonContent: noPersonJson,
          workflowType: 'regeneration',
          garmentPhasePromptNode: 'positive_node',
          facePhasePromptNode: 'negative_node',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('activating a second regeneration workflow demotes the first', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_first_${Date.now()}`,
          label: 'Regen first',
          jsonContent: regenJson,
          workflowType: 'regeneration',
        },
      });
      expect(first.statusCode).toBe(200);
      const firstId = first.json().id as string;

      const second = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_second_${Date.now()}`,
          label: 'Regen second',
          jsonContent: regenJson,
          workflowType: 'regeneration',
        },
      });
      expect(second.statusCode).toBe(200);

      const [firstRow] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, firstId));
      expect(firstRow.isActive).toBe(false);
    });

    it('reactivating a demoted regeneration workflow demotes whichever is currently active', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_reactivate_a_${Date.now()}`,
          label: 'Regen A',
          jsonContent: regenJson,
          workflowType: 'regeneration',
        },
      });
      const firstId = first.json().id as string;
      const second = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_reactivate_b_${Date.now()}`,
          label: 'Regen B',
          jsonContent: regenJson,
          workflowType: 'regeneration',
        },
      });
      const secondId = second.json().id as string;

      // Reactivate the first (currently inactive, demoted by creating the second).
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${firstId}`,
        headers,
        payload: { isActive: true },
      });
      expect(patchRes.statusCode).toBe(200);

      const [firstRow] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, firstId));
      const [secondRow] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, secondId));
      expect(firstRow.isActive).toBe(true);
      expect(secondRow.isActive).toBe(false);
    });

    it('does not seed default regeneration reasons onto a non-regeneration workflow', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regular_no_reasons_${Date.now()}`,
          label: 'Regular, no reasons',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(response.statusCode).toBe(200);
      const [row] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, response.json().id));
      expect(row.regenerationReasonPrompts).toEqual([]);
    });
  });
```

- [ ] **Step 7: Run the tests**

```bash
cd apps/api
npx vitest run --config vitest.integration.config.ts admin-workflows -v
```
Expected: all tests in `admin-workflows.test.ts`, including the new `describe('regeneration workflows')` block, PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm --filter @aivastra/types typecheck
pnpm --filter @aivastra/api typecheck
git add packages/types/src/admin.ts apps/api/src/modules/admin/workflows.routes.ts apps/api/test/integration/admin-workflows.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): support workflowType='regeneration' with single-active enforcement

EOF
)"
```

---

### Task 3: Admin UI — create form + reason-editor gating

**Files:**
- Modify: `apps/admin-web/src/components/WorkflowUploadModal.tsx`
- Modify: `apps/admin-web/src/pages/WorkflowsPage.tsx`

**Interfaces:**
- Consumes: `POST /admin/workflows/parse` (now accepts `workflowType: 'regeneration'` — Task 2), `POST /admin/workflows`, `PATCH /admin/workflows/:id` (unchanged request shapes, `workflowType: 'regeneration'` is just another accepted enum value).

Scope note: this task covers only functional pieces (create form, reason-editor gating, type filter). The cosmetic type-badge color/label ternaries in `WorkflowsPage.tsx` (~lines 483-507, 747-771) already fall back to a generic "Catalogue workflows" label for any type they don't explicitly handle (this already happens for `'two_stage'` today) — `'regeneration'` falling into the same bucket is an accepted pre-existing cosmetic gap, not a regression, and is out of scope here.

- [ ] **Step 1: `WorkflowUploadModal.tsx` — extend the type union and selector**

Line 122-124, extend the union:
```ts
  const [workflowType, setWorkflowType] = useState<
    'regular' | 'tryon' | 'saree_step1' | 'saree_step1_two_input' | 'two_stage' | 'regeneration'
  >('regular');
```

Line 514, add to the button list:
```ts
          {(
            [
              'regular',
              'tryon',
              'saree_step1',
              'saree_step1_two_input',
              'two_stage',
              'regeneration',
            ] as const
          ).map(
```

Line 526-534, add a label branch:
```tsx
                {t === 'tryon'
                  ? 'Tryon (person + garment)'
                  : t === 'saree_step1'
                    ? 'Saree Step 1 (mannequin)'
                    : t === 'saree_step1_two_input'
                      ? 'Saree Step 1 (body + pallu)'
                      : t === 'two_stage'
                        ? 'Two-Stage (build + dress)'
                        : t === 'regeneration'
                          ? 'Regeneration (single-image edit)'
                          : 'Catalogue workflows (pose-based)'}
```

- [ ] **Step 2: `handleParse` — route `'regeneration'` through the tryon-shaped detector**

Line 199, extend the condition (this branch already sets exactly the fields regeneration needs — `personNodeId`/`outputNodeId`/`positivePromptNode`/`negativePromptNode` — `garmentNodeId` gets set too but is simply unused for this type):
```ts
      if (
        workflowType === 'tryon' ||
        workflowType === 'saree_step1' ||
        workflowType === 'regeneration'
      ) {
```

- [ ] **Step 3: `handleSubmit` validation — regeneration's own required-fields branch**

Line 294, change the condition so regeneration doesn't fall into the tryon branch (which requires a garment node it doesn't have) — add a new `else if` before the existing `saree_step1_two_input` branch:
```ts
    if (workflowType === 'tryon' || workflowType === 'saree_step1') {
      if (!tryonGarmentNodeId.trim() || !tryonOutputNodeId.trim()) {
        setError('Garment and output node IDs are required');
        return;
      }
      if (!positivePromptNode || !negativePromptNode) {
        setError('Positive and negative prompt nodes are required');
        return;
      }
    } else if (workflowType === 'regeneration') {
      if (!tryonPersonNodeId.trim() || !tryonOutputNodeId.trim()) {
        setError('Source-image and output node IDs are required');
        return;
      }
      if (!positivePromptNode || !negativePromptNode) {
        setError('Reason (positive) and negative prompt nodes are required');
        return;
      }
    } else if (workflowType === 'saree_step1_two_input') {
```

- [ ] **Step 4: Payload construction — omit `tryonGarmentNodeId` for regeneration**

Line 351-369, extend the condition and make the garment field conditional:
```ts
      let payload: Record<string, unknown>;
      if (
        workflowType === 'tryon' ||
        workflowType === 'saree_step1' ||
        workflowType === 'saree_step1_two_input' ||
        workflowType === 'regeneration'
      ) {
        payload = {
          slug: slug.trim(),
          label: label.trim(),
          jsonContent,
          workflowType,
          tryonPersonNodeId: tryonPersonNodeId.trim() || undefined,
          ...(workflowType !== 'regeneration'
            ? { tryonGarmentNodeId: tryonGarmentNodeId.trim() }
            : {}),
          ...(workflowType === 'saree_step1_two_input'
            ? { tryonGarmentNodeId2: tryonGarmentNodeId2.trim() }
            : {}),
          tryonOutputNodeId: tryonOutputNodeId.trim(),
          facePhasePromptNode: negativePromptNode,
          garmentPhasePromptNode: positivePromptNode,
        };
      } else if (workflowType === 'two_stage') {
```

- [ ] **Step 5: Field rendering — reuse the tryon fields block, hide the garment input**

Line 691-693, extend the render condition:
```tsx
        {(workflowType === 'tryon' ||
          workflowType === 'saree_step1' ||
          workflowType === 'saree_step1_two_input' ||
          workflowType === 'regeneration') &&
          parsed && (
```

Line 723-746 (the 3-column grid with person/garment/output), wrap the garment-node field so it only renders outside `'regeneration'`, and make the person-node label/requirement reflect that it's required for regeneration:
```tsx
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div className="field">
                  <label>
                    {workflowType === 'regeneration'
                      ? 'Source image node'
                      : 'Person node (optional — leave blank if face is fixed inside the workflow)'}
                    {workflowType === 'regeneration' && (
                      <span style={{ color: 'var(--danger)' }}> *</span>
                    )}
                  </label>
                  <input
                    className="input"
                    value={tryonPersonNodeId}
                    disabled={saving}
                    onChange={(e) => setTryonPersonNodeId(e.target.value.trim())}
                  />
                </div>
                {workflowType !== 'regeneration' && (
                  <div className="field">
                    <label>
                      {workflowType === 'saree_step1_two_input' ? 'Body node' : 'Garment node'}{' '}
                      <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      className="input"
                      value={tryonGarmentNodeId}
                      disabled={saving}
                      onChange={(e) => setTryonGarmentNodeId(e.target.value.trim())}
                    />
                  </div>
                )}
                {workflowType === 'saree_step1_two_input' && (
                  <div className="field">
                    <label>
                      Pallu node <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      className="input"
                      value={tryonGarmentNodeId2}
                      disabled={saving}
                      onChange={(e) => setTryonGarmentNodeId2(e.target.value.trim())}
                    />
                  </div>
                )}
                <div className="field">
                  <label>
                    Output node <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    className="input"
                    value={tryonOutputNodeId}
                    disabled={saving}
                    onChange={(e) => setTryonOutputNodeId(e.target.value.trim())}
                  />
                </div>
              </div>
```

The "Positive prompt (default, editable)" / "Negative prompt (default, editable)" textareas immediately after (line 796-817) already render unconditionally for this whole shared branch — no change needed; for regeneration these become the reason-prompt and fixed-negative defaults respectively.

- [ ] **Step 6: `canSubmit` — regeneration's own required-field check**

Line 467-499, add a branch (order matters — check `'regeneration'` before falling through to the tryon/saree_step1 check since they're both true for the file/label/parsed prefix):
```ts
  const canSubmit =
    !saving &&
    jsonFile &&
    slug.trim() &&
    label.trim() &&
    (workflowType === 'regeneration'
      ? parsed && tryonPersonNodeId && tryonOutputNodeId && positivePromptNode && negativePromptNode
      : workflowType === 'tryon' || workflowType === 'saree_step1'
        ? parsed &&
          tryonGarmentNodeId &&
          tryonOutputNodeId &&
          positivePromptNode &&
          negativePromptNode
        : workflowType === 'saree_step1_two_input'
          ? parsed &&
            tryonGarmentNodeId &&
            tryonGarmentNodeId2 &&
            tryonOutputNodeId &&
            positivePromptNode &&
            negativePromptNode
          : workflowType === 'two_stage'
            ? parsed &&
              faceNodeId &&
              poseNodeId &&
              bgNodeId &&
              twoStageGarmentNodeId &&
              stage1PositivePromptNode &&
              stage1NegativePromptNode &&
              positivePromptNode &&
              negativePromptNode
            : parsed &&
              poseNodeId &&
              positivePromptNode &&
              (!faceNodeId || negativePromptNode) &&
              (upperNodeIds.filter(Boolean).length > 0 || lowerNodeId));
```

- [ ] **Step 7: "Parse" button visibility**

Line 657-661, add `'regeneration'` to the OR list so the Parse button shows for this type too:
```tsx
            {(workflowType === 'regular' ||
              workflowType === 'tryon' ||
              workflowType === 'saree_step1' ||
              workflowType === 'saree_step1_two_input' ||
              workflowType === 'two_stage' ||
              workflowType === 'regeneration') && (
```

- [ ] **Step 8: `WorkflowsPage.tsx` — gate the reason-editor section**

Around line 1250-1328, wrap the entire "Regeneration reasons & prompts" field block:
```tsx
            {editingWf?.workflowType === 'regeneration' && (
              <div className="field">
                <label>Regeneration reasons & prompts (optional)</label>
                <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)' }}>
                  When a user regenerates a result, the reason they pick is matched against these
                  labels and the matching prompt is used. A reason with no match here (including
                  "Other") reruns this workflow's own default prompt.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {editForm.regenerationReasonPrompts.map((pair, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="input"
                        style={{ flex: '0 0 160px' }}
                        placeholder="Reason (e.g. Wrong pose)"
                        value={pair.reason}
                        disabled={editSaving}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            regenerationReasonPrompts: f.regenerationReasonPrompts.map((p, i) =>
                              i === idx ? { ...p, reason: e.target.value } : p,
                            ),
                          }))
                        }
                      />
                      <textarea
                        className="input"
                        rows={2}
                        style={{ flex: 1 }}
                        placeholder="Alternate prompt"
                        value={pair.prompt}
                        disabled={editSaving}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            regenerationReasonPrompts: f.regenerationReasonPrompts.map((p, i) =>
                              i === idx ? { ...p, prompt: e.target.value } : p,
                            ),
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="btn sm ghost"
                        disabled={editSaving}
                        onClick={() =>
                          setEditForm((f) => ({
                            ...f,
                            regenerationReasonPrompts: f.regenerationReasonPrompts.filter(
                              (_, i) => i !== idx,
                            ),
                          }))
                        }
                        title="Remove this reason"
                      >
                        <Icon.Trash />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn sm ghost"
                    disabled={editSaving}
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() =>
                      setEditForm((f) => ({
                        ...f,
                        regenerationReasonPrompts: [
                          ...f.regenerationReasonPrompts,
                          { reason: '', prompt: '' },
                        ],
                      }))
                    }
                  >
                    <Icon.Plus /> Add reason
                  </button>
                </div>
              </div>
            )}
```
The updated copy above also drops the old "reruns the original prompt" wording (which described the pre-this-feature semantics) in favor of "reruns this workflow's own default prompt" — matches the new design (§5 of the spec).

- [ ] **Step 9: Type filter dropdown**

Line 342-346, add an option:
```tsx
                <option value="">All Types</option>
                <option value="regular">Catalogue workflows</option>
                <option value="tryon">Tryon</option>
                <option value="saree_step1">Saree Step 1</option>
                <option value="saree_step1_two_input">Saree Step 1 (2-input)</option>
                <option value="regeneration">Regeneration</option>
```

- [ ] **Step 10: Typecheck and manual smoke test**

```bash
pnpm --filter @aivastra/admin typecheck
pnpm --filter @aivastra/admin dev
```
In a browser: open the admin panel's Workflows page, click "Upload workflow", select the "Regeneration" type button, upload the repo-root `regen.json`, click Parse, confirm the source-image and output nodes auto-fill and no garment-node field is shown, then Create. Open the newly-created workflow's edit drawer and confirm the "Regeneration reasons & prompts" section is visible there but not on any `'regular'`/`'tryon'` workflow's edit drawer.

- [ ] **Step 11: Commit**

```bash
git add apps/admin-web/src/components/WorkflowUploadModal.tsx apps/admin-web/src/pages/WorkflowsPage.tsx
git commit -m "$(cat <<'EOF'
feat(admin-web): add regeneration workflow type to the upload/edit UI

EOF
)"
```

---

### Task 4: API — rewrite `regenerate.ts` and its tests

**Files:**
- Modify: `packages/types/src/job-taxonomy.ts` (`JOB_SOURCE.REGENERATE`)
- Modify: `apps/api/src/modules/jobs/regenerate.ts` (full rewrite of `regenerateJob`/`getRegenerateReasons`; delete `resolveEffectiveWorkflowTemplateId`, `pickRegenerationPrompt`, `getRegenerationReasonPrompts`)
- Modify: `apps/api/test/integration/regenerate.test.ts` (rewrite to match unified behavior)

**Interfaces:**
- Consumes: `keys.output(jobId, format?)` from `@aivastra/storage` (already imported project-wide as `keys`).
- Consumes: `promptGuard` from `./sanitize.js` (already imported in the current file).
- Consumes: `resolveQueueRouting(app, userId)` from `./create.js` — returns `{ queueStream, priority, watermark }` (already used elsewhere in this file's current version).
- Produces (unchanged signatures, consumed by `apps/api/src/modules/jobs/routes.ts` — no route changes needed): `regenerateJob(app, userId, originalJobId, reason): Promise<{ jobId: string; catalogueId?: string }>`, `getRegenerateReasons(app, userId, jobId): Promise<string[]>`.

- [ ] **Step 1: Add the taxonomy value**

In `packages/types/src/job-taxonomy.ts`, add to `JOB_SOURCE` (after `WORDPRESS_TRYON`):
```ts
  WORDPRESS_TRYON: 'wordpress_tryon',
  REGENERATE: 'regenerate',
} as const;
```

- [ ] **Step 2: Rewrite `apps/api/src/modules/jobs/regenerate.ts`**

Full file contents:
```ts
import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { keys } from '@aivastra/storage';
import { AppError } from '../../lib/errors.js';
import { promptGuard } from './sanitize.js';
import { resolveQueueRouting } from './create.js';

const FREE_REGENERATE_DAILY_LIMIT = 5;
const FREE_REGENERATE_LIMIT_ENABLED = true;

function freeRegenerateKey(userId: string): string {
  // UTC calendar day — a fixed boundary is simpler and good enough for a soft
  // daily allowance; no need to account for the user's own timezone here.
  const day = new Date().toISOString().slice(0, 10);
  return `regen:free:${userId}:${day}`;
}

async function getFreeRegenerateCount(app: FastifyInstance, userId: string): Promise<number> {
  const raw = await app.redis.get(freeRegenerateKey(userId));
  return raw ? Number(raw) : 0;
}

async function incrementFreeRegenerateCount(app: FastifyInstance, userId: string): Promise<void> {
  const key = freeRegenerateKey(userId);
  const count = await app.redis.incr(key);
  // Only the first increment of the day sets the expiry — a 2-day TTL is a
  // generous safety buffer so a clock skew or slow request near midnight can
  // never leave the key stuck permanently.
  if (count === 1) await app.redis.expire(key, 172_800);
}

/** The one admin-configured regeneration workflow. Every regenerate click
 *  runs through it, regardless of what produced the original image — see
 *  docs/superpowers/specs/2026-08-31-dedicated-regeneration-workflow-design.md. */
async function getActiveRegenerationTemplate(app: FastifyInstance) {
  const [row] = await app.db
    .select({
      id: schema.workflowTemplates.id,
      version: schema.workflowTemplates.version,
      regenerationReasonPrompts: schema.workflowTemplates.regenerationReasonPrompts,
    })
    .from(schema.workflowTemplates)
    .where(
      and(
        eq(schema.workflowTemplates.workflowType, 'regeneration'),
        eq(schema.workflowTemplates.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Resolves the reason labels to offer for regenerating a given job. These are
 * no longer job-specific — every job regenerates through the same single
 * workflow, so this is just that workflow's configured reason list. jobId is
 * still required and validated (ownership + existence) so a caller can't
 * probe reasons for a job they don't own via this endpoint.
 */
export async function getRegenerateReasons(
  app: FastifyInstance,
  userId: string,
  jobId: string,
): Promise<string[]> {
  const [job] = await app.db
    .select({ userId: schema.jobs.userId })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));
  if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
  if (job.userId !== userId) throw new AppError('NOT_FOUND', 404, 'job not found');

  const template = await getActiveRegenerationTemplate(app);
  if (!template) return [];
  return template.regenerationReasonPrompts.map((p) => p.reason);
}

/**
 * Regenerate = a brand-new job that runs the single dedicated regeneration
 * ComfyUI workflow, taking the ORIGINAL job's own generated output as its
 * only input — never the original job's own pipeline (studio/tryon-direct/
 * saree all funnel through this one path now). Always free
 * (creditsCharged: 0) within today's allowance — never charge-then-refund,
 * so every existing refund path naturally no-ops for it (they all guard on
 * `creditsCharged > 0`).
 */
export async function regenerateJob(
  app: FastifyInstance,
  userId: string,
  originalJobId: string,
  reason: string,
) {
  const cleanReason = promptGuard(reason);
  if (!cleanReason) throw new AppError('VALIDATION', 400, 'a reason is required to regenerate');

  const [original] = await app.db
    .select({
      job: schema.jobs,
      resultKey: schema.jobOutputs.resultKey,
      downloadedAt: schema.jobOutputs.downloadedAt,
    })
    .from(schema.jobs)
    .leftJoin(schema.jobOutputs, eq(schema.jobs.id, schema.jobOutputs.jobId))
    .where(eq(schema.jobs.id, originalJobId));

  if (!original) throw new AppError('NOT_FOUND', 404, 'job not found');
  if (original.job.userId !== userId) throw new AppError('NOT_FOUND', 404, 'job not found');
  if (original.job.status !== 'COMPLETED') {
    throw new AppError('CONFLICT', 409, 'can only regenerate completed jobs');
  }
  if (original.downloadedAt) {
    throw new AppError(
      'ALREADY_DOWNLOADED',
      409,
      'this result has already been downloaded and can no longer be regenerated',
    );
  }

  if (FREE_REGENERATE_LIMIT_ENABLED) {
    const freeUsedToday = await getFreeRegenerateCount(app, userId);
    if (freeUsedToday >= FREE_REGENERATE_DAILY_LIMIT) {
      throw new AppError(
        'FREE_REGENERATE_LIMIT',
        429,
        `You've used all ${FREE_REGENERATE_DAILY_LIMIT} free regenerations for today. Please contact customer support for more.`,
      );
    }
  }

  const template = await getActiveRegenerationTemplate(app);
  if (!template) {
    throw new AppError('CONFIG', 400, 'regeneration is not configured by admin');
  }

  // Legacy rows (predating job_outputs.resultKey being populated for every
  // job) fall back to the PNG convention — same fallback createCatalogVideoJob
  // already uses for "reuse a completed job's own result as an input image."
  const sourceImageKey = original.resultKey ?? keys.output(originalJobId);

  // A non-empty match becomes the prompt override; no match (or a blank
  // configured prompt, e.g. "Other") means the workflow's own baked-in
  // default prompt runs unchanged — same "empty = no override" convention
  // documented on regenerationReasonPrompts.
  const promptOverride = template.regenerationReasonPrompts.find(
    (p) => p.reason === cleanReason,
  )?.prompt;

  const { queueStream, priority, watermark } = await resolveQueueRouting(app, userId);

  const newJobId = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId,
        status: 'QUEUED',
        priority,
        queueStream,
        watermark,
        creditsCharged: 0,
        source: JOB_SOURCE.REGENERATE,
        parentJobId: originalJobId,
      })
      .returning();
    if (!newJob) throw new AppError('INSERT_FAILED', 500, 'failed to create regenerate job');

    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      params: {
        kind: 'regenerate',
        sourceImageKey,
        sourceJobId: originalJobId,
        workflowTemplateId: template.id,
        dispatchTemplateVersion: template.version,
        ...(promptOverride?.trim() ? { promptOverride } : {}),
      },
    });

    // Logged against the NEW job (not the original) — parentJobId already
    // links back to the original on the jobs row itself, and admins
    // reviewing a regenerated job want the reason available right there.
    await tx.insert(schema.jobEvents).values({
      jobId: newJob.id,
      eventType: 'REGENERATE_REASON',
      payload: { reason: cleanReason, parentJobId: originalJobId },
    });

    return newJob.id;
  });

  const stream = `jobs:${queueStream}`;
  await app.redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', newJobId, 'userId', userId);

  // Skipped while the cap is disabled too — otherwise local testing would
  // silently burn through the real quota and the very first regenerate after
  // re-enabling it could already be over the limit.
  if (FREE_REGENERATE_LIMIT_ENABLED) await incrementFreeRegenerateCount(app, userId);

  return { jobId: newJobId };
}
```

Note the return type drops `catalogueId` — the old implementation returned it because it replayed `createJob`/`createSareeJob`/`createSimpleTryonJob`, which each mint one for their own purposes; a regenerate job is not itself a new catalogue entry (it's a decoupled edit of an existing output), so there is nothing to return there. Check `apps/api/src/modules/jobs/routes.ts`'s `POST /v1/jobs/:id/regenerate` handler (~line 178-200) and any frontend consumer of this endpoint's response shape for a `catalogueId` read — if the studio UI reads it, decide there whether to drop the read or keep returning `catalogueId: undefined` for compatibility. Search first:
```bash
grep -rn "regenerate" apps/catalogues-web/src apps/admin-web/src 2>/dev/null | grep -i catalogueId
```
If nothing references it, no further change needed — TypeScript's structural typing accepts the narrower return shape wherever the old one was used as `{ jobId }`.

- [ ] **Step 3: Rewrite `apps/api/test/integration/regenerate.test.ts`**

The old file's premise ("reuses job-creation pipeline, never a separate implementation") is now the opposite of the real behavior. Replace its full contents:

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('regenerate — one dedicated workflow, decoupled from the original job', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  beforeEach(async () => {
    await app.redis.del('jobs:normal');
    await app.redis.del('jobs:priority');
    // The seed migration (packages/db) installs one active 'regeneration'
    // template by default — deactivate it here so each test starts from a
    // clean, explicit slate and seeds its own via seedRegenTemplate().
    await app.db
      .update(schema.workflowTemplates)
      .set({ isActive: false })
      .where(eq(schema.workflowTemplates.workflowType, 'regeneration'));
  });

  async function registerUser(email: string) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, emailVerified: true, tier: 'free' })
      .returning();
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const accessToken = await signAccess(secret, user.id, { kind: 'access' }, app.env.JWT_EXPIRY);
    return { token: accessToken, userId: user.id };
  }

  async function seedRegenTemplate(
    reasonPrompts: { reason: string; prompt: string }[] = [],
  ) {
    const [template] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `regen-test-${randomUUID()}`,
        label: 'Regen test workflow',
        workflowType: 'regeneration',
        jsonContent: {},
        isActive: true,
        faceNodeId: '',
        poseNodeId: '',
        bgNodeId: '',
        upperNodeIds: [],
        facePhasePromptNode: '149',
        garmentPhasePromptNode: '154',
        tryonPersonNodeId: '151',
        tryonOutputNodeId: '150',
        regenerationReasonPrompts: reasonPrompts,
      })
      .returning();
    return template;
  }

  async function seedCompletedJob(userId: string, resultKey?: string) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'COMPLETED', creditsCharged: 10 })
      .returning();
    await app.db.insert(schema.jobInputs).values({ jobId: job.id, upperGarmentKey: 'x' });
    const key = resultKey ?? keys.output(job.id);
    await app.db.insert(schema.jobOutputs).values({ jobId: job.id, resultKey: key });
    return { jobId: job.id as string, resultKey: key };
  }

  it('404s when the job does not exist', async () => {
    await seedRegenTemplate();
    const { token } = await registerUser('regen-404@x.com');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${randomUUID()}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s when the job belongs to another user', async () => {
    await seedRegenTemplate();
    const { userId: ownerId } = await registerUser('regen-owner@x.com');
    const { jobId } = await seedCompletedJob(ownerId);
    const { token } = await registerUser('regen-thief@x.com');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('409s when the original job is not COMPLETED', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-409@x.com');
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'QUEUED', creditsCharged: 1 })
      .returning();
    await app.db.insert(schema.jobInputs).values({ jobId: job.id, upperGarmentKey: 'x' });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${job.id}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('400s when no reason is provided', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-no-reason@x.com');
    const { jobId } = await seedCompletedJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400s ("regeneration is not configured") when no regeneration workflow is active', async () => {
    // No seedRegenTemplate() call — the beforeEach already deactivated the
    // migration-seeded one, so none is active.
    const { token, userId } = await registerUser('regen-not-configured@x.com');
    const { jobId } = await seedCompletedJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CONFIG');
  });

  it('creates a job whose input is the ORIGINAL job\'s own output, regardless of what kind of job it was', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-any-kind@x.com');
    const { jobId, resultKey } = await seedCompletedJob(userId);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(201);
    const { jobId: newJobId } = res.json();

    const [newJob] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, newJobId));
    expect(newJob.parentJobId).toBe(jobId);
    expect(newJob.source).toBe('regenerate');
    expect(newJob.creditsCharged).toBe(0);
    expect(newJob.watermark).toBe(false); // resolved fresh from the current plan, not copied

    const [newInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, newJobId));
    const params = newInputs.params as Record<string, unknown>;
    expect(params.kind).toBe('regenerate');
    expect(params.sourceImageKey).toBe(resultKey);
    expect(params.sourceJobId).toBe(jobId);
    // No face/background/pose/garmentType — this job shape has none.
    expect(newInputs.faceId).toBeNull();
    expect(newInputs.backgroundId).toBeNull();
    expect(newInputs.poseId).toBeNull();
  });

  it('falls back to keys.output(id) when the original job has no job_outputs row', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-legacy-output@x.com');
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'COMPLETED', creditsCharged: 10 })
      .returning();
    await app.db.insert(schema.jobInputs).values({ jobId: job.id, upperGarmentKey: 'x' });
    // Deliberately no job_outputs row.

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${job.id}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(201);
    const [newInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((newInputs.params as Record<string, unknown>).sourceImageKey).toBe(keys.output(job.id));
  });

  it('applies the prompt whose reason matches the one the user picked', async () => {
    await seedRegenTemplate([
      { reason: 'Nudity', prompt: 'fully clothed, modest fit' },
      { reason: 'Draping issue', prompt: 'natural fabric drape' },
    ]);
    const { token, userId } = await registerUser('regen-prompt-match@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Nudity' },
    });
    expect(res.statusCode).toBe(201);
    const [newInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((newInputs.params as Record<string, unknown>).promptOverride).toBe(
      'fully clothed, modest fit',
    );
  });

  it('omits promptOverride when the submitted reason matches none configured (e.g. "Other")', async () => {
    await seedRegenTemplate([{ reason: 'Nudity', prompt: 'fully clothed, modest fit' }]);
    const { token, userId } = await registerUser('regen-prompt-mismatch@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Other' },
    });
    expect(res.statusCode).toBe(201);
    const [newInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((newInputs.params as Record<string, unknown>).promptOverride).toBeUndefined();
  });

  it('409s once the result has been downloaded', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-downloaded@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const downloadRes = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/download`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(downloadRes.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('never charges credits for each of the first 5 regenerations, then 429s on the 6th', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-quota@x.com');
    await app.db
      .insert(schema.userCredits)
      .values({ userId, balance: 1000 })
      .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: 1000 } });
    const { jobId } = await seedCompletedJob(userId);

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/jobs/${jobId}/regenerate`,
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'test reason' },
      });
      expect(res.statusCode).toBe(201);
      const ledgerRows = await app.db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.jobId, res.json().jobId));
      expect(ledgerRows.length).toBe(0);
    }

    const sixth = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe('FREE_REGENERATE_LIMIT');
  });

  it('regenerating a regenerated job\'s output chains naturally (parentJobId points at the immediate parent)', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-chain@x.com');
    const { jobId: rootJobId } = await seedCompletedJob(userId);

    const first = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${rootJobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    const firstRegenId = first.json().jobId as string;
    await app.db
      .update(schema.jobs)
      .set({ status: 'COMPLETED' })
      .where(eq(schema.jobs.id, firstRegenId));
    const firstResultKey = keys.output(firstRegenId);
    await app.db
      .insert(schema.jobOutputs)
      .values({ jobId: firstRegenId, resultKey: firstResultKey });

    const second = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${firstRegenId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(second.statusCode).toBe(201);
    const [secondRegen] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, second.json().jobId));
    expect(secondRegen.parentJobId).toBe(firstRegenId); // immediate parent, not the root

    const [secondInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, second.json().jobId));
    expect((secondInputs.params as Record<string, unknown>).sourceImageKey).toBe(firstResultKey);
  });

  it('GET regenerate-reasons returns the active template\'s configured reason labels', async () => {
    await seedRegenTemplate([
      { reason: 'Nudity', prompt: 'a' },
      { reason: 'Draping issue', prompt: 'b' },
    ]);
    const { token, userId } = await registerUser('regen-reasons@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/regenerate-reasons`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reasons).toEqual(['Nudity', 'Draping issue']);
  });

  it('GET regenerate-reasons 404s for a job belonging to another user', async () => {
    await seedRegenTemplate();
    const { userId } = await registerUser('regen-reasons-owner@x.com');
    const { jobId } = await seedCompletedJob(userId);
    const { token: thiefToken } = await registerUser('regen-reasons-thief@x.com');

    const res = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/regenerate-reasons`,
      headers: { authorization: `Bearer ${thiefToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a repeated click (same Idempotency-Key) creates only one job, not two', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-idempotent@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const idempotencyKey = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
      payload: { reason: 'test reason' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
      payload: { reason: 'test reason' },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().jobId).toBe(first.json().jobId);

    const childJobs = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.parentJobId, jobId));
    expect(childJobs.length).toBe(1);
  });
});
```

- [ ] **Step 4: Run the tests**

```bash
cd apps/api
npx vitest run --config vitest.integration.config.ts regenerate -v
```
Expected: all tests PASS.

- [ ] **Step 5: Typecheck, unit tests, and commit**

```bash
pnpm --filter @aivastra/types typecheck
pnpm --filter @aivastra/api typecheck
pnpm --filter @aivastra/api test
git add packages/types/src/job-taxonomy.ts apps/api/src/modules/jobs/regenerate.ts apps/api/test/integration/regenerate.test.ts
git commit -m "$(cat <<'EOF'
feat(api): regenerate always runs the one dedicated regeneration workflow

Replaces replaying the original job's own pipeline (studio/tryon-direct/
saree, each with its own branch) with a single unified path: the original
job's own generated output is the only input, the reason-selected prompt
the only variable.

EOF
)"
```

---

### Task 5: Dispatcher — `processRegenerateJob`

**Files:**
- Modify: `apps/dispatcher/src/job/processor.ts` (new routing branch + new `processRegenerateJob` function)
- Test: `apps/dispatcher/test/integration/regenerate-job.test.ts` (new file)

**Interfaces:**
- Consumes: `resolveWorkflowTemplateVersion(db, workflowTemplateId, snapshotVersion)` from `../workflow/resolve-template-version.js` — returns the full `workflowTemplates` row (or archived-version row), already imported in this file.
- Consumes: `selectWorker(redis, pool)`, `setWorkerStatus(redis, id, status)` from `../worker/registry.js`/`../worker/selector.js` — already imported.
- Consumes: `uploadImageToComfy(url, apiKey, bytes, filename, mime, log)`, `submitPrompt(url, apiKey, clientUuid, workflow, log)`, `fetchHistory(url, apiKey, promptId, log, outputNodeId)`, `downloadOutputImage(url, apiKey, filename, subfolder)` from `../comfyui/client.js` — already imported.
- Consumes: `waitForCompletion(url, apiKey, clientUuid, promptId, timeoutMs, onProgress, logFns)` from `../comfyui/progress.js` — already imported.
- Consumes: `finalizeOutput({ imageBytes, jobId, userId, jobWatermark, outputFormat, db, pub, s3, r2Bucket, jobLog })` from `../workflow/finalize.js` — already imported.
- Consumes: `transitionJob(db, pub, jobId, userId, status, extra, log)` from `./state.js` — already imported.
- Consumes: module-local `requeueForNoWorker`, `markFailed`, `handleFailure`, `recordJobOutcome`, `recordComfyDuration`, `MAX_QUEUE_WAIT_MS`, `ProcessorConfig` type — all already defined in this same file.

- [ ] **Step 1: Add the routing branch**

In `processJob`, right after the existing `personKey` (tryon-direct) branch and before the `saree_mannequin` branch (~line 250-266):
```ts
  if (!inputs.faceId && !inputs.backgroundId && !inputs.poseId && rawParams.kind === 'regenerate') {
    await processRegenerateJob(
      cfg,
      job,
      inputs,
      rawParams,
      userId,
      stream,
      messageId,
      jobLog,
      startedAt,
      retryCount,
    );
    return;
  }

```

- [ ] **Step 2: Write `processRegenerateJob`**

Add this new function immediately after `processTryonDirectJob` ends (after line 1127, before the "Saree mannequin (step-1) job processor" section comment):

```ts
// ── Regenerate job processor ────────────────────────────────────────────

type RegenerateJob = {
  id: string;
  creditsCharged: number;
  attempts: number;
  createdAt: Date;
  watermark: boolean;
  source: string | null;
};

async function processRegenerateJob(
  cfg: ProcessorConfig,
  job: RegenerateJob,
  _inputs: typeof schema.jobInputs.$inferSelect,
  params: Record<string, unknown>,
  userId: string,
  stream: string,
  messageId: string,
  jobLog: Logger,
  startedAt: number,
  retryCount: number,
): Promise<void> {
  const { db, redis, pub, s3, r2Bucket } = cfg;
  const jobId = job.id;

  const sourceImageKey = params.sourceImageKey as string;
  const workflowTemplateId = params.workflowTemplateId as string;
  const promptOverride = typeof params.promptOverride === 'string' ? params.promptOverride : '';

  if (!workflowTemplateId) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_WORKFLOW', jobLog, startedAt);
    return;
  }
  if (!sourceImageKey) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MISSING_SOURCE_IMAGE',
      jobLog,
      startedAt,
    );
    return;
  }

  const snapshotVersion =
    typeof params.dispatchTemplateVersion === 'number' ? params.dispatchTemplateVersion : null;
  const template = await resolveWorkflowTemplateVersion(db, workflowTemplateId, snapshotVersion);

  if (!template) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'WORKFLOW_NOT_FOUND',
      jobLog,
      startedAt,
    );
    return;
  }

  const personNodeId = template.tryonPersonNodeId;
  const promptNodeId = template.garmentPhasePromptNode;
  const outputNodeId = template.tryonOutputNodeId;

  if (!personNodeId || !outputNodeId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'REGEN_NODES_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }

  await transitionJob(db, pub, jobId, userId, 'PREPROCESSING', {}, jobLog);
  const worker = await selectWorker(redis, WORKER_POOL.TRYON);
  if (!worker) {
    if (Date.now() - job.createdAt.getTime() > MAX_QUEUE_WAIT_MS) {
      jobLog.warn('no idle tryon worker — regenerate job exceeded max queue wait, terminating with refund');
      await terminateJob(
        cfg,
        jobId,
        userId,
        stream,
        messageId,
        'NO_WORKER',
        job.creditsCharged,
        jobLog,
        startedAt,
        job.source,
      );
    } else {
      jobLog.warn('no idle worker — re-enqueuing regenerate job with backoff');
      await requeueForNoWorker({
        db,
        redis,
        jobId,
        stream,
        messageId,
        retryCount,
        extraFields: ['userId', userId],
        jobLog,
        startedAt,
        jobType: job.source,
      });
    }
    return;
  }
  const w = worker;
  jobLog.info({ workerId: w.id }, 'worker claimed for regenerate');

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

    jobLog.info('uploading regenerate source image to ComfyUI');
    const sourceFile = await uploadToComfy(sourceImageKey, 'source');

    // Clone and patch workflow
    const workflow = structuredClone(template.jsonContent) as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    if (workflow[personNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[personNodeId].inputs!.image = sourceFile;
    }
    // Empty/whitespace-only override is skipped so the workflow's own
    // hardcoded default prompt text runs — same convention applyWorkflowPatch
    // uses for every other workflow type's positive prompt.
    if (promptOverride.trim() && promptNodeId && workflow[promptNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[promptNodeId].inputs!.prompt = promptOverride;
    }

    await transitionJob(db, pub, jobId, userId, 'GENERATING', { workerId: w.id }, jobLog);
    const clientUuid = randomUUID();
    const comfyStartedAt = Date.now();
    const { promptId } = await submitPrompt(w.url, w.apiKey, clientUuid, workflow, jobLog);
    jobLog.info({ promptId }, 'regenerate prompt submitted');

    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: {
        promptId,
        workerId: w.id,
        workerUrl: w.url,
        workflowTemplateId,
        inputs: { sourceImageKey, sourceFile },
      },
    });

    await waitForCompletion(
      w.url,
      w.apiKey,
      clientUuid,
      promptId,
      300_000,
      (update) => jobLog.debug(update, 'comfyui progress'),
      {
        info: jobLog.info.bind(jobLog),
        debug: jobLog.debug.bind(jobLog),
        error: jobLog.error.bind(jobLog),
      },
    );
    await recordComfyDuration(db, jobId, job.source, comfyStartedAt);

    await transitionJob(db, pub, jobId, userId, 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(w.url, w.apiKey, promptId, jobLog, outputNodeId);
    const [firstImage] = outputImages;
    if (!firstImage) throw new Error('ComfyUI returned no output images for regenerate job');

    const imageBytes = await downloadOutputImage(
      w.url,
      w.apiKey,
      firstImage.filename,
      firstImage.subfolder,
    );

    // outputFormat: 'webp' — same convention as tryon-direct (processTryonDirectJob):
    // a direct edit of an existing image, not a from-scratch catalogue render.
    await finalizeOutput({
      imageBytes,
      jobId,
      userId,
      jobWatermark: job.watermark,
      outputFormat: 'webp',
      db,
      pub,
      s3,
      r2Bucket,
      jobLog,
    });
    await redis.xack(stream, 'dispatcher-cg', messageId);
    await setWorkerStatus(redis, w.id, 'IDLE');
    recordJobOutcome('success', startedAt, job.source);
    jobLog.info('regenerate job completed');
  } catch (err) {
    jobLog.error({ err }, 'regenerate job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    const errMsg = err instanceof Error ? err.message : String(err);
    await handleFailure(cfg, jobId, userId, stream, messageId, jobLog, startedAt, errMsg);
  }
}

```

Note: `terminateJob` is defined later in the same file (module-level function, hoisted) — already called this way by `processTryonDirectJob`, so no import change needed.

- [ ] **Step 3: Write the integration test**

Create `apps/dispatcher/test/integration/regenerate-job.test.ts`, modeled directly on `apps/dispatcher/test/integration/tryon-direct-webp.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKER_ID = 'test-worker-regenerate';
const PERSON_NODE_ID = '151';
const PROMPT_NODE_ID = '154';
// comfy-mock's /history handler hardcodes output images under node '10'.
const OUTPUT_NODE_ID = '10';

describe('regenerate job (source=regenerate) — single-image edit, result uploaded as WebP', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;
  let realOutputBytes: Uint8Array;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
    comfy = await startComfyMock();

    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url, apiKey: 'test-key' }]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');

    realOutputBytes = await sharp({
      create: { width: 640, height: 800, channels: 3, background: { r: 90, g: 140, b: 200 } },
    })
      .png()
      .toBuffer();
  }, 60_000);

  afterAll(async () => {
    await deregisterWorker(redis, WORKER_ID);
    await comfy.close();
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  beforeEach(async () => {
    comfy.setOptions({ outputBytes: realOutputBytes });
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');
  });

  async function seedRegenerateJob(promptOverride?: string) {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `regen-${randomUUID()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    if (!user) throw new Error('failed to seed user');
    await env.db.insert(schema.userCredits).values({ userId: user.id, balance: 10 });

    const [template] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `regen-tpl-${randomUUID()}`,
        label: 'Regen test template',
        jsonContent: {
          [PERSON_NODE_ID]: { inputs: { image: '' } },
          [PROMPT_NODE_ID]: { inputs: { prompt: 'default reason prompt' } },
          [OUTPUT_NODE_ID]: { class_type: 'SaveImage', inputs: {} },
        },
        faceNodeId: '',
        poseNodeId: '',
        bgNodeId: '',
        upperNodeIds: [],
        facePhasePromptNode: 'x',
        garmentPhasePromptNode: PROMPT_NODE_ID,
        workflowType: 'regeneration',
        tryonPersonNodeId: PERSON_NODE_ID,
        tryonOutputNodeId: OUTPUT_NODE_ID,
      })
      .returning();
    if (!template) throw new Error('failed to seed workflow template');

    const [job] = await env.db
      .insert(schema.jobs)
      .values({
        userId: user.id,
        status: 'QUEUED',
        creditsCharged: 0,
        source: 'regenerate',
      })
      .returning();
    if (!job) throw new Error('failed to seed job');

    const sourceImageKey = `outputs/${randomUUID()}/result.webp`;

    // Tryon-direct/regenerate jobs are identified by shape: no faceId/
    // backgroundId/poseId, and params.kind set (see processor.ts's top-level routing).
    await env.db.insert(schema.jobInputs).values({
      jobId: job.id,
      params: {
        kind: 'regenerate',
        sourceImageKey,
        workflowTemplateId: template.id,
        ...(promptOverride ? { promptOverride } : {}),
      },
    });

    await env.s3.send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: sourceImageKey,
        Body: Buffer.from('stub'),
        ContentType: 'image/webp',
      }),
    );

    return { jobId: job.id as string, userId: user.id as string, template };
  }

  it('uploads the result as image/webp at outputs/{jobId}/result.webp', async () => {
    const { jobId, userId } = await seedRegenerateJob();
    const log = createLogger('test');

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      `${Date.now()}-0`,
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('COMPLETED');

    const [output] = await env.db
      .select()
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, jobId));
    expect(output?.resultKey).toBe(`outputs/${jobId}/result.webp`);

    const obj = await env.s3.send(
      new GetObjectCommand({ Bucket: env.r2Bucket, Key: `outputs/${jobId}/result.webp` }),
    );
    expect(obj.ContentType).toBe('image/webp');
  });

  it('fails with REGEN_NODES_NOT_CONFIGURED when the template has no person/output node', async () => {
    const { jobId, userId, template } = await seedRegenerateJob();
    await env.db
      .update(schema.workflowTemplates)
      .set({ tryonPersonNodeId: null })
      .where(eq(schema.workflowTemplates.id, template.id));
    const log = createLogger('test');

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      `${Date.now()}-0`,
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('FAILED');
    expect(job?.errorCode).toBe('REGEN_NODES_NOT_CONFIGURED');
  });
});
```

- [ ] **Step 4: Run the tests**

Check `apps/dispatcher/package.json` for the exact integration-test script name (mirror the pattern used for `apps/api` — likely `test:integration` or a dedicated vitest config), then run just this new file, e.g.:
```bash
cd apps/dispatcher
npx vitest run --config vitest.integration.config.ts regenerate-job -v
```
Expected: both tests PASS.

- [ ] **Step 5: Typecheck, full dispatcher test suite, and commit**

```bash
pnpm --filter @aivastra/dispatcher typecheck
pnpm --filter @aivastra/dispatcher test
git add apps/dispatcher/src/job/processor.ts apps/dispatcher/test/integration/regenerate-job.test.ts
git commit -m "$(cat <<'EOF'
feat(dispatcher): add processRegenerateJob — single-image edit, no garment input

EOF
)"
```

---

### Task 6: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and lint**

```bash
pnpm typecheck
pnpm lint
```
Expected: no errors introduced by this feature (pre-existing unrelated failures, if any, are out of scope — but check that nothing here is newly broken).

- [ ] **Step 2: Full unit test suite**

```bash
pnpm --filter @aivastra/api test
pnpm --filter @aivastra/dispatcher test
```

- [ ] **Step 3: Full integration test suite for the touched apps**

```bash
pnpm --filter @aivastra/api test:integration
cd apps/dispatcher && npx vitest run --config vitest.integration.config.ts
```
Expected: all PASS, including every pre-existing regenerate-adjacent test (e.g. `apps/dispatcher/test/integration/tryon-direct-webp.test.ts`, unaffected by this change) and everything from Tasks 2, 4, 5 above.

- [ ] **Step 4: Manual smoke test end-to-end (if a local ComfyUI worker is available)**

If not, note explicitly in the final report that this step was skipped and why — do not claim it was verified.

1. Start the full stack: `pnpm docker:up && pnpm dev`.
2. In the admin panel, confirm the seeded "Regeneration" workflow (Task 1) appears under Workflows with type "Regeneration" and is active.
3. In the studio web app, generate one catalogue image, then click regenerate on its result, pick a reason, and confirm a new job appears and (if a worker is reachable) completes.
4. Confirm the regenerated job's `source` column reads `regenerate` and `parentJobId` points at the original.

- [ ] **Step 5: Report**

Summarize what ran and passed/failed, per the verification-before-completion discipline — do not claim success for any step not actually executed.
