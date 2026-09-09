# Motion Studio config panel (right section) — Design

**Date:** 2026-09-09
**Status:** Approved, proceeding to implementation plan

## Context

The Motion Studio main screen (`apps/catalogues-web/src/app/(app)/catalog-video/page.tsx`)
was recently redesigned into a two-column layout: `SourcePanel` on the left
(upload a custom image, or `CataloguePickerModal` to reuse a past completed
AI Vastra job) and a placeholder on the right. Selecting a source currently
opens `CatalogVideoWizard` — a modal left over from before this redesign —
pre-seeded on its step 2 (template picker).

This spec replaces that placeholder with a real **configuration panel**:
pick a preset (an admin-curated `sample_videos` row, same as today) or go
**Custom** (pick duration + quality directly, PixVerse-priced by the same
formula admins already configure), review, and generate. Once this panel
covers what the modal's steps 2–3 did, the modal has no callers left and is
deleted — completing the "replace the modal wizard" direction from the
previous design session (`2026-09-09-sample-video-immutable-content-design.md`
covers the admin side; this covers the end-user side).

## Decisions from discussion

- **Custom mode has no prompt field.** Users pick duration + quality only.
  The server fills in one fixed, safe prompt behind the scenes — matches the
  existing trust boundary where only admins write PixVerse prompts.
- **Review step before charging.** Generate is two clicks: pick
  preset/custom → Continue → review (source + config + cost) → Generate.
  Not an immediate one-click submit.
- Server is the sole source of truth for the charged cost, exactly like the
  existing preset path. Anything the client computes for a live cost preview
  is cosmetic only.

## Architecture

### Backend

**1. `CreateCatalogVideoJobRequest` gains a custom branch** (`packages/types/src/jobs.ts`).
Today it requires `sampleVideoId`. It becomes:

```ts
export const CreateCatalogVideoJobRequest = z
  .object({
    sourceJobId: z.string().uuid().optional(),
    sourceImageKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
    sampleVideoId: z.string().uuid().optional(),
    duration: z.number().int().min(PIXVERSE_DURATION_MIN).max(PIXVERSE_DURATION_MAX).optional(),
    quality: z.enum(PIXVERSE_QUALITIES).optional(),
  })
  .refine((d) => Boolean(d.sourceJobId) !== Boolean(d.sourceImageKey), {
    message: 'Provide either sourceJobId or sourceImageKey, not both',
    path: ['sourceJobId'],
  })
  .refine((d) => Boolean(d.sampleVideoId) !== Boolean(d.duration || d.quality), {
    message:
      'Provide either sampleVideoId, or duration and quality — not sampleVideoId together with duration/quality',
    path: ['sampleVideoId'],
  })
  .refine((d) => d.sampleVideoId !== undefined || (d.duration !== undefined && d.quality !== undefined), {
    message: 'duration and quality must be provided together when sampleVideoId is omitted',
    path: ['duration'],
  });
```

This mirrors the file's own existing `sourceJobId`/`sourceImageKey` XOR-via-`.refine()`
style rather than introducing a discriminated union — consistent with the
surrounding code.

**2. A fixed custom-mode prompt constant**, next to the other `PIXVERSE_*`
constants in `packages/types/src/jobs.ts`:

```ts
/**
 * Used for Motion Studio's Custom mode (duration + quality picked by the
 * end user, no prompt field) — see CreateCatalogVideoJobRequest. Written
 * once, deliberately generic and safe; not admin-configurable (YAGNI —
 * promote to a config value if that's ever requested).
 */
export const PIXVERSE_CUSTOM_VIDEO_PROMPT =
  'Subtle, natural motion: gentle fabric sway and a soft camera drift. ' +
  'Keep the face, body proportions, and garment details unchanged — no ' +
  'distortion, no extra people, no background changes.';
```

