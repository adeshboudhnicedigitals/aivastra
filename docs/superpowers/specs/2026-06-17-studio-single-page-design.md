# Studio: Single-Page Redesign

## Context

`apps/web/src/app/(app)/studio/page.tsx` currently implements a 4-step wizard (Setup → Model → Background → Poses) with a `StepBar`, Back/Next/Reset footer, and `step === N` gating on every section. Design mockups in `Two-page design frames/CatalogueScreen.dc.html` show a single-page layout: left scrollable form column with all sections visible, right sticky preview panel, no step indicator.

Goal: merge the 4 steps into one page, with grid sections that show a few cards inline plus a "View More" popup for the full list — extending the pattern the Garment Type section already uses.

## Layout

Two-column layout inside the existing `TopBar` shell:

- **Left column** — scrollable form containing all sections in this order: Catalogue For (gender) → Garment Type → Upload Garment Image(s) → Publishing Platform / Aspect Ratio → Choose Model → Select Background → Choose Poses → Lower Garment (conditional) → Footwear (conditional) → Output Resolution. Pinned footer at the bottom of this column only: Generate button + credit-cost text.
- **Right column** — sticky, static preview panel. Always renders the same empty-state content from the mockup (illustration block, "From product photo to catalogue-ready visuals" copy, 3 benefit bullets, italic footer line). Content does not change based on form state or upload progress.

`StepBar`, the full-width footer bar, the Reset button, and all `step` state are removed.

## Section pattern: inline + "View More" popup

Garment Type already does this: a `ResizeObserver`-driven row (`garmentRowRef`/`garmentVisibleCount`) shows as many cards as fit, with a "View More ›" link opening a modal with the full grid (`garmentModalOpen`).

Apply the identical pattern to:
- **Choose Model** (`faces`) — new `modelRowRef`/`modelVisibleCount` ref pair, new `modelModalOpen` state, modal mirrors the Garment Type modal shell (same grid layout, same selected-card visuals) but lists `faces.items` filtered by `modelFilter`.
- **Select Background** (`backgrounds`) — new `backgroundRowRef`/`backgroundVisibleCount`, new `backgroundModalOpen` state, modal lists `backgrounds.items`.
- **Choose Poses** (`poses`) — new `poseRowRef`/`poseVisibleCount`, new `poseModalOpen` state, modal lists `poses.items`; pose selection is multi-select (checkbox-like toggle, same as today), so the modal must support toggling multiple poses without closing on each click (unlike the single-select Garment Type / Model / Background modals which close on select).

Existing popups stay unchanged: Lower Garment category modal (`lowerCatModal`), Footwear category modal (`shoeCatModal`), Amazon main-image pose picker (`amazonPoseModalOpen`).

## Removing step gating

Every `step === N` / `step >= N` conditional is deleted:

- All sections render unconditionally in the left column, in the order listed above.
- React Query `enabled` flags drop the `step >= N` clause, keeping only the real data dependency:
  - `faces` query: `enabled: !!gender` (was `!!gender && step >= 1`)
  - `backgrounds` query: `enabled: !!gender` (was `!!gender && step >= 2`)
  - `poses` query: `enabled: !!gender` (was `!!(gender && step >= 3)`)
  - `lowerCatalog` / `shoesCatalog` queries: `enabled: needsLower` / `enabled: needsShoes` (drop `step >= 3`)
- The `resolution` default-to-`'HD'` effect (`if (step === 3 && !resolution)`) becomes unconditional: default to `'HD'` once on mount if unset.
- Existing reset cascades when changing gender / garment type / model / background / poses are unchanged — they still clear downstream selections (faceId, backgroundId, poseIds, lowerCatalogId, shoeCatalogId) exactly as today.

## Generate / submit

No behavioral change. `handleSubmit`, `submitAmazonPose`, `canGenerate`, `generateBlocker`, `creditCost`, and the Amazon main-pose-picker modal flow are unchanged — including the post-success `router.push('/catalogues/{catalogueId}')` redirect. The Generate button (currently in the full-width footer) moves into the left column's pinned footer; its disabled/tooltip/loading behavior is unchanged.

## Removed

- `StepBar` import and usage, `step`/`visibleStep` state, `goNext`/`goBack`/`canNext`/`nextBlocker`, the `reset()` function and Reset button, the full-width footer's Back/Next buttons.

## Testing

No backend changes — this is a frontend-only restructuring of one page. Verify manually in the browser per project convention (`pnpm --filter @aivastra/web dev`):

1. All sections visible on page load without needing to click "Next."
2. Each of Garment Type / Model / Background / Pose sections: inline row shows correct count for viewport width, "View More" opens a popup with the full grid, selecting in the popup updates the inline selection state (pose popup supports multi-select without auto-closing).
3. Reset cascades still fire correctly (e.g. changing gender clears garment type/model/background/poses).
4. Lower Garment / Footwear sections appear only when `needsLower`/`needsShoes` are true for selected poses.
5. Generate button disabled states + tooltips match today's blockers (no garment, no poses, no resolution, uploading in progress).
6. Multi-pose Amazon "main listing" flow still opens the pose-picker modal and submits both jobs.
7. Successful generate still redirects to `/catalogues/{catalogueId}`.
8. Right panel renders the static mockup content unchanged regardless of form state.
