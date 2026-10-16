# WhatsApp Pose Selection Across Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "How many poses?" step; show the poses of every active template for the garment type, let the seller tap any number of them (up to 20), and start generation from a running [Generate] button, creating one run per template involved.

**Architecture:** The pure conversation engine (`apps/api/src/modules/messaging/engine/`) gains a *pool* (all templates' eligible looks, de-duplicated), a toggle-style `PICK_LOOKS` step with [Generate]/[Clear], and a multi-run `generate()` that quotes every template group before creating any run, then calls the existing `createRun` once per group. `createJob`, the plan resolver and the database schema are untouched; the session (Redis) gets `templates`/`runs`/`unstarted` instead of `template`/`count`/`runId`/`runImages`/`failedPoseIds`.

**Tech Stack:** TypeScript (ESM), Fastify 5, Vitest (unit + integration against docker Postgres/Redis/MinIO), Drizzle, Biome.

**Spec:** `docs/superpowers/specs/2026-10-14-whatsapp-pose-selection-design.md` (decisions P1–P7). Amends D43/D44/D45/D24 of `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md`.

## Global Constraints

- Commit only when a task says to; **never push** (the user decides when). One commit per task, ending with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No schema or migration change, no change to `apps/api/src/modules/jobs/create.ts`, `delivery.ts` or `runs.ts`.
- Never print a credential value. Never touch production (no ssh, no production database).
- Engine files stay free of I/O: everything external goes through `EngineDeps` (D33).
- Max 20 poses per Generate (`MAX_PICKS`). Reply-button titles ≤ 20 characters, list-row titles ≤ 24, at most 3 buttons per message.
- Idempotency key per template group: `<Meta message id>:<group index>`.
- Run from `apps/api` unless a command says otherwise. Unit tests: `npx vitest run <pattern>`. Integration: `npx vitest run --config vitest.integration.config.ts <pattern>` (needs `pnpm docker:up`).

## Line endings (read before editing)

Every file this plan edits is CRLF in the repo (`grep -c $'\r' <file>` equals its line count). The Edit/Write tools and heredocs produce LF, so wrap every edit like this and never leave a file half-converted:

```bash
to_lf()   { sed -i 's/\r$//' "$@"; }
to_crlf() { sed -i 's/\r*$/\r/' "$@"; }
```

For each existing file: `to_lf <file>` → make the edit → `to_crlf <file>`. New files: write as LF, then `to_crlf <file>`. After a task, `git diff --stat` must show only the intended lines changed (a whole-file diff means the endings were lost).

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/api/src/modules/messaging/engine/types.ts` | Session, State, EngineDeps types | Modify |
| `apps/api/src/modules/messaging/engine/rules.ts` | Pure rules: eligibility, pool, grouping, request body, retry set | Rewrite |
| `apps/api/src/modules/messaging/engine/copy.ts` | Every user-visible string | Modify |
| `apps/api/src/modules/messaging/engine/engine.ts` | The conversation state machine | Rewrite |
| `apps/api/src/modules/messaging/deps.ts` | Real `EngineDeps` | Modify (`getTemplates`) |
| `apps/api/test/helpers/engine-fakes.ts` | Fake deps for unit tests | Rewrite |
| `apps/api/test/messaging-rules.test.ts` | Unit tests for the new rules | Create |
| `apps/api/test/messaging-engine.test.ts` | Engine unit tests | Modify (head edits, tail rewrite) |
| `apps/api/test/integration/messaging-conversation.test.ts` | Real-deps conversation test | Modify |
| `apps/api/test/integration/whatsapp-delivery.test.ts` | Delivery test session seed | Modify (1 hunk) |
| `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md` | Main spec | Modify |
| `docs/progress.md`, `docs/superpowers/handoff/2026-10-13-whatsapp-bot-handoff.md` | Progress log, handoff | Modify |

---

### Task 0: Branch

- [ ] **Step 1: Create a working branch from the current one**

The current branch (`feat/whatsapp-bot-5-recognition`) is where plan 5 is being built, so keep this work separate:

```bash
git status --short            # must print nothing
git switch -c feat/whatsapp-pose-selection
```

Expected: `Switched to a new branch 'feat/whatsapp-pose-selection'`.

---

### Task 1: Engine picks across templates and starts one run per template

**Files:**
- Modify: `apps/api/src/modules/messaging/engine/types.ts`
- Rewrite: `apps/api/src/modules/messaging/engine/rules.ts`
- Modify: `apps/api/src/modules/messaging/engine/copy.ts`
- Rewrite: `apps/api/src/modules/messaging/engine/engine.ts`
- Modify: `apps/api/src/modules/messaging/deps.ts`
- Rewrite: `apps/api/test/helpers/engine-fakes.ts`
- Create: `apps/api/test/messaging-rules.test.ts`
- Modify: `apps/api/test/messaging-engine.test.ts`
- Modify: `apps/api/test/integration/messaging-conversation.test.ts`, `apps/api/test/integration/whatsapp-delivery.test.ts` (only so they still compile and pass)

**Interfaces:**
- Produces (types.ts): `PoolLook`, `PoolTemplate`, `PickCard`, `RunRef`; `Session.templates?`, `Session.runs?`, `Session.unstarted?`; `EngineDeps.getTemplates(gender, garmentTypeId): Promise<TemplateOption[]>`; `State` without `'ASK_POSE_COUNT'`.
- Produces (rules.ts): `MAX_PICKS = 20`; `buildPool(gt, options): { templates: PoolTemplate[]; cards: PickCard[] }`; `groupByTemplate(templates, lookIds): { template: PoolTemplate; lookIds: string[] }[]`; `buildTryonBody(s, template, lookIds): TryonBody`; `retryLookIds(s): string[]`. Unchanged: `eligibleLooks`, `requiredPhotoSlots`, `firstMissingSlot`. Removed: `MAX_POSES`, `maxCount`.

#### Step group A — types and rules (pure, tested first)

- [ ] **Step 1: Edit `types.ts`**

`to_lf apps/api/src/modules/messaging/engine/types.ts`, then apply these four edits.

(a) Replace the header comment

```ts
// Spec section 8: photo → gender → (recognised or listed) garment type →
// required extra photos → pose count → look picks → generating → delivered.
```
with
```ts
// Spec section 8 (amended 2026-10-14): photo → gender → (recognised or listed)
// garment type → required extra photos → pose picks → generating → delivered.
```

(b) Delete the line `  | 'ASK_POSE_COUNT'`.

(c) Directly after the `TemplateOption` interface add:

```ts
// A look as the session keeps it: ids and flags only. Labels and image URLs are
// re-read on every render so a presigned URL never goes stale in Redis, and a
// pool of ~150 looks stays small (spec 2026-10-14, section 5).
export interface PoolLook {
  id: string;
  poseId: string;
  backgroundId: string;
  hasLower: boolean;
  hasShoes: boolean;
}

// One template's eligible looks. `lowerOnly` is decided per template (rules.ts
// eligibleLooks), so a type can mix a lower-only and a full-body template.
export interface PoolTemplate {
  id: string;
  mappingId: string;
  lowerOnly: boolean;
  looks: PoolLook[];
}

// What a carousel card needs, read fresh on every render.
export interface PickCard {
  id: string;
  label: string;
  imageUrl: string;
}

// One create call (one catalogue) of a Generate, and how it ended.
export interface RunRef {
  runId: string;
  images: number;
  finished?: boolean;
  failedPoseIds?: string[];
}
```

(d) In `Session`, replace

```ts
  // The chosen template with only the looks the bot can generate (rules.ts).
  template?: { id: string; mappingId: string; lowerOnly: boolean; looks: TemplateLook[] };
  // Cost per image and balance as shown at the count step (D45).
  perImage?: number;
  balance?: number;
  count?: number;
  // Picked look ids, in tap order.
  picked: string[];
  runId?: string;
  runImages?: number;
  failedPoseIds?: string[];
}
```
with
```ts
  // Every active template of the type, with only the looks the bot can generate
  // (rules.ts buildPool), de-duplicated. Re-read on every pick prompt.
  templates?: PoolTemplate[];
  // Cost per image and balance as shown with the pose cards (D45).
  perImage?: number;
  balance?: number;
  // Picked look ids, in tap order.
  picked: string[];
  // One entry per template group of the last Generate.
  runs?: RunRef[];
  // Picked looks whose run could not be created (a later group failed after an
  // earlier one was charged); [Retry] picks them up with the failed images.
  unstarted?: string[];
}
```

(e) In `EngineDeps`, replace

```ts
  // The top-sorted active template for the type (D43), or null.
  getTemplate(gender: Gender, garmentTypeId: string): Promise<TemplateOption | null>;
```
with
```ts
  // Every active template for the type, in admin order (spec 2026-10-14, P2).
  getTemplates(gender: Gender, garmentTypeId: string): Promise<TemplateOption[]>;
```

Then `to_crlf apps/api/src/modules/messaging/engine/types.ts`.

- [ ] **Step 2: Write the failing rules tests**

Create `apps/api/test/messaging-rules.test.ts` (write as LF, then `to_crlf` it):

```ts
import { describe, expect, it } from 'vitest';
import {
  buildPool,
  buildTryonBody,
  groupByTemplate,
  MAX_PICKS,
  retryLookIds,
} from '../src/modules/messaging/engine/rules';
import type { Session, TemplateOption } from '../src/modules/messaging/engine/types';
import { GT_SHIRT, look, TEMPLATE, TEMPLATE_2 } from './helpers/engine-fakes';

const LOWER_ONLY: TemplateOption = {
  id: 'tpl-3',
  mappingId: 'map-3',
  looks: [look('j', { hasUpper: false, hasLower: true })],
};

const session = (over: Partial<Session> = {}): Session => ({
  v: 1,
  state: 'PICK_LOOKS',
  nonce: 'n1',
  page: 0,
  aspectRatio: '3:4',
  resolution: '2K',
  photos: {},
  picked: [],
  garmentKey: 'inputs/x/garment.jpg',
  faceId: 'face-1',
  garmentType: GT_SHIRT,
  ...over,
});

describe('buildPool', () => {
  it('joins every template, in order, keeping only looks the bot can generate', () => {
    const { templates, cards } = buildPool(GT_SHIRT, [TEMPLATE, TEMPLATE_2]);
    expect(templates.map((t) => t.id)).toEqual(['tpl-1', 'tpl-2']);
    // 'd' needs shoes and GT_SHIRT has no default shoe (D49).
    expect(cards.map((c) => c.id)).toEqual(['a', 'b', 'c', 'e', 'f']);
  });

  it('shows a pose + background pair that appears twice once, under the first template', () => {
    const { templates, cards } = buildPool(GT_SHIRT, [TEMPLATE, TEMPLATE_2]);
    expect(cards.map((c) => c.id)).not.toContain('a2');
    expect(templates[1].looks.map((l) => l.id)).toEqual(['e', 'f']);
  });

  it('decides lowerOnly per template', () => {
    const { templates } = buildPool(GT_SHIRT, [TEMPLATE, LOWER_ONLY]);
    expect(templates.map((t) => [t.id, t.lowerOnly])).toEqual([
      ['tpl-1', false],
      ['tpl-3', true],
    ]);
  });

  it('drops a template with no eligible look', () => {
    const shoeOnly: TemplateOption = {
      id: 'tpl-4',
      mappingId: 'map-4',
      looks: [look('s', { hasShoes: true })],
    };
    const { templates } = buildPool(GT_SHIRT, [shoeOnly, TEMPLATE]);
    expect(templates.map((t) => t.id)).toEqual(['tpl-1']);
  });

  it('keeps ids and flags only in the session pool, and label + image in the cards', () => {
    const { templates, cards } = buildPool(GT_SHIRT, [TEMPLATE]);
    expect(templates[0].looks[1]).toEqual({
      id: 'b',
      poseId: 'pose-b',
      backgroundId: 'bg-b',
      hasLower: true,
      hasShoes: false,
    });
    expect(cards[0]).toEqual({ id: 'a', label: 'Pose a', imageUrl: 'https://img/a.jpg' });
  });
});

