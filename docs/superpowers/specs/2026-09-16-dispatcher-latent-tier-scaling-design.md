# Dispatcher latent canvas scales with resolution tier — design

**Date:** 2026-09-16
**Status:** Approved, ready for implementation plan
**Related:** `docs/superpowers/specs/2026-09-15-resolution-tiers-design.md` (the HD/2K/4K
tier feature this extends), `docs/progress.md`'s 2026-09-16 entry

## Problem

The HD/2K/4K resolution-tier feature (shipped 2026-09-16, see the linked spec/plan)
deliberately left `apps/dispatcher/src/workflow/patcher.ts` untouched — the dispatcher
only ever reads a pre-resolved `outputWidth`/`outputHeight` off the job, and the
original design spec explicitly declared "no change to how the dispatcher patches
ComfyUI workflows" a non-goal.

Reading `patcher.ts`'s dual-size-group branch afterward surfaced a real gap in what
that decision actually means in practice. For "dual-size-group" workflow templates —
ones with a separate latent-canvas node pair (`latentSizeNodeIds`, informally
"max-width/max-height") distinct from the final-output node pair
(`outputSizeNodeIds`, "result-width/result-height") — the latent canvas is computed as:

```ts
const latentMax = tmpl.latentMaxPx ?? 2048;
const latentDims = resizeToMax(outputDims.width, outputDims.height, latentMax);
```

`resizeToMax(width, height, max)` **unconditionally sets the long edge to exactly
`max`** — it is not a ceiling, it is a forced target. So every job on a dual-group
template renders its diffusion latent at exactly `template.latentMaxPx` (2048px by
default), regardless of which resolution tier was requested. HD, 2K, and 4K jobs on
the same template diffuse **identically** — the only difference between tiers is the
final resize/pad step that stretches the same rendered content to a different
delivered pixel size. Picking 4K over 2K currently buys a bigger file, not more
rendered detail.

Verified empirically during the resolution-tiers rollout: a real 4K, 2:3-ratio job
completed successfully specifically *because* the odd derived dimension (2731×4096)
only ever touched a final `ResizeAndPadImage` node, never the latent grid — which is
this exact behavior, observed from the outside.

## Goal

Make the latent canvas scale with the tier's resolved output size, capped by the
template's own technical ceiling — so a higher tier can actually render more detail,
not just deliver a bigger file — **without** adding any new admin config, schema
change, or API/job-creation change. Pure dispatcher-side logic.

## Non-goals

- No new per-tier admin config for latent sizing. The already-existing,
  already-admin-editable per-template `latentMaxPx` column becomes a true ceiling
  instead of today's flat forced value; that is the only "knob" this design uses.
- No change to legacy single-group templates (`sizeNodeIds`, no separate
  latent/output node split). Those already patch `EmptyLatentImage` directly with the
  full requested `outputDims` — i.e. their latent already scales 1:1 with the tier
  today, uncapped. That path's lack of any ceiling is a separate, pre-existing
  question, out of scope here (explicitly deferred, not overlooked).
- No change to the API, job-creation, or admin-web layers. `job_inputs.params` still
  only ever carries `outputWidth`/`outputHeight` — no new field is added or needed.
- No change to `resizeToMax`'s own contract (`patcher.ts` is its only caller) — this
  design only changes what value is passed in as its `max` argument.

## Mechanism

The dispatcher never needs to know which named tier (HD/2K/4K) was selected — it
already receives the final resolved `outputWidth`/`outputHeight` on the job, and for
every job-creation path (interactive Studio, saree-mannequin, merchant-catalog) that
value's long edge is already exactly the selected tier's `longEdgePx` (named-ratio
path) or clamped to it (custom-dims path). So the tier's long edge is simply
`Math.max(outputDims.width, outputDims.height)` — already in hand.

In `apps/dispatcher/src/workflow/patcher.ts`, inside `applyWorkflowPatch`'s dual-size-group branch (currently ~line 186-188):

```ts
const latentMax = tmpl.latentMaxPx ?? 2048;
const latentDims = resizeToMax(outputDims.width, outputDims.height, latentMax);
```

becomes:

