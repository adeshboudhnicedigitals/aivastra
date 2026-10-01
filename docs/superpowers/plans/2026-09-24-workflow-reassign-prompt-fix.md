# Workflow Reassign Prompt-Override Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `POST /admin/workflows/:id/reassign` so it nulls-and-inherits prompt overrides
instead of freezing a stale copy (matching `/replace`'s already-shipped contract), surface
per-template prompt-override counts on the admin Workflows edit screen, wire the dead
Reassign UI into a reachable button, and close the EditPoseAssetModal data-loss trap where
switching a pose's workflow silently discards hand-typed prompt text.

**Architecture:** Four independent, additive changes: (1) a backend transaction fix in
`workflows.routes.ts`'s `/reassign` handler that mirrors the null-and-inherit contract
`/replace` already has, scoped correctly per `processor.ts`'s actual precedence rules; (2) two
new grouped-count queries added to the existing `GET /admin/workflows` list handler; (3) two
`apps/admin-web` UI changes consuming those counts and that fixed endpoint. No schema
migration, no change to `apps/dispatcher` (it already treats `null` as "fall back to the next
layer").

**Tech Stack:** Fastify 5 + Drizzle ORM (API), Vitest integration tests reusing the
docker-compose Postgres, React + Vite (admin-web, no test framework — verify via `tsc -b` and
manual browser check).

## Global Constraints

- No schema/migration changes — pure application logic (mirrors the 2026-09-11 replace design
  doc's own non-goal).
- Every admin write already goes through `recordAudit` inside the same transaction — extend the
  existing `workflow.reassign` audit payload, don't add a second audit call.
- `packages/db` exports `* as schema` from `@aivastra/db` — import that way, never by relative
  path into `packages/`.
- Match the surrounding file's comment density: explain *why*, not *what*, especially for the
  precedence subtlety in Task 1.
- Docker infra (`pnpm docker:up`) must be running before any integration test task.

---

### Task 1: Fix `/admin/workflows/:id/reassign` to null-and-inherit prompts correctly

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts:1538-1593` (the whole
  `POST /admin/workflows/:id/reassign` handler)
- Test: `apps/api/test/integration/admin-workflows.test.ts` (new `describe` block, add after the
  `describe('workflow replace with drain', ...)` block closes, i.e. immediately before
  `describe('regeneration workflows', ...)` at line 1473)

**Interfaces:**
- Consumes: `schema.modelPoseAssets`, `schema.poseGarmentConfigs`, `schema.workflowTemplates`
  (existing Drizzle schema — no changes), `recordAudit(tx, {...})` from `./audit.js` (existing
  signature, unchanged).
- Produces: route response shape becomes
  `{ ok: true, updated: number, clearedPosePromptCount: number, clearedGarmentConfigPromptCount: number }`
  (was `{ ok: true, updated: number }`). `updated` keeps its current meaning (count of
  `model_pose_assets` rows moved to the target template) — Task 4's frontend reads all four
  fields.

**Why the fix differs from a literal copy of `/replace`'s three-set clear:** `/replace` changes
a template's *graph* in place while its `id` stays the same, so every row pointing at that `id`
— including a `pose_garment_configs` row with its own explicit `workflowTemplateId` — is now
stale. `/reassign` is different: it never touches `sourceId`'s graph, it only moves which poses'
*own* `workflowTemplateId` field points at it. A `pose_garment_configs` row with its own
non-null `workflowTemplateId` resolves independently of the pose
(`apps/dispatcher/src/job/processor.ts:493`, `else if (cfgRow?.workflowTemplateId) { effectiveWorkflowTemplateId = cfgRow.workflowTemplateId; }`)
— if that id happens to equal `sourceId`, `sourceId`'s graph is unmodified by this reassign, so
that row's prompt text is still valid and must **not** be cleared. Only `pose_garment_configs`
rows that *inherit* their workflow from a reassigned pose (`workflowTemplateId IS NULL`) are
actually affected, because their effective graph just moved from `sourceId` to
`targetWorkflowId` along with the pose.

- [ ] **Step 1: Write the failing integration tests**

Add this new `describe` block to
`apps/api/test/integration/admin-workflows.test.ts`, immediately before line 1473's
`describe('regeneration workflows', ...)`:

```ts
  describe('workflow reassign prompt invalidation', () => {
    async function seedWorkflowTemplate(labelSuffix: string) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `reassign_prompt_${labelSuffix}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          label: `Reassign Prompt ${labelSuffix}`,
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(res.statusCode).toBe(200);
      return res.json().id as string;
    }

    async function reassign(sourceId: string, targetWorkflowId: string) {
      const res = await app.inject({
        method: 'POST',
        url: `/admin/workflows/${sourceId}/reassign`,
        headers,
        payload: { targetWorkflowId },
      });
      expect(res.statusCode).toBe(200);
      return res.json();
    }

    it('nulls (not freezes) a pose default prompt override on reassign, moving workflowTemplateId to the target', async () => {
      const sourceId = await seedWorkflowTemplate('pose_default_source');
      const targetId = await seedWorkflowTemplate('pose_default_target');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Reassign pose with default override',
          genderSlug: 'women',
          r2Key: `reassign-prompt-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'reassign-prompt-pose-thumb.jpg',
          scope: 'general',
          workflowTemplateId: sourceId,
          promptGarmentPhase: 'old garment phase text',
          promptFacePhase: 'old face phase text',
        })
        .returning();

      const result = await reassign(sourceId, targetId);
      expect(result.updated).toBe(1);
      expect(result.clearedPosePromptCount).toBe(1);
      expect(result.clearedGarmentConfigPromptCount).toBe(0);

      const [updatedPose] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, pose.id));
      expect(updatedPose.workflowTemplateId).toBe(targetId);
      expect(updatedPose.promptGarmentPhase).toBeNull();
      expect(updatedPose.promptFacePhase).toBeNull();
    });

    it('clears an inherited per-garment-type override when the pose it inherits from is reassigned', async () => {
      const sourceId = await seedWorkflowTemplate('config_inherited_source');
      const targetId = await seedWorkflowTemplate('config_inherited_target');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Reassign pose with inherited config',
          genderSlug: 'women',
          r2Key: `reassign-prompt-inherited-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'reassign-prompt-inherited-pose-thumb.jpg',
          scope: 'general',
          workflowTemplateId: sourceId,
        })
        .returning();
      const [garmentType] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `reassign-prompt-inherited-gt-${Date.now()}-${Math.random()}`,
          label: 'Reassign Prompt Inherited GT',
          isActive: true,
        })
        .returning();
      const [config] = await app.db
        .insert(schema.poseGarmentConfigs)
        .values({
          poseAssetId: pose.id,
          subcategoryId: garmentType.id,
          workflowTemplateId: null,
          promptGarmentPhase: 'old inherited garment phase text',
          promptFacePhase: 'old inherited face phase text',
        })
        .returning();

      const result = await reassign(sourceId, targetId);
      expect(result.clearedGarmentConfigPromptCount).toBe(1);

      const [updatedConfig] = await app.db
        .select()
        .from(schema.poseGarmentConfigs)
        .where(eq(schema.poseGarmentConfigs.id, config.id));
      expect(updatedConfig.promptGarmentPhase).toBeNull();
      expect(updatedConfig.promptFacePhase).toBeNull();
      expect(updatedConfig.workflowTemplateId).toBeNull();
    });

    it('does NOT clear a garment-config override that explicitly points at the source template', async () => {
      const sourceId = await seedWorkflowTemplate('config_direct_source');
      const targetId = await seedWorkflowTemplate('config_direct_target');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Reassign pose for direct config',
          genderSlug: 'women',
          r2Key: `reassign-prompt-direct-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'reassign-prompt-direct-pose-thumb.jpg',
          scope: 'general',
          workflowTemplateId: sourceId,
        })
        .returning();
      const [garmentType] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `reassign-prompt-direct-gt-${Date.now()}-${Math.random()}`,
          label: 'Reassign Prompt Direct GT',
          isActive: true,
        })
        .returning();
      // This config row explicitly pins sourceId as ITS OWN workflow — independent of
      // the pose's own field, which is what's being reassigned. sourceId's graph is
      // untouched by the reassign, so this row's prompt must survive.
      const [config] = await app.db
        .insert(schema.poseGarmentConfigs)
        .values({
          poseAssetId: pose.id,
          subcategoryId: garmentType.id,
          workflowTemplateId: sourceId,
          promptGarmentPhase: 'untouched direct garment phase text',
          promptFacePhase: 'untouched direct face phase text',
        })
        .returning();

      const result = await reassign(sourceId, targetId);
      expect(result.clearedGarmentConfigPromptCount).toBe(0);

      const [updatedConfig] = await app.db
        .select()
        .from(schema.poseGarmentConfigs)
        .where(eq(schema.poseGarmentConfigs.id, config.id));
      expect(updatedConfig.promptGarmentPhase).toBe('untouched direct garment phase text');
      expect(updatedConfig.promptFacePhase).toBe('untouched direct face phase text');
      expect(updatedConfig.workflowTemplateId).toBe(sourceId);
    });

    it('records clearedPosePromptCount/clearedGarmentConfigPromptCount in the audit log', async () => {
      const sourceId = await seedWorkflowTemplate('audit_source');
      const targetId = await seedWorkflowTemplate('audit_target');
      await app.db.insert(schema.modelPoseAssets).values({
        label: 'Reassign pose for audit check',
        genderSlug: 'women',
        r2Key: `reassign-prompt-audit-pose-${Date.now()}-${Math.random()}.jpg`,
        thumbnailKey: 'reassign-prompt-audit-pose-thumb.jpg',
        scope: 'general',
        workflowTemplateId: sourceId,
        promptGarmentPhase: 'audit garment phase text',
        promptFacePhase: 'audit face phase text',
      });

      await reassign(sourceId, targetId);

      const [auditRow] = await app.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(eq(schema.auditLogs.action, 'workflow.reassign'), eq(schema.auditLogs.resourceId, sourceId)),
        )
        .orderBy(sql`${schema.auditLogs.createdAt} desc`)
        .limit(1);
      const after = auditRow.after as {
        clearedPosePromptCount: number;
        clearedGarmentConfigPromptCount: number;
      };
      expect(after.clearedPosePromptCount).toBe(1);
      expect(after.clearedGarmentConfigPromptCount).toBe(0);
    });
  });
