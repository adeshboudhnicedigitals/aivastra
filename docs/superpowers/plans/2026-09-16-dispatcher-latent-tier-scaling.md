# Dispatcher Latent Canvas Tier Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the diffusion latent canvas for dual-size-group ComfyUI workflow templates scale with the requested resolution tier's resolved output size, capped by the template's own `latentMaxPx` ceiling — instead of always forcing the latent to that ceiling regardless of what was requested.

**Architecture:** One-line semantic change in `apps/dispatcher/src/workflow/patcher.ts`'s dual-size-group branch: replace `resizeToMax(outputDims.width, outputDims.height, tmpl.latentMaxPx ?? 2048)` (which unconditionally forces the long edge to `latentMaxPx`) with the same call using `Math.min(requestedLongEdge, tmpl.latentMaxPx ?? 2048)` as the target, where `requestedLongEdge = Math.max(outputDims.width, outputDims.height)`. No new schema, API, or admin-UI surface — the tier is already baked into `outputDims` by the time the dispatcher sees it.

**Tech Stack:** TypeScript, Vitest. Single package: `apps/dispatcher`.

## Global Constraints

- No feature flag, no dual-read — hard cutover, consistent with this repo's "no compat shims" convention (`CLAUDE.md`).
- `resizeToMax`'s own signature/contract is unchanged (`apps/dispatcher/src/workflow/resize-to-max.ts` — its only caller is `patcher.ts`) — only the value passed in as its `max` argument changes.
- Legacy single-group templates (`tmpl.sizeNodeIds`) are explicitly out of scope — untouched by this plan.
- No change to `apps/api`, `packages/types`, `packages/db`, or any admin/web app — this is entirely contained within `apps/dispatcher`.
- Comment density/style must match the surrounding file (this codebase comments the *why*).

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/dispatcher/src/workflow/patcher.ts` | `applyWorkflowPatch`'s dual-size-group branch — compute the latent target as `min(request's resolved long edge, template's latentMaxPx)` instead of always using `latentMaxPx` directly |
| `apps/dispatcher/src/workflow/patcher.test.ts` | New test cases in the existing `'dual-size groups'` describe block proving the latent now tracks the request when below the ceiling, still clamps when above a lowered ceiling, and doesn't inflate a request beyond itself when the ceiling is raised |

---

### Task 1: Latent target derives from the request's resolved long edge, capped by the template ceiling

**Files:**
- Modify: `apps/dispatcher/src/workflow/patcher.ts:186-188`
- Test: `apps/dispatcher/src/workflow/patcher.test.ts` (new `it(...)` blocks inside the existing `describe('dual-size groups', ...)` block, after the test ending at line 491)

**Interfaces:**
- Consumes: `resizeToMax(width, height, max)` from `./resize-to-max.js` (unchanged, already imported in `patcher.ts:3`); `outputDims: {width: number, height: number}` (already computed earlier in `applyWorkflowPatch`, unchanged); `tmpl.latentMaxPx: number` (existing DB column, already on `WorkflowTemplate`).
- Produces: no new exported symbol — this is a pure internal-logic change inside `applyWorkflowPatch`. No other task or file depends on new interface surface.

- [ ] **Step 1: Write the three failing tests**

Open `apps/dispatcher/src/workflow/patcher.test.ts` and find the `describe('dual-size groups', ...)` block (starts at line 440, uses the `makeDualSizeWorkflow()` helper defined at lines 441-465). Add these three `it(...)` blocks immediately after the test ending at line 491 (`'patches the latent group via resizeToMax, and the output group via the literal ASPECT_DIMENSIONS lookup'`), before the next test (`'warns and skips the output group for an unknown aspect ratio...'` at line 493):

```ts
  it('renders the latent at the request\'s own long edge when it is below the template ceiling (the HD-tier case)', () => {
    const wf = makeDualSizeWorkflow();
    applyWorkflowPatch(
      wf,
      makeTemplate({
        latentSizeNodeIds: ['max-width', 'max-height'],
        latentMaxPx: 2048,
        outputSizeNodeIds: ['result-width', 'result-height'],
      }),
      { ...BASE_INPUTS, outputWidth: 1152, outputHeight: 1536 },
    );
    // Request's long edge (1536) is below the template's latentMaxPx (2048), so the
    // latent renders at the request's own size — it is NOT forced up to 2048 the way
    // every tier used to be, regardless of what was actually requested.
    expect(wf['max-width']?.inputs.value).toBe(1152);
    expect(wf['max-height']?.inputs.value).toBe(1536);
    // Output group still gets the literal requested dims, unaffected by this change.
    expect(wf['result-width']?.inputs.value).toBe(1152);
    expect(wf['result-height']?.inputs.value).toBe(1536);
  });

  it('still clamps the latent to a lowered template ceiling when the request exceeds it', () => {
    const wf = makeDualSizeWorkflow();
    applyWorkflowPatch(
      wf,
      makeTemplate({
        latentSizeNodeIds: ['max-width', 'max-height'],
        latentMaxPx: 1024,
        outputSizeNodeIds: ['result-width', 'result-height'],
      }),
      { ...BASE_INPUTS, outputWidth: 3000, outputHeight: 4000 },
    );
    // Request's long edge (4000) exceeds the template's latentMaxPx (1024) — still
    // clamped, exactly like before this change. resizeToMax(3000, 4000, 1024):
    // width < height, ratio = 3000/4000 = 0.75, width = round(1024 * 0.75) = 768.
    expect(wf['max-width']?.inputs.value).toBe(768);
    expect(wf['max-height']?.inputs.value).toBe(1024);
  });

  it('does not inflate a request above itself when an admin raises the template ceiling', () => {
    const wf = makeDualSizeWorkflow();
    applyWorkflowPatch(
      wf,
      makeTemplate({
        latentSizeNodeIds: ['max-width', 'max-height'],
        latentMaxPx: 3072,
        outputSizeNodeIds: ['result-width', 'result-height'],
      }),
      { ...BASE_INPUTS, outputWidth: 1792, outputHeight: 2688 },
    );
    // Before this change, this would have been forced UP to resizeToMax(1792, 2688,
    // 3072) = {width: 2048, height: 3072} regardless of the smaller request. Now the
    // request's own long edge (2688) is below the raised ceiling (3072), so the
    // latent renders at the request's own size instead of inflating to the ceiling —
    // this is what lets a smaller-tier request stay cheap/fast even on a template an
    // admin has tuned for higher-detail top-tier output.
    expect(wf['max-width']?.inputs.value).toBe(1792);
    expect(wf['max-height']?.inputs.value).toBe(2688);
  });
