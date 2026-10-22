# WhatsApp Flow 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the WhatsApp bot to the `Flow 2.pdf` mockup: classify right after the photo and confirm the kind, ask the gender, ask how many poses (1/2/3/5), confirm, draw N random looks and generate.

**Architecture:** The engine (`apps/api/src/modules/messaging/engine/`) stays a pure `(session, event) → (session, messages)` state machine. Classification becomes one awaited dep (`recognizeKind`) at the image event plus one synchronous mapping dep (`typeForKind`) at the gender tap; pose picking (`PICK_LOOKS`, carousel) is replaced by `ASK_POSE_COUNT` → `CONFIRM_GENERATE`, which draws looks with a pure `drawLooks` and calls the unchanged `generate()`.

**Tech Stack:** TypeScript, Fastify API, Redis (sessions, recognition stream), Vitest (unit: `pnpm --filter @aivastra/api test`; integration needs `pnpm docker:up`).

Spec: `docs/superpowers/specs/2026-10-22-whatsapp-flow-2-design.md` · Mockup: `Flow 2.pdf`.
Branch: continue on `feat/whatsapp-early-classify-and-pose-cards` (commits `a24ecb3a`, spec `fbf636d8`).

## Global Constraints

- All paths below are relative to the repo root; commands run from `apps/api` unless stated.
- Run unit tests with `npx vitest run messaging whatsapp` (the integration directory is excluded from the default config).
- The engine must stay pure: no I/O except through `EngineDeps`. Randomness only via `deps.shuffle`.
- WhatsApp limits (`render.ts`): button titles ≤ 20 chars, list row titles ≤ 24, body ≤ 1024, list ≤ 10 rows.
- `generate()` / `loadPool` / `groupByTemplate` / `buildTryonBody` behaviour is unchanged except where a task says so. Retry (`retryLookIds`) keeps working off `picked`.
- Credits: tapping Generate is the agreement to spend (D45); balance is re-checked at that tap.
- No `console.log`; comments explain *why* (match surrounding style). `biome check --write` runs in the pre-commit hook.
- Mockup copy is used verbatim except: the button "Choose different number" (23 chars) becomes **"Different number"** (WhatsApp 20-char cap); the kind is written as "a top", not "a women's top" (spec decision 2).
- Deviation (known, flagged): the mockup shows "Here are your N generated poses!" *before* the images. Images are sent by `delivery.ts` per job as they finish, so the summary is sent at the closing `DELIVERED` message, *after* the images. Moving it earlier needs a delivery-side change and is out of scope.
- Out of scope: the 12 s silent wait feedback ("Analysing…"), carousel code removal in `render.ts`, welcome/menu copy.

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/modules/messaging/classify.ts` | `recognizeKind` (queue + wait, label-level answer), `typeForKind` (label → the gender's row) |
| `apps/api/src/modules/messaging/engine/types.ts` | `State`, `Session` fields (`kind`, `count`, `seenLooks`), `EngineDeps` (`recognizeKind`, `typeForKind`, `shuffle`) |
| `apps/api/src/modules/messaging/engine/rules.ts` | `POSE_COUNTS`, `poseCountOptions`, `drawLooks` (pure) |
| `apps/api/src/modules/messaging/engine/copy.ts` | All new strings (mockup copy) |
| `apps/api/src/modules/messaging/engine/engine.ts` | New states and handlers; carousel pose picking removed |
| `apps/api/src/modules/messaging/deps.ts` | Wires the new deps (`shuffle` via `node:crypto` `randomInt`) |
| `apps/api/src/modules/messaging/session-store.ts` | Maps sessions saved by the old flow on load |
| `apps/api/src/modules/messaging/inbound-consumer.ts` | Comment only (lock budget vs. wait) |
| tests | `test/integration/messaging-classify.test.ts`, `test/messaging-rules.test.ts`, `test/messaging-engine.test.ts`, `test/helpers/engine-fakes.ts`, new `test/messaging-session-store.test.ts` |

Each task below leaves typecheck and the unit suite green and ends in a commit.

---

### Task 1: Classification API — `recognizeKind` and `typeForKind`

**Files:**
- Modify: `apps/api/src/modules/messaging/classify.ts`
- Modify: `apps/api/test/integration/messaging-classify.test.ts`

**Interfaces:**
- Produces:
  - `recognizeKind(app: FastifyInstance, garmentKey: string, opts?: { budgetMs?: number }): Promise<{ label: string } | null>` — queues one request (one option per label across genders), waits up to the budget, returns the recognised kind's label. Null on flag off / no candidates / timeout / error / no match. Counts the outcome metric.
  - `typeForKind(app: FastifyInstance, label: string, gender: Gender): Promise<{ garmentTypeId: string; label: string } | null>` — the gender's public-slug type with the same case-insensitive label; null (with a warn log on error) otherwise.
- Consumes: existing `kindCandidates`, `publicTypes`, `norm`, `matchAnswer`, `waitForResult`, `count` already in `classify.ts`. The old `startRecognition` / `resolveRecognition` stay until Task 3.

- [ ] **Step 1: Write the failing integration tests**

In `apps/api/test/integration/messaging-classify.test.ts` change the import to
```ts
import {
  recognizeKind,
  resolveRecognition,
  startRecognition,
  typeForKind,
} from '../../src/modules/messaging/classify';
```
(`resolveRecognition`/`startRecognition` are removed from this import in Task 3.) Then add, inside the `describe`, after the existing `recognize` helper:

```ts
  it('recognizeKind returns the kind label, one option per label across genders', async () => {
    const since = await lastId();
    const [kind, request] = await Promise.all([
      recognizeKind(app, 'inputs/x/garment.jpg'),
      answerNext(since, { answer: 'WA-Kurti.', error: null }),
    ]);
    expect(kind).toEqual({ label: 'Kurti' });
    expect(request.options.map((o) => o.slug).sort()).toEqual([
      'wa-full-shirt',
      'wa-kurta',
      'wa-kurti',
    ]);
  });

  it('typeForKind maps a kind to the tapped gender row, or null when that gender lacks it', async () => {
    expect(await typeForKind(app, 'kurti', 'women')).toEqual({
      garmentTypeId: ids.kurti,
      label: 'Kurti',
    });
    expect(await typeForKind(app, 'Kurti', 'men')).toEqual({
      garmentTypeId: ids.kurtiMen,
      label: 'Kurti',
    });
    expect(await typeForKind(app, 'Kurta', 'women')).toBeNull();
  });

  it('recognizeKind returns null when disabled, on an error answer, and on no match', async () => {
    const off = { ...app, env: { ...app.env, GARMENT_RECOGNITION_ENABLED: false } } as TestApp;
    expect(await recognizeKind(off, 'inputs/x/garment.jpg')).toBeNull();
    const since = await lastId();
    const [errored] = await Promise.all([
      recognizeKind(app, 'inputs/x/garment.jpg'),
      answerNext(since, { answer: null, error: 'no_worker' }),
    ]);
    expect(errored).toBeNull();
    const since2 = await lastId();
    const [unmatched] = await Promise.all([
      recognizeKind(app, 'inputs/x/garment.jpg'),
      answerNext(since2, { answer: 'wa-nonsense', error: null }),
    ]);
    expect(unmatched).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run (needs `pnpm docker:up`): `timeout 170 npx vitest run --config vitest.integration.config.ts messaging-classify`
Expected: FAIL — `recognizeKind` / `typeForKind` are not exported.

- [ ] **Step 3: Implement**

In `classify.ts`, insert immediately before `export function recordRecognitionCorrected`:

```ts
/**
 * Spec 2026-10-22: asked the moment the photo arrives. Queues one request over
 * every gender's public-slug kinds (one option per label), waits up to the
 * budget and returns the recognised kind's label — a kind, not a row, because
 * the photo carries no gender (typeForKind maps it once the seller has tapped
 * one). Null for every failure; the list is then the way out, so recognition
 * can cost a tap but never a run.
 */
export async function recognizeKind(
  app: FastifyInstance,
  garmentKey: string,
  opts: { budgetMs?: number } = {},
): Promise<{ label: string } | null> {
  if (app.env.GARMENT_RECOGNITION_ENABLED !== true) return null;
  const budgetMs = opts.budgetMs ?? RECOGNITION_BUDGET_MS;
  try {
    const candidates = await kindCandidates(app);
    // Nothing a photo could be recognised as: straight to the list, without a
    // request no one can answer usefully.
    if (candidates.length === 0) return null;
    const requestId = randomUUID();
    const request: GarmentRecognitionRequest = {
      requestId,
      garmentKey,
      options: candidates.map(({ slug, label }) => ({ slug, label })),
      expiresAt: Date.now() + budgetMs,
    };
    await app.redis.xadd(
      GARMENT_RECOGNITION_STREAM,
      'MAXLEN',
      '~',
      String(STREAM_MAXLEN),
      '*',
      'payload',
      JSON.stringify(request),
    );
    const result = await waitForResult(app, requestId, budgetMs);
    if (!result || result.error === 'expired') {
      count('timeout');
      return null;
    }
    if (result.error) {
      count(result.error);
      return null;
    }
    const kind = matchAnswer(result.answer, candidates);
    count(kind ? 'matched' : 'unmatched');
    if (!kind) {
      // The raw answer is model output about a garment photo, not personal data;
      // capped so a runaway answer cannot flood the log.
      app.log.info(
        { requestId, answer: result.answer?.slice(0, 40) },
        'garment recognition answer not in options',
      );
    }
    return kind ? { label: kind.label } : null;
  } catch (err) {
    count('failed');
    app.log.warn({ err }, 'garment recognition failed; falling back to the list');
    return null;
  }
}

/**
 * The recognised kind as the tapped gender's own type (types are per-gender
 * rows). Null when that gender has no type of that kind: the seller then picks
 * from the list.
 */
export async function typeForKind(
  app: FastifyInstance,
  label: string,
  gender: Gender,
): Promise<{ garmentTypeId: string; label: string } | null> {
  try {
    const own = (await publicTypes(app, gender)).find((c) => norm(c.label) === norm(label));
    return own ? { garmentTypeId: own.id, label: own.label } : null;
  } catch (err) {
    app.log.warn({ err }, 'garment kind could not be mapped; falling back to the list');
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `timeout 170 npx vitest run --config vitest.integration.config.ts messaging-classify` — Expected: all pass (old + 3 new). Then `npx tsc --noEmit -p .` — no output.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/messaging/classify.ts apps/api/test/integration/messaging-classify.test.ts
git commit -m "feat(whatsapp): recognizeKind and typeForKind for confirm-first classification

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure rules — pose-count options and the random draw

**Files:**
- Modify: `apps/api/src/modules/messaging/engine/rules.ts`
- Modify: `apps/api/test/messaging-rules.test.ts`

**Interfaces:**
- Produces (exported from `rules.ts`):
  - `POSE_COUNTS = [1, 2, 3, 5] as const`
  - `poseCountOptions(poolSize: number, perImage: number, balance: number): number[]` — the counts `n` with `n <= poolSize` and `n * perImage <= balance`, ascending.
  - `drawLooks(poolIds: string[], seen: string[], n: number, shuffle: (ids: string[]) => string[]): { ids: string[]; seen: string[] }` — `ids` are `min(n, poolIds.length)` distinct pool ids, preferring ids not in `seen`; `seen` is the new seen list (cycle restarts with only the new batch when the unseen ids ran out). Ids in `seen` that are no longer in the pool are dropped.
- `MAX_PICKS` stays for now (removed in Task 6).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/messaging-rules.test.ts` (add `drawLooks, POSE_COUNTS, poseCountOptions` to the existing `rules` import):

```ts
describe('poseCountOptions', () => {
  it('offers 1, 2, 3, 5', () => expect([...POSE_COUNTS]).toEqual([1, 2, 3, 5]));
  it('drops counts above the pool size', () =>
    expect(poseCountOptions(3, 10, 1000)).toEqual([1, 2, 3]));
  it('drops counts the balance cannot cover', () =>
    expect(poseCountOptions(10, 10, 30)).toEqual([1, 2, 3]));
  it('is empty when even one pose is unaffordable', () =>
    expect(poseCountOptions(10, 10, 5)).toEqual([]));
});

describe('drawLooks', () => {
  const identity = (ids: string[]) => ids;
  const reverse = (ids: string[]) => [...ids].reverse();

  it('draws n distinct pool ids through the shuffle', () => {
    expect(drawLooks(['a', 'b', 'c', 'd'], [], 2, reverse)).toEqual({
      ids: ['d', 'c'],
      seen: ['d', 'c'],
    });
  });

  it('avoids looks already seen and remembers the new ones', () => {
    expect(drawLooks(['a', 'b', 'c', 'd'], ['a', 'b'], 2, identity)).toEqual({
      ids: ['c', 'd'],
      seen: ['a', 'b', 'c', 'd'],
    });
  });

  it('tops up from seen looks when the unseen ones run out, and restarts the cycle', () => {
    expect(drawLooks(['a', 'b', 'c'], ['a', 'b'], 3, identity)).toEqual({
      ids: ['c', 'a', 'b'],
      seen: ['c', 'a', 'b'],
    });
  });

  it('returns the whole pool when n exceeds it', () => {
    expect(drawLooks(['a', 'b'], [], 5, identity).ids).toEqual(['a', 'b']);
  });

  it('drops seen ids that left the pool', () => {
    expect(drawLooks(['a', 'b'], ['gone'], 1, identity)).toEqual({ ids: ['a'], seen: ['a'] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run messaging-rules` — Expected: FAIL (`drawLooks` / `poseCountOptions` / `POSE_COUNTS` not exported).

- [ ] **Step 3: Implement**

In `rules.ts`, add after the `MAX_PICKS` block:

```ts
// What the seller can ask for (Flow 2 mockup). A fixed set, not a free number:
// it keeps the count a one-tap list and every option priced on its label.
export const POSE_COUNTS = [1, 2, 3, 5] as const;

/** The counts the pool can supply and the balance can pay for, ascending. */
export function poseCountOptions(poolSize: number, perImage: number, balance: number): number[] {
  return POSE_COUNTS.filter((n) => n <= poolSize && n * perImage <= balance);
}

/**
 * Picks `n` looks at random from the pool, preferring ones this garment has not
 * had yet. When the unseen looks run out it tops up from the seen ones and the
 * "seen" list restarts with just this batch, so a long session keeps rotating
 * through the pool instead of getting stuck. `shuffle` is injected so the
 * engine stays pure.
 */
export function drawLooks(
  poolIds: string[],
  seen: string[],
  n: number,
  shuffle: (ids: string[]) => string[],
): { ids: string[]; seen: string[] } {
  const inPool = new Set(poolIds);
  const live = seen.filter((id) => inPool.has(id));
  const seenSet = new Set(live);
  const fresh = shuffle(poolIds.filter((id) => !seenSet.has(id)));
  if (fresh.length >= n) {
    const ids = fresh.slice(0, n);
    return { ids, seen: [...live, ...ids] };
  }
  const reused = shuffle(poolIds.filter((id) => seenSet.has(id))).slice(0, n - fresh.length);
  const ids = [...fresh, ...reused];
  return { ids, seen: ids };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run messaging-rules` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/messaging/engine/rules.ts apps/api/test/messaging-rules.test.ts
git commit -m "feat(whatsapp): pose count options and the random look draw

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Engine — classify at upload, confirm the kind, then gender

After this task the flow is: photo → `CONFIRM_KIND` (or straight to gender) → `ASK_GENDER` → type → extra photos → `PICK_LOOKS` (carousel still in place; Task 4 replaces it).

**Files:**
- Modify: `apps/api/src/modules/messaging/engine/types.ts`, `engine/copy.ts`, `engine/engine.ts`
- Modify: `apps/api/src/modules/messaging/deps.ts`, `classify.ts` (delete `startRecognition`/`resolveRecognition`)
- Modify: `apps/api/test/helpers/engine-fakes.ts`, `apps/api/test/messaging-engine.test.ts`, `apps/api/test/integration/messaging-classify.test.ts`

**Interfaces:**
- Produces:
  - `State`: `'CONFIRM_GARMENT_TYPE'` → `'CONFIRM_KIND'`.
  - `Session.kind?: string` (replaces `recognition?: RecognitionTicket`); `RecognitionTicket` deleted. `Session.recognized?: boolean` is **kept** until Task 4.
  - `EngineDeps.recognizeKind(garmentKey: string): Promise<{ label: string } | null>` and `EngineDeps.typeForKind(label: string, gender: Gender): Promise<{ garmentTypeId: string; label: string } | null>` (replace `startRecognition`/`resolveRecognition`).
  - Reply ids on `CONFIRM_KIND`: action `confirm` (Yes) and `change` (No), both value `''`.
  - Fake call logs: `calls.recognize: { garmentKey }[]`, `calls.mapped: { label; gender }[]`.
- Consumes: `recognizeKind` / `typeForKind` from Task 1.

- [ ] **Step 1: Update fakes (the failing-test scaffolding)**

In `test/helpers/engine-fakes.ts` replace the `resolved` call log and the two recognition deps. `calls` gets `mapped: [] as { label: string; gender: string }[],` in place of `resolved: [] as string[],`, and the deps become:

```ts
    recognizeKind: async (garmentKey) => {
      calls.recognize.push({ garmentKey });
      return null;
    },
    typeForKind: async (label, gender) => {
      calls.mapped.push({ label, gender });
      return null;
    },
```
(delete the old `startRecognition` / `resolveRecognition` entries).

- [ ] **Step 2: Rewrite the recognition tests**

In `test/messaging-engine.test.ts`, inside `describe('engine: photo, gender and garment type')`:

1. In the first test change `expect(list?.text).toBe('Create catalogue for:');` to `'Create this catalogue for:'`.
2. Delete these tests: `recognised: the guess is confirmed first; Yes goes on to pose picking`, `recognised: No sends the seller to the list and counts a correction`, `recognition starts with the upload and is collected at the gender tap`, `a recognised type the bot cannot offer hands off to the studio, keeps the session and reports why`, and `a hand-off with no type list to offer ends at the menu without "choose another type"`.
3. Insert (before `not recognised: the garment-type list, then a pick goes to pose picking`):

```ts
  // A recognised Shirt, and the gender's own row for it.
  const KIND = {
    recognizeKind: async () => ({ label: 'Shirt' }),
    typeForKind: async () => ({ garmentTypeId: 'gt-shirt', label: 'Shirt' }),
  };

  it('recognition runs right after the upload and asks the seller to confirm the kind', async () => {
    const { deps, calls } = fakeDeps(KIND);
    const r = await run(deps, [() => photo(1)]);
    expect(calls.recognize).toEqual([
      { garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg' },
    ]);
    expect(r.session).toMatchObject({ state: 'CONFIRM_KIND', kind: 'Shirt' });
    expect(r.messages[0]).toMatchObject({
      kind: 'buttons',
      text: "I've analysed the image and it looks like a shirt.\nIs this correct?",
    });
    expect(buttonTitles(r.messages[0])).toEqual(['Yes, continue', 'No, different item']);
  });

  it('Yes asks the gender, then goes on with that gender’s own type', async () => {
    const { deps, calls } = fakeDeps(KIND);
    const ask = await run(deps, [() => photo(1), (x) => tap(x, 'confirm')]);
    expect(ask.session.state).toBe('ASK_GENDER');
    expect(listOf(ask)?.text).toBe('Great! 👍\nCreate this catalogue for:');
    const r = await handle(ask.session, tap(ask, 'gender', 'women'), CTX, deps);
    expect(calls.mapped).toEqual([{ label: 'Shirt', gender: 'women' }]);
    expect(r.session).toMatchObject({
      state: 'PICK_LOOKS',
      gender: 'women',
      garmentType: { id: 'gt-shirt' },
      recognized: true,
      faceId: 'face-1',
    });
    expect(r.session.kind).toBeUndefined();
  });

  it('No asks the gender, then shows that gender’s list and counts a correction', async () => {
    const { deps, calls } = fakeDeps(KIND);
    const ask = await run(deps, [() => photo(1), (x) => tap(x, 'change')]);
    expect(ask.session.state).toBe('ASK_GENDER');
    expect(ask.session.kind).toBeUndefined();
    expect(listOf(ask)?.text).toBe('Create this catalogue for:');
    expect(calls.corrected).toBe(1);
    const r = await handle(ask.session, tap(ask, 'gender', 'women'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women' });
    expect(calls.mapped).toEqual([]);
  });

  it('a kind the tapped gender does not have goes to that gender’s list', async () => {
    const { deps } = fakeDeps({ ...KIND, typeForKind: async () => null });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'confirm'),
      (x) => tap(x, 'gender', 'boys'),
    ]);
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'boys' });
    expect(r.session.kind).toBeUndefined();
  });

  it('a recognised type the bot cannot offer hands off to the studio, keeps the session and reports why', async () => {
    const { deps, calls } = fakeDeps({
      ...KIND,
      typeForKind: async () => ({ garmentTypeId: 'gt-saree', label: 'Saree' }),
      getReadiness: async () => ({ status: 'blocked', reasons: ['mannequin_flow'] }),
    });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'confirm'),
      (x) => tap(x, 'gender', 'women'),
    ]);
    expect(texts(r.messages)[0]).toMatch(
      /^Saree catalogs can't be made on WhatsApp yet\. You can create one in the web studio: https:\/\/app\.test\/studio\?draft=/,
    );
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women' });
    expect(r.session.garmentKey).toBeDefined();
    expect(calls.unavailable).toEqual([
      expect.objectContaining({
        gender: 'women',
        garmentTypeId: 'gt-saree',
        reason: 'mannequin_flow',
      }),
    ]);
  });

  it('a hand-off with no type list to offer ends at the menu without "choose another type"', async () => {
    const { deps } = fakeDeps({
      ...KIND,
      typeForKind: async () => ({ garmentTypeId: 'gt-saree', label: 'Saree' }),
      getReadiness: async () => ({ status: 'blocked', reasons: ['mannequin_flow'] }),
      listGarmentTypes: async () => [],
    });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'confirm'),
      (x) => tap(x, 'gender', 'women'),
    ]);
    const sent = texts(r.messages);
    expect(sent[0]).toMatch(/^Saree catalogs can't be made .*https:\/\/app\.test\/studio\?draft=/);
    expect(sent.join('\n')).not.toContain('Or choose another type.');
    expect(r.session.state).toBe('MAIN_MENU');
  });
```

4. In `Change after a recognised type counts a correction; after a list pick it does not` (in `describe('engine: pose cards')`), the recognised branch used `recognizeGarment: …` + steps `[photo, gender, confirm, change]`. Change it to `fakeDeps(KIND)`-style deps — `KIND` is declared in a different `describe`, so hoist it: move the `const KIND = {…}` block above the first `describe('engine: photo, gender and garment type'` — and make the steps `[() => photo(1), (x) => tap(x, 'confirm'), (x) => tap(x, 'gender', 'women'), (x) => tap(x, 'change')]`. The expected states are unchanged (`ASK_GARMENT_TYPE`, `corrected` 1).

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsc --noEmit -p . ; npx vitest run messaging-engine`
Expected: type errors (`recognizeKind` not in `EngineDeps`) and failing tests.

- [ ] **Step 4: Implement — types**

`engine/types.ts`:
- Delete the `RecognitionTicket` interface.
- In `State` replace `'CONFIRM_GARMENT_TYPE'` with `'CONFIRM_KIND'`. Update the comment above `State` to: `// Flow 2 (2026-10-22): photo → (kind confirmed) → gender → garment type → required extra photos → pose picks → generating → delivered.` (Task 4 updates it again.)
- In `Session` replace the `recognition?: RecognitionTicket;` field and its comment with:
```ts
  // What recognition said the photo is, as a kind label ("Top"), kept from the
  // upload until the gender is known (types are per-gender rows).
  kind?: string;
```
- In `EngineDeps` replace `startRecognition` / `resolveRecognition` with:
```ts
  // Spec 8a, awaited at the image event: the photo's kind, or null — for every
  // failure, never an error — in which case the list is the way out.
  recognizeKind(garmentKey: string): Promise<{ label: string } | null>;
  // The kind as the tapped gender's own type; null when that gender has none.
  typeForKind(
    label: string,
    gender: Gender,
  ): Promise<{ garmentTypeId: string; label: string } | null>;
```

- [ ] **Step 5: Implement — copy**

`engine/copy.ts`: delete `confirmGarment`, `btnYes`, `btnNo`; replace `askGender` and add:

```ts
  askGender: 'Create this catalogue for:',
  // After "Yes, continue" the confirmation is acknowledged first (Flow 2).
  askGenderConfirmed: 'Great! 👍\nCreate this catalogue for:',
  btnYesContinue: 'Yes, continue',
  btnNoDifferent: 'No, different item',
  kindGuess: (kind: string) => {
    const name = kind.trim().toLowerCase();
    return `I've analysed the image and it looks like ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}.\nIs this correct?`;
  },
```

- [ ] **Step 6: Implement — engine**

`engine/engine.ts`:

a) Image event — replace the `NEW_PHOTO_STATES` branch of `case 'image'`:
```ts
      if (NEW_PHOTO_STATES.includes(s.state)) {
        // Spec 8a: recognised right after the upload and before any question,
        // so the seller confirms the kind while the photo is fresh. Awaited:
        // the seller waits once, up to the budget (spec 2026-10-22, risks).
        const fresh: Session = { ...cleared(s), garmentKey: event.garmentKey };
        const hit = await deps.recognizeKind(event.garmentKey);
        return hit
          ? enter({ ...fresh, kind: hit.label }, 'CONFIRM_KIND', out, ctx, deps)
          : enter(fresh, 'ASK_GENDER', out, ctx, deps);
      }
```

b) `render`: replace the `case 'ASK_GENDER'` text and the `case 'CONFIRM_GARMENT_TYPE'` block:
```ts
    case 'CONFIRM_KIND':
      if (!s.kind) return enter(s, 'ASK_GENDER', out, ctx, deps);
      out.push(
        buttons(s, COPY.kindGuess(s.kind), [
          ['confirm', '', COPY.btnYesContinue],
          ['change', '', COPY.btnNoDifferent],
        ]),
      );
      return done();
```
and in `case 'ASK_GENDER'` use `s.kind ? COPY.askGenderConfirmed : COPY.askGender` as the list body.

c) `onReply`: replace the `case 'ASK_GENDER'` and `case 'CONFIRM_GARMENT_TYPE'` blocks:
```ts
    case 'CONFIRM_KIND': {
      if (action === 'confirm') return enter(s, 'ASK_GENDER', out, ctx, deps);
      if (action !== 'change') return reprompt();
      deps.recordRecognitionCorrected();
      return enter({ ...s, kind: undefined }, 'ASK_GENDER', out, ctx, deps);
    }

    case 'ASK_GENDER': {
      if (action !== 'gender' || !GENDERS.includes(value as Gender)) return reprompt();
      const gender = value as Gender;
      const withGender: Session = { ...s, gender };
      // No kind, or a kind this gender does not have: the list is the way out.
      const hit = s.kind ? await deps.typeForKind(s.kind, gender) : null;
      if (!hit) return enter({ ...withGender, kind: undefined }, 'ASK_GARMENT_TYPE', out, ctx, deps);
      const gt = (await deps.listGarmentTypes(gender)).find((t) => t.id === hit.garmentTypeId);
      // A correct answer for a type the bot cannot offer (a saree two-step
      // type, no template): hand the seller to the studio rather than pretend we didn't know.
      if (!gt) {
        // Report why, from the same facts the studio reads, so an admin sees
        // "template_inactive" rather than a bare "not offered".
        const { reasons } = await deps.getReadiness(gender, hit.garmentTypeId);
        for (const reason of reasons) {
          deps.reportUnavailable({ gender, garmentTypeId: hit.garmentTypeId, reason });
        }
        return handoff(withGender, { id: hit.garmentTypeId, label: hit.label }, out, ctx, deps);
      }
      // The kind was confirmed before the gender, so no second "Looks like".
      return chooseGarmentType(withGender, gt, true, out, ctx, deps);
    }
```

d) In `NEW_PHOTO_STATES`-adjacent code nothing else changes. Remove `'CONFIRM_GARMENT_TYPE'` from anywhere it is still listed (`grep -n CONFIRM_GARMENT_TYPE src test` must be empty after this task).

- [ ] **Step 7: Implement — deps and classify cleanup**

`deps.ts`: replace the import `{ recordRecognitionCorrected, resolveRecognition, startRecognition }` with `{ recognizeKind, recordRecognitionCorrected, typeForKind }` and the two deps lines with:
```ts
    recognizeKind: (garmentKey) => recognizeKind(app, garmentKey),
    typeForKind: (label, gender) => typeForKind(app, label, gender),
```
`classify.ts`: delete `startRecognition` and `resolveRecognition` (and the now-unused `RecognitionTicket` import).
`test/integration/messaging-classify.test.ts`: drop the `startRecognition`/`resolveRecognition` imports and rewrite the `recognize` helper to
```ts
  async function recognize(key: string, gender: Gender, opts: { budgetMs?: number } = {}) {
    const kind = await recognizeKind(app, key, opts);
    return kind ? typeForKind(app, kind.label, gender) : null;
  }
```
and the flag-off test's `startRecognition(off, …)` to `recognizeKind(off, …)`.

- [ ] **Step 8: Run to verify**

Run: `npx tsc --noEmit -p . && npx vitest run messaging whatsapp` — Expected: no type errors; all pass.
Run: `timeout 170 npx vitest run --config vitest.integration.config.ts messaging-classify` — Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(whatsapp): classify right after upload and confirm the kind before the gender

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Engine — pose count, confirm, random draw (replaces pose picking)

**Files:**
- Modify: `apps/api/src/modules/messaging/engine/types.ts`, `copy.ts`, `engine.ts`
- Modify: `apps/api/src/modules/messaging/deps.ts`, `session-store.ts`
- Modify: `apps/api/test/helpers/engine-fakes.ts`, `apps/api/test/messaging-engine.test.ts`
- Create: `apps/api/test/messaging-session-store.test.ts`

**Interfaces:**
- Produces:
  - `State`: `'PICK_LOOKS'` → `'ASK_POSE_COUNT'`, plus new `'CONFIRM_GENERATE'`.
  - `Session.count?: number`, `Session.seenLooks?: string[]`; `Session.recognized` removed.
  - `EngineDeps.shuffle(ids: string[]): string[]`.
  - Reply ids: `ASK_POSE_COUNT` list rows `count` / `'1'|'2'|'3'|'5'`; `CONFIRM_GENERATE` buttons `generate` and `recount`.
  - `loadSession` maps `PICK_LOOKS` → `ASK_POSE_COUNT`, `CONFIRM_GARMENT_TYPE` → `ASK_GARMENT_TYPE`, drops `recognition`.
- Consumes: `POSE_COUNTS`, `poseCountOptions`, `drawLooks` (Task 2).

- [ ] **Step 1: Update the test scaffolding**

`test/helpers/engine-fakes.ts`: add `shuffle: (ids) => ids,` to the default deps (deterministic: the first N pool ids).

`test/messaging-engine.test.ts`:

1. Replace `atPick`, `pickLooks` and `generated` (the block after `describe('engine: photo, gender and garment type'`) with:
```ts
// A seller at the pose-count question for GT_SHIRT, through the garment-type list.
async function atCount(deps: EngineDeps) {
  const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
  return run(deps, [(x) => tap(x, 'gt', 'gt-shirt')], list);
}

// ...and after tapping a count: the summary with Generate / Different number.
async function atConfirm(deps: EngineDeps, n: number) {
  const at = await atCount(deps);
  return handle(at.session, tap(at, 'count', String(n)), CTX, deps);
}

// A shuffle that puts `want` first, in that order: the draw is random in
// production, so tests choose which looks it returns.
const prefer = (want: string[]) => (ids: string[]) => [
  ...want.filter((w) => ids.includes(w)),
  ...ids.filter((i) => !want.includes(i)),
];

// Count = lookIds.length, drawn as exactly lookIds, then Generate.
async function generated(deps: EngineDeps, lookIds: string[]) {
  deps.shuffle = prefer(lookIds);
  const c = await atConfirm(deps, lookIds.length);
  return handle(c.session, tap(c, 'generate'), CTX, deps);
}
```
and delete the `atPick`/`pickLooks` usages as described in steps below. Keep the `buttonTitles` helper.

2. Replace the entire `describe('engine: pose cards')` and `describe('engine: selecting poses')` blocks with:
```ts
describe('engine: pose count', () => {
  it('summarises the choice and offers 1, 2 and 3 poses with their credit cost', async () => {
    const { deps, calls } = fakeDeps();
    const r = await atCount(deps);
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', perImage: 5, balance: 50 });
    const list = listOf(r);
    expect(list?.text).toBe(
      "Great! Let's create your catalogue. ✨\nCategory: Women\nGarment: Shirt\n\nCredits per pose: 5 credits\nAvailable balance: 50 credits\n\nHow many poses would you like to generate for your catalogue?\nYou can choose one option below. Each pose will use 5 credits.",
    );
    // Look 'd' needs shoes and GT_SHIRT has no default shoe (D49): a pool of 3, so no "5 poses".
    expect(list?.rows.map((x) => x.title)).toEqual([
      '1 pose (5 credits)',
      '2 poses (10 credits)',
      '3 poses (15 credits)',
    ]);
    // Priced with one look, through the real create-body builder.
    expect(calls.quote.at(-1)?.inputs.looks).toEqual([{ poseId: 'pose-a', backgroundId: 'bg-a' }]);
  });

  it('offers only counts the balance can pay for', async () => {
    const { deps } = fakeDeps({ getBalance: async () => 10, quote: async () => ({ images: 1, perImage: 5, total: 5, balance: 10 }) });
    const r = await atCount(deps);
    expect(listOf(r)?.rows.map((x) => x.title)).toEqual(['1 pose (5 credits)', '2 poses (10 credits)']);
  });

  it('goes to NO_CREDITS when not even one pose is affordable', async () => {
    const { deps } = fakeDeps({ quote: async () => ({ images: 1, perImage: 5, total: 5, balance: 3 }) });
    const r = await atCount(deps);
    expect(r.session.state).toBe('NO_CREDITS');
  });

  it('pools the looks of every template for the pool size', async () => {
    const { deps } = fakeDeps({ getTemplates: async () => [TEMPLATE, TEMPLATE_2] });
    const r = await atCount(deps);
    // 5 distinct looks (a, b, c, e, f): the 5-pose option appears.
    expect(listOf(r)?.rows.map((x) => x.title)).toContain('5 poses (25 credits)');
  });

  it('a quote error is shown before any credits are taken', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps } = fakeDeps({
      quote: async () => {
        throw new AppError('VALIDATION', 400, 'face not found or inactive');
      },
    });
    const r = await atCount(deps);
    expect(texts(r.messages)).toContain('face not found or inactive');
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('a count that was not offered is re-prompted', async () => {
    const { deps } = fakeDeps();
    const at = await atCount(deps);
    const r = await handle(at.session, { type: 'reply', id: encodeReplyId(at.session.nonce, 'count', '4') }, CTX, deps);
    expect(texts(r.messages)[0]).toBe('Please use the options above, or type MENU.');
    expect(r.session.state).toBe('ASK_POSE_COUNT');
  });
});

describe('engine: confirming the count', () => {
  it('summarises cost and remaining balance and offers Generate or a different number', async () => {
    const { deps } = fakeDeps();
    const r = await atConfirm(deps, 2);
    expect(r.session).toMatchObject({ state: 'CONFIRM_GENERATE', count: 2 });
    expect(r.messages[0]).toMatchObject({
      kind: 'buttons',
      text: "Perfect! You've selected 2 poses.\nCategory: Women | Garment: Shirt\nCredits required: 10 credits\nRemaining balance: 40 credits\n\nDo you want to proceed with 2 poses?",
    });
    expect(buttonTitles(r.messages[0])).toEqual(['Generate', 'Different number']);
  });

  it('Different number returns to the count list without charging', async () => {
    const { deps, calls } = fakeDeps();
    const c = await atConfirm(deps, 2);
    const r = await handle(c.session, tap(c, 'recount'), CTX, deps);
    expect(r.session.state).toBe('ASK_POSE_COUNT');
    expect(calls.createRun).toHaveLength(0);
  });

  it('Generate re-checks the balance: a balance that dropped goes to NO_CREDITS before any run', async () => {
    let balance = 50;
    const { deps, calls } = fakeDeps({ getBalance: async () => balance });
    const c = await atConfirm(deps, 3);
    balance = 10;
    const r = await handle(c.session, tap(c, 'generate'), CTX, deps);
    expect(r.session.state).toBe('NO_CREDITS');
    expect(calls.createRun).toHaveLength(0);
  });

  it('credits added after NO_CREDITS return to the count question', async () => {
    const { deps } = fakeDeps();
    const c = await atConfirm(deps, 3);
    const broke = { ...c.session, state: 'NO_CREDITS' as const };
    const r = await handle(broke, { type: 'creditsAdded', credits: 100 }, CTX, deps);
    expect(r.session.state).toBe('ASK_POSE_COUNT');
  });
});

describe('engine: random draw', () => {
  it('draws N distinct looks from the pool at Generate', async () => {
    const { deps, calls } = fakeDeps();
    const r = await generated(deps, ['b', 'c']);
    expect(r.session).toMatchObject({ state: 'GENERATING', picked: ['b', 'c'], seenLooks: ['b', 'c'] });
    expect(calls.createRun[0].inputs).toMatchObject({
      looks: [
        { poseId: 'pose-b', backgroundId: 'bg-b' },
        { poseId: 'pose-c', backgroundId: 'bg-c' },
      ],
    });
  });

  it('a look removed between the count and Generate is simply not drawn', async () => {
    let current = TEMPLATE;
    const { deps, calls } = fakeDeps({ getTemplates: async () => [current] });
    const c = await atConfirm(deps, 2);
    current = { ...TEMPLATE, looks: TEMPLATE.looks.filter((l) => l.id !== 'a') };
    const r = await handle(c.session, tap(c, 'generate'), CTX, deps);
    expect(r.session.picked).toEqual(['b', 'c']);
    expect(calls.createRun).toHaveLength(1);
  });
});
```

3. In `describe('engine: generating')`:
   - First test: rename to `one template: one run with exactly the drawn looks`; expect `looks` `[c, a]` still (the `prefer` shuffle) and replace the generating-copy assertion with
     `expect(texts(r.messages)[0]).toBe("Generating your 2 poses...\nWe're creating your catalogue images.\nThis may take a few seconds.");`
   - `quotes every group before creating any run`, `a look that changed at create time...`: change `state: 'PICK_LOOKS'` to `'ASK_POSE_COUNT'` (and keep `picked: []`); rename "returns to the cards" to "returns to the count question".
   - Delete `a look removed since the cards were shown is dropped, nothing is charged` (replaced by the draw test above).
   - `a session saved with an older shape still generates at the bot shape`: replace the `pickLooks` lines with `const c = await atConfirm(deps, 1); const stale = { ...c.session, aspectRatio: '1:1' as const, resolution: 'HD' as const }; const out = await handle(stale, tap(c, 'generate'), CTX, deps);`.
   - `a look with a lower slot…`, `a type with a default shoe…`, `a lower-only template…`: they call `generated(deps, [...])` — no change needed; check they still pass.
4. `describe('engine: required extra photos')`: in both tests replace the tail
   `const cards = …; const one = await handle(cards.session, tap(cards, 'look', 'a'), …); await handle(one.session, tap(one, 'generate'), …)` with
   ```ts
    deps.shuffle = prefer(['a']);   // 'b' in the lower-photo test
    const at = await handle(ask.session, photo(3), CTX, deps);   // photo(4) in the lower-photo test
    expect(at.session.state).toBe('ASK_POSE_COUNT');
    const c = await handle(at.session, tap(at, 'count', '1'), CTX, deps);
    await handle(c.session, tap(c, 'generate'), CTX, deps);
   ```
5. `describe('engine: progress and delivery')`: `More poses returns to the cards…` → rename `More poses returns to the count question with the garment, type, face and seen looks kept`, expect `{ state: 'ASK_POSE_COUNT', garmentType: { id: 'gt-shirt' }, faceId: 'face-1', picked: [], seenLooks: ['a', 'c'] }`. (Delivery message assertions change in Task 5.)
6. Add to `describe('engine: random draw')`:
```ts
  it('More poses draws looks the seller has not had, then starts over when the pool runs out', async () => {
    const { deps } = fakeDeps();
    const first = await generated(deps, ['a', 'b']);
    const done = await handle(first.session, { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] }, CTX, deps);
    deps.shuffle = (ids) => ids;
    const again = await handle(done.session, tap(done, 'more_poses'), CTX, deps);
    const c2 = await handle(again.session, tap(again, 'count', '2'), CTX, deps);
    const second = await handle(c2.session, tap(c2, 'generate'), CTX, deps);
    // 'a' and 'b' were had: only 'c' is new, so one reused look tops it up.
    expect(second.session.picked).toEqual(['c', 'a']);
    expect(second.session.seenLooks).toEqual(['c', 'a']);
  });
```

- [ ] **Step 2: Session-store test**

Create `apps/api/test/messaging-session-store.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadSession } from '../src/modules/messaging/session-store';

