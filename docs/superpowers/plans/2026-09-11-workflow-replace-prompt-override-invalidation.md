# Workflow Replace Prompt Override Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `POST /admin/workflows/:id/replace` swaps a workflow template's graph content in place, automatically clear the now-stale admin-authored prompt override text on `model_pose_assets` and `pose_garment_configs` rows that point at (directly or by inheritance) the template being replaced, while never touching their `workflowTemplateId` columns.

**Architecture:** Three targeted `UPDATE ... SET promptGarmentPhase = NULL, promptFacePhase = NULL` statements run inside the existing replace transaction in `apps/api/src/modules/admin/workflows.routes.ts`, keyed off the template id being replaced. Row counts flow into the audit log and the API response; the admin-web replace modal surfaces the counts in its success toast.

**Tech Stack:** Fastify 5 route handler, Drizzle ORM (Postgres), Vitest integration tests against the docker-compose Postgres instance, React/TypeScript admin SPA.

## Global Constraints

- Never modify `workflowTemplateId` on `model_pose_assets` or `pose_garment_configs` anywhere in this change — a replace keeps the template row's id stable, so these FKs are already correct and must be left exactly as they are.
- No database schema migration — this is pure application-logic change (spec §7).
- Out of scope: `catalogue_template_pose_workflows.promptGarmentPhase`, `garment_subcategories`' workflow-pointer columns, any pre-replace preview UI, and rollback/restore of a cleared prompt override (spec §2).
- Integration tests require `pnpm docker:up` running first (Postgres/Redis/MinIO on localhost) — no testcontainers in this repo.
- `pnpm --filter @aivastra/api test` runs unit tests only; integration tests run via `npx vitest run --config vitest.integration.config.ts <pattern>` from `apps/api`.
- Commit only once each task's tests pass — no partial/broken commits.

---

### Task 1: Clear stale prompt overrides inside the replace transaction

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts:10` (import), `:1296-1322` (replace transaction body), `:1336-1342` (response)
- Test: `apps/api/test/integration/admin-workflows.test.ts` (append to the existing `describe('workflow replace with drain', ...)` block, currently ending at line 1131)

**Interfaces:**
- Consumes: existing `POST /admin/workflows/:id/replace` request/response shape (`ReplaceWorkflowBody` from `@aivastra/types`, `schema.workflowTemplates`, `schema.modelPoseAssets`, `schema.poseGarmentConfigs` from `@aivastra/db`), the existing `hasInFlightJobsForTemplateVersion` helper (unchanged).
- Produces: response body gains two new top-level number fields, `clearedPosePromptCount` and `clearedGarmentConfigPromptCount`, alongside the existing `poseCount`/`funnelCount`/`draining`/`ksamplerNodes`. These are consumed by Task 2's admin-web changes.

- [ ] **Step 1: Write the failing integration tests**

Open `apps/api/test/integration/admin-workflows.test.ts`. Find the end of the `'workflow replace with drain'` describe block — the last test currently ends with:

```ts
      expect(replaceAgainRes.statusCode).toBe(409);
      expect(replaceAgainRes.json().error.message).toContain('draining');
    });
  });