```

Confirm the test file already imports `and`, `sql`, `eq` from `drizzle-orm` and `schema` from
`@aivastra/db` at its top — if `and`/`sql` aren't already imported there, add them to the
existing top-of-file import line rather than adding a new import statement.

- [ ] **Step 2: Run the new tests to verify they fail**

From `apps/api`:

```bash
npx vitest run --config vitest.integration.config.ts admin-workflows -t "workflow reassign prompt invalidation"
```

Expected: the "nulls (not freezes)" test FAILs because `promptGarmentPhase` is currently copied
from the target's default, not nulled; the "does NOT clear" test currently passes by accident
(today's handler never touches `pose_garment_configs` at all) — that's fine, it's a guard against
a regression the next step could introduce if implemented too broadly.

- [ ] **Step 3: Replace the handler implementation**

In `apps/api/src/modules/admin/workflows.routes.ts`, replace the entire body from
`// POST /admin/workflows/:id/reassign` (line 1538) through the closing `);` at line 1593 with:

```ts
  // POST /admin/workflows/:id/reassign
  app.post(
    '/admin/workflows/:id/reassign',
    {
      preHandler: W,
      schema: { params: uuidParam, body: ReassignWorkflowBody },
    },
    async (req) => {
      const { id: sourceId } = req.params as { id: string };
      const { targetWorkflowId } = req.body as { targetWorkflowId: string };

      if (sourceId === targetWorkflowId) {
        throw new AppError('CONFLICT', 409, 'source and target workflow are the same');
      }

      const result = await app.db.transaction(async (tx) => {
        const [source] = await tx
          .select({ id: schema.workflowTemplates.id })
          .from(schema.workflowTemplates)
          .where(eq(schema.workflowTemplates.id, sourceId));
        if (!source) throw new AppError('NOT_FOUND', 404, 'source workflow not found');

        const [target] = await tx
          .select({ id: schema.workflowTemplates.id })
          .from(schema.workflowTemplates)
          .where(eq(schema.workflowTemplates.id, targetWorkflowId));
        if (!target) throw new AppError('NOT_FOUND', 404, 'target workflow not found');

        // Unlike /replace, a reassign never touches sourceId's own graph — it only
        // moves which poses' workflowTemplateId points at it. So a pose's own prompt
        // override is stale the moment its effective graph changes (source -> target),
        // and gets nulled-and-inherited here, matching /replace's contract
        // (docs/superpowers/specs/2026-09-11-workflow-replace-prompt-override-invalidation-design.md).
        const posesOnSource = await tx
          .select({
            id: schema.modelPoseAssets.id,
            promptGarmentPhase: schema.modelPoseAssets.promptGarmentPhase,
            promptFacePhase: schema.modelPoseAssets.promptFacePhase,
          })
          .from(schema.modelPoseAssets)
          .where(eq(schema.modelPoseAssets.workflowTemplateId, sourceId));

        const updatedRows = await tx
          .update(schema.modelPoseAssets)
          .set({
            workflowTemplateId: targetWorkflowId,
            promptGarmentPhase: null,
            promptFacePhase: null,
          })
          .where(eq(schema.modelPoseAssets.workflowTemplateId, sourceId))
          .returning({ id: schema.modelPoseAssets.id });

        const clearedPosePromptCount = posesOnSource.filter(
          (p) => p.promptGarmentPhase !== null || p.promptFacePhase !== null,
        ).length;
        const reassignedPoseIds = posesOnSource.map((p) => p.id);

        // Only pose_garment_configs rows that INHERIT their workflow from the pose
        // (workflowTemplateId IS NULL) are affected — their effective graph moved with
        // the pose from sourceId to targetWorkflowId. A row with its own non-null
        // workflowTemplateId resolves independently of the pose
        // (apps/dispatcher/src/job/processor.ts:493) — if that id happens to be
        // sourceId, sourceId's graph was NOT modified by this reassign (unlike
        // /replace), so that row's prompt is still valid and must not be cleared.
        const clearedGarmentConfigs =
          reassignedPoseIds.length > 0
            ? await tx
                .update(schema.poseGarmentConfigs)
                .set({ promptGarmentPhase: null, promptFacePhase: null, updatedAt: new Date() })
                .where(
                  and(
                    isNull(schema.poseGarmentConfigs.workflowTemplateId),
                    inArray(schema.poseGarmentConfigs.poseAssetId, reassignedPoseIds),
                    or(
                      isNotNull(schema.poseGarmentConfigs.promptGarmentPhase),
                      isNotNull(schema.poseGarmentConfigs.promptFacePhase),
                    ),
                  ),
                )
                .returning({ id: schema.poseGarmentConfigs.id })
            : [];
        const clearedGarmentConfigPromptCount = clearedGarmentConfigs.length;

        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'workflow.reassign',
          resourceType: 'workflow',
          resourceId: sourceId,
          after: {
            targetWorkflowId,
            updatedPoses: updatedRows.length,
            clearedPosePromptCount,
            clearedGarmentConfigPromptCount,
          },
          request: req,
        });

        return { updatedPoses: updatedRows, clearedPosePromptCount, clearedGarmentConfigPromptCount };
      });

      return {
        ok: true,
        updated: result.updatedPoses.length,
        clearedPosePromptCount: result.clearedPosePromptCount,
        clearedGarmentConfigPromptCount: result.clearedGarmentConfigPromptCount,
      };
    },
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run --config vitest.integration.config.ts admin-workflows -t "workflow reassign prompt invalidation"
```

