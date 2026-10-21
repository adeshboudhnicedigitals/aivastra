# WhatsApp bot v2 — P0 (no dead ends) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bot's four "not available" dead ends with a studio hand-off that keeps the seller's session, and give every dead end a precise, counted reason.

**Architecture:** A pure `decideReadiness(facts)` function turns facts about a (gender, garment type) into `ready | degraded | blocked` plus reasons. `EngineDeps` gains `getReadiness` (reasons for the recognised-but-not-offered path) and `createStudioDraft` (a Redis-held, owner-bound draft token). The engine's `notAvailable` becomes `handoff`: it sends a draft link and re-lists the types instead of clearing the session. A Prometheus counter records every reason.

**Tech Stack:** TypeScript (ESM), Fastify 5, Drizzle, Redis, Vitest, prom-client via `@aivastra/observability`.

**Spec:** `docs/superpowers/specs/2026-10-21-whatsapp-bot-v2-design.md` (decisions V1, V3, V4, V5-interim). This plan is **P0 only**.

## Global Constraints

- No schema or data changes against production; the resolver only reads (CLAUDE.md "Production safety").
- No new migration: drafts live in Redis, readiness is computed.
- ESM only; import api-local files with a `.js` suffix; no `console.log` (pino via `app.log`).
- Gates guarding access compare `=== true` (tests build `Env` directly; a new flag is `undefined`).
- Match surrounding code: comment the *why*, keep `engine.ts` free of I/O (it only calls `EngineDeps`).
- Seller copy: no internal reason ever reaches the chat (spec section 3, V3/V4).
- Commit only complete units; one commit per task below. Do not push.
- Unit tests: `pnpm --filter @aivastra/api test -- <pattern>`. Integration (needs `pnpm docker:up`): from `apps/api`, `npx vitest run --config vitest.integration.config.ts <pattern>`.

## Out of scope (separate plans)

- **Studio consumer of the draft link** (`apps/catalogues-web/src/app/(app)/studio/page.tsx` has no `draft` handling today; it needs to read the token, call `GET /v1/studio/drafts/:token`, set gender, type and `garmentKey`, and show the preview). Until it ships, the link opens the plain studio, which is exactly today's behaviour, so P0 is not a regression.
- Admin readiness matrix (spec P1), parallel recognition and top-3 (spec P2), the Grafana alert rule (infra, lives outside the repo; record it in `docs/progress.md` when created).

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/modules/messaging/readiness.ts` (create) | Pure `decideReadiness(facts)` + types. No I/O. |
| `apps/api/src/modules/messaging/studio-draft.ts` (create) | Redis draft store (`createStudioDraft`, `readStudioDraft`). |
| `apps/api/src/modules/messaging/studio-draft.routes.ts` (create) | `GET /v1/studio/drafts/:token`. |
| `apps/api/src/modules/messaging/engine/types.ts` (modify) | `ReadinessReason` re-export, wider `UnavailableReport.reason`, two new `EngineDeps` members. |
| `apps/api/src/modules/messaging/engine/copy.ts` (modify) | `handoff` copy replaces `notAvailable`. |
| `apps/api/src/modules/messaging/engine/engine.ts` (modify) | `notAvailable` → `handoff`; report reasons on the recognised path. |
| `apps/api/src/modules/messaging/deps.ts` (modify) | Real `getReadiness`, `createStudioDraft`, counter in `reportUnavailable`. |
| `apps/api/src/server.ts` (modify) | Register the draft route. |
| `packages/observability/src/metrics.ts` (modify) | `whatsappGarmentUnavailableTotal`. |
| `apps/api/test/messaging-readiness.test.ts` (create) | Decision-table unit test. |
| `apps/api/test/helpers/engine-fakes.ts`, `apps/api/test/messaging-engine.test.ts` (modify) | Fakes + the two existing dead-end tests. |
| `apps/api/test/integration/messaging-studio-draft.test.ts` (create) | Draft route integration test. |

---

### Task 1: Pure readiness decision

**Files:**
- Create: `apps/api/src/modules/messaging/readiness.ts`
- Test: `apps/api/test/messaging-readiness.test.ts`

**Interfaces:**
- Produces: `ReadinessReason`, `ReadinessFacts`, `Readiness`, `decideReadiness(facts: ReadinessFacts): Readiness`. Tasks 2 and 4 import these.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/messaging-readiness.test.ts
import { describe, expect, it } from 'vitest';
import { decideReadiness, type ReadinessFacts } from '../src/modules/messaging/readiness';

const OK: ReadinessFacts = {
  active: true,
  requiresMannequinStep: false,
  mappedTemplates: 2,
  activeTemplates: 2,
  hasFace: true,
  looksTotal: 6,
  looksUsable: 6,
};
const with_ = (over: Partial<ReadinessFacts>) => decideReadiness({ ...OK, ...over });

describe('decideReadiness', () => {
  it('ready when everything is in place', () => {
    expect(with_({})).toEqual({ status: 'ready', reasons: [] });
  });

  it.each([
    [{ active: false }, 'inactive'],
    [{ requiresMannequinStep: true }, 'mannequin_flow'],
    [{ mappedTemplates: 0, activeTemplates: 0 }, 'no_mapping'],
    [{ activeTemplates: 0 }, 'template_inactive'],
  ] as const)('blocked on a structural gap %j -> %s', (over, reason) => {
    expect(with_(over)).toEqual({ status: 'blocked', reasons: [reason] });
  });

  it('a structural gap hides the facts that depend on it', () => {
    // No active template means the face and look counts are meaningless.
    expect(with_({ activeTemplates: 0, hasFace: false, looksUsable: 0 }).reasons).toEqual([
      'template_inactive',
    ]);
  });

  it('collects a missing face and missing looks together', () => {
    expect(with_({ hasFace: false, looksUsable: 0 })).toEqual({
      status: 'blocked',
      reasons: ['no_face', 'no_eligible_looks'],
    });
  });

  it('degraded when some looks were dropped but some remain', () => {
    expect(with_({ looksUsable: 2 })).toEqual({ status: 'degraded', reasons: ['looks_dropped'] });
  });

  it('no looks at all is blocked, not degraded', () => {
    expect(with_({ looksTotal: 0, looksUsable: 0 })).toEqual({
      status: 'blocked',
      reasons: ['no_eligible_looks'],
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @aivastra/api test -- messaging-readiness`
Expected: FAIL, cannot resolve `../src/modules/messaging/readiness`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/modules/messaging/readiness.ts