describe('groupByTemplate', () => {
  const { templates } = buildPool(GT_SHIRT, [TEMPLATE, TEMPLATE_2]);

  it('groups picks by template, in template order, keeping tap order inside a group', () => {
    expect(groupByTemplate(templates, ['f', 'c', 'e', 'a']).map((g) => [g.template.id, g.lookIds])).toEqual([
      ['tpl-1', ['c', 'a']],
      ['tpl-2', ['f', 'e']],
    ]);
  });

  it('ignores ids that are in no template and skips templates with no pick', () => {
    expect(groupByTemplate(templates, ['e', 'zzz']).map((g) => g.template.id)).toEqual(['tpl-2']);
  });
});

describe('buildTryonBody', () => {
  const { templates } = buildPool(GT_SHIRT, [TEMPLATE, TEMPLATE_2]);

  it('uses the given template mapping and only its looks', () => {
    const body = buildTryonBody(session(), templates[1], ['f', 'e']);
    expect(body.inputs).toMatchObject({
      catalogueTemplateMappingId: 'map-2',
      looks: [
        { poseId: 'pose-f', backgroundId: 'bg-f' },
        { poseId: 'pose-e', backgroundId: 'bg-e' },
      ],
    });
    expect(body.aspectRatio).toBe('3:4');
    expect(body.resolution).toBe('2K');
  });

  it('sends the default lower only when a chosen look has a lower slot', () => {
    expect(buildTryonBody(session(), templates[0], ['a']).inputs).not.toHaveProperty('lowerCatalogId');
    expect(buildTryonBody(session(), templates[0], ['b']).inputs.lowerCatalogId).toBe('lower-default');
  });

  it('sends the photo as the lower garment for a lower-only template', () => {
    const { templates: t } = buildPool(GT_SHIRT, [LOWER_ONLY]);
    const body = buildTryonBody(session(), t[0], ['j']);
    expect(body.inputs.lowerGarmentKey).toBe(body.inputs.upperGarmentKey);
  });

  it('throws when the session lacks the garment or face', () => {
    expect(() => buildTryonBody(session({ garmentKey: undefined }), templates[0], ['a'])).toThrow(
      'session incomplete',
    );
  });
});

describe('retryLookIds', () => {
  const { templates } = buildPool(GT_SHIRT, [TEMPLATE, TEMPLATE_2]);

  it('is the picked looks whose pose failed, plus the unstarted ones, in tap order', () => {
    const s = session({
      templates,
      picked: ['a', 'e', 'c'],
      runs: [
        { runId: 'run-1', images: 2, finished: true, failedPoseIds: ['pose-c'] },
        { runId: 'run-2', images: 1, finished: true },
      ],
      unstarted: ['e'],
    });
    expect(retryLookIds(s)).toEqual(['e', 'c']);
  });

  it('is empty when nothing failed and nothing is unstarted', () => {
    expect(retryLookIds(session({ templates, picked: ['a'], runs: [{ runId: 'r', images: 1 }] }))).toEqual([]);
  });
});

describe('MAX_PICKS', () => {
  it('is 20', () => expect(MAX_PICKS).toBe(20));
});
```

- [ ] **Step 3: Rewrite the fakes (the tests import `TEMPLATE_2`)**

Replace the whole of `apps/api/test/helpers/engine-fakes.ts` with the content below (write LF, then `to_crlf`):

```ts
import { AppError } from '../../src/lib/errors';
import type {
  EngineContext,
  EngineDeps,
  GarmentTypeOption,
  TemplateLook,
  TemplateOption,
  TryonBody,
  UnavailableReport,
} from '../../src/modules/messaging/engine/types';

export const CTX: EngineContext = { userId: 'user-1', accountId: 'acct-1', messageId: 'wamid.1' };

export const GT_SHIRT: GarmentTypeOption = {
  id: 'gt-shirt',
  label: 'Shirt',
  requiresLowerUpload: false,
  requiresThirdUpload: false,
  lowerUploadLabel: null,
  thirdUploadLabel: null,
  defaultLowerCatalogId: 'lower-default',
  defaultShoeCatalogId: null,
};

export const look = (id: string, roles: Partial<TemplateLook> = {}): TemplateLook => ({
  id,
  poseId: `pose-${id}`,
  backgroundId: `bg-${id}`,
  label: `Pose ${id}`,
  imageUrl: `https://img/${id}.jpg`,
  hasUpper: true,
  hasLower: false,
  hasShoes: false,
  ...roles,
});

// 'd' has a shoe slot and GT_SHIRT has no default shoe → not offered (D49).
export const TEMPLATE: TemplateOption = {
  id: 'tpl-1',
  mappingId: 'map-1',
  looks: [look('a'), look('b', { hasLower: true }), look('c'), look('d', { hasShoes: true })],
};

// 'a2' repeats look a's pose and background, so the pool shows it once.
export const TEMPLATE_2: TemplateOption = {
  id: 'tpl-2',
  mappingId: 'map-2',
  looks: [look('a2', { poseId: 'pose-a', backgroundId: 'bg-a' }), look('e'), look('f')],
};

const lookCount = (body: TryonBody) => body.inputs.looks?.length ?? 0;

export function fakeDeps(over: Partial<EngineDeps> = {}) {
  let n = 0;
  const calls = {
    quote: [] as TryonBody[],
    createRun: [] as TryonBody[],
    // The idempotency key each createRun call was given (ctx.messageId).
    createRunKeys: [] as string[],
    recognize: [] as { garmentKey: string; gender: string }[],
    corrected: 0,
    unavailable: [] as UnavailableReport[],
  };
  const deps: EngineDeps = {
    newNonce: () => `n${++n}`,
    getUserDefaults: async () => ({ aspectRatio: '3:4', resolution: 'HD' }),
    getBalance: async () => 50,
    listGarmentTypes: async () => [GT_SHIRT],
    recognizeGarment: async (garmentKey, gender) => {
      calls.recognize.push({ garmentKey, gender });
      return null;
    },
    recordRecognitionCorrected: () => {
      calls.corrected++;
    },
    reportUnavailable: (r) => {
      calls.unavailable.push(r);
    },
    getTemplates: async () => [TEMPLATE],
    getDefaultFaceId: async () => 'face-1',
    quote: async (_u, body) => {
      calls.quote.push(body);
      const images = lookCount(body);
      return { images, perImage: 5, total: images * 5, balance: 50 };
    },
    createRun: async (ctx, body) => {
      calls.createRun.push(body);
      calls.createRunKeys.push(ctx.messageId);
      return { runId: `run-${calls.createRun.length}`, images: lookCount(body) };
    },
    runProgress: async () => ({ finished: 1, total: 2 }),
    links: {
      pricing: 'https://app.test/pricing',
      help: 'https://app.test/contact-us',
      studio: 'https://app.test/studio',
    },
    ...over,
  };
  return { deps, calls };
}

export const insufficient = () => new AppError('INSUFFICIENT_CREDITS', 402, 'insufficient credits');
```

- [ ] **Step 4: Run the rules tests and confirm they fail**

Run: `npx vitest run test/messaging-rules.test.ts`
Expected: FAIL — `buildPool` (and the other new exports) are not exported from `rules`.

- [ ] **Step 5: Rewrite `rules.ts`**

Replace the whole file with the following (write LF, then `to_crlf`). `eligibleLooks`, `requiredPhotoSlots` and `firstMissingSlot` are unchanged from the current file:

```ts
import type {
  GarmentTypeOption,
  PhotoSlot,
  PickCard,
  PoolTemplate,
  Session,
  TemplateLook,
  TemplateOption,
  TryonBody,
} from './types.js';

// The most poses one Generate may start (spec 2026-10-14, P4). Keeps a request
// inside the queue-capacity check in jobs/create.ts. A group is one template's
// looks (at most a handful), far under the create schema's 12-look cap.
export const MAX_PICKS = 20;

const isLowerOnlyLook = (l: TemplateLook) => l.hasLower && !l.hasUpper;

/**
 * The looks the bot can generate for this garment type without asking another
 * question (D49). The create path rejects a look whose lower or shoe slot is
 * empty (jobs/create.ts per-pose checks), and the chat never asks for a lower
 * or shoe item (D43), so a look that would need one is not offered.
 *
 * `lowerOnly` mirrors the studio's rule: when every look dresses only the
 * lower body, the seller's one photo IS the lower garment.
 */
export function eligibleLooks(
  gt: GarmentTypeOption,
  looks: TemplateLook[],
): { lowerOnly: boolean; looks: TemplateLook[] } {
  const lowerOnly = !gt.requiresLowerUpload && looks.length > 0 && looks.every(isLowerOnlyLook);
  return {
    lowerOnly,
    looks: looks.filter((l) => {
      if (l.hasShoes && !gt.defaultShoeCatalogId) return false;
      if (lowerOnly) return true;
      // In a mixed template a lower-only pose needs its own lower photo, which
      // only a requiresLowerUpload type collects (the studio has the same gap).
      if (isLowerOnlyLook(l)) return gt.requiresLowerUpload;
      if (l.hasLower && !gt.requiresLowerUpload && !gt.defaultLowerCatalogId) return false;
      return true;
    }),
  };
}

/**
 * Every template's eligible looks as one pool (spec 2026-10-14, P2), in template
 * admin order then look order. A pose + background pair that appears in more than
 * one template is kept once, under the first. `templates` is what the session
 * stores (ids and flags); `cards` is what the carousel renders, read fresh.
 */
