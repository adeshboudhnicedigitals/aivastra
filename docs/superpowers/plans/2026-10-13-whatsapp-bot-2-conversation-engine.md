# WhatsApp bot — Plan 2: Conversation engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A channel-agnostic conversation engine that walks a connected seller through management's five-step catalog flow — garment photo, "Create catalogue for" gender, garment type (recognised automatically, or picked from a list), how many poses, which poses — and starts generation on the last pick, producing abstract messages that plan 3 renders to WhatsApp.

**Architecture:** A deterministic `handle(session, event, ctx, deps)` function in `apps/api/src/modules/messaging/engine/` decides every transition and the messages to send. All I/O sits behind an `EngineDeps` interface: unit tests drive the engine with in-memory fakes; the real implementation (`messaging/deps.ts`) reuses the studio's own garment-type, face and catalogue-template queries (extracted into shared functions, no behaviour change), prices runs with the create path's `resolveTryonPlan`, creates runs through `createJob`, and asks for garment recognition through a Redis stream that the dispatcher answers (the dispatcher side is plan 5). Sessions live in Redis for 24 hours.

**Tech Stack:** TypeScript (ESM), Fastify 5, Drizzle ORM, ioredis, Zod, prom-client, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md` — sections 8 and 8a (flow, defaults, recognition), 9 (selection), 10 (credits), 13 (failures); decisions D7, D16, D17, D23, D31, D40–D47.

**This is plan 2 of 5.** Depends on plan 1 (`messaging_accounts`, `identity.ts`, the `MESSAGING_WHATSAPP_ENABLED` env block). Plan 3 owns everything Meta-facing: webhook, inbound consumer, downloading the photo from Meta (it calls `storeGarmentPhoto` from this plan), rendering `OutboundMessage`s, STOP/START, `CONNECT <code>`, the connect prompt for unknown numbers, per-sender locking, result delivery and the `runFinished` / `creditsAdded` events. Plan 5 owns the dispatcher's classify lane and the ComfyUI workflow. **Until plan 5 ships, keep `GARMENT_RECOGNITION_ENABLED` off: the bot then always shows the garment-type list, which is the complete fallback path.**

## Decisions this plan makes (recorded in Task 8)

1. **D33 — the engine is deterministic, not strictly pure.** It awaits `deps` for option lists and side effects, but performs no I/O of its own and takes its randomness (`newNonce`) from `deps`. Spec section 5 called it "pure".
2. **D34 — runs are tracked in a `messaging_runs` table, not `job_inputs.params.channel`.** The create request's `params` object is a strict Zod schema that strips unknown keys, and `job_inputs.params` is merged into the ComfyUI workflow params — the wrong place for a routing flag. A run is one `catalogueId` (every job of one create call shares it).
3. **D48 — recognition is waited for inside the conversation, behind a kill switch.** After the gender tap, `deps.recognizeGarment` appends a request to the `classify:requests` stream and polls the result key for at most 8 seconds (spec 8a). The wait happens inside `runConversation`, under plan 3's per-sender lock. `GARMENT_RECOGNITION_ENABLED` (literal `'true'`) turns it on; off means the list every time, which is also how recognition is dropped if the trial fails. The request/result shapes live in `@aivastra/types` (`garment-recognition.ts`) because two processes depend on them.
4. **D49 — looks that would need a question are not offered.** The create path rejects a look whose lower or shoe slot is empty (`create.ts`, "lower garment required for this pose" / "shoe catalog item required for this pose"), and the chat asks no lower/shoe question (D43). So `eligibleLooks` drops a look with a shoe slot when the garment type has no default shoe, a combined upper+lower look when there is no default lower (and no lower upload), and a lower-only look in a mixed template unless the type takes a lower photo. A type left with no eligible look is "not available on WhatsApp" (D47).

## Global Constraints

- Feature flag and env rules from plan 1 apply (`MESSAGING_WHATSAPP_ENABLED`, literal `'true'`, `=== true`). `GARMENT_RECOGNITION_ENABLED` follows the same pattern.
- **The bot never creates users and never grants credits** (D13). It only spends through `createJob`.
- **Same validation and price as the web** (D17): every create body goes through `CreateTryOnJobRequest.parse`, quotes come from `resolveTryonPlan`, runs from `createJob` wrapped in `withIdempotency(app, 'jobs', userId, key, …)` with the same `updateLastUsedPosePreset` follow-up the `/v1/jobs/tryon` route does.
- **Every run is a catalogue-template run** (D42): the create body always carries `looks` + `catalogueTemplateMappingId`, never `backgroundId` / `poseIds`.
- **Standard try-on only** (D16, D31): garment types with `requiresMannequinStep` are never offered.
- **Never send `platform`** (D23). Aspect ratio and resolution are the seller's saved defaults (D43).
- **Recognition can never cost the seller a run** (spec 8a): every failure — flag off, no slugged types, Redis error, timeout, `no_worker`, `failed`, an answer outside the options — returns `null`, and the engine shows the garment-type list.
- Option lists come from the same queries as the studio's routes — extracted, not copied. Recognition options come from the dev API's cached list, `getCatalogOptions(app, { gender, publicOnly: true })` (spec 8a), not a new query.
- No production schema work; migrations ship through CI/CD → `db:migrate:prod`.
- No `console.log`; comment the *why*.
- English only; every user-visible string lives in `engine/copy.ts` (D8).
- WhatsApp limits (spec section 9, unverified until plan 3's spike — T1): ≤3 reply buttons, button title ≤20 characters, ≤10 list rows, list row title ≤24 characters, ≤10 cards per carousel, ids ≤200 characters.
- `packages/types` and `packages/observability` publish from `dist/`: rebuild them (`pnpm --filter @aivastra/types build`, `pnpm --filter @aivastra/observability build`) after editing, before the api typechecks against them.

## What changed from the first version of this plan

The first version (commit `f930abf6`) followed the ten-step studio-like flow. Management's five-step flow (spec D40–D47) replaced it on 2026-10-13. Kept: reply ids, the deterministic engine, the `messaging_runs` table, photo storage, the session store, the idempotent create and the query extraction. Gone: the aspect, face, look-mode, background, pose, lower, shoe and confirm steps, back photos, the optional fourth photo, "use my last poses", and the backgrounds/poses/catalog-tree query extractions. New: recognition (Task 5), pose count and look picking, eligibility rules.

## File structure

| File | Responsibility |
|---|---|
| `apps/api/src/modules/messaging/engine/types.ts` (create) | `Session`, `InboundEvent`, `OutboundMessage`, option types, `EngineDeps`, `EngineContext` |
| `apps/api/src/modules/messaging/engine/copy.ts` (create) | every English string |
| `apps/api/src/modules/messaging/engine/reply-id.ts` (create) | encode / decode button, row and card ids |
| `apps/api/src/modules/messaging/engine/rules.ts` (create) | look eligibility, extra photo slots, create-body builder |
| `apps/api/src/modules/messaging/engine/engine.ts` (create) | `handle()` — the state machine |
| `packages/types/src/garment-recognition.ts` (create) | api ↔ dispatcher recognition contract |
| `packages/observability/src/metrics.ts` (modify) | recognition outcome and correction counters |
| `apps/api/src/env.ts` (modify) | `GARMENT_RECOGNITION_ENABLED` |
| `apps/api/src/modules/messaging/classify.ts` (create) | `recognizeGarment`, `matchAnswer`, correction metric |
| `apps/api/src/modules/models/queries.ts` (create) | extracted garment-type, face and catalogue-template queries |
| `apps/api/src/modules/models/routes.ts` (modify) | those three handlers call `queries.ts` |
| `packages/db/src/schema/messaging.ts` (modify) | `messaging_runs` table |
| `apps/api/src/modules/messaging/runs.ts` (create) | quote, create run, run progress |
| `apps/api/src/modules/messaging/photos.ts` (create) | store a received photo as an owned garment upload |
| `apps/api/src/modules/messaging/deps.ts` (create) | real `EngineDeps` |
| `apps/api/src/modules/messaging/session-store.ts` (create) | Redis load / save |
| `apps/api/src/modules/messaging/conversation.ts` (create) | `runConversation()` — load, handle, save |
| tests | `apps/api/test/messaging-reply-id.test.ts`, `messaging-rules.test.ts`, `messaging-engine.test.ts`, `messaging-classify.test.ts`, `apps/api/test/helpers/engine-fakes.ts`, `apps/api/test/integration/messaging-classify.test.ts`, `apps/api/test/integration/messaging-conversation.test.ts` |

---

### Task 1: Engine types, copy and reply ids

**Files:**
- Create: `apps/api/src/modules/messaging/engine/types.ts`
- Create: `apps/api/src/modules/messaging/engine/copy.ts`
- Create: `apps/api/src/modules/messaging/engine/reply-id.ts`
- Test: `apps/api/test/messaging-reply-id.test.ts`

**Interfaces:**
- Produces: every type in `types.ts`; `COPY`; `encodeReplyId(nonce, action, value?)`, `decodeReplyId(id)`.

- [ ] **Step 1: Write the types**

`apps/api/src/modules/messaging/engine/types.ts`:

```ts
import type { CreateTryOnJobRequest } from '@aivastra/types';
import type { z } from 'zod';

export type Gender = 'women' | 'men' | 'girls' | 'boys';
// The four values PATCH /v1/me accepts as users.default_aspect_ratio.
export type AspectRatio = '1:1' | '2:3' | '3:4' | '4:5';
export type Resolution = 'HD' | '2K' | '4K';
export type TryonBody = z.infer<typeof CreateTryOnJobRequest>;

// Spec section 8: photo → gender → (recognised or listed) garment type →
// required extra photos → pose count → look picks → generating → delivered.
export type State =
  | 'MAIN_MENU'
  | 'ASK_GARMENT_PHOTO'
  | 'ASK_GENDER'
  | 'ASK_GARMENT_TYPE'
  | 'ASK_EXTRA_PHOTO'
  | 'ASK_POSE_COUNT'
  | 'PICK_LOOKS'
  | 'NO_CREDITS'
  | 'GENERATING'
  | 'DELIVERED';

// Uploads a garment type requires (D46). The optional fourth photo is never asked.
export type PhotoSlot = 'lowerFront' | 'third';

export interface GarmentTypeOption {
  id: string;
  label: string;
  requiresLowerUpload: boolean;
  requiresThirdUpload: boolean;
  lowerUploadLabel: string | null;
  thirdUploadLabel: string | null;
  defaultLowerCatalogId: string | null;
  defaultShoeCatalogId: string | null;
}

// One (pose, background) pairing of a catalogue template — one image.
export interface TemplateLook {
  id: string;
  poseId: string;
  backgroundId: string;
  label: string;
  imageUrl: string;
  hasUpper: boolean;
  hasLower: boolean;
  hasShoes: boolean;
}

export interface TemplateOption {
  id: string;
  mappingId: string;
  looks: TemplateLook[];
}

