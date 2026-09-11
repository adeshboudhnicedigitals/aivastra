# Workflow Replace: Invalidate Stale Prompt Overrides

**Status:** Approved design, not yet implemented.
**Date:** 2026-09-11

## 1. Problem Statement

`POST /admin/workflows/:id/replace` (`apps/api/src/modules/admin/workflows.routes.ts:1191`,
implemented per `docs/superpowers/specs/2026-08-26-workflow-template-replace-design.md`)
swaps a `workflow_templates` row's ComfyUI graph content in place: the row's `id`
never changes, `version` is incremented by 1, and the outgoing content is
archived to `workflow_template_archives` if any in-flight job still needs it.
Because the row id is stable, every foreign key that points at it — including
the two tables below — remains valid by construction. That part of the system
works correctly today and needs no change.

The complication is data, not foreign keys. Two tables carry admin-authored
**prompt override text** tuned to one specific graph's structure, alongside the
`workflowTemplateId` they're tuned for:

- `model_pose_assets.promptGarmentPhase` / `.promptFacePhase` — the pose's own
  default prompt override, paired with `model_pose_assets.workflowTemplateId`
  (`packages/db/src/schema/models.ts:368-372`).
- `pose_garment_configs.promptGarmentPhase` / `.promptFacePhase` — a
  per-(pose, garment-type) override on top of the pose default, paired with
  `pose_garment_configs.workflowTemplateId`, which may itself be `NULL` to mean
  "inherit the pose's default workflow" (`packages/db/src/schema/models.ts:387-417`,
  precedence confirmed in `apps/dispatcher/src/job/processor.ts:365-424`).

These prompt strings were written by an admin against the *old* graph's node
layout, phrasing, and available roles. A replace can swap in a structurally
different graph (different `workflowType`, different node roles, different
number of stages) — verified explicitly supported by the replace flow, which
lets the admin pick a wholly new `workflowType` on replace
(`ReplaceWorkflowModal.tsx`'s `workflowType` selector). Today, replace does not
touch either override table, so the old prompt text survives untouched and
keeps being applied — silently — to every future job dispatched against the
new graph. This is a correctness gap that predates the replace feature: the
override tables were designed before "replace a template's content without
changing its id" existed as an operation, so nothing was ever taught to react
to it.

**Decision:** on a confirmed replace, clear (`NULL`) the prompt-override text
on any row whose *effective* workflow is the template being replaced, while
leaving `workflowTemplateId` on every such row completely untouched — the FK
is still correct and must keep pointing at the same row.

## 2. Scope

In scope: `model_pose_assets` and `pose_garment_configs` prompt override
fields only.

Explicitly out of scope (decided during design):
- `catalogue_template_pose_workflows.promptGarmentPhase` — structurally
  similar (a prompt override paired with a `workflowTemplateId`), but scoped
  per catalogue-template-mapping rather than per garment type, and its
  `workflowTemplateId` is `NOT NULL` (no "inherit" semantics to reason about).
  Left alone for this change.
- `garment_subcategories`' own workflow-pointer columns
  (`mannequinWorkflowTemplateId`, `sareeStep2WorkflowTemplateId`,
  `mannequinTwoInputWorkflowTemplateId`, `twoInputTryonWorkflowTemplateId`) —
  these are pure FK pointers with no paired prompt-override text of their own,
  so there is nothing to invalidate.
- A pre-replace preview/estimate of how many prompt overrides a replace would
  clear. The existing impact banner already shows pose/funnel counts before
  confirming; adding a matching prompt-override preview is a reasonable
  future enhancement but is not required to fix the underlying bug, and is
  left out to keep this change tightly scoped.
- Any UI to inspect or restore a cleared prompt override after the fact —
  matches the existing "no rollback" non-goal in the base replace design.

## 3. Affected-Row Logic

Given the template id `:id` being replaced, three disjoint sets of rows have
their prompt-override fields cleared. `workflowTemplateId` is never modified
in any of the three.

1. **Pose defaults directly on the replaced template**
   `model_pose_assets` WHERE `workflowTemplateId = :id`
   → SET `promptGarmentPhase = NULL, promptFacePhase = NULL`.

2. **Garment-type overrides explicitly pointing at the replaced template**
   `pose_garment_configs` WHERE `workflowTemplateId = :id`
   → SET `promptGarmentPhase = NULL, promptFacePhase = NULL`.

3. **Garment-type overrides that inherit a pose default being replaced**
   `pose_garment_configs` WHERE `workflowTemplateId IS NULL` AND
   `poseAssetId IN (SELECT id FROM model_pose_assets WHERE workflowTemplateId = :id)`
   → SET `promptGarmentPhase = NULL, promptFacePhase = NULL`.

   This case exists because a `pose_garment_configs` row can carry its own
   prompt override text while relying on the pose's default workflow (no
   workflow override of its own) — confirmed by the explicit "prompt-only
   override" comment and handling in
   `apps/api/src/modules/catalog-options/build.ts:229-239`. If that inherited
   default template is the one being replaced, this row's effective graph
   changed too, even though the row's own `workflowTemplateId` column is
   `NULL` and untouched.

Row set (3) must be computed using the **pre-update** state of
`model_pose_assets.workflowTemplateId` (i.e. run before or independently of
set (1)'s clear — clearing prompts in (1) does not touch `workflowTemplateId`,
so ordering between (1)/(2)/(3) does not actually matter for correctness, but
the subquery in (3) must filter on `workflowTemplateId = :id`, not on any
"was just cleared" condition).