```

Replace that snippet with the same content plus four new tests and two small helpers inserted before the closing `});` of the describe block:

```ts
      expect(replaceAgainRes.statusCode).toBe(409);
      expect(replaceAgainRes.json().error.message).toContain('draining');
    });

    async function seedWorkflowTemplate(labelSuffix: string) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `replace_prompt_${labelSuffix}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          label: `Replace Prompt ${labelSuffix}`,
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

    async function replaceWorkflow(id: string) {
      const res = await app.inject({
        method: 'POST',
        url: `/admin/workflows/${id}/replace`,
        headers,
        payload: {
          slug: `replace_prompt_replaced_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          label: 'Replaced',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          password: 'password123',
        },
      });
      expect(res.statusCode).toBe(200);
      return res.json();
    }

    it('clears a pose default prompt override when its workflow is replaced, leaving workflowTemplateId intact', async () => {
      const templateId = await seedWorkflowTemplate('pose-default');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose with default override',
          genderSlug: 'women',
          r2Key: `replace-prompt-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-pose-thumb.jpg',
          scope: 'general',
          workflowTemplateId: templateId,
          promptGarmentPhase: 'old garment phase text',
          promptFacePhase: 'old face phase text',
        })
        .returning();

      const replaced = await replaceWorkflow(templateId);
      expect(replaced.clearedPosePromptCount).toBe(1);
      expect(replaced.clearedGarmentConfigPromptCount).toBe(0);

      const [updatedPose] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, pose.id));
      expect(updatedPose.promptGarmentPhase).toBeNull();
      expect(updatedPose.promptFacePhase).toBeNull();
      expect(updatedPose.workflowTemplateId).toBe(templateId);
    });

    it('clears an explicit per-garment-type prompt override when its referenced workflow is replaced', async () => {
      const templateId = await seedWorkflowTemplate('config-direct');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose for direct config override',
          genderSlug: 'women',
          r2Key: `replace-prompt-direct-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-direct-pose-thumb.jpg',
          scope: 'general',
        })
        .returning();
      const [garmentType] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `replace-prompt-direct-gt-${Date.now()}-${Math.random()}`,
          label: 'Replace Prompt Direct GT',
          isActive: true,
        })
        .returning();
      const [config] = await app.db
        .insert(schema.poseGarmentConfigs)
        .values({
          poseAssetId: pose.id,
          subcategoryId: garmentType.id,
          workflowTemplateId: templateId,
          promptGarmentPhase: 'old config garment phase text',
          promptFacePhase: 'old config face phase text',
        })
        .returning();

      const replaced = await replaceWorkflow(templateId);
      expect(replaced.clearedPosePromptCount).toBe(0);
      expect(replaced.clearedGarmentConfigPromptCount).toBe(1);

      const [updatedConfig] = await app.db
        .select()
        .from(schema.poseGarmentConfigs)
        .where(eq(schema.poseGarmentConfigs.id, config.id));
      expect(updatedConfig.promptGarmentPhase).toBeNull();
      expect(updatedConfig.promptFacePhase).toBeNull();
      expect(updatedConfig.workflowTemplateId).toBe(templateId);
    });

    it('clears an inherited per-garment-type prompt override when the pose default it relies on is replaced', async () => {
      const templateId = await seedWorkflowTemplate('config-inherited');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose with inherited default',
          genderSlug: 'women',
          r2Key: `replace-prompt-inherited-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-inherited-pose-thumb.jpg',
          scope: 'general',
          workflowTemplateId: templateId,
        })
        .returning();
      const [garmentType] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `replace-prompt-inherited-gt-${Date.now()}-${Math.random()}`,
          label: 'Replace Prompt Inherited GT',
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

      const replaced = await replaceWorkflow(templateId);
      expect(replaced.clearedPosePromptCount).toBe(1);
      expect(replaced.clearedGarmentConfigPromptCount).toBe(1);

      const [updatedConfig] = await app.db
        .select()
        .from(schema.poseGarmentConfigs)
        .where(eq(schema.poseGarmentConfigs.id, config.id));
      expect(updatedConfig.promptGarmentPhase).toBeNull();
      expect(updatedConfig.promptFacePhase).toBeNull();
      expect(updatedConfig.workflowTemplateId).toBeNull();
    });

    it('leaves prompt overrides referencing a different, non-replaced template untouched', async () => {
      const targetTemplateId = await seedWorkflowTemplate('target');
      const otherTemplateId = await seedWorkflowTemplate('other');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose pointing at other template',
          genderSlug: 'women',
          r2Key: `replace-prompt-other-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-other-pose-thumb.jpg',
          scope: 'general',
          workflowTemplateId: otherTemplateId,
          promptGarmentPhase: 'untouched garment phase text',
          promptFacePhase: 'untouched face phase text',
        })
        .returning();
      const [garmentType] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `replace-prompt-other-gt-${Date.now()}-${Math.random()}`,
          label: 'Replace Prompt Other GT',
          isActive: true,
        })
        .returning();
      const [config] = await app.db
        .insert(schema.poseGarmentConfigs)
        .values({
          poseAssetId: pose.id,
          subcategoryId: garmentType.id,
          workflowTemplateId: otherTemplateId,
          promptGarmentPhase: 'untouched config garment phase text',
          promptFacePhase: 'untouched config face phase text',
        })
        .returning();

      const replaced = await replaceWorkflow(targetTemplateId);
      expect(replaced.clearedPosePromptCount).toBe(0);
      expect(replaced.clearedGarmentConfigPromptCount).toBe(0);

      const [updatedPose] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, pose.id));
      expect(updatedPose.promptGarmentPhase).toBe('untouched garment phase text');
      expect(updatedPose.promptFacePhase).toBe('untouched face phase text');

      const [updatedConfig] = await app.db
        .select()
        .from(schema.poseGarmentConfigs)
        .where(eq(schema.poseGarmentConfigs.id, config.id));
      expect(updatedConfig.promptGarmentPhase).toBe('untouched config garment phase text');
      expect(updatedConfig.promptFacePhase).toBe('untouched config face phase text');
    });
  });
