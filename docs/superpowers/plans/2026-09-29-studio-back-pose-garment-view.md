# Studio Back-Pose Garment View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `workflow_templates` row declare it was authored against a **back-facing** pose reference (as opposed to the default front-facing one), and let Studio's custom pose picker collect a second, back-view garment photo for upper and lower garments when the customer selects a pose backed by such a template — routing the correct photo to the correct job automatically. Ships with `two_piece_back_pose.json` as the first real back-view template.

**Architecture:** A single new column, `workflow_templates.garmentView: 'front' | 'back'` (default `'front'`), is the only new piece of state in the whole system. Everything else is threading that one value through code paths that already thread `lowerNodeId`/`shoeNodeId` the same way:
- **Admin** (`apps/admin-web` + `apps/api/src/modules/admin/workflows.routes.ts`) gets a Front/Back toggle on the workflow-upload form, only for `workflowType: 'regular'` templates.
- **`apps/api/src/modules/jobs/create.ts`** (`resolveTryonPlan`) resolves two new optional upload keys (`upperGarmentBackKey`, `lowerGarmentBackKey`) exactly like it already resolves `lowerGarmentKey`/`thirdGarmentKey`, and picks front-vs-back per look based on that look's resolved workflow's `garmentView` — no dispatcher or patcher change, since the dispatcher only ever sees whichever single key ends up on `job_inputs.upperGarmentKey`/`lowerGarmentKey`.
- **Studio** (`apps/catalogues-web/.../studio/page.tsx`) adds `needsUpperBack`/`needsLowerBack`, computed the same way `needsLower`/`needsShoes` already are (after pose selection, since garment upload happens *before* pose selection in the wizard) — and shows the back-photo upload as one more conditional late step in the same place lower/shoes already live.
- **Merchant/Shopify auto-generated jobs get no new code path at all.** They construct their own request bodies internally from a single synced product photo and never populate `upperGarmentBackKey`/`lowerGarmentBackKey` — so the same validation that blocks a customer from submitting a back pose without a back photo also blocks (with the same error) an admin ever misassigning a `garmentView: 'back'` template to a merchant funnel. One check, no separate capability flag.

**Tech Stack:** Fastify 5 + `fastify-type-provider-zod`, Drizzle ORM, PostgreSQL 16, Vitest, Next.js 15 + React (catalogues-web), Vite + React (admin-web).

## Global Constraints

