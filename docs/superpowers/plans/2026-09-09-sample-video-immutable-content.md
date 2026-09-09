# Sample-video content fields become create-only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the ability to edit `title`/`prompt`/`sortOrder`/`duration`/`quality` on an existing `sample_videos` row after creation — a template's uploaded preview clip is a real PixVerse output generated for one exact prompt/duration/quality combo, so editing those afterward would leave a stale preview. Only `isActive` stays patchable; everything else is create-new + delete only.

**Architecture:** Two independent, self-contained changes: (1) delete the Task-12 admin-web edit drawer and its wiring, (2) narrow the `PatchSampleVideoBody` Zod schema in `packages/types` to `{ isActive: boolean }`, which automatically narrows `PATCH /admin/assets/sample-videos/:id`'s effective behavior without touching route handler logic.

**Tech Stack:** TypeScript, Zod (`packages/types`), Fastify + `fastify-type-provider-zod` (`apps/api`), React + Vite (`apps/admin-web`), Vitest integration tests.

## Global Constraints

- No `.strict()` — this repo has zero `.strict()` precedent anywhere in `packages/types/src` (verified via grep before this plan was written). Do not add it to `PatchSampleVideoBody` or anywhere else. Zod's default strip-unknown-keys behavior is what makes a stray `duration`/`quality` in a PATCH body a silent no-op rather than a 400 — that is the intended, spec'd behavior (see design doc's Change 2 / "Validation behavior").
- `isActive` toggle stays fully functional and untouched — it's the one field that doesn't touch the preview/prompt/duration/quality relationship. Do not remove or gate it.
- No DB schema or migration changes. `sample_videos` columns (`title`, `prompt`, `sortOrder`, `duration`, `quality`) stay exactly as they are — this is an API/UI-layer restriction only, not a data-model change.
- No changes to the create flow (`SampleVideoUploadModal.tsx`, `ConfirmSampleVideoBody`, the presign flow), pricing (`computePixverseVideoCost`, `getPixverseVideoCreditCost`, Job Costs formula UI), `CatalogVideoWizard.tsx`, or the dispatcher.
- Design doc: `docs/superpowers/specs/2026-09-09-sample-video-immutable-content-design.md`.

---

### Task 1: Remove the sample-video edit UI

**Files:**
- Delete: `apps/admin-web/src/components/SampleVideoEditDrawer.tsx`
- Modify: `apps/admin-web/src/pages/assets/SampleVideosTab.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing later tasks depend on — this task is purely subtractive on the admin-web side and is independent of Task 2.

- [ ] **Step 1: Delete the edit drawer file**

```bash
rm apps/admin-web/src/components/SampleVideoEditDrawer.tsx
```

- [ ] **Step 2: Remove the drawer's wiring from `SampleVideosTab.tsx`**

Current file (`apps/admin-web/src/pages/assets/SampleVideosTab.tsx`) has these four things to remove, leaving everything else (including the `Switch`/`toggle()` active-state code) untouched:

1. The import at the top:
```ts
import { SampleVideoEditDrawer } from '../../components/SampleVideoEditDrawer';
```
Delete this line entirely.

2. The `editingItem` state declaration:
```ts
const [editingItem, setEditingItem] = useState<SampleVideo | null>(null);
```
Delete this line entirely.

3. The "Edit" button inside each card's action row (currently sits between the `Switch` and the delete button):
```tsx
                    <button
                      className="btn sm"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => setEditingItem(item)}
                    >
                      <Icon.Edit /> Edit
                    </button>
```
Delete this block. After removal, the delete button's `style={{ marginLeft: 'auto' }}` (currently on the Edit button, not the delete button) needs to move to the delete button so it stays right-aligned next to the `Switch`:
```tsx
                    <button
                      className="btn sm danger"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => setConfirmDeleteId(item.id)}
                    >
                      <Icon.Trash /> Delete
                    </button>
```

4. The drawer render block at the bottom of the component, right after the `SampleVideoUploadModal` block:
```tsx
      {editingItem && (
        <SampleVideoEditDrawer
          item={editingItem}
          toast={toast}
          onClose={() => setEditingItem(null)}
          onSaved={(updated) => {
            setItems((v) => v.map((x) => (x.id === editingItem.id ? { ...x, ...updated } : x)));
            setEditingItem(null);
          }}
        />
      )}
```
Delete this block entirely.

- [ ] **Step 3: Typecheck and build admin-web**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds with no TypeScript errors (confirms no other file still imports the deleted component, and no unused-import/unused-state lint-adjacent type errors from the removed pieces).

- [ ] **Step 4: Lint admin-web**

Run: `pnpm --filter @aivastra/admin lint`
Expected: no errors (Biome would flag an unused `Icon.Edit` import if it were no longer used elsewhere in the file — check the diff shows `Icon.Edit` fully removed from this file's usage; `Icon.Trash` and `Icon.Add` stay in use).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/components/SampleVideoEditDrawer.tsx apps/admin-web/src/pages/assets/SampleVideosTab.tsx
git commit -m "$(cat <<'EOF'
refactor(admin-web): remove sample-video edit UI

A template's uploaded preview clip is a real PixVerse output tied to
its exact prompt/duration/quality — editing those after creation
leaves a stale preview. Sample videos are now create-new + delete
only; the active/inactive toggle (a separate, untouched code path)
still works.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PA2V6mNm47CeqKyg9RYnQi
EOF
)"
```

---

### Task 2: Narrow the PATCH schema and update its test

**Files:**
- Modify: `packages/types/src/admin.ts:349-356`
- Modify: `apps/api/test/integration/admin-sample-videos.test.ts:111-144`

