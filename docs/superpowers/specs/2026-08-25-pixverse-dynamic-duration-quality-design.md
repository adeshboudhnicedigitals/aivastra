# PixVerse dynamic duration & quality — design

Date: 2026-08-25
Status: approved, pending plan

## Problem

`apps/dispatcher/src/pixverse/client.ts` hardcodes every catalog-video job to
`duration: 8, quality: '720p'` when calling PixVerse's image-to-video endpoint.
PixVerse actually supports multiple durations and quality tiers, with a hard
constraint between them. We want per-template control instead of one fixed
value, and admin-managed pricing that reflects PixVerse's own cost variance.

## PixVerse API constraints (verified)

Confirmed via PixVerse's own ComfyUI partner-node source
(`comfy_api_nodes/apis/pixverse.py`, `nodes_pixverse.py` in `Comfy-Org/ComfyUI`),
which mirrors the real `/openapi/v2/video/img/generate` request shape:

- `duration`: `5 | 8` (seconds) — no other values accepted.
- `quality`: `'360p' | '540p' | '720p' | '1080p'`.
- **Constraint: `quality === '1080p'` forces `duration === 5`.** PixVerse
  rejects 1080p at 8 seconds. This yields exactly **7 valid combinations**
  (all of 360p/540p/720p at 5s and 8s, plus 1080p at 5s only).
- `model` stays hardcoded at `'v6'` — out of scope for this change.

## Where duration/quality are set

Per-**sample-video template**, not globally and not user-selectable at request
time. `sample_videos` is the existing admin-curated table (title, prompt,
video/thumbnail keys) a user picks from in the Catalog Video wizard; duration
and quality become two more admin-set fields on that same row, alongside
`prompt`. Different templates (a quick spin vs. a longer runway walk) can use
different lengths/quality.

## Data model

Migration adds to `sample_videos`:

```sql
ALTER TABLE sample_videos
  ADD COLUMN duration integer NOT NULL DEFAULT 8,
  ADD COLUMN quality text NOT NULL DEFAULT '720p',
  ADD CONSTRAINT sample_videos_duration_valid CHECK (duration IN (5, 8)),
  ADD CONSTRAINT sample_videos_quality_valid CHECK (quality IN ('360p','540p','720p','1080p')),
  ADD CONSTRAINT sample_videos_combo_valid CHECK (NOT (quality = '1080p' AND duration = 8));
```

Defaults (`8`, `'720p'`) backfill existing rows to match today's hardcoded
behavior exactly — no behavior change for existing templates until an admin
edits them. The three `CHECK` constraints are defense-in-depth alongside Zod
validation at the API layer (matches this repo's pattern elsewhere of
validating at every layer that can reach the DB).

## Credit cost

