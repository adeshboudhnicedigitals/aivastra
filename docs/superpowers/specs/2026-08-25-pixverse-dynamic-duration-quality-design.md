# PixVerse dynamic duration & quality — design

Date: 2026-08-25 (revised same day — see "Revision note")
Status: approved, pending plan

## Problem

`apps/dispatcher/src/pixverse/client.ts` hardcodes every catalog-video job to
`duration: 8, quality: '720p'` when calling PixVerse's image-to-video endpoint.
PixVerse actually supports a range of durations and quality tiers depending on
model version. We want per-template control instead of one fixed value, and
admin-managed pricing that reflects PixVerse's own cost variance.

## Revision note

The first pass of this spec sourced duration/quality constraints from
PixVerse's ComfyUI partner-node source, which only implements the
conservative subset (`duration: 5 | 8`, `quality: ..., 1080p only at 5s`).
That is **not what PixVerse's real API supports for the model we use**.
Pulling PixVerse's own OpenAPI spec text verbatim corrected this:

> "Video duration — v3.5/v4/v4.5: 5/8 (v3.5 1080p cannot use 8) — v5: 5/8 —
> v5.5/v5.6: 5/8/10 (1080p cannot use 10) — **v6/c1: 1~15**"

Our client hardcodes `model: 'v6'`. For v6, duration is **any integer from 1
to 15 seconds**, at any of the 4 quality tiers, with **no documented 1080p
cutoff** (unlike v3.5 and v5.5/v5.6, which do have one). Everything below
reflects this corrected range, not the original 5/8-only draft.

## PixVerse API constraints (verified, v6)

Verified against PixVerse's own OpenAPI spec text for
`/openapi/v2/video/img/generate`:

- `duration`: integer, `1–15` (seconds).
- `quality`: `'360p' | '540p' | '720p' | '1080p'`.
- No cross-constraint between them for v6/c1 — every duration × quality pair
  is valid.
- `model` stays hardcoded at `'v6'` — out of scope for this change. (Other
  model versions have narrower/cross-constrained ranges — irrelevant here
  since we never send a different model value.)

## Where duration/quality are set

Per-**sample-video template**, not globally and not user-selectable at
request time. `sample_videos` is the existing admin-curated table (title,
prompt, video/thumbnail keys) a user picks from in the Catalog Video wizard;
duration and quality become two more admin-set fields on that same row,
alongside `prompt`. Different templates (a quick 5s spin vs. a 15s runway
walk) can use different lengths/quality.

## Data model

Migration adds to `sample_videos`:

```sql
ALTER TABLE sample_videos
  ADD COLUMN duration integer NOT NULL DEFAULT 8,
  ADD COLUMN quality text NOT NULL DEFAULT '720p',
  ADD CONSTRAINT sample_videos_duration_valid CHECK (duration BETWEEN 1 AND 15),
  ADD CONSTRAINT sample_videos_quality_valid CHECK (quality IN ('360p','540p','720p','1080p'));
```

Defaults (`8`, `'720p'`) backfill existing rows to match today's hardcoded
behavior exactly — no behavior change for existing templates until an admin
edits them. No combo-validity constraint is needed (unlike the original
draft) since v6 has no invalid duration×quality pairing. The two `CHECK`
constraints are defense-in-depth alongside Zod validation at the API layer.

## Credit cost

A fixed per-combo pricing table doesn't scale to 15 × 4 = 60 possible
combinations, so cost is computed by **formula** instead of a lookup table:

```
creditCost = ceil(qualityBase[quality] + duration * perSecondRate)
```

Managed in the existing admin **Settings → Credit Plans → Job Costs** page
(`JobCostsTab.tsx`) as a new "Catalog Video Pricing" section, replacing
today's single flat "Catalog Video" cost row:

- 4 number inputs — one base credit cost per quality tier (`360p`, `540p`,
  `720p`, `1080p`).
- 1 number input — credits charged per second of duration, added on top of
  the quality base.