const redisWith = (value: unknown) =>
  ({ get: async () => JSON.stringify(value) }) as unknown as Parameters<typeof loadSession>[0];
const base = { v: 1, nonce: 'n1', page: 0, aspectRatio: '3:4', resolution: 'HD', photos: {}, picked: [] };

describe('loadSession: sessions saved by the card-picking flow', () => {
  it('reads PICK_LOOKS as the pose count question and drops the old recognition ticket', async () => {
    const s = await loadSession(redisWith({ ...base, state: 'PICK_LOOKS', recognition: { requestId: 'r' } }), 'whatsapp', '1');
    expect(s?.state).toBe('ASK_POSE_COUNT');
    expect(s).not.toHaveProperty('recognition');
  });

  it('reads CONFIRM_GARMENT_TYPE as the garment-type list', async () => {
    const s = await loadSession(redisWith({ ...base, state: 'CONFIRM_GARMENT_TYPE' }), 'whatsapp', '1');
    expect(s?.state).toBe('ASK_GARMENT_TYPE');
  });

  it('leaves current states alone', async () => {
    const s = await loadSession(redisWith({ ...base, state: 'ASK_GENDER' }), 'whatsapp', '1');
    expect(s?.state).toBe('ASK_GENDER');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsc --noEmit -p . ; npx vitest run messaging` — Expected: type errors and failures (new states/deps do not exist).

- [ ] **Step 4: Implement — types and deps**

`engine/types.ts`: in `State` replace `'PICK_LOOKS'` with `'ASK_POSE_COUNT'` and add `'CONFIRM_GENERATE'` after it; update the comment above `State` to `// Flow 2 (2026-10-22): photo → (kind confirmed) → gender → garment type → required extra photos → pose count → confirm → generating → delivered.` In `Session`: delete `recognized?` and its comment; replace the `picked` comment/fields block with
```ts
  // How many poses the seller asked for (one of POSE_COUNTS), until Generate.
  count?: number;
  // The looks drawn for the last Generate (what Retry reads).
  picked: string[];
  // Looks already generated for this garment, so "More poses" shows new ones.
  seenLooks?: string[];
```
In `EngineDeps` add:
```ts
  // Randomises look ids (injected so the engine stays pure and tests can pin the draw).
  shuffle(ids: string[]): string[];
```
`deps.ts`: add `import { randomInt } from 'node:crypto';` (merge with an existing `node:crypto` import if present) and the dep
```ts
    shuffle: (ids) => {
      const a = [...ids];
      for (let i = a.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
```
`session-store.ts` — replace the return in `loadSession`:
```ts
  const s = JSON.parse(raw) as Session & { recognition?: unknown };
  // A session written by an incompatible engine version starts over cleanly.
  if (s.v !== 1) return null;
  // Flow 2: pose picking became a count question and recognition no longer
  // rides in the session; a session saved mid-step by the old flow carries on.
  const state = s.state as string;
  if (state === 'PICK_LOOKS') s.state = 'ASK_POSE_COUNT';
  if (state === 'CONFIRM_GARMENT_TYPE') s.state = 'ASK_GARMENT_TYPE';
  delete s.recognition;
  return s;
```

- [ ] **Step 5: Implement — copy**

`engine/copy.ts`: delete `pickPrompt`, `pickCards`, `pickFooter`, `selected`, `pickAtLeastOne`, `pickCap`, `btnSelect`, `btnClear`, `moreOptions`. Add/replace:
```ts
  btnDifferentNumber: 'Different number',
  countPrompt: (category: string, garment: string, perImage: number, balance: number) =>
    `Great! Let's create your catalogue. ✨\nCategory: ${category}\nGarment: ${garment}\n\nCredits per pose: ${perImage} credits\nAvailable balance: ${balance} credits\n\nHow many poses would you like to generate for your catalogue?\nYou can choose one option below. Each pose will use ${perImage} credits.`,
  countOption: (n: number, credits: number) =>
    `${n} ${n === 1 ? 'pose' : 'poses'} (${credits} credits)`,
  confirmGenerate: (n: number, category: string, garment: string, credits: number, remaining: number) =>
    `Perfect! You've selected ${n} ${n === 1 ? 'pose' : 'poses'}.\nCategory: ${category} | Garment: ${garment}\nCredits required: ${credits} credits\nRemaining balance: ${remaining} credits\n\nDo you want to proceed with ${n} ${n === 1 ? 'pose' : 'poses'}?`,
  generating: (n: number) =>
    `Generating your ${n} ${n === 1 ? 'pose' : 'poses'}...\nWe're creating your catalogue images.\nThis may take a few seconds.`,
```
(`btnSelect` is still referenced by `render.ts`'s unused carousel code — keep `btnSelect: 'Select'` unless `tsc` shows it unused-and-unreferenced; if `render.ts` references it, leave it.)

- [ ] **Step 6: Implement — engine**

`engine/engine.ts`:

a) Imports: replace `MAX_PICKS` with `drawLooks, poseCountOptions, POSE_COUNTS` in the `rules.js` import; keep `PickCard`.
b) Delete `CARDS_PER_PAGE` and the `cardsMsgs` function.
c) `picksCleared`: `return { ...s, picked: [], count: undefined, runs: undefined, unstarted: undefined };`
d) `chooseGarmentType`: drop the `recognized` parameter and field; target state `firstMissingSlot(loaded.session) ? 'ASK_EXTRA_PHOTO' : 'ASK_POSE_COUNT'`. Update both callers (`chooseGarmentType(withGender, gt, out, ctx, deps)` in `ASK_GENDER`; `chooseGarmentType(s, gt, out, ctx, deps)` in `ASK_GARMENT_TYPE`).
e) `createRejected` (BAD_CATALOG) → `enter({ ...s, picked: [], count: undefined }, 'ASK_POSE_COUNT', out, ctx, deps)`.
f) `generate()`: replace `enter(ls, 'PICK_LOOKS', …)` with `enter(ls, 'ASK_POSE_COUNT', …)` and the generating message with `out.push(text(COPY.generating(started)));` (delete the now-unused credits argument and comment lines about the prompt's quote).
g) `ASK_EXTRA_PHOTO` render: `if (!slot) return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);`. The image handler's `firstMissingSlot(next) ? 'ASK_EXTRA_PHOTO' : 'PICK_LOOKS'` → `'ASK_POSE_COUNT'`.
h) `render`: replace the whole `case 'PICK_LOOKS'` block with:
```ts
    case 'ASK_POSE_COUNT': {
      const loaded = await loadPool(s, deps);
      const first = loaded?.session.templates?.[0];
      if (!loaded || !first || !s.gender || !s.garmentType) {
        return handoff(s, s.garmentType ?? { id: '', label: 'These' }, out, ctx, deps);
      }
      const ls = loaded.session;
      let q: { perImage: number; balance: number };
      try {
        // One look prices one image: the cost per image comes from the same plan
        // resolution the web uses (D17); the count multiplies it.
        q = await deps.quote(ctx.userId, buildTryonBody(ls, first, [first.looks[0].id]));
      } catch (err) {
        // Anything createJob would reject surfaces here, before any credits are taken.
        if (!(err instanceof AppError)) throw err;
        out.push(text(err.message));
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      }
      const next: Session = { ...ls, perImage: q.perImage, balance: q.balance, count: undefined };
      const options = poseCountOptions(loaded.cards.length, q.perImage, q.balance);
      if (options.length === 0) return enter(next, 'NO_CREDITS', out, ctx, deps);
      out.push(
        listMsg(
          next,
          COPY.countPrompt(COPY.genders[s.gender], s.garmentType.label, q.perImage, q.balance),
          options.map((n) => ({
            action: 'count',
            value: String(n),
            title: COPY.countOption(n, n * q.perImage),
          })),
        ),
      );
      return done(next);
    }

    case 'CONFIRM_GENERATE': {
      const { count: n, perImage, gender, garmentType } = s;
      if (!n || perImage === undefined || !gender || !garmentType) {
        return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
      }
      const remaining = (await deps.getBalance(ctx.userId)) - n * perImage;
      out.push(
        buttons(s, COPY.confirmGenerate(n, COPY.genders[gender], garmentType.label, n * perImage, remaining), [
          ['generate', '', COPY.btnGenerate],
          ['recount', '', COPY.btnDifferentNumber],
        ]),
      );
      return done();
    }
```
i) `onReply`: replace the whole `case 'PICK_LOOKS'` block with:
```ts
    case 'ASK_POSE_COUNT': {
      const n = Number(value);
      if (action !== 'count' || !(POSE_COUNTS as readonly number[]).includes(n)) return reprompt();
      return enter({ ...s, count: n }, 'CONFIRM_GENERATE', out, ctx, deps);
    }

    case 'CONFIRM_GENERATE': {
      if (action === 'recount') return enter({ ...s, count: undefined }, 'ASK_POSE_COUNT', out, ctx, deps);
      const n = s.count;
      if (action !== 'generate' || !n) return reprompt();
      const loaded = await loadPool(s, deps);
      if (!loaded) return handoff(s, s.garmentType ?? { id: '', label: 'These' }, out, ctx, deps);
      const ls = loaded.session;
      // Tapping Generate is the agreement to spend (D45). Caught here, before
      // any run exists; createJob checks again.
      const perImage = s.perImage ?? 0;
      if (n * perImage > (await deps.getBalance(ctx.userId))) {
        return enter(ls, 'NO_CREDITS', out, ctx, deps);
      }
      const draw = drawLooks(
        loaded.cards.map((c) => c.id),
        ls.seenLooks ?? [],
        n,
        deps.shuffle,
      );
      return generate({ ...ls, seenLooks: draw.seen }, draw.ids, out, ctx, deps);
    }
```
j) `DELIVERED` reply: `if (action === 'more_poses') return enter(picksCleared(s), 'ASK_POSE_COUNT', out, ctx, deps);`
k) `creditsAdded`: `if (s.state === 'NO_CREDITS') return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);` (update the comment to "Back to the count question").
l) Also `generate()` no longer needs `picked: lookIds` changes — it already sets `picked: lookIds`; leave.

- [ ] **Step 7: Run to verify**

Run: `npx tsc --noEmit -p . && npx vitest run messaging whatsapp` — Expected: no type errors; all pass. If a test still references `PICK_LOOKS`, `'look'` taps or `recognized`, update it per Step 1 (`grep -n "PICK_LOOKS\|'look'\|recognized" test/messaging-engine.test.ts` must show only the legacy-session test at the end of the file, which keeps `PICK_LOOKS` as a cast string on purpose).

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(whatsapp): ask how many poses, confirm, and draw random looks

Replaces the pose carousel and tap-to-select flow: ASK_POSE_COUNT (1/2/3/5 with
credit cost) -> CONFIRM_GENERATE -> drawLooks. More poses avoids looks already
generated for the garment. Sessions saved by the old flow are mapped on load.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Delivery summary and next-step buttons

**Files:**
- Modify: `apps/api/src/modules/messaging/engine/copy.ts`, `engine/engine.ts`
- Modify: `apps/api/test/messaging-engine.test.ts`

**Interfaces:**
- Produces: `DELIVERED` render sends `COPY.deliveredSummary(...)` (when ≥ 1 image succeeded) then buttons `[Retry failed | More poses | Menu]` (when retryable) or `[More poses | Change garment | New catalog]`; reply `change` on `DELIVERED` → `ASK_GARMENT_TYPE` keeping photo and gender.
- Consumes: `Session.runs`, `Session.perImage`, `deps.getBalance`.

- [ ] **Step 1: Write the failing tests**

In `describe('engine: progress and delivery')` of `test/messaging-engine.test.ts`:

1. Replace `one run finishing with no failures offers more poses and a new catalog` with:
```ts
  it('one run finishing summarises the credits used and offers the next steps', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const r = await handle(gen.session, finished('run-1', 2), CTX, deps);
    expect(r.session.state).toBe('DELIVERED');
    expect(texts(r.messages)).toContain(
      'Here are your 2 generated poses!\nCategory: Women | Garment: Shirt\nCredits used: 10 credits\nRemaining balance: 50 credits',
    );
    expect(r.messages.at(-1)).toMatchObject({ text: 'What would you like to do next?' });
    expect(buttonTitles(r.messages.at(-1))).toEqual(['More poses', 'Change garment', 'New catalog']);
  });

  it('Change garment after delivery returns to the garment-type list, keeping photo and gender', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a']);
    const done = await handle(gen.session, finished('run-1', 1), CTX, deps);
    const r = await handle(done.session, tap(done, 'change'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women', picked: [] });
    expect(r.session.garmentKey).toContain('000000000001');
    expect(r.session.seenLooks).toBeUndefined();
  });
```
2. In `partial failure reports the refund; Retry regenerates only the failed looks` (and the unstarted-retry test), the closing buttons are `['Retry failed', 'More poses', 'Menu']`; update any `buttonTitles` assertion accordingly and assert that when 1 of 2 images failed the summary says `Here are your 1 generated pose!`… (singular: `Here are your 1 generated pose!`) with `Credits used: 5 credits`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run messaging-engine` — Expected: FAIL on the new/updated delivery assertions.

- [ ] **Step 3: Implement**

`engine/copy.ts`: replace `delivered: 'All done. What next?'` with
```ts
  deliveredSummary: (n: number, category: string, garment: string, used: number, remaining: number) =>
    `Here are your ${n} generated ${n === 1 ? 'pose' : 'poses'}!\nCategory: ${category} | Garment: ${garment}\nCredits used: ${used} credits\nRemaining balance: ${remaining} credits`,
  deliveredNext: 'What would you like to do next?',
```
`engine/engine.ts` — replace the `case 'DELIVERED'` block in `render`:
```ts
    case 'DELIVERED': {
      const runs = s.runs ?? [];
      const failed = runs.reduce((n, r) => n + (r.failedPoseIds?.length ?? 0), 0);
      const delivered = runs.reduce((n, r) => n + r.images, 0) - failed;
      // Failed images were refunded, so only the delivered ones were spent.
      if (delivered > 0 && s.gender && s.garmentType) {
        out.push(
          text(
            COPY.deliveredSummary(
              delivered,
              COPY.genders[s.gender],
              s.garmentType.label,
              delivered * (s.perImage ?? 0),
              await deps.getBalance(ctx.userId),
            ),
          ),
        );
      }
      const retryable = retryLookIds(s).length > 0;
      const items: [string, string, string][] = retryable
        ? [
            ['retry', '', COPY.btnRetryFailed],
            ['more_poses', '', COPY.btnMorePoses],
            ['menu', 'menu', COPY.btnMenu],
          ]
        : [
            ['more_poses', '', COPY.btnMorePoses],
            ['change', '', COPY.btnChangeGarment],
            ['menu', 'new', COPY.btnNewCatalog],
          ];
      out.push(buttons(s, COPY.deliveredNext, items));
      return done();
    }
```
`onReply` `case 'DELIVERED'`: add before `return reprompt()`:
```ts
      if (action === 'change') return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc --noEmit -p . && npx vitest run messaging whatsapp` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(whatsapp): delivery summary with credits used and the Flow 2 next steps

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cleanup, docs and full verification

**Files:**
- Modify: `apps/api/src/modules/messaging/engine/rules.ts`, `apps/api/test/messaging-rules.test.ts`
- Modify: `apps/api/src/modules/messaging/inbound-consumer.ts` (comment)
- Modify: `docs/progress.md`, `docs/superpowers/handoff/2026-10-21-whatsapp-pose-cards-and-classify.md`

- [ ] **Step 1: Remove what nothing uses**

Run `grep -rn "MAX_PICKS\|PickCard\|btnClear\|moreOptions\|startRecognition\|resolveRecognition\|RecognitionTicket\|CONFIRM_GARMENT_TYPE" apps/api/src apps/api/test`. Expected remaining hits: `PickCard` in `engine/types.ts`/`rules.ts`/`engine.ts` (still produced by `buildPool` and read for ids — keep), `CONFIRM_GARMENT_TYPE` only inside `session-store.ts` and its test. Delete `MAX_PICKS` from `rules.ts` (and its comment) and the `describe('MAX_PICKS')` block from `messaging-rules.test.ts`. Remove any other hit that is genuinely dead.

- [ ] **Step 2: Fix the stale comment**

In `inbound-consumer.ts`, the `withSenderLock` doc says the 15 s wait "outlasts a gender tap's recognition wait (8 s, plan 2 D48)". Change to: `The wait budget (15 s) outlasts the photo step's recognition wait (RECOGNITION_BUDGET_MS, 12 s): the seller's next message queues behind it instead of failing.`

- [ ] **Step 3: Docs**

Read the top ~40 lines of `docs/progress.md` and add a dated entry (newest first, same Done / Failed-Not-Done / Open Questions layout) for 2026-10-22: Flow 2 implemented (what changed, files), deviations (summary sent after the images; "Different number"; "a top"), `garment_recognitions.gender` now null for new rows, outstanding real-device checks (list rows, 12 s silent wait, ordering feel). Update the handoff doc `docs/superpowers/handoff/2026-10-21-whatsapp-pose-cards-and-classify.md` with a one-line pointer at the top: `Superseded by docs/superpowers/plans/2026-10-22-whatsapp-flow-2.md (implementation) — the carousel/pose-picking parts below are removed by Flow 2.`

- [ ] **Step 4: Full verification**

Run, from `apps/api`:
- `npx tsc --noEmit -p .` — no output.
- `npx vitest run` — all unit tests pass (paste the summary line).
- `timeout 170 npx vitest run --config vitest.integration.config.ts messaging-classify` — pass (needs `pnpm docker:up`).
- From the repo root: `npx biome check apps/api docs` is clean for the touched files.
- Manual, if a WhatsApp test number is available: photo → kind confirm → gender → count list → confirm → generate → delivery summary and buttons; "More poses" returns new poses; "No, different item" → gender → list.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api docs
git commit -m "chore(whatsapp): remove pose-picking leftovers; progress and handoff notes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**
- Confirm step before spending → Task 4 (`CONFIRM_GENERATE`, balance re-check).
- Classify at upload, kind-level confirm, copy "a top" → Tasks 1, 3.
- "No, different item" → gender → that gender's list → Task 3 (`change` → `ASK_GENDER` → `ASK_GARMENT_TYPE`).
- Fixed counts 1/2/3/5 with credit labels, capped by pool and balance → Tasks 2, 4.
- No pose showcase/picking; random draw at Generate; avoid repeats; refill → Tasks 2 (`drawLooks`), 4.
- `seenLooks` cleared by a new photo / garment change, kept by More poses and Different number → `cleared`/`garmentCleared` drop it; `picksCleared` and `recount` keep it (Tasks 4, 5 tests).
- Delivery summary, Change garment / New catalogue → Task 5.
- Compatibility for Redis sessions → Task 4 (`session-store.ts` + test).
- Tests listed in the spec → Tasks 1–5. Risks (12 s wait, lock budget comment) → Global Constraints + Task 6.

**Placeholder scan:** no TBD/TODO; every code step has code. Task 4 step 1 edits existing tests by precise instruction plus full new test code; the handful of unchanged tests (`lower slot`, `default shoe`, `lower-only`) are named and must pass without edits.

**Type consistency:** `recognizeKind` / `typeForKind` / `shuffle` signatures identical in `classify.ts`, `types.ts`, `deps.ts`, fakes. `drawLooks` returns `{ ids, seen }` and `engine.ts` uses `draw.ids` / `draw.seen`. Reply ids: `confirm`/`change` (CONFIRM_KIND), `count`, `generate`/`recount`, DELIVERED `retry`/`more_poses`/`change`/`menu`. State names: `CONFIRM_KIND`, `ASK_POSE_COUNT`, `CONFIRM_GENERATE` used consistently. `Session.recognized` exists in Task 3 (set by `chooseGarmentType`) and is removed in Task 4 together with its last reader.

**Known deviations:** summary after images (not before); "Different number"; "New catalog" spelling kept from existing menu copy; welcome/menu copy untouched.
