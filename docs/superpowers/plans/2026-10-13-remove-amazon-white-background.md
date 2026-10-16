# Remove the Amazon white-background override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop swapping the seller's chosen background for the admin-tagged white background when a try-on request says `platform: 'Amazon'`, and remove the dormant studio code that existed only to drive that swap.

**Architecture:** Logic removal only (spec D30). The api's override in `resolveTryonPlan` goes; `platform` is still accepted and still stored in `job_inputs.params` (catalog previews and listings read it). The admin `isWhiteBg` tag, its column and its admin UI stay — no migration. Two places that branch on `params.platform === 'Amazon'` downstream (the dispatcher's log label and the admin job-detail background key) are simplified to the single path the dispatcher already uses.

**Tech Stack:** Fastify/TypeScript api, dispatcher, Next.js catalogues-web, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md`, D30 (and D23 for why the bot never depended on it). This plan is plan 4 of the WhatsApp work but independent of plans 1–3; it can ship alone, before or after them.

## Who this changes things for

The web studio already stopped triggering the override: `amazonUseWhiteBg` is hard-wired to `false` (`studio/page.tsx:472-473`, "Bypassed: Amazon no longer forces white bg"), so the web sends no `platform` for Amazon. **The override is still live for:**

- the **Android catalogue app** (`apps/catalogue_android`), which sends the selected platform (`studio_repository.dart:162-199`; Amazon is in its platform list), and
- **batch jobs** (`apps/api/src/modules/jobs/createBatch.ts:163` passes `body.platform` through).

After this change, an Amazon job from those clients uses **the background the seller picked**, like every other platform. That is the intended product change (D30), but it is visible to Android users: say so in the release note. `apps/admin-mobile` is paused and out of scope.

| | Developers | Users |
|---|---|---|
| Keep the override, delete only the dormant web code | Smaller diff | Android/batch Amazon jobs keep ignoring the chosen background; web and Android disagree |
| **Remove the override (this plan)** | One branch fewer in `resolveTryonPlan`; two downstream branches simplified | Every client gets the background it chose; Amazon sellers wanting white pick the white background themselves |

## Global Constraints

- Logic only: **do not** drop `model_backgrounds.is_white_bg`, its admin toggle (`admin/models.routes.ts`, admin-web), its `@aivastra/types` fields, or the RecycleBin column. No migration.
- `platform` stays in `CreateTryOnJobRequest` and keeps being written to `job_inputs.params`.
- Don't touch `catalogs/[id]/preview/templates.tsx` — its Amazon chrome is a pixel-faithful listing mockup (CLAUDE.md), unrelated to this rule.
- Comment the *why*; match surrounding code. No `console.log`.
- Integration tests need `pnpm docker:up`.

## File structure

| File | Change |
|---|---|
| `apps/api/src/modules/jobs/create.ts` | delete the override block (~lines 433–466) and fix the comment at ~line 1327 |
| `apps/api/test/integration/jobs-create-looks.test.ts` | the legacy-form test now asserts **no** override |
| `apps/dispatcher/src/job/processor.ts` | drop `isAmazon` (~lines 613–616); log label only |
| `apps/api/src/modules/admin/jobs.routes.ts` | drop `isAmazon` (~lines 412–417); mirror the dispatcher's key |
| `apps/catalogues-web/src/app/(app)/studio/page.tsx` | remove dormant Amazon-main-image state, function, modal; send `platform` as chosen |
| `docs/progress.md` | entry |

---

### Task 1: API — remove the override (test first)

**Files:**
- Modify: `apps/api/test/integration/jobs-create-looks.test.ts` (the test at ~line 894)
- Modify: `apps/api/src/modules/jobs/create.ts`

- [ ] **Step 1: Flip the legacy-form test**

Open `apps/api/test/integration/jobs-create-looks.test.ts` and find the test `'legacy backgroundId+poseIds form still applies the Amazon white-bg override'` (~line 894). Rename it and invert its final assertion. Keep its setup (it seeds a white background and sends `platform: 'Amazon'`), so it proves the white background exists **and** is ignored:

```ts
  it('legacy backgroundId+poseIds form keeps the chosen background for Amazon (D30)', async () => {
```

and replace

```ts
    expect(inputsRow?.backgroundId).toBe(whiteBg.id);
```

with the background the request actually sent. Read the request body a few lines above to find its variable (the test sends `backgroundId: <someBgId>` in `inputs`); assert:

```ts
    // The override is gone: Amazon gets the background the seller picked, even
    // though a white background is configured.
    expect(inputsRow?.backgroundId).toBe(<the backgroundId sent in this request>);
    expect(inputsRow?.backgroundId).not.toBe(whiteBg.id);
```

Also update the test's comment that says the white background is "as Amazon platform requires for the legacy form" if it is in this test. Leave `'does NOT apply the Amazon white-bg override to the looks[] form'` (~line 852) as it is — it still holds.

- [ ] **Step 2: Run it to see it fail**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts jobs-create-looks`
Expected: the renamed test FAILS (the backgroundId is still the white one); every other test in the file passes.

- [ ] **Step 3: Delete the override**

In `apps/api/src/modules/jobs/create.ts`, replace the whole `let looks …` block (~lines 431–466):

```ts
  let looks: Array<{ poseId: string; backgroundId: string }>;
  if (templateLooks) {
    // Per-look backgrounds are authoritative for templates — the Amazon white-bg
    // override below must never run for this form.
    looks = templateLooks;
  } else {
    // Amazon platform requires a white background — override the single shared
    // …
    let effectiveBackgroundId = legacyBackgroundId as string;
    if (platform === 'Amazon') {
      … (white background lookup, AppError, log) …
      effectiveBackgroundId = whiteBg.id;
      …
    }
    looks = (legacyPoseIds as string[]).map((poseId) => ({
      poseId,
      backgroundId: effectiveBackgroundId,
    }));
  }
```

with:

```ts
  // Templates carry a background per look; the legacy form shares one. The
  // chosen background is always used — the Amazon white-background override was
  // removed on purpose (spec 2026-10-12-whatsapp-catalog-bot-design.md, D30).
  const looks: Array<{ poseId: string; backgroundId: string }> = templateLooks
    ? templateLooks
    : (legacyPoseIds as string[]).map((poseId) => ({
        poseId,
        backgroundId: legacyBackgroundId as string,
      }));
```

If `looks` is reassigned later in the function, keep `let` instead of `const` (search for `looks =` below this point first).

Then find the comment near line 1327 that says `see resolveTryonPlan's Amazon-background-override` and drop that clause, keeping the rest of the sentence:

```ts
    // re-deriving them from the request body (which isn't a 1:1 match with
    // what actually got used; see resolveTryonPlan's template-looks handling above).
```

`platform` (line ~270) is still used further down (`...(platform ? { platform } : {})`, ~line 1049) — keep it. Remove imports that become unused only if Biome flags them (`and` is very likely still used elsewhere in the file).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --config vitest.integration.config.ts jobs-create-looks` → all pass.
Then `pnpm --filter @aivastra/api test && pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint` → green.
Search for any other test asserting the override: `grep -rn "amazon bg override\|requires a white background\|white-bg override" apps/api/test` — update any hit the same way.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/jobs/create.ts apps/api/test/integration/jobs-create-looks.test.ts
git commit -m "fix(api): stop overriding the chosen background with white for Amazon jobs"
```

---

### Task 2: Dispatcher and admin job detail — drop the dead branch

**Files:**
- Modify: `apps/dispatcher/src/job/processor.ts` (~lines 613–616 and the `bgSource` log field)
- Modify: `apps/api/src/modules/admin/jobs.routes.ts` (~lines 412–417)

Neither branch changes what ComfyUI receives today: the dispatcher already uses `bgRow.r2Key` for every job; `isAmazon` only chose a log label. Old Amazon jobs stored the white background's id in `job_inputs.background_id` at creation, so their history still shows the white background.

- [ ] **Step 1: Dispatcher**

In `processor.ts`, replace:

```ts
  const isAmazon = params.platform === 'Amazon';
  jobLog.info({ platform: params.platform, isAmazon }, 'platform check');
  const bgKey = bgRow.r2Key;
  const bgSource = isAmazon ? 'amazon-override' : 'single-image';
```

with:

```ts
  // One background image per job, as chosen at creation (no platform overrides — D30).
  const bgKey = bgRow.r2Key;
```

and remove `bgSource` from the `'resolved R2 keys for ComfyUI upload'` log object. If `params` is now unused in that scope, check before deleting it — it is likely read again further down.

Run: `pnpm --filter @aivastra/dispatcher test && pnpm --filter @aivastra/dispatcher typecheck && pnpm --filter @aivastra/dispatcher lint` (use the dispatcher's real package name from `apps/dispatcher/package.json`). Expected: green. If a dispatcher test asserts the `platform check` log or `bgSource`, update it.

- [ ] **Step 2: Admin job detail**

In `admin/jobs.routes.ts`, replace:

```ts
      // Mirror dispatcher's bg key logic exactly:
      // Amazon always uses the white BG (bgFallbackKey = modelBackgrounds.r2Key, already overridden to white BG at job creation)
      // Non-Amazon uses pose's ComfyUI-specific bg key, falling back to display bg
      const params = (row.jobParams ?? {}) as Record<string, unknown>;
      const isAmazon = params.platform === 'Amazon';
      const bgKey = isAmazon ? row.bgFallbackKey : (row.bgComfyKey ?? row.bgFallbackKey);
```

with:

```ts
      // Mirror the dispatcher exactly: it sends model_backgrounds.r2Key for every
      // job (processor.ts — the separate ComfyUI bg column is no longer used).
      const params = (row.jobParams ?? {}) as Record<string, unknown>;
      const bgKey = row.bgFallbackKey;
```

`params` is used right below (`params.personKey`), so it stays. **Before committing, confirm** in `processor.ts` that `bgRow.r2Key` is the same column as this route's `bgFallbackKey` (read the route's select for `bgFallbackKey` and `bgComfyKey`). If `bgComfyKey` is still what the dispatcher sends for non-Amazon jobs in some path, keep `row.bgComfyKey ?? row.bgFallbackKey` instead — the goal is "show what the dispatcher used", not a particular column. Then remove `bgComfyKey` from the select only if nothing else reads it.

Run: `npx vitest run --config vitest.integration.config.ts admin-job-detail-workflow admin-jobs` (from `apps/api`) and `pnpm --filter @aivastra/api typecheck`. Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/dispatcher/src/job/processor.ts apps/api/src/modules/admin/jobs.routes.ts
git commit -m "refactor: drop the Amazon background branch from dispatcher logging and admin job detail"
```

---

### Task 3: Studio — remove the dormant Amazon-main-image flow

**Files:**
- Modify: `apps/catalogues-web/src/app/(app)/studio/page.tsx`

All of this is unreachable today (`amazonUseWhiteBg` is always `false`). Remove it rather than leave a dead path that suggests the rule still exists.

- [ ] **Step 1: Remove the state**

Delete lines ~470–473:

```ts
  const [amazonPoseModalOpen, setAmazonPoseModalOpen] = useState(false);
  const [amazonMainPoseId, setAmazonMainPoseId] = useState('');
  // Bypassed: Amazon no longer forces white bg. Logic kept dormant for future use.
  const [amazonUseWhiteBg, _setAmazonUseWhiteBg] = useState(false);
```

- [ ] **Step 2: Remove the white-background lookup**

Delete line ~1208–1209:

```ts
  // Find the white background (tagged for Amazon) from loaded backgrounds
  const whiteBg = backgrounds?.items.find((b) => b.isWhiteBg);
```

Keep `isWhiteBg?: boolean;` in the background type (~line 90) and `isWhiteBg: false` (~line 4064): they mirror the api response shape.

- [ ] **Step 3: Simplify the submit path**

In `handleSubmit` (~line 1631) delete the early branch:

```ts
    // Amazon main listing + multiple poses → show picker modal to choose main image.
    // Lifestyle mode or single pose → submit directly.
    if (platform === 'Amazon' && amazonUseWhiteBg && poseIds.length > 1) {
      setAmazonMainPoseId('');
      setAmazonPoseModalOpen(true);
      return;
    }
```

and replace

```ts
      // Send platform:'Amazon' only when white bg override is wanted (main listing).
      // Lifestyle mode: omit platform so the API doesn't force white bg.
      // The aspectRatio (1:1) is already captured in `aspect` independently.
      const effectivePlatform =
        platform === 'Amazon' ? (amazonUseWhiteBg ? 'Amazon' : undefined) : platform;
```

with nothing, and change the request field (~line 1692) from

```ts
        ...(effectivePlatform ? { platform: effectivePlatform } : {}),
```

to

```ts
        // The api no longer changes anything based on platform (D30); it is
        // recorded with the job so catalog previews know which marketplace it is for.
        ...(platform ? { platform } : {}),
```

This is a small, intended behaviour change: web Amazon jobs now record `platform: 'Amazon'` like Android ones already do, instead of nothing.

- [ ] **Step 4: Remove `submitAmazonPose` and the modal**

Delete the whole `async function submitAmazonPose(mainPoseId: string) { … }` (starts ~line 1763; ends at its closing brace before the next top-level function — use your editor's bracket matching). Delete the `{/* Amazon Pose Picker Modal */}` block: from that comment (~line 5672) through the `)}` that closes `{amazonPoseModalOpen && ( … )}` (just before `{toast && (` at ~line 5817).

- [ ] **Step 5: Clean up and verify**

Run: `pnpm --filter @aivastra/web typecheck && pnpm --filter @aivastra/web lint`.
Biome will flag imports that only the modal used (for example an icon); remove exactly those. `grep -n "amazon\|whiteBg" "apps/catalogues-web/src/app/(app)/studio/page.tsx"` should now match only the platform config (`Amazon: { ratios … }`, the Amazon logo) and the `isWhiteBg` type field.

Manual check in the studio (local, `pnpm --filter @aivastra/web dev` with the api running): choose Amazon, 1:1, two poses and a non-white background → Generate goes straight through (no modal); in the network tab the `/v1/jobs/tryon` body contains `"platform":"Amazon"` and your background id; the result uses that background.

- [ ] **Step 6: Commit**

```bash
git add "apps/catalogues-web/src/app/(app)/studio/page.tsx"
git commit -m "refactor(web): remove the dormant Amazon main-image white-background flow"
```

---

### Task 4: Progress note

**Files:**
- Modify: `docs/progress.md`

- [ ] **Step 1: Write the entry and commit**

Dated entry at the top: the override is removed (api), the two downstream branches simplified (dispatcher log, admin job detail), the dormant studio flow removed; **user-visible change for the Android catalogue app and batch jobs** — Amazon jobs now use the chosen background; the `is_white_bg` tag and admin UI are kept (no migration); test commands and counts from Tasks 1–3; dispatcher and api must both deploy (Task 2 touches the dispatcher).

```bash
git add docs/progress.md
git commit -m "docs(progress): Amazon white-background override removed (D30)"
```

---

## Self-review notes

- **Coverage of D30:** api override removed (Task 1); every reader of `platform === 'Amazon'` handled — dispatcher (Task 2), admin job detail (Task 2), studio (Task 3); tag, column and admin UI deliberately untouched.
- **Not covered, deliberately:** the Android app's UI (it only sends `platform`; nothing to remove there), `apps/admin-mobile` (paused), and `catalogs/[id]/preview/templates.tsx` (marketplace mockups, unrelated).
- **One judgement call to confirm in Task 2 Step 2:** which background column the admin detail should show. The plan states the rule ("what the dispatcher used") and the check to make, rather than assuming the columns.