- New `config:system` Redis key: `pixverseVideoPricing`:
  `{ perSecondRate: number, qualityBase: { '360p': number, '540p': number, '720p': number, '1080p': number } }`.
- **Clean cutover**: the old flat `pixverse.creditCost` field, its
  `DEFAULT_PIXVERSE_CONFIG`, and `getPixverseCreditCost()` are removed
  entirely — no fallback path. `DEFAULT_PIXVERSE_VIDEO_PRICING` seeds
  `qualityBase` at today's flat cost (150) for every tier and `perSecondRate`
  at `0`, so an existing 8s/720p template still prices at exactly 150 until
  an admin tunes the formula. All video-generation credit cost configuration
  lives exclusively in this admin page, matching every other job-cost knob
  in this repo.
- The formula itself — `computePixverseVideoCost(duration, quality, config)`
  — lives once in `packages/types/src/jobs.ts` as a pure function, so the API
  resolver and the admin-web live cost preview (see below) can't drift.
- A new `getPixverseVideoCreditCost(app, duration, quality)` replaces
  `getPixverseCreditCost(app)`: reads `cfg.pixverseVideoPricing` (falling
  back to `DEFAULT_PIXVERSE_VIDEO_PRICING` if unset/malformed — same
  try/catch-and-default pattern as every other resolver in
  `resolution-config.ts`), then calls `computePixverseVideoCost`. Result is
  floored at 1 credit.

## API changes

- `packages/types/src/jobs.ts`:
  - `PIXVERSE_DURATION_MIN = 1`, `PIXVERSE_DURATION_MAX = 15`.
  - `PIXVERSE_QUALITIES = ['360p', '540p', '720p', '1080p'] as const`.
  - `computePixverseVideoCost(duration, quality, config)` — the shared
    formula above, exported so both API and admin-web use one
    implementation.
- `packages/types/src/admin.ts`:
  - `ConfirmSampleVideoBody` gains `duration: z.number().int().min(1).max(15)`
    and `quality: z.enum(PIXVERSE_QUALITIES)` (both required). No `.refine`
    needed — every combo is valid.
  - `PatchSampleVideoBody` gains the same two fields, both optional.
  - `SystemConfigBody.pixverse` is removed; replaced by
    `pixverseVideoPricing: z.object({ perSecondRate: z.number().min(0).max(100), qualityBase: z.object({ '360p': ResolutionConfig-style number, ... }) }).optional()`.
- `apps/api/src/modules/admin/models.routes.ts` (sample-video CRUD): pass
  `duration`/`quality` through on create and patch — no merge-and-validate
  step needed now that every combo is valid (simpler than the original
  draft's cross-field check).
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

- `SampleVideoUploadModal.tsx`: replace the (nonexistent today) fixed
  duration choice with a **numeric input, 1–15**, and a quality **dropdown**
  (4 tiers). No cross-field filtering needed — every combo is valid for v6.
  A live cost preview (using the same `computePixverseVideoCost` helper,
  fed the current admin pricing config) shows the admin what this template
  will cost as they type. `PatchSampleVideoBody` allows editing both fields
  on existing templates.
- `SampleVideosTab.tsx`: show each card's duration/quality (e.g. "12s ·
  1080p") alongside the existing title/prompt.
- `JobCostsTab.tsx`: new "Catalog Video Pricing" section replacing today's
  single "Catalog Video" cost row — 4 quality-base inputs + 1 per-second-rate
  input, per the formula above.

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
  with duration (1–15 boundary values) and quality, out-of-range rejection.
- `apps/api/test/integration/sample-videos-public.test.ts` — per-item
  `creditCost` in the list response, computed via the formula.
- `apps/api/test/integration/catalog-video-create.test.ts` — job charged the
  formula-computed cost for the specific sample video's duration/quality,
  not the old flat cost.
- `apps/dispatcher/test/integration/catalog-video.test.ts` /
  `video-lane.test.ts` — PixVerse request body carries the job's
  duration/quality instead of hardcoded 8/720p.
- New unit test for `computePixverseVideoCost` covering boundary values
  (duration=1, duration=15, each quality tier) and rounding behavior.