`isActive` and every other column on both tables are left untouched.

## 4. Implementation

All three updates run inside the existing replace transaction in
`apps/api/src/modules/admin/workflows.routes.ts`'s
`POST /admin/workflows/:id/replace` handler, after the `workflow_templates`
UPDATE (~line 1296-1304) and before `recordAudit` (~line 1306):

```ts
const [clearedPoseAssets, clearedGarmentConfigsDirect, clearedGarmentConfigsInherited] =
  await Promise.all([
    tx
      .update(schema.modelPoseAssets)
      .set({ promptGarmentPhase: null, promptFacePhase: null })
      .where(eq(schema.modelPoseAssets.workflowTemplateId, id))
      .returning({ id: schema.modelPoseAssets.id }),
    tx
      .update(schema.poseGarmentConfigs)
      .set({ promptGarmentPhase: null, promptFacePhase: null })
      .where(eq(schema.poseGarmentConfigs.workflowTemplateId, id))
      .returning({ id: schema.poseGarmentConfigs.id }),
    tx
      .update(schema.poseGarmentConfigs)
      .set({ promptGarmentPhase: null, promptFacePhase: null })
      .where(
        and(
          isNull(schema.poseGarmentConfigs.workflowTemplateId),
          inArray(
            schema.poseGarmentConfigs.poseAssetId,
            tx
              .select({ id: schema.modelPoseAssets.id })
              .from(schema.modelPoseAssets)
              .where(eq(schema.modelPoseAssets.workflowTemplateId, id)),
          ),
        ),
      )
      .returning({ id: schema.poseGarmentConfigs.id }),
  ]);

const clearedPosePromptCount = clearedPoseAssets.length;
const clearedGarmentConfigPromptCount =
  clearedGarmentConfigsDirect.length + clearedGarmentConfigsInherited.length;
```

(Exact Drizzle subquery syntax to be confirmed against this codebase's
established `inArray(..., tx.select(...))` usage during implementation — the
logic above is the contract, not a syntax guarantee.)

The two count variables are threaded into:

- **`recordAudit`'s `after` payload** (currently
  `{ version, slug, label, archived }`) — extended to
  `{ ..., clearedPosePromptCount, clearedGarmentConfigPromptCount }`, so the
  audit trail records what a replace actually invalidated, not just the
  version bump.
- **The route's response**, alongside the existing `poseCount`/`funnelCount`
  computed after the transaction (~line 1325-1342):
  `{ ...result.updated, poseCount, funnelCount, clearedPosePromptCount, clearedGarmentConfigPromptCount, draining, ksamplerNodes }`.

## 5. UI

`apps/admin-web/src/types.ts`'s `WorkflowOption` gains two optional fields,
`clearedPosePromptCount?: number` and `clearedGarmentConfigPromptCount?: number`,
matching how `poseCount`/`funnelCount` are already typed.

`ReplaceWorkflowModal.tsx`'s success handler (`handleSubmit`, ~line 355-361)
extends the toast to mention the clear when either count is nonzero, e.g.:

> Workflow replaced (now v3). Cleared 2 stale prompt override(s) that were
> tuned to the old graph.

When both counts are zero, the toast is unchanged from today
(`Workflow replaced (now v${version})`).

No change to the pre-replace impact banner (per the non-goal in §2) — the
counts are only known/shown after the replace completes.

## 6. Testing

Extend `apps/api/test/integration/admin-workflows.test.ts`'s existing
`'workflow replace with drain'` describe block:

1. **Pose-default clear**: seed a `model_pose_assets` row with
   `workflowTemplateId = template.id` and both prompt fields set. Replace the
   template. Assert both prompt fields are now `null` and `workflowTemplateId`
   is unchanged.
2. **Explicit garment-config clear**: seed a `pose_garment_configs` row with
   `workflowTemplateId = template.id` and both prompt fields set. Replace.
   Assert prompt fields `null`, `workflowTemplateId` unchanged.
3. **Inherited garment-config clear**: seed a `model_pose_assets` row pointing
   at the template (no prompt override needed on it for this case) and a
   `pose_garment_configs` row for that pose with `workflowTemplateId = NULL`
   and both prompt fields set. Replace the template. Assert the config row's
   prompt fields are now `null`, `workflowTemplateId` still `NULL`.
4. **Negative case**: a `pose_garment_configs` row (and a `model_pose_assets`
   row) pointing at a *different*, non-replaced template keeps its prompt
   fields untouched after the replace.
5. **Response shape**: assert `clearedPosePromptCount` and
   `clearedGarmentConfigPromptCount` in the replace response match the number
   of rows seeded/cleared in a combined scenario exercising cases 1-3 at once.

No dispatcher-side test changes needed — the dispatcher's resolution logic
(`processor.ts:365-424`) already treats a `null` prompt field as "fall back to
the next layer," so clearing to `null` is exercised correctly by existing
dispatcher behavior; no new dispatcher test is required to prove that half of
the contract.

## 7. Non-Goals (restated from §2)

- No pre-replace preview of prompt overrides that would be cleared.
- No handling for `catalogue_template_pose_workflows`.
- No rollback/restore of a cleared prompt override.
- No schema migration — this is pure application-logic change; no new
  columns, no new tables.