```

- [ ] **Step 2: Run the tests to verify all three fail**

Run (from `apps/dispatcher`): `npx vitest run workflow/patcher.test.ts`

Expected: FAIL on all three new tests. The first fails because today's code forces `max-width`/`max-height` to `2048` regardless of the request (`1152x1536` requested, `2048x2048`-forced-then-resized actual). The second currently passes already (both old and new code clamp to the lowered ceiling identically) — confirm it passes even before the code change, so you know it's not a false failure once you implement Step 3. The third fails because today's code inflates to `2048x3072` (forced to the raised ceiling) instead of `1792x2688` (the request's own size).

- [ ] **Step 3: Make the code change**

In `apps/dispatcher/src/workflow/patcher.ts`, replace lines 186-188:

```ts
    // Latent: scale so the long edge = latentMaxPx, preserving aspect
    const latentMax = tmpl.latentMaxPx ?? 2048;
    const latentDims = resizeToMax(outputDims.width, outputDims.height, latentMax);
```

with:

```ts
    // The latent target is the request's own resolved long edge (already tier-derived
    // by the API before enqueue — computeOutputDims puts the tier's longEdgePx on the
    // long edge for a named ratio, or the custom-dims clamp does for a custom one),
    // never exceeding this template's own technical ceiling. Previously every tier
    // rendered at the same flat latentMaxPx; now a smaller-tier request (e.g. HD)
    // renders a smaller, cheaper/faster latent, and a larger-tier request renders up
    // to whatever ceiling this template's admin has configured — no per-tier admin
    // config needed, since the tier is already baked into outputDims by the time the
    // dispatcher sees it.
    const requestedLongEdge = Math.max(outputDims.width, outputDims.height);
    const latentMax = Math.min(requestedLongEdge, tmpl.latentMaxPx ?? 2048);
    const latentDims = resizeToMax(outputDims.width, outputDims.height, latentMax);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run workflow/patcher.test.ts`

Expected: PASS — all three new tests, plus every pre-existing test in the file (46 total: 43 pre-existing + 3 new). In particular, confirm the pre-existing test at line 467 (`'patches the latent group via resizeToMax, and the output group via the literal ASPECT_DIMENSIONS lookup'`) still passes unchanged — its request (`ASPECT_DIMENSIONS['2:3']`, 2688 long edge) already exceeds that test's `latentMaxPx: 2048`, so `min(2688, 2048) = 2048` produces the identical result to before this change; this test needs no edit.

- [ ] **Step 5: Typecheck**

Run (from repo root): `pnpm --filter @aivastra/dispatcher typecheck` — if no `typecheck` script exists for this package, run `npx tsc --noEmit` from `apps/dispatcher` instead.

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dispatcher/src/workflow/patcher.ts apps/dispatcher/src/workflow/patcher.test.ts
git commit -m "feat(dispatcher): latent canvas scales with the request's resolved tier, capped by template latentMaxPx"
```