- **Scope is upper + lower garments only, no shoes.** Shoes are always selected from the admin-curated catalog (`shoeCatalogId`), never user-uploaded, so a "back view" upload slot doesn't apply there — decided in design discussion, not something to reconsider mid-implementation.
- **Scope is the single-job Studio wizard's custom pose picker only.** Explicitly out of scope:
  - Batch/CSV mode (`apps/catalogues-web/src/app/(app)/studio/batch/*`, `packages/types/src/batch.ts`) — untouched.
  - Catalogue-template ("looks") mode in Studio — `TemplateLook` (`studio/page.tsx:109-120`) and the `/v1/models/catalogue-templates` route stay as-is. `garmentView` is still threaded through `create.ts`'s `mappingPoseWorkflows` branch (Task 6) for defense-in-depth — cheap, one more column on an existing select — but no admin has a way to add a back-view look to a template yet, and Studio never shows a back-upload prompt in template mode.
  - The saree-mannequin two-pass flow (`requiresMannequinStep`, `create.ts`'s `sareeStep2` branch) — a back-facing mannequin is a materially different problem (the mannequin base image itself would need to be back-facing) and is not addressed here. `sareeStep2`'s resolved `garmentView` is hardcoded to `null` (never `'back'`), so this flow's behavior is unchanged.
- **Never** run `pnpm db:generate`, drizzle-kit snapshot changes, or `psql`/`tsx` data fixes against production or `tryon_prod` (CLAUDE.md, "Production safety"). Generate the migration locally; apply with `pnpm db:migrate` against your local `DATABASE_URL`.
- API source is ESM: relative imports end in `.js`. No `console.log` in committed code (pino only).
- `apps/admin-web` dropdowns use `SearchableSelect`, never a raw `<select>` — the Front/Back toggle is two buttons (matching the existing `workflowType` pill-button pattern at `WorkflowUploadModal.tsx:589-623`), not a dropdown, so this doesn't apply here, but don't introduce a `<select>` by mistake.
- Comments explain the *why*, matching the surrounding file (this codebase's convention, not boilerplate).
- **Commits:** CLAUDE.md forbids committing unless the user asks. If asked, end the message with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Docker services must be up for API tests: `pnpm docker:up`.
- Run API tests from the repo root: `pnpm --filter @aivastra/api exec vitest run <file>`.
- `apps/catalogues-web` has no component-render test harness (no `@testing-library/react`/jsdom) for Studio — same situation the `2026-09-24-dashboard-customize-step.md` plan documented. Studio UI tasks are verified by `typecheck` + `lint` + `build` + manual reasoning + (if available) a local click-through, not a new automated test.

## Review Focus

Inputs the spec implies but a happy-path pass wouldn't exercise:

1. **A back pose's lower garment must not silently fall back to a catalog item.** Catalog items (`catalog_items`) have no back-view photo — a back-facing pose whose workflow has a `lowerNodeId` must require `lowerGarmentBackKey` specifically, never `lowerCatalogId`. Task 6.
2. **A batch of looks mixing a front pose and a back pose in one submission** must route each look's own photo correctly — never fall back to whichever key happens to be non-null. Task 6.
3. **A merchant/Shopify-routed job resolving to a `garmentView: 'back'` template** must fail with a clear 400, not silently ship a front photo into a back-facing graph. Task 6 (same check as #1/#2 — no separate code path).
4. **A pose selection that toggles between front and back poses** (`handlePoseSelect`) must clear stale back-photo state the same way it already clears `lowerCatalogId`/`shoeCatalogId` when no longer needed. Task 9.
5. **A lower-only back pose** (`hasUpper === false`, `hasLower === true`, `garmentView === 'back'`) must route the single garment upload into the *back* lower slot, not the front one — extends the existing `isLowerOnlyRole` trick. Task 9.

---

## File Structure

**DB (`packages/db`)**
- Modify `src/schema/models.ts` — `garmentView` column on `workflowTemplates`. New generated migration under `src/migrations/`.

**API (`apps/api`)**
- Modify `src/modules/admin/workflows.routes.ts` — `extractWorkflowInsertFields` (5 return branches), PATCH `updateValues`.
- Modify `src/modules/jobs/create.ts` — resolve + verify the two new keys, thread `garmentView`, validation, per-look key selection.
- Modify `src/modules/models/routes.ts` — expose `garmentView` on `GET /v1/models/poses`.
- Test: new `test/integration/jobs-back-garment-view.test.ts`; modify existing workflow-admin tests if any assert the full field set.

**Types (`packages/types`)**
- Modify `src/admin.ts` — `CreateWorkflowBody`, `UpdateWorkflowBody`.
- Modify `src/jobs.ts` — `CreateTryOnJobInputsBase`.

**Admin SPA (`apps/admin-web/src`)**
- Modify `components/WorkflowUploadModal.tsx` — state, payload, UI toggle.

**Studio SPA (`apps/catalogues-web/src/app/(app)/studio/page.tsx`)**
- Modify: `PoseItem` interface, garment-upload state block, upload handlers, `handlePoseSelect`, `needsLower`/`needsShoes`/`isLowerOnlyRole` block, `canGenerate`/`generateBlocker`/`extraSectionKeys`, the three submit-payload construction sites, and add two new conditionally-rendered upload sections.

---

### Task 1: `garmentView` column and migration

**Files:**
- Modify: `packages/db/src/schema/models.ts` (`workflowTemplates` table, `:189-276`)
- Create: generated migration under `packages/db/src/migrations/`

**Interfaces:**
- Produces: `schema.workflowTemplates.garmentView: 'front' | 'back'` (stored as `text`, app-validated — same convention as `workflowType`/`shotType`, not a DB enum). Every later task reads this column.

- [ ] **Step 1: Add the column**

In `packages/db/src/schema/models.ts`, in the `workflowTemplates` table, immediately after the `workflowType` line (`:255`):

```ts
  workflowType: text('workflow_type').notNull().default('regular'), // 'regular' | 'tryon'

  // 'front' (default) or 'back' — which side of the garment this graph's pose
  // reference depicts. Only meaningful for workflowType='regular' (pose-based
  // catalogue generation); every other type stays 'front' and is never read.
  // Drives which of the customer's two uploaded garment photos (front vs back)
  // create.ts feeds into this template's upper/lower LoadImage nodes — see
  // resolveTryonPlan in apps/api/src/modules/jobs/create.ts.
  garmentView: text('garment_view').notNull().default('front'), // 'front' | 'back'
```

- [ ] **Step 2: Generate the migration locally**

Run: `pnpm db:generate`
Expected: a new `packages/db/src/migrations/0207_*.sql` plus updated `meta/` snapshot and journal, containing only:

```sql
ALTER TABLE "workflow_templates" ADD COLUMN "garment_view" text DEFAULT 'front' NOT NULL;
```

If it contains anything else, stop and investigate — do not hand-edit snapshots. Do **not** run any migrate command against production.

- [ ] **Step 3: Apply it locally**

Run: `pnpm db:migrate` (confirm `DATABASE_URL` in your `.env` points at localhost before running).

---

### Task 2: Admin zod schemas — `CreateWorkflowBody` / `UpdateWorkflowBody`

**Files:**
- Modify: `packages/types/src/admin.ts` (`:405-461` `CreateWorkflowBody`, `:568-609+` `UpdateWorkflowBody`)

**Interfaces:**
- Produces: `CreateWorkflowBody.garmentView?: 'front' | 'back'`, `UpdateWorkflowBody.garmentView?: 'front' | 'back'`. Consumed by Task 3.

- [ ] **Step 1: `CreateWorkflowBody`**

In `packages/types/src/admin.ts`, immediately after the `workflowType` field (`:415-424`):

```ts
    workflowType: z
      .enum([
        'regular',
        'tryon',
        'saree_step1',
        'saree_step1_two_input',
        'two_stage',
        'regeneration',
      ])
      .default('regular'),
    // Only meaningful for workflowType='regular' — see garmentView on the
    // workflow_templates schema for what this drives.
    garmentView: z.enum(['front', 'back']).default('front'),
```

- [ ] **Step 2: `UpdateWorkflowBody`**

Immediately after the `isActive` field (`:576`):

```ts
  isActive: z.boolean().optional(),
  garmentView: z.enum(['front', 'back']).optional(),
```

---

### Task 3: Admin API route — insert and update

**Files:**
- Modify: `apps/api/src/modules/admin/workflows.routes.ts`

**Interfaces:**
- Consumes: `CreateWorkflowBody.garmentView`, `UpdateWorkflowBody.garmentView` (Task 2).
- Produces: a `workflow_templates` row with `garmentView` set correctly on create and update.

`extractWorkflowInsertFields` has five `return` branches, one per `workflowType`. Only the last one (plain `'regular'`, the implicit fallthrough at the bottom of the function) should read `body.garmentView` — the other four types don't use this concept and must always insert `'front'`.

- [ ] **Step 1: Hardcode `'front'` in the four non-regular branches**

Add `garmentView: 'front',` immediately after each of these four `shoeNodeId: null,` lines (each is inside its own `return { ... }` object — do not merge them):
- `:310` (the `saree_step1_two_input` branch)
- `:414` (the `two_stage` branch)
- `:488` (the `regeneration` branch)
- `:564` (the `tryon` / `saree_step1` branch)

Example for the first one, `:308-312` before → after:

```ts
      upperNodeIds: [],
      lowerNodeId: null,
      shoeNodeId: null,
      garmentView: 'front',
      thirdNodeId: null,
```

(same edit shape at the other three line numbers, each inside its own branch's return object)

- [ ] **Step 2: Read `body.garmentView` in the `regular` branch**

At `:649`, immediately after `shoeNodeId: body.shoeNodeId ?? null,`:

```ts
    lowerNodeId: body.lowerNodeId ?? null,
    shoeNodeId: body.shoeNodeId ?? null,
    garmentView: body.garmentView ?? 'front',
    thirdNodeId: body.thirdNodeId ?? null,
```

- [ ] **Step 3: PATCH `updateValues`**

In the update handler, immediately after `:1012` (`if (body.isActive !== undefined) updateValues.isActive = body.isActive;`):

```ts
  if (body.isActive !== undefined) updateValues.isActive = body.isActive;
  if (body.garmentView !== undefined) updateValues.garmentView = body.garmentView;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @aivastra/api typecheck`
Expected: passes. `extractWorkflowInsertFields`'s return type is inferred from the object literals — adding the same field to all 5 branches keeps every branch's shape identical, so no explicit return-type annotation needs updating.

---

### Task 4: Admin SPA — `WorkflowUploadModal.tsx`

**Files:**
- Modify: `apps/admin-web/src/components/WorkflowUploadModal.tsx`

**Interfaces:**
- Produces: a `garmentView` field on the POST `/admin/workflows` (or `/admin/workflow-change-requests` propose) payload for `workflowType: 'regular'` submissions.

- [ ] **Step 1: State**

Near the existing node-id state declarations (around `:153`, alongside `const [shoeNodeId, setShoeNodeId] = useState('');`), add:

```ts
  const [garmentView, setGarmentView] = useState<'front' | 'back'>('front');
```

- [ ] **Step 2: Include it in the `'regular'` payload**

In the `else` branch building the regular-workflow payload (`:441-467`), add `garmentView,` after `workflowType: 'regular',`:

```ts
        payload = {
          slug: slug.trim(),
          label: label.trim(),
          jsonContent,
          workflowType: 'regular',
          garmentView,
          faceNodeId: faceNodeId || undefined,
```

(Every other branch's payload — `two_stage`, `tryon`/`saree_step1`, etc. — is untouched; those workflow types never send `garmentView`, matching Task 3's hardcoded `'front'`.)

- [ ] **Step 3: Add the toggle to the form**

In the `'regular'`-only metadata section (`:1093-1126`, right after the Slug/Label grid closes at `:1124`, before the `<hr>` at `:1126`), add a new field row:

```tsx
            </div>

            <div className="field">
              <label>Garment view</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['front', 'back'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`btn sm ${garmentView === v ? 'primary' : 'ghost'}`}
                    disabled={saving}
                    onClick={() => setGarmentView(v)}
                  >
                    {v === 'front' ? 'Front' : 'Back'}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginTop: 4 }}>
                "Back" means this graph's pose reference shows the subject from behind — Studio
                will ask the customer for a back-view garment photo instead of the usual front one.
              </span>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
```

(matches the existing `workflowType` pill-button pattern at `:589-623` — `btn sm primary`/`btn sm ghost` classes already used throughout this file, no new CSS.)

- [ ] **Step 4: Typecheck, lint, build**

```bash
pnpm --filter @aivastra/admin typecheck
pnpm --filter @aivastra/admin lint
pnpm --filter @aivastra/admin build
```

(Confirm the actual package name in `apps/admin-web/package.json` before running — use whatever `--filter` value the other admin-web tasks in this repo use.)

---

### Task 5: Shared job types — `upperGarmentBackKey` / `lowerGarmentBackKey`

**Files:**
- Modify: `packages/types/src/jobs.ts` (`CreateTryOnJobInputsBase`, `:73-102`)

**Interfaces:**
- Produces: `CreateTryOnJobInputs.upperGarmentBackKey?: string`, `.lowerGarmentBackKey?: string`. `SareeStep2Inputs` inherits both via its existing `.omit({upperGarmentKey, mannequinJobId})` (it doesn't omit these two) — harmless, since Task 6 never threads `garmentView` through the saree-mannequin branch, so they're simply never read on that path.

- [ ] **Step 1: Add the two fields**

Immediately after `upperGarmentKey` (`:78`) and after `lowerGarmentKey` (`:99`) respectively:

```ts
  upperGarmentKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
  // Only meaningful when the resolved pose's workflow has garmentView='back' —
  // see resolveTryonPlan. A flat-lay photo of the garment's BACK, distinct
  // from upperGarmentKey's front photo.
  upperGarmentBackKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
  mannequinJobId: z.string().uuid().optional(),
```

```ts
  lowerGarmentKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
  // Same as upperGarmentBackKey, for the lower garment. Back-view poses never
  // accept lowerCatalogId for the lower role — see resolveTryonPlan.
  lowerGarmentBackKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
  thirdGarmentKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
```

---

### Task 6: `create.ts` — resolve, thread, validate, route

**Files:**
- Modify: `apps/api/src/modules/jobs/create.ts`
- Test: create `apps/api/test/integration/jobs-back-garment-view.test.ts`

**Interfaces:**
- Consumes: `body.inputs.upperGarmentBackKey`, `.lowerGarmentBackKey` (Task 5); `workflowTemplates.garmentView` via the `poseWorkflows` resolution (Task 1).
- Produces: `TryonPlanLook.upperGarmentKey`/`.lowerGarmentKey` already hold whichever photo (front or back) was correct for that look — **no change to `TryonPlanLook`'s shape**, no dispatcher/patcher change. The dispatcher and `job_inputs` schema are completely unaware this feature exists.

- [ ] **Step 1: Destructure and verify the two new keys in `resolveTryonPlan`**

At `:253-261`, add `upperGarmentBackKey` and `lowerGarmentBackKey` to the destructure:

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
  } = body.inputs;
  const upperGarmentBackKey = body.inputs.upperGarmentBackKey;
```

(kept `upperGarmentBackKey` as a separate line since `body.inputs` here is a union type across `CreateTryOnJobRequest['inputs']` and the saree-step2 wrapper shape — matches how `resolvedUpperGarmentKey` above it is already handled via `opts`, but this field genuinely exists on both shapes so a plain destructure works; adjust if TS disagrees once you run typecheck.)

At `:383-388`, alongside the existing `lowerGarmentKey`/`thirdGarmentKey` verification:

```ts
  if (lowerGarmentKey) {
    await verifyGarmentKey(app, userId, lowerGarmentKey, opts.trustedGarmentKeys);
  }
  if (lowerGarmentBackKey) {
    await verifyGarmentKey(app, userId, lowerGarmentBackKey, opts.trustedGarmentKeys);
  }
  if (upperGarmentBackKey) {
    await verifyGarmentKey(app, userId, upperGarmentBackKey, opts.trustedGarmentKeys);
  }
  if (thirdGarmentKey) {
    await verifyGarmentKey(app, userId, thirdGarmentKey, opts.trustedGarmentKeys);
  }
```

- [ ] **Step 2: Mirror the same destructure + verify in `createJob`**

At `:987-994`:

```ts
  const {
    faceId,
    garmentTypeId,
    upperGarmentKey,
    upperGarmentBackKey,
    mannequinJobId,
    lowerGarmentKey,
    lowerGarmentBackKey,
    thirdGarmentKey,
  } = body.inputs;
```

At `:1029-1032`:

```ts
  if (lowerGarmentKey)
    await verifyGarmentKey(app, userId, lowerGarmentKey, opts?.trustedGarmentKeys);
  if (lowerGarmentBackKey)
    await verifyGarmentKey(app, userId, lowerGarmentBackKey, opts?.trustedGarmentKeys);
  if (upperGarmentBackKey)
    await verifyGarmentKey(app, userId, upperGarmentBackKey, opts?.trustedGarmentKeys);
  if (thirdGarmentKey)
    await verifyGarmentKey(app, userId, thirdGarmentKey, opts?.trustedGarmentKeys);
```

(This duplicates the verification `resolveTryonPlan` also does — matches the existing, already-duplicated pattern for `lowerGarmentKey`/`thirdGarmentKey`; not something to "fix" here.)

- [ ] **Step 3: Thread `garmentView` through the `mappingPoseWorkflows` branch**

Add to the `.select({...})` at `:598-609` (after `sizeNodeIds`):

```ts
            sizeNodeIds: schema.workflowTemplates.sizeNodeIds,
            garmentView: schema.workflowTemplates.garmentView,
            version: schema.workflowTemplates.version,
```

Add to the constructed row at `:667-681` (after `sizeNodeIds`):

```ts
            sizeNodeIds: row.sizeNodeIds,
            garmentView: row.garmentView,
          };
```

- [ ] **Step 4: Thread `garmentView` through the default `poseWorkflowRows` branch**

Add to the `.select({...})` at `:688-710` (after `defaultSizeNodeIds` and after `overrideSizeNodeIds` respectively):

```ts
      defaultSizeNodeIds: defaultWorkflow.sizeNodeIds,
      defaultGarmentView: defaultWorkflow.garmentView,
```

```ts
      overrideSizeNodeIds: overrideWorkflow.sizeNodeIds,
      overrideGarmentView: overrideWorkflow.garmentView,
    })
```

Add to the constructed row at `:780-804` (after `sizeNodeIds`):

```ts
        sizeNodeIds:
          r.configWorkflowTemplateId != null ? r.overrideSizeNodeIds : r.defaultSizeNodeIds,
        garmentView:
          r.configWorkflowTemplateId != null ? r.overrideGarmentView : r.defaultGarmentView,
      })));