**3. `createCatalogVideoJob` branches on `sampleVideoId`** (`apps/api/src/modules/jobs/create.ts`).
The user/banned/`isCatalogVideoAllowed` checks move before the
sample-specific block so both branches hit them. The sample lookup only runs
when `body.sampleVideoId` is present; otherwise `duration`/`quality` come
straight from the (now-validated) request body, cost is
`getPixverseVideoCreditCost(app, body.duration, body.quality)`, and
`job_inputs.params` stores `sampleVideoId: null`, `prompt:
PIXVERSE_CUSTOM_VIDEO_PROMPT`, `duration: body.duration`, `quality:
body.quality`. No dispatcher change — `processVideoJob`
(`apps/dispatcher/src/job/processor.ts`) already reads `prompt`/`duration`/
`quality` generically off `job_inputs.params`, with no awareness of where
they came from.

**4. `GET /v1/models/sample-videos` gains a sibling `pixverseVideoPricing`
field** (`apps/api/src/modules/models/routes.ts`), so the client can compute
a live Custom-mode cost preview without a new endpoint or a debounced
network round-trip. Requires extracting the merge-with-defaults logic
already inside `getPixverseVideoCreditCost` (`apps/api/src/lib/resolution-config.ts`)
into its own exported `getPixverseVideoPricingConfig(app): Promise<PixverseVideoPricingConfig>`,
which `getPixverseVideoCreditCost` then calls internally (behavior-preserving
refactor — same merge, same fallback-to-default-on-Redis-error semantics).
Response shape becomes:

```ts
{ items: [...], pixverseVideoPricing: PixverseVideoPricingConfig }
```

The client then calls the already-exported pure `computePixverseVideoCost(duration,
quality, pricing)` from `@aivastra/types` — the exact function the admin
cost-preview UI already uses — so preset and custom cost math can never
drift apart. The server still authoritatively recomputes cost at submit
time in `createCatalogVideoJob`; the client number is cosmetic only.

`/admin/config`'s GET handler (`apps/api/src/modules/admin/config.routes.ts`)
has its own, separate inline merge for the same shape — left as-is; not
this task's concern, and de-duplicating it isn't required for this feature.

### Frontend

**`ImageSource` moves to a new `types.ts`** in the `catalog-video/` directory.
It's currently exported from `CatalogVideoWizard.tsx`, which this task
deletes — `page.tsx`, `SourcePanel.tsx`, and `ConfigPanel.tsx` all need it,
so it gets its own file rather than living in whichever component happens to
define it first.

**`SourcePanel.tsx` gains a "chosen" state.** Once a source is picked
(upload completes, or a catalogue image is selected), the panel shows that
image (blob URL for uploads, `JobThumbnail` for existing jobs) instead of
the empty drag-and-drop prompt, with a small "Change image" control that
clears the source and returns to the empty state. Mirrors the existing
`UploadDropzone` preview+remove pattern already in `CatalogVideoWizard.tsx`.

**New `ConfigPanel.tsx`** replaces the current placeholder `<div>` in
`page.tsx`'s right column. Internal two-step state machine:

```
type ConfigStep = 'select' | 'review';
type ConfigMode = 'preset' | 'custom';
```

- **Disabled state:** when `source` is `null`, the panel renders a dimmed
  placeholder ("Choose a source image to continue") — no mode toggle yet.