Expected: PASS (all 4 new tests). Then run the full file to check for regressions:

```bash
npx vitest run --config vitest.integration.config.ts admin-workflows
```

Expected: PASS, including the untouched `describe('workflow replace with drain', ...)` block.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/workflows.routes.ts apps/api/test/integration/admin-workflows.test.ts
git commit -m "fix(admin): null-and-inherit prompt overrides on workflow reassign

/reassign was freezing a copy of the target's default prompt onto each
moved pose and never touched pose_garment_configs at all, the inverse of
/replace's already-shipped null-and-inherit contract. Fixes both, scoped
to rows that actually inherit the pose's workflow (processor.ts:493 shows
a config row with its own workflowTemplateId resolves independently)."
```

---

### Task 2: Add prompt-override counts to `GET /admin/workflows`

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts:668-740` (the `GET /admin/workflows`
  handler)
- Modify: `apps/admin-web/src/types.ts:84-136` (`WorkflowOption` interface)
- Test: `apps/api/test/integration/admin-workflows.test.ts` (new test near the existing
  `it('GET /admin/workflows list response includes facePhasePromptNode', ...)` at line 447)

**Interfaces:**
- Consumes: same schema tables as Task 1; no dependency on Task 1's code (independent list
  query, read-only).
- Produces: each row from `GET /admin/workflows` gains
  `posePromptOverrideCount: number` (poses with a non-null `promptGarmentPhase` or
  `promptFacePhase` directly on that template) and
  `garmentConfigPromptOverrideCount: number` (the direct + inherited count using the same
  logic as `/replace`'s `clearedGarmentConfigPromptCount`, but as a live SELECT, not a clear).
  `WorkflowOption.posePromptOverrideCount?: number` /
  `WorkflowOption.garmentConfigPromptOverrideCount?: number` — Task 3 reads both.

- [ ] **Step 1: Write the failing test**

Add immediately after the existing test at line 481 in
`apps/api/test/integration/admin-workflows.test.ts`:

```ts
  it('GET /admin/workflows list includes posePromptOverrideCount and garmentConfigPromptOverrideCount', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `list_override_count_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        label: 'List override count',
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    const templateId = createRes.json().id as string;

    const [poseWithOverride] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'List count pose with override',
        genderSlug: 'women',
        r2Key: `list-count-pose-${Date.now()}-${Math.random()}.jpg`,
        thumbnailKey: 'list-count-pose-thumb.jpg',
        scope: 'general',
        workflowTemplateId: templateId,
        promptGarmentPhase: 'has override',
      })
      .returning();
    await app.db.insert(schema.modelPoseAssets).values({
      label: 'List count pose without override',
      genderSlug: 'women',
      r2Key: `list-count-pose-no-override-${Date.now()}-${Math.random()}.jpg`,
      thumbnailKey: 'list-count-pose-no-override-thumb.jpg',
      scope: 'general',
      workflowTemplateId: templateId,
    });
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'women',
        slug: `list-count-gt-${Date.now()}-${Math.random()}`,
        label: 'List Count GT',
        isActive: true,
      })
      .returning();
    await app.db.insert(schema.poseGarmentConfigs).values({
      poseAssetId: poseWithOverride.id,
      subcategoryId: garmentType.id,
      workflowTemplateId: null,
      promptGarmentPhase: 'inherited config override',
    });

    const listRes = await app.inject({ method: 'GET', url: '/admin/workflows', headers });
    expect(listRes.statusCode).toBe(200);
    const row = (
      listRes.json() as {
        id: string;
        posePromptOverrideCount: number;
        garmentConfigPromptOverrideCount: number;
      }[]
    ).find((w) => w.id === templateId);
    expect(row?.posePromptOverrideCount).toBe(1);
    expect(row?.garmentConfigPromptOverrideCount).toBe(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --config vitest.integration.config.ts admin-workflows -t "posePromptOverrideCount"
```

Expected: FAIL — `row?.posePromptOverrideCount` is `undefined`.

- [ ] **Step 3: Add the grouped-count queries and merge them into the response**

In `apps/api/src/modules/admin/workflows.routes.ts`, inside the `GET /admin/workflows` handler
(line 668), extend the existing `Promise.all` (lines 671-692) with two more queries, and add a
third standalone query for the inherited-config case (it needs a join, not a simple `groupBy`).
Replace lines 671-702 with:

```ts
    const [poseCounts, funnelCounts, archives, posePromptOverrides, directConfigOverrides] =
      await Promise.all([
        app.db
          .select({
            workflowTemplateId: schema.modelPoseAssets.workflowTemplateId,
            cnt: count(),
          })
          .from(schema.modelPoseAssets)
          .groupBy(schema.modelPoseAssets.workflowTemplateId),
        app.db
          .select({
            workflowTemplateId: schema.shopifyFunnelTemplates.workflowTemplateId,
            cnt: count(),
          })
          .from(schema.shopifyFunnelTemplates)
          .groupBy(schema.shopifyFunnelTemplates.workflowTemplateId),
        app.db
          .select({
            workflowTemplateId: schema.workflowTemplateArchives.workflowTemplateId,
            version: schema.workflowTemplateArchives.version,
          })
          .from(schema.workflowTemplateArchives),
        app.db
          .select({
            workflowTemplateId: schema.modelPoseAssets.workflowTemplateId,
            cnt: count(),
          })
          .from(schema.modelPoseAssets)
          .where(
            or(
              isNotNull(schema.modelPoseAssets.promptGarmentPhase),
              isNotNull(schema.modelPoseAssets.promptFacePhase),
            ),
          )
          .groupBy(schema.modelPoseAssets.workflowTemplateId),
        app.db
          .select({
            workflowTemplateId: schema.poseGarmentConfigs.workflowTemplateId,
            cnt: count(),
          })
          .from(schema.poseGarmentConfigs)
          .where(
            and(
              isNotNull(schema.poseGarmentConfigs.workflowTemplateId),
              or(
                isNotNull(schema.poseGarmentConfigs.promptGarmentPhase),
                isNotNull(schema.poseGarmentConfigs.promptFacePhase),
              ),
            ),
          )
          .groupBy(schema.poseGarmentConfigs.workflowTemplateId),
      ]);

    // Garment-config rows that inherit their workflow from a pose (workflowTemplateId
    // IS NULL) count toward the POSE's template, not their own — same "case 3" logic
    // as /replace's clearedGarmentConfigPromptCount
    // (docs/superpowers/specs/2026-09-11-workflow-replace-prompt-override-invalidation-design.md).
    const inheritedConfigOverrides = await app.db
      .select({
        workflowTemplateId: schema.modelPoseAssets.workflowTemplateId,
        cnt: count(),
      })
      .from(schema.poseGarmentConfigs)
      .innerJoin(
        schema.modelPoseAssets,
        eq(schema.poseGarmentConfigs.poseAssetId, schema.modelPoseAssets.id),
      )
      .where(
        and(
          isNull(schema.poseGarmentConfigs.workflowTemplateId),
          or(
            isNotNull(schema.poseGarmentConfigs.promptGarmentPhase),
            isNotNull(schema.poseGarmentConfigs.promptFacePhase),
          ),
        ),
      )
      .groupBy(schema.modelPoseAssets.workflowTemplateId);

    const countMap = Object.fromEntries(
      poseCounts.map((r) => [r.workflowTemplateId, Number(r.cnt)]),
    );
    const funnelCountMap = Object.fromEntries(
      funnelCounts.map((r) => [r.workflowTemplateId, Number(r.cnt)]),
    );
    const archiveMap = Object.fromEntries(
      archives.map((r) => [r.workflowTemplateId, { fromVersion: r.version }]),
    );
    const posePromptOverrideMap = Object.fromEntries(
      posePromptOverrides.map((r) => [r.workflowTemplateId, Number(r.cnt)]),
    );
    const directConfigOverrideMap = Object.fromEntries(
      directConfigOverrides.map((r) => [r.workflowTemplateId, Number(r.cnt)]),
    );
    const inheritedConfigOverrideMap = Object.fromEntries(
      inheritedConfigOverrides.map((r) => [r.workflowTemplateId, Number(r.cnt)]),
    );
```

Then, in the `rows.map((r) => ({ ... }))` return block (lines 704-739), add two fields — insert
them right after the existing `funnelCount: funnelCountMap[r.id] ?? 0,` line:

```ts
      funnelCount: funnelCountMap[r.id] ?? 0,
      posePromptOverrideCount: posePromptOverrideMap[r.id] ?? 0,
      garmentConfigPromptOverrideCount:
        (directConfigOverrideMap[r.id] ?? 0) + (inheritedConfigOverrideMap[r.id] ?? 0),
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run --config vitest.integration.config.ts admin-workflows -t "posePromptOverrideCount"
```

Expected: PASS. Then run the whole file for regressions:

```bash
npx vitest run --config vitest.integration.config.ts admin-workflows
```

Expected: PASS.

- [ ] **Step 5: Add the fields to the frontend type**

In `apps/admin-web/src/types.ts`, in the `WorkflowOption` interface, add after the existing
`funnelCount?: number;` line (around line 131):

```ts
  posePromptOverrideCount?: number;
  garmentConfigPromptOverrideCount?: number;
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/workflows.routes.ts apps/api/test/integration/admin-workflows.test.ts apps/admin-web/src/types.ts
git commit -m "feat(admin): expose prompt-override counts on GET /admin/workflows

Lets the edit-workflow modal show how many poses/garment-configs are
currently overriding this template's default prompt and won't see an
edit to it, using the same direct+inherited counting logic /replace
already uses when it clears these overrides."
```

---

### Task 3: Show prompt-override counts in the WorkflowsPage edit-workflow modal

**Files:**
- Modify: `apps/admin-web/src/pages/WorkflowsPage.tsx:1428-1437` (the "Garment-phase prompt"
  field in the edit-workflow `EditDrawer`)

**Interfaces:**
- Consumes: `editingWf.posePromptOverrideCount` / `editingWf.garmentConfigPromptOverrideCount`
  from Task 2 (both `number | undefined`, already flowing through `workflows` state since it's
  fetched from `GET /admin/workflows`).
- Produces: no new exports — this is leaf UI.

- [ ] **Step 1: Add the override-count note**

In `apps/admin-web/src/pages/WorkflowsPage.tsx`, replace the existing block:

```tsx
            <div className="field">
              <label>Garment-phase prompt</label>
              <textarea
                className="input"
                rows={4}
                value={editForm.garmentPhasePrompt}
                disabled={editSaving}
                onChange={(e) => setEditForm((f) => ({ ...f, garmentPhasePrompt: e.target.value }))}
              />
            </div>
```

with:

```tsx
            <div className="field">
              <label>Garment-phase prompt</label>
              <textarea
                className="input"
                rows={4}
                value={editForm.garmentPhasePrompt}
                disabled={editSaving}
                onChange={(e) => setEditForm((f) => ({ ...f, garmentPhasePrompt: e.target.value }))}
              />
              {((editingWf?.posePromptOverrideCount ?? 0) > 0 ||
                (editingWf?.garmentConfigPromptOverrideCount ?? 0) > 0) && (
                <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>
                  {editingWf?.posePromptOverrideCount
                    ? `${editingWf.posePromptOverrideCount} pose${editingWf.posePromptOverrideCount === 1 ? '' : 's'}`
                    : null}
                  {editingWf?.posePromptOverrideCount && editingWf?.garmentConfigPromptOverrideCount
                    ? ' and '
                    : null}
                  {editingWf?.garmentConfigPromptOverrideCount
                    ? `${editingWf.garmentConfigPromptOverrideCount} garment-type config${editingWf.garmentConfigPromptOverrideCount === 1 ? '' : 's'}`
                    : null}
                  {' override this and won’t use this text.'}
                </span>
              )}
            </div>
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/admin-web && npx tsc -b
```

Expected: no new errors.

- [ ] **Step 3: Manually verify in the browser**

```bash
pnpm --filter @aivastra/admin dev
```

Open the Workflows page, click **Edit** on a template that has at least one pose using it with a
custom `promptGarmentPhase` (or seed one via the admin UI first). Confirm the note appears under
the Garment-phase prompt field with the correct count, and does not appear for a template with no
overrides.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/pages/WorkflowsPage.tsx
git commit -m "feat(admin): surface prompt-override counts in the edit-workflow modal

Makes it visible before editing that N poses / M garment-type configs
have pinned their own prompt text and won't see this edit take effect."
```

---

### Task 4: Wire the Reassign button into WorkflowsPage (desktop + mobile)

**Files:**
- Modify: `apps/admin-web/src/pages/WorkflowsPage.tsx:696-751` (desktop table row actions)
- Modify: `apps/admin-web/src/pages/WorkflowsPage.tsx:983-1025` (mobile card actions)
- Modify: `apps/admin-web/src/pages/WorkflowsPage.tsx:244-274` (`handleReassign`, toast wording)

**Interfaces:**
- Consumes: `setModalParams` (existing `useUrlStateMulti` hook, unchanged), Task 1's fixed
  `/reassign` response shape (`clearedPosePromptCount`, `clearedGarmentConfigPromptCount`).
- Produces: no new exports — this makes the already-built `reassigning` derived state (line 93),
  `handleReassign` (line 244), and the reassign `EditDrawer` (line 1744) reachable for the first
  time. The `DELETE` route's own error message already says "Reassign those poses first" — this
  is the fix for that dead end.

- [ ] **Step 1: Add the Reassign button next to Delete on the desktop table**

In `apps/admin-web/src/pages/WorkflowsPage.tsx`, in the desktop row-actions block, insert a new
button immediately before the existing Delete button (which starts at line 737 with
`disabled={wf.poseCount > 0}`):

```tsx
                          <button
                            className="btn sm ghost"
                            disabled={wf.poseCount === 0}
                            onClick={() =>
                              setModalParams({ modal: 'reassign-workflow', editId: wf.id })
                            }
                            title={
                              wf.poseCount === 0
                                ? 'No poses use this workflow'
                                : 'Move poses off this workflow onto another'
                            }
                          >
                            <Icon.Refresh /> Reassign
                          </button>
```

- [ ] **Step 2: Add the matching button to the mobile card actions**

In the mobile card actions block (starting around line 983, right before the Delete button that
begins with `disabled={wf.poseCount > 0}` at what is now line ~1017 after Task 3's edits),
insert:

```tsx
                        <button
                          className="btn sm ghost"
                          disabled={wf.poseCount === 0}
                          onClick={() =>
                            setModalParams({ modal: 'reassign-workflow', editId: wf.id })
                          }
                        >
                          <Icon.Refresh /> Reassign
                        </button>
```

- [ ] **Step 3: Update `handleReassign` to use the fixed response and report cleared counts**

Replace the existing `handleReassign` function (lines 244-274) with:

```tsx
  const handleReassign = async () => {
    if (!reassigning || !reassignTargetId) return;
    setReassignSaving(true);
    try {
      const result = await apiFetch<{
        ok: true;
        updated: number;
        clearedPosePromptCount: number;
        clearedGarmentConfigPromptCount: number;
      }>(`/admin/workflows/${reassigning.id}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ targetWorkflowId: reassignTargetId }),
      });
      setWorkflows((prev) =>
        prev.map((w) => {
          if (w.id === reassigning.id) return { ...w, poseCount: 0 };
          if (w.id === reassignTargetId)
            return { ...w, poseCount: w.poseCount + reassigning.poseCount };
          return w;
        }),
      );
      const clearedCount = result.clearedPosePromptCount + result.clearedGarmentConfigPromptCount;
      toast({
        title: `Poses reassigned from "${reassigning.label}"`,
        body:
          clearedCount > 0
            ? `Cleared ${clearedCount} prompt override${clearedCount === 1 ? '' : 's'} tuned to the old workflow — they'll now inherit the target's prompt.`
            : undefined,
      });
      closeModal();
      setReassignTargetId('');
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? ((e.body as { error?: { message?: string } })?.error?.message ?? 'Failed to reassign')
          : 'Failed to reassign';
      toast({ kind: 'error', title: msg });
    } finally {
      setReassignSaving(false);
    }
  };
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/admin-web && npx tsc -b
```

Expected: no new errors. (`Icon.Refresh` already exists in `apps/admin-web/src/components/Icons.tsx:95` — no new icon needed.)

- [ ] **Step 5: Manually verify in the browser**

```bash
pnpm --filter @aivastra/admin dev
```

On the Workflows page, find a template with `poseCount > 0`. Confirm the new Reassign button is
enabled and Delete is disabled with the "in use by poses" tooltip. Click Reassign, pick a
different target template, save, and confirm: the toast names the cleared-override count (if any
poses had prompt text), the source template's pose count drops to 0, and Delete becomes enabled
for it. Then confirm a template with `poseCount === 0` shows Reassign disabled.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/pages/WorkflowsPage.tsx
git commit -m "feat(admin): wire the Reassign workflow button into the UI

The reassign modal, form state and handler were already fully built but
unreachable -- no button ever set modal=reassign-workflow. The DELETE
route's own conflict message ('Reassign those poses first') pointed at
a dead end. Adds the trigger next to Delete on both desktop and mobile."
```