```

- [ ] **Step 2: Confirm docker infra is up, then run the new tests to verify they fail**

Run:
```bash
pnpm docker:up
cd apps/api && npx vitest run --config vitest.integration.config.ts test/integration/admin-workflows.test.ts -t "prompt override"
```
Expected: 4 failing tests (`clears a pose default prompt override...`, `clears an explicit per-garment-type...`, `clears an inherited per-garment-type...`, `leaves prompt overrides referencing a different...`) — each failing because `replaced.clearedPosePromptCount` / `replaced.clearedGarmentConfigPromptCount` are `undefined`, or the DB assertions find the old prompt text still present. The 4th test may pass trivially (nothing was supposed to change) — that's fine, it becomes a true regression guard once Step 3 lands; if it already passes, that's expected and not a problem.

- [ ] **Step 3: Implement the clearing logic**

In `apps/api/src/modules/admin/workflows.routes.ts`, update the drizzle-orm import (line 10):

```ts
import { and, count, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
```

Then, inside the `POST /admin/workflows/:id/replace` handler's transaction, insert new logic right after the `updated` row is written and before `recordAudit` is called. Find:

```ts
        const [updated] = await tx
          .update(schema.workflowTemplates)
          .set({
            ...values,
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.workflowTemplates.id, id))
          .returning();

        await recordAudit(tx, {
```

Replace it with:

```ts
        const [updated] = await tx
          .update(schema.workflowTemplates)
          .set({
            ...values,
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.workflowTemplates.id, id))
          .returning();

        // Prompt override text on both tables below was written against the
        // OLD graph's shape (node roles, phrasing, even workflowType can
        // differ after a replace) and is never structurally guaranteed to be
        // valid against the new graph. workflowTemplateId columns on these
        // tables are FKs by row id, which a replace never changes — they
        // stay correct and are deliberately left untouched here. See
        // docs/superpowers/specs/
        // 2026-09-11-workflow-replace-prompt-override-invalidation-design.md.
        const clearedPoseAssets = await tx
          .update(schema.modelPoseAssets)
          .set({ promptGarmentPhase: null, promptFacePhase: null })
          .where(eq(schema.modelPoseAssets.workflowTemplateId, id))
          .returning({ id: schema.modelPoseAssets.id });

        const clearedGarmentConfigsDirect = await tx
          .update(schema.poseGarmentConfigs)
          .set({ promptGarmentPhase: null, promptFacePhase: null })
          .where(eq(schema.poseGarmentConfigs.workflowTemplateId, id))
          .returning({ id: schema.poseGarmentConfigs.id });

        // Rows with no workflow override of their own inherit whichever pose
        // just had its default cleared above — their prompt text is just as
        // stale even though their own workflowTemplateId column is (and
        // stays) null.
        const inheritingPoseIds = clearedPoseAssets.map((p) => p.id);
        const clearedGarmentConfigsInherited =
          inheritingPoseIds.length > 0
            ? await tx
                .update(schema.poseGarmentConfigs)
                .set({ promptGarmentPhase: null, promptFacePhase: null })
                .where(
                  and(
                    isNull(schema.poseGarmentConfigs.workflowTemplateId),
                    inArray(schema.poseGarmentConfigs.poseAssetId, inheritingPoseIds),
                  ),
                )
                .returning({ id: schema.poseGarmentConfigs.id })
            : [];

        const clearedPosePromptCount = clearedPoseAssets.length;
        const clearedGarmentConfigPromptCount =
          clearedGarmentConfigsDirect.length + clearedGarmentConfigsInherited.length;

        await recordAudit(tx, {
```

Then find the `recordAudit` call's `after` object:

```ts
          after: {
            version: updated.version,
            slug: updated.slug,
            label: updated.label,
            archived: needsDrain,
          },
```

Replace it with:

```ts
          after: {
            version: updated.version,
            slug: updated.slug,
            label: updated.label,
            archived: needsDrain,
            clearedPosePromptCount,
            clearedGarmentConfigPromptCount,
          },
```

Then find the transaction's return statement:

```ts
        return { updated, fromVersion: existing.version, archived: needsDrain };
      });
```

Replace it with:

```ts
        return {
          updated,
          fromVersion: existing.version,
          archived: needsDrain,
          clearedPosePromptCount,
          clearedGarmentConfigPromptCount,
        };
      });
```

Finally, find the handler's final response object:

```ts
      return {
        ...result.updated,
        poseCount: Number(poseCountRow?.cnt ?? 0),
        funnelCount: Number(funnelCountRow?.cnt ?? 0),
        draining: result.archived ? { fromVersion: result.fromVersion } : null,
        ksamplerNodes: extractKSamplerNodes(result.updated.jsonContent as Record<string, unknown>),
      };
    },
  );