export function buildPool(
  gt: GarmentTypeOption,
  options: TemplateOption[],
): { templates: PoolTemplate[]; cards: PickCard[] } {
  const seen = new Set<string>();
  const templates: PoolTemplate[] = [];
  const cards: PickCard[] = [];
  for (const t of options) {
    const { lowerOnly, looks } = eligibleLooks(gt, t.looks);
    const fresh = looks.filter((l) => {
      const key = `${l.poseId}::${l.backgroundId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length === 0) continue;
    templates.push({
      id: t.id,
      mappingId: t.mappingId,
      lowerOnly,
      looks: fresh.map((l) => ({
        id: l.id,
        poseId: l.poseId,
        backgroundId: l.backgroundId,
        hasLower: l.hasLower,
        hasShoes: l.hasShoes,
      })),
    });
    for (const l of fresh) cards.push({ id: l.id, label: l.label, imageUrl: l.imageUrl });
  }
  return { templates, cards };
}

/**
 * The picks split by template, because one catalogue belongs to exactly one
 * template mapping (P6). Groups follow template order; ids keep tap order.
 */
export function groupByTemplate(
  templates: PoolTemplate[],
  lookIds: string[],
): { template: PoolTemplate; lookIds: string[] }[] {
  const groups: { template: PoolTemplate; lookIds: string[] }[] = [];
  for (const template of templates) {
    const mine = new Set(template.looks.map((l) => l.id));
    const ids = lookIds.filter((id) => mine.has(id));
    if (ids.length > 0) groups.push({ template, lookIds: ids });
  }
  return groups;
}

/** Uploads the type requires, in the order the bot asks for them (D46). */
export function requiredPhotoSlots(gt: GarmentTypeOption): PhotoSlot[] {
  const slots: PhotoSlot[] = [];
  if (gt.requiresLowerUpload) slots.push('lowerFront');
  if (gt.requiresThirdUpload) slots.push('third');
  return slots;
}

export function firstMissingSlot(s: Session): PhotoSlot | null {
  if (!s.garmentType) return null;
  return requiredPhotoSlots(s.garmentType).find((slot) => !s.photos[slot]) ?? null;
}

/**
 * The looks to retry once every run has finished: picked looks whose pose
 * failed (the dispatcher already refunded them) plus looks whose run could not
 * be created at all. Matching is by pose id, which is all delivery reports.
 */
export function retryLookIds(s: Session): string[] {
  const failed = new Set((s.runs ?? []).flatMap((r) => r.failedPoseIds ?? []));
  const unstarted = new Set(s.unstarted ?? []);
  const poseOf = new Map(
    (s.templates ?? []).flatMap((t) => t.looks.map((l) => [l.id, l.poseId] as const)),
  );
  return s.picked.filter((id) => unstarted.has(id) || failed.has(poseOf.get(id) ?? ''));
}

/**
 * The /v1/jobs/tryon body for one template group of the picks (or of a retry).
 * Template mode only (D42): looks + mapping id, never backgroundId/poseIds.
 */
export function buildTryonBody(s: Session, t: PoolTemplate, lookIds: string[]): TryonBody {
  const gt = s.garmentType;
  if (!gt || !s.garmentKey || !s.faceId) throw new Error('session incomplete');
  const byId = new Map(t.looks.map((l) => [l.id, l]));
  const looks = lookIds.flatMap((id) => {
    const l = byId.get(id);
    return l ? [l] : [];
  });
  // A combined upper+lower pose's lower slot takes the type's default item
  // unless the seller sent a lower photo (studio: effectiveLowerId).
  const needsLowerItem = !t.lowerOnly && !gt.requiresLowerUpload && looks.some((l) => l.hasLower);
  const needsShoes = looks.some((l) => l.hasShoes);

  const inputs: Record<string, unknown> = {
    upperGarmentKey: s.garmentKey,
    faceId: s.faceId,
    garmentTypeId: gt.id,
    looks: looks.map((l) => ({ poseId: l.poseId, backgroundId: l.backgroundId })),
    catalogueTemplateMappingId: t.mappingId,
    // Lower-only: the schema requires upperGarmentKey, the api drops it for
    // these poses, and the same photo is the lower (studio: lowerGarmentKeyForSubmit).
    lowerGarmentKey: t.lowerOnly ? s.garmentKey : s.photos.lowerFront,
    lowerCatalogId: needsLowerItem ? (gt.defaultLowerCatalogId ?? undefined) : undefined,
    shoeCatalogId: needsShoes ? (gt.defaultShoeCatalogId ?? undefined) : undefined,
    thirdGarmentKey: s.photos.third,
  };
  // Drop undefined keys so the body equals what the studio's JSON would carry.
  for (const k of Object.keys(inputs)) if (inputs[k] === undefined) delete inputs[k];

  // No `platform`: the bot never triggers the Amazon white-background override (D23).
  return {
    aspectRatio: s.aspectRatio,
    resolution: s.resolution,
    inputs: inputs as TryonBody['inputs'],
  };
}
```

- [ ] **Step 6: Run the rules tests and confirm they pass**

Run: `npx vitest run test/messaging-rules.test.ts`
Expected: PASS (all tests in the file).

#### Step group B — copy and the engine

- [ ] **Step 7: Edit `copy.ts`**

`to_lf apps/api/src/modules/messaging/engine/copy.ts`. Add after `btnSelect: 'Select',`:

```ts
  btnChangeGarment: 'Change garment',
  btnGenerate: 'Generate',
  btnClear: 'Clear',
```

Replace this block

```ts
  askCount: (balance: number) => `How many poses do you want? Your balance: ${balance} credits.`,
  // At most "9 poses · 999 credits" (21 characters).
  countRow: (n: number, credits: number) =>
    `${n} ${n === 1 ? 'pose' : 'poses'} · ${credits} credits`,
  rowChangeGarment: 'Wrong garment? Change',
  pickLooks: (count: number) =>
    `Tap ${count} ${count === 1 ? 'pose' : 'poses'}. Generation starts after the last one.`,
  lookAdded: (k: number, n: number) => `Added, ${k} of ${n}.`,
  lookAlreadyAdded: 'That pose is already added.',
```
with
```ts
  pickPrompt: (perImage: number, balance: number) =>
    `Pick the poses you want. Each one is ${perImage} credits. Your balance: ${balance} credits.`,
  pickCards: 'Tap a pose to select it. Tap it again to remove it.',
  pickFooter: 'Select poses above, then tap Generate.',
  selected: (n: number, credits: number) => `${n} selected · ${credits} credits`,
  pickAtLeastOne: 'Tap at least one pose first.',
  pickCap: (max: number) => `You can generate up to ${max} poses at a time.`,
  partlyStarted: (started: number, total: number, reason: string) =>
    `Started ${started} of ${total} ${total === 1 ? 'image' : 'images'}. The rest couldn't start: ${reason}`,
```
`to_crlf apps/api/src/modules/messaging/engine/copy.ts`.

- [ ] **Step 8: Rewrite `engine.ts`**

Replace the whole file with the content below (write LF, then `to_crlf`). It differs from the current file in: imports; `picksCleared`; `cardsMsgs` footer; `loadPool` (was `loadTemplate`); `chooseGarmentType`; `createRejected` and `generate`; the `ASK_EXTRA_PHOTO`, `PICK_LOOKS`, `GENERATING`, `DELIVERED` render cases; `ASK_POSE_COUNT` removed; `onReply` `PICK_LOOKS`/`DELIVERED`; `upgradeSession`; the `image`/`runFinished`/`creditsAdded` event cases. Everything else is as before.

```ts
import { AppError } from '../../../lib/errors.js';
import { COPY } from './copy.js';
import { decodeReplyId, encodeReplyId } from './reply-id.js';
import {
  buildPool,
  buildTryonBody,
  firstMissingSlot,
  groupByTemplate,
  MAX_PICKS,
  retryLookIds,
} from './rules.js';
import type {
  EngineContext,
  EngineDeps,
  EngineResult,
  GarmentTypeOption,
  Gender,
  InboundEvent,
  OutboundMessage,
  PickCard,
  RunRef,
  Session,
  State,
} from './types.js';

const CARDS_PER_PAGE = 10;
// 9 rows + a "More" row keeps a list inside WhatsApp's 10-row limit.
const ROWS_PER_PAGE = 9;
// The order management gave: "Create catalogue for (Women, Men, Boys, Girls)".
const GENDERS: Gender[] = ['women', 'men', 'boys', 'girls'];

type Out = OutboundMessage[];
type Row = { action: string; value: string; title: string };

export async function freshSession(userId: string, deps: EngineDeps): Promise<Session> {
  const defaults = await deps.getUserDefaults(userId);
  return {
    v: 1,
    state: 'MAIN_MENU',
    nonce: deps.newNonce(),
    page: 0,
    aspectRatio: defaults.aspectRatio,
    resolution: defaults.resolution,
    photos: {},
    picked: [],
  };
}

/** Everything chosen for a catalog, cleared; image shape and resolution kept. */
function cleared(s: Session): Session {
  return {
    v: 1,
    state: s.state,
    nonce: s.nonce,
    page: 0,
    aspectRatio: s.aspectRatio,
    resolution: s.resolution,
    photos: {},
    picked: [],
  };
}

/** Back to choosing the garment type; the photo and gender are kept. */
function garmentCleared(s: Session): Session {
  return { ...cleared(s), garmentKey: s.garmentKey, gender: s.gender };
}

/** Back to choosing poses; garment, type, extra photos, face and templates kept. */
function picksCleared(s: Session): Session {
  return { ...s, picked: [], runs: undefined, unstarted: undefined };
}

const text = (t: string): OutboundMessage => ({ kind: 'text', text: t });

function buttons(
  s: Session,
  body: string,
  items: [action: string, value: string, title: string][],
): OutboundMessage {
  return {
    kind: 'buttons',
    text: body,
    buttons: items
      .slice(0, 3)
      .map(([a, v, title]) => ({ id: encodeReplyId(s.nonce, a, v), title })),
  };
}

/** A list page; rows beyond one page get a "More" row. */
function listMsg(s: Session, body: string, rows: Row[]): OutboundMessage {
  const start = s.page * ROWS_PER_PAGE;
  const page = rows.slice(start, start + ROWS_PER_PAGE).map((r) => ({
    id: encodeReplyId(s.nonce, r.action, r.value),
    title: r.title.slice(0, 24),
  }));
  if (start + ROWS_PER_PAGE < rows.length) {
    page.push({ id: encodeReplyId(s.nonce, 'more', ''), title: COPY.btnMore });
  }
  return { kind: 'list', text: body, buttonLabel: COPY.listChoose, rows: page };
}

/** A carousel page plus a buttons message for More / extra actions. */
function cardsMsgs(
  s: Session,
  body: string,
  action: string,
  items: { id: string; label: string; imageUrl: string }[],
  extra: [action: string, value: string, title: string][] = [],
  footer: string = COPY.moreOptions,
): Out {
  const start = s.page * CARDS_PER_PAGE;
  const page = items.slice(start, start + CARDS_PER_PAGE);
  const out: Out = [
    {
      kind: 'cards',
      text: body,
      cards: page.map((i) => ({
        id: encodeReplyId(s.nonce, action, i.id),
        imageUrl: i.imageUrl,
        title: i.label,
      })),
    },
  ];
  const more: [string, string, string][] =
    start + CARDS_PER_PAGE < items.length ? [['more', '', COPY.btnMore]] : [];
  const actions = [...more, ...extra];
  if (actions.length > 0) out.push(buttons(s, footer, actions));
  return out;
}

interface Loaded {
  session: Session;
  cards: PickCard[];
}

/**
 * Re-reads every template of the type and keeps only the looks the bot can
 * generate (D49), as one de-duplicated pool. Re-read on every pick prompt and
 * on Generate, so a look an admin removed, or a presigned image URL that
 * expired, never reaches the seller; picks no longer in the pool are dropped.
 * Null when nothing is left — the type is then not available in the chat (D47).
 */
async function loadPool(s: Session, deps: EngineDeps): Promise<Loaded | null> {
  if (!s.gender || !s.garmentType) return null;
  const at = { gender: s.gender as Gender, garmentTypeId: s.garmentType.id };
  const options = await deps.getTemplates(at.gender, at.garmentTypeId);
  if (options.length === 0) {
    deps.reportUnavailable({ ...at, reason: 'no_template' });
    return null;
  }
  const { templates, cards } = buildPool(s.garmentType, options);
  if (templates.length === 0) {
    deps.reportUnavailable({
      ...at,
      reason: 'no_eligible_looks',
      templateId: options[0].id,
      templateLooks: options.reduce((n, t) => n + t.looks.length, 0),
    });
    return null;
  }
  const ids = new Set(cards.map((c) => c.id));
  return {
    session: { ...s, templates, picked: s.picked.filter((id) => ids.has(id)) },
    cards,
  };
}

/** Moves to `state` with a fresh nonce and renders its prompt. */
async function enter(
  s: Session,
  state: State,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  return render({ ...s, state, nonce: deps.newNonce(), page: 0 }, out, ctx, deps);
}

function notAvailable(s: Session, label: string, out: Out, ctx: EngineContext, deps: EngineDeps) {
  out.push(text(COPY.notAvailable(label, deps.links.studio)));
  return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
}

/**
 * The garment type is known, from recognition or the list. Fills the defaults
 * the chat no longer asks for (D43): face and templates. Then the required
 * extra photos, then the pose picks.
 */
async function chooseGarmentType(
  s: Session,
  gt: GarmentTypeOption,
  recognized: boolean,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const faceId = await deps.getDefaultFaceId(s.gender as Gender, gt.id);
  const withType: Session = {
    ...garmentCleared(s),
    garmentType: gt,
    recognized,
    faceId: faceId ?? undefined,
  };
  if (!faceId) {
    deps.reportUnavailable({ gender: s.gender as Gender, garmentTypeId: gt.id, reason: 'no_face' });
  }
  const loaded = faceId ? await loadPool(withType, deps) : null;
  if (!loaded) return notAvailable(s, gt.label, out, ctx, deps);
  if (recognized) out.push(text(COPY.detected(gt.label)));
  return enter(
    loaded.session,
    firstMissingSlot(loaded.session) ? 'ASK_EXTRA_PHOTO' : 'PICK_LOOKS',
    out,
    ctx,
    deps,
  );
}

/** What a rejected quote or create means for the seller (spec section 13). */
async function createRejected(
  err: unknown,
  s: Session,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  if (!(err instanceof AppError)) throw err;
  if (err.code === 'INSUFFICIENT_CREDITS') return enter(s, 'NO_CREDITS', out, ctx, deps);
  // A look deactivated or a mapping changed after the cards were shown.
  if (err.code === 'BAD_CATALOG') {
    out.push(text(COPY.posesChanged));
    return enter({ ...s, picked: [] }, 'PICK_LOOKS', out, ctx, deps);
  }
  out.push(text(err.message));
  return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
}

/**
 * Starts the runs for `lookIds` (all picks, or the failed and unstarted ones on
 * retry): one create call per template, because a catalogue belongs to one
 * template mapping (P6). Every group is quoted first (read-only, raises what
 * createJob would), so a look that is no longer valid is found before the first
 * charge. A group that fails after an earlier one was charged leaves its looks
 * in `unstarted`, for [Retry].
 */
async function generate(
  s: Session,
  lookIds: string[],
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const loaded = await loadPool(s, deps);
  if (!loaded) return notAvailable(s, s.garmentType?.label ?? 'These', out, ctx, deps);
  const ls = loaded.session;
  const inPool = new Set(loaded.cards.map((c) => c.id));
  if (lookIds.some((id) => !inPool.has(id))) {
    // An admin removed a look since the cards were shown: nothing is charged and
    // the seller reviews what is left (ls.picked is already pruned).
    out.push(text(COPY.posesChanged));
    return enter(ls, 'PICK_LOOKS', out, ctx, deps);
  }

  const groups = groupByTemplate(ls.templates ?? [], lookIds);
  const bodyOf = (g: (typeof groups)[number]) => buildTryonBody(ls, g.template, g.lookIds);
  try {
    for (const g of groups) await deps.quote(ctx.userId, bodyOf(g));
  } catch (err) {
    return createRejected(err, ls, out, ctx, deps);
  }

  const runs: RunRef[] = [];
  let unstarted: string[] = [];
  let reason = '';
  for (const [i, g] of groups.entries()) {
    try {
      // One key per group: a redelivered tap returns the same catalogues.
      const { runId, images } = await deps.createRun(
        { ...ctx, messageId: `${ctx.messageId}:${i}` },
        bodyOf(g),
      );
      runs.push({ runId, images });
    } catch (err) {
      if (runs.length === 0) return createRejected(err, ls, out, ctx, deps);
      if (!(err instanceof AppError)) throw err;
      unstarted = groups.slice(i).flatMap((rest) => rest.lookIds);
      reason = err.message;
      break;
    }
  }

  // Shown, not charged, from the pick prompt's quote: the charge itself is
  // createJob's own resolution of the same plan (D17).
  const started = runs.reduce((n, r) => n + r.images, 0);
  out.push(text(COPY.generating(started, started * (ls.perImage ?? 0))));
  if (unstarted.length > 0) {
    out.push(text(COPY.partlyStarted(started, lookIds.length, reason)));
  }
  return {
    session: {
      ...ls,
      picked: lookIds,
      state: 'GENERATING',
      nonce: deps.newNonce(),
      page: 0,
      runs,
      unstarted: unstarted.length > 0 ? unstarted : undefined,
    },
    messages: out,
  };
}

/** Appends the current step's prompt. May redirect when a step has nothing to ask. */
async function render(
  s: Session,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const done = (session: Session = s): EngineResult => ({ session, messages: out });

  switch (s.state) {
    case 'MAIN_MENU':
      out.push(
        buttons(s, COPY.menu, [
          ['menu', 'new', COPY.btnNewCatalog],
          ['menu', 'credits', COPY.btnCredits],
          ['menu', 'help', COPY.btnHelp],
        ]),
      );
      return done();

    case 'ASK_GARMENT_PHOTO':
      out.push(text(COPY.askGarmentPhoto));
      return done();

    case 'ASK_GENDER':
      // Four options: one more than reply buttons allow, so a list.
      out.push(
        listMsg(
          s,
          COPY.askGender,
          GENDERS.map((g) => ({ action: 'gender', value: g, title: COPY.genders[g] })),
        ),
      );
      return done();

    case 'ASK_GARMENT_TYPE': {
      const types = await deps.listGarmentTypes(s.gender as Gender);
      if (types.length === 0) {
        out.push(text(COPY.nothingAvailable));
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      }
      out.push(
        listMsg(
          s,
          COPY.askGarmentType,
          types.map((t) => ({ action: 'gt', value: t.id, title: t.label })),
        ),
      );
      return done();
    }

    case 'ASK_EXTRA_PHOTO': {
      const slot = firstMissingSlot(s);
      if (!slot) return enter(s, 'PICK_LOOKS', out, ctx, deps);
      const gt = s.garmentType;
      const label =
        slot === 'lowerFront' ? (gt?.lowerUploadLabel ?? null) : (gt?.thirdUploadLabel ?? null);
      out.push(text(COPY.askPhoto[slot](label)));
      return done();
    }

    case 'PICK_LOOKS': {
      const loaded = await loadPool(s, deps);
      if (!loaded?.session.templates)
        return notAvailable(s, s.garmentType?.label ?? 'These', out, ctx, deps);
      const ls = loaded.session;
      let perImage = ls.perImage;
      let balance = ls.balance;
      // Priced once per visit to the step (page 0), not on every "More" page.
      if (ls.page === 0 || perImage === undefined || balance === undefined) {
        const first = ls.templates?.[0];
        if (!first) return notAvailable(s, s.garmentType?.label ?? 'These', out, ctx, deps);
        try {
          // One look prices one image: the cost per image comes from the same plan
          // resolution the web uses (D17); the selection multiplies it.
          const q = await deps.quote(ctx.userId, buildTryonBody(ls, first, [first.looks[0].id]));
          perImage = q.perImage;
          balance = q.balance;
        } catch (err) {
          // Anything createJob would reject surfaces here, before any credits are taken.
          if (!(err instanceof AppError)) throw err;
          out.push(text(err.message));
          return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
        }
      }
      const next: Session = { ...ls, perImage, balance };
      if (next.page === 0) {
        out.push(
          buttons(next, COPY.pickPrompt(perImage, balance), [
            ['change', '', COPY.btnChangeGarment],
          ]),
        );
      }
      const n = next.picked.length;
      out.push(
        ...cardsMsgs(
          next,
          COPY.pickCards,
          'look',
          loaded.cards,
          [
            ['generate', '', COPY.btnGenerate],
            ['clear', '', COPY.btnClear],
          ],
          n > 0 ? COPY.selected(n, n * perImage) : COPY.pickFooter,
        ),
      );
      return done(next);
    }

    case 'NO_CREDITS':
      out.push(buttons(s, COPY.noCredits(deps.links.pricing), [['menu', 'menu', COPY.btnMenu]]));
      return done();

    case 'GENERATING': {
      const progress = await Promise.all((s.runs ?? []).map((r) => deps.runProgress(r.runId)));
      const finished = progress.reduce((n, p) => n + p.finished, 0);
      const total = progress.reduce((n, p) => n + p.total, 0);
      out.push(text(COPY.stillGenerating(finished, total)));
      return done();
    }

    case 'DELIVERED': {
      const retryable = retryLookIds(s).length > 0;
      const items: [string, string, string][] = [];
      if (retryable) items.push(['retry', '', COPY.btnRetryFailed]);
      items.push(['more_poses', '', COPY.btnMorePoses]);
      items.push(retryable ? ['menu', 'menu', COPY.btnMenu] : ['menu', 'new', COPY.btnNewCatalog]);
      out.push(buttons(s, COPY.delivered, items));
      return done();
    }
  }
}

async function onReply(
  s: Session,
  action: string,
  value: string,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const reprompt = () => {
    out.push(text(COPY.reprompt));
    return { session: s, messages: out };
  };
  // Paging keeps the nonce so cards on earlier pages stay tappable.
  if (action === 'more') return render({ ...s, page: s.page + 1 }, out, ctx, deps);
  if (action === 'restart') return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
  if (action === 'menu') {
    if (value === 'new') return enter(cleared(s), 'ASK_GARMENT_PHOTO', out, ctx, deps);
    if (value === 'credits') {
      out.push(text(COPY.credits(await deps.getBalance(ctx.userId), deps.links.pricing)));
      return enter(s, 'MAIN_MENU', out, ctx, deps);
    }
    if (value === 'help') {
      out.push(text(COPY.help(deps.links.help)));
      return enter(s, 'MAIN_MENU', out, ctx, deps);
    }
    return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
  }

  switch (s.state) {
    case 'ASK_GENDER': {
      if (action !== 'gender' || !GENDERS.includes(value as Gender)) return reprompt();
      const gender = value as Gender;
      const withGender: Session = { ...s, gender };
      // Spec 8a: recognition runs now, against that gender's types only, and
      // returns null on every failure — the list is always the way out.
      const hit = s.garmentKey ? await deps.recognizeGarment(s.garmentKey, gender) : null;
      if (hit) {
        const gt = (await deps.listGarmentTypes(gender)).find((t) => t.id === hit.garmentTypeId);
        // A correct answer for a type the bot cannot offer (a saree two-step
        // type, no template): say so, rather than pretending we didn't know.
        if (!gt) return notAvailable(withGender, hit.label, out, ctx, deps);
        return chooseGarmentType(withGender, gt, true, out, ctx, deps);
      }
      return enter(withGender, 'ASK_GARMENT_TYPE', out, ctx, deps);
    }

    case 'ASK_GARMENT_TYPE': {
      const gt = (await deps.listGarmentTypes(s.gender as Gender)).find((t) => t.id === value);
      if (action !== 'gt' || !gt) return reprompt();
      return chooseGarmentType(s, gt, false, out, ctx, deps);
    }

    case 'PICK_LOOKS': {
      if (action === 'change') {
        if (s.recognized) deps.recordRecognitionCorrected();
        return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
      }
      const perImage = s.perImage ?? 0;
      // Not a re-render: re-sending the carousel after every tap would bury the
      // chat. The nonce stays, so every earlier Generate button acts on the
      // current selection.
      const status = (picks: string[]): OutboundMessage =>
        buttons(s, COPY.selected(picks.length, picks.length * perImage), [
          ['generate', '', COPY.btnGenerate],
          ['clear', '', COPY.btnClear],
        ]);
      if (action === 'clear') {
        out.push(status([]));
        return { session: { ...s, picked: [] }, messages: out };
      }
      if (action === 'generate') {
        if (s.picked.length === 0) {
          out.push(text(COPY.pickAtLeastOne));
          return { session: s, messages: out };
        }
        // Tapping Generate is the agreement to spend (D45). Caught here, before
        // any run exists; createJob checks again.
        const balance = await deps.getBalance(ctx.userId);
        if (s.picked.length * perImage > balance) return enter(s, 'NO_CREDITS', out, ctx, deps);
        return generate(s, s.picked, out, ctx, deps);
      }
      const inPool = (s.templates ?? []).some((t) => t.looks.some((l) => l.id === value));
      if (action !== 'look' || !inPool) return reprompt();
      if (s.picked.includes(value)) {
        const without = s.picked.filter((id) => id !== value);
        out.push(status(without));
        return { session: { ...s, picked: without }, messages: out };
      }
      if (s.picked.length >= MAX_PICKS) {
        out.push(text(COPY.pickCap(MAX_PICKS)));
        return { session: s, messages: out };
      }
      const next = [...s.picked, value];
      out.push(status(next));
      return { session: { ...s, picked: next }, messages: out };
    }

    case 'DELIVERED': {
      if (action === 'more_poses') return enter(picksCleared(s), 'PICK_LOOKS', out, ctx, deps);
      if (action === 'retry') {
        const ids = retryLookIds(s);
        if (ids.length === 0) return reprompt();
        // The dispatcher already refunded the failed images; this is a fresh,
        // priced run of only those looks.
        return generate({ ...s, picked: ids }, ids, out, ctx, deps);
      }
      return reprompt();
    }

    default:
      return reprompt();
  }
}

// States where a new photo starts a new catalog (spec section 8): outside the
// question steps, a photo can only mean "do this one".
const NEW_PHOTO_STATES: State[] = [
  'MAIN_MENU',
  'ASK_GARMENT_PHOTO',
  'NO_CREDITS',
  'GENERATING',
  'DELIVERED',
];

// What a session saved before 2026-10-14 may still carry.
type LegacySession = Session & {
  template?: unknown;
  count?: number;
  runId?: string;
  runImages?: number;
  failedPoseIds?: string[];
};

/**
 * A session saved by the single-template engine. One that was generating or
 * delivered becomes a one-run list, so a seller mid-run at deploy still gets
 * their closing message. One that was still picking has no pool to tap against;
 * null starts it over like an expired session.
 */
function upgradeSession(prev: Session): Session | null {
  const old = prev as LegacySession;
  if (old.runId === undefined) {
    return old.template === undefined && old.count === undefined ? prev : null;
  }
  const { template: _t, count: _c, runId, runImages, failedPoseIds, ...rest } = old;
  return {
    ...rest,
    runs: [
      {
        runId,
        images: runImages ?? 0,
        ...(failedPoseIds ? { finished: true, failedPoseIds } : {}),
      },
    ],
  };
}

/**
 * The whole conversation as one deterministic step: (session, event) → (session,
 * messages). No I/O of its own — everything goes through `deps` (D33), so it is
 * tested with in-memory fakes and knows nothing about WhatsApp (spec section 6).
 */
export async function handle(
  prev: Session | null,
  event: InboundEvent,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const out: Out = [];
  const s = prev ? upgradeSession(prev) : null;
  if (!s) {
    const fresh = await freshSession(ctx.userId, deps);
    if (event.type === 'reply') out.push(text(COPY.sessionExpired));
    // A first photo starts a catalog straight away (spec section 8).
    if (event.type === 'image')
      return enter({ ...fresh, garmentKey: event.garmentKey }, 'ASK_GENDER', out, ctx, deps);
    return render(fresh, out, ctx, deps);
  }

  switch (event.type) {
    case 'text': {
      const cmd = event.text.trim().toLowerCase();
      if (cmd === 'menu' || cmd === 'restart')
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      if (cmd === 'help') {
        out.push(text(COPY.help(deps.links.help)));
        return render(s, out, ctx, deps);
      }
      if (s.state === 'MAIN_MENU' || s.state === 'GENERATING') return render(s, out, ctx, deps);
      out.push(text(COPY.reprompt));
      return { session: s, messages: out };
    }

    case 'reply': {
      const d = decodeReplyId(event.id);
      if (!d || d.nonce !== s.nonce) {
        out.push(text(COPY.stale));
        return { session: s, messages: out };
      }
      return onReply(s, d.action, d.value, out, ctx, deps);
    }

    case 'image': {
      if (NEW_PHOTO_STATES.includes(s.state)) {
        return enter({ ...cleared(s), garmentKey: event.garmentKey }, 'ASK_GENDER', out, ctx, deps);
      }
      if (s.state === 'ASK_EXTRA_PHOTO') {
        const slot = firstMissingSlot(s);
        if (slot) {
          const next = { ...s, photos: { ...s.photos, [slot]: event.garmentKey } };
          return enter(
            next,
            firstMissingSlot(next) ? 'ASK_EXTRA_PHOTO' : 'PICK_LOOKS',
            out,
            ctx,
            deps,
          );
        }
      }
      out.push(text(COPY.notNow));
      return render(s, out, ctx, deps);
    }

    case 'unsupportedMedia':
      out.push(text(COPY.unsupported));
      return s.state === 'ASK_GARMENT_PHOTO' || s.state === 'ASK_EXTRA_PHOTO'
        ? { session: s, messages: out }
        : render(s, out, ctx, deps);

    case 'runFinished': {
      // A run from an older session (the seller started another catalog
      // meanwhile) still gets its images (plan 3 sends them by run, not by
      // session), but no buttons here.
      const runs = s.runs ?? [];
      const mine = runs.find((r) => r.runId === event.runId);
      if (!mine || mine.finished) return { session: s, messages: out };
      const updated = runs.map((r) =>
        r.runId === event.runId ? { ...r, finished: true, failedPoseIds: event.failedPoseIds } : r,
      );
      const next: Session = { ...s, runs: updated };
      // The closing message waits for the last run of the Generate (spec section 4).
      if (!updated.every((r) => r.finished)) return { session: next, messages: out };
      const failed = updated.reduce((n, r) => n + (r.failedPoseIds?.length ?? 0), 0);
      const images = updated.reduce((n, r) => n + r.images, 0);
      if (failed > 0) out.push(text(COPY.partlyFailed(failed, images)));
      return enter(next, 'DELIVERED', out, ctx, deps);
    }

    case 'creditsAdded':
      out.push(text(COPY.creditsAdded(event.credits)));
      // Back to the cards with the selection kept (spec section 6).
      if (s.state === 'NO_CREDITS') return enter(s, 'PICK_LOOKS', out, ctx, deps);
      return { session: s, messages: out };
  }
}
```

Then `to_crlf apps/api/src/modules/messaging/engine/engine.ts`.

- [ ] **Step 9: Real deps — `getTemplates`**

`to_lf apps/api/src/modules/messaging/deps.ts`. Replace the `getTemplate` method

```ts
    async getTemplate(gender, garmentTypeId): Promise<TemplateOption | null> {
      // Already in admin sort order, and already without looks whose pose,
      // background or workflow is inactive (the studio's query).
      const { items } = await listCatalogueTemplates(app, { gender, garmentTypeId });
      const t = items[0];
      if (!t) return null;
      return {
        id: t.id,
        mappingId: t.mappingId,
        looks: t.looks.map((l) => ({
          id: l.id,
          poseId: l.poseId,
          backgroundId: l.backgroundId,
          label: l.poseLabel,
          imageUrl: l.poseThumbnailUrl,
          hasUpper: l.hasUpper,
          hasLower: l.hasLower,
          hasShoes: l.hasShoes,
        })),
      };
    },
```
with
```ts
    async getTemplates(gender, garmentTypeId): Promise<TemplateOption[]> {
      // Every active template for the type, already in admin sort order and
      // already without looks whose pose, background or workflow is inactive
      // (the studio's query). The engine pools them (spec 2026-10-14, P2).
      const { items } = await listCatalogueTemplates(app, { gender, garmentTypeId });
      return items.map(
        (t): TemplateOption => ({
          id: t.id,
          mappingId: t.mappingId,
          looks: t.looks.map((l) => ({
            id: l.id,
            poseId: l.poseId,
            backgroundId: l.backgroundId,
            label: l.poseLabel,
            imageUrl: l.poseThumbnailUrl,
            hasUpper: l.hasUpper,
            hasLower: l.hasLower,
            hasShoes: l.hasShoes,
          })),
        }),
      );
    },
```
Also in the comment above `getDefaultFaceId` nothing changes. `to_crlf apps/api/src/modules/messaging/deps.ts`.

- [ ] **Step 10: Typecheck the source**

Run: `pnpm --filter @aivastra/api typecheck`
Expected: errors only in the *test* files that still use the old API (`messaging-engine.test.ts`, the two integration tests). If any error is in `src/`, fix it before continuing (most likely a stale `COPY.askCount`/`rowChangeGarment` reference; `grep -rn "askCount\|countRow\|rowChangeGarment\|lookAdded\|pickLooks\b" src` must print nothing).

#### Step group C — engine unit tests

- [ ] **Step 11: Fix the head of `messaging-engine.test.ts`**

`to_lf apps/api/test/messaging-engine.test.ts`, then:

```bash
sed -i \
  -e "s/state: 'ASK_POSE_COUNT'/state: 'PICK_LOOKS'/" \
  -e "s/getTemplate: async () => null/getTemplates: async () => []/" \
  -e "s/getTemplate: async () => shoeOnly/getTemplates: async () => [shoeOnly]/" \
  -e "s/the count step follows/pose picking follows/" \
  -e "s/a pick goes to the count step/a pick goes to pose picking/" \
  apps/api/test/messaging-engine.test.ts
```
(These touch only lines before the tail, which Step 12 replaces.) Also add `encodeReplyId` to the reply-id import at the top:

```ts
import { decodeReplyId, encodeReplyId } from '../src/modules/messaging/engine/reply-id';
```
and add `TEMPLATE_2` to the engine-fakes import:

```ts
import { CTX, fakeDeps, GT_SHIRT, insufficient, look, TEMPLATE, TEMPLATE_2 } from './helpers/engine-fakes';
```

- [ ] **Step 12: Replace the tail of `messaging-engine.test.ts`**

Cut the file at the line `// A seller at the count step for GT_SHIRT, through the garment-type list.` and append the content below:

```bash
python - <<'EOF'
p = 'apps/api/test/messaging-engine.test.ts'
s = open(p, encoding='utf-8', newline='').read()
i = s.index('// A seller at the count step for GT_SHIRT')
open(p, 'w', encoding='utf-8', newline='').write(s[:i])
EOF
```

Append (LF; `to_crlf` the whole file at the end of this step):

```ts
// A seller at the pose cards for GT_SHIRT, through the garment-type list.
async function atPick(deps: EngineDeps) {
  const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
  return run(deps, [(x) => tap(x, 'gt', 'gt-shirt')], list);
}

// Taps each look on the cards `at` offered, in order. Returns the cards result
// and the result of the last tap (whose buttons hold Generate).
async function pickLooks(deps: EngineDeps, lookIds: string[]) {
  const at = await atPick(deps);
  let r = at;
  for (const id of lookIds) r = await handle(r.session, tap(at, 'look', id), CTX, deps);
  return { at, r };
}

async function generated(deps: EngineDeps, lookIds: string[]) {
  const { r } = await pickLooks(deps, lookIds);
  return handle(r.session, tap(r, 'generate'), CTX, deps);
}

const buttonTitles = (m: OutboundMessage | undefined) =>
  m && m.kind === 'buttons' ? m.buttons.map((b) => b.title) : [];

describe('engine: pose cards', () => {
  it('prompts with the cost and balance, offers Change, and lists the eligible looks', async () => {
    const { deps, calls } = fakeDeps();
    const r = await atPick(deps);
    const [prompt, cards, footer] = r.messages;
    expect('text' in prompt && prompt.text).toBe(
      'Pick the poses you want. Each one is 5 credits. Your balance: 50 credits.',
    );
    expect(buttonTitles(prompt)).toEqual(['Change garment']);
    // Look 'd' needs shoes and GT_SHIRT has no default shoe (D49): 3 looks, not 4.
    expect(cards.kind === 'cards' ? cards.cards.map((c) => c.title) : []).toEqual([
      'Pose a',
      'Pose b',
      'Pose c',
    ]);
    expect('text' in footer && footer.text).toBe('Select poses above, then tap Generate.');
    expect(buttonTitles(footer)).toEqual(['Generate', 'Clear']);
    // Priced with one look, through the real create-body builder.
    expect(calls.quote.at(-1)?.inputs.looks).toEqual([{ poseId: 'pose-a', backgroundId: 'bg-a' }]);
  });

  it('pools the looks of every template, showing a repeated pose + background once', async () => {
    const { deps } = fakeDeps({ getTemplates: async () => [TEMPLATE, TEMPLATE_2] });
    const r = await atPick(deps);
    const cards = r.messages.find((m) => m.kind === 'cards');
    expect(cards && cards.kind === 'cards' ? cards.cards.map((c) => c.title) : []).toEqual([
      'Pose a',
      'Pose b',
      'Pose c',
      'Pose e',
      'Pose f',
    ]);
  });

  it('pages at 10 cards with More; a pick from page 1 still works after More', async () => {
    const big = { ...TEMPLATE, looks: Array.from({ length: 12 }, (_, i) => look(`l${i}`)) };
    const { deps } = fakeDeps({ getTemplates: async () => [big] });
    const at = await atPick(deps);
    const cards = at.messages.find((m) => m.kind === 'cards');
    expect(cards && cards.kind === 'cards' ? cards.cards : []).toHaveLength(10);
    expect(buttonTitles(at.messages.at(-1))).toEqual(['More', 'Generate', 'Clear']);
    const second = await handle(at.session, tap(at, 'more'), CTX, deps);
    const rest = second.messages.find((m) => m.kind === 'cards');
    expect(rest && rest.kind === 'cards' ? rest.cards.map((c) => c.title) : []).toEqual([
      'Pose l10',
      'Pose l11',
    ]);
    // Page 2 does not repeat the price prompt, and the nonce is unchanged.
    expect(second.messages[0].kind).toBe('cards');
    const pickOne = await handle(second.session, tap(at, 'look', 'l0'), CTX, deps);
    expect(pickOne.session.picked).toEqual(['l0']);
  });

  it('Change after a recognised type counts a correction; after a list pick it does not', async () => {
    const recognised = fakeDeps({
      recognizeGarment: async () => ({ garmentTypeId: 'gt-shirt', label: 'Shirt' }),
    });
    const r1 = await run(recognised.deps, [
      () => photo(1),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'change'),
    ]);
    expect(r1.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women' });
    expect(r1.session.garmentKey).toContain('000000000001');
    expect(recognised.calls.corrected).toBe(1);

    const listed = fakeDeps();
    const at = await atPick(listed.deps);
    await handle(at.session, tap(at, 'change'), CTX, listed.deps);
    expect(listed.calls.corrected).toBe(0);
  });

  it('a quote error is shown before any credits are taken', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps } = fakeDeps({
      quote: async () => {
        throw new AppError('VALIDATION', 400, 'face not found or inactive');
      },
    });
    const r = await atPick(deps);
    expect(texts(r.messages)).toContain('face not found or inactive');
    expect(r.session.state).toBe('MAIN_MENU');
  });
});

describe('engine: selecting poses', () => {
  it('a tap selects and reports the count and cost; tapping again removes it', async () => {
    const { deps } = fakeDeps();
    const { at, r: one } = await pickLooks(deps, ['a']);
    expect(texts(one.messages)).toEqual(['1 selected · 5 credits']);
    expect(buttonTitles(one.messages[0])).toEqual(['Generate', 'Clear']);
    expect(one.session.picked).toEqual(['a']);
    const off = await handle(one.session, tap(at, 'look', 'a'), CTX, deps);
    expect(texts(off.messages)).toEqual(['0 selected · 0 credits']);
    expect(off.session.picked).toEqual([]);
  });

  it('Clear empties the selection', async () => {
    const { deps } = fakeDeps();
    const { r } = await pickLooks(deps, ['a', 'c']);
    const cleared = await handle(r.session, tap(r, 'clear'), CTX, deps);
    expect(cleared.session.picked).toEqual([]);
    expect(texts(cleared.messages)).toEqual(['0 selected · 0 credits']);
  });

  it('declines a 21st pose', async () => {
    const big = { ...TEMPLATE, looks: Array.from({ length: 22 }, (_, i) => look(`l${i}`)) };
    const { deps } = fakeDeps({ getTemplates: async () => [big] });
    const at = await atPick(deps);
    let s = at.session;
    for (let i = 0; i < 20; i++) {
      const r = await handle(
        s,
        { type: 'reply', id: encodeReplyId(s.nonce, 'look', `l${i}`) },
        CTX,
        deps,
      );
      s = r.session;
    }
    expect(s.picked).toHaveLength(20);
    const over = await handle(
      s,
      { type: 'reply', id: encodeReplyId(s.nonce, 'look', 'l20') },
      CTX,
      deps,
    );
    expect(texts(over.messages)).toEqual(['You can generate up to 20 poses at a time.']);
    expect(over.session.picked).toHaveLength(20);
  });

  it('a look that is not on the cards is re-prompted', async () => {
    const { deps } = fakeDeps();
    const at = await atPick(deps);
    const r = await handle(
      at.session,
      { type: 'reply', id: encodeReplyId(at.session.nonce, 'look', 'nope') },
      CTX,
      deps,
    );
    expect(texts(r.messages)[0]).toBe('Please use the options above, or type MENU.');
  });

  it('Generate with nothing selected asks for a pose and stays on the cards', async () => {
    const { deps, calls } = fakeDeps();
    const at = await atPick(deps);
    const r = await handle(at.session, tap(at, 'generate'), CTX, deps);
    expect(texts(r.messages)).toEqual(['Tap at least one pose first.']);
    expect(r.session.state).toBe('PICK_LOOKS');
    expect(calls.createRun).toHaveLength(0);
  });

  it('a selection the balance cannot cover goes to NO_CREDITS before any run; credits added return to the cards with the selection kept', async () => {
    const { deps, calls } = fakeDeps({ getBalance: async () => 8 });
    const { r } = await pickLooks(deps, ['a', 'b']);
    const no = await handle(r.session, tap(r, 'generate'), CTX, deps);
    expect(no.session.state).toBe('NO_CREDITS');
    expect(texts(no.messages)[0]).toContain('https://app.test/pricing');
    expect(calls.createRun).toHaveLength(0);
    const back = await handle(no.session, { type: 'creditsAdded', credits: 100 }, CTX, deps);
    expect(texts(back.messages)[0]).toBe('100 credits added.');
    expect(back.session).toMatchObject({ state: 'PICK_LOOKS', picked: ['a', 'b'] });
  });
});

describe('engine: generating', () => {
  it('one template: one run with exactly the picked looks, in tap order', async () => {
    const { deps, calls } = fakeDeps();
    const r = await generated(deps, ['c', 'a']);
    expect(r.session).toMatchObject({
      state: 'GENERATING',
      runs: [{ runId: 'run-1', images: 2 }],
    });
    expect(calls.createRun).toHaveLength(1);
    expect(calls.createRun[0].inputs).toMatchObject({
      looks: [
        { poseId: 'pose-c', backgroundId: 'bg-c' },
        { poseId: 'pose-a', backgroundId: 'bg-a' },
      ],
      catalogueTemplateMappingId: 'map-1',
      faceId: 'face-1',
    });
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
    expect(calls.createRunKeys).toEqual(['wamid.1:0']);
    expect(texts(r.messages)[0]).toBe(
      "Working on 2 images, 10 credits. I'll send each one here as it's ready.",
    );
  });

  it('picks from two templates start one run per template, each with its own key', async () => {
    const { deps, calls } = fakeDeps({ getTemplates: async () => [TEMPLATE, TEMPLATE_2] });
    const r = await generated(deps, ['e', 'a']);
    expect(calls.createRun.map((b) => b.inputs.catalogueTemplateMappingId)).toEqual([
      'map-1',
      'map-2',
    ]);
    expect(calls.createRun.map((b) => b.inputs.looks)).toEqual([
      [{ poseId: 'pose-a', backgroundId: 'bg-a' }],
      [{ poseId: 'pose-e', backgroundId: 'bg-e' }],
    ]);
    expect(calls.createRunKeys).toEqual(['wamid.1:0', 'wamid.1:1']);
    expect(r.session.runs?.map((x) => x.runId)).toEqual(['run-1', 'run-2']);
    expect(texts(r.messages)[0]).toBe(
      "Working on 2 images, 10 credits. I'll send each one here as it's ready.",
    );
  });

  it('quotes every group before creating any run', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps, calls } = fakeDeps({
      getTemplates: async () => [TEMPLATE, TEMPLATE_2],
      quote: async (_u, body) => {
        if (body.inputs.catalogueTemplateMappingId === 'map-2')
          throw new AppError('BAD_CATALOG', 400, 'not configured');
        return { images: 1, perImage: 5, total: 5, balance: 50 };
      },
    });
    const r = await generated(deps, ['a', 'e']);
    expect(calls.createRun).toHaveLength(0);
    expect(texts(r.messages)[0]).toBe('Those poses changed. Please choose again.');
    expect(r.session).toMatchObject({ state: 'PICK_LOOKS', picked: [] });
  });

  it('a later group that fails leaves its looks unstarted and says so', async () => {
    let n = 0;
    const { deps } = fakeDeps({
      getTemplates: async () => [TEMPLATE, TEMPLATE_2],
      createRun: async (_ctx, body) => {
        n++;
        if (n === 2) throw insufficient();
        return { runId: `run-${n}`, images: body.inputs.looks?.length ?? 0 };
      },
    });
    const r = await generated(deps, ['a', 'e']);
    expect(r.session).toMatchObject({
      state: 'GENERATING',
      runs: [{ runId: 'run-1', images: 1 }],
      unstarted: ['e'],
      picked: ['a', 'e'],
    });
    expect(texts(r.messages)).toEqual([
      "Working on 1 image, 5 credits. I'll send each one here as it's ready.",
      "Started 1 of 2 images. The rest couldn't start: insufficient credits",
    ]);
  });

  it('a first group that fails to create is handled like a single failure', async () => {
    const { deps } = fakeDeps({
      createRun: async () => {
        throw insufficient();
      },
    });
    const r = await generated(deps, ['a']);
    expect(r.session).toMatchObject({ state: 'NO_CREDITS', picked: ['a'] });
  });

  it('a look that changed at create time returns to the cards with the selection cleared', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps } = fakeDeps({
      createRun: async () => {
        throw new AppError(
          'BAD_CATALOG',
          400,
          'one or more looks are not configured for this template mapping',
        );
      },
    });
    const r = await generated(deps, ['a']);
    expect(texts(r.messages)[0]).toBe('Those poses changed. Please choose again.');
    expect(r.session).toMatchObject({ state: 'PICK_LOOKS', picked: [] });
  });

  it('a look removed since the cards were shown is dropped, nothing is charged', async () => {
    let current = TEMPLATE;
    const { deps, calls } = fakeDeps({ getTemplates: async () => [current] });
    const { r } = await pickLooks(deps, ['a', 'c']);
    current = { ...TEMPLATE, looks: TEMPLATE.looks.filter((l) => l.id !== 'c') };
    const out = await handle(r.session, tap(r, 'generate'), CTX, deps);
    expect(texts(out.messages)[0]).toBe('Those poses changed. Please choose again.');
    expect(out.session).toMatchObject({ state: 'PICK_LOOKS', picked: ['a'] });
    expect(calls.createRun).toHaveLength(0);
  });

  it('a look with a lower slot gets the type default lower', async () => {
    const { deps, calls } = fakeDeps();
    await generated(deps, ['b']);
    expect(calls.createRun[0].inputs.lowerCatalogId).toBe('lower-default');
  });

  it('a type with a default shoe offers the shoe look and sends the shoe', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, defaultShoeCatalogId: 'shoe-default' }],
    });
    await generated(deps, ['d']);
    expect(calls.createRun[0].inputs.shoeCatalogId).toBe('shoe-default');
  });

  it('a lower-only template sends the photo as the lower garment', async () => {
    const lowerOnly = { ...TEMPLATE, looks: [look('j', { hasUpper: false, hasLower: true })] };
    const { deps, calls } = fakeDeps({ getTemplates: async () => [lowerOnly] });
    await generated(deps, ['j']);
    expect(calls.createRun[0].inputs.lowerGarmentKey).toBe(
      calls.createRun[0].inputs.upperGarmentKey,
    );
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
  });
});

describe('engine: required extra photos', () => {
  it('asks for the third photo before the cards and sends it', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [
        { ...GT_SHIRT, requiresThirdUpload: true, thirdUploadLabel: 'dupatta' },
      ],
    });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    const ask = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(ask.session.state).toBe('ASK_EXTRA_PHOTO');
    expect(texts(ask.messages)[0]).toBe('Now send a photo of the dupatta.');
    const cards = await handle(ask.session, photo(3), CTX, deps);
    expect(cards.session.state).toBe('PICK_LOOKS');
    const one = await handle(cards.session, tap(cards, 'look', 'a'), CTX, deps);
    await handle(one.session, tap(one, 'generate'), CTX, deps);
    expect(calls.createRun[0].inputs.thirdGarmentKey).toContain('000000000003');
  });

  it('a lower-photo type sends that photo instead of a lower item', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [
        { ...GT_SHIRT, requiresLowerUpload: true, lowerUploadLabel: 'pyjama' },
      ],
    });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'men')]);
    const ask = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(texts(ask.messages)[0]).toBe('Now send a photo of the pyjama.');
    const cards = await handle(ask.session, photo(4), CTX, deps);
    const one = await handle(cards.session, tap(cards, 'look', 'b'), CTX, deps);
    await handle(one.session, tap(one, 'generate'), CTX, deps);
    expect(calls.createRun[0].inputs.lowerGarmentKey).toContain('000000000004');
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
  });
});

describe('engine: progress and delivery', () => {
  const finished = (runId: string, images: number, failedPoseIds: string[] = []): InboundEvent => ({
    type: 'runFinished',
    runId,
    images,
    failedPoseIds,
  });

  it('messages while generating report progress summed over the runs', async () => {
    const { deps } = fakeDeps({
      getTemplates: async () => [TEMPLATE, TEMPLATE_2],
      runProgress: async (id) =>
        id === 'run-1' ? { finished: 1, total: 1 } : { finished: 0, total: 1 },
    });
    const gen = await generated(deps, ['a', 'e']);
    const r = await handle(gen.session, { type: 'text', text: 'done yet?' }, CTX, deps);
    expect(texts(r.messages)).toEqual(['Still generating: 1 of 2 done.']);
  });

  it('one run finishing with no failures offers more poses and a new catalog', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const r = await handle(gen.session, finished('run-1', 2), CTX, deps);
    expect(r.session.state).toBe('DELIVERED');
    expect(buttonTitles(r.messages.at(-1))).toEqual(['More poses', 'New catalog']);
  });

  it('with several runs the closing message waits for the last one', async () => {
    const { deps } = fakeDeps({ getTemplates: async () => [TEMPLATE, TEMPLATE_2] });
    const gen = await generated(deps, ['a', 'e']);
    const first = await handle(gen.session, finished('run-1', 1), CTX, deps);
    expect(first.messages).toEqual([]);
    expect(first.session.state).toBe('GENERATING');
    const repeat = await handle(first.session, finished('run-1', 1), CTX, deps);
    expect(repeat.messages).toEqual([]);
    const last = await handle(first.session, finished('run-2', 1), CTX, deps);
    expect(last.session.state).toBe('DELIVERED');
    expect(buttonTitles(last.messages.at(-1))).toEqual(['More poses', 'New catalog']);
  });

  it('a runFinished for an older run changes nothing', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const r = await handle(gen.session, finished('other', 2), CTX, deps);
    expect(r).toEqual({ session: gen.session, messages: [] });
  });

  it('partial failure reports the refund; Retry regenerates only the failed looks', async () => {
    const { deps, calls } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const r = await handle(gen.session, finished('run-1', 2, ['pose-c']), CTX, deps);
    expect(texts(r.messages)[0]).toBe('1 of 2 images failed. The credits for it were refunded.');
    const retry = await handle(r.session, tap(r, 'retry'), CTX, deps);
    expect(retry.session.state).toBe('GENERATING');
    expect(calls.createRun.at(-1)?.inputs.looks).toEqual([
      { poseId: 'pose-c', backgroundId: 'bg-c' },
    ]);
  });

  it('Retry also starts the looks whose run never started', async () => {
    let n = 0;
    const { deps, calls } = fakeDeps({
      getTemplates: async () => [TEMPLATE, TEMPLATE_2],
      createRun: async (_ctx, body) => {
        n++;
        if (n === 2) throw insufficient();
        calls.createRun.push(body);
        return { runId: `run-${n}`, images: body.inputs.looks?.length ?? 0 };
      },
    });
    const gen = await generated(deps, ['a', 'e']);
    const done = await handle(gen.session, finished('run-1', 1), CTX, deps);
    expect(done.session.state).toBe('DELIVERED');
    expect(buttonTitles(done.messages.at(-1))).toEqual(['Retry failed', 'More poses', 'Menu']);
    const retry = await handle(done.session, tap(done, 'retry'), CTX, deps);
    expect(retry.session.state).toBe('GENERATING');
    expect(calls.createRun.at(-1)?.inputs).toMatchObject({
      catalogueTemplateMappingId: 'map-2',
      looks: [{ poseId: 'pose-e', backgroundId: 'bg-e' }],
    });
  });

  it('More poses returns to the cards with the garment, type and face kept', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const done = await handle(gen.session, finished('run-1', 2), CTX, deps);
    const r = await handle(done.session, tap(done, 'more_poses'), CTX, deps);
    expect(r.session).toMatchObject({
      state: 'PICK_LOOKS',
      garmentType: { id: 'gt-shirt' },
      faceId: 'face-1',
      picked: [],
    });
    expect(r.session.garmentKey).toContain('000000000001');
  });

  it('a new photo after delivery starts a new catalog', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const done = await handle(gen.session, finished('run-1', 2), CTX, deps);
    const r = await handle(done.session, photo(5), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_GENDER', picked: [] });
    expect(r.session.garmentType).toBeUndefined();
    expect(r.session.garmentKey).toContain('000000000005');
  });
});

describe('engine: sessions saved by the single-template engine', () => {
  const legacy = {
    v: 1,
    state: 'GENERATING',
    nonce: 'n1',
    page: 0,
    aspectRatio: '3:4',
    resolution: 'HD',
    photos: {},
    picked: ['a'],
    template: { id: 'tpl-1', mappingId: 'map-1', lowerOnly: false, looks: [] },
    count: 1,
    runId: 'run-1',
    runImages: 1,
  } as unknown as Session;

  it('a generating session is read as a one-run list and still gets its closing message', async () => {
    const { deps } = fakeDeps();
    const r = await handle(
      legacy,
      { type: 'runFinished', runId: 'run-1', images: 1, failedPoseIds: [] },
      CTX,
      deps,
    );
    expect(r.session.state).toBe('DELIVERED');
    expect(r.session).not.toHaveProperty('runId');
    expect(r.session).not.toHaveProperty('template');
  });

  it('a session that was still picking starts over like an expired one', async () => {
    const { deps } = fakeDeps();
    const picking = { ...legacy, state: 'PICK_LOOKS', runId: undefined } as unknown as Session;
    const r = await handle(picking, { type: 'reply', id: 'n1|look|a' }, CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/session expired/);
    expect(r.session.state).toBe('MAIN_MENU');
  });
});
```

Add `Session` to the type import at the top of the test file (`import type { EngineDeps, EngineResult, InboundEvent, OutboundMessage, Session } from ...`). Then `to_crlf apps/api/test/messaging-engine.test.ts`.

- [ ] **Step 13: Run the unit tests**

Run: `npx vitest run test/messaging-rules.test.ts test/messaging-engine.test.ts`
Expected: PASS. If a test fails because of an assumption about message order (`r.messages[0..2]` in the first pose-cards test), print `JSON.stringify(r.messages, null, 1)` and correct the *test*, not the engine, unless the message order contradicts the spec flow (prompt, then cards, then footer).

#### Step group D — keep the integration tests compiling and passing

- [ ] **Step 14: Delivery test seed**

`to_lf apps/api/test/integration/whatsapp-delivery.test.ts`; replace

```ts
      picked: [],
      runId,
      runImages: 2,
    });
```
with
```ts
      picked: [],
      runs: [{ runId, images: 2 }],
    });
```
Then `to_crlf`.

- [ ] **Step 15: Conversation integration test**

`to_lf apps/api/test/integration/messaging-conversation.test.ts`, apply with this script (each `old` must occur exactly once; the script asserts it):

```bash
python - <<'EOF'
p = 'apps/api/test/integration/messaging-conversation.test.ts'
s = open(p, encoding='utf-8', newline='').read()

def sub(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)

sub("  // A connected seller with 100 credits, walked to the look carousel for 1 pose.",
    "  // A connected seller with 100 credits, walked to the pose cards.")
sub("""    msgs = await send(tapIn(msgs, 'gt', seeded.garmentTypeId));
    const countMsgs = msgs;
    msgs = await send(tapIn(msgs, 'count', '1'));
    return { userId, account, acct, send, msgs, countMsgs };""",
    """    msgs = await send(tapIn(msgs, 'gt', seeded.garmentTypeId));
    return { userId, account, acct, send, msgs };""")

# First test: rewrite the whole `it` block.
start = s.index("  it('photo → gender → type → count → pick creates one charged job")
end = s.index("  it('the same message id never creates a second run'")
s = s[:start] + """  it('photo → gender → type → pick → generate creates one charged job and records the run', async () => {
    const w = await walkToPick('conv');
    const { userId, account, acct, send } = w;
    const prompt = w.msgs.find((m) => m.kind === 'buttons');
    expect(prompt && prompt.kind === 'buttons' ? prompt.text : '').toContain('Each one is 5 credits');

    const selected = await send(tapIn(w.msgs, 'look', seeded.lookId));
    await send(tapIn(selected, 'generate'));
    const session = await loadSession(app.redis, acct.channel, acct.externalId);
    expect(session?.state).toBe('GENERATING');
    expect(session?.runs).toHaveLength(1);

    const [run] = await app.db
      .select()
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.catalogueId, session?.runs?.[0]?.runId as string));
    expect(run).toMatchObject({ messagingAccountId: account.id, userId });
    expect(run.jobIds).toHaveLength(1);

    // D17: the bot is charged exactly what it quoted.
    expect(await balanceOf(userId)).toBe(95);
  });

""" + s[end:]

sub("    const body = buildTryonBody(session, [seeded.lookId]);",
    """    const template = session.templates?.[0];
    if (!template) throw new Error('no pool in the session');
    const body = buildTryonBody(session, template, [seeded.lookId]);""")
open(p, 'w', encoding='utf-8', newline='').write(s)
EOF
to_crlf apps/api/test/integration/messaging-conversation.test.ts
```

Also fix the comment above the 2K config in `beforeAll`: change `so the count row reads '1 pose · 5 credits' and one image costs exactly 5.` to `so the prompt reads 'Each one is 5 credits' and one image costs exactly 5.` (use the same `to_lf`/edit/`to_crlf` wrap).

- [ ] **Step 16: Run the gates**

```bash
pnpm --filter @aivastra/api typecheck
npx vitest run test/messaging-rules.test.ts test/messaging-engine.test.ts test/whatsapp
npx vitest run --config vitest.integration.config.ts messaging whatsapp
cd ../.. && npx biome check apps/api/src/modules/messaging apps/api/test/messaging-rules.test.ts apps/api/test/messaging-engine.test.ts apps/api/test/helpers/engine-fakes.ts apps/api/test/integration/messaging-conversation.test.ts apps/api/test/integration/whatsapp-delivery.test.ts
```
Expected: typecheck clean; all unit and integration tests pass; biome reports no errors (apply `npx biome check --write` to the same paths for pure formatting complaints, then `to_crlf` them again and re-run).

- [ ] **Step 17: Commit**

```bash
git diff --stat   # only the files in this task; no whole-file diffs
git add apps/api/src/modules/messaging apps/api/test
git commit -m "feat(whatsapp): pick poses across all templates, one run per template

Removes the pose-count step. The bot shows every active template's eligible
looks for the garment type (pose + background pairs de-duplicated), the seller
taps any number of them (max 20) and a running Generate button starts the runs:
one createRun per template, all quoted before the first charge, each with its
own idempotency key. A group that fails after an earlier one was charged leaves
its looks unstarted for Retry. Sessions saved by the old engine are upgraded.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Two-template integration test

**Files:**
- Modify: `apps/api/test/integration/messaging-conversation.test.ts`

**Interfaces:**
- Consumes: Task 1's engine and real `getTemplates`; the existing seeding (one pose, one template, one look, one mapping, one pose workflow).
- Produces: `seeded.lookId2` (a look of a second template mapped to the same garment type).

- [ ] **Step 1: Write the failing test**

`to_lf apps/api/test/integration/messaging-conversation.test.ts`, then apply:

```bash
python - <<'EOF'
p = 'apps/api/test/integration/messaging-conversation.test.ts'
s = open(p, encoding='utf-8', newline='').read()

def sub(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)

sub("  let seeded: { garmentTypeId: string; lookId: string };",
    "  let seeded: { garmentTypeId: string; lookId: string; lookId2: string };")

sub("""    if (!garmentType || !look) throw new Error('seeding failed');
    // Assign seeded = { garmentTypeId, lookId } (lookId = the catalogue_template_looks.id).
    seeded = { garmentTypeId: garmentType.id, lookId: look.id };""",
    """    // A second template for the same type, so a pick can span templates.
    const [pose2] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `WaPose2${sfx}`,
        genderSlug: 'women',
        r2Key: `wa-p2${sfx}.jpg`,
        thumbnailKey: `wa-p2${sfx}.jpg`,
        workflowTemplateId: workflow.id,
      })
      .returning();
    const [template2] = await app.db
      .insert(schema.catalogueTemplates)
      .values({ genderSlug: 'women', label: `WaTemplate2${sfx}`, sortOrder: 1 })
      .returning();
    const [look2] = await app.db
      .insert(schema.catalogueTemplateLooks)
      .values({
        templateId: template2.id,
        poseAssetId: pose2.id,
        backgroundId: background.id,
        sortOrder: 0,
      })
      .returning();
    const [mapping2] = await app.db
      .insert(schema.catalogueTemplateSubcategories)
      .values({ templateId: template2.id, subcategoryId: garmentType.id })
      .returning();
    await app.db.insert(schema.catalogueTemplatePoseWorkflows).values({
      mappingId: mapping2.id,
      poseAssetId: pose2.id,
      workflowTemplateId: workflow.id,
    });
    if (!garmentType || !look || !look2) throw new Error('seeding failed');
    // lookId / lookId2 = the catalogue_template_looks.id of each template's look.
    seeded = { garmentTypeId: garmentType.id, lookId: look.id, lookId2: look2.id };""")

sub("  it('the same message id never creates a second run'",
    """  it('picks from two templates start one run per template, each charged once', async () => {
    const w = await walkToPick('two');
    const { userId, account, acct, send } = w;
    // Both templates' looks are on the same cards.
    await send(tapIn(w.msgs, 'look', seeded.lookId));
    const selected = await send(tapIn(w.msgs, 'look', seeded.lookId2));
    expect(selected[0].kind === 'buttons' ? selected[0].text : '').toBe('2 selected · 10 credits');
    await send(tapIn(selected, 'generate'));

    const session = await loadSession(app.redis, acct.channel, acct.externalId);
    expect(session?.state).toBe('GENERATING');
    expect(session?.runs).toHaveLength(2);
    expect(session?.unstarted).toBeUndefined();

    const runs = await app.db
      .select()
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.messagingAccountId, account.id));
    expect(runs).toHaveLength(2);
    for (const r of runs) expect(r.jobIds).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(90);
  });

  it('the same message id never creates a second run'""")
open(p, 'w', encoding='utf-8', newline='').write(s)
EOF
to_crlf apps/api/test/integration/messaging-conversation.test.ts
```

(The new test sits before the `dup` test; the first test still taps only `seeded.lookId`, so its 95-credit assertion is unaffected.)

- [ ] **Step 2: Run it**

Run: `npx vitest run --config vitest.integration.config.ts messaging-conversation`
Expected: PASS — all tests in the file, including the new one (two `messaging_runs` rows, balance 90). If the new test fails because only one template is listed, check that `listCatalogueTemplates` orders by `sortOrder` and that the second template's pose, background and workflow rows satisfy the same filters as the first (the seeding mirrors the first template exactly); fix the seeding, not the engine.

- [ ] **Step 3: Run the whole messaging/whatsapp integration set**

Run: `npx vitest run --config vitest.integration.config.ts messaging whatsapp`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/integration/messaging-conversation.test.ts
git commit -m "test(whatsapp): a pick spanning two templates starts two charged runs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md`
- Modify: `docs/superpowers/specs/2026-10-14-whatsapp-pose-selection-design.md`
- Modify: `docs/progress.md`
- Modify: `docs/superpowers/handoff/2026-10-13-whatsapp-bot-handoff.md`

- [ ] **Step 1: Amend the main spec**

`to_lf docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md`, then run (every anchor is asserted):

```bash
python - <<'EOF'
p = 'docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md'
lines = open(p, encoding='utf-8', newline='').read().split('\n')

def find(pred, what):
    hits = [i for i, l in enumerate(lines) if pred(l)]
    assert len(hits) == 1, (what, hits)
    return hits[0]

# D44 / D45 rows, whole line.
i = find(lambda l: l.startswith('| D44 |'), 'D44')
lines[i] = ("| D44 | Choosing poses | **Revised 2026-10-14** (`2026-10-14-whatsapp-pose-selection-design.md`; supersedes steps 4–5 of D40). "
            "There is no \"how many poses\" step. The seller sees the poses of **every** active template for the garment type "
            "(a pose + background pair in two templates shown once) as carousel pages of 10, taps any number up to 20, and taps "
            "again to remove one. Every tap answers \"N selected · X credits\" with [Generate] [Clear]. Because a catalogue belongs "
            "to one template mapping, a pick spanning templates is created as one run per template through the existing create "
            "path (no api change): all groups are quoted before the first charge, and each call has its own idempotency key. "
            "Replaces D24. |")
i = find(lambda l: l.startswith('| D45 |'), 'D45')
lines[i] = ("| D45 | Confirmation | **Revised 2026-10-14.** No separate Confirm step. The cost per pose and the balance are shown "
            "with the cards, and the running cost with every selection; tapping [Generate] is the seller's agreement to spend. "
            "Too few credits is caught at [Generate] and again by the create path. |")

# D43 template clause.
i = find(lambda l: l.startswith('| D43 |'), 'D43')
old = 'Template: the top-sorted active template mapped to the garment type.'
assert old in lines[i]
lines[i] = lines[i].replace(old, 'Templates: every active template mapped to the garment type (revised 2026-10-14, D44).')

# Section 8 diagram: steps 4 and 5.
a = find(lambda l: l.startswith('   4 ASK_POSE_COUNT'), 'step 4')
b = find(lambda l: 'is offered with every "Added" reply.' in l, 'step 5 end')
lines[a:b + 1] = [
    '   4 PICK_LOOKS            prompt with the cost per pose and the balance ([Change garment]),',
    '                         then carousel pages of every active template\'s poses (10 per page, [More]);',
    '                         a tap selects a pose, a second tap removes it; every tap answers',
    '                         "N selected · X credits" [Generate] [Clear] (max 20 poses)',
    '                         ─▶ "Change garment" returns to ASK_GARMENT_TYPE',
    '                         ─▶ [Generate] with a total the balance cannot cover: NO_CREDITS',
    '                            (the selection is kept)',
]

# Section 8 bullets. ("More poses, same garment" already says it returns to step 4,
# which is now the pose cards, so it stays as is.)
i = find(lambda l: l.startswith('- **Picking the same look twice**'), 'same look bullet')
lines[i] = '- **Tapping a selected pose again** removes it from the selection.'

# Section 8: GENERATING box text.
i = find(lambda l: 'one create call ➜ one job per image.' in l, 'generating box')
lines[i] = lines[i].replace('one create call ➜ one job per image.',
                            'one create call per template ➜ one job per image.')

# Section 9.
i = find(lambda l: 'reply buttons allow), the garment-type fallback and the pose count.' in l, 's9 list')
lines[i] = lines[i].replace('reply buttons allow), the garment-type fallback and the pose count.',
                            'reply buttons allow) and the garment-type fallback.')
a = find(lambda l: l.startswith('The carousel is used for one step only'), 's9 para start')
b = find(lambda l: 'is checked in T1.' in l, 's9 para end')
lines[a:b + 1] = [
    'The carousel is used for one step only: picking poses (step 4). One card per eligible look of every',
    'active template for the type, showing the look\'s pose image. Paging: a carousel shows up to 10',
    'cards; a reply-button message with [More] follows it while more cards remain, together with',
    '[Generate] and [Clear] (reply buttons stop at three).',
    '',
    'A card tap selects or removes one item, so picking several poses is one tap per pose, each answered',
    '"N selected · X credits". The seller finishes with [Generate]. Whether this feels acceptable on a',
    'real device is checked in T1.',
]

# Section 13.
i = find(lambda l: l.startswith('| A template\'s look was deactivated after the seller picked it'), 's13 row')
lines[i] = ('| A template\'s look was deactivated after the seller picked it | [Generate] re-reads the pool, drops it and '
            'says "Those poses changed. Please choose again."; nothing is charged. If the create call rejects it, the '
            'selection is cleared with the same message. |')

open(p, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
EOF
to_crlf docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md
grep -n "ASK_POSE_COUNT\|How many poses\|pose count\|count step\|Added, " docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md
```

The final `grep` lists any remaining mention. For each hit that describes the *current* behaviour, reword it to the picking flow (pose picks, [Generate]); leave hits inside the "Superseded"/"Revised" history text of D24, D40 and D42 as they are. Re-run `to_crlf` after any manual edit.

- [ ] **Step 2: Tidy the delta spec**

The button after each carousel page reads "More" (the existing `COPY.btnMore`), so correct the delta spec: `to_lf` it, run `sed -i 's/\[More poses\]/[More]/g' docs/superpowers/specs/2026-10-14-whatsapp-pose-selection-design.md`, then in section 7 of that file change "`btnGenerate`, `btnClear`" to "`btnGenerate`, `btnClear`, `btnChangeGarment`" and add after the sentence about the 20-pose cap in P4: "The retry of a failed image is matched by pose id (all delivery reports), so a pose that appears in two templates with different backgrounds is retried in both." Do not run `to_crlf` on this file (it was created LF).

- [ ] **Step 3: Progress log and handoff**

```bash
head -40 docs/progress.md
grep -n "^## \|^# " docs/superpowers/handoff/2026-10-13-whatsapp-bot-handoff.md | head -20
```
Add, at the top of `docs/progress.md` in the same format as the newest entry (date `2026-10-14`, Done / Failed-Not-Done / Open Questions): **Done** — WhatsApp bot: the "how many poses" step is gone; the seller picks from every active template's poses (max 20, toggle, running Generate button); a pick spanning templates runs as one run per template (all quoted before the first charge); spec `2026-10-14-whatsapp-pose-selection-design.md`, plan `2026-10-14-whatsapp-pose-selection.md`. **Open Questions** — (1) production has no active catalogue templates yet, so the bot cannot offer any type there until admin activates some; (2) the paid "images ready" template is sent per run when the 24 h window closed (a `batch_id` would fix it); (3) a retry matches failed images by pose id, so a pose shared by two templates with different backgrounds is retried in both. In the handoff file add the same three points to its open-items section. Use `to_lf` / edit / `to_crlf` on both files.

- [ ] **Step 4: Commit**

```bash
git diff --stat   # docs only; the CRLF files show only the edited lines
git add docs
git commit -m "docs(whatsapp): pose selection across templates (D43/D44/D45), progress, handoff

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

- **Spec coverage:** P1 (no count step) → Task 1 step 8 (`ASK_POSE_COUNT` removed). P2 (pool, de-dup, admin order) → `buildPool` + tests. P3 (running Generate, toggle, page-end buttons, nonce kept) → `PICK_LOOKS` render/reply + tests. P4 (cap 20) → `MAX_PICKS` + cap test. P5 (Generate = agreement, balance check) → `generate` action + NO_CREDITS test. P6 (one run per template, quote-all-first, per-group key, partial start, progress sum, finish on last run, retry covers unstarted) → `generate`, `runFinished`, `retryLookIds` + tests. P7 (agent mode out of scope) → spec only. Session shape/size, legacy upgrade, edge cases (empty Generate, 21st, removed look, NO_CREDITS keeps selection, stale buttons) → covered in Task 1 tests. Docs → Task 3.
- **Placeholders:** none; every code step carries the code, every command its expected result.
- **Type consistency:** `PoolTemplate`/`PoolLook`/`PickCard`/`RunRef` (types.ts) are what `buildPool`, `groupByTemplate`, `buildTryonBody(s, template, lookIds)`, `retryLookIds`, `loadPool` and the fakes use; `getTemplates` is the only deps method renamed; `runs`/`unstarted`/`templates` are the only new session fields.
- **Known limitation (not fixed here):** retry matches failures by pose id (delivery reports pose ids only); a pose shared by two templates with different backgrounds is retried in both. Recorded in the docs task.