- **Select step:**
  - Preset/Custom toggle (pill buttons, same visual style as
    `CatalogVideoWizard`'s existing source-tab toggle).
  - *Preset*: grid of `/v1/models/sample-videos` items — thumbnail, title,
    credit cost — same card layout `CatalogVideoWizard`'s step 2 already
    has. Selecting one stores `{ sampleVideoId }`.
  - *Custom*: a duration number input (`PIXVERSE_DURATION_MIN`–`PIXVERSE_DURATION_MAX`)
    and a quality `<select>` (`PIXVERSE_QUALITIES`), plus a live cost line
    computed via `computePixverseVideoCost(duration, quality,
    pixverseVideoPricing)`. Selecting updates `{ duration, quality }`.
  - "Continue" button (disabled until a preset or a complete custom pair is
    chosen) advances to `review`.
- **Review step:**
  - Small source thumbnail (reuses the same image source SourcePanel now
    shows).
  - Chosen config summary: preset's own preview video + title, or
    "`{duration}s · {quality}`" for custom.
  - Cost line, with the same insufficient-credits check/messaging
    `CatalogVideoWizard` already has (`/v1/credits` balance vs. cost).
  - "Back" returns to `select` (choice is preserved).
  - "Generate video" calls `page.tsx`'s submit handler with either `{
    sampleVideoId }` or `{ duration, quality }`; disabled while submitting
    or over budget, same `Tooltip` pattern as the existing wizard.

**`page.tsx` changes:**
- `wizardSource` is renamed `source` (it's no longer wizard-specific) and
  becomes the single piece of state both `SourcePanel` and `ConfigPanel`
  read.
- A new submit handler posts to `/v1/jobs/catalog-video` with whichever
  shape `ConfigPanel` hands it, invalidates `['catalog-videos']` on success,
  and clears `source` (returning both panels to their empty state) —
  same behavior `CatalogVideoWizard`'s `handleSubmit` has today.
- `CatalogVideoWizard.tsx` import and render block are removed once
  `ConfigPanel` is wired in and verified. The file itself, along with its
  now-unused `initialSource` prop plumbing, is deleted — it has no
  remaining callers after this change. `CataloguePickerModal.tsx` and
  `JobThumbnail.tsx` are unaffected — they're used by `page.tsx` directly
  already, not by the wizard.

## Error handling

- Insufficient credits: computed client-side from the live-preview cost vs.
  `/v1/credits` balance, same as today — disables Generate with a tooltip
  explaining the shortfall, doesn't block navigation.
- Submit failure (network, `ENQUEUE_FAIL`, etc.): shown inline in the review
  step, same message pattern `CatalogVideoWizard.handleSubmit`'s catch block
  already uses. State stays on the review step (nothing resets) so the user
  can retry without re-picking source/config.
- Server-side: the new custom branch reuses every existing guard
  (`isCatalogVideoAllowed`, banned check, atomic credit deduct + refund on
  enqueue failure) — no new failure modes, just a new path into the same
  transaction.

## Testing

`apps/api/test/integration/catalog-video-create.test.ts` gains:
- Custom job creation succeeds, charges `computePixverseVideoCost(duration,
  quality, <default pricing>)`, and the resulting `job_inputs.params` has
  `sampleVideoId: null`, `prompt: PIXVERSE_CUSTOM_VIDEO_PROMPT`, and the
  submitted `duration`/`quality`.
- Rejects `duration` outside 1–15 on the custom path (same boundary the
  admin sample-video schema already enforces).
- Rejects an unrecognized `quality` value on the custom path.
- Rejects a request providing both `sampleVideoId` and `duration`/`quality`
  together.
- Rejects a request providing neither `sampleVideoId` nor a complete
  `duration`+`quality` pair.
- Rejects `duration` without `quality` (and vice versa) when `sampleVideoId`
  is omitted.

`apps/api/test/integration/` (new or existing models test file — check for
one covering `/v1/models/sample-videos` first) gains: the response includes
a `pixverseVideoPricing` field matching the admin-configured (or default)
formula.

No frontend test suite exists for this app today (the wizard itself has
none) — verification stays typecheck + build + lint + manual, consistent
with everything else built on this branch.

## Out of scope (explicitly deferred)

- Admin-configurable custom-mode prompt text (currently a hardcoded
  constant — YAGNI until requested).
- De-duplicating `/admin/config`'s separate inline `pixverseVideoPricing`
  merge against the new `getPixverseVideoPricingConfig` helper.
- Any change to `apps/admin-mobile` (out of scope repo-wide per `CLAUDE.md`).