export interface Session {
  v: 1;
  state: State;
  // Changes every time a new step is prompted; every button/row/card id carries
  // it, so a tap on an older message is recognised and ignored (spec section 8).
  nonce: string;
  // List / card paging within the current step. Paging keeps the nonce, so a
  // card from page 1 still works after "More".
  page: number;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  garmentKey?: string;
  gender?: Gender;
  garmentType?: GarmentTypeOption;
  // The type came from recognition, not the list: a later "Change" is counted
  // as a correction (spec 8a metrics).
  recognized?: boolean;
  photos: Partial<Record<PhotoSlot, string>>;
  faceId?: string;
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

// Normalised by plan 3 from Meta's webhook payloads.
export type InboundEvent =
  | { type: 'text'; text: string }
  // A tap on a reply button, list row or carousel card.
  | { type: 'reply'; id: string }
  // A photo already downloaded, stored and bound to the user (photos.ts).
  | { type: 'image'; garmentKey: string }
  | { type: 'unsupportedMedia' }
  | { type: 'runFinished'; runId: string; images: number; failedPoseIds: string[] }
  | { type: 'creditsAdded'; credits: number };

export interface Button {
  id: string;
  title: string;
}

export type OutboundMessage =
  | { kind: 'text'; text: string }
  | { kind: 'buttons'; text: string; buttons: Button[] }
  | {
      kind: 'list';
      text: string;
      buttonLabel: string;
      rows: { id: string; title: string; description?: string }[];
    }
  | { kind: 'cards'; text: string; cards: { id: string; imageUrl: string; title: string }[] };

export interface EngineContext {
  userId: string;
  // messaging_accounts.id — which chat a run's results go back to.
  accountId: string;
  // Meta's message id of the inbound event; the idempotency key for a run.
  messageId: string;
}

export interface Quote {
  images: number;
  perImage: number;
  total: number;
  balance: number;
}

export interface EngineDeps {
  newNonce(): string;
  getUserDefaults(userId: string): Promise<{ aspectRatio: AspectRatio; resolution: Resolution }>;
  getBalance(userId: string): Promise<number>;
  // Types the bot can offer: standard try-on with at least one template mapping.
  listGarmentTypes(gender: Gender): Promise<GarmentTypeOption[]>;
  // Spec 8a. Null means "show the list" — for every failure, never an error.
  recognizeGarment(
    garmentKey: string,
    gender: Gender,
  ): Promise<{ garmentTypeId: string; label: string } | null>;
  recordRecognitionCorrected(): void;
  // The top-sorted active template for the type (D43), or null.
  getTemplate(gender: Gender, garmentTypeId: string): Promise<TemplateOption | null>;
  // The first active face for the gender and type in admin order (D43), or null.
  getDefaultFaceId(gender: Gender, garmentTypeId: string): Promise<string | null>;
  // Throws AppError for anything createJob would reject.
  quote(userId: string, body: TryonBody): Promise<Quote>;
  // Throws AppError('INSUFFICIENT_CREDITS', 402) when the balance is short.
  createRun(ctx: EngineContext, body: TryonBody): Promise<{ runId: string; images: number }>;
  runProgress(runId: string): Promise<{ finished: number; total: number }>;
  links: { pricing: string; help: string; studio: string };
}

export interface EngineResult {
  session: Session;
  messages: OutboundMessage[];
}
```

- [ ] **Step 2: Write the copy**

`apps/api/src/modules/messaging/engine/copy.ts`:

```ts
// Every user-visible string the bot sends (D8: English only, one file).
// Button titles are capped at 20 characters by WhatsApp; list row titles at 24.
export const COPY = {
  menu: 'What would you like to do?',
  btnNewCatalog: 'New catalog',
  btnCredits: 'Credits',
  btnHelp: 'Help',
  btnMenu: 'Menu',
  btnMore: 'More',
  btnStartOver: 'Start over',
  btnMorePoses: 'More poses',
  btnRetryFailed: 'Retry failed',
  listChoose: 'Choose',
  moreOptions: 'More options:',

  credits: (balance: number, pricing: string) =>
    `You have ${balance} credits. Buy more on the website: ${pricing}`,
  help: (help: string) =>
    `Send a photo of your garment to start a catalog, or type MENU at any time. Need a person? ${help}`,

  askGarmentPhoto: 'Send a photo of your garment, laid flat and fully visible.',
  askGender: 'Create catalogue for:',
  genders: { women: 'Women', men: 'Men', boys: 'Boys', girls: 'Girls' } as const,
  askGarmentType: 'Which garment is it?',
  detected: (label: string) => `Detected: ${label}.`,
  notAvailable: (label: string, studio: string) =>
    `${label} catalogs aren't available on WhatsApp yet. You can create one in the web studio: ${studio}`,
  askPhoto: {
    lowerFront: (label: string | null) => `Now send a photo of the ${label ?? 'lower garment'}.`,
    third: (label: string | null) => `Now send a photo of the ${label ?? 'third garment'}.`,
  },
  askCount: (balance: number) => `How many poses do you want? Your balance: ${balance} credits.`,
  // At most "9 poses · 999 credits" (21 characters).
  countRow: (n: number, credits: number) => `${n} ${n === 1 ? 'pose' : 'poses'} · ${credits} credits`,
  rowChangeGarment: 'Wrong garment? Change',
  pickLooks: (count: number) =>
    `Tap ${count} ${count === 1 ? 'pose' : 'poses'}. Generation starts after the last one.`,
  lookAdded: (k: number, n: number) => `Added, ${k} of ${n}.`,
  lookAlreadyAdded: 'That pose is already added.',
  noCredits: (pricing: string) =>
    `You don't have enough credits for this. Buy more on the website, then come back: ${pricing}`,
  creditsAdded: (n: number) => `${n} credits added.`,
  generating: (n: number, credits: number) =>
    `Working on ${n} ${n === 1 ? 'image' : 'images'}, ${credits} credits. I'll send each one here as it's ready.`,
  stillGenerating: (finished: number, total: number) =>
    `Still generating: ${finished} of ${total} done.`,
  delivered: 'All done. What next?',
  partlyFailed: (failed: number, total: number) =>
    `${failed} of ${total} ${total === 1 ? 'image' : 'images'} failed. The credits for ${failed === 1 ? 'it were' : 'them were'} refunded.`,
  posesChanged: 'Those poses changed. Please choose again.',

  stale: 'That option is from an earlier step.',
  sessionExpired: "Your last session expired, let's start again.",
  reprompt: 'Please use the options above, or type MENU.',
  notNow: "I wasn't expecting a photo just now.",
  unsupported: 'Please send a photo (JPG or PNG), not a video or document.',
  nothingAvailable: 'Nothing is available for that choice right now.',
} as const;
```

- [ ] **Step 3: Write the failing reply-id tests**

`apps/api/test/messaging-reply-id.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeReplyId, encodeReplyId } from '../src/modules/messaging/engine/reply-id';

describe('reply ids', () => {
  it('round-trips nonce, action and value', () => {
    const id = encodeReplyId('n1', 'look', '6f1c3b2a-0000-4000-8000-000000000001');
    expect(decodeReplyId(id)).toEqual({
      nonce: 'n1',
      action: 'look',
      value: '6f1c3b2a-0000-4000-8000-000000000001',
    });
  });
  it('allows an empty value', () => {
    expect(decodeReplyId(encodeReplyId('n1', 'change'))).toEqual({
      nonce: 'n1',
      action: 'change',
      value: '',
    });
  });
  it('rejects ids it did not make', () => {
    expect(decodeReplyId('hello')).toBeNull();
    expect(decodeReplyId('a|b|c|d')).toBeNull();
  });
});
```

Run (from `apps/api`): `npx vitest run test/messaging-reply-id.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement reply ids**

`apps/api/src/modules/messaging/engine/reply-id.ts`:

```ts
// "<nonce>|<action>|<value>". The nonce ties a tap to the prompt that offered
// it; values are UUIDs, small integers or short enum strings, never containing '|'.
const SEP = '|';

export function encodeReplyId(nonce: string, action: string, value = ''): string {
  return [nonce, action, value].join(SEP);
}

export function decodeReplyId(id: string): { nonce: string; action: string; value: string } | null {
  const parts = id.split(SEP);
  if (parts.length !== 3) return null;
  const [nonce, action, value] = parts;
  return { nonce, action, value };
}
```

Run: `npx vitest run test/messaging-reply-id.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @aivastra/api typecheck`
Expected: exit 0.

```bash
git add apps/api/src/modules/messaging/engine apps/api/test/messaging-reply-id.test.ts
git commit -m "feat(api): WhatsApp engine types, copy and reply ids"
```

---

### Task 2: Look eligibility, extra photos and the create body

These rules decide which template looks the bot may offer without asking anything more, and build the same request the studio's template mode builds. Before starting, read `apps/catalogues-web/src/app/(app)/studio/page.tsx` around `lowerOnly`, `effectiveLowerId` and `effectiveShoesId` (template mode), and `apps/api/src/modules/jobs/create.ts` lines ~929–960 (the per-pose slot checks). If either has changed since 2026-10-13, follow the code and adjust these rules and tests.

**Files:**
- Create: `apps/api/src/modules/messaging/engine/rules.ts`
- Test: `apps/api/test/messaging-rules.test.ts`

**Interfaces:**
- Consumes: `Session`, `TemplateLook`, `GarmentTypeOption`, `PhotoSlot`, `TryonBody` (Task 1).
- Produces: `eligibleLooks(gt, looks) → { lowerOnly: boolean; looks: TemplateLook[] }`, `requiredPhotoSlots(gt) → PhotoSlot[]`, `firstMissingSlot(s) → PhotoSlot | null`, `MAX_POSES`, `maxCount(s) → number`, `buildTryonBody(s, lookIds?) → TryonBody`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/messaging-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildTryonBody,
  eligibleLooks,
  firstMissingSlot,
  maxCount,
  requiredPhotoSlots,
} from '../src/modules/messaging/engine/rules';
import type {
  GarmentTypeOption,
  Session,
  TemplateLook,
} from '../src/modules/messaging/engine/types';

const GT: GarmentTypeOption = {
  id: 'gt-1',
  label: 'Shirt',
  requiresLowerUpload: false,
  requiresThirdUpload: false,
  lowerUploadLabel: null,
  thirdUploadLabel: null,
  defaultLowerCatalogId: 'lower-default',
  defaultShoeCatalogId: 'shoe-default',
};

const look = (id: string, roles: Partial<TemplateLook> = {}): TemplateLook => ({
  id,
  poseId: `pose-${id}`,
  backgroundId: `bg-${id}`,
  label: id,
  imageUrl: `https://img/${id}.jpg`,
  hasUpper: true,
  hasLower: false,
  hasShoes: false,
  ...roles,
});
const UPPER = look('up');
const COMBINED = look('comb', { hasLower: true });
const SHOES = look('shoes', { hasShoes: true });
const LOWER_ONLY = look('lo', { hasUpper: false, hasLower: true });

function session(over: Partial<Session> = {}): Session {
  return {
    v: 1,
    state: 'PICK_LOOKS',
    nonce: 'n',
    page: 0,
    aspectRatio: '3:4',
    resolution: 'HD',
    gender: 'women',
    garmentType: GT,
    garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg',
    photos: {},
    faceId: 'face-1',
    template: { id: 't', mappingId: 'map-1', lowerOnly: false, looks: [UPPER, COMBINED, SHOES] },
    picked: ['up'],
    ...over,
  };
}

describe('eligibleLooks', () => {
  it('keeps every look the type has defaults for', () => {
    expect(eligibleLooks(GT, [UPPER, COMBINED, SHOES]).looks.map((l) => l.id)).toEqual([
      'up',
      'comb',
      'shoes',
    ]);
  });
  it('drops a shoe look when the type has no default shoe', () => {
    const r = eligibleLooks({ ...GT, defaultShoeCatalogId: null }, [UPPER, SHOES]);
    expect(r.looks.map((l) => l.id)).toEqual(['up']);
  });
  it('drops a combined look when there is no default lower and no lower photo', () => {
    const r = eligibleLooks({ ...GT, defaultLowerCatalogId: null }, [UPPER, COMBINED]);
    expect(r.looks.map((l) => l.id)).toEqual(['up']);
  });
  it('keeps a combined look without a default when the type takes a lower photo', () => {
    const gt = { ...GT, defaultLowerCatalogId: null, requiresLowerUpload: true };
    expect(eligibleLooks(gt, [COMBINED]).looks).toHaveLength(1);
  });
  it('an all-lower-only template is a lower-only garment', () => {
    const r = eligibleLooks(GT, [LOWER_ONLY, look('lo2', { hasUpper: false, hasLower: true })]);
    expect(r).toMatchObject({ lowerOnly: true });
    expect(r.looks).toHaveLength(2);
  });
  it('drops a lower-only look from a mixed template unless the type takes a lower photo', () => {
    expect(eligibleLooks(GT, [UPPER, LOWER_ONLY]).looks.map((l) => l.id)).toEqual(['up']);
    const gt = { ...GT, requiresLowerUpload: true };
    expect(eligibleLooks(gt, [UPPER, LOWER_ONLY]).looks).toHaveLength(2);
  });
});

describe('extra photos', () => {
  it('asks only for uploads the type requires, lower first', () => {
    expect(requiredPhotoSlots(GT)).toEqual([]);
    expect(
      requiredPhotoSlots({ ...GT, requiresLowerUpload: true, requiresThirdUpload: true }),
    ).toEqual(['lowerFront', 'third']);
  });
  it('firstMissingSlot walks the slots in order', () => {
    const gt = { ...GT, requiresLowerUpload: true, requiresThirdUpload: true };
    expect(firstMissingSlot(session({ garmentType: gt }))).toBe('lowerFront');
    expect(firstMissingSlot(session({ garmentType: gt, photos: { lowerFront: 'L' } }))).toBe('third');
    expect(
      firstMissingSlot(session({ garmentType: gt, photos: { lowerFront: 'L', third: 'T' } })),
    ).toBeNull();
  });
});

describe('maxCount', () => {
  it('is the eligible look count, capped at 9', () => {
    expect(maxCount(session())).toBe(3);
    const many = Array.from({ length: 12 }, (_, i) => look(`l${i}`));
    expect(maxCount(session({ template: { id: 't', mappingId: 'm', lowerOnly: false, looks: many } }))).toBe(9);
  });
});