/**
 * Why a garment type cannot (fully) be offered in the chat. The seller never
 * sees these; they go to the log, a counter and, later, the admin matrix.
 */
export type ReadinessReason =
  | 'inactive'
  | 'mannequin_flow'
  | 'no_mapping'
  | 'template_inactive'
  | 'no_face'
  | 'no_eligible_looks'
  | 'looks_dropped';

export interface ReadinessFacts {
  // garment_subcategories.is_active for the gender.
  active: boolean;
  // The two-step saree flow, which the bot does not run (D16/D31).
  requiresMannequinStep: boolean;
  // catalogue_template_subcategories rows for the type and gender, active or not.
  mappedTemplates: number;
  // Those whose template is active.
  activeTemplates: number;
  hasFace: boolean;
  // Distinct (pose, background) looks across the active templates, before and
  // after the eligibility filter (rules.ts buildPool, D49).
  looksTotal: number;
  looksUsable: number;
}

export interface Readiness {
  status: 'ready' | 'degraded' | 'blocked';
  reasons: ReadinessReason[];
}

/**
 * One answer to "can the bot offer this type?". Structural gaps short-circuit,
 * because a face or look count means nothing without an active template; face
 * and look gaps are independent, so both are reported.
 */
export function decideReadiness(f: ReadinessFacts): Readiness {
  const blocked = (...reasons: ReadinessReason[]): Readiness => ({ status: 'blocked', reasons });
  if (!f.active) return blocked('inactive');
  if (f.requiresMannequinStep) return blocked('mannequin_flow');
  if (f.mappedTemplates === 0) return blocked('no_mapping');
  if (f.activeTemplates === 0) return blocked('template_inactive');

  const reasons: ReadinessReason[] = [];
  if (!f.hasFace) reasons.push('no_face');
  if (f.looksUsable === 0) reasons.push('no_eligible_looks');
  if (reasons.length > 0) return blocked(...reasons);
  if (f.looksUsable < f.looksTotal) return { status: 'degraded', reasons: ['looks_dropped'] };
  return { status: 'ready', reasons: [] };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @aivastra/api test -- messaging-readiness`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/messaging/readiness.ts apps/api/test/messaging-readiness.test.ts
git commit -m "feat(whatsapp): add pure garment readiness decision"
```
(End the message with the `Co-Authored-By` line from the session's attribution reminder.)

---

### Task 2: Engine hand-off instead of dead ends

**Files:**
- Modify: `apps/api/src/modules/messaging/engine/types.ts`
- Modify: `apps/api/src/modules/messaging/engine/copy.ts:48-49`
- Modify: `apps/api/src/modules/messaging/engine/engine.ts` (`notAvailable` def near line 180, its call sites, the `ASK_GENDER` hit branch near line 496)
- Modify: `apps/api/test/helpers/engine-fakes.ts`
- Test: `apps/api/test/messaging-engine.test.ts` (the two tests at "a recognised type the bot cannot offer" and "no template, no face, or no eligible look")

**Interfaces:**
- Consumes: `Readiness`, `ReadinessReason` from Task 1.
- Produces on `EngineDeps`:
  - `getReadiness(gender: Gender, garmentTypeId: string): Promise<Readiness>`
  - `createStudioDraft(d: { userId: string; gender: Gender; garmentTypeId: string; garmentKey: string }): Promise<string>` (returns the full URL to send; implementations fall back to the plain studio link, never throw)

- [ ] **Step 1: Update the two existing tests to the new behaviour (they fail first)**

In `apps/api/test/messaging-engine.test.ts`, replace the two tests with:

```ts
  it('a recognised type the bot cannot offer hands off to the studio, keeps the session and reports why', async () => {
    const { deps, calls } = fakeDeps({
      recognizeGarment: async () => ({ garmentTypeId: 'gt-saree', label: 'Saree' }),
      getReadiness: async () => ({ status: 'blocked', reasons: ['mannequin_flow'] }),
    });
    const r = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(texts(r.messages)[0]).toMatch(
      /^Saree catalogs can't be made on WhatsApp yet\. Your photo is saved .*https:\/\/app\.test\/studio\?draft=/,
    );
    // The seller keeps their photo and gender and gets the type list.
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

  it('no template, no face, or no eligible look hands off and the reason is reported', async () => {
    // The seller only sees the hand-off; the reason goes to the log and counter,
    // so an admin-data gap (no face, no template, every look needing a missing
    // default lower/shoe under D49) is found without stepping through the engine.
    const shoeOnly = { ...TEMPLATE, looks: [look('s', { hasShoes: true })] };
    for (const [over, reason] of [
      [{ getTemplates: async () => [] }, 'no_template'],
      [{ getDefaultFaceId: async () => null }, 'no_face'],
      [{ getTemplates: async () => [shoeOnly] }, 'no_eligible_looks'],
    ] as const) {
      const { deps, calls } = fakeDeps(over);
      const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
      const r = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
      expect(texts(r.messages)[0]).toMatch(/^Shirt catalogs can't be made on WhatsApp yet/);
      expect(r.session.state).toBe('ASK_GARMENT_TYPE');
      expect(r.session.gender).toBe('women');
      expect(calls.unavailable).toEqual([
        expect.objectContaining({ gender: 'women', garmentTypeId: 'gt-shirt', reason }),
      ]);
    }
  });
```

- [ ] **Step 2: Add the fake deps the tests need**

In `apps/api/test/helpers/engine-fakes.ts`, inside `fakeDeps`' `deps` object, after `reportUnavailable`:

```ts
    getReadiness: async () => ({ status: 'ready', reasons: [] }),
    createStudioDraft: async (d) => `https://app.test/studio?draft=${d.garmentKey}`,
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @aivastra/api test -- messaging-engine`
Expected: FAIL, type errors for the unknown `getReadiness` / `createStudioDraft` members (and the two tests failing on the old copy).

- [ ] **Step 4: Extend the types**

In `engine/types.ts`, add after the `Quote` interface's imports area (top of file, after the zod import):

```ts
import type { Readiness, ReadinessReason } from '../readiness.js';

export type { Readiness, ReadinessReason };
```

Change `UnavailableReport.reason` to:

```ts
  // 'no_template' is the engine's own: getTemplates returned nothing. The rest
  // are readiness reasons (readiness.ts), reported for a recognised type the
  // list does not offer.
  reason: ReadinessReason | 'no_template';
```

Add to `EngineDeps`, after `reportUnavailable`:

```ts
  // Why a type is not offered, from the same facts the studio reads. Only the
  // recognised-but-not-listed path needs it; the other dead ends already know.
  getReadiness(gender: Gender, garmentTypeId: string): Promise<Readiness>;
  // A studio link that opens with this photo, gender and type loaded. Never
  // throws: on any failure it returns the plain studio link.
  createStudioDraft(d: {
    userId: string;
    gender: Gender;
    garmentTypeId: string;
    garmentKey: string;
  }): Promise<string>;
```

- [ ] **Step 5: Replace the copy**

In `engine/copy.ts` replace `notAvailable` with:

```ts
  // The photo is already saved server-side (draft link), so the seller loses
  // nothing by leaving the chat; the type list follows for those who stay.
  handoff: (label: string, url: string) =>
    `${label} catalogs can't be made on WhatsApp yet. Your photo is saved — continue in the web studio: ${url}\n\nOr choose another type.`,
```

- [ ] **Step 6: Replace `notAvailable` with `handoff` in the engine**

In `engine/engine.ts` replace the `notAvailable` function (the one containing `COPY.notAvailable`) with:

```ts
/**
 * The type cannot be made in the chat. Instead of clearing the session (and the
 * seller's photo), send a studio draft link and show the type list again, so
 * they can continue on the web or pick another type here.
 */
async function handoff(
  s: Session,
  gt: { id: string; label: string },
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
) {
  const url =
    s.gender && s.garmentKey
      ? await deps.createStudioDraft({
          userId: ctx.userId,
          gender: s.gender as Gender,
          garmentTypeId: gt.id,
          garmentKey: s.garmentKey,
        })
      : deps.links.studio;
  out.push(text(COPY.handoff(gt.label, url)));
  return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
}
```

Then run `grep -n "notAvailable(" apps/api/src/modules/messaging/engine/engine.ts` and update each call site:
- in `chooseGarmentType`: `return notAvailable(s, gt.label, out, ctx, deps);` → `return handoff(s, gt, out, ctx, deps);`
- in the `ASK_GENDER` hit branch, replace
  `if (!gt) return notAvailable(withGender, hit.label, out, ctx, deps);` with:

```ts
        if (!gt) {
          // Report why, from the same facts the studio reads, so an admin sees
          // "template_inactive" rather than a bare "not offered".
          const { reasons } = await deps.getReadiness(gender, hit.garmentTypeId);
          for (const reason of reasons) {
            deps.reportUnavailable({ gender, garmentTypeId: hit.garmentTypeId, reason });
          }
          return handoff(withGender, { id: hit.garmentTypeId, label: hit.label }, out, ctx, deps);
        }
```

Also update the comment above that branch ("a saree two-step type, no template: say so…") to "hand the seller to the studio rather than pretend we didn't know."

- [ ] **Step 7: Run to verify pass**

Run: `pnpm --filter @aivastra/api test -- messaging-engine && pnpm --filter @aivastra/api typecheck`
Expected: PASS; typecheck will still fail in `deps.ts` (missing members). That is fixed in Task 4, so run only the vitest part here and confirm the engine tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/messaging/engine apps/api/test/helpers/engine-fakes.ts apps/api/test/messaging-engine.test.ts
git commit -m "feat(whatsapp): hand off to the studio instead of a dead end"
```

---

### Task 3: Studio draft store and route

**Files:**
- Create: `apps/api/src/modules/messaging/studio-draft.ts`
- Create: `apps/api/src/modules/messaging/studio-draft.routes.ts`
- Modify: `apps/api/src/server.ts` (next to `messagingConnectRoutes` at ~line 94 and ~424)
- Test: `apps/api/test/integration/messaging-studio-draft.test.ts`

**Interfaces:**
- Produces: `StudioDraft`, `createStudioDraftToken(redis, d): Promise<string>`, `readStudioDraft(redis, token, userId): Promise<StudioDraft | null>`, route `GET /v1/studio/drafts/:token`.

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/api/test/integration/messaging-studio-draft.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStudioDraftToken } from '../../src/modules/messaging/studio-draft';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
// Unique per run: integration files share one Postgres process.
const uniq = () => Math.floor(Math.random() * 1e9).toString();

describe('studio drafts', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {});
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('requires a logged-in user', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/studio/drafts/${'a'.repeat(32)}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns the draft to its owner', async () => {
    const { token, userId } = await createVerifiedUserToken(app, `draft-${uniq()}@example.com`);
    const t = await createStudioDraftToken(app.redis, {
      userId,
      gender: 'women',
      garmentTypeId: 'gt-1',
      garmentKey: 'uploads/x.jpg',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/studio/drafts/${t}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      gender: 'women',
      garmentTypeId: 'gt-1',
      garmentKey: 'uploads/x.jpg',
    });
  });

  it("is a 404 for someone else's draft, same as an unknown one", async () => {
    const owner = await createVerifiedUserToken(app, `draft-o-${uniq()}@example.com`);
    const other = await createVerifiedUserToken(app, `draft-x-${uniq()}@example.com`);
    const t = await createStudioDraftToken(app.redis, {
      userId: owner.userId,
      gender: 'men',
      garmentTypeId: 'gt-2',
      garmentKey: 'uploads/y.jpg',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/studio/drafts/${t}`,
      headers: auth(other.token),
    });
    expect(res.statusCode).toBe(404);
    const missing = await app.inject({
      method: 'GET',
      url: `/v1/studio/drafts/${'b'.repeat(32)}`,
      headers: auth(other.token),
    });
    expect(missing.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts messaging-studio-draft`
Expected: FAIL, cannot resolve `studio-draft`.

- [ ] **Step 3: Write the store**

```ts
// apps/api/src/modules/messaging/studio-draft.ts
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

// Same window as the upload ownership binding (`upload:owner:<key>`, 24h): the
// studio can only create a job from the garment key while that binding holds,
// so a longer draft would link to a photo the studio can no longer use.
export const DRAFT_TTL_SEC = 24 * 60 * 60;

export interface StudioDraft {
  userId: string;
  gender: string;
  garmentTypeId: string;
  garmentKey: string;
}

const key = (token: string) => `studio:draft:${token}`;

/** Stores a draft and returns its token (128 bits, hex). */
export async function createStudioDraftToken(redis: Redis, d: StudioDraft): Promise<string> {
  const token = randomBytes(16).toString('hex');
  await redis.set(key(token), JSON.stringify(d), 'EX', DRAFT_TTL_SEC);
  return token;
}

/**
 * The draft, only to the user it was made for. A token for someone else's draft
 * reads as missing, so the route cannot be used to probe for valid tokens.
 */
export async function readStudioDraft(
  redis: Redis,
  token: string,
  userId: string,
): Promise<StudioDraft | null> {
  const raw = await redis.get(key(token));
  if (!raw) return null;
  const d = JSON.parse(raw) as StudioDraft;
  return d.userId === userId ? d : null;
}
```

Check the Redis type the repo uses first: `grep -n "redis" apps/api/src/plugins/*.ts | head`; if the decorated type is not `ioredis`' `Redis`, import that type instead (the same one `identity.ts` uses for `createWebConnectCode(app.redis, …)`).

- [ ] **Step 4: Write the route**

```ts
// apps/api/src/modules/messaging/studio-draft.routes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { readStudioDraft } from './studio-draft.js';

const Params = z.object({ token: z.string().regex(/^[a-f0-9]{32}$/) });

/**
 * The studio reads the draft a WhatsApp hand-off link points at. Tokens travel
 * in the path (not a query string logged elsewhere with the user's data), expire
 * with the upload binding, and only the owner can read one.
 */
export async function studioDraftRoutes(app: FastifyInstance) {
  app.get('/v1/studio/drafts/:token', async (req) => {
    const parsed = Params.safeParse(req.params);
    const draft = parsed.success
      ? await readStudioDraft(app.redis, parsed.data.token, req.userId)
      : null;
    if (!draft) throw new AppError('NOT_FOUND', 404, 'not found');
    return {
      gender: draft.gender,
      garmentTypeId: draft.garmentTypeId,
      garmentKey: draft.garmentKey,
    };
  });
}
```

- [ ] **Step 5: Register it**

In `apps/api/src/server.ts` add the import next to line 94:
`import { studioDraftRoutes } from './modules/messaging/studio-draft.routes.js';`
and after `await app.register(messagingConnectRoutes);` (~line 424):
`await app.register(studioDraftRoutes);`

- [ ] **Step 6: Run to verify pass**

Run (from `apps/api`, with `pnpm docker:up` running): `npx vitest run --config vitest.integration.config.ts messaging-studio-draft`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/messaging/studio-draft.ts apps/api/src/modules/messaging/studio-draft.routes.ts apps/api/src/server.ts apps/api/test/integration/messaging-studio-draft.test.ts
git commit -m "feat(api): owner-bound studio draft tokens for the WhatsApp hand-off"
```

---

### Task 4: Wire real deps and the counter

**Files:**
- Modify: `packages/observability/src/metrics.ts` (after `garmentClassifyCorrectedTotal`)
- Modify: `apps/api/src/modules/messaging/deps.ts`

**Interfaces:**
- Consumes: `decideReadiness`/`ReadinessFacts` (Task 1), `createStudioDraftToken` (Task 3), `EngineDeps.getReadiness`/`createStudioDraft` (Task 2), `buildPool` from `engine/rules.js`.

- [ ] **Step 1: Add the counter**

In `packages/observability/src/metrics.ts`, after `garmentClassifyCorrectedTotal`:

```ts
// One increment per reason a garment type was not offered to a WhatsApp seller.
// A sudden rise in template_inactive / no_mapping is the signal the October
// incident (all 140 catalogue templates inactive) lacked.
export const whatsappGarmentUnavailableTotal = new Counter({
  name: 'whatsapp_garment_unavailable_total',
  help: 'Garment types the WhatsApp bot could not offer, by reason',
  labelNames: ['reason'] as const,
  registers: [register],
});
```

Confirm it is exported from the package index the same way `garmentClassifyOutcomeTotal` is (`grep -n "garmentClassifyOutcomeTotal" packages/observability/src/index.ts`; add if the index lists names explicitly).

- [ ] **Step 2: Make `createEngineDeps` self-referential and share the option mapper**

In `deps.ts`:

1. Change `return {` (the one after `const web = …`) to `const deps: EngineDeps = {`, and the closing `};` of that literal to `};` followed by `return deps;`.
2. Add a module-level mapper above `createEngineDeps`, and use it in `listGarmentTypes`'s `.map(...)` so the field list exists once:

```ts
type GarmentTypeRow = Awaited<ReturnType<typeof listGarmentTypes>>['items'][number];

const toGarmentTypeOption = (i: GarmentTypeRow): GarmentTypeOption => ({
  id: i.id,
  label: i.label,
  requiresLowerUpload: i.requiresLowerUpload,
  requiresThirdUpload: i.requiresThirdUpload,
  upperUploadLabel: i.upperUploadLabel,
  lowerUploadLabel: i.lowerUploadLabel,
  thirdUploadLabel: i.thirdUploadLabel,
  defaultLowerCatalogId: i.defaultLowerCatalogId,
  defaultShoeCatalogId: i.defaultShoeCatalogId,
});
```

and the existing `.map((i): GarmentTypeOption => ({ ... }))` becomes `.map(toGarmentTypeOption)`.

- [ ] **Step 3: Count and log in `reportUnavailable`**

Replace the `reportUnavailable` line with:

```ts
    // Info, not warn: it is admin data, not a fault, but it is the only trace
    // of why a seller was told a type "isn't available on WhatsApp yet".
    reportUnavailable: (report) => {
      whatsappGarmentUnavailableTotal.inc({ reason: report.reason });
      app.log.info(report, 'whatsapp: garment type not offered');
    },
```

and import `whatsappGarmentUnavailableTotal` from `@aivastra/observability`.

- [ ] **Step 4: Add `getReadiness`**

After `getDefaultFaceId` in the literal:

```ts
    async getReadiness(gender, garmentTypeId) {
      // listGarmentTypes returns active types only, so a miss is "inactive".
      const { items } = await listGarmentTypes(app, gender);
      const gt = items.find((i) => i.id === garmentTypeId);
      if (!gt) {
        return decideReadiness({
          active: false,
          requiresMannequinStep: false,
          mappedTemplates: 0,
          activeTemplates: 0,
          hasFace: false,
          looksTotal: 0,
          looksUsable: 0,
        });
      }
      // Mapping rows regardless of the template's own switch, so "mapped but
      // template off" is told apart from "never mapped".
      const mapped = await app.db
        .select({ isActive: schema.catalogueTemplates.isActive })
        .from(schema.catalogueTemplateSubcategories)
        .innerJoin(
          schema.catalogueTemplates,
          and(
            eq(schema.catalogueTemplates.id, schema.catalogueTemplateSubcategories.templateId),
            eq(schema.catalogueTemplates.genderSlug, gender),
            isNull(schema.catalogueTemplates.deletedAt),
          ),
        )
        .where(eq(schema.catalogueTemplateSubcategories.subcategoryId, garmentTypeId));
      const options = await deps.getTemplates(gender, garmentTypeId);
      const distinct = new Set(
        options.flatMap((t) => t.looks.map((l) => `${l.poseId}:${l.backgroundId}`)),
      );
      return decideReadiness({
        active: true,
        requiresMannequinStep: gt.requiresMannequinStep,
        mappedTemplates: mapped.length,
        activeTemplates: mapped.filter((m) => m.isActive).length,
        hasFace: (await deps.getDefaultFaceId(gender, garmentTypeId)) !== null,
        looksTotal: distinct.size,
        looksUsable: buildPool(toGarmentTypeOption(gt), options).cards.length,
      });
    },

    async createStudioDraft(d) {
      try {
        const token = await createStudioDraftToken(app.redis, d);
        return `${web}/studio?draft=${token}`;
      } catch (err) {
        // The hand-off still works without the photo; never fail the chat on it.
        app.log.warn({ err }, 'whatsapp: studio draft not stored');
        return `${web}/studio`;
      }
    },
```

Add imports: `import { buildPool } from './engine/rules.js';`, `import { decideReadiness } from './readiness.js';`, `import { createStudioDraftToken } from './studio-draft.js';`.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/observability typecheck`
Expected: no errors.
Run: `pnpm --filter @aivastra/api test`
Expected: all unit tests PASS (including `messaging-engine`, `messaging-readiness`).
Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts whatsapp-hooks messaging-conversation messaging-studio-draft`
Expected: PASS. If a conversation/hooks test asserted the old "aren't available" copy or `MAIN_MENU`, update that assertion to the Task 2 behaviour; report which ones changed.

- [ ] **Step 6: Commit**

```bash
git add packages/observability/src/metrics.ts apps/api/src/modules/messaging/deps.ts
git commit -m "feat(whatsapp): count and explain unavailable garment types, issue studio drafts"
```

---

### Task 5: Record state outside the repo

**Files:**
- Modify: `docs/progress.md` (newest entry on top, same format as the entries above it)

- [ ] **Step 1: Add the entry**

Under today's date (2026-10-21): Done (P0 items), Open (studio draft consumer; Grafana alert on `whatsapp_garment_unavailable_total{reason=~"template_inactive|no_mapping"}`, to be created in Grafana, not in this repo; admin matrix P1; parallel recognition P2).

- [ ] **Step 2: Commit**

```bash
git add docs/progress.md
git commit -m "docs(progress): log WhatsApp bot v2 P0"
```

---

## Self-review

- **Spec coverage:** V1 → Tasks 1, 4 (`getReadiness`); V2 partial (routing by status is still list-vs-hand-off; recognition filtering is unchanged on purpose, spec keeps all candidates); V3 → Tasks 2, 3, 4; V4 → Task 4 counter (alert is infra, logged in Task 5); V5-interim → covered by the `mannequin_flow` hand-off path; V6/P1 and P2 → out of scope, listed. Spec open point 3 (does the studio accept pre-filled data) is answered: it does not, hence the out-of-scope follow-up plan.
- **Placeholders:** none; the one conditional (Redis type, observability index export) has an explicit check command.
- **Type consistency:** `Readiness`/`ReadinessReason` defined in Task 1 and re-exported in `types.ts`; `createStudioDraft` (deps) vs `createStudioDraftToken` (store) are deliberately distinct names; `UnavailableReport.reason` widened in Task 2 before `deps.ts` uses it in Task 4.
- **Known gap:** `getReadiness`'s DB gathering has no dedicated test (seeding templates, mappings and faces is heavy). It is exercised only through typecheck and the existing integration suites; a seeded integration test is the first thing to add if it proves wrong in staging.