---

### Task 5: Fix EditPoseAssetModal's silent prompt-clobber and add an override toggle

**Files:**
- Modify: `apps/admin-web/src/components/EditPoseAssetModal.tsx`

**Interfaces:**
- Consumes: `Switch` from `./Switch` (existing component, `{ checked, onChange, disabled }`
  props — see `apps/admin-web/src/components/Switch.tsx:7`).
- Produces: no new exports — leaf component. Behavior change only: `promptGarmentPhase` is sent
  as `null` whenever the toggle is off, instead of unconditionally sending whatever text is in
  the textarea (which today includes the workflow's own default the very first time the modal
  opens, silently minting an override the admin never asked for).

- [ ] **Step 1: Add the override-toggle state**

In `apps/admin-web/src/components/EditPoseAssetModal.tsx`, add the `Switch` import next to the
existing component imports:

```tsx
import { Switch } from './Switch';
```

Replace the existing prompt state declaration:

```tsx
  const [prompt, setPrompt] = useState(
    asset.promptGarmentPhase ??
      workflows.find((w) => w.id === asset.workflowTemplateId)?.defaultGarmentPhasePrompt ??
      '',
  );
```

with:

```tsx
  // A pinned override already exists iff promptGarmentPhase is non-null on the asset
  // itself — mirrors GarmentTypesTab.tsx's PoseConfigsPanel edit-override modal.
  const [promptOverrideEnabled, setPromptOverrideEnabled] = useState(
    !!asset.promptGarmentPhase,
  );
  const [prompt, setPrompt] = useState(
    asset.promptGarmentPhase ??
      workflows.find((w) => w.id === asset.workflowTemplateId)?.defaultGarmentPhasePrompt ??
      '',
  );
```