describe('buildTryonBody', () => {
  it('sends the picked looks with the mapping id, defaults only where a slot needs one, no platform', () => {
    const body = buildTryonBody(session({ picked: ['shoes', 'up'] }));
    expect(body).toEqual({
      aspectRatio: '3:4',
      resolution: 'HD',
      inputs: {
        upperGarmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg',
        faceId: 'face-1',
        garmentTypeId: 'gt-1',
        looks: [
          { poseId: 'pose-shoes', backgroundId: 'bg-shoes' },
          { poseId: 'pose-up', backgroundId: 'bg-up' },
        ],
        catalogueTemplateMappingId: 'map-1',
        shoeCatalogId: 'shoe-default',
      },
    });
    expect(body).not.toHaveProperty('platform');
    expect(body.inputs).not.toHaveProperty('backgroundId');
    expect(body.inputs).not.toHaveProperty('poseIds');
  });
  it('a combined look gets the default lower', () => {
    expect(buildTryonBody(session({ picked: ['comb'] })).inputs.lowerCatalogId).toBe('lower-default');
  });
  it('lower-only: the one photo is sent as both upper and lower, no lower item', () => {
    const body = buildTryonBody(
      session({ template: { id: 't', mappingId: 'm', lowerOnly: true, looks: [LOWER_ONLY] }, picked: ['lo'] }),
    );
    expect(body.inputs.lowerGarmentKey).toBe(body.inputs.upperGarmentKey);
    expect(body.inputs).not.toHaveProperty('lowerCatalogId');
  });
  it('a lower-photo type sends that photo and no lower item', () => {
    const body = buildTryonBody(
      session({
        garmentType: { ...GT, requiresLowerUpload: true },
        photos: { lowerFront: 'inputs/l/garment.jpg' },
        picked: ['comb'],
      }),
    );
    expect(body.inputs.lowerGarmentKey).toBe('inputs/l/garment.jpg');
    expect(body.inputs).not.toHaveProperty('lowerCatalogId');
  });
  it('the third photo goes to thirdGarmentKey', () => {
    const body = buildTryonBody(
      session({ garmentType: { ...GT, requiresThirdUpload: true }, photos: { third: 'T' } }),
    );
    expect(body.inputs.thirdGarmentKey).toBe('T');
  });
  it('explicit look ids (retry) override the picks and unknown ids are ignored', () => {
    const body = buildTryonBody(session({ picked: ['up', 'comb'] }), ['comb', 'gone']);
    expect(body.inputs.looks).toEqual([{ poseId: 'pose-comb', backgroundId: 'bg-comb' }]);
  });
});
```

Run: `npx vitest run test/messaging-rules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement the rules**

`apps/api/src/modules/messaging/engine/rules.ts`:

```ts
import type { GarmentTypeOption, PhotoSlot, Session, TemplateLook, TryonBody } from './types.js';

// 9 counts + the "Wrong garment? Change" row fill WhatsApp's 10-row list, and
// stay under the create schema's 12-look cap.
export const MAX_POSES = 9;

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

export function maxCount(s: Session): number {
  return Math.min(s.template?.looks.length ?? 0, MAX_POSES);
}

/**
 * The /v1/jobs/tryon body for the picked looks (or `lookIds`, for a retry).
 * Template mode only (D42): looks + mapping id, never backgroundId/poseIds.
 */
export function buildTryonBody(s: Session, lookIds: string[] = s.picked): TryonBody {
  const gt = s.garmentType;
  const t = s.template;
  if (!gt || !t || !s.garmentKey || !s.faceId) throw new Error('session incomplete');
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

- [ ] **Step 3: Run the tests**

Run: `npx vitest run test/messaging-rules.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/messaging/engine/rules.ts apps/api/test/messaging-rules.test.ts
git commit -m "feat(api): WhatsApp look eligibility and create-body rules"
```

---

### Task 3: Engine — the state machine, menu, photo, gender and garment type

**Files:**
- Create: `apps/api/src/modules/messaging/engine/engine.ts`
- Create: `apps/api/test/helpers/engine-fakes.ts`
- Test: `apps/api/test/messaging-engine.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `handle(prev: Session | null, event: InboundEvent, ctx: EngineContext, deps: EngineDeps): Promise<EngineResult>`; `freshSession(userId, deps): Promise<Session>`.

This task writes the whole `engine.ts`; Task 4 adds tests for the later steps, which this code already handles. If a Task 4 test fails, fix `engine.ts` there.

- [ ] **Step 1: Write the fakes**

`apps/api/test/helpers/engine-fakes.ts`:

```ts
import { AppError } from '../../src/lib/errors';
import type {
  EngineContext,
  EngineDeps,
  GarmentTypeOption,
  TemplateLook,
  TemplateOption,
  TryonBody,
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

const lookCount = (body: TryonBody) => body.inputs.looks?.length ?? 0;

export function fakeDeps(over: Partial<EngineDeps> = {}) {
  let n = 0;
  const calls = {
    quote: [] as TryonBody[],
    createRun: [] as TryonBody[],
    recognize: [] as { garmentKey: string; gender: string }[],
    corrected: 0,
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
    getTemplate: async () => TEMPLATE,
    getDefaultFaceId: async () => 'face-1',
    quote: async (_u, body) => {
      calls.quote.push(body);
      const images = lookCount(body);
      return { images, perImage: 5, total: images * 5, balance: 50 };
    },
    createRun: async (_ctx, body) => {
      calls.createRun.push(body);
      return { runId: 'run-1', images: lookCount(body) };
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

- [ ] **Step 2: Write the failing tests for this task's steps**

`apps/api/test/messaging-engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { handle } from '../src/modules/messaging/engine/engine';
import { decodeReplyId } from '../src/modules/messaging/engine/reply-id';
import type {
  EngineDeps,
  EngineResult,
  InboundEvent,
  OutboundMessage,
} from '../src/modules/messaging/engine/types';
import { CTX, fakeDeps, GT_SHIRT } from './helpers/engine-fakes';

// Finds the reply id the engine offered for `action` (and `value`, if given) in
// the last messages — what a seller's tap would send back.
function tap(r: EngineResult, action: string, value?: string): InboundEvent {
  for (const m of r.messages) {
    const ids: string[] =
      m.kind === 'buttons'
        ? m.buttons.map((b) => b.id)
        : m.kind === 'list'
          ? m.rows.map((x) => x.id)
          : m.kind === 'cards'
            ? m.cards.map((c) => c.id)
            : [];
    for (const id of ids) {
      const d = decodeReplyId(id);
      if (d && d.action === action && (value === undefined || d.value === value)) {
        return { type: 'reply', id };
      }
    }
  }
  throw new Error(`no ${action}${value ? `:${value}` : ''} offered in ${JSON.stringify(r.messages)}`);
}

const texts = (msgs: OutboundMessage[]) => msgs.map((m) => ('text' in m ? m.text : ''));
const listOf = (r: EngineResult) => {
  const m = r.messages.find((x) => x.kind === 'list');
  return m && m.kind === 'list' ? m : null;
};
const photo = (n: number): InboundEvent => ({
  type: 'image',
  garmentKey: `inputs/00000000-0000-4000-8000-00000000000${n}/garment.jpg`,
});

// Starts a fresh chat ('hi'), or continues from an earlier result so the next
// tap can find the ids that result offered.
async function run(deps: EngineDeps, steps: ((r: EngineResult) => InboundEvent)[], from?: EngineResult) {
  let r = from ?? (await handle(null, { type: 'text', text: 'hi' }, CTX, deps));
  for (const step of steps) r = await handle(r.session, step(r), CTX, deps);
  return r;
}

