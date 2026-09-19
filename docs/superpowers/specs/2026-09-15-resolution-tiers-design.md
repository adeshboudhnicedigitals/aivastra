# Fixed HD/2K/4K resolution tiers

Date: 2026-09-15
Status: Approved, pending implementation plan

## Problem

Output resolution today is a two-step, disconnected system:

1. Admin configures a single platform-wide `maxOutputPx` (ceiling, used only by
   the Studio "custom ratio" path) and a per-ratio pixel table (`aspectDimensions`,
   covering only `1:1`/`2:3`/`3:4`/`4:5` — `9:16`/`16:9` are hardcoded client-side
   only, never admin-editable, and never sent to the server as a named ratio).
2. The server derives an `HD`/`2K`/`4K` *label* after the fact from whatever
   pixel dimensions resulted, via fixed thresholds
   (`resolutionFromDims`: long edge >3000 → 4K, >1200 → 2K, else HD).

Because the admin table's dims never exceed 2688px, every preset ratio always
lands on 2K by construction — 4K is unreachable and HD is unreachable — and this
is called out explicitly in code comments as deliberate at the time
(`packages/types/src/jobs.ts`). Studio shows the resulting tier as a read-only,
non-interactive "Auto" badge; the user never actually picks a resolution.

## Goal

Replace pixel-threshold auto-classification with three fixed, admin-configured
tiers. The admin sets exactly one number per tier — the image's **long edge**,
in pixels — for `HD`, `2K`, and `4K`. The short edge is always derived from the
aspect ratio by formula, for all six ratios uniformly (including `9:16`/`16:9`,
which stop being a client-only special case). The user picks a tier explicitly
in the Studio wizard; that pick drives both price and output size. Free-form/
custom ratio entry uses the same three tiers as a cap on typed width/height.

## Non-goals

- No change to credit-cost-per-tier values or the admin's ability to
  enable/disable a tier — that config already exists and is untouched.
- No change to how credits are deducted, refunded, or how the dispatcher
  patches ComfyUI workflows — both continue to receive a pre-resolved
  `outputWidth`/`outputHeight` on the job row, exactly as today.
- No per-ratio fine-tuning table. The explicit ask that motivated this design
  ("I only need 3 values") rules out keeping a parallel per-ratio override —
  the formula is the single source of truth for the short edge.

## Data model

### Shared formula (`packages/types/src/jobs.ts`)

```ts
export const ASPECT_RATIOS: Record<string, { w: number; h: number }> = {
  '1:1': { w: 1, h: 1 },
  '2:3': { w: 2, h: 3 },
  '3:4': { w: 3, h: 4 },
  '4:5': { w: 4, h: 5 },
  '9:16': { w: 9, h: 16 },
  '16:9': { w: 16, h: 9 },
};

/** Long edge is always the admin's tier value; the short edge is derived from
 *  the ratio. Landscape/square ratios (w >= h) put the tier value on width;
 *  portrait ratios put it on height. */
export function computeOutputDims(
  ratio: string,
  longEdgePx: number,
): { width: number; height: number } {
  const r = ASPECT_RATIOS[ratio];
  if (!r) throw new Error(`Unknown aspect ratio: ${ratio}`);
  return r.w >= r.h
    ? { width: longEdgePx, height: Math.round((longEdgePx * r.h) / r.w) }
    : { width: Math.round((longEdgePx * r.w) / r.h), height: longEdgePx };
}
```

`resolutionFromDims` and `ASPECT_DIMENSIONS` are removed from the primary
computation path. `ASPECT_DIMENSIONS` stays defined (unchanged values) only as
the dispatcher's last-resort fallback (see "Dispatcher" below) — that branch
already logs a warning and is documented as "should never happen."

`RESOLUTION_COSTS` (fallback defaults) and the `Resolution` type are unchanged.

### Admin config shape (`config:system` in Redis)

Before:
```jsonc
{
  "resolutions": { "HD": {"enabled": false, "creditCost": 25}, "2K": {...}, "4K": {...} },
  "maxOutputPx": 2688,
  "aspectDimensions": { "1:1": {"width": 2688, "height": 2688}, "2:3": {...}, "3:4": {...}, "4:5": {...} }
}
```

After:
```jsonc
{
  "resolutions": {
    "HD": {"enabled": false, "creditCost": 25, "longEdgePx": 1536},
    "2K": {"enabled": true,  "creditCost": 35, "longEdgePx": 2688},
    "4K": {"enabled": true,  "creditCost": 40, "longEdgePx": 4096}
  },
  "merchantCatalogResolution": "2K"
}
```