```

Replace it with:

```ts
      return {
        ...result.updated,
        poseCount: Number(poseCountRow?.cnt ?? 0),
        funnelCount: Number(funnelCountRow?.cnt ?? 0),
        draining: result.archived ? { fromVersion: result.fromVersion } : null,
        ksamplerNodes: extractKSamplerNodes(result.updated.jsonContent as Record<string, unknown>),
        clearedPosePromptCount: result.clearedPosePromptCount,
        clearedGarmentConfigPromptCount: result.clearedGarmentConfigPromptCount,
      };
    },
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts test/integration/admin-workflows.test.ts
```
Expected: PASS — every test in the file, including the 4 new ones and all pre-existing replace/drain tests (the pre-existing tests must still pass unchanged, since nothing about their assertions touches the new fields).

- [ ] **Step 5: Typecheck the API package**

Run:
```bash
pnpm --filter @aivastra/api typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/workflows.routes.ts apps/api/test/integration/admin-workflows.test.ts
git commit -m "fix(api): clear stale prompt overrides on workflow replace

model_pose_assets and pose_garment_configs prompt override text is tuned to
a specific graph's shape; replacing a workflow's content in place left that
text stale and silently reused against the new graph. Clear it on replace
while leaving workflowTemplateId untouched, since the template's row id
never changes."
```

---

### Task 2: Surface cleared-override counts in the admin-web replace flow

**Files:**
- Modify: `apps/admin-web/src/types.ts:127` (`WorkflowOption` interface)
- Modify: `apps/admin-web/src/components/ReplaceWorkflowModal.tsx:355-361` (`handleSubmit` success path)

**Interfaces:**
- Consumes: Task 1's response fields `clearedPosePromptCount?: number` and `clearedGarmentConfigPromptCount?: number` on the `/admin/workflows/:id/replace` JSON response.
- Produces: no new exports — this is leaf UI behavior consumed only by the admin viewing the replace modal.

- [ ] **Step 1: Add the new fields to `WorkflowOption`**

In `apps/admin-web/src/types.ts`, find:

```ts
  version?: number;
  funnelCount?: number;
  draining?: { fromVersion: number } | null;
  createdAt: string;
```

Replace it with:

```ts
  version?: number;
  funnelCount?: number;
  clearedPosePromptCount?: number;
  clearedGarmentConfigPromptCount?: number;
  draining?: { fromVersion: number } | null;
  createdAt: string;
```

- [ ] **Step 2: Extend the replace success toast**

In `apps/admin-web/src/components/ReplaceWorkflowModal.tsx`, find the success path inside `handleSubmit`:

```ts
      const replaced = await apiFetch<WorkflowOption>(`/admin/workflows/${workflow.id}/replace`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast({ title: `Workflow replaced (now v${replaced.version ?? 2})` });
      onReplaced(replaced);
      onClose();
```

Replace it with:

```ts
      const replaced = await apiFetch<WorkflowOption>(`/admin/workflows/${workflow.id}/replace`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const clearedCount =
        (replaced.clearedPosePromptCount ?? 0) + (replaced.clearedGarmentConfigPromptCount ?? 0);
      toast({
        title: `Workflow replaced (now v${replaced.version ?? 2})`,
        body:
          clearedCount > 0
            ? `Cleared ${clearedCount} stale prompt override${clearedCount === 1 ? '' : 's'} that were tuned to the old graph.`
            : undefined,
      });
      onReplaced(replaced);
      onClose();
```

- [ ] **Step 3: Typecheck the admin-web package**

Run:
```bash
pnpm --filter @aivastra/admin typecheck
```
Expected: no errors.

- [ ] **Step 4: Manually verify in the browser**

```bash
pnpm docker:up
pnpm --filter @aivastra/api dev &
pnpm --filter @aivastra/admin dev
```
In the admin app, open **Workflows**, pick any template that has at least one pose asset or per-garment-type config with a custom prompt override pointing at it (or seed one via Task 1's test helpers against your local dev DB), click **Replace**, upload a JSON file, fill in required node mappings, enter the admin password, and confirm. Verify the success toast shows the "Cleared N stale prompt override(s)..." line when the count is nonzero, and shows just "Workflow replaced (now vN)" with no second line when it's zero (e.g. replacing a freshly-created template with nothing pointing at it yet).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/types.ts apps/admin-web/src/components/ReplaceWorkflowModal.tsx
git commit -m "feat(admin-web): surface cleared prompt-override counts after a workflow replace"
```