- [ ] **Step 2: Stop clobbering the admin's own text on workflow reselect**

Replace the `SearchableSelect`'s `onChange` for the workflow template field:

```tsx
            onChange={(newId) => {
              setWorkflowTemplateId(newId);
              // Always follow the newly selected workflow's default prompt — admin can
              // still hand-edit the textarea below before saving if they want an override.
              setPrompt(workflows.find((w) => w.id === newId)?.defaultGarmentPhasePrompt ?? '');
            }}
```

with:

```tsx
            onChange={(newId) => {
              setWorkflowTemplateId(newId);
              // Only follow the newly selected workflow's default prompt while the
              // override toggle is off (the textarea is just a live preview then).
              // When the toggle is on, leave the admin's own pinned text alone --
              // switching workflows shouldn't silently discard it.
              if (!promptOverrideEnabled) {
                setPrompt(workflows.find((w) => w.id === newId)?.defaultGarmentPhasePrompt ?? '');
              }
            }}
```

- [ ] **Step 3: Add the Custom prompt Switch and gate the textarea**

Replace the existing prompt field:

```tsx
        <div className="field">
          <label>Positive prompt</label>
          <textarea
            className="input"
            value={prompt}
            disabled={saving}
            rows={4}
            onChange={(e) => setPrompt(e.target.value)}
            style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
          />
        </div>
```