Cost genuinely differs by duration/quality on PixVerse's side, so a single
flat `pixverse.creditCost` (today's model) is replaced by a **7-row pricing
matrix**, one row per valid combo, managed in the existing admin **Settings →
Credit Plans → Job Costs** page (`JobCostsTab.tsx`) as a new section —
structurally identical to the existing "Resolution Pricing" table (HD/2K/4K
rows, each with an `enabled` toggle and a `creditCost` input).

- New `config:system` Redis key: `pixverseVideoPricing`, keyed by literal
  combo strings (`'5_360p'`, `'5_540p'`, `'5_720p'`, `'5_1080p'`, `'8_360p'`,
  `'8_540p'`, `'8_720p'`) — 7 fixed optional fields, same shape as
  `SystemConfigBody.resolutions` (not a free-form `z.record`).
- **Clean cutover**: the old flat `pixverse.creditCost` field, its
  `DEFAULT_PIXVERSE_CONFIG`, and `getPixverseCreditCost()` are removed
  entirely — no fallback path. `DEFAULT_PIXVERSE_VIDEO_PRICING` seeds every
  combo at today's flat cost (150) so nothing changes until an admin adjusts
  a row. All video-generation credit cost configuration lives exclusively in
  this admin page, matching every other job-cost knob in this repo.
- `enabled: false` on a combo removes it from the choices offered in the
  admin sample-video duration/quality pickers (SampleVideoUploadModal) — an
  admin cannot build a template using a combo that isn't priced/allowed.
- A new `getPixverseVideoCreditCost(app, duration, quality)` replaces
  `getPixverseCreditCost(app)`, reading `cfg.pixverseVideoPricing[comboKey]`
  and falling back to `PIXVERSE_VIDEO_COST` (150) if unset/malformed — same
  try/catch-and-default pattern as every other resolver in
  `resolution-config.ts`.

## API changes

- `packages/types/src/jobs.ts`: add `PIXVERSE_DURATIONS = [5, 8] as const`,
  `PIXVERSE_QUALITIES = ['360p','540p','720p','1080p'] as const`,
  `PIXVERSE_VIDEO_COMBOS` (the 7 valid `{duration, quality}` pairs), and a
  `pixverseComboKey(duration, quality)` helper (`` `${duration}_${quality}` ``)
  shared by both the API resolver and the admin UI so the key format has one
  definition.
- `packages/types/src/admin.ts`:
  - `ConfirmSampleVideoBody` gains `duration`/`quality` fields (required,
    validated against the enums) with a `.refine` rejecting the 1080p+8
    combo.
  - `PatchSampleVideoBody` gains the same two fields, both optional (partial
    update). Because a PATCH body may change only one of the two fields, the
    cross-field 1080p+8 check can't live in the Zod schema alone — the route
    handler merges the patch onto the existing row and re-validates the
    resulting combo before writing, returning `400` on an invalid result.
  - `SystemConfigBody.pixverse` is removed; replaced by
    `pixverseVideoPricing` with the 7 fixed optional combo fields (each
    `{enabled, creditCost}`, same shape as today's `ResolutionConfig`).
- `apps/api/src/modules/admin/models.routes.ts` (sample-video CRUD): pass
  `duration`/`quality` through on create; merge-and-validate on patch as
  above.
- `apps/api/src/modules/models/routes.ts`
  (`GET /v1/models/sample-videos`, the Studio-facing list): currently
  returns one top-level `creditCost` for the whole list. Changes to a
  **per-item** `creditCost`, computed per row via
  `getPixverseVideoCreditCost(app, row.duration, row.quality)`.
- `apps/api/src/modules/jobs/create.ts` (`createCatalogVideoJob`): reorder so
  the sample-video row loads first, then price via its own
  `(duration, quality)` — today it prices before the sample video is even
  looked up. The resolved `duration`/`quality` are copied onto
  `job_inputs.params` (immutable snapshot at creation time, same pattern as
  `prompt` today) so the dispatcher never has to re-look-up the template.

## Dispatcher changes

- `apps/dispatcher/src/pixverse/client.ts`: `createVideoTask()` takes
  `duration: number` and `quality: string` parameters instead of hardcoding
  `duration: 8, quality: '720p'` in the request body.
- `apps/dispatcher/src/job/processor.ts` (`processVideoJob`): reads
  `rawParams.duration` / `rawParams.quality` (same way it already reads
  `rawParams.prompt` / `rawParams.sourceImageKey`) and passes them through.
  No re-validation needed here — the dispatcher trusts the resolved job
  input the same way it already trusts resolved R2 keys (existing invariant:
  "Catalog ID → R2 key resolution happens in api before enqueue... The
  dispatcher trusts the resolved keys").

## Admin UI changes

- `SampleVideoUploadModal.tsx`: add a duration selector (5s / 8s) and a
  quality selector (360p/540p/720p/1080p), both filtered to only the
  `enabled` combos from `GET /admin/config`. Picking 1080p auto-forces
  duration to 5s and disables the 8s option (client-side mirror of the
  server-side constraint — belt and suspenders, not a substitute for it).
  `PatchSampleVideoBody` allows editing both fields on existing templates.
- `SampleVideosTab.tsx`: show each card's duration/quality (e.g. "8s ·
  720p") alongside the existing title/prompt.
- `JobCostsTab.tsx`: new "Catalog Video Pricing" section replacing today's
  single "Catalog Video" cost row — a 7-row table (one per valid combo),
  structurally identical to the existing Resolution Pricing table above it.

## Web UI changes (`CatalogVideoWizard.tsx`)

- `GET /v1/models/sample-videos` response type changes from
  `{ creditCost: number; items: [...] }` to `{ items: [...with creditCost per item] }`.
- The "N credits required" banner currently shown before template selection
  moves to appear only **after** a template is picked, reading
  `selectedSample.creditCost`. Each template card in the picker grid also
  shows its own cost badge, so differing prices are visible before picking.
- `insufficientCredits` is recomputed from the selected sample's cost instead
  of a single global value.

## Out of scope

- `model` parameter (stays hardcoded `'v6'`).
- User-facing duration/quality selection at request time — this is admin
  template curation, not a per-job customer choice.
- `apps/admin-mobile` (repo-wide: paused, out of scope for any task).

## Testing

Existing integration coverage to extend, not replace:

- `apps/api/test/integration/admin-sample-videos.test.ts` — create/patch
  with duration/quality, invalid-combo rejection (both on create and on a
  patch that produces an invalid combo).
- `apps/api/test/integration/sample-videos-public.test.ts` — per-item
  `creditCost` in the list response.
- `apps/api/test/integration/catalog-video-create.test.ts` — job charged the
  matrix cost for the specific sample video's combo, not the old flat cost.
- `apps/dispatcher/test/integration/catalog-video.test.ts` /
  `video-lane.test.ts` — PixVerse request body carries the job's
  duration/quality instead of hardcoded 8/720p.