**Interfaces:**
- Consumes: `PIXVERSE_DURATION_MIN`, `PIXVERSE_DURATION_MAX`, `PIXVERSE_QUALITIES` — already imported at the top of `packages/types/src/admin.ts` (used by `ConfirmSampleVideoBody`, which is unchanged). No new imports needed for this task; the change is a deletion of fields from an existing schema.
- Produces: `PatchSampleVideoBody` becomes `z.object({ isActive: z.boolean() })`. `apps/api/src/modules/admin/models.routes.ts`'s existing PATCH handler (`/admin/assets/sample-videos/:id`, lines 540-554) needs **no code change** — it already does `.set({ ...(body as object), updatedAt: new Date() })`, so its behavior narrows automatically once the schema does. Do not touch that handler in this task.

- [ ] **Step 1: Update the test first (TDD — this assertion currently fails against the unmodified schema)**

In `apps/api/test/integration/admin-sample-videos.test.ts`, replace the test currently titled `'accepts explicit duration/quality on create and allows patching both'` (lines 111-144) with:

```ts
  it('creates with explicit duration/quality; patch cannot change them', async () => {
    const confirmRes = await app.inject({
      method: 'POST',
      url: '/admin/assets/sample-videos',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        title: 'Runway walk',
        videoR2Key: 'sample-videos/runway.mp4',
        thumbnailR2Key: 'sample-videos/runway.thumb.gif',
        prompt: 'model walks the runway',
        sortOrder: 0,
        duration: 12,
        quality: '1080p',
      }),
    });
    expect(confirmRes.statusCode).toBe(200);
    const created = confirmRes.json();
    expect(created.duration).toBe(12);
    expect(created.quality).toBe('1080p');

    // duration/quality are no longer part of PatchSampleVideoBody — a request
    // that still sends them is not rejected (Zod strips unknown keys by
    // default, no .strict() in this repo), it's just a no-op on those keys.
    // isActive must be present since it's now the schema's only (required)
    // field.
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/sample-videos/${created.id}`,
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ isActive: true, duration: 5, quality: '360p' }),
    });
    expect(patchRes.statusCode).toBe(200);
    const [afterPatch] = await app.db
      .select()
      .from(schema.sampleVideos)
      .where(eq(schema.sampleVideos.id, created.id));
    expect(afterPatch.duration).toBe(12);
    expect(afterPatch.quality).toBe('1080p');
    expect(afterPatch.isActive).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails against the current (unmodified) schema**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts admin-sample-videos`
Expected: FAIL on `expect(afterPatch.duration).toBe(12)` — with today's `PatchSampleVideoBody` still accepting `duration`/`quality`, the PATCH actually applies them, so `afterPatch.duration` is `5`, not `12`. (Ensure `pnpm docker:up` is running first per this repo's integration-test setup.)

- [ ] **Step 3: Narrow the schema**

In `packages/types/src/admin.ts`, replace the current `PatchSampleVideoBody` (lines 349-356):

```ts
export const PatchSampleVideoBody = z.object({
  title: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(5000).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  duration: z.number().int().min(PIXVERSE_DURATION_MIN).max(PIXVERSE_DURATION_MAX).optional(),
  quality: z.enum(PIXVERSE_QUALITIES).optional(),
});
```

with:

```ts
// Create-only: a sample video's uploaded preview clip is a real PixVerse
// output generated for one exact prompt/duration/quality — editing any of
// title/prompt/sortOrder/duration/quality after creation would leave that
// preview showing a result the template no longer produces. isActive is the
// only field left, since retiring a template doesn't touch what the preview
// was generated to match.
export const PatchSampleVideoBody = z.object({
  isActive: z.boolean(),
});
```

- [ ] **Step 4: Run the test again to verify it passes**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts admin-sample-videos`
Expected: PASS — `afterPatch.duration` is `12` (unchanged), `afterPatch.quality` is `'1080p'` (unchanged), `afterPatch.isActive` is `true`.

- [ ] **Step 5: Run the full sample-videos integration test file to confirm nothing else broke**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts admin-sample-videos`
Expected: all tests in the file pass — including `'presign -> confirm -> list -> patch -> delete'` (unaffected, only ever PATCHes `{ isActive: false }`), `'rejects create without duration/quality...'`, `'rejects duration outside 1-15 on create'`, `'rejects an unrecognized quality value on create'`, and `'rejects non-mp4 content type on presign'` — none of these touch `PatchSampleVideoBody`.

- [ ] **Step 6: Typecheck the API package**

Run: `pnpm --filter @aivastra/api typecheck`
Expected: no errors. This confirms `models.routes.ts`'s PATCH handler (which does `{ ...(body as object), updatedAt: new Date() }`) still compiles against the narrowed type — it takes `body: unknown` cast, so no signature break is expected, but this step is the check that proves it.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/admin.ts apps/api/test/integration/admin-sample-videos.test.ts
git commit -m "$(cat <<'EOF'
fix(types): lock sample-video content fields to create-only

PatchSampleVideoBody now accepts only isActive — title, prompt,
sortOrder, duration, and quality can no longer be changed after a
sample-video row is created. The uploaded preview clip is a real
PixVerse output tied to those exact values at creation time; the API
layer now enforces the same create-new + delete only rule the admin
UI follows (Task 1), so a direct API call can't bypass it either.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PA2V6mNm47CeqKyg9RYnQi
EOF
)"
```

---

## Final verification

After both tasks are committed:

- [ ] Run `pnpm --filter @aivastra/api typecheck` and `pnpm --filter @aivastra/admin build` — both clean.
- [ ] Run the full `admin-sample-videos.test.ts` file once more end-to-end to confirm the final state.
- [ ] Confirm via `grep -rn "SampleVideoEditDrawer" apps/` that zero references remain anywhere in the tree.