with:

```tsx
        <div className="field">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ margin: 0 }}>Positive prompt</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Custom prompt</span>
              <Switch
                checked={promptOverrideEnabled}
                disabled={saving}
                onChange={(checked) => {
                  setPromptOverrideEnabled(checked);
                  if (!checked) {
                    // Snap the preview back to the assigned workflow's live default --
                    // the admin may have edited the textarea before turning this off.
                    setPrompt(
                      workflows.find((w) => w.id === workflowTemplateId)?.defaultGarmentPhasePrompt ??
                        '',
                    );
                  }
                }}
              />
            </div>
          </div>
          <textarea
            className="input"
            value={prompt}
            disabled={!promptOverrideEnabled || saving}
            rows={4}
            placeholder="Inherited from workflow"
            onChange={(e) => setPrompt(e.target.value)}
            style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
          />
          <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>
            {promptOverrideEnabled
              ? 'Pinned — future edits to the workflow prompt will not affect this pose.'
              : 'Read-only preview of the assigned workflow’s live default prompt.'}
          </span>
        </div>
```

- [ ] **Step 4: Gate the save payload on the toggle**

Replace the `patch` construction in `handleSave`:

```tsx
      const patch: Record<string, unknown> = {
        displayName: displayName.trim() || null,
        genderSlug,
        workflowTemplateId: workflowTemplateId || null,
        promptGarmentPhase: prompt.trim() || null,
        sortOrder,
        publicApiSlug,
      };
```

