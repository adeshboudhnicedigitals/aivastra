# Sample-video content fields become create-only — design

Date: 2026-09-09
Status: approved, pending plan

## Problem

The just-shipped `feat/pixverse-dynamic-duration-quality` branch (pushed, not
yet merged) added Task 12: an admin edit drawer
(`SampleVideoEditDrawer.tsx`) letting an admin change `duration`/`quality`
(and, via `PatchSampleVideoBody`, also `title`/`prompt`/`sortOrder`) on an
existing `sample_videos` row after creation.

This is wrong. A `sample_videos` row's uploaded video is not a PixVerse
*input* — PixVerse's image-to-video endpoint only ever takes
`image + prompt + duration + quality`, and the image always comes from the
end user's own catalogue photo at job-creation time. The video an admin
uploads when creating a sample-video template is a **preview clip**: a real
PixVerse output, generated once, showing what a user's photo will look like
after animation with that exact `prompt` + `duration` + `quality`. Editing
any of those fields after the fact leaves the stored preview showing a
result the template no longer actually produces — the preview and the
generation params silently drift apart with no way to detect it later.

## Decision

`sample_videos` rows become **create-new + delete only** for every field that
was used to generate the preview clip — `title`, `prompt`, `duration`,
`quality`. To change any of them, an admin deletes the row and uploads a new
template with a fresh preview video that actually matches the new params.
(Task 12's original justification — that legacy rows would be "stranded" at
the DB default forever — doesn't hold: the default (`8`/`'720p'`) is exactly
what the dispatcher hardcoded before this branch, so legacy previews are
accurate for what they show, not stale.)

**Amended 2026-09-09 (post-review):** `sortOrder` stays patchable. It's pure
display ordering — never a PixVerse generation input — so locking it wasn't
actually justified by this design's own rationale, and doing so removed the
only way to reorder the Catalog Video wizard's template list (no
delete+reupload workaround, since a fresh create can't reproduce another
row's exact preview video). See Change 2 below for the corrected schema.

The one exception: `isActive`. Retiring a template from the catalogue picker
without deleting its history doesn't touch the preview/prompt/duration/
quality relationship at all, so it stays editable — this is the existing
toggle already wired to its own PATCH call, untouched by this change.

This does not introduce a new entity. "Preset" (the term that opened this
conversation) turned out to mean the existing `sample_videos` table itself,
not a separate concept — this design corrects that table's lifecycle, not
its shape. The DB schema, the create flow, the duration/quality formula
pricing (`computePixverseVideoCost`), and the `CatalogVideoWizard.tsx`/
dispatcher consumers are all unaffected.

## Changes

### 1. Remove the edit drawer

- Delete `apps/admin-web/src/components/SampleVideoEditDrawer.tsx` (added in
  Task 12, commit `e2d3676f`) entirely.
- `apps/admin-web/src/pages/assets/SampleVideosTab.tsx`: remove the
  `editingItem` state, the `<SampleVideoEditDrawer>` render block, and the
  "Edit" button (`<Icon.Edit /> Edit`) from each card's action row. The
  `Switch`/`toggle()` active-state code path is untouched.

### 2. Narrow `PatchSampleVideoBody`

`packages/types/src/admin.ts`'s `PatchSampleVideoBody` drops `title`,
`prompt`, `duration`, `quality` — `isActive` and `sortOrder` stay, both
optional (per the 2026-09-09 amendment above, neither is a PixVerse
generation input, so neither can cause the preview/params desync this design
exists to prevent):

```ts
export const PatchSampleVideoBody = z.object({
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
```

**Validation behavior:** this repo's Zod schemas have no `.strict()`
precedent anywhere (checked — none exist in `packages/types/src`), so this
schema does not introduce one either. A PATCH body that still includes
`duration`/`quality`/etc. is not rejected with 400 — Zod's default
strip-unknown-keys behavior silently drops those fields, and the request
succeeds as a no-op on them (only `isActive`, if present, applies). No admin
UI sends those fields anymore after Change 1, so this path is only reachable
via a direct API call, and its worst case is a confusing no-op, not a data
integrity problem — the row's content fields genuinely cannot change through
this endpoint.

`apps/api/src/modules/admin/models.routes.ts`'s PATCH handler
(`/admin/assets/sample-videos/:id`) needs no logic change — it already just
spreads the validated body onto the update — its effective behavior narrows
automatically once the schema does.

### 3. Update tests

`apps/api/test/integration/admin-sample-videos.test.ts`:

- The existing test titled `'accepts explicit duration/quality on create and
  allows patching both'` (line 111) has its PATCH assertion inverted: after
  `PATCH { duration: 5, quality: '360p' }`, the row's `duration`/`quality`
  must be **unchanged** from what was set at creation (`12`/`'1080p'`) — the
  fields are silently ignored, not applied. Rename the test to reflect this
  (e.g. `'creates with explicit duration/quality; patch cannot change
  them'`).
- No new test is needed for `title`/`prompt` PATCH rejection beyond the same
  silent-no-op assertion pattern, since both removed fields go through the
  identical Zod strip mechanism as `duration`/`quality` — one representative
  case (duration/quality) plus a note is sufficient; duplicating the same
  assertion for every removed field adds no coverage.
- The first test (`'presign -> confirm -> list -> patch -> delete'`, line
  24) already PATCHes only `{ isActive: false }` — no change needed there.
- **Amended 2026-09-09:** since `sortOrder` stays patchable (see Decision
  above), the same test that proves `duration`/`quality` are no-ops also
  gains a positive assertion — `PATCH { sortOrder: 5 }` on the same row,
  re-read from Postgres, must show `sortOrder === 5` — proving the field
  genuinely still works, not just that it wasn't accidentally locked too.

## Out of scope

- Any change to `sample_videos`' DB schema/migrations — columns stay exactly
  as they are, this is an API/UI-layer restriction only.
- Any change to the create flow (`SampleVideoUploadModal.tsx`,
  `ConfirmSampleVideoBody`, the presign flow).
- Any change to pricing (`computePixverseVideoCost`,
  `getPixverseVideoCreditCost`, the Job Costs formula UI).
- Any change to `CatalogVideoWizard.tsx` or the dispatcher.
- Introducing `.strict()` as a repo-wide Zod convention — this design
  doesn't establish that pattern, only notes its absence explains the
  no-op-not-400 behavior above.

## Testing

- `apps/api/test/integration/admin-sample-videos.test.ts` — updated per
  Change 3 above.
- Manual/visual verification of the admin UI change (no Edit button, drawer
  file gone) is straightforward enough not to need dedicated automated
  coverage beyond a typecheck/build pass — matches this repo's existing
  practice for other admin-web-only removals.