```ts
// The latent target is the request's own resolved long edge (already tier-derived
// by the API before enqueue — computeOutputDims puts the tier's longEdgePx on the
// long edge for a named ratio, or the custom-dims clamp does for a custom one),
// never exceeding this template's own technical ceiling. Previously every tier
// rendered at the same flat latentMaxPx; now a smaller-tier request (e.g. HD)
// renders a smaller, cheaper/faster latent, and a larger-tier request renders up to
// whatever ceiling this template's admin has configured — no per-tier admin config
// needed, since the tier is already baked into outputDims by the time the
// dispatcher sees it.
const requestedLongEdge = Math.max(outputDims.width, outputDims.height);
const latentMax = Math.min(requestedLongEdge, tmpl.latentMaxPx ?? 2048);
const latentDims = resizeToMax(outputDims.width, outputDims.height, latentMax);
```

Both `resizeToMax`'s signature and its single call site's surrounding structure are
unchanged; only the value fed in as `max` changes from a flat constant to
`min(requested long edge, template ceiling)`.

## Behavior change, stated explicitly

Before this change, every tier (HD included) rendered its latent at the full
`template.latentMaxPx`. After this change:

- **HD requests get a smaller latent than before** — HD's own resolved long edge
  (1536px by the default admin config) is below the typical 2048px template ceiling,
  so HD renders render faster/cheaper than they used to, not merely cost fewer
  credits. This is a genuine behavior change worth calling out, though low blast
  radius today since HD ships disabled by default.
- **2K/4K requests are unchanged unless an admin raises that template's
  `latentMaxPx`.** With the default 2048px ceiling, 2K (2688 long edge) and 4K (4096
  long edge) both still clamp to 2048 — identical to today. To make a template
  actually render more detail at higher tiers, an admin raises that template's
  `latentMaxPx` column above 2048 via the existing workflow edit UI (no new UI
  needed — this column has been admin-editable since before this design).
- **Custom dims below any tier's ceiling behave the same way** — a small custom
  request (e.g. 900×900) now renders its latent at 900, not forced up to 2048, since
  `requestedLongEdge` is derived from the already-clamped `outputDims`, exactly as
  for named ratios.

## Testing

`apps/dispatcher/src/workflow/patcher.test.ts`'s existing `'dual-size groups'` describe
block already has one relevant case (`'patches the latent group via resizeToMax, and
the output group via the literal ASPECT_DIMENSIONS lookup'`, using `aspectRatio:
'2:3'` with no custom dims, `latentMaxPx: 2048`). Verified by hand: that case's
requested long edge (2688, from `ASPECT_DIMENSIONS['2:3']`) already exceeds
`latentMaxPx` (2048), so `min(2688, 2048) = 2048` — **this existing test's assertions
are unaffected by this change** and need no edit.

New cases to add, all in the same describe block:

1. A request whose long edge is *below* the template's `latentMaxPx` (simulating an
   HD-tier request via custom `outputWidth`/`outputHeight`, e.g. 1152×1536 with
   `latentMaxPx: 2048`) — assert the latent group's dims equal the request's own long
   edge (1536), not the template ceiling (2048). This is the case no existing test
   covers and is the entire point of this change.
2. A request whose long edge exceeds a *lowered* template ceiling (e.g. custom
   3000×4000 with `latentMaxPx: 1024`) — assert the latent group clamps to 1024, not
   the request's long edge. Confirms the ceiling still binds when a template is
   configured conservatively.
3. A request whose long edge exceeds a *raised* template ceiling (e.g. custom
   3000×4000 with `latentMaxPx: 3072`, simulating an admin who tuned a template for
   higher-detail 4K output) — assert the latent group renders at the request's own
   long edge (3000, since it's below the raised 3072 ceiling), not the old flat
   2048/3072 value. Confirms raising `latentMaxPx` actually changes rendered output,
   which was not true before this change (it was always forced to exactly
   `latentMaxPx` regardless of what was requested).
4. Legacy single-group behavior (`sizeNodeIds`) — no new test needed; this path is
   untouched, existing coverage stands as regression evidence.

No changes needed to `apps/api` or any other package/app's tests — this is entirely
contained within `apps/dispatcher`.

## Rollout

Hard cutover, consistent with this repo's "no compat shims" convention — no feature
flag. This is a pure dispatcher behavior change with no schema, API, or client-facing
surface, so there is nothing to migrate and no external contract to version.