```

- [ ] **Step 5: Hardcode `garmentView: null` in the `sareeStep2` branch**

At `:766-778`, add `garmentView: null,` (never `'back'` — this flow is explicitly out of scope, see Global Constraints):

```ts
        upperNodeIds: sareeStep2?.upperNodeIds ?? [],
        lowerNodeId: sareeStep2?.lowerNodeId ?? null,
        shoeNodeId: sareeStep2?.shoeNodeId ?? null,
        thirdNodeId: sareeStep2?.thirdNodeId ?? null,
        sizeNodeIds: sareeStep2?.sizeNodeIds ?? null,
        garmentView: null,
      }))
```

- [ ] **Step 6: Validation loop — reject a back-view pose missing its back photo**

At `:809-825`, the existing block is:

```ts
  for (const pw of poseWorkflows) {
    if (pw.upperNodeIds.length > 0 && opts.resolvedUpperGarmentKey === undefined) {
      throw new AppError('VALIDATION', 400, 'upper garment required for this pose');
    }
    if (pw.lowerNodeId) {
      if (pw.upperNodeIds.length === 0) {
        // A sole lower hero must be the customer's upload, not a generic catalog image.
        if (!lowerGarmentKey) {
          throw new AppError('VALIDATION', 400, 'lower garment upload required for this pose');
        }
      } else if (!lowerCatalogId && !lowerGarmentKey) {
        throw new AppError('VALIDATION', 400, 'lower garment required for this pose');
      }
    }
    if (pw.shoeNodeId && !shoeCatalogId) {
      throw new AppError('VALIDATION', 400, 'shoe catalog item required for this pose');
    }
```

Replace with (new checks inserted; existing lower-garment `if` gains a `garmentView === 'back'` branch first):

```ts
  for (const pw of poseWorkflows) {
    if (pw.upperNodeIds.length > 0 && opts.resolvedUpperGarmentKey === undefined) {
      throw new AppError('VALIDATION', 400, 'upper garment required for this pose');
    }
    // A back-view pose needs the customer's own back-view photo — the regular
    // front upperGarmentKey (always present per the XOR schema even when this
    // pose won't use it, see effectiveLowerGarmentKey's own comment below)
    // never substitutes for it. Also catches a merchant/Shopify-routed job
    // resolving to a back-view template: that caller never populates
    // upperGarmentBackKey, so this fires there too — no separate guard needed.
    if (pw.upperNodeIds.length > 0 && pw.garmentView === 'back' && !upperGarmentBackKey) {
      throw new AppError('VALIDATION', 400, 'back-view upper garment required for this pose');
    }
    if (pw.lowerNodeId) {
      if (pw.garmentView === 'back') {
        // Catalog items have no back-view photo — a back-view lower must be
        // the customer's own upload, never lowerCatalogId.
        if (!lowerGarmentBackKey) {
          throw new AppError(
            'VALIDATION',
            400,
            'back-view lower garment upload required for this pose',
          );
        }
      } else if (pw.upperNodeIds.length === 0) {
        // A sole lower hero must be the customer's upload, not a generic catalog image.
        if (!lowerGarmentKey) {
          throw new AppError('VALIDATION', 400, 'lower garment upload required for this pose');
        }
      } else if (!lowerCatalogId && !lowerGarmentKey) {
        throw new AppError('VALIDATION', 400, 'lower garment required for this pose');
      }
    }
    if (pw.shoeNodeId && !shoeCatalogId) {
      throw new AppError('VALIDATION', 400, 'shoe catalog item required for this pose');
    }
```

- [ ] **Step 7: `looks_` map — pick the right photo per look, per role**

At `:851-867`, the existing block is:

```ts
  const looks_: TryonPlanLook[] = looks.map((look) => {
    const pw = poseWorkflowMap.get(look.poseId);
    // Only store inputs the workflow actually supports — strips irrelevant fields
    // so the dispatcher never receives/resolves data it won't use.
    const lookUpperGarmentKey =
      pw?.upperNodeIds && pw.upperNodeIds.length > 0 ? (resolvedUpperGarmentKey ?? null) : null;
    const effectiveLowerCatalogId =
      pw?.lowerNodeId && !lowerGarmentKey ? (lowerCatalogId ?? null) : null;
    const effectiveLowerGarmentKey = pw?.lowerNodeId && lowerGarmentKey ? lowerGarmentKey : null;
    const effectiveShoeCatalogId = pw?.shoeNodeId ? (shoeCatalogId ?? null) : null;
```

Replace with:

```ts
  const looks_: TryonPlanLook[] = looks.map((look) => {
    const pw = poseWorkflowMap.get(look.poseId);
    const isBackView = pw?.garmentView === 'back';
    // Only store inputs the workflow actually supports — strips irrelevant fields
    // so the dispatcher never receives/resolves data it won't use. For a
    // back-view pose, the back photo is selected instead of the front one —
    // validated as present above, so `?? null` here is just TS narrowing, not
    // a real fallback.
    const lookUpperGarmentKey =
      pw?.upperNodeIds && pw.upperNodeIds.length > 0
        ? isBackView
          ? (upperGarmentBackKey ?? null)
          : (resolvedUpperGarmentKey ?? null)
        : null;
    const effectiveLowerCatalogId =
      pw?.lowerNodeId && !isBackView && !lowerGarmentKey ? (lowerCatalogId ?? null) : null;
    const effectiveLowerGarmentKey = pw?.lowerNodeId
      ? isBackView
        ? (lowerGarmentBackKey ?? null)
        : lowerGarmentKey
          ? lowerGarmentKey
          : null
      : null;
    const effectiveShoeCatalogId = pw?.shoeNodeId ? (shoeCatalogId ?? null) : null;
```

(everything after this in the map — the `return { ... }` — is unchanged, since it already just reads `lookUpperGarmentKey`/`effectiveLowerGarmentKey`)

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @aivastra/api typecheck`. Fix any type mismatches from the new destructured/threaded fields before continuing.

- [ ] **Step 9: Write the integration test**

Create `apps/api/test/integration/jobs-back-garment-view.test.ts`. Follow the harness pattern in any existing `test/integration/*.test.ts` file (fresh DB via `CREATE DATABASE`, migrations applied, `buildTestApp()`). At minimum:

1. Seed a `garmentView: 'back'` workflow template (upper + lower nodes both set), a `modelPoseAssets` row pointing at it, a face, and a background.
2. `POST /v1/jobs/tryon` with only `upperGarmentKey` (front) and the resolved back pose → expect `400` with a message containing "back-view upper garment".
3. Same request, add `upperGarmentBackKey` but the pose also has a `lowerNodeId` → still `400`, "back-view lower garment".
4. Add `lowerGarmentBackKey` too → `201`/success; assert the created job's `job_inputs.upperGarmentKey` equals the *back* key, not the front one.
5. Same setup but pass `lowerCatalogId` instead of `lowerGarmentBackKey` → still `400` (catalog item must never satisfy a back-view lower).
6. A batch with two looks — one resolving to a front-pose template, one to the back-pose template, both uploads present — assert each created job's `job_inputs.upperGarmentKey` matches its *own* look's correct photo (front job gets the front key, back job gets the back key). This is Review Focus item #2.

Run: `pnpm --filter @aivastra/api exec vitest run test/integration/jobs-back-garment-view.test.ts` (needs `pnpm docker:up` first).

---

### Task 7: Poses route — expose `garmentView`

**Files:**
- Modify: `apps/api/src/modules/models/routes.ts` (`GET /v1/models/poses`, `:281-403`)

**Interfaces:**
- Produces: each item in `GET /v1/models/poses`'s `items[]` gains `garmentView: 'front' | 'back'`. Consumed by Studio (Task 8's `PoseItem` type).

- [ ] **Step 1: Add it to the base select**

At `:297-308`, after `sizeNodeIds`:

```ts
          sizeNodeIds: schema.workflowTemplates.sizeNodeIds,
          garmentView: schema.workflowTemplates.garmentView,
        })
```

- [ ] **Step 2: Add it to the per-garment-type override select and map**

At `:341-350`, after `sizeNodeIds`:

```ts
            sizeNodeIds: schema.workflowTemplates.sizeNodeIds,
            garmentView: schema.workflowTemplates.garmentView,
          })
```

At `:365-377` (the `configMap` construction), after `sizeNodeIds`:

```ts
                upperNodeIds: c.upperNodeIds ?? null,
                lowerNodeId: c.lowerNodeId ?? null,
                shoeNodeId: c.shoeNodeId ?? null,
                sizeNodeIds: c.sizeNodeIds ?? null,
                garmentView: c.garmentView ?? 'front',
              },
```

(also update the `Map<string, {...}>` type annotation at `:330-337` to add `garmentView: string;`)

- [ ] **Step 3: Resolve and return it in the final item map**

At `:387-399`:

```ts
            .map(async (i) => {
              const cfg = configMap.get(i.id);
              const upperNodeIds = cfg !== undefined ? cfg.upperNodeIds : i.upperNodeIds;
              const lowerNodeId = cfg !== undefined ? cfg.lowerNodeId : i.lowerNodeId;
              const shoeNodeId = cfg !== undefined ? cfg.shoeNodeId : i.shoeNodeId;
              const sizeNodeIds = cfg !== undefined ? cfg.sizeNodeIds : i.sizeNodeIds;
              const garmentView = cfg !== undefined ? cfg.garmentView : i.garmentView;
              return {
                id: i.id,
                label: i.displayName ?? i.label,
                thumbnailUrl: (await app.storage.presignGet(i.thumbnailUrl, 3600)).url,
                ...poseGarmentRoles({ upperNodeIds, lowerNodeId, shoeNodeId }),
                garmentView: garmentView ?? 'front',
                hasAspectRatio: (sizeNodeIds?.length ?? 0) > 0,
              };
            }),
```

(deliberately *not* folded into `poseGarmentRoles()` — that helper derives boolean role flags from node-ID presence; `garmentView` is a plain passthrough with a different shape, so it stays a separate field to keep that helper's single responsibility intact)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @aivastra/api typecheck`.

---

### Task 8: Studio — types, state, upload handlers for back photos

**Files:**
- Modify: `apps/catalogues-web/src/app/(app)/studio/page.tsx`

**Interfaces:**
- Produces: `upperGarmentBackKey`, `lowerGarmentBackKey` string state, ready for Task 9 (gating) and Task 11 (submit payload).

- [ ] **Step 1: Add `garmentView` to `PoseItem`**

At `:101-108`:

```ts
interface PoseItem {
  id: string;
  label: string;
  thumbnailUrl: string;
  hasUpper: boolean;
  hasLower: boolean;
  hasShoes: boolean;
  garmentView: 'front' | 'back';
}
```

(`TemplateLook` at `:109-120` is deliberately left unchanged — template mode is out of scope, see Global Constraints.)

- [ ] **Step 2: Add upload state, mirroring the existing `lowerGarmentFile`/`lowerGarmentKey` pattern**

Immediately after the `lowerGarmentKey`/`isUploadingLower` state (`:580-581`):

```ts
  const [lowerGarmentKey, setLowerGarmentKey] = useState('');
  const [isUploadingLower, setIsUploadingLower] = useState(false);
  const [upperGarmentBackFile, setUpperGarmentBackFile] = useState<File | null>(null);
  const upperGarmentBackPreviewUrl = useMemo(
    () => (upperGarmentBackFile ? URL.createObjectURL(upperGarmentBackFile) : ''),
    [upperGarmentBackFile],
  );
  useEffect(() => {
    return () => {
      if (upperGarmentBackPreviewUrl) URL.revokeObjectURL(upperGarmentBackPreviewUrl);
    };
  }, [upperGarmentBackPreviewUrl]);
  const [upperGarmentBackKey, setUpperGarmentBackKey] = useState('');
  const [isUploadingUpperBack, setIsUploadingUpperBack] = useState(false);
  const [lowerGarmentBackFile, setLowerGarmentBackFile] = useState<File | null>(null);
  const lowerGarmentBackPreviewUrl = useMemo(
    () => (lowerGarmentBackFile ? URL.createObjectURL(lowerGarmentBackFile) : ''),
    [lowerGarmentBackFile],
  );
  useEffect(() => {
    return () => {
      if (lowerGarmentBackPreviewUrl) URL.revokeObjectURL(lowerGarmentBackPreviewUrl);
    };
  }, [lowerGarmentBackPreviewUrl]);
  const [lowerGarmentBackKey, setLowerGarmentBackKey] = useState('');
  const [isUploadingLowerBack, setIsUploadingLowerBack] = useState(false);
```

- [ ] **Step 3: Add upload handlers, mirroring `handleLowerGarmentUpload` (`:1207-1242`)**

Immediately after `handleLowerGarmentUpload`'s closing brace (`:1242`):

```ts
  async function handleUpperGarmentBackUpload(file: File) {
    if (isUploadingUpperBack) return;
    if (file.size > 20 * 1024 * 1024) {
      showToast('File exceeds 20 MB. Please choose a smaller image.');
      return;
    }
    if (!(await isSupportedImageBytes(file))) {
      showToast('Unsupported file type. Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    setUpperGarmentBackFile(file);
    setIsUploadingUpperBack(true);
    try {
      const { uploadUrl, r2Key } = await api.post<{
        uploadUrl: string;
        r2Key: string;
        expiresIn: number;
      }>('/v1/uploads/presign', { contentType: file.type, contentLength: file.size });
      await api.uploadToR2WithProgress(uploadUrl, file, () => {}, undefined);
      setUpperGarmentBackKey(r2Key);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = (e as Error).message ?? '';
      showToast(
        msg.includes('403')
          ? 'Upload session expired. Please re-select your image and try again.'
          : `Back-view garment upload failed: ${msg}`,
      );
      setUpperGarmentBackFile(null);
      setUpperGarmentBackKey('');
    } finally {
      setIsUploadingUpperBack(false);
    }
  }

  async function handleLowerGarmentBackUpload(file: File) {
    if (isUploadingLowerBack) return;
    if (file.size > 20 * 1024 * 1024) {
      showToast('File exceeds 20 MB. Please choose a smaller image.');
      return;
    }
    if (!(await isSupportedImageBytes(file))) {
      showToast('Unsupported file type. Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    setLowerGarmentBackFile(file);
    setIsUploadingLowerBack(true);
    try {
      const { uploadUrl, r2Key } = await api.post<{
        uploadUrl: string;
        r2Key: string;
        expiresIn: number;
      }>('/v1/uploads/presign', { contentType: file.type, contentLength: file.size });
      await api.uploadToR2WithProgress(uploadUrl, file, () => {}, undefined);
      setLowerGarmentBackKey(r2Key);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = (e as Error).message ?? '';
      showToast(
        msg.includes('403')
          ? 'Upload session expired. Please re-select your image and try again.'
          : `Back-view lower garment upload failed: ${msg}`,
      );
      setLowerGarmentBackFile(null);
      setLowerGarmentBackKey('');
    } finally {
      setIsUploadingLowerBack(false);
    }
  }
```

(uses `undefined` for the abort signal, unlike `handleGarmentUpload`'s `AbortController` — matches `handleThirdGarmentUpload`/`handlePalluGarmentUpload`'s simpler pattern, which don't support cancel-in-flight either; if `api.uploadToR2WithProgress`'s signature requires a non-optional `AbortSignal`, check how `handleThirdGarmentUpload` at `:1244-1279` actually calls it and match that instead)

---

### Task 9: Studio — gating logic

**Files:**
- Modify: `apps/catalogues-web/src/app/(app)/studio/page.tsx`

**Interfaces:**
- Consumes: `PoseItem.garmentView` (Task 8), upload state (Task 8).
- Produces: `needsUpperBack`, `needsLowerBack` booleans; extends `canGenerate`/`generateBlocker`/`extraSectionKeys`/`isLowerOnlyRole`/`handlePoseSelect`.

- [ ] **Step 1: `needsUpperBack` / `needsLowerBack`**

At `:1066-1074`, immediately after `needsShoes`:

```ts
  const needsShoes =
    catalogueTemplateId === 'custom'
      ? selectedPoses.some((p) => p.hasShoes)
      : selectedLooks.some((l) => l.hasShoes);
  // Template mode never sets garmentView on TemplateLook (out of scope — see
  // the plan's Global Constraints), so these are always false there.
  const needsUpperBack =
    catalogueTemplateId === 'custom' &&
    selectedPoses.some((p) => p.hasUpper && p.garmentView === 'back');
  const needsLowerBack =
    catalogueTemplateId === 'custom' &&
    selectedPoses.some((p) => p.hasLower && p.garmentView === 'back');
```

- [ ] **Step 2: Extend `isLowerOnlyRole` routing for a lower-only back pose**

At `:1087-1089`, the existing comment + line is:

```ts
  // createJob's schema requires upperGarmentKey, and strips it for a lower-only pose
  // (create.ts effectiveUpperGarmentKey), so the same key is sent in both slots.
  const lowerGarmentKeyForSubmit = lowerOnly ? garmentKey : lowerGarmentKey;
```

Replace with (a lower-only pose that's *also* back-view routes the single uploaded photo into the back-lower slot instead — matches Review Focus item #5):

```ts
  // createJob's schema requires upperGarmentKey, and strips it for a lower-only pose
  // (create.ts effectiveUpperGarmentKey), so the same key is sent in both slots. A
  // lower-only pose that's also back-view routes into the back-lower slot instead —
  // there's only one upload box shown for a lower-only role either way.
  const lowerOnlyIsBack =
    lowerOnly &&
    (catalogueTemplateId === 'custom'
      ? selectedPoses.some((p) => p.garmentView === 'back')
      : false);
  const lowerGarmentKeyForSubmit = lowerOnly
    ? lowerOnlyIsBack
      ? undefined // sent as upperGarmentBackKey instead — see Task 11
      : garmentKey
    : lowerGarmentKey;
```

(Task 11's submit payload construction reads `lowerOnlyIsBack` to decide which field the single upload goes into — see that task.)

- [ ] **Step 3: Clear stale back-photo state on pose toggle**

At `:1345-1356`, the existing `handlePoseSelect`:

```ts
  function handlePoseSelect(id: string) {
    setPoseIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      const nextPoses = poses?.items.filter((p) => next.includes(p.id)) ?? [];
      const nextNeedsLower = nextPoses.some((p) => p.hasLower);
      const nextNeedsShoes = nextPoses.some((p) => p.hasShoes);
      // Clear when no longer needed; leave empty otherwise (default sent at submit time)
      if (!nextNeedsLower) setLowerCatalogId('');
      if (!nextNeedsShoes) setShoeCatalogId('');
      return next;
    });
  }
```

Replace with:

```ts
  function handlePoseSelect(id: string) {
    setPoseIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      const nextPoses = poses?.items.filter((p) => next.includes(p.id)) ?? [];
      const nextNeedsLower = nextPoses.some((p) => p.hasLower);
      const nextNeedsShoes = nextPoses.some((p) => p.hasShoes);
      const nextNeedsUpperBack = nextPoses.some((p) => p.hasUpper && p.garmentView === 'back');
      const nextNeedsLowerBack = nextPoses.some((p) => p.hasLower && p.garmentView === 'back');
      // Clear when no longer needed; leave empty otherwise (default sent at submit time)
      if (!nextNeedsLower) setLowerCatalogId('');
      if (!nextNeedsShoes) setShoeCatalogId('');
      if (!nextNeedsUpperBack) {
        setUpperGarmentBackFile(null);
        setUpperGarmentBackKey('');
      }
      if (!nextNeedsLowerBack) {
        setLowerGarmentBackFile(null);
        setLowerGarmentBackKey('');
      }
      return next;
    });
  }
```

- [ ] **Step 4: `canGenerate` / `generateBlocker`**

At `:1603-1618`, add two conditions to `canGenerate` (after `(!requiresLowerUpload || !!lowerGarmentKey)`):

```ts
  const canGenerate =
    selectedCount > 0 &&
    !!garmentKey &&
    (!requiresLowerUpload || !!lowerGarmentKey) &&
    (!needsUpperBack || !!upperGarmentBackKey) &&
    (!needsLowerBack || lowerOnlyIsBack ? !!upperGarmentBackKey : !!lowerGarmentBackKey) &&
    (!requiresThirdUpload || !!thirdGarmentKey) &&
    (!sareeTwoInputActive || !!palluGarmentKey) &&
    !!faceId &&
    (catalogueTemplateId === 'custom' ? !!backgroundId : true) &&
    customDimsReady &&
    !!resolution &&
    !isUploading &&
    !isUploadingLower &&
    !isUploadingUpperBack &&
    !isUploadingLowerBack &&
    !isUploadingThird &&
    !isUploadingPallu &&
    !isSubmitting &&
    !generationInProgress;
```

Wait — re-check that `needsLowerBack` line before using it: when `lowerOnlyIsBack` is true, the single upload lands in `upperGarmentBackKey` (per Task 9 Step 2), so the gate for "lower back satisfied" should check `upperGarmentBackKey` in that case, not `lowerGarmentBackKey`. Simplify to avoid the confusing inline ternary above — use this instead:

```ts
    (!needsLowerBack || (lowerOnlyIsBack ? !!upperGarmentBackKey : !!lowerGarmentBackKey)) &&
```

At `:1620-1638`, add corresponding blocker messages (after the `requiresLowerUpload` blocker):

```ts
      : requiresLowerUpload && !lowerGarmentKey
        ? 'Upload the lower garment image first'
        : needsUpperBack && !upperGarmentBackKey
          ? 'Upload the back-view garment image first'
          : needsLowerBack && !lowerOnlyIsBack && !lowerGarmentBackKey
            ? 'Upload the back-view lower garment image first'
            : requiresThirdUpload && !thirdGarmentKey
```

(adjust the nesting to fit the existing ternary chain exactly — read the surrounding lines again before editing, since this is a long nested ternary and an off-by-one paren will break it)

- [ ] **Step 5: `extraSectionKeys`**

At `:1646-1655`, insert after `'lower'`/`'shoes'`:

```ts
  const extraSectionKeys = [
    hasCatalogueTemplates && 'templates',
    catalogueTemplateId === 'custom' && 'background',
    catalogueTemplateId === 'custom' && 'poses',
    needsLower && !requiresLowerUpload && !lowerOnly && 'lower',
    needsShoes && 'shoes',
    needsUpperBack && 'upperBack',
    needsLowerBack && !lowerOnlyIsBack && 'lowerBack',
    'platform',
    'resolution',
    'aspect',
  ].filter((key): key is string => !!key);
```

---

### Task 10: Studio — back-photo upload UI

**Files:**
- Modify: `apps/catalogues-web/src/app/(app)/studio/page.tsx`

**Interfaces:**
- Consumes: state + handlers from Task 8, gating from Task 9.
- Produces: two new conditionally-rendered upload sections, placed after the existing `needsShoes` catalog-picker section (`:4240-4327`).

- [ ] **Step 1: Add the two sections**

Immediately after the `needsShoes` section's closing `})()}` (`:4327`), before the "Publishing Platform" section (`:4329`):

```tsx
              {needsUpperBack && (
                <section className="studio-section-card" style={sectionCardStyle}>
                  <SectionHead
                    title="Garment — Back View"
                    stepNumber={stepNumberOf('upperBack')}
                  />
                  <p style={{ fontSize: 12, color: C.mid, margin: '0 0 12px' }}>
                    The pose(s) you picked show the back of the garment — upload a flat-lay photo
                    of its back as well.
                  </p>
                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: 16,
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      maxWidth: 240,
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f && ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
                        handleUpperGarmentBackUpload(f);
                    }}
                  >
                    {upperGarmentBackFile ? (
                      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {/* biome-ignore lint/performance/noImgElement: static image, Next Image not needed */}
                        <img
                          src={upperGarmentBackPreviewUrl}
                          alt={upperGarmentBackFile.name}
                          style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6 }}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setUpperGarmentBackFile(null);
                            setUpperGarmentBackKey('');
                          }}
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: 'rgba(0,0,0,0.5)',
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <XIcon size={14} />
                        </button>
                        {isUploadingUpperBack && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 8,
                              left: 8,
                              right: 8,
                              background: 'rgba(255,255,255,0.95)',
                              borderRadius: 8,
                              padding: '6px 10px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.text }}>
                              <SpinnerIcon size={14} /> Uploading…
                            </div>
                          </div>
                        )}
                        {upperGarmentBackKey && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 8,
                              left: 8,
                              background: C.mint,
                              color: 'white',
                              borderRadius: 6,
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <CheckIcon color="#fff" size={10} /> Uploaded
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <span style={{ fontSize: 11, fontWeight: 500, color: C.text, textAlign: 'center' }}>
                          Back of Garment
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 500, color: C.mid, textAlign: 'center' }}>
                          JPG, PNG · Max 20MB
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <ImagePlusIcon size={14} />
                          <span style={{ fontSize: 11, fontWeight: 500, color: C.text }}>Browse</span>
                        </div>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpperGarmentBackUpload(f);
                      }}
                    />
                  </label>
                </section>
              )}

              {needsLowerBack && !lowerOnlyIsBack && (
                <section className="studio-section-card" style={sectionCardStyle}>
                  <SectionHead
                    title="Lower Garment — Back View"
                    stepNumber={stepNumberOf('lowerBack')}
                  />
                  <p style={{ fontSize: 12, color: C.mid, margin: '0 0 12px' }}>
                    The pose(s) you picked show the back of the lower garment — upload a flat-lay
                    photo of its back as well.
                  </p>
                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: 16,
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      maxWidth: 240,
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f && ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
                        handleLowerGarmentBackUpload(f);
                    }}
                  >
                    {lowerGarmentBackFile ? (
                      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {/* biome-ignore lint/performance/noImgElement: static image, Next Image not needed */}
                        <img
                          src={lowerGarmentBackPreviewUrl}
                          alt={lowerGarmentBackFile.name}
                          style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6 }}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setLowerGarmentBackFile(null);
                            setLowerGarmentBackKey('');
                          }}
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: 'rgba(0,0,0,0.5)',
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <XIcon size={14} />
                        </button>
                        {isUploadingLowerBack && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 8,
                              left: 8,
                              right: 8,
                              background: 'rgba(255,255,255,0.95)',
                              borderRadius: 8,
                              padding: '6px 10px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.text }}>
                              <SpinnerIcon size={14} /> Uploading…
                            </div>
                          </div>
                        )}
                        {lowerGarmentBackKey && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 8,
                              left: 8,
                              background: C.mint,
                              color: 'white',
                              borderRadius: 6,
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <CheckIcon color="#fff" size={10} /> Uploaded
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <span style={{ fontSize: 11, fontWeight: 500, color: C.text, textAlign: 'center' }}>
                          Back of Lower Garment
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 500, color: C.mid, textAlign: 'center' }}>
                          JPG, PNG · Max 20MB
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <ImagePlusIcon size={14} />
                          <span style={{ fontSize: 11, fontWeight: 500, color: C.text }}>Browse</span>
                        </div>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleLowerGarmentBackUpload(f);
                      }}
                    />
                  </label>
                </section>
              )}
```

(Simpler markup than the step-1 dropzone at `:2727-2906` — no `flex: 1` row-mate siblings to match, since these are their own full-width sections, not boxes sharing a row with pallu/third-garment uploads. Uses the same `C` tokens, icons, and `sectionCardStyle`/`SectionHead` already imported/defined in this file.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @aivastra/web typecheck` (confirm the actual package name — `apps/catalogues-web`'s `package.json` name per CLAUDE.md is `@aivastra/web`).

---

### Task 11: Studio — wire back keys into the submit payload

**Files:**
- Modify: `apps/catalogues-web/src/app/(app)/studio/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 8-10.
- Produces: `POST /v1/jobs/tryon` requests that include `upperGarmentBackKey`/`lowerGarmentBackKey` when needed.

There are three call sites building `inputs`/`step2InputsBase` for `/v1/jobs/tryon`: `handleSubmit`'s `step2InputsBase` (`:1399-1406`) + its `upperGarmentKey` addition (`:1437-1440`), and `submitAmazonPose`'s two inline `inputs` objects (`:1505-1520`, `:1544-1556`).

- [ ] **Step 1: `handleSubmit`**

At `:1399-1406`:

```ts
      const step2InputsBase = {
        faceId,
        garmentTypeId: garmentTypeId || undefined,
        lowerCatalogId: effectiveLowerId,
        lowerGarmentKey: lowerGarmentKeyForSubmit || undefined,
        lowerGarmentBackKey: needsLowerBack && !lowerOnlyIsBack ? lowerGarmentBackKey : undefined,
        shoeCatalogId: effectiveShoesId,
        thirdGarmentKey: thirdGarmentKey || undefined,
      };
```

At `:1436-1440`:

```ts
      } else {
        const inputs = {
          upperGarmentKey: garmentKey,
          upperGarmentBackKey: lowerOnlyIsBack
            ? upperGarmentBackKey || undefined // lower-only-back routes the single upload here
            : needsUpperBack
              ? upperGarmentBackKey || undefined
              : undefined,
          ...step2Inputs,
        };
```

Wait — re-derive this rather than copy blindly: when `lowerOnlyIsBack` is true, the pose has no upper node at all (`hasUpper === false`), so `upperGarmentKey` itself is stripped server-side already (`create.ts`'s `lookUpperGarmentKey`). Sending `upperGarmentBackKey` in that case doesn't correspond to an upper role — it needs to land in the **lower** back slot instead, since `create.ts` only reads `lowerGarmentBackKey` for the lower role. Correct version:

```ts
      } else {
        const inputs = {
          upperGarmentKey: garmentKey,
          upperGarmentBackKey: needsUpperBack ? upperGarmentBackKey || undefined : undefined,
          ...step2Inputs,
          lowerGarmentBackKey: lowerOnlyIsBack
            ? upperGarmentBackKey || undefined
            : step2Inputs.lowerGarmentBackKey,
        };
```

(the `lowerOnlyIsBack` override must come *after* the `...step2Inputs` spread so it wins; double-check this against Task 9 Step 2's `lowerGarmentKeyForSubmit` logic once both are in place — they must agree on which single upload box is shown and where its key ends up. If this feels fragile when you're actually implementing it, that's a sign to simplify Task 9/10's lower-only-back handling rather than patch around it here.)

- [ ] **Step 2: `submitAmazonPose`'s two `inputs` objects**

At `:1509-1520` and `:1544-1556`, add the same two fields each place `lowerGarmentKey`/`thirdGarmentKey` already appear:

```ts
        inputs: {
          upperGarmentKey: garmentKey,
          upperGarmentBackKey: needsUpperBack ? upperGarmentBackKey || undefined : undefined,
          faceId,
          backgroundId,
          poseIds: [mainPoseId],
          garmentTypeId: garmentTypeId || undefined,
          lowerCatalogId: effectiveLowerId,
          lowerGarmentKey: lowerGarmentKeyForSubmit || undefined,
          lowerGarmentBackKey: needsLowerBack && !lowerOnlyIsBack ? lowerGarmentBackKey : undefined,
          shoeCatalogId: effectiveShoesId,
          thirdGarmentKey: thirdGarmentKey || undefined,
        },
```

(same shape for the second `inputs:` object at `:1546-1556`, with `poseIds: remainingPoseIds` unchanged)

- [ ] **Step 3: Typecheck, lint, build**

```bash
pnpm --filter @aivastra/web typecheck
pnpm --filter @aivastra/web lint
pnpm --filter @aivastra/web build
```

- [ ] **Step 4: Manual reasoning check (no component-render test harness — see Global Constraints)**

Walk through these states and confirm the logic holds:
1. No pose selected → no back-upload sections render, `needsUpperBack`/`needsLowerBack` both false.
2. A front-only pose selected → same as today, no behavior change.
3. A back pose selected (upper + lower both present on its workflow) → both back-upload sections appear; `canGenerate` stays false until both are uploaded; submit sends `upperGarmentBackKey` + `lowerGarmentBackKey`.
4. A lower-only back pose selected → only the "Back of Garment" upload box needed (not two), and its key ends up as `lowerGarmentBackKey` server-side via the `lowerOnlyIsBack` routing.
5. Toggling a back pose off after uploading its back photo → `handlePoseSelect` clears the back file/key state, sections disappear.
6. A batch mixing a front pose and a back pose (same submission) → both a front upload and both back uploads are required before `canGenerate` is true; each resulting job gets its own correct photo (verified server-side by Task 6's test, item 6).

---

### Task 12: End-to-end verification with the real workflow

**Files:** none — this is a manual/data task, not a code task.

- [ ] **Step 1: Register the template**

With all above tasks merged and the local stack running (`pnpm docker:up`, `pnpm dev`), open the admin panel's Workflows page and upload `two_piece_back_pose.json`, `workflowType: regular`, `garmentView: back`. Per the node-ID mapping worked out earlier in this conversation:

| Field | Value |
|---|---|
| `faceNodeId` | `1005` (auto-detects, titled `face`) |
| `poseNodeId` | `1007` (auto-detects, titled `pose`) |
| `bgNodeId` | `1011` (auto-detects, titled `background`) |
| `upperNodeIds` | `[879]` (auto-detects, titled `upper_garment`) |
| `lowerNodeId` | `1260` (auto-detects, titled `lower_garment`) |
| `shoeNodeId` | `1280` — **manual**, titled `footwear` not `shoes` |
| `latentSizeNodeIds` | `[1168, 1169]` — **manual** (`max-width`/`max-height`) |
| `outputSizeNodeIds` | `[878:735, 1170]` — **manual** (`result-width`/`result-height`) |
| `garmentPhasePromptNode` | `1301` — **manual** (custom Qwen-edit encode node) |
| `facePhasePromptNode` | `878:1044` — **manual** (negative CLIPTextEncode) |

Before this template can actually dispatch successfully, confirm with the `aivastra-gpu` side that the GPU workers have the custom nodes this graph needs (`SAM3Segment`, `QwenEditConfigJsonParser`, `TextEncodeQwenImageEditPlusCustom_lrzjason`, the `qwen-image-edit-2511` GGUF unet) — this plan does not cover that.

- [ ] **Step 2: Add a pose asset**

Upload a real back-facing pose photo as a `model_pose_assets` row, `workflowTemplateId` pointing at the template from Step 1.

- [ ] **Step 3: Exercise Studio**

Load Studio locally, pick a garment type this pose applies to, upload a front garment photo, select the new back pose alongside an existing front pose, confirm both back-view upload sections appear, upload back photos, submit, and confirm two jobs get created with the correct photo routed to each (check `job_inputs` rows directly if the dispatcher/GPU side isn't wired up yet to actually complete the jobs).