`maxOutputPx` and `aspectDimensions` keys are dropped entirely — not
deprecated-in-place. `merchantCatalogResolution` is new (see "Merchant-catalog
path" below).

Defaults (`apps/api/src/lib/resolution-config.ts`):
- `DEFAULT_RESOLUTION_CONFIG.HD.longEdgePx = 1536`
- `DEFAULT_RESOLUTION_CONFIG['2K'].longEdgePx = 2688` — matches today's de-facto
  output size for every existing preset ratio, so a first read after deploy
  produces the same 2K output as before for anyone who doesn't touch settings.
- `DEFAULT_RESOLUTION_CONFIG['4K'].longEdgePx = 4096`
- `DEFAULT_MERCHANT_CATALOG_RESOLUTION = '2K'`
- `enabled`/`creditCost` defaults unchanged (HD disabled by default, 2K/4K
  enabled, costs 25/35/40).
- `DEFAULT_MAX_OUTPUT_PX`, `DEFAULT_ASPECT_DIMENSIONS`, `mergeAspectDimensions`,
  `getAspectDimensions`, `getMaxOutputPx` are deleted.
- New: `getResolutionTierConfig(app, tier): Promise<{enabled, creditCost, longEdgePx}>`
  — one Redis read/parse, replacing the previous three separate helpers for
  this data (`getResolutionCreditCost` stays as-is for callers that only need
  cost, e.g. the PixVerse video-lane code path is unaffected).

### Zod schema (`packages/types/src/admin.ts`, `SystemConfigBody`)

```ts
const ResolutionConfig = z.object({
  enabled: z.boolean(),
  creditCost: z.number().int().positive().max(1_000),
  longEdgePx: z.number().int().min(512).max(4096),
});

// resolutions: unchanged shape, ResolutionConfig gains the field above.
// maxOutputPx, aspectDimensions: removed.
merchantCatalogResolution: z.enum(['HD', '2K', '4K']).optional(),
```

### Job request schema

`CreateTryOnJobRequest.aspectRatio` widens from
`z.enum(['1:1','2:3','3:4','4:5'])` to all six ratios:
`z.enum(['1:1','2:3','3:4','4:5','9:16','16:9'])`. This is a direct consequence
of the formula covering all six ratios uniformly — `9:16`/`16:9` no longer need
to be smuggled through as `outputWidth`/`outputHeight` custom dims.

`resolution` stays `z.enum(['HD','2K','4K'])`, required — unchanged shape, but
now actually consumed (see below) instead of validated-and-ignored.

The saree-step2 inline body type in `resolveTryonPlan`'s second overload
(`apps/api/src/modules/jobs/create.ts`) gains a `resolution: string` field —
the client (`step2Body` in Studio) already sends it today; only the TS type
was missing it because nothing read it.

## Server trust boundary

Unchanged principle, now actually exercised: the server never trusts a
client-sent pixel number, but it does trust a client-sent *choice* (aspect
ratio, tier) after validating that choice is legitimate. Concretely, in
`resolveTryonPlan`:

1. Read `body.resolution` (already Zod-validated as one of `HD|2K|4K`).
2. `getResolutionTierConfig(app, resolution)` — if `enabled === false`, reject
   with 400 (`BAD_RESOLUTION` or similar) rather than silently substituting
   another tier. This is a new check; today an admin disabling a tier only
   affects what the UI *offers*, not what the server accepts, because the
   server never looked at the client's tier at all.
3. If `isCustomDims` (client sent `outputWidth`/`outputHeight`): clamp both to
   `[512, tierConfig.longEdgePx]` — same clamp shape as today's
   `maxOutputPx`-based logic (`create.ts:301-313`), just keyed off the selected
   tier instead of one global ceiling.
4. Else: `computeOutputDims(aspectRatio, tierConfig.longEdgePx)`.
5. Credit cost: `tierConfig.creditCost` directly (no more re-deriving the tier
   from dims via `resolutionFromDims` — it's already known, it's the input).

This removes one Redis round trip per job (previously: `getAspectDimensions`
*or* `getMaxOutputPx`, then separately `getResolutionCreditCost`) in favor of
one `getResolutionTierConfig` call, cached per-request in `TryonPlanCache`
exactly like the fields it replaces.

`TryonPlanCache` changes: `aspectDimensions: Map<...>` and `maxOutputPx?`
replaced by `resolutionTiers: Map<Resolution, {enabled, creditCost, longEdgePx}>`.

## Merchant-catalog path

`apps/api/src/modules/merchant/create-job.ts` (used by Shopify/merchant
auto-catalog generation) has no per-job tier — it's a background/automated
path with a single admin-fixed `merchantCatalogAspectRatio`. Today it
implicitly always produces 2K because that's what the (now-removed)
`aspectDimensions` table always resolved to. To preserve that behavior
explicitly rather than accidentally, this path reads the new
`merchantCatalogResolution` config (default `2K`) and calls
`computeOutputDims(merchantCatalogAspectRatio, tierConfig.longEdgePx)` the same
way `resolveTryonPlan` does. No admin-UI change beyond exposing this one new
dropdown next to the existing "Merchant Catalog Aspect Ratio" setting.

## Dispatcher

No change. `apps/dispatcher/src/workflow/patcher.ts` already only ever reads
the pre-resolved `outputWidth`/`outputHeight` snapshotted on `job_inputs.params`
by the API at creation time; its `ASPECT_DIMENSIONS` fallback is a defensive
branch for a job that was somehow enqueued without that snapshot ("should never
happen," already logged as a warning) and needs no update — it keeps using the
frozen 4-ratio table as a last-resort default, which is fine since it's not a
real code path today.

## Admin UI (`apps/admin-web/src/pages/SettingsPage.tsx`)

Replace the "Max Output Resolution" field and "Aspect Ratio Sizes" section
(System Configuration card) with one "Resolution Tiers" section: three rows
(HD, 2K, 4K), each with the existing `enabled` toggle and `creditCost` input
plus a new `longEdgePx` input (512–4096, same bounds as today's fields). Add
"Merchant Catalog Resolution" as a new dropdown next to the existing "Merchant
Catalog Aspect Ratio" setting, same section.

Validation (`SettingsPage.tsx` submit guard): each tier's `longEdgePx` must be
an integer in `[512, 4096]` — same pattern as today's `maxOutputPx` check,
duplicated per tier instead of once.

## Studio UI (`apps/catalogues-web`)

The "Output Resolution" section (currently read-only, `stepNumberOf('resolution')`)
becomes a real selector: three pills (HD/2K/4K), each showing its credit cost
from `/v1/config/resolutions`, filtered to `enabled !== false` exactly as
today. Selecting one sets `resolution` state (replacing the current derived
`const resolution = outputDims ? resolutionFromOutputDims(...) : null`).

- **Preset ratio path:** `outputDims = computeOutputDims(effectiveAspect, tierPx[resolution])`,
  imported from `@aivastra/types` (dropping the local `ASPECT_DIMS`/`ASPECT_PX`/
  `resolutionFromOutputDims` duplicates — `apps/catalogues-web` already depends
  on `@aivastra/types`).
- **Custom ratio path:** user still types width/height directly; both inputs'
  max bound becomes `tierPx[resolution]` (replacing today's single
  `maxOutputPx` from `/v1/config/resolutions`), min stays 768. Changing the
  selected tier after typing custom dims re-clamps the existing input the same
  way the aspect-ratio switch already re-derives `customHStr`/`customWStr`
  today.
- A tier must be selected before `canGenerate` is true (today `!!resolution` is
  already part of that check — only its source changes, from derived to
  user-picked, so no new gating logic needed there).
- `/v1/config/resolutions` response drops `maxOutputPx`/`aspectDimensions`,
  keeps `resolutions`. The `resolutionConfigData` query type and its two
  in-component fallback objects (`resolutionConfig`, `RESOLUTION_COSTS`) drop
  the now-gone fields; `maxOutputPx`/`effectiveAspectPx`/`effectiveAspectDims`
  local derivations are deleted along with the client-side hardcoded fallback
  tables they were merged over.

No change to the step ordering swap from the prior session (Platform → Output
Resolution → Aspect Ratio) — the same `SectionHead`/`stepNumberOf` structure is
reused, just with interactive pills instead of a read-only badge. That ordering
is actually a better fit under this design than it was before: resolution
(tier) no longer depends on aspect ratio to compute anything, while aspect
ratio's own output dims now depend on the selected tier — so showing the tier
picker before the ratio picker matches the real data-flow direction.

## Rollout

Hard cut-over — old `maxOutputPx`/`aspectDimensions` config keys are read by
nothing after this ships. `SystemConfigBody` no longer declares them, so a
stale admin browser tab submitting a payload with those keys has them stripped
by Zod at the route boundary before the PATCH handler's `{...cur, ...body}`
merge even runs (confirm `fastify-type-provider-zod`'s default unknown-key
behavior for this schema during implementation — if it turns out to be
passthrough rather than strip, the keys would sit unused in the stored Redis
JSON instead, which is harmless but worth knowing rather than assuming). No
feature flag, no dual-read period — first `GET`/`PATCH /admin/config` after
deploy returns/accepts the new shape via the updated defaults.

## Testing

- `apps/api/test/integration/admin-config.test.ts` — update fixtures for the
  new `resolutions[tier].longEdgePx` field and `merchantCatalogResolution`;
  remove assertions on `maxOutputPx`/`aspectDimensions`.
- New: unit tests for `computeOutputDims` covering all 6 ratios (verify
  orientation — long edge lands on the expected side — and rounding).
- `apps/api/test/integration/saree-mannequin-job.test.ts` — verify step-2's
  `resolution` field is now honored (dims/cost reflect the requested tier, not
  a fixed default).
- New/updated integration case: requesting a disabled tier (e.g. default-off
  HD) returns 400, not a silent fallback.
- New/updated integration case: custom-dims request is clamped to the
  *selected* tier's `longEdgePx`, not a global ceiling — assert two requests
  with identical `outputWidth`/`outputHeight` but different `resolution`
  produce different clamped output dims.
- `apps/dispatcher/src/workflow/patcher.test.ts` — no behavior change expected;
  re-run to confirm the untouched fallback branch still passes.