---

## Self-Review Notes

- **Spec coverage:** the spec's entire Mechanism section maps to this task's Step 3 code change verbatim. The spec's Testing section listed 3 new cases (below-ceiling, exceeds-lowered-ceiling, exceeds-raised-ceiling) plus "no change needed for legacy path" — all 3 cases are in Step 1, and legacy-path coverage is explicitly out of scope per the spec's Non-goals, so no 4th test was added. The spec's "Behavior change to flag explicitly" section (HD renders smaller/faster) is a direct, provable consequence of the Step 3 code change; no separate task needed since it's not a distinct piece of functionality, just the natural effect of the formula change, already demonstrated by Test 1.
- **Corrected spec test 3 example during planning:** the spec's own prose for its third test case ("long edge exceeds a raised ceiling... 3000, since it's below the raised 3072 ceiling") was numerically inconsistent — 3000×4000's long edge is 4000, not 3000, and 4000 > 3072 so that scenario would still clamp, not demonstrate the "doesn't inflate beyond the request" behavior the spec intended to prove. Replaced with a corrected scenario (1792×2688 request, 3072 ceiling — request's long edge 2688 is genuinely below the raised ceiling) that actually demonstrates the intended contrast against old behavior (which would have inflated to 2048×3072). Hand-verified: `resizeToMax(1792, 2688, 3072)` (old behavior) → ratio 1792/2688 = 0.6667, width = round(3072 × 0.6667) = 2048, height = 3072 — confirms the "before" claim in the new test's comment is accurate.
- **Type consistency:** `patcher.test.ts`'s existing `BASE_INPUTS` object (lines 75-83) has no `outputWidth`/`outputHeight` keys — all three new tests spread `BASE_INPUTS` and add `outputWidth`/`outputHeight` directly in the inline inputs object, the same pattern `applyWorkflowPatch`'s `WorkflowInputs` type already supports (`outputWidth?: number; outputHeight?: number;`, `patcher.ts:58-59`) and consistent with how other tests in the file already pass custom fields alongside `BASE_INPUTS` (e.g. `{ ...BASE_INPUTS, aspectRatio: '2:3' }` at line 476).