with:

```tsx
      const patch: Record<string, unknown> = {
        displayName: displayName.trim() || null,
        genderSlug,
        workflowTemplateId: workflowTemplateId || null,
        // Toggle off means "inherit" — send null regardless of what's in the
        // (read-only preview) textarea so this pose keeps following the assigned
        // workflow's live prompt instead of freezing today's snapshot of it.
        promptGarmentPhase: promptOverrideEnabled ? prompt.trim() || null : null,
        sortOrder,
        publicApiSlug,
      };
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/admin-web && npx tsc -b
```

Expected: no new errors.

- [ ] **Step 6: Manually verify in the browser**

```bash
pnpm --filter @aivastra/admin dev
```

Open a pose asset with no existing `promptGarmentPhase` override: confirm the Custom prompt
switch starts off, the textarea shows the workflow's default as a disabled preview, and saving
does not create an override (re-open the modal — switch should still be off). Turn the switch on,
edit the text, save, re-open — switch should be on and show the saved text. With the switch on,
change the Workflow template dropdown — confirm the custom text is NOT replaced. With the switch
off, change the Workflow template dropdown — confirm the preview text DOES update to the new
workflow's default.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/components/EditPoseAssetModal.tsx
git commit -m "fix(admin): stop EditPoseAssetModal from silently pinning prompt overrides

The textarea was pre-filled with the workflow's default text with no
visual distinction from an intentional override, so every save without
an explicit edit still wrote that text as a frozen override -- and
reselecting the workflow dropdown silently discarded any custom text
already typed. Adds the same Custom-prompt toggle GarmentTypesTab's
PoseConfigsPanel already uses for this exact problem."
```