describe('engine: menu and global commands', () => {
  it('a first message gets the main menu', async () => {
    const { deps } = fakeDeps();
    const r = await handle(null, { type: 'text', text: 'hi' }, CTX, deps);
    expect(r.session.state).toBe('MAIN_MENU');
    expect(r.messages.at(-1)).toMatchObject({ kind: 'buttons' });
  });

  it('a tap with no session says the session expired, then shows the menu', async () => {
    const { deps } = fakeDeps();
    const r = await handle(null, { type: 'reply', id: 'old|look|x' }, CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/session expired/);
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('menu and restart always return to the main menu', async () => {
    const { deps } = fakeDeps();
    const deep = await run(deps, [(r) => tap(r, 'menu', 'new')]);
    expect(deep.session.state).toBe('ASK_GARMENT_PHOTO');
    for (const word of ['menu', ' Restart ']) {
      const r = await handle(deep.session, { type: 'text', text: word }, CTX, deps);
      expect(r.session.state).toBe('MAIN_MENU');
    }
  });

  it('help answers with the contact link and keeps the current step', async () => {
    const { deps } = fakeDeps();
    const at = await run(deps, [(r) => tap(r, 'menu', 'new')]);
    const r = await handle(at.session, { type: 'text', text: 'help' }, CTX, deps);
    expect(texts(r.messages)[0]).toContain('https://app.test/contact-us');
    expect(r.session.state).toBe('ASK_GARMENT_PHOTO');
  });

  it('credits shows the balance and the pricing link', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [(x) => tap(x, 'menu', 'credits')]);
    expect(texts(r.messages)[0]).toBe(
      'You have 50 credits. Buy more on the website: https://app.test/pricing',
    );
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('a tap from an earlier step is ignored', async () => {
    const { deps } = fakeDeps();
    const menu = await handle(null, { type: 'text', text: 'hi' }, CTX, deps);
    const staleTap = tap(menu, 'menu', 'new');
    const next = await handle(menu.session, staleTap, CTX, deps);
    const again = await handle(next.session, staleTap, CTX, deps);
    expect(texts(again.messages)).toEqual(['That option is from an earlier step.']);
    expect(again.session).toEqual(next.session);
  });
});

describe('engine: photo, gender and garment type', () => {
  it('New catalog asks for the photo; the photo leads to the four-gender list', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [(x) => tap(x, 'menu', 'new'), () => photo(1)]);
    expect(r.session).toMatchObject({
      state: 'ASK_GENDER',
      garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg',
    });
    const list = listOf(r);
    expect(list?.text).toBe('Create catalogue for:');
    expect(list?.rows.map((x) => x.title)).toEqual(['Women', 'Men', 'Boys', 'Girls']);
  });

  it('a photo sent from the main menu starts at the gender step', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [() => photo(2)]);
    expect(r.session.state).toBe('ASK_GENDER');
    expect(r.session.garmentKey).toContain('000000000002');
  });

  it('recognised: the type is announced and the count step follows', async () => {
    const { deps } = fakeDeps({
      recognizeGarment: async () => ({ garmentTypeId: 'gt-shirt', label: 'Shirt' }),
    });
    const r = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(texts(r.messages)[0]).toBe('Detected: Shirt.');
    expect(r.session).toMatchObject({
      state: 'ASK_POSE_COUNT',
      gender: 'women',
      garmentType: { id: 'gt-shirt' },
      recognized: true,
      faceId: 'face-1',
    });
  });

  it('recognition is asked with the photo and the tapped gender', async () => {
    const { deps, calls } = fakeDeps();
    await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'boys')]);
    expect(calls.recognize).toEqual([
      { garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg', gender: 'boys' },
    ]);
  });

  it('not recognised: the garment-type list, then a pick goes to the count step', async () => {
    const { deps } = fakeDeps();
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(list.session.state).toBe('ASK_GARMENT_TYPE');
    expect(listOf(list)?.text).toBe('Which garment is it?');
    const r = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', recognized: false });
    expect(texts(r.messages)).not.toContain('Detected: Shirt.');
  });

  it('a recognised type the bot cannot offer gets the web-studio message (D47)', async () => {
    const { deps } = fakeDeps({
      recognizeGarment: async () => ({ garmentTypeId: 'gt-saree', label: 'Saree' }),
    });
    const r = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(texts(r.messages)[0]).toBe(
      "Saree catalogs aren't available on WhatsApp yet. You can create one in the web studio: https://app.test/studio",
    );
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('no template or no face for the type also gets the web-studio message', async () => {
    for (const over of [{ getTemplate: async () => null }, { getDefaultFaceId: async () => null }]) {
      const { deps } = fakeDeps(over);
      const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
      const r = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
      expect(texts(r.messages)[0]).toMatch(/^Shirt catalogs aren't available on WhatsApp yet/);
      expect(r.session.state).toBe('MAIN_MENU');
    }
  });

  it('text where a tap is expected gets a re-prompt and keeps the step', async () => {
    const { deps } = fakeDeps();
    const at = await run(deps, [() => photo(1)]);
    const r = await handle(at.session, { type: 'text', text: 'its a shirt' }, CTX, deps);
    expect(texts(r.messages)[0]).toBe('Please use the options above, or type MENU.');
    expect(r.session.state).toBe('ASK_GENDER');
  });

  it('a video at the photo step explains what is accepted', async () => {
    const { deps } = fakeDeps();
    const at = await run(deps, [(x) => tap(x, 'menu', 'new')]);
    const r = await handle(at.session, { type: 'unsupportedMedia' }, CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/JPG or PNG/);
    expect(r.session.state).toBe('ASK_GARMENT_PHOTO');
  });

  it('garment types are paged at 9 rows plus More', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...GT_SHIRT, id: `gt-${i}`, label: `Type ${i}` }));
    const { deps } = fakeDeps({ listGarmentTypes: async () => many });
    const first = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(listOf(first)?.rows).toHaveLength(10);
    const second = await handle(first.session, tap(first, 'more'), CTX, deps);
    expect(listOf(second)?.rows.map((r) => r.title)).toEqual(['Type 9', 'Type 10', 'Type 11']);
  });
});
```

Run: `npx vitest run test/messaging-engine.test.ts`
Expected: FAIL — `engine` module not found.

- [ ] **Step 3: Implement the engine**

`apps/api/src/modules/messaging/engine/engine.ts`:

```ts
import { AppError } from '../../../lib/errors.js';
import { COPY } from './copy.js';
import { decodeReplyId, encodeReplyId } from './reply-id.js';
import { buildTryonBody, eligibleLooks, firstMissingSlot, maxCount } from './rules.js';
import type {
  EngineContext,
  EngineDeps,
  EngineResult,
  GarmentTypeOption,
  Gender,
  InboundEvent,
  OutboundMessage,
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

/** Back to the count step; garment, type, extra photos, face and template kept. */
function picksCleared(s: Session): Session {
  return {
    ...s,
    count: undefined,
    picked: [],
    runId: undefined,
    runImages: undefined,
    failedPoseIds: undefined,
  };
}

const text = (t: string): OutboundMessage => ({ kind: 'text', text: t });

function buttons(s: Session, body: string, items: [action: string, value: string, title: string][]): OutboundMessage {
  return {
    kind: 'buttons',
    text: body,
    buttons: items.slice(0, 3).map(([a, v, title]) => ({ id: encodeReplyId(s.nonce, a, v), title })),
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
): Out {
  const start = s.page * CARDS_PER_PAGE;
  const page = items.slice(start, start + CARDS_PER_PAGE);
  const out: Out = [
    {
      kind: 'cards',
      text: body,
      cards: page.map((i) => ({ id: encodeReplyId(s.nonce, action, i.id), imageUrl: i.imageUrl, title: i.label })),
    },
  ];
  const more: [string, string, string][] =
    start + CARDS_PER_PAGE < items.length ? [['more', '', COPY.btnMore]] : [];
  const actions = [...more, ...extra];
  if (actions.length > 0) out.push(buttons(s, COPY.moreOptions, actions));
  return out;
}

/**
 * Re-reads the type's template and keeps only the looks the bot can generate
 * (D49). Re-read on every count / pick prompt, so a look an admin removed, or
 * a presigned image URL that expired, never reaches the seller. Null when
 * nothing is left — the type is then not available in the chat (D47).
 */
async function loadTemplate(s: Session, deps: EngineDeps): Promise<Session | null> {
  if (!s.gender || !s.garmentType) return null;
  const t = await deps.getTemplate(s.gender, s.garmentType.id);
  if (!t) return null;
  const { lowerOnly, looks } = eligibleLooks(s.garmentType, t.looks);
  if (looks.length === 0) return null;
  const ids = new Set(looks.map((l) => l.id));
  return {
    ...s,
    template: { id: t.id, mappingId: t.mappingId, lowerOnly, looks },
    picked: s.picked.filter((id) => ids.has(id)),
  };
}

/** Moves to `state` with a fresh nonce and renders its prompt. */
async function enter(s: Session, state: State, out: Out, ctx: EngineContext, deps: EngineDeps): Promise<EngineResult> {
  return render({ ...s, state, nonce: deps.newNonce(), page: 0 }, out, ctx, deps);
}

function notAvailable(s: Session, label: string, out: Out, ctx: EngineContext, deps: EngineDeps) {
  out.push(text(COPY.notAvailable(label, deps.links.studio)));
  return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
}

/**
 * The garment type is known, from recognition or the list. Fills the defaults
 * the chat no longer asks for (D43): face and template. Then the required
 * extra photos, then the count.
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
  const withType: Session = { ...garmentCleared(s), garmentType: gt, recognized, faceId: faceId ?? undefined };
  const loaded = faceId ? await loadTemplate(withType, deps) : null;
  if (!loaded) return notAvailable(s, gt.label, out, ctx, deps);
  if (recognized) out.push(text(COPY.detected(gt.label)));
  return enter(loaded, firstMissingSlot(loaded) ? 'ASK_EXTRA_PHOTO' : 'ASK_POSE_COUNT', out, ctx, deps);
}

/** Creates the run for `lookIds` (all picks, or the failed ones on retry). */
async function generate(
  s: Session,
  lookIds: string[],
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  try {
    const { runId, images } = await deps.createRun(ctx, buildTryonBody(s, lookIds));
    // Shown, not charged, from the count step's quote: the charge itself is
    // createJob's own resolution of the same plan (D17).
    out.push(text(COPY.generating(images, images * (s.perImage ?? 0))));
    return {
      session: { ...s, state: 'GENERATING', nonce: deps.newNonce(), page: 0, runId, runImages: images, failedPoseIds: undefined },
      messages: out,
    };
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    if (err.code === 'INSUFFICIENT_CREDITS') return enter(s, 'NO_CREDITS', out, ctx, deps);
    // A look deactivated or a mapping changed after the list was shown (spec section 13).
    if (err.code === 'BAD_CATALOG') {
      out.push(text(COPY.posesChanged));
      return enter(picksCleared(s), 'ASK_POSE_COUNT', out, ctx, deps);
    }
    out.push(text(err.message));
    return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
  }
}

/** Appends the current step's prompt. May redirect when a step has nothing to ask. */
async function render(s: Session, out: Out, ctx: EngineContext, deps: EngineDeps): Promise<EngineResult> {
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
      out.push(listMsg(s, COPY.askGender, GENDERS.map((g) => ({ action: 'gender', value: g, title: COPY.genders[g] }))));
      return done();

    case 'ASK_GARMENT_TYPE': {
      const types = await deps.listGarmentTypes(s.gender as Gender);
      if (types.length === 0) {
        out.push(text(COPY.nothingAvailable));
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      }
      out.push(listMsg(s, COPY.askGarmentType, types.map((t) => ({ action: 'gt', value: t.id, title: t.label }))));
      return done();
    }

    case 'ASK_EXTRA_PHOTO': {
      const slot = firstMissingSlot(s);
      if (!slot) return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
      const gt = s.garmentType;
      const label = slot === 'lowerFront' ? (gt?.lowerUploadLabel ?? null) : (gt?.thirdUploadLabel ?? null);
      out.push(text(COPY.askPhoto[slot](label)));
      return done();
    }

    case 'ASK_POSE_COUNT': {
      const loaded = await loadTemplate(s, deps);
      if (!loaded?.template) return notAvailable(s, s.garmentType?.label ?? 'These', out, ctx, deps);
      let perImage: number;
      let balance: number;
      try {
        // One look prices one image: the cost per image comes from the same plan
        // resolution the web uses (D17); the count rows multiply it.
        const q = await deps.quote(ctx.userId, buildTryonBody(loaded, [loaded.template.looks[0].id]));
        perImage = q.perImage;
        balance = q.balance;
      } catch (err) {
        // Anything createJob would reject surfaces here, before any credits are taken.
        if (!(err instanceof AppError)) throw err;
        out.push(text(err.message));
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      }
      const rows: Row[] = Array.from({ length: maxCount(loaded) }, (_, i) => ({
        action: 'count',
        value: String(i + 1),
        title: COPY.countRow(i + 1, (i + 1) * perImage),
      }));
      rows.push({ action: 'change', value: '', title: COPY.rowChangeGarment });
      const next: Session = { ...loaded, perImage, balance };
      out.push(listMsg(next, COPY.askCount(balance), rows));
      return done(next);
    }

    case 'PICK_LOOKS': {
      const loaded = await loadTemplate(s, deps);
      if (!loaded?.template) return notAvailable(s, s.garmentType?.label ?? 'These', out, ctx, deps);
      out.push(
        ...cardsMsgs(loaded, COPY.pickLooks(loaded.count ?? 1), 'look', loaded.template.looks, [
          ['restart', '', COPY.btnStartOver],
        ]),
      );
      return done(loaded);
    }

    case 'NO_CREDITS':
      out.push(buttons(s, COPY.noCredits(deps.links.pricing), [['menu', 'menu', COPY.btnMenu]]));
      return done();

    case 'GENERATING': {
      const p = s.runId ? await deps.runProgress(s.runId) : { finished: 0, total: s.runImages ?? 0 };
      out.push(text(COPY.stillGenerating(p.finished, p.total)));
      return done();
    }

    case 'DELIVERED': {
      const failed = s.failedPoseIds?.length ?? 0;
      const items: [string, string, string][] = [];
      if (failed > 0) items.push(['retry', '', COPY.btnRetryFailed]);
      items.push(['more_poses', '', COPY.btnMorePoses]);
      items.push(failed > 0 ? ['menu', 'menu', COPY.btnMenu] : ['menu', 'new', COPY.btnNewCatalog]);
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

    case 'ASK_POSE_COUNT': {
      if (action === 'change') {
        if (s.recognized) deps.recordRecognitionCorrected();
        return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
      }
      const n = Number(value);
      if (action !== 'count' || !Number.isInteger(n) || n < 1 || n > maxCount(s)) return reprompt();
      const next: Session = { ...s, count: n, picked: [] };
      // Caught here, before the seller taps n poses (D45); createJob checks again.
      const balance = await deps.getBalance(ctx.userId);
      if (n * (s.perImage ?? 0) > balance) return enter(next, 'NO_CREDITS', out, ctx, deps);
      return enter(next, 'PICK_LOOKS', out, ctx, deps);
    }

    case 'PICK_LOOKS': {
      if (action !== 'look' || !s.template?.looks.some((l) => l.id === value)) return reprompt();
      if (s.picked.includes(value)) {
        out.push(text(COPY.lookAlreadyAdded));
        return { session: s, messages: out };
      }
      const next: Session = { ...s, picked: [...s.picked, value] };
      const count = s.count ?? 1;
      // Choosing the count was the agreement to spend (D45): the last pick starts the run.
      if (next.picked.length >= count) return generate(next, next.picked, out, ctx, deps);
      // Not a re-render: re-sending the carousel after every tap would bury the chat.
      out.push(buttons(next, COPY.lookAdded(next.picked.length, count), [['restart', '', COPY.btnStartOver]]));
      return { session: next, messages: out };
    }

    case 'DELIVERED': {
      if (action === 'more_poses') return enter(picksCleared(s), 'ASK_POSE_COUNT', out, ctx, deps);
      if (action === 'retry') {
        const failed = new Set(s.failedPoseIds ?? []);
        const looks = s.template?.looks ?? [];
        const ids = s.picked.filter((id) => failed.has(looks.find((l) => l.id === id)?.poseId ?? ''));
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
const NEW_PHOTO_STATES: State[] = ['MAIN_MENU', 'ASK_GARMENT_PHOTO', 'NO_CREDITS', 'GENERATING', 'DELIVERED'];

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
  if (!prev) {
    const s = await freshSession(ctx.userId, deps);
    if (event.type === 'reply') out.push(text(COPY.sessionExpired));
    // A first photo starts a catalog straight away (spec section 8).
    if (event.type === 'image') return enter({ ...s, garmentKey: event.garmentKey }, 'ASK_GENDER', out, ctx, deps);
    return render(s, out, ctx, deps);
  }
  const s = prev;

  switch (event.type) {
    case 'text': {
      const cmd = event.text.trim().toLowerCase();
      if (cmd === 'menu' || cmd === 'restart') return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
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
          return enter(next, firstMissingSlot(next) ? 'ASK_EXTRA_PHOTO' : 'ASK_POSE_COUNT', out, ctx, deps);
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
      if (s.runId !== event.runId) return { session: s, messages: out };
      if (event.failedPoseIds.length > 0) out.push(text(COPY.partlyFailed(event.failedPoseIds.length, event.images)));
      return enter({ ...s, failedPoseIds: event.failedPoseIds }, 'DELIVERED', out, ctx, deps);
    }

    case 'creditsAdded':
      out.push(text(COPY.creditsAdded(event.credits)));
      if (s.state === 'NO_CREDITS') return enter(picksCleared(s), 'ASK_POSE_COUNT', out, ctx, deps);
      return { session: s, messages: out };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/messaging-engine.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Lint, typecheck and commit**

Run: `pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint`
Expected: exit 0. Biome may reformat long lines; run `pnpm --filter @aivastra/api exec biome check --write src/modules/messaging test/messaging-*.test.ts test/helpers/engine-fakes.ts` and re-run the tests.

```bash
git add apps/api/src/modules/messaging/engine/engine.ts apps/api/test/helpers/engine-fakes.ts apps/api/test/messaging-engine.test.ts
git commit -m "feat(api): WhatsApp five-step conversation engine"
```

---

### Task 4: Engine tests — count, picks, extra photos, generation and delivery

**Files:**
- Modify: `apps/api/test/messaging-engine.test.ts` (append)
- Modify (only if a test fails): `apps/api/src/modules/messaging/engine/engine.ts`

- [ ] **Step 1: Append the tests**

Add `insufficient`, `look` and `TEMPLATE` to the `./helpers/engine-fakes` import at the top of the file, then append:

```ts
// A seller at the count step for GT_SHIRT, through the garment-type list.
async function atCount(deps: EngineDeps) {
  const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
  return run(deps, [(x) => tap(x, 'gt', 'gt-shirt')], list);
}

async function picked(deps: EngineDeps, count: number, lookIds: string[]) {
  const at = await atCount(deps);
  const pick = await run(deps, [(x) => tap(x, 'count', String(count))], at);
  let r = pick;
  for (const id of lookIds) r = await handle(r.session, tap(pick, 'look', id), CTX, deps);
  return { pick, r };
}

describe('engine: pose count', () => {
  it('lists 1..eligible looks with the cost, the balance and a Change row', async () => {
    const { deps, calls } = fakeDeps();
    const r = await atCount(deps);
    const list = listOf(r);
    expect(list?.text).toBe('How many poses do you want? Your balance: 50 credits.');
    // Look 'd' needs shoes and GT_SHIRT has no default shoe (D49): 3 looks, not 4.
    expect(list?.rows.map((x) => x.title)).toEqual([
      '1 pose · 5 credits',
      '2 poses · 10 credits',
      '3 poses · 15 credits',
      'Wrong garment? Change',
    ]);
    // Priced with one look, through the real create-body builder.
    expect(calls.quote.at(-1)?.inputs.looks).toEqual([{ poseId: 'pose-a', backgroundId: 'bg-a' }]);
  });

  it('never offers more than 9', async () => {
    const big = { ...TEMPLATE, looks: Array.from({ length: 12 }, (_, i) => look(`l${i}`)) };
    const { deps } = fakeDeps({ getTemplate: async () => big });
    expect(listOf(await atCount(deps))?.rows).toHaveLength(10);
  });

  it('Change after a recognised type counts a correction; after a list pick it does not', async () => {
    const recognised = fakeDeps({
      recognizeGarment: async () => ({ garmentTypeId: 'gt-shirt', label: 'Shirt' }),
    });
    const r1 = await run(recognised.deps, [() => photo(1), (x) => tap(x, 'gender', 'women'), (x) => tap(x, 'change')]);
    expect(r1.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women' });
    expect(r1.session.garmentKey).toContain('000000000001');
    expect(recognised.calls.corrected).toBe(1);

    const listed = fakeDeps();
    const at = await atCount(listed.deps);
    await handle(at.session, tap(at, 'change'), CTX, listed.deps);
    expect(listed.calls.corrected).toBe(0);
  });

  it('a count the balance cannot cover goes to NO_CREDITS; credits added returns to the count', async () => {
    const { deps } = fakeDeps({ getBalance: async () => 8 });
    const at = await atCount(deps);
    const r = await handle(at.session, tap(at, 'count', '2'), CTX, deps);
    expect(r.session.state).toBe('NO_CREDITS');
    expect(texts(r.messages)[0]).toContain('https://app.test/pricing');
    const back = await handle(r.session, { type: 'creditsAdded', credits: 100 }, CTX, deps);
    expect(texts(back.messages)[0]).toBe('100 credits added.');
    expect(back.session.state).toBe('ASK_POSE_COUNT');
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
});

describe('engine: picking looks', () => {
  it('shows the eligible looks; each tap adds one; a repeat is not counted', async () => {
    const { deps } = fakeDeps();
    const { pick } = await picked(deps, 2, []);
    expect(pick.session.state).toBe('PICK_LOOKS');
    const cards = pick.messages.find((m) => m.kind === 'cards');
    expect(cards && cards.kind === 'cards' ? cards.cards.map((c) => c.title) : []).toEqual([
      'Pose a',
      'Pose b',
      'Pose c',
    ]);
    const one = await handle(pick.session, tap(pick, 'look', 'a'), CTX, deps);
    expect(texts(one.messages)[0]).toBe('Added, 1 of 2.');
    const dup = await handle(one.session, tap(pick, 'look', 'a'), CTX, deps);
    expect(texts(dup.messages)).toEqual(['That pose is already added.']);
    expect(dup.session.picked).toEqual(['a']);
  });

  it('the last pick starts generation with exactly the picked looks', async () => {
    const { deps, calls } = fakeDeps();
    const { r } = await picked(deps, 2, ['c', 'a']);
    expect(r.session).toMatchObject({ state: 'GENERATING', runId: 'run-1', runImages: 2 });
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
    expect(texts(r.messages)[0]).toBe("Working on 2 images, 10 credits. I'll send each one here as it's ready.");
  });

  it('a look with a lower slot gets the type default lower', async () => {
    const { deps, calls } = fakeDeps();
    await picked(deps, 1, ['b']);
    expect(calls.createRun[0].inputs.lowerCatalogId).toBe('lower-default');
  });

  it('a type with a default shoe offers the shoe look and sends the shoe', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, defaultShoeCatalogId: 'shoe-default' }],
    });
    await picked(deps, 1, ['d']);
    expect(calls.createRun[0].inputs.shoeCatalogId).toBe('shoe-default');
  });

  it('a lower-only template sends the photo as the lower garment', async () => {
    const lowerOnly = { ...TEMPLATE, looks: [look('j', { hasUpper: false, hasLower: true })] };
    const { deps, calls } = fakeDeps({ getTemplate: async () => lowerOnly });
    await picked(deps, 1, ['j']);
    expect(calls.createRun[0].inputs.lowerGarmentKey).toBe(calls.createRun[0].inputs.upperGarmentKey);
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
  });

  it('short of credits at create time goes to NO_CREDITS', async () => {
    const { deps } = fakeDeps({
      createRun: async () => {
        throw insufficient();
      },
    });
    const { r } = await picked(deps, 1, ['a']);
    expect(r.session.state).toBe('NO_CREDITS');
  });

  it('a look that changed meanwhile returns to the count step', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps } = fakeDeps({
      createRun: async () => {
        throw new AppError('BAD_CATALOG', 400, 'one or more looks are not configured for this template mapping');
      },
    });
    const { r } = await picked(deps, 1, ['a']);
    expect(texts(r.messages)[0]).toBe('Those poses changed. Please choose again.');
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', picked: [] });
  });
});

describe('engine: required extra photos', () => {
  it('asks for the third photo before the count and sends it', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, requiresThirdUpload: true, thirdUploadLabel: 'dupatta' }],
    });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    const ask = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(ask.session.state).toBe('ASK_EXTRA_PHOTO');
    expect(texts(ask.messages)[0]).toBe('Now send a photo of the dupatta.');
    const count = await handle(ask.session, photo(3), CTX, deps);
    expect(count.session.state).toBe('ASK_POSE_COUNT');
    const pick = await handle(count.session, tap(count, 'count', '1'), CTX, deps);
    await handle(pick.session, tap(pick, 'look', 'a'), CTX, deps);
    expect(calls.createRun[0].inputs.thirdGarmentKey).toContain('000000000003');
  });

  it('a lower-photo type sends that photo instead of a lower item', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, requiresLowerUpload: true, lowerUploadLabel: 'pyjama' }],
    });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'men')]);
    const ask = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(texts(ask.messages)[0]).toBe('Now send a photo of the pyjama.');
    const count = await handle(ask.session, photo(4), CTX, deps);
    const pick = await handle(count.session, tap(count, 'count', '1'), CTX, deps);
    await handle(pick.session, tap(pick, 'look', 'b'), CTX, deps);
    expect(calls.createRun[0].inputs.lowerGarmentKey).toContain('000000000004');
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
  });
});

describe('engine: generating and delivery', () => {
  const generated = async (deps: EngineDeps) => (await picked(deps, 2, ['a', 'c'])).r;

  it('messages while generating report progress', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(gen.session, { type: 'text', text: 'done yet?' }, CTX, deps);
    expect(texts(r.messages)).toEqual(['Still generating: 1 of 2 done.']);
  });

  it('runFinished with no failures offers more poses and a new catalog', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(gen.session, { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] }, CTX, deps);
    expect(r.session.state).toBe('DELIVERED');
    const btns = r.messages.at(-1);
    expect(btns && btns.kind === 'buttons' ? btns.buttons.map((b) => b.title) : []).toEqual([
      'More poses',
      'New catalog',
    ]);
  });

  it('a runFinished for an older run changes nothing', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(gen.session, { type: 'runFinished', runId: 'other', images: 2, failedPoseIds: [] }, CTX, deps);
    expect(r).toEqual({ session: gen.session, messages: [] });
  });

  it('partial failure reports the refund; Retry regenerates only the failed looks', async () => {
    const { deps, calls } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(gen.session, { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: ['pose-c'] }, CTX, deps);
    expect(texts(r.messages)[0]).toBe('1 of 2 images failed. The credits for it were refunded.');
    const retry = await handle(r.session, tap(r, 'retry'), CTX, deps);
    expect(retry.session.state).toBe('GENERATING');
    expect(calls.createRun.at(-1)?.inputs.looks).toEqual([{ poseId: 'pose-c', backgroundId: 'bg-c' }]);
  });

  it('More poses returns to the count with the garment, type and face kept', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const done = await handle(gen.session, { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] }, CTX, deps);
    const r = await handle(done.session, tap(done, 'more_poses'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', garmentType: { id: 'gt-shirt' }, faceId: 'face-1', picked: [] });
    expect(r.session.garmentKey).toContain('000000000001');
  });

  it('a new photo after delivery starts a new catalog', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const done = await handle(gen.session, { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] }, CTX, deps);
    const r = await handle(done.session, photo(5), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_GENDER', picked: [] });
    expect(r.session.garmentType).toBeUndefined();
    expect(r.session.garmentKey).toContain('000000000005');
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run test/messaging-engine.test.ts`
Expected: PASS, 36 tests. Fix `engine.ts` (not the tests) if a transition disagrees with spec section 8.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/messaging-engine.test.ts apps/api/src/modules/messaging/engine/engine.ts
git commit -m "test(api): WhatsApp engine count, picks, extra photos and delivery"
```

---

### Task 5: Garment recognition — the api side

The api half of spec 8a: a contract both processes share, two metrics, a kill switch, and `recognizeGarment`. The dispatcher half (plan 5) reads the stream and writes the result key; until it exists, the flag stays off. The tests below play the dispatcher's part by hand.

**Files:**
- Create: `packages/types/src/garment-recognition.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/observability/src/metrics.ts`
- Modify: `apps/api/src/env.ts`, `.env.example`, `.env.production.example`
- Create: `apps/api/src/modules/messaging/classify.ts`
- Test: `apps/api/test/messaging-classify.test.ts`, `apps/api/test/integration/messaging-classify.test.ts`

**Interfaces:**
- Produces (plan 5 consumes the first three):
  - `GARMENT_RECOGNITION_STREAM = 'classify:requests'`, `garmentRecognitionResultKey(requestId)`, `GARMENT_RECOGNITION_RESULT_TTL_SEC`
  - `GarmentRecognitionRequest` `{ requestId, garmentKey, options: {slug,label}[], expiresAt }`, `GarmentRecognitionResult` `{ answer: string | null, error: 'no_worker' | 'failed' | 'expired' | null, ms }`
  - `garmentClassifyOutcomeTotal{outcome}`, `garmentClassifyCorrectedTotal`
  - `recognizeGarment(app, garmentKey, gender, opts?) → { garmentTypeId, label } | null`, `matchAnswer(answer, candidates)`, `recordRecognitionCorrected()`, `RECOGNITION_BUDGET_MS`

- [ ] **Step 1: Write the contract**

`packages/types/src/garment-recognition.ts`:

```ts
import { z } from 'zod';

// The api ↔ dispatcher contract for garment recognition (WhatsApp bot spec,
// section 8a). The api never talks to a GPU worker: it appends a request to
// this stream and polls the result key; the dispatcher runs the classify-only
// ComfyUI workflow and writes the answer.
export const GARMENT_RECOGNITION_STREAM = 'classify:requests';
export const garmentRecognitionResultKey = (requestId: string) => `classify:result:${requestId}`;
// Long enough to inspect after the fact; the bot itself stops waiting after 8 s.
export const GARMENT_RECOGNITION_RESULT_TTL_SEC = 3600;

export const GarmentRecognitionRequest = z.object({
  requestId: z.string().uuid(),
  garmentKey: z.string().min(1),
  // That gender's garment types with a public_api_slug; the model must answer
  // with exactly one slug (or NONE).
  options: z.array(z.object({ slug: z.string().min(1), label: z.string().min(1) })).min(1),
  // Epoch ms. A request picked up after this is skipped with error 'expired':
  // the seller has had the garment-type list since then, so GPU time is wasted.
  expiresAt: z.number().int(),
});
export type GarmentRecognitionRequest = z.infer<typeof GarmentRecognitionRequest>;

export const GarmentRecognitionResult = z.object({
  // The model's raw text. The api decides whether it matches an option, so the
  // matching rule lives in one place (apps/api/src/modules/messaging/classify.ts).
  answer: z.string().nullable(),
  error: z.enum(['no_worker', 'failed', 'expired']).nullable(),
  // Pick-up to answer, as measured by the dispatcher.
  ms: z.number().int().nonnegative(),
});
export type GarmentRecognitionResult = z.infer<typeof GarmentRecognitionResult>;
```

Add `export * from './garment-recognition.js';` to `packages/types/src/index.ts`, in alphabetical order (after `./demo-catalog.js` … `./dev.js`, before `./google-drive.js`).

- [ ] **Step 2: Add the metrics**

In `packages/observability/src/metrics.ts`, in the `API metrics` section after `shopifyPaymentCheckLastSuccess`:

```ts
// WhatsApp bot garment recognition (spec section 8a). The outcome mix and the
// correction count are the evidence for keeping recognition on our GPU or moving
// it to a hosted API; the dispatcher adds its own duration histogram (plan 5).
export const garmentClassifyOutcomeTotal = new Counter({
  name: 'garment_classify_outcome_total',
  help: 'Garment recognitions requested by the WhatsApp bot, by outcome (matched/unmatched/timeout/no_worker/failed)',
  labelNames: ['outcome'] as const,
  registers: [register],
});

export const garmentClassifyCorrectedTotal = new Counter({
  name: 'garment_classify_corrected_total',
  help: 'Sellers who tapped "Change" after the WhatsApp bot recognised their garment type',
  registers: [register],
});
```

Run: `pnpm --filter @aivastra/types build && pnpm --filter @aivastra/observability build`
Expected: exit 0.

- [ ] **Step 3: Add the kill switch**

In `apps/api/src/env.ts`, after plan 1's `WHATSAPP_DISPLAY_NUMBER`:

```ts
  // WhatsApp bot garment recognition on our own GPU (spec 8a). Off: the bot
  // always shows the garment-type list — the state until the dispatcher's
  // classify lane ships, and the way back if recognition isn't good enough.
  // Same literal-'true' pattern as the flags above.
  GARMENT_RECOGNITION_ENABLED: z.preprocess((v) => v === 'true', z.boolean()).default(false),
```

Add `GARMENT_RECOGNITION_ENABLED=` (empty) under the plan 1 messaging block in `.env.example` and `.env.production.example`, with the comment "literal 'true' to enable; needs the dispatcher classify lane (plan 5)".

- [ ] **Step 4: Write the failing unit tests**

`apps/api/test/messaging-classify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchAnswer } from '../src/modules/messaging/classify';

const C = [
  { id: 'gt-1', slug: 'full-shirt', label: 'Full shirt' },
  { id: 'gt-2', slug: 'kurti', label: 'Kurti' },
];

describe('matchAnswer', () => {
  it('matches a slug exactly', () => {
    expect(matchAnswer('kurti', C)?.id).toBe('gt-2');
  });
  it('ignores case, surrounding space, quotes and trailing punctuation', () => {
    expect(matchAnswer('  Full-Shirt.\n', C)?.id).toBe('gt-1');
    expect(matchAnswer('"kurti"', C)?.id).toBe('gt-2');
  });
  it('does not accept a label, NONE, a sentence or nothing', () => {
    expect(matchAnswer('Full shirt', C)).toBeNull();
    expect(matchAnswer('NONE', C)).toBeNull();
    expect(matchAnswer('This is a kurti', C)).toBeNull();
    expect(matchAnswer(null, C)).toBeNull();
    expect(matchAnswer('', C)).toBeNull();
  });
});
```

Run: `npx vitest run test/messaging-classify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `classify.ts`**

`apps/api/src/modules/messaging/classify.ts`:

```ts
import { randomUUID } from 'node:crypto';
import {
  garmentClassifyCorrectedTotal,
  garmentClassifyOutcomeTotal,
} from '@aivastra/observability';
import {
  GARMENT_RECOGNITION_STREAM,
  type GarmentRecognitionRequest,
  GarmentRecognitionResult,
  garmentRecognitionResultKey,
} from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { getCatalogOptions } from '../../lib/catalog-options-cache.js';

// Spec 8a: the seller waits at most this long after the gender tap.
export const RECOGNITION_BUDGET_MS = 8_000;
const POLL_MS = 200;
// Only bounds the stream if no dispatcher is consuming it; a request is
// worthless once its budget has passed anyway.
const STREAM_MAXLEN = 1000;

export interface RecognitionCandidate {
  id: string;
  slug: string;
  label: string;
}

type Outcome = 'matched' | 'unmatched' | 'timeout' | 'no_worker' | 'failed';
const count = (outcome: Outcome) => garmentClassifyOutcomeTotal.inc({ outcome });

/**
 * The model's answer → one option, or null. An exact slug match once case,
 * surrounding whitespace, quotes and trailing punctuation are removed. Nothing
 * looser: a fuzzy match that picks the wrong type costs the seller a wrong
 * generation, while no match only costs them one tap on the list.
 */
export function matchAnswer(
  answer: string | null,
  candidates: RecognitionCandidate[],
): RecognitionCandidate | null {
  if (!answer) return null;
  const a = answer
    .trim()
    .toLowerCase()
    .replace(/^["'`]+/, '')
    .replace(/["'`.!]+$/, '');
  return candidates.find((c) => c.slug === a) ?? null;
}

async function waitForResult(
  app: FastifyInstance,
  requestId: string,
  budgetMs: number,
): Promise<GarmentRecognitionResult | null> {
  const key = garmentRecognitionResultKey(requestId);
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const raw = await app.redis.get(key);
    if (raw) {
      const parsed = GarmentRecognitionResult.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : { answer: null, error: 'failed', ms: 0 };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

/**
 * Spec 8a. Asks the dispatcher to recognise the garment among this gender's
 * types that have a public slug, and waits up to the budget. Returns null for
 * every kind of failure — the bot then shows the garment-type list, so
 * recognition can cost the seller a tap but never a run.
 *
 * The options are the dev API's cached list (catalog-options-cache.ts), whose
 * `slug` is garment_subcategories.public_api_slug: unique table-wide, so the
 * answer names exactly one row with no further matching.
 */
export async function recognizeGarment(
  app: FastifyInstance,
  garmentKey: string,
  gender: string,
  opts: { budgetMs?: number } = {},
): Promise<{ garmentTypeId: string; label: string } | null> {
  if (app.env.GARMENT_RECOGNITION_ENABLED !== true) return null;
  const budgetMs = opts.budgetMs ?? RECOGNITION_BUDGET_MS;
  try {
    const { options } = await getCatalogOptions(app, { gender, publicOnly: true });
    const candidates: RecognitionCandidate[] = options.garmentTypes.flatMap((t) =>
      t.slug ? [{ id: t.id, slug: t.slug, label: t.label }] : [],
    );
    // Nothing this gender's types could be recognised as: straight to the list,
    // without a request no one can answer usefully.
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
    const hit = matchAnswer(result.answer, candidates);
    count(hit ? 'matched' : 'unmatched');
    if (!hit) {
      // The raw answer is model output about a garment photo, not personal data;
      // capped so a runaway answer cannot flood the log.
      app.log.info({ requestId, answer: result.answer?.slice(0, 40) }, 'garment recognition answer not in options');
    }
    return hit ? { garmentTypeId: hit.id, label: hit.label } : null;
  } catch (err) {
    count('failed');
    app.log.warn({ err }, 'garment recognition failed; falling back to the list');
    return null;
  }
}

export function recordRecognitionCorrected(): void {
  garmentClassifyCorrectedTotal.inc();
}
```

Run: `npx vitest run test/messaging-classify.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the integration test (playing the dispatcher)**

Read `apps/api/test/integration/dev-catalog*.test.ts` (whichever file covers `/v1/dev/catalog/options`) for how it seeds `garment_subcategories` rows with `publicApiSlug`, and copy that seeding.

`apps/api/test/integration/messaging-classify.test.ts`:

```ts
import { schema } from '@aivastra/db';
import {
  GARMENT_RECOGNITION_STREAM,
  type GarmentRecognitionRequest,
  garmentRecognitionResultKey,
} from '@aivastra/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recognizeGarment } from '../../src/modules/messaging/classify';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('garment recognition (api side)', () => {
  let c: Containers;
  let app: TestApp;
  let ids: { shirt: string; kurti: string };

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { GARMENT_RECOGNITION_ENABLED: true });
    const rows = await app.db
      .insert(schema.garmentSubcategories)
      .values([
        { genderSlug: 'women', slug: 'fullshirt', label: 'Full shirt', publicApiSlug: 'wa-full-shirt' },
        { genderSlug: 'women', slug: 'kurti', label: 'Kurti', publicApiSlug: 'wa-kurti' },
        // No public slug: cannot be recognised, only picked from the list.
        { genderSlug: 'women', slug: 'gown', label: 'Gown' },
        // Another gender: never offered for 'women'.
        { genderSlug: 'men', slug: 'kurta', label: 'Kurta', publicApiSlug: 'wa-kurta' },
      ])
      .returning({ id: schema.garmentSubcategories.id, slug: schema.garmentSubcategories.slug });
    const by = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
    ids = { shirt: by.fullshirt, kurti: by.kurti };
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  // Stands in for plan 5's dispatcher: waits for the next request after `since`
  // and answers it. Returns the request so the test can inspect it.
  async function answerNext(
    since: string,
    result: { answer: string | null; error: 'no_worker' | 'failed' | 'expired' | null },
  ): Promise<GarmentRecognitionRequest> {
    // Up to 5 s: the first call also builds the options cache for the gender.
    for (let i = 0; i < 100; i++) {
      const entries = await app.redis.xrange(GARMENT_RECOGNITION_STREAM, `(${since}`, '+');
      if (entries.length > 0) {
        const [, fields] = entries[0];
        const request = JSON.parse(fields[1]) as GarmentRecognitionRequest;
        await app.redis.set(
          garmentRecognitionResultKey(request.requestId),
          JSON.stringify({ ...result, ms: 900 }),
          'EX',
          60,
        );
        return request;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('no recognition request arrived');
  }

  const lastId = async () =>
    (await app.redis.xrevrange(GARMENT_RECOGNITION_STREAM, '+', '-', 'COUNT', 1))[0]?.[0] ?? '0-0';

  it("asks with that gender's slugged types and maps the answer to the row", async () => {
    const since = await lastId();
    const [hit, request] = await Promise.all([
      recognizeGarment(app, 'inputs/x/garment.jpg', 'women'),
      answerNext(since, { answer: 'WA-Kurti.', error: null }),
    ]);
    expect(request.garmentKey).toBe('inputs/x/garment.jpg');
    expect(request.options.map((o) => o.slug).sort()).toEqual(['wa-full-shirt', 'wa-kurti']);
    expect(hit).toEqual({ garmentTypeId: ids.kurti, label: 'Kurti' });
  });

  it('an answer outside the options is not recognised', async () => {
    const since = await lastId();
    const [hit] = await Promise.all([
      recognizeGarment(app, 'inputs/x/garment.jpg', 'women'),
      answerNext(since, { answer: 'wa-kurta', error: null }),
    ]);
    expect(hit).toBeNull();
  });

  it('a dispatcher error is not recognised', async () => {
    const since = await lastId();
    const [hit] = await Promise.all([
      recognizeGarment(app, 'inputs/x/garment.jpg', 'women'),
      answerNext(since, { answer: null, error: 'no_worker' }),
    ]);
    expect(hit).toBeNull();
  });

  it('no answer within the budget is not recognised', async () => {
    const started = Date.now();
    expect(await recognizeGarment(app, 'inputs/x/garment.jpg', 'women', { budgetMs: 300 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('with the flag off nothing is requested', async () => {
    const before = await app.redis.xlen(GARMENT_RECOGNITION_STREAM);
    const off = { ...app, env: { ...app.env, GARMENT_RECOGNITION_ENABLED: false } } as TestApp;
    expect(await recognizeGarment(off, 'inputs/x/garment.jpg', 'women')).toBeNull();
    expect(await app.redis.xlen(GARMENT_RECOGNITION_STREAM)).toBe(before);
  });
});
```

If `buildTestApp` does not accept env overrides in that form, use whatever plan 1's `messaging-connect.test.ts` used to set `MESSAGING_WHATSAPP_ENABLED`. If `garment_subcategories` has other NOT NULL columns without defaults, fill them as the copied seeding does.

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts messaging-classify`
Expected: PASS, 5 tests.

- [ ] **Step 7: Typecheck, lint and commit**

Run: `pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint`
Expected: exit 0.

```bash
git add packages/types/src/garment-recognition.ts packages/types/src/index.ts packages/observability/src/metrics.ts apps/api/src/env.ts .env.example .env.production.example apps/api/src/modules/messaging/classify.ts apps/api/test/messaging-classify.test.ts apps/api/test/integration/messaging-classify.test.ts
git commit -m "feat(api): WhatsApp garment recognition request, wait and fallback"
```

---

### Task 6: Extract the studio's garment-type, face and template queries

A behaviour-preserving refactor: the bot must offer exactly what the studio offers, so these three queries move into functions both call. **No logic changes.** Existing integration tests are the safety net. (The first version of this plan also extracted backgrounds, poses and the catalog tree; the five-step flow uses none of them.)

**Files:**
- Create: `apps/api/src/modules/models/queries.ts`
- Modify: `apps/api/src/modules/models/routes.ts`

**Interfaces:**
- Produces:
  - `listGarmentTypes(app, gender: string)` → `{ items }` (the current `/v1/models/garment-types` response)
  - `listFaces(app, q: { gender: string; garmentTypeId?: string })` → `{ items }`
  - `listCatalogueTemplates(app, q: { gender: string; garmentTypeId?: string })` → `{ items }` — each item `{ id, mappingId, label, thumbnailUrl, looks: { id, poseId, poseLabel, poseThumbnailUrl, backgroundId, backgroundLabel, backgroundThumbnailUrl, hasUpper, hasLower, hasShoes, … }[] }`

- [ ] **Step 1: Record the baseline**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts catalogue-templates garment-type faces models`
Write down the pass count.

- [ ] **Step 2: Move each handler body into `models/queries.ts`**

Create `apps/api/src/modules/models/queries.ts` with the imports `routes.ts` uses for these handlers (`schema` from `@aivastra/db`; the drizzle operators they use; `FastifyInstance`; `poseGarmentRoles` from `./garment-roles.js`).

For each route below, cut the body of its `async (req) => { … }` handler and paste it, unchanged, into the named function. The only edit is the first line: replace the `req.query as …` destructuring with the function's parameters. Do not rename variables, reorder queries or change the returned object.

```ts
export async function listGarmentTypes(app: FastifyInstance, gender: string) {
  // body of GET /v1/models/garment-types (routes.ts, the handler starting at
  // `const { gender } = req.query as { gender: string };`), minus that line
}

export async function listFaces(
  app: FastifyInstance,
  { gender, garmentTypeId }: { gender: string; garmentTypeId?: string },
) {
  // body of GET /v1/models/faces, minus its req.query line
}

export async function listCatalogueTemplates(
  app: FastifyInstance,
  { gender, garmentTypeId }: { gender: string; garmentTypeId?: string },
) {
  // body of GET /v1/models/catalogue-templates, minus its req.query line
}
```

Each handler in `routes.ts` becomes a one-liner:

```ts
    async (req) => listGarmentTypes(app, (req.query as { gender: string }).gender),
```

```ts
    async (req) => listFaces(app, req.query as { gender: string; garmentTypeId?: string }),
```

```ts
    async (req) => listCatalogueTemplates(app, req.query as { gender: string; garmentTypeId?: string }),
```

Import the three functions at the top of `routes.ts` and delete imports that are now unused there (Biome will flag them).

- [ ] **Step 3: Prove nothing changed**

Run the Step 1 command again.
Expected: the same pass count. Then `pnpm --filter @aivastra/api test && pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint`, all green.

`git diff --stat` should show `routes.ts` shrinking by about as many lines as `queries.ts` gained. If any query text changed, revert that part.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/models/queries.ts apps/api/src/modules/models/routes.ts
git commit -m "refactor(api): extract garment-type, face and template queries for the WhatsApp bot"
```

---

### Task 7: Runs table, real deps, photo storage, session store and the conversation entry point

**Files:**
- Modify: `packages/db/src/schema/messaging.ts` (add `messagingRuns`)
- Generated: `packages/db/src/migrations/<next>_*.sql` + `meta/`
- Create: `apps/api/src/modules/messaging/runs.ts`
- Create: `apps/api/src/modules/messaging/photos.ts`
- Create: `apps/api/src/modules/messaging/deps.ts`
- Create: `apps/api/src/modules/messaging/session-store.ts`
- Create: `apps/api/src/modules/messaging/conversation.ts`
- Test: `apps/api/test/integration/messaging-conversation.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6; plan 1's `messaging_accounts`.
- Produces (used by plan 3):
  - `schema.messagingRuns` — `catalogue_id` (PK), `messaging_account_id`, `user_id`, `job_ids uuid[]`, `created_at`, `finished_at` (null until plan 3 marks it)
  - `storeGarmentPhoto(app, userId, bytes: Buffer, contentType: string): Promise<string>`
  - `createEngineDeps(app): EngineDeps`
  - `loadSession(redis, channel, externalId)`, `saveSession(redis, channel, externalId, session)`
  - `runConversation(app, account: { id; userId; channel; externalId }, event, messageId, deps?): Promise<OutboundMessage[]>`

- [ ] **Step 1: Add the runs table**

Append to `packages/db/src/schema/messaging.ts` (`index` is already imported there by plan 1; `users` too):

```ts
// One row per create call made from a chat (D34). A run is one catalogueId:
// every job createJob makes in one call shares it. Plan 3's delivery finds a
// finished job's chat through this table, never through job_inputs.params —
// the create request strips unknown params keys, and params feeds the workflow.
// job_ids is an array, not a join table: a run is written once and read whole.
export const messagingRuns = pgTable(
  'messaging_runs',
  {
    catalogueId: uuid('catalogue_id').primaryKey(),
    messagingAccountId: uuid('messaging_account_id')
      .notNull()
      .references(() => messagingAccounts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobIds: uuid('job_ids').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set by plan 3 once the follow-up buttons for the whole run were sent.
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('messaging_runs_account_created_idx').on(t.messagingAccountId, t.createdAt)],
);
```

Run: `pnpm --filter @aivastra/db generate` then `pnpm db:migrate`.
Expected: one new migration with exactly one `CREATE TABLE "messaging_runs"`, two FKs with `ON DELETE cascade`, one index. Its number follows plan 1's migration; if `dev` gained migrations meanwhile, follow `docs/version-control.md` for renumbering.

- [ ] **Step 2: Write `runs.ts`**

`apps/api/src/modules/messaging/runs.ts`:

```ts
import { schema } from '@aivastra/db';
import { CreateTryOnJobRequest } from '@aivastra/types';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { withIdempotency } from '../../lib/idempotency.js';
import { createJob, resolveTryonPlan, updateLastUsedPosePreset, verifyGarmentKey } from '../jobs/create.js';
import type { EngineContext, Quote, TryonBody } from './engine/types.js';

/**
 * Prices a run exactly as /v1/jobs/tryon would charge it, without charging:
 * the same Zod parse the route runs, the same ownership check createJob runs,
 * then resolveTryonPlan (read-only). Throws the same AppErrors createJob would.
 */
export async function quoteRun(app: FastifyInstance, userId: string, raw: TryonBody): Promise<Quote> {
  const body = CreateTryOnJobRequest.parse(raw);
  const key = body.inputs.upperGarmentKey as string;
  await verifyGarmentKey(app, userId, key);
  const plan = await resolveTryonPlan(app, userId, body, { resolvedUpperGarmentKey: key });
  const [credits] = await app.db
    .select({ balance: schema.userCredits.balance })
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, userId));
  return {
    images: plan.looks.length,
    perImage: plan.cost,
    total: plan.cost * plan.looks.length,
    balance: credits?.balance ?? 0,
  };
}

/**
 * The /v1/jobs/tryon route, in process: same parse, same idempotency namespace
 * (keyed on the Meta message id of the last pick, so a redelivered webhook
 * cannot create a second run), same last-used pose tracking. Then records the
 * run so results can find their way back to the chat.
 */
export async function createRun(
  app: FastifyInstance,
  ctx: EngineContext,
  raw: TryonBody,
): Promise<{ runId: string; images: number }> {
  const body = CreateTryOnJobRequest.parse(raw);
  const result = await withIdempotency(app, 'jobs', ctx.userId, `wa:${ctx.messageId}`, () =>
    createJob(app, ctx.userId, body),
  );
  await updateLastUsedPosePreset(app, ctx.userId, result.gender, result.garmentTypeId, result.poseIds);
  await app.db
    .insert(schema.messagingRuns)
    .values({
      catalogueId: result.catalogueId,
      messagingAccountId: ctx.accountId,
      userId: ctx.userId,
      jobIds: result.jobIds,
    })
    // A replayed pick returns the same catalogueId from the idempotency cache.
    .onConflictDoNothing();
  return { runId: result.catalogueId, images: result.jobIds.length };
}

export async function runProgress(
  app: FastifyInstance,
  runId: string,
): Promise<{ finished: number; total: number }> {
  const [run] = await app.db
    .select({ jobIds: schema.messagingRuns.jobIds })
    .from(schema.messagingRuns)
    .where(eq(schema.messagingRuns.catalogueId, runId));
  if (!run) return { finished: 0, total: 0 };
  const done = await app.db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        inArray(schema.jobs.id, run.jobIds),
        or(eq(schema.jobs.status, 'COMPLETED'), eq(schema.jobs.status, 'FAILED')),
      ),
    );
  return { finished: done.length, total: run.jobIds.length };
}
```

Before running: open `apps/api/src/modules/jobs/create.ts` and confirm `updateLastUsedPosePreset`'s parameter order matches the route's call in `jobs/routes.ts` (`app, userId, gender, garmentTypeId, poseIds`), that `createJob`'s result carries `catalogueId`, `jobIds`, `gender`, `garmentTypeId`, `poseIds`, and that terminal job statuses are spelled `COMPLETED` / `FAILED` (search `status:` in `packages/db/src/schema/jobs.ts`). Adjust if they differ; add any other terminal status (for example a cancelled state) to the `or(…)`.

- [ ] **Step 3: Write `photos.ts`**

`apps/api/src/modules/messaging/photos.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { keys } from '@aivastra/storage';
import type { FastifyInstance } from 'fastify';

// Same TTL as /v1/uploads/presign (uploads/routes.ts UPLOAD_OWNER_TTL_SEC):
// the hourly upload sweeper treats a chat photo exactly like a web upload.
const UPLOAD_OWNER_TTL_SEC = 24 * 60 * 60;

/**
 * Stores a photo received in the chat as an ordinary garment upload: the same
 * key shape the presign route issues, the same upload:owner binding, so
 * createJob accepts it unchanged, the dispatcher can read it for recognition,
 * and the sweeper removes it if the seller never generates. Size limits are
 * enforced later by createJob's own check, as for the web.
 */
export async function storeGarmentPhoto(
  app: FastifyInstance,
  userId: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const key = keys.inputGarment(randomUUID());
  await app.storage.putObject(key, bytes, contentType);
  await app.redis.set(`upload:owner:${key}`, userId, 'EX', UPLOAD_OWNER_TTL_SEC);
  return key;
}
```

Check that `@aivastra/storage` exports `keys` and that `keys.inputGarment` produces `inputs/<uuid>/garment.jpg`; if the builder has another name, use the one `/v1/uploads/presign` uses.

- [ ] **Step 4: Write `deps.ts`**

`apps/api/src/modules/messaging/deps.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { listCatalogueTemplates, listFaces, listGarmentTypes } from '../models/queries.js';
import { recognizeGarment, recordRecognitionCorrected } from './classify.js';
import type { AspectRatio, EngineDeps, GarmentTypeOption, Resolution, TemplateOption } from './engine/types.js';
import { createRun, quoteRun, runProgress } from './runs.js';

const ASPECTS = new Set(['1:1', '2:3', '3:4', '4:5']);
const RESOLUTIONS = new Set(['HD', '2K', '4K']);

/** Real EngineDeps: every option list is the studio's own query (models/queries.ts). */
export function createEngineDeps(app: FastifyInstance): EngineDeps {
  const web = app.env.WEB_URL.replace(/\/+$/, '');
  return {
    newNonce: () => randomBytes(4).toString('hex'),

    async getUserDefaults(userId) {
      const [u] = await app.db
        .select({
          aspect: schema.users.defaultAspectRatio,
          resolution: schema.users.defaultResolution,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      return {
        aspectRatio: (ASPECTS.has(u?.aspect ?? '') ? u?.aspect : '1:1') as AspectRatio,
        resolution: (RESOLUTIONS.has(u?.resolution ?? '') ? u?.resolution : 'HD') as Resolution,
      };
    },

    async getBalance(userId) {
      const [c] = await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId));
      return c?.balance ?? 0;
    },

    async listGarmentTypes(gender) {
      const { items } = await listGarmentTypes(app, gender);
      if (items.length === 0) return [];
      // Only types with an active template for this gender can produce a
      // catalog in the chat (D47); listing the rest would be a dead end.
      const mapped = await app.db
        .selectDistinct({ id: schema.catalogueTemplateSubcategories.subcategoryId })
        .from(schema.catalogueTemplateSubcategories)
        .innerJoin(
          schema.catalogueTemplates,
          and(
            eq(schema.catalogueTemplates.id, schema.catalogueTemplateSubcategories.templateId),
            eq(schema.catalogueTemplates.genderSlug, gender),
            eq(schema.catalogueTemplates.isActive, true),
            isNull(schema.catalogueTemplates.deletedAt),
          ),
        )
        .where(inArray(schema.catalogueTemplateSubcategories.subcategoryId, items.map((i) => i.id)));
      const hasTemplate = new Set(mapped.map((m) => m.id));
      return (
        items
          // D16/D31: the two-step saree flow is not in the bot.
          .filter((i) => !i.requiresMannequinStep && hasTemplate.has(i.id))
          .map(
            (i): GarmentTypeOption => ({
              id: i.id,
              label: i.label,
              requiresLowerUpload: i.requiresLowerUpload,
              requiresThirdUpload: i.requiresThirdUpload,
              lowerUploadLabel: i.lowerUploadLabel,
              thirdUploadLabel: i.thirdUploadLabel,
              defaultLowerCatalogId: i.defaultLowerCatalogId,
              defaultShoeCatalogId: i.defaultShoeCatalogId,
            }),
          )
      );
    },

    recognizeGarment: (garmentKey, gender) => recognizeGarment(app, garmentKey, gender),
    recordRecognitionCorrected,

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

    async getDefaultFaceId(gender, garmentTypeId) {
      // The studio's own face list for this type, in admin order (D43).
      const { items } = await listFaces(app, { gender, garmentTypeId });
      return items[0]?.id ?? null;
    },

    quote: (userId, body) => quoteRun(app, userId, body),
    createRun: (ctx, body) => createRun(app, ctx, body),
    runProgress: (runId) => runProgress(app, runId),
    links: { pricing: `${web}/pricing`, help: `${web}/contact-us`, studio: `${web}/studio` },
  };
}
```

If TypeScript reports a field that does not exist on a query's item type, read the query in `queries.ts` and map the real field name — the query is the source of truth.

- [ ] **Step 5: Write the session store and entry point**

`apps/api/src/modules/messaging/session-store.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { Session } from './engine/types.js';

type RedisClient = FastifyInstance['redis'];
// Matches Meta's 24-hour customer-service window: after it, the conversation
// starts over anyway (spec section 8).
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const key = (channel: string, externalId: string) => `msg:session:${channel}:${externalId}`;

export async function loadSession(redis: RedisClient, channel: string, externalId: string): Promise<Session | null> {
  const raw = await redis.get(key(channel, externalId));
  if (!raw) return null;
  const s = JSON.parse(raw) as Session;
  // A session written by an incompatible engine version starts over cleanly.
  return s.v === 1 ? s : null;
}

export async function saveSession(
  redis: RedisClient,
  channel: string,
  externalId: string,
  session: Session,
): Promise<void> {
  await redis.set(key(channel, externalId), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
}
```

`apps/api/src/modules/messaging/conversation.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { createEngineDeps } from './deps.js';
import { handle } from './engine/engine.js';
import type { EngineDeps, InboundEvent, OutboundMessage } from './engine/types.js';
import { loadSession, saveSession } from './session-store.js';

export interface ConversationAccount {
  id: string;
  userId: string;
  channel: string;
  externalId: string;
}

/**
 * One inbound event for one connected account: load the session, run the
 * engine, save, return what to send. The caller (plan 3's inbound consumer)
 * renders and sends the messages, and must process one sender's events one at
 * a time — two concurrent calls for one sender would overwrite each other's
 * session. A gender tap can take up to 8 s here (garment recognition, D48), so
 * the caller must not make other senders wait behind it.
 */
export async function runConversation(
  app: FastifyInstance,
  account: ConversationAccount,
  event: InboundEvent,
  messageId: string,
  deps: EngineDeps = createEngineDeps(app),
): Promise<OutboundMessage[]> {
  const prev = await loadSession(app.redis, account.channel, account.externalId);
  const { session, messages } = await handle(
    prev,
    event,
    { userId: account.userId, accountId: account.id, messageId },
    deps,
  );
  await saveSession(app.redis, account.channel, account.externalId, session);
  return messages;
}
```

- [ ] **Step 6: Write the integration test**

`apps/api/test/integration/messaging-conversation.test.ts` drives the **real** deps end to end with recognition off (the list path): seeded catalog → template run through `createJob`, plus the idempotency check. Seed by following `apps/api/test/integration/catalogue-templates-public.test.ts` (template side: `catalogue_templates`, `catalogue_template_looks`, `catalogue_template_subcategories`, `catalogue_template_pose_workflows`) and `jobs-back-garment-view.test.ts` (pose, workflow, credit plan, resolution tier) rather than guessing column names. Read both files' `beforeAll` first.

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runConversation } from '../../src/modules/messaging/conversation';
import { createEngineDeps } from '../../src/modules/messaging/deps';
import { decodeReplyId } from '../../src/modules/messaging/engine/reply-id';
import { buildTryonBody } from '../../src/modules/messaging/engine/rules';
import type { InboundEvent, OutboundMessage } from '../../src/modules/messaging/engine/types';
import { CHANNEL_WHATSAPP, connectAccount } from '../../src/modules/messaging/identity';
import { storeGarmentPhoto } from '../../src/modules/messaging/photos';
import { createRun } from '../../src/modules/messaging/runs';
import { loadSession } from '../../src/modules/messaging/session-store';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

function tapIn(msgs: OutboundMessage[], action: string, value?: string): InboundEvent {
  for (const m of msgs) {
    const ids =
      m.kind === 'buttons' ? m.buttons.map((b) => b.id)
      : m.kind === 'list' ? m.rows.map((r) => r.id)
      : m.kind === 'cards' ? m.cards.map((c) => c.id)
      : [];
    for (const id of ids) {
      const d = decodeReplyId(id);
      if (d?.action === action && (value === undefined || d.value === value)) return { type: 'reply', id };
    }
  }
  throw new Error(`${action} not offered: ${JSON.stringify(msgs)}`);
}

describe('messaging conversation (real deps)', () => {
  let c: Containers;
  let app: TestApp;
  let realHeadObject: TestApp['storage']['headObject'];
  // Fill in from your seeding: the ids the steps below tap.
  let seeded: { garmentTypeId: string; lookId: string };

  beforeAll(async () => {
    c = await startContainers();
    // Recognition off: this test walks the list path, which needs no dispatcher.
    app = await buildTestApp(c, { MESSAGING_WHATSAPP_ENABLED: true });
    realHeadObject = app.storage.headObject.bind(app.storage);
    // Seed: one 'women' garment type (no mannequin step, no default lower/shoe
    // needed), one active face, one background, one front pose whose workflow
    // has an upper node only, one catalogue template (gender 'women') with that
    // pose/background as its single look, its catalogue_template_subcategories
    // mapping and catalogue_template_pose_workflows row, an enabled HD
    // resolution tier with creditCost 5, and a credit plan.
    // Assign seeded = { garmentTypeId, lookId } (lookId = the catalogue_template_looks.id).
  }, 60_000);

  // createJob's size check heads the object; the test photo is tiny but real.
  beforeEach(() => {
    app.storage.headObject = (async () => ({ contentLength: 1024 })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    app.storage.headObject = realHeadObject;
  });
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  // A connected seller with 100 credits, walked to the look carousel for 1 pose.
  async function walkToPick(tag: string) {
    const { userId } = await createVerifiedUserToken(app, `wa-${tag}-${Date.now()}@example.com`);
    await app.db.insert(schema.userCredits).values({ userId, balance: 100 });
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+9${Date.now().toString().slice(-11)}`,
      userId,
      linkedVia: 'web_code',
    });
    const acct = { id: account.id, userId, channel: account.channel, externalId: account.externalId };
    const deps = createEngineDeps(app);
    let n = 0;
    const send = (e: InboundEvent) => runConversation(app, acct, e, `wamid.${tag}.${++n}`, deps);

    const key = await storeGarmentPhoto(app, userId, Buffer.from('fake-jpeg'), 'image/jpeg');
    let msgs = await send({ type: 'image', garmentKey: key });
    msgs = await send(tapIn(msgs, 'gender', 'women'));
    msgs = await send(tapIn(msgs, 'gt', seeded.garmentTypeId));
    const countMsgs = msgs;
    msgs = await send(tapIn(msgs, 'count', '1'));
    return { userId, account, acct, send, msgs, countMsgs };
  }

  const balanceOf = async (userId: string) =>
    (
      await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId))
    )[0]?.balance;

  it('photo → gender → type → count → pick creates one charged job and records the run', async () => {
    const w = await walkToPick('conv');
    const { userId, account, acct, send } = w;
    const count = w.countMsgs.find((m) => m.kind === 'list');
    expect(count && count.kind === 'list' ? count.rows[0].title : '').toBe('1 pose · 5 credits');

    await send(tapIn(w.msgs, 'look', seeded.lookId));
    const session = await loadSession(app.redis, acct.channel, acct.externalId);
    expect(session?.state).toBe('GENERATING');

    const [run] = await app.db
      .select()
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.catalogueId, session?.runId as string));
    expect(run).toMatchObject({ messagingAccountId: account.id, userId });
    expect(run.jobIds).toHaveLength(1);

    // D17: the bot is charged exactly what it quoted.
    expect(await balanceOf(userId)).toBe(95);
  });

  it('the same message id never creates a second run', async () => {
    const { userId, account, acct } = await walkToPick('dup');
    const session = await loadSession(app.redis, acct.channel, acct.externalId);
    if (!session) throw new Error('no session');
    // Straight at createRun: after a run starts the session's nonce changes, so a
    // redelivered tap is already stale in the engine. This checks the second
    // guard — the idempotency key — that protects a crash between createJob and
    // the session save.
    const ctx = { userId, accountId: account.id, messageId: 'wamid.dup' };
    const body = buildTryonBody(session, [seeded.lookId]);
    const first = await createRun(app, ctx, body);
    const second = await createRun(app, ctx, body);
    expect(second).toEqual(first);
    const runs = await app.db
      .select()
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.messagingAccountId, account.id));
    expect(runs).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(95);
  });
});
```

The seeding in `beforeAll` is the one step written as instructions rather than code: the catalogue-template tables and the resolution-tier config were not read while writing this plan. Follow the two named test files rather than guessing column names.

- [ ] **Step 7: Run it**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts messaging-conversation`
Expected: PASS, 2 tests. Then the full unit suite, typecheck and lint as in Task 6 Step 3.

If `createJob` fails on queue capacity (`assertQueueCapacity`), read how `jobs-back-garment-view.test.ts` satisfies it (worker registry seeding or an env override) and do the same.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/messaging.ts packages/db/src/migrations apps/api/src/modules/messaging apps/api/test/integration/messaging-conversation.test.ts
git commit -m "feat(api): WhatsApp runs table, real engine deps and conversation entry point"
```

---

### Task 8: Record the decisions, flag plan 3, and progress

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md`
- Modify: `docs/superpowers/plans/2026-10-13-whatsapp-bot-3-whatsapp-adapter.md`
- Modify: `docs/progress.md`

- [ ] **Step 1: Update the spec**

Add to the section 3 table:

```
| D33 | Engine purity | Deterministic, not pure: `handle(session, event, ctx, deps)` awaits an injected `EngineDeps` for option lists and side effects but does no I/O of its own and takes randomness from `deps`. Tested with in-memory fakes. |
| D34 | Run tracking | A `messaging_runs` table (one row per create call, keyed by `catalogue_id`, with the account and job ids), not `job_inputs.params.channel`: the create request strips unknown params keys, and params feed the workflow. |
| D48 | Waiting for recognition | Inside the conversation, polling the result key for at most 8 s after the gender tap, behind `GARMENT_RECOGNITION_ENABLED` (literal `'true'`; off = always the list). The request/result contract is `packages/types/src/garment-recognition.ts`. |
| D49 | Looks needing a question | Not offered: a shoe look without a default shoe, a combined look without a default lower or lower photo, a lower-only look in a mixed template unless the type takes a lower photo. |
```

In section 12, replace `jobs.channel_delivered_at` and `job_inputs.params.channel` with the `messaging_runs` table (plan 3 adds per-job delivery tracking), and add `GARMENT_RECOGNITION_ENABLED` to section 16's table.

- [ ] **Step 2: Flag the change plan 3 needs**

Plan 3's inbound consumer reads one message at a time and processes it before reading the next (`withSenderLock` inside a single loop). With D48, a gender tap holds that loop for up to 8 seconds, so every other seller would wait behind it. Add to the top of plan 3, under its decisions:

> **Required by plan 2 (D48):** the inbound consumer must not serialise different senders. Read up to 10 messages per `XREADGROUP`, group them by sender, and process the groups concurrently (each group in order, under `withSenderLock`); acknowledge each message after it is processed. The lock's waiter budget (50 × 200 ms) must exceed the 8-second recognition wait plus normal handling — raise it to 75 × 200 ms.

Then update plan 3's renderer and parser tasks for the new message shapes: the gender question is a 4-row list, the count question a list whose last row is "Wrong garment? Change", and the look carousel uses card ids with action `look`.

- [ ] **Step 3: Add the progress entry**

Dated entry at the top of `docs/progress.md`: what shipped (five-step engine, look eligibility rules, recognition request/wait/fallback with the flag off, extracted queries, `messaging_runs`, real deps), the test commands and pass counts from Tasks 2–7, the migration number, that `GARMENT_RECOGNITION_ENABLED` stays off until plan 5, and that nothing is reachable by users until plan 3 (no webhook yet).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md docs/superpowers/plans/2026-10-13-whatsapp-bot-3-whatsapp-adapter.md docs/progress.md
git commit -m "docs: WhatsApp bot plan 2 decisions (D33, D34, D48, D49), plan 3 consumer note, progress"
```

---

## Self-review notes

- **Spec section 8 coverage:** main menu + Credits + Help, global `menu`/`restart`/`help`, photo from the menu or after delivery, stale buttons, session expiry, unexpected input (Task 3); gender list of four in management's order (Task 3); recognised type with "Detected", list fallback, recognised-but-unavailable and no-template / no-face → web studio (Task 3); count list with cost, balance, cap of 9 and "Change", correction metric, NO_CREDITS before picking, credits added (Task 4); look carousel, duplicate taps, generation on the last pick, defaults for lower and shoes, lower-only, required third and lower photos (Task 4); BAD_CATALOG → pick again, insufficient credits at create (Task 4); progress, delivery buttons, partial failure, retry of failed looks, more poses (Task 4); duplicate create (Task 7).
- **Spec 8a coverage:** options from the cached dev API list with public slugs only, per gender (Task 5 integration); exact slug matching (Task 5 unit); budget, timeout, dispatcher errors, flag off (Task 5 integration); outcome and correction metrics (Task 5, Task 4). The dispatcher lane, the workflow and the duration histogram are plan 5.
- **Deferred to plan 3, by design:** STOP / START, `CONNECT <code>`, the connect prompt for an unknown number, per-sender serialisation and the concurrency change above, downloading the photo and calling `storeGarmentPhoto`, sending `runFinished` and `creditsAdded`, sending each finished image, the 24-hour template message, and rendering `OutboundMessage` to WhatsApp JSON.
- **Type consistency:** `TemplateLook.id` is the catalogue_template_looks id (card ids carry it); `failedPoseIds` from plan 3 are pose ids, mapped back to look ids in the retry branch; `recognizeGarment` returns `{ garmentTypeId, label }` in both `EngineDeps` and `classify.ts`.
- **Known limits, as in the studio:** a template's back-view looks cannot be detected (the templates query returns no garment view), so such a look would be rejected by the create path before charging; a lower-only look in a mixed template is hidden rather than asking for a lower photo the type doesn't declare.
