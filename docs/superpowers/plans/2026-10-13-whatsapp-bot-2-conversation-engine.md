# WhatsApp bot — Plan 2: Conversation engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A channel-agnostic conversation engine that walks a connected seller from "New catalog" to a created try-on run — gender, garment type, image shape, garment photo, face, ready-made template or own background + poses, any extra photos, lower, shoes, a priced confirmation, and generation — producing abstract messages that plan 3 renders to WhatsApp.

**Architecture:** A deterministic `handle(session, event, ctx, deps)` function in `apps/api/src/modules/messaging/engine/` decides every transition and the messages to send. All I/O sits behind an `EngineDeps` interface: unit tests drive the engine with in-memory fakes; the real implementation (`messaging/deps.ts`) reuses the exact queries behind the studio's `/v1/models/*` and `/v1/catalog/:type` routes (extracted into shared functions, no behaviour change), prices runs with the create path's own `resolveTryonPlan`, and creates runs through `createJob`. Sessions live in Redis for 24 hours.

**Tech Stack:** TypeScript (ESM), Fastify 5, Drizzle ORM, ioredis, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md` — sections 8 (state machine), 9 (selection), 10 (credits), 13 (failures); decisions D7, D14, D16, D17, D22, D23, D24, D31.

**This is plan 2 of 4.** Depends on plan 1 (`messaging_accounts`, `identity.ts`). Plan 3 owns everything Meta-facing: webhook, inbound consumer, downloading the photo from Meta (it calls `storeGarmentPhoto` from this plan), rendering `OutboundMessage`s, STOP/START, `CONNECT <code>`, the connect prompt for unknown numbers, per-sender locking, result delivery and the `runFinished` / `creditsAdded` events.

## Decisions this plan makes (recorded in Task 8)

1. **The engine is deterministic, not strictly pure.** It awaits `deps` for option lists and side effects, but performs no I/O of its own and takes its randomness (`newNonce`) from `deps`. Passing every possible list into a pure function would mean loading faces, poses, templates and catalog items on every message. Spec section 5 called it "pure"; D33 records the change.
2. **Runs are tracked in a `messaging_runs` table, not `job_inputs.params.channel`.** The create request's `params` object is a strict Zod schema that strips unknown keys, and `job_inputs.params` is merged into the ComfyUI workflow params — the wrong place for a routing flag. A run is one `catalogueId` (every job of one create call shares it). D34.
3. **No platform is sent.** The bot asks only for the image shape (aspect ratio), from the four values `PATCH /v1/me` allows. `platform` is never set, so the Amazon white-background override never runs (D23). Resolution is the user's saved `defaultResolution`.
4. **"Use default" replaces "Skip" for lower and shoes.** The create path rejects a pose with a lower or shoe slot and no item; the studio silently fills the garment type's default. The bot offers `[Use default]` only when the garment type has a default.

## Global Constraints

- Feature flag and env rules from plan 1 apply (`MESSAGING_WHATSAPP_ENABLED`, literal `'true'`, `=== true`).
- **The bot never creates users and never grants credits** (D13). It only spends through `createJob`.
- **Same validation and price as the web** (D17): every create body goes through `CreateTryOnJobRequest.parse`, quotes come from `resolveTryonPlan`, runs from `createJob` wrapped in `withIdempotency(app, 'jobs', userId, key, …)` with the same `updateLastUsedPosePreset` follow-up the `/v1/jobs/tryon` route does.
- **Standard try-on only** (D16, D31): garment types with `requiresMannequinStep` are never offered.
- **Never send `platform`** (D23).
- Option lists must come from the same queries as the studio's routes — extracted, not copied.
- No production schema work; migrations ship through CI/CD → `db:migrate:prod`.
- No `console.log`; comment the *why*.
- English only; every user-visible string lives in `engine/copy.ts` (D8).
- WhatsApp limits the engine must respect (spec section 9, unverified until plan 3's spike — T1): ≤3 reply buttons, button title ≤20 characters, ≤10 list rows, list row title ≤24 characters, ≤10 cards per carousel. Card ids and button ids ≤ 200 characters.

## File structure

| File | Responsibility |
|---|---|
| `apps/api/src/modules/messaging/engine/types.ts` (create) | `Session`, `InboundEvent`, `OutboundMessage`, option types, `EngineDeps`, `EngineContext` |
| `apps/api/src/modules/messaging/engine/copy.ts` (create) | every English string |
| `apps/api/src/modules/messaging/engine/reply-id.ts` (create) | encode / decode button & card ids |
| `apps/api/src/modules/messaging/engine/rules.ts` (create) | slot rules + create-body builder, mirroring the studio |
| `apps/api/src/modules/messaging/engine/engine.ts` (create) | `handle()` — the state machine |
| `apps/api/src/modules/models/queries.ts` (create) | extracted option queries shared by routes and bot |
| `apps/api/src/modules/models/routes.ts` (modify) | handlers call `queries.ts` |
| `apps/api/src/modules/catalog/routes.ts` (modify) | handler calls `listCatalogTree` |
| `apps/api/src/modules/catalog/queries.ts` (create) | extracted `listCatalogTree` |
| `packages/db/src/schema/messaging.ts` (modify) | `messaging_runs` table |
| `apps/api/src/modules/messaging/runs.ts` (create) | quote, create run, run progress |
| `apps/api/src/modules/messaging/photos.ts` (create) | store a received photo as an owned garment upload |
| `apps/api/src/modules/messaging/deps.ts` (create) | real `EngineDeps` |
| `apps/api/src/modules/messaging/session-store.ts` (create) | Redis load / save |
| `apps/api/src/modules/messaging/conversation.ts` (create) | `runConversation()` — load, handle, save |
| tests | `apps/api/test/messaging-reply-id.test.ts`, `messaging-rules.test.ts`, `messaging-engine.test.ts`, `apps/api/test/helpers/engine-fakes.ts`, `apps/api/test/integration/messaging-conversation.test.ts` |

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

export type State =
  | 'MAIN_MENU'
  | 'ASK_GENDER'
  | 'ASK_GARMENT_TYPE'
  | 'ASK_ASPECT'
  | 'PICK_ASPECT'
  | 'ASK_GARMENT_PHOTO'
  | 'PICK_FACE'
  | 'PICK_LOOK_MODE'
  | 'PICK_TEMPLATE'
  | 'PICK_BACKGROUND'
  | 'PICK_POSES'
  | 'ASK_EXTRA_PHOTO'
  | 'PICK_LOWER'
  | 'PICK_SHOES'
  | 'CONFIRM'
  | 'NO_CREDITS'
  | 'GENERATING'
  | 'DELIVERED';

// Extra uploads, asked in this order after the look is chosen (rules.ts).
export type PhotoSlot = 'upperBack' | 'lowerFront' | 'lowerBack' | 'third' | 'fourth';

export interface GarmentTypeOption {
  id: string;
  label: string;
  requiresLowerUpload: boolean;
  requiresThirdUpload: boolean;
  allowsFourthUpload: boolean;
  upperUploadLabel: string | null;
  lowerUploadLabel: string | null;
  thirdUploadLabel: string | null;
  fourthUploadLabel: string | null;
  defaultLowerCatalogId: string | null;
  defaultShoeCatalogId: string | null;
}

export interface ImageOption {
  id: string;
  label: string;
  imageUrl: string;
}

export interface PoseRoles {
  hasUpper: boolean;
  hasLower: boolean;
  hasShoes: boolean;
  garmentView: 'front' | 'back';
}

export interface PoseOption extends ImageOption, PoseRoles {}

export interface TemplateLook {
  poseId: string;
  backgroundId: string;
  hasUpper: boolean;
  hasLower: boolean;
  hasShoes: boolean;
}

export interface TemplateOption extends ImageOption {
  mappingId: string;
  looks: TemplateLook[];
}

export interface Session {
  v: 1;
  state: State;
  // Changes every time a new step is prompted; every button/card id carries it,
  // so a tap on an older message is recognised and ignored (spec section 8).
  nonce: string;
  // Card / list paging within the current step. Paging keeps the nonce, so a
  // card from page 1 still works after "More".
  page: number;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  gender?: Gender;
  garmentType?: GarmentTypeOption;
  garmentKey?: string;
  photos: Partial<Record<PhotoSlot, string>>;
  skippedFourth?: boolean;
  faceId?: string;
  mode?: 'template' | 'custom';
  template?: { id: string; label: string; mappingId: string; looks: TemplateLook[] };
  backgroundId?: string;
  // Selected custom poses in tap order (string keys keep insertion order).
  poses: Record<string, PoseRoles>;
  // undefined = not asked yet; null = "Use default".
  lowerCatalogId?: string | null;
  shoeCatalogId?: string | null;
  lowerDone?: boolean;
  shoesDone?: boolean;
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
  // Meta's message id of the inbound event; the idempotency key for Generate.
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
  listGarmentTypes(gender: Gender): Promise<GarmentTypeOption[]>;
  listFaces(gender: Gender, garmentTypeId: string): Promise<ImageOption[]>;
  listTemplates(gender: Gender, garmentTypeId: string): Promise<TemplateOption[]>;
  listBackgrounds(gender: Gender): Promise<ImageOption[]>;
  listPoses(gender: Gender, garmentTypeId: string): Promise<PoseOption[]>;
  getLastPoseIds(userId: string, gender: Gender, garmentTypeId: string): Promise<string[]>;
  listCatalogItems(
    type: 'lower' | 'shoe',
    gender: Gender,
    garmentTypeId: string,
    poseIds: string[],
  ): Promise<ImageOption[]>;
  // Throws AppError for anything createJob would reject.
  quote(userId: string, body: TryonBody): Promise<Quote>;
  // Throws AppError('INSUFFICIENT_CREDITS', 402) when the balance is short.
  createRun(
    ctx: EngineContext,
    body: TryonBody,
  ): Promise<{ runId: string; images: number }>;
  runProgress(runId: string): Promise<{ finished: number; total: number }>;
  links: { pricing: string; help: string };
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
  btnDone: 'Done',
  btnSkip: 'Skip',
  btnUseDefault: 'Use default',
  btnGenerate: 'Generate',
  btnStartOver: 'Start over',
  btnReadyMade: 'Ready-made looks',
  btnCreateOwn: 'Create your own',
  btnUseLastPoses: 'Use my last poses',
  btnChange: 'Change',
  btnMoreLooks: 'More looks',
  btnRetryFailed: 'Retry failed',
  listChoose: 'Choose',
  moreOptions: 'More options:',

  credits: (balance: number, pricing: string) =>
    `You have ${balance} credits. Buy more on the website: ${pricing}`,
  help: (help: string) =>
    `Send a photo of your garment to start a catalog, or type MENU at any time. Need a person? ${help}`,

  askGender: 'Who is the garment for?',
  genders: { women: 'Women', men: 'Men', girls: 'Girls', boys: 'Boys' } as const,
  askGarmentType: 'What type of garment is it?',
  askAspect: (ratio: string) => `Image shape: ${ratio}. Keep it or change it?`,
  btnKeepAspect: (ratio: string) => `Keep ${ratio}`,
  pickAspect: 'Choose the image shape.',
  aspects: {
    '1:1': 'Square 1:1',
    '2:3': 'Portrait 2:3',
    '3:4': 'Portrait 3:4',
    '4:5': 'Portrait 4:5',
  } as const,
  askGarmentPhoto: (label: string | null) =>
    `Send a photo of the ${label ?? 'garment'}, laid flat and fully visible.`,
  pickFace: 'Choose a model.',
  pickLookMode: 'Use a ready-made set of looks, or choose your own background and poses?',
  pickTemplate: 'Choose a ready-made set. All of its looks are generated.',
  templateTitle: (label: string, n: number) => `${label} · ${n} looks`,
  pickBackground: 'Choose a background.',
  pickPoses: (n: number) =>
    n === 0 ? 'Choose one or more poses. Tap a card to add it.' : `${n} selected. Add more or tap Done.`,
  poseAdded: (n: number) => `Added. ${n} selected.`,
  poseAlreadyAdded: 'That pose is already added.',
  askPhoto: {
    upperBack: (label: string | null) => `Now send a photo of the back of the ${label ?? 'garment'}.`,
    lowerFront: (label: string | null) => `Now send a photo of the ${label ?? 'lower garment'}.`,
    lowerBack: (label: string | null) => `Now send a photo of the back of the ${label ?? 'lower garment'}.`,
    third: (label: string | null) => `Now send a photo of the ${label ?? 'third garment'}.`,
    fourth: (label: string | null) =>
      `Optional: send a photo of the ${label ?? 'blouse'}, or tap Skip.`,
  },
  pickLower: 'Choose the lower garment.',
  pickShoes: 'Choose the shoes.',
  confirm: (q: { images: number; total: number; balance: number }, summary: string) =>
    `${summary}\n\n${q.images} ${q.images === 1 ? 'image' : 'images'}, uses ${q.total} credits. Your balance: ${q.balance}.`,
  summary: (parts: string[]) => parts.join('\n'),
  noCredits: (pricing: string) =>
    `You don't have enough credits for this. Buy more on the website, then come back: ${pricing}`,
  creditsAdded: (n: number) => `${n} credits added.`,
  generating: (n: number) =>
    `Working on ${n} ${n === 1 ? 'image' : 'images'}. I'll send each one here as it's ready.`,
  stillGenerating: (finished: number, total: number) =>
    `Still generating: ${finished} of ${total} done.`,
  delivered: 'All done. What next?',
  partlyFailed: (failed: number, total: number) =>
    `${failed} of ${total} ${total === 1 ? 'image' : 'images'} failed. The credits for ${failed === 1 ? 'it were' : 'them were'} refunded.`,

  stale: 'That option is from an earlier step.',
  sessionExpired: "Your last session expired, let's start again.",
  reprompt: 'Please use the options above, or type MENU.',
  notNow: "I wasn't expecting a photo just now.",
  unsupported: 'Please send a photo (JPG or PNG), not a video or document.',
  nothingAvailable: 'Nothing is available for that choice right now. Please pick something else.',
} as const;
```

- [ ] **Step 3: Write the failing reply-id tests**

`apps/api/test/messaging-reply-id.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeReplyId, encodeReplyId } from '../src/modules/messaging/engine/reply-id';

describe('reply ids', () => {
  it('round-trips nonce, action and value', () => {
    const id = encodeReplyId('n1', 'face', '6f1c3b2a-0000-4000-8000-000000000001');
    expect(decodeReplyId(id)).toEqual({
      nonce: 'n1',
      action: 'face',
      value: '6f1c3b2a-0000-4000-8000-000000000001',
    });
  });
  it('allows an empty value', () => {
    expect(decodeReplyId(encodeReplyId('n1', 'done'))).toEqual({
      nonce: 'n1',
      action: 'done',
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
// it; values are UUIDs or short enum strings, never containing '|'.
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

### Task 2: Slot rules and create-body builder

These mirror `apps/catalogues-web/src/app/(app)/studio/page.tsx` lines 1139–1183 (`needsUpperBack`, `needsLowerBack`, `lowerOnly`, `lowerOnlyIsBack`, `lowerGarmentKeyForSubmit`), 1648–1651 (`effectiveLowerId`) and 1774–1776 (`effectiveShoesId`). Read those lines before starting; if the studio has changed since 2026-10-13, follow the studio.

**Files:**
- Create: `apps/api/src/modules/messaging/engine/rules.ts`
- Test: `apps/api/test/messaging-rules.test.ts`

**Interfaces:**
- Consumes: `Session`, `PoseRoles`, `PhotoSlot`, `TryonBody` (Task 1).
- Produces: `selectedRoles(s)`, `isLowerOnly(s)`, `requiredPhotoSlots(s)`, `firstMissingSlot(s)`, `needsLowerPick(s)`, `needsShoesPick(s)`, `selectedPoseIds(s)`, `imageCount(s)`, `buildTryonBody(s)`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/messaging-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildTryonBody,
  firstMissingSlot,
  isLowerOnly,
  needsLowerPick,
  needsShoesPick,
  requiredPhotoSlots,
} from '../src/modules/messaging/engine/rules';
import type { GarmentTypeOption, PoseRoles, Session } from '../src/modules/messaging/engine/types';

const GT: GarmentTypeOption = {
  id: 'gt-1',
  label: 'Shirt',
  requiresLowerUpload: false,
  requiresThirdUpload: false,
  allowsFourthUpload: false,
  upperUploadLabel: null,
  lowerUploadLabel: null,
  thirdUploadLabel: null,
  fourthUploadLabel: null,
  defaultLowerCatalogId: 'lower-default',
  defaultShoeCatalogId: 'shoe-default',
};
const FRONT_FULL: PoseRoles = { hasUpper: true, hasLower: true, hasShoes: true, garmentView: 'front' };
const BACK_UPPER: PoseRoles = { hasUpper: true, hasLower: false, hasShoes: false, garmentView: 'back' };
const LOWER_ONLY: PoseRoles = { hasUpper: false, hasLower: true, hasShoes: false, garmentView: 'front' };
const LOWER_ONLY_BACK: PoseRoles = { ...LOWER_ONLY, garmentView: 'back' };

function session(over: Partial<Session> = {}): Session {
  return {
    v: 1,
    state: 'CONFIRM',
    nonce: 'n',
    page: 0,
    aspectRatio: '1:1',
    resolution: 'HD',
    gender: 'women',
    garmentType: GT,
    garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg',
    photos: {},
    faceId: 'face-1',
    mode: 'custom',
    backgroundId: 'bg-1',
    poses: { 'pose-1': FRONT_FULL },
    ...over,
  };
}

describe('requiredPhotoSlots', () => {
  it('asks nothing extra for a plain front pose', () => {
    expect(requiredPhotoSlots(session())).toEqual([]);
  });
  it('asks for the back photo when a custom pose is a back view', () => {
    expect(requiredPhotoSlots(session({ poses: { a: FRONT_FULL, b: BACK_UPPER } }))).toEqual([
      'upperBack',
    ]);
  });
  it('never asks for a back photo in template mode (T15)', () => {
    const s = session({
      mode: 'template',
      poses: {},
      template: {
        id: 't',
        label: 'T',
        mappingId: 'm',
        looks: [{ poseId: 'p', backgroundId: 'b', hasUpper: true, hasLower: false, hasShoes: false }],
      },
    });
    expect(requiredPhotoSlots(s)).toEqual([]);
  });
  it('uses the back slot for a lower-only back pose', () => {
    expect(requiredPhotoSlots(session({ poses: { a: LOWER_ONLY_BACK } }))).toEqual(['upperBack']);
  });
  it('asks for a separate lower back photo in a mixed selection', () => {
    expect(requiredPhotoSlots(session({ poses: { a: FRONT_FULL, b: LOWER_ONLY_BACK } }))).toEqual([
      'lowerBack',
    ]);
  });
  it('adds garment-type uploads in order, fourth last', () => {
    const gt = { ...GT, requiresLowerUpload: true, requiresThirdUpload: true, allowsFourthUpload: true };
    expect(requiredPhotoSlots(session({ garmentType: gt }))).toEqual(['lowerFront', 'third', 'fourth']);
  });
});

describe('firstMissingSlot', () => {
  it('treats a skipped fourth photo as done', () => {
    const gt = { ...GT, allowsFourthUpload: true };
    expect(firstMissingSlot(session({ garmentType: gt }))).toBe('fourth');
    expect(firstMissingSlot(session({ garmentType: gt, skippedFourth: true }))).toBeNull();
  });
});

describe('lower and shoe steps', () => {
  it('lower-only selections need no lower pick', () => {
    const s = session({ poses: { a: LOWER_ONLY } });
    expect(isLowerOnly(s)).toBe(true);
    expect(needsLowerPick(s)).toBe(false);
  });
  it('a lower upload type needs no lower pick', () => {
    expect(needsLowerPick(session({ garmentType: { ...GT, requiresLowerUpload: true } }))).toBe(false);
  });
  it('a pose with a lower slot needs a lower pick; shoes likewise', () => {
    expect(needsLowerPick(session())).toBe(true);
    expect(needsShoesPick(session())).toBe(true);
    expect(needsShoesPick(session({ poses: { a: BACK_UPPER } }))).toBe(false);
  });
});

describe('buildTryonBody', () => {
  it('custom: background + poses, defaults filled, no platform', () => {
    const body = buildTryonBody(session({ lowerCatalogId: null, shoeCatalogId: 'shoe-9' }));
    expect(body).toEqual({
      aspectRatio: '1:1',
      resolution: 'HD',
      inputs: {
        upperGarmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg',
        faceId: 'face-1',
        garmentTypeId: 'gt-1',
        backgroundId: 'bg-1',
        poseIds: ['pose-1'],
        lowerCatalogId: 'lower-default',
        shoeCatalogId: 'shoe-9',
      },
    });
    expect(body).not.toHaveProperty('platform');
  });
  it('template: looks + mapping id, never backgroundId/poseIds', () => {
    const body = buildTryonBody(
      session({
        mode: 'template',
        poses: {},
        backgroundId: undefined,
        template: {
          id: 't',
          label: 'T',
          mappingId: 'map-1',
          looks: [
            { poseId: 'p1', backgroundId: 'b1', hasUpper: true, hasLower: false, hasShoes: false },
            { poseId: 'p2', backgroundId: 'b2', hasUpper: true, hasLower: false, hasShoes: false },
          ],
        },
      }),
    );
    expect(body.inputs).toMatchObject({
      looks: [
        { poseId: 'p1', backgroundId: 'b1' },
        { poseId: 'p2', backgroundId: 'b2' },
      ],
      catalogueTemplateMappingId: 'map-1',
    });
    expect(body.inputs).not.toHaveProperty('backgroundId');
    expect(body.inputs).not.toHaveProperty('poseIds');
    expect(body.inputs).not.toHaveProperty('lowerCatalogId');
  });
  it('lower-only front: the one photo is sent as both upper and lower', () => {
    const body = buildTryonBody(session({ poses: { a: LOWER_ONLY } }));
    expect(body.inputs.lowerGarmentKey).toBe(body.inputs.upperGarmentKey);
    expect(body.inputs).not.toHaveProperty('lowerCatalogId');
  });
  it('lower-only back: the back photo goes to lowerGarmentBackKey', () => {
    const body = buildTryonBody(
      session({ poses: { a: LOWER_ONLY_BACK }, photos: { upperBack: 'inputs/x/garment.jpg' } }),
    );
    expect(body.inputs.lowerGarmentBackKey).toBe('inputs/x/garment.jpg');
    expect(body.inputs).not.toHaveProperty('lowerGarmentKey');
    expect(body.inputs).not.toHaveProperty('upperGarmentBackKey');
  });
  it('back upper: the back photo goes to upperGarmentBackKey', () => {
    const body = buildTryonBody(
      session({ poses: { a: BACK_UPPER }, photos: { upperBack: 'inputs/y/garment.jpg' } }),
    );
    expect(body.inputs.upperGarmentBackKey).toBe('inputs/y/garment.jpg');
  });
  it('extra uploads map to their slots', () => {
    const gt = { ...GT, requiresLowerUpload: true, requiresThirdUpload: true, allowsFourthUpload: true };
    const body = buildTryonBody(
      session({
        garmentType: gt,
        photos: { lowerFront: 'L', third: 'T', fourth: 'F' },
      }),
    );
    expect(body.inputs).toMatchObject({
      lowerGarmentKey: 'L',
      thirdGarmentKey: 'T',
      fourthGarmentKey: 'F',
    });
  });
});
```

Run: `npx vitest run test/messaging-rules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement the rules**

`apps/api/src/modules/messaging/engine/rules.ts`:

```ts
import type { PhotoSlot, PoseRoles, Session, TryonBody } from './types.js';

// Mirrors studio/page.tsx's slot logic (needsUpperBack, needsLowerBack, lowerOnly,
// lowerOnlyIsBack, effectiveLowerId, effectiveShoesId) so a bot run and a web run
// with the same choices build the same request. Change both together.

type Role = PoseRoles & { poseId: string };

/** Roles of every pose the run will generate. Template looks never carry a
 *  garment view (the templates endpoint doesn't return one — T15), so they
 *  count as front views, exactly as in the studio. */
export function selectedRoles(s: Session): Role[] {
  if (s.mode === 'template') {
    return (s.template?.looks ?? []).map((l) => ({
      poseId: l.poseId,
      hasUpper: l.hasUpper,
      hasLower: l.hasLower,
      hasShoes: l.hasShoes,
      garmentView: 'front' as const,
    }));
  }
  return Object.entries(s.poses).map(([poseId, r]) => ({ poseId, ...r }));
}

export function selectedPoseIds(s: Session): string[] {
  return selectedRoles(s).map((r) => r.poseId);
}

export function imageCount(s: Session): number {
  return selectedRoles(s).length;
}

/** Every pose consumes only a lower garment: the seller's one photo IS the lower. */
export function isLowerOnly(s: Session): boolean {
  if (!s.garmentType || s.garmentType.requiresLowerUpload) return false;
  const roles = selectedRoles(s);
  return roles.length > 0 && roles.every((r) => r.hasLower && r.hasUpper === false);
}

function flags(s: Session) {
  const roles = selectedRoles(s);
  const custom = s.mode === 'custom';
  const lowerOnly = isLowerOnly(s);
  return {
    roles,
    lowerOnly,
    needsUpperBack: custom && roles.some((r) => r.hasUpper && r.garmentView === 'back'),
    lowerOnlyIsBack: lowerOnly && custom && roles.some((r) => r.garmentView === 'back'),
    needsLowerBack:
      custom && roles.some((r) => r.hasLower && r.hasUpper === false && r.garmentView === 'back'),
  };
}

export function requiredPhotoSlots(s: Session): PhotoSlot[] {
  const gt = s.garmentType;
  if (!gt) return [];
  const f = flags(s);
  const slots: PhotoSlot[] = [];
  // A lower-only back pose takes the same single back photo (studio: one box).
  if (f.needsUpperBack || f.lowerOnlyIsBack) slots.push('upperBack');
  if (gt.requiresLowerUpload) slots.push('lowerFront');
  if (f.needsLowerBack && !f.lowerOnly) slots.push('lowerBack');
  if (gt.requiresThirdUpload) slots.push('third');
  if (gt.allowsFourthUpload) slots.push('fourth');
  return slots;
}

export function firstMissingSlot(s: Session): PhotoSlot | null {
  for (const slot of requiredPhotoSlots(s)) {
    if (slot === 'fourth') {
      if (!s.photos.fourth && !s.skippedFourth) return slot;
    } else if (!s.photos[slot]) {
      return slot;
    }
  }
  return null;
}

export function needsLowerPick(s: Session): boolean {
  if (!s.garmentType || s.garmentType.requiresLowerUpload || isLowerOnly(s)) return false;
  return selectedRoles(s).some((r) => r.hasLower);
}

export function needsShoesPick(s: Session): boolean {
  return selectedRoles(s).some((r) => r.hasShoes);
}

export function buildTryonBody(s: Session): TryonBody {
  const gt = s.garmentType;
  if (!gt || !s.garmentKey || !s.faceId) throw new Error('session incomplete');
  const f = flags(s);
  const needsLower = f.roles.some((r) => r.hasLower);
  const needsShoes = f.roles.some((r) => r.hasShoes);

  const lowerCatalogId = f.lowerOnly
    ? undefined
    : s.lowerCatalogId || (needsLower ? (gt.defaultLowerCatalogId ?? undefined) : undefined);
  const shoeCatalogId =
    s.shoeCatalogId || (needsShoes ? (gt.defaultShoeCatalogId ?? undefined) : undefined);
  const lowerGarmentKey = f.lowerOnly
    ? f.lowerOnlyIsBack
      ? undefined
      : s.garmentKey
    : s.photos.lowerFront;
  const lowerGarmentBackKey = f.lowerOnlyIsBack
    ? s.photos.upperBack
    : f.needsLowerBack
      ? s.photos.lowerBack
      : undefined;

  const look =
    s.mode === 'template' && s.template
      ? {
          looks: s.template.looks.map((l) => ({ poseId: l.poseId, backgroundId: l.backgroundId })),
          catalogueTemplateMappingId: s.template.mappingId,
        }
      : { backgroundId: s.backgroundId as string, poseIds: Object.keys(s.poses) };

  const inputs: Record<string, unknown> = {
    upperGarmentKey: s.garmentKey,
    upperGarmentBackKey: f.needsUpperBack ? s.photos.upperBack : undefined,
    faceId: s.faceId,
    garmentTypeId: gt.id,
    ...look,
    lowerCatalogId,
    lowerGarmentKey,
    lowerGarmentBackKey,
    shoeCatalogId,
    thirdGarmentKey: s.photos.third,
    fourthGarmentKey: gt.allowsFourthUpload ? s.photos.fourth : undefined,
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
git commit -m "feat(api): WhatsApp engine slot rules mirroring the studio"
```

---

### Task 3: Engine — menu, global commands and the steps up to the face

**Files:**
- Create: `apps/api/src/modules/messaging/engine/engine.ts`
- Create: `apps/api/test/helpers/engine-fakes.ts`
- Test: `apps/api/test/messaging-engine.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `handle(prev: Session | null, event: InboundEvent, ctx: EngineContext, deps: EngineDeps): Promise<EngineResult>`; `freshSession(userId, deps): Promise<Session>`.

This task writes the whole `engine.ts`; Tasks 4 and 5 add tests for the later steps, which this code already handles. Writing it in one file at once avoids three half-working versions of one state machine. If a Task 4 or 5 test fails, fix `engine.ts` there.

- [ ] **Step 1: Write the fakes**

`apps/api/test/helpers/engine-fakes.ts`:

```ts
import { AppError } from '../../src/lib/errors';
import type {
  EngineContext,
  EngineDeps,
  GarmentTypeOption,
  PoseOption,
  TemplateOption,
  TryonBody,
} from '../../src/modules/messaging/engine/types';

export const CTX: EngineContext = { userId: 'user-1', accountId: 'acct-1', messageId: 'wamid.1' };

export const GT_SHIRT: GarmentTypeOption = {
  id: 'gt-shirt',
  label: 'Shirt',
  requiresLowerUpload: false,
  requiresThirdUpload: false,
  allowsFourthUpload: false,
  upperUploadLabel: 'shirt',
  lowerUploadLabel: null,
  thirdUploadLabel: null,
  fourthUploadLabel: null,
  defaultLowerCatalogId: 'lower-default',
  defaultShoeCatalogId: null,
};

const img = (id: string) => ({ id, label: id, imageUrl: `https://img/${id}.jpg` });

export const POSES: PoseOption[] = [
  { ...img('pose-front'), hasUpper: true, hasLower: true, hasShoes: false, garmentView: 'front' },
  { ...img('pose-back'), hasUpper: true, hasLower: false, hasShoes: false, garmentView: 'back' },
];

export const TEMPLATE: TemplateOption = {
  ...img('tpl-1'),
  mappingId: 'map-1',
  looks: [
    { poseId: 'pose-front', backgroundId: 'bg-1', hasUpper: true, hasLower: false, hasShoes: false },
    { poseId: 'pose-x', backgroundId: 'bg-2', hasUpper: true, hasLower: false, hasShoes: false },
  ],
};

export function fakeDeps(over: Partial<EngineDeps> = {}) {
  let n = 0;
  const calls = { quote: [] as TryonBody[], createRun: [] as TryonBody[] };
  const deps: EngineDeps = {
    newNonce: () => `n${++n}`,
    getUserDefaults: async () => ({ aspectRatio: '1:1', resolution: 'HD' }),
    getBalance: async () => 50,
    listGarmentTypes: async () => [GT_SHIRT],
    listFaces: async () => [img('face-1'), img('face-2')],
    listTemplates: async () => [TEMPLATE],
    listBackgrounds: async () => [img('bg-1')],
    listPoses: async () => POSES,
    getLastPoseIds: async () => [],
    listCatalogItems: async (type) => [img(`${type}-a`)],
    quote: async (_u, body) => {
      calls.quote.push(body);
      const images = body.inputs.looks?.length ?? body.inputs.poseIds?.length ?? 0;
      return { images, perImage: 5, total: images * 5, balance: 50 };
    },
    createRun: async (_ctx, body) => {
      calls.createRun.push(body);
      return { runId: 'run-1', images: body.inputs.looks?.length ?? body.inputs.poseIds?.length ?? 0 };
    },
    runProgress: async () => ({ finished: 1, total: 2 }),
    links: { pricing: 'https://app.test/pricing', help: 'https://app.test/contact-us' },
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
import { decodeReplyId } from '../src/modules/messaging/engine/reply-id';
import { handle } from '../src/modules/messaging/engine/engine';
import type {
  EngineDeps,
  EngineResult,
  InboundEvent,
  OutboundMessage,
} from '../src/modules/messaging/engine/types';
import { CTX, fakeDeps, GT_SHIRT, insufficient } from './helpers/engine-fakes';

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
    const r = await handle(null, { type: 'reply', id: 'old|face|x' }, CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/session expired/);
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('menu and restart always return to the main menu', async () => {
    const { deps } = fakeDeps();
    const deep = await run(deps, [(r) => tap(r, 'menu', 'new')]);
    expect(deep.session.state).toBe('ASK_GENDER');
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
    expect(r.session.state).toBe('ASK_GENDER');
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
    const gender = await handle(menu.session, staleTap, CTX, deps);
    const again = await handle(gender.session, staleTap, CTX, deps);
    expect(texts(again.messages)).toEqual(['That option is from an earlier step.']);
    expect(again.session).toEqual(gender.session);
  });
});

describe('engine: steps up to the face', () => {
  it('walks gender → garment type → shape → photo → face', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [
      (x) => tap(x, 'menu', 'new'),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'gt', 'gt-shirt'),
      (x) => tap(x, 'aspect_keep'),
      () => photo(1),
    ]);
    expect(r.session).toMatchObject({
      state: 'PICK_FACE',
      gender: 'women',
      garmentType: { id: 'gt-shirt' },
      aspectRatio: '1:1',
      garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg',
    });
    expect(r.messages[0]).toMatchObject({ kind: 'cards' });
  });

  it('changing the shape uses the picked ratio', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [
      (x) => tap(x, 'menu', 'new'),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'gt', 'gt-shirt'),
      (x) => tap(x, 'aspect_change'),
      (x) => tap(x, 'aspect', '4:5'),
    ]);
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_PHOTO', aspectRatio: '4:5' });
  });

  it('a photo sent from the main menu skips the photo step later', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [
      () => photo(2),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'gt', 'gt-shirt'),
      (x) => tap(x, 'aspect_keep'),
    ]);
    expect(r.session.state).toBe('PICK_FACE');
    expect(r.session.garmentKey).toContain('000000000002');
  });

  it('text where a tap is expected gets a re-prompt and keeps the step', async () => {
    const { deps } = fakeDeps();
    const at = await run(deps, [(x) => tap(x, 'menu', 'new')]);
    const r = await handle(at.session, { type: 'text', text: 'shirt please' }, CTX, deps);
    expect(texts(r.messages)[0]).toBe('Please use the options above, or type MENU.');
    expect(r.session.state).toBe('ASK_GENDER');
  });

  it('a video at the photo step explains what is accepted', async () => {
    const { deps } = fakeDeps();
    const at = await run(deps, [
      (x) => tap(x, 'menu', 'new'),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'gt', 'gt-shirt'),
      (x) => tap(x, 'aspect_keep'),
    ]);
    const r = await handle(at.session, { type: 'unsupportedMedia' }, CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/JPG or PNG/);
    expect(r.session.state).toBe('ASK_GARMENT_PHOTO');
  });

  it('garment types are paged at 9 rows plus More', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...GT_SHIRT, id: `gt-${i}`, label: `Type ${i}` }));
    const { deps } = fakeDeps({ listGarmentTypes: async () => many });
    const first = await run(deps, [(x) => tap(x, 'menu', 'new'), (x) => tap(x, 'gender', 'women')]);
    const list = first.messages.find((m) => m.kind === 'list');
    expect(list && list.kind === 'list' ? list.rows.length : 0).toBe(10);
    const second = await handle(first.session, tap(first, 'more'), CTX, deps);
    const list2 = second.messages.find((m) => m.kind === 'list');
    expect(list2 && list2.kind === 'list' ? list2.rows.map((r) => r.title) : []).toEqual([
      'Type 9',
      'Type 10',
      'Type 11',
    ]);
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
import {
  buildTryonBody,
  firstMissingSlot,
  imageCount,
  needsLowerPick,
  needsShoesPick,
  selectedPoseIds,
} from './rules.js';
import type {
  AspectRatio,
  Button,
  EngineContext,
  EngineDeps,
  EngineResult,
  Gender,
  ImageOption,
  InboundEvent,
  OutboundMessage,
  Session,
  State,
} from './types.js';

const CARDS_PER_PAGE = 10;
// 9 rows + a "More" row keeps a list inside WhatsApp's 10-row limit.
const ROWS_PER_PAGE = 9;
const GENDERS: Gender[] = ['women', 'men', 'girls', 'boys'];
const ASPECTS: AspectRatio[] = ['1:1', '2:3', '3:4', '4:5'];

type Out = OutboundMessage[];

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
    poses: {},
  };
}

/** Everything chosen for a catalog, cleared; image shape and resolution kept. */
function cleared(s: Session): Session {
  return { v: 1, state: s.state, nonce: s.nonce, page: 0, aspectRatio: s.aspectRatio, resolution: s.resolution, photos: {}, poses: {} };
}

/** The look and everything after it, cleared; garment, photos and face kept. */
function lookCleared(s: Session): Session {
  return {
    ...s,
    mode: undefined,
    template: undefined,
    backgroundId: undefined,
    poses: {},
    lowerCatalogId: undefined,
    shoeCatalogId: undefined,
    lowerDone: undefined,
    shoesDone: undefined,
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

function listMsg(s: Session, body: string, action: string, rows: { value: string; title: string }[]): OutboundMessage {
  const start = s.page * ROWS_PER_PAGE;
  const page = rows.slice(start, start + ROWS_PER_PAGE).map((r) => ({
    id: encodeReplyId(s.nonce, action, r.value),
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
  items: ImageOption[],
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

function nextAfterLook(s: Session): State {
  if (firstMissingSlot(s)) return 'ASK_EXTRA_PHOTO';
  if (needsLowerPick(s) && !s.lowerDone) return 'PICK_LOWER';
  if (needsShoesPick(s) && !s.shoesDone) return 'PICK_SHOES';
  return 'CONFIRM';
}

function summary(s: Session): string {
  const parts = [`${s.garmentType?.label ?? 'Garment'} · ${s.aspectRatio} · ${s.resolution}`];
  if (s.mode === 'template' && s.template) parts.push(`Looks: ${s.template.label}`);
  return COPY.summary(parts);
}

/** Moves to `state` with a fresh nonce and renders its prompt. */
async function enter(s: Session, state: State, out: Out, ctx: EngineContext, deps: EngineDeps): Promise<EngineResult> {
  return render({ ...s, state, nonce: deps.newNonce(), page: 0 }, out, ctx, deps);
}

/** Appends the current step's prompt. May redirect when a step has nothing to ask. */
async function render(s: Session, out: Out, ctx: EngineContext, deps: EngineDeps): Promise<EngineResult> {
  const done = (): EngineResult => ({ session: s, messages: out });
  const gender = s.gender as Gender;
  const gtId = s.garmentType?.id as string;

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

    case 'ASK_GENDER':
      out.push(listMsg(s, COPY.askGender, 'gender', GENDERS.map((g) => ({ value: g, title: COPY.genders[g] }))));
      return done();

    case 'ASK_GARMENT_TYPE': {
      const types = await deps.listGarmentTypes(gender);
      if (types.length === 0) {
        out.push(text(COPY.nothingAvailable));
        return enter(s, 'ASK_GENDER', out, ctx, deps);
      }
      out.push(listMsg(s, COPY.askGarmentType, 'gt', types.map((t) => ({ value: t.id, title: t.label }))));
      return done();
    }

    case 'ASK_ASPECT':
      out.push(
        buttons(s, COPY.askAspect(COPY.aspects[s.aspectRatio]), [
          ['aspect_keep', '', COPY.btnKeepAspect(s.aspectRatio)],
          ['aspect_change', '', COPY.btnChange],
        ]),
      );
      return done();

    case 'PICK_ASPECT':
      out.push(listMsg(s, COPY.pickAspect, 'aspect', ASPECTS.map((a) => ({ value: a, title: COPY.aspects[a] }))));
      return done();

    case 'ASK_GARMENT_PHOTO':
      out.push(text(COPY.askGarmentPhoto(s.garmentType?.upperUploadLabel ?? null)));
      return done();

    case 'PICK_FACE': {
      const faces = await deps.listFaces(gender, gtId);
      if (faces.length === 0) {
        out.push(text(COPY.nothingAvailable));
        return enter(s, 'ASK_GARMENT_TYPE', out, ctx, deps);
      }
      out.push(...cardsMsgs(s, COPY.pickFace, 'face', faces));
      return done();
    }

    case 'PICK_LOOK_MODE': {
      // No template mapped for this garment type: straight to "Create your own".
      const templates = await deps.listTemplates(gender, gtId);
      if (templates.length === 0) return enter({ ...s, mode: 'custom' }, 'PICK_BACKGROUND', out, ctx, deps);
      out.push(
        buttons(s, COPY.pickLookMode, [
          ['mode', 'template', COPY.btnReadyMade],
          ['mode', 'custom', COPY.btnCreateOwn],
        ]),
      );
      return done();
    }

    case 'PICK_TEMPLATE': {
      const templates = await deps.listTemplates(gender, gtId);
      out.push(
        ...cardsMsgs(
          s,
          COPY.pickTemplate,
          'tpl',
          templates.map((t) => ({ ...t, label: COPY.templateTitle(t.label, t.looks.length) })),
        ),
      );
      return done();
    }

    case 'PICK_BACKGROUND': {
      const bgs = await deps.listBackgrounds(gender);
      if (bgs.length === 0) {
        out.push(text(COPY.nothingAvailable));
        return enter(s, 'MAIN_MENU', out, ctx, deps);
      }
      out.push(...cardsMsgs(s, COPY.pickBackground, 'bg', bgs));
      return done();
    }

    case 'PICK_POSES': {
      const poses = await deps.listPoses(gender, gtId);
      if (poses.length === 0) {
        out.push(text(COPY.nothingAvailable));
        return enter(s, 'PICK_LOOK_MODE', out, ctx, deps);
      }
      const n = Object.keys(s.poses).length;
      const extra: [string, string, string][] = [];
      if (n > 0) extra.push(['done', '', COPY.btnDone]);
      if (n === 0 && (await lastPoses(s, ctx, deps, poses.map((p) => p.id))).length > 0) {
        extra.push(['last', '', COPY.btnUseLastPoses]);
      }
      out.push(...cardsMsgs(s, COPY.pickPoses(n), 'pose', poses, extra));
      return done();
    }

    case 'ASK_EXTRA_PHOTO': {
      const slot = firstMissingSlot(s);
      if (!slot) return enter(s, nextAfterLook(s), out, ctx, deps);
      const gt = s.garmentType;
      const label =
        slot === 'upperBack'
          ? (gt?.upperUploadLabel ?? null)
          : slot === 'lowerFront' || slot === 'lowerBack'
            ? (gt?.lowerUploadLabel ?? null)
            : slot === 'third'
              ? (gt?.thirdUploadLabel ?? null)
              : (gt?.fourthUploadLabel ?? null);
      const prompt = COPY.askPhoto[slot](label);
      out.push(slot === 'fourth' ? buttons(s, prompt, [['skip', '', COPY.btnSkip]]) : text(prompt));
      return done();
    }

    case 'PICK_LOWER':
    case 'PICK_SHOES': {
      const type = s.state === 'PICK_LOWER' ? 'lower' : 'shoe';
      const items = await deps.listCatalogItems(type, gender, gtId, selectedPoseIds(s));
      const fallback = type === 'lower' ? s.garmentType?.defaultLowerCatalogId : s.garmentType?.defaultShoeCatalogId;
      const extra: [string, string, string][] = fallback ? [['default', '', COPY.btnUseDefault]] : [];
      if (items.length === 0) {
        // Nothing to pick: the default (or nothing, if the type has none) is used.
        const next = type === 'lower' ? { ...s, lowerCatalogId: null, lowerDone: true } : { ...s, shoeCatalogId: null, shoesDone: true };
        return enter(next, nextAfterLook(next), out, ctx, deps);
      }
      out.push(...cardsMsgs(s, type === 'lower' ? COPY.pickLower : COPY.pickShoes, 'item', items, extra));
      return done();
    }

    case 'CONFIRM': {
      try {
        const q = await deps.quote(ctx.userId, buildTryonBody(s));
        out.push(
          buttons(s, COPY.confirm(q, summary(s)), [
            ['generate', '', COPY.btnGenerate],
            ['restart', '', COPY.btnStartOver],
          ]),
        );
      } catch (err) {
        // Anything createJob would reject (an asset deactivated mid-wizard, a
        // misconfigured pose) surfaces here, before any credits are taken.
        if (!(err instanceof AppError)) throw err;
        out.push(text(err.message));
        out.push(buttons(s, COPY.menu, [['restart', '', COPY.btnStartOver]]));
      }
      return done();
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
      items.push(['more_looks', '', COPY.btnMoreLooks]);
      items.push(failed > 0 ? ['menu', 'menu', COPY.btnMenu] : ['menu', 'new', COPY.btnNewCatalog]);
      out.push(buttons(s, COPY.delivered, items));
      return done();
    }
  }
}

async function lastPoses(s: Session, ctx: EngineContext, deps: EngineDeps, available: string[]): Promise<string[]> {
  const last = await deps.getLastPoseIds(ctx.userId, s.gender as Gender, s.garmentType?.id as string);
  const ok = new Set(available);
  // A last-used pose an admin has since hidden is silently dropped, as on the web.
  return last.filter((id) => ok.has(id));
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
    if (value === 'new') return enter(cleared(s), 'ASK_GENDER', out, ctx, deps);
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

  const gender = s.gender as Gender;
  const gtId = s.garmentType?.id as string;

  switch (s.state) {
    case 'ASK_GENDER':
      if (action !== 'gender' || !GENDERS.includes(value as Gender)) return reprompt();
      return enter({ ...s, gender: value as Gender }, 'ASK_GARMENT_TYPE', out, ctx, deps);

    case 'ASK_GARMENT_TYPE': {
      const gt = (await deps.listGarmentTypes(gender)).find((t) => t.id === value);
      if (action !== 'gt' || !gt) return reprompt();
      return enter({ ...s, garmentType: gt }, 'ASK_ASPECT', out, ctx, deps);
    }

    case 'ASK_ASPECT':
      if (action === 'aspect_change') return enter(s, 'PICK_ASPECT', out, ctx, deps);
      if (action !== 'aspect_keep') return reprompt();
      return enter(s, s.garmentKey ? 'PICK_FACE' : 'ASK_GARMENT_PHOTO', out, ctx, deps);

    case 'PICK_ASPECT':
      if (action !== 'aspect' || !ASPECTS.includes(value as AspectRatio)) return reprompt();
      return enter(
        { ...s, aspectRatio: value as AspectRatio },
        s.garmentKey ? 'PICK_FACE' : 'ASK_GARMENT_PHOTO',
        out,
        ctx,
        deps,
      );

    case 'PICK_FACE': {
      const face = (await deps.listFaces(gender, gtId)).find((f) => f.id === value);
      if (action !== 'face' || !face) return reprompt();
      return enter({ ...s, faceId: face.id }, 'PICK_LOOK_MODE', out, ctx, deps);
    }

    case 'PICK_LOOK_MODE':
      if (action === 'mode' && value === 'template') return enter(s, 'PICK_TEMPLATE', out, ctx, deps);
      if (action === 'mode' && value === 'custom') return enter({ ...s, mode: 'custom' }, 'PICK_BACKGROUND', out, ctx, deps);
      return reprompt();

    case 'PICK_TEMPLATE': {
      const t = (await deps.listTemplates(gender, gtId)).find((x) => x.id === value);
      if (action !== 'tpl' || !t) return reprompt();
      const next: Session = {
        ...s,
        mode: 'template',
        template: { id: t.id, label: t.label, mappingId: t.mappingId, looks: t.looks },
        backgroundId: undefined,
        poses: {},
      };
      return enter(next, nextAfterLook(next), out, ctx, deps);
    }

    case 'PICK_BACKGROUND': {
      const bg = (await deps.listBackgrounds(gender)).find((b) => b.id === value);
      if (action !== 'bg' || !bg) return reprompt();
      return enter({ ...s, backgroundId: bg.id, poses: {} }, 'PICK_POSES', out, ctx, deps);
    }

    case 'PICK_POSES': {
      const poses = await deps.listPoses(gender, gtId);
      if (action === 'pose') {
        const p = poses.find((x) => x.id === value);
        if (!p) return reprompt();
        if (s.poses[p.id]) {
          out.push(text(COPY.poseAlreadyAdded));
          return { session: s, messages: out };
        }
        const next: Session = {
          ...s,
          poses: { ...s.poses, [p.id]: { hasUpper: p.hasUpper, hasLower: p.hasLower, hasShoes: p.hasShoes, garmentView: p.garmentView } },
        };
        const n = Object.keys(next.poses).length;
        // Not a re-render: re-sending the whole carousel after every tap would
        // bury the chat. One short message with Done is enough.
        out.push(buttons(next, COPY.poseAdded(n), [['done', '', COPY.btnDone]]));
        return { session: next, messages: out };
      }
      if (action === 'last') {
        const ids = await lastPoses(s, ctx, deps, poses.map((p) => p.id));
        if (ids.length === 0) return reprompt();
        const byId = new Map(poses.map((p) => [p.id, p]));
        const picked: Session['poses'] = {};
        for (const id of ids) {
          const p = byId.get(id);
          if (p) picked[id] = { hasUpper: p.hasUpper, hasLower: p.hasLower, hasShoes: p.hasShoes, garmentView: p.garmentView };
        }
        const next = { ...s, poses: picked };
        return enter(next, nextAfterLook(next), out, ctx, deps);
      }
      if (action === 'done' && Object.keys(s.poses).length > 0) return enter(s, nextAfterLook(s), out, ctx, deps);
      return reprompt();
    }

    case 'ASK_EXTRA_PHOTO':
      if (action === 'skip' && firstMissingSlot(s) === 'fourth') {
        const next = { ...s, skippedFourth: true };
        return enter(next, nextAfterLook(next), out, ctx, deps);
      }
      return reprompt();

    case 'PICK_LOWER':
    case 'PICK_SHOES': {
      const isLower = s.state === 'PICK_LOWER';
      let chosen: string | null;
      if (action === 'default') chosen = null;
      else if (action === 'item') {
        const items = await deps.listCatalogItems(isLower ? 'lower' : 'shoe', gender, gtId, selectedPoseIds(s));
        if (!items.some((i) => i.id === value)) return reprompt();
        chosen = value;
      } else return reprompt();
      const next: Session = isLower
        ? { ...s, lowerCatalogId: chosen, lowerDone: true }
        : { ...s, shoeCatalogId: chosen, shoesDone: true };
      return enter(next, nextAfterLook(next), out, ctx, deps);
    }

    case 'CONFIRM': {
      if (action !== 'generate') return reprompt();
      try {
        const { runId, images } = await deps.createRun(ctx, buildTryonBody(s));
        out.push(text(COPY.generating(images)));
        return { session: { ...s, state: 'GENERATING', nonce: deps.newNonce(), page: 0, runId, runImages: images }, messages: out };
      } catch (err) {
        if (err instanceof AppError && err.code === 'INSUFFICIENT_CREDITS') return enter(s, 'NO_CREDITS', out, ctx, deps);
        if (!(err instanceof AppError)) throw err;
        out.push(text(err.message));
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      }
    }

    case 'DELIVERED': {
      if (action === 'more_looks') return enter(lookCleared(s), 'PICK_LOOK_MODE', out, ctx, deps);
      if (action === 'retry') {
        const failed = new Set(s.failedPoseIds ?? []);
        if (failed.size === 0) return reprompt();
        // Same choices, only the poses that failed. The dispatcher already
        // refunded them, so this is a fresh, priced run.
        const next: Session =
          s.mode === 'template' && s.template
            ? { ...s, template: { ...s.template, looks: s.template.looks.filter((l) => failed.has(l.poseId)) } }
            : { ...s, poses: Object.fromEntries(Object.entries(s.poses).filter(([id]) => failed.has(id))) };
        return enter({ ...next, runId: undefined, failedPoseIds: undefined }, 'CONFIRM', out, ctx, deps);
      }
      return reprompt();
    }

    default:
      return reprompt();
  }
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
      if (s.state === 'MAIN_MENU') {
        return enter({ ...cleared(s), garmentKey: event.garmentKey }, 'ASK_GENDER', out, ctx, deps);
      }
      if (s.state === 'ASK_GARMENT_PHOTO') {
        return enter({ ...s, garmentKey: event.garmentKey }, 'PICK_FACE', out, ctx, deps);
      }
      if (s.state === 'ASK_EXTRA_PHOTO') {
        const slot = firstMissingSlot(s);
        if (slot) {
          const next = { ...s, photos: { ...s.photos, [slot]: event.garmentKey } };
          return enter(next, nextAfterLook(next), out, ctx, deps);
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
      // A run from an older session (the seller restarted meanwhile) still gets
      // its images (plan 3 sends them by run, not by session), but no buttons here.
      if (s.runId !== event.runId) return { session: s, messages: out };
      if (event.failedPoseIds.length > 0) out.push(text(COPY.partlyFailed(event.failedPoseIds.length, event.images)));
      return enter({ ...s, failedPoseIds: event.failedPoseIds }, 'DELIVERED', out, ctx, deps);
    }

    case 'creditsAdded':
      out.push(text(COPY.creditsAdded(event.credits)));
      if (s.state === 'NO_CREDITS') return enter(s, 'CONFIRM', out, ctx, deps);
      return { session: s, messages: out };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/messaging-engine.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Lint, typecheck and commit**

Run: `pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint`
Expected: exit 0. Biome may reformat long lines in `engine.ts`; run `pnpm --filter @aivastra/api exec biome check --write src/modules/messaging test/messaging-*.test.ts test/helpers/engine-fakes.ts` and re-run the tests.

```bash
git add apps/api/src/modules/messaging/engine/engine.ts apps/api/test/helpers/engine-fakes.ts apps/api/test/messaging-engine.test.ts
git commit -m "feat(api): WhatsApp conversation engine"
```

---

### Task 4: Engine tests — looks, extra photos, lower and shoes

**Files:**
- Modify: `apps/api/test/messaging-engine.test.ts` (append)
- Modify (only if a test fails): `apps/api/src/modules/messaging/engine/engine.ts`

- [ ] **Step 1: Append the tests**

```ts
async function atFace(deps: EngineDeps) {
  return run(deps, [
    (x) => tap(x, 'menu', 'new'),
    (x) => tap(x, 'gender', 'women'),
    (x) => tap(x, 'gt', 'gt-shirt'),
    (x) => tap(x, 'aspect_keep'),
    () => photo(1),
    (x) => tap(x, 'face', 'face-1'),
  ]);
}

describe('engine: looks', () => {
  it('a template goes straight to confirm with all of its looks (D24)', async () => {
    const { deps, calls } = fakeDeps();
    const at = await atFace(deps);
    expect(at.session.state).toBe('PICK_LOOK_MODE');
    const r = await run(deps, [(x) => tap(x, 'mode', 'template'), (x) => tap(x, 'tpl', 'tpl-1')], at);
    expect(r.session.state).toBe('CONFIRM');
    expect(calls.quote.at(-1)?.inputs).toMatchObject({
      looks: [
        { poseId: 'pose-front', backgroundId: 'bg-1' },
        { poseId: 'pose-x', backgroundId: 'bg-2' },
      ],
      catalogueTemplateMappingId: 'map-1',
    });
  });

  it('no templates for the garment type skips straight to backgrounds', async () => {
    const { deps } = fakeDeps({ listTemplates: async () => [] });
    const at = await atFace(deps);
    expect(at.session).toMatchObject({ state: 'PICK_BACKGROUND', mode: 'custom' });
  });

  it('custom: tap poses to add, Done moves on, a second tap does not duplicate', async () => {
    const { deps } = fakeDeps();
    const at = await atFace(deps);
    const bg = await run(deps, [(x) => tap(x, 'mode', 'custom'), (x) => tap(x, 'bg', 'bg-1')], at);
    expect(bg.session.state).toBe('PICK_POSES');
    const one = await handle(bg.session, tap(bg, 'pose', 'pose-front'), CTX, deps);
    expect(texts(one.messages)[0]).toBe('Added. 1 selected.');
    const dup = await handle(one.session, tap(bg, 'pose', 'pose-front'), CTX, deps);
    expect(texts(dup.messages)).toEqual(['That pose is already added.']);
    const done = await handle(dup.session, tap(one, 'done'), CTX, deps);
    // pose-front has a lower slot and the garment type has no lower upload → lower step.
    expect(done.session.state).toBe('PICK_LOWER');
  });

  it('"Use my last poses" appears only when last-used poses are still available', async () => {
    const { deps } = fakeDeps({ getLastPoseIds: async () => ['pose-back', 'pose-gone'] });
    const at = await atFace(deps);
    const bg = await run(deps, [(x) => tap(x, 'mode', 'custom'), (x) => tap(x, 'bg', 'bg-1')], at);
    const r = await handle(bg.session, tap(bg, 'last'), CTX, deps);
    expect(Object.keys(r.session.poses)).toEqual(['pose-back']);
    // pose-back is a back view → the back photo is asked next (D22).
    expect(r.session.state).toBe('ASK_EXTRA_PHOTO');
    expect(texts(r.messages)[0]).toBe('Now send a photo of the back of the shirt.');
  });

  it('a back photo fills its slot and moves on', async () => {
    const { deps, calls } = fakeDeps({ getLastPoseIds: async () => ['pose-back'] });
    const at = await atFace(deps);
    const r = await run(
      deps,
      [(x) => tap(x, 'mode', 'custom'), (x) => tap(x, 'bg', 'bg-1'), (x) => tap(x, 'last'), () => photo(3)],
      at,
    );
    expect(r.session.state).toBe('CONFIRM');
    expect(calls.quote.at(-1)?.inputs.upperGarmentBackKey).toContain('000000000003');
  });

  it('an optional fourth photo can be skipped', async () => {
    const { deps } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, allowsFourthUpload: true, fourthUploadLabel: 'blouse' }],
      listTemplates: async () => [],
    });
    const at = await atFace(deps);
    const r = await run(deps, [(x) => tap(x, 'bg', 'bg-1'), (x) => tap(x, 'pose', 'pose-front'), (x) => tap(x, 'done')], at);
    expect(texts(r.messages)[0]).toBe('Optional: send a photo of the blouse, or tap Skip.');
    const skipped = await handle(r.session, tap(r, 'skip'), CTX, deps);
    expect(skipped.session.skippedFourth).toBe(true);
    // pose-front has a lower slot and the type has a default → the lower step is next.
    expect(skipped.session.state).toBe('PICK_LOWER');
  });

  it('lower: pick an item, or Use default when the type has one', async () => {
    const { deps, calls } = fakeDeps();
    const at = await atFace(deps);
    const lower = await run(
      deps,
      [(x) => tap(x, 'mode', 'custom'), (x) => tap(x, 'bg', 'bg-1'), (x) => tap(x, 'pose', 'pose-front'), (x) => tap(x, 'done')],
      at,
    );
    const picked = await handle(lower.session, tap(lower, 'item', 'lower-a'), CTX, deps);
    expect(picked.session.state).toBe('CONFIRM');
    expect(calls.quote.at(-1)?.inputs.lowerCatalogId).toBe('lower-a');

    const byDefault = await handle(lower.session, tap(lower, 'default'), CTX, deps);
    expect(byDefault.session.state).toBe('CONFIRM');
    expect(calls.quote.at(-1)?.inputs.lowerCatalogId).toBe('lower-default');
  });

  it('a garment type without a default offers no Use default', async () => {
    const { deps } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, defaultLowerCatalogId: null }],
    });
    const at = await atFace(deps);
    const lower = await run(
      deps,
      [(x) => tap(x, 'mode', 'custom'), (x) => tap(x, 'bg', 'bg-1'), (x) => tap(x, 'pose', 'pose-front'), (x) => tap(x, 'done')],
      at,
    );
    expect(() => tap(lower, 'default')).toThrow();
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run test/messaging-engine.test.ts`
Expected: PASS, 20 tests. Fix `engine.ts` (not the tests) if a transition disagrees with spec section 8.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/messaging-engine.test.ts apps/api/src/modules/messaging/engine/engine.ts
git commit -m "test(api): WhatsApp engine look, photo, lower and shoe steps"
```

---

### Task 5: Engine tests — confirm, generate, credits and delivery

**Files:**
- Modify: `apps/api/test/messaging-engine.test.ts` (append)
- Modify (only if a test fails): `apps/api/src/modules/messaging/engine/engine.ts`

- [ ] **Step 1: Append the tests**

```ts
async function atConfirm(deps: EngineDeps) {
  const at = await atFace(deps);
  return run(deps, [(x) => tap(x, 'mode', 'template'), (x) => tap(x, 'tpl', 'tpl-1')], at);
}

describe('engine: confirm and generate', () => {
  it('confirm shows image count, cost and balance', async () => {
    const { deps } = fakeDeps();
    const r = await atConfirm(deps);
    expect(r.messages.at(-1)).toMatchObject({ kind: 'buttons' });
    expect(texts(r.messages).at(-1)).toContain('2 images, uses 10 credits. Your balance: 50.');
  });

  it('a quote error is shown before any credits are taken', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps } = fakeDeps({
      quote: async () => {
        throw new AppError('VALIDATION', 400, 'face not found or inactive');
      },
    });
    const r = await atConfirm(deps);
    expect(texts(r.messages)).toContain('face not found or inactive');
  });

  it('generate creates one run with the confirmed body', async () => {
    const { deps, calls } = fakeDeps();
    const at = await atConfirm(deps);
    const r = await handle(at.session, tap(at, 'generate'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'GENERATING', runId: 'run-1', runImages: 2 });
    expect(calls.createRun).toHaveLength(1);
    expect(calls.createRun[0]).toEqual(calls.quote.at(-1));
    expect(texts(r.messages)[0]).toBe("Working on 2 images. I'll send each one here as it's ready.");
  });

  it('short of credits → NO_CREDITS, then creditsAdded returns to confirm', async () => {
    const { deps } = fakeDeps({ createRun: async () => { throw insufficient(); } });
    const at = await atConfirm(deps);
    const r = await handle(at.session, tap(at, 'generate'), CTX, deps);
    expect(r.session.state).toBe('NO_CREDITS');
    expect(texts(r.messages)[0]).toContain('https://app.test/pricing');
    const back = await handle(r.session, { type: 'creditsAdded', credits: 100 }, CTX, deps);
    expect(texts(back.messages)[0]).toBe('100 credits added.');
    expect(back.session.state).toBe('CONFIRM');
  });

  it('messages while generating report progress', async () => {
    const { deps } = fakeDeps();
    const at = await atConfirm(deps);
    const gen = await handle(at.session, tap(at, 'generate'), CTX, deps);
    const r = await handle(gen.session, { type: 'text', text: 'done yet?' }, CTX, deps);
    expect(texts(r.messages)).toEqual(['Still generating: 1 of 2 done.']);
  });
});

describe('engine: delivery', () => {
  async function generated(deps: EngineDeps) {
    const at = await atConfirm(deps);
    return handle(at.session, tap(at, 'generate'), CTX, deps);
  }

  it('runFinished with no failures offers more looks and a new catalog', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(gen.session, { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] }, CTX, deps);
    expect(r.session.state).toBe('DELIVERED');
    const btns = r.messages.at(-1);
    expect(btns && btns.kind === 'buttons' ? btns.buttons.map((b) => b.title) : []).toEqual(['More looks', 'New catalog']);
  });

  it('a runFinished for an older run changes nothing', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(gen.session, { type: 'runFinished', runId: 'other', images: 2, failedPoseIds: [] }, CTX, deps);
    expect(r).toEqual({ session: gen.session, messages: [] });
  });

  it('partial failure reports the refund and retries only the failed looks', async () => {
    const { deps, calls } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(gen.session, { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: ['pose-x'] }, CTX, deps);
    expect(texts(r.messages)[0]).toBe('1 of 2 images failed. The credits for it were refunded.');
    const retry = await handle(r.session, tap(r, 'retry'), CTX, deps);
    expect(retry.session.state).toBe('CONFIRM');
    expect(calls.quote.at(-1)?.inputs.looks).toEqual([{ poseId: 'pose-x', backgroundId: 'bg-2' }]);
  });

  it('More looks keeps the garment and face', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const done = await handle(gen.session, { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] }, CTX, deps);
    const r = await handle(done.session, tap(done, 'more_looks'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'PICK_LOOK_MODE', faceId: 'face-1' });
    expect(r.session.garmentKey).toContain('000000000001');
    expect(r.session.template).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run test/messaging-engine.test.ts`
Expected: PASS, 29 tests.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/messaging-engine.test.ts apps/api/src/modules/messaging/engine/engine.ts
git commit -m "test(api): WhatsApp engine confirm, credits and delivery steps"
```

---

### Task 6: Extract the studio's option queries

A behaviour-preserving refactor: the bot must offer exactly what the studio offers, so the queries move into functions both call. **No logic changes.** Existing integration tests are the safety net.

**Files:**
- Create: `apps/api/src/modules/models/queries.ts`
- Modify: `apps/api/src/modules/models/routes.ts`
- Create: `apps/api/src/modules/catalog/queries.ts`
- Modify: `apps/api/src/modules/catalog/routes.ts`

**Interfaces:**
- Produces:
  - `listGarmentTypes(app, gender: string)` → `{ items }` (current `/v1/models/garment-types` response)
  - `listFaces(app, q: { gender: string; garmentTypeId?: string })` → `{ items }`
  - `listBackgrounds(app, q: { gender?: string })` → `{ items }`
  - `listPoses(app, q: { gender: string; garmentTypeId?: string })` → `{ items }`
  - `listCatalogueTemplates(app, q: { gender: string; garmentTypeId?: string })` → `{ items }`
  - `listCatalogTree(app, type: string, q: { gender?: string; poseIds?: string; garmentTypeId?: string })` → `{ type, tree }`

- [ ] **Step 1: Record the baseline**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts catalogue-templates-public catalog garment-type poses faces backgrounds`
Write down the pass count. (The filter matches existing files such as `catalogue-templates-public.test.ts`, `catalog.test.ts`, `catalog-accessory.test.ts`, `garment-type-third-upload.test.ts`; that is fine.)

- [ ] **Step 2: Move each handler body into `models/queries.ts`**

Create `apps/api/src/modules/models/queries.ts` with the imports `routes.ts` uses for these handlers (`schema` from `@aivastra/db`; `and, asc, eq, inArray, isNull, or` from `drizzle-orm`; `FastifyInstance`; `poseGarmentRoles` from `./garment-roles.js`).

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

export async function listBackgrounds(app: FastifyInstance, { gender }: { gender?: string }) {
  // body of GET /v1/models/backgrounds, minus its req.query line
}

export async function listPoses(
  app: FastifyInstance,
  { gender, garmentTypeId }: { gender: string; garmentTypeId?: string },
) {
  // body of GET /v1/models/poses, minus its req.query line
}

export async function listCatalogueTemplates(
  app: FastifyInstance,
  { gender, garmentTypeId }: { gender: string; garmentTypeId?: string },
) {
  // body of GET /v1/models/catalogue-templates, minus its req.query line
}
```

Then each handler in `routes.ts` becomes a one-liner, for example:

```ts
    async (req) => listFaces(app, req.query as { gender: string; garmentTypeId?: string }),
```

```ts
    async (req) => listGarmentTypes(app, (req.query as { gender: string }).gender),
```

Import the five functions at the top of `routes.ts` and delete imports that are now unused there (Biome will flag them).

- [ ] **Step 3: Same for the catalog tree**

Create `apps/api/src/modules/catalog/queries.ts` with `listCatalogTree(app, type, { gender, poseIds, garmentTypeId })` containing the body of `GET /v1/catalog/:type` unchanged (minus its `req.params` / `req.query` lines). Move the helpers it uses (`buildTree` import, `resolveCategoryThumbUrls` if defined in `routes.ts`) with it, or import them. The handler becomes:

```ts
    async (req) =>
      listCatalogTree(
        app,
        (req.params as { type: string }).type,
        req.query as { gender?: string; poseIds?: string; garmentTypeId?: string },
      ),
```

- [ ] **Step 4: Prove nothing changed**

Run the Step 1 command again.
Expected: the same pass count. Then `pnpm --filter @aivastra/api test && pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint`, all green.

`git diff --stat` should show `routes.ts` files shrinking by about as many lines as `queries.ts` files gained. If any query text changed, revert that part.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/models/queries.ts apps/api/src/modules/models/routes.ts apps/api/src/modules/catalog/queries.ts apps/api/src/modules/catalog/routes.ts
git commit -m "refactor(api): extract model and catalog option queries for reuse by the WhatsApp bot"
```

---

### Task 7: Runs table, real deps, photo storage, session store and the conversation entry point

**Files:**
- Modify: `packages/db/src/schema/messaging.ts` (add `messagingRuns`)
- Generated: `packages/db/src/migrations/0225_*.sql` + `meta/`
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

Append to `packages/db/src/schema/messaging.ts` (add `index` is already imported; also import `jobs`? No — `job_ids` is a plain array, see the comment):

```ts
// One row per create call made from a chat (D34). A run is one catalogueId:
// every job createJob makes in one call shares it. Plan 3's notifier finds a
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
Expected: `0225_<name>.sql` with exactly one `CREATE TABLE "messaging_runs"`, two FKs with `ON DELETE cascade`, one index.

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
 * (keyed on the Meta message id of the Generate tap, so a redelivered webhook
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
    // A replayed Generate returns the same catalogueId from the idempotency cache.
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

Before running: open `apps/api/src/modules/jobs/create.ts` and confirm `updateLastUsedPosePreset`'s parameter order matches the route's call at `jobs/routes.ts:135-141` (`app, userId, gender, garmentTypeId, poseIds`), and that terminal job statuses are spelled `COMPLETED` / `FAILED` (search `status:` in `packages/db/src/schema/jobs.ts`). Adjust if they differ; add any other terminal status (for example a cancelled state) to the `or(…)`.

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
 * key shape the presign route issues (INPUT_GARMENT_KEY), the same
 * upload:owner binding, so createJob accepts it unchanged and the sweeper
 * removes it if the seller never generates. Size limits are enforced later by
 * createJob's own check (assertGarmentObjectValid), as for the web.
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

Check `@aivastra/storage` exports `keys` (it does per CLAUDE.md) and that `keys.inputGarment` produces `inputs/<uuid>/garment.jpg`.

- [ ] **Step 4: Write `deps.ts`**

`apps/api/src/modules/messaging/deps.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { listCatalogTree } from '../catalog/queries.js';
import {
  listBackgrounds,
  listCatalogueTemplates,
  listFaces,
  listGarmentTypes,
  listPoses,
} from '../models/queries.js';
import type {
  AspectRatio,
  EngineDeps,
  GarmentTypeOption,
  ImageOption,
  Resolution,
} from './engine/types.js';
import { createRun, quoteRun, runProgress } from './runs.js';

const ASPECTS = new Set(['1:1', '2:3', '3:4', '4:5']);
const RESOLUTIONS = new Set(['HD', '2K', '4K']);

type TreeNode = {
  items?: { id: string; label: string; thumbnailUrl: string }[];
  children?: TreeNode[];
};

function flatten(nodes: TreeNode[]): ImageOption[] {
  const out: ImageOption[] = [];
  for (const n of nodes) {
    for (const i of n.items ?? []) out.push({ id: i.id, label: i.label, imageUrl: i.thumbnailUrl });
    out.push(...flatten(n.children ?? []));
  }
  return out;
}

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
      // D16/D31: the two-step saree flow is not in the bot.
      return items
        .filter((i) => !i.requiresMannequinStep)
        .map(
          (i): GarmentTypeOption => ({
            id: i.id,
            label: i.label,
            requiresLowerUpload: i.requiresLowerUpload,
            requiresThirdUpload: i.requiresThirdUpload,
            allowsFourthUpload: i.allowsFourthUpload,
            upperUploadLabel: i.upperUploadLabel,
            lowerUploadLabel: i.lowerUploadLabel,
            thirdUploadLabel: i.thirdUploadLabel,
            fourthUploadLabel: i.fourthUploadLabel,
            defaultLowerCatalogId: i.defaultLowerCatalogId,
            defaultShoeCatalogId: i.defaultShoeCatalogId,
          }),
        );
    },

    async listFaces(gender, garmentTypeId) {
      const { items } = await listFaces(app, { gender, garmentTypeId });
      return items.map((i) => ({ id: i.id, label: i.label, imageUrl: i.thumbnailUrl }));
    },

    async listTemplates(gender, garmentTypeId) {
      const { items } = await listCatalogueTemplates(app, { gender, garmentTypeId });
      return items.map((t) => ({
        id: t.id,
        label: t.label,
        imageUrl: t.thumbnailUrl ?? '',
        mappingId: t.mappingId,
        looks: t.looks.map((l) => ({
          poseId: l.poseId,
          backgroundId: l.backgroundId,
          hasUpper: l.hasUpper,
          hasLower: l.hasLower,
          hasShoes: l.hasShoes,
        })),
      }));
    },

    async listBackgrounds(gender) {
      const { items } = await listBackgrounds(app, { gender });
      return items.map((i) => ({ id: i.id, label: i.label, imageUrl: i.thumbnailUrl }));
    },

    async listPoses(gender, garmentTypeId) {
      const { items } = await listPoses(app, { gender, garmentTypeId });
      return items.map((p) => ({
        id: p.id,
        label: p.label,
        imageUrl: p.thumbnailUrl,
        hasUpper: p.hasUpper,
        hasLower: p.hasLower,
        hasShoes: p.hasShoes,
        garmentView: p.garmentView === 'back' ? 'back' : 'front',
      }));
    },

    async getLastPoseIds(userId, gender, garmentTypeId) {
      const [row] = await app.db
        .select({ poseIds: schema.userPosePresets.poseIds })
        .from(schema.userPosePresets)
        .where(
          and(
            eq(schema.userPosePresets.userId, userId),
            eq(schema.userPosePresets.gender, gender),
            eq(schema.userPosePresets.garmentTypeId, garmentTypeId),
            eq(schema.userPosePresets.isLastUsed, true),
          ),
        );
      return row?.poseIds ?? [];
    },

    async listCatalogItems(type, gender, garmentTypeId, poseIds) {
      const res = (await listCatalogTree(app, type, {
        gender,
        garmentTypeId,
        poseIds: poseIds.join(','),
      })) as { tree: TreeNode[] };
      return flatten(res.tree);
    },

    quote: (userId, body) => quoteRun(app, userId, body),
    createRun: (ctx, body) => createRun(app, ctx, body),
    runProgress: (runId) => runProgress(app, runId),
    links: { pricing: `${web}/pricing`, help: `${web}/contact-us` },
  };
}
```

If TypeScript reports a field that does not exist on a query's item type (for example `label` on catalog items), read the query in `queries.ts` and map the real field name — the query is the source of truth.

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
 * session.
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

`apps/api/test/integration/messaging-conversation.test.ts` drives the **real** deps end to end: seeded catalog → template run through `createJob`, plus the quote/charge parity check. Reuse the seeding helpers from `apps/api/test/integration/jobs-back-garment-view.test.ts` (`seedWorkflow`, `seedPose`, credit plan, resolution tier). Read that file's remaining helpers (after line 120) and its `beforeAll` first, and copy the minimum needed to create one face, one background, one pose with a front workflow mapped to one garment type, and one catalogue template + mapping + pose workflow for that type.

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAccount, CHANNEL_WHATSAPP } from '../../src/modules/messaging/identity';
import { runConversation } from '../../src/modules/messaging/conversation';
import { createEngineDeps } from '../../src/modules/messaging/deps';
import { decodeReplyId } from '../../src/modules/messaging/engine/reply-id';
import type { InboundEvent, OutboundMessage } from '../../src/modules/messaging/engine/types';
import { buildTryonBody } from '../../src/modules/messaging/engine/rules';
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
  // Fill in from your seeding: ids the steps below tap.
  let seeded: { garmentTypeId: string; faceId: string; templateId: string };

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { MESSAGING_WHATSAPP_ENABLED: true });
    realHeadObject = app.storage.headObject.bind(app.storage);
    // seed: one 'women' garment type (no mannequin step), one face, one
    // background, one front pose + workflow + pose_garment_configs row for the
    // type, one catalogue template with that pose/background as its single look,
    // its catalogue_template_subcategories mapping and catalogue_template_pose_workflows
    // row, an enabled HD resolution tier with creditCost 5, and a credit plan.
    // Assign seeded = { garmentTypeId, faceId, templateId }.
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

  // A connected seller with 100 credits, walked to CONFIRM on the seeded template.
  async function walkToConfirm(tag: string) {
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
    msgs = await send(tapIn(msgs, 'aspect_keep'));
    msgs = await send(tapIn(msgs, 'face', seeded.faceId));
    msgs = await send(tapIn(msgs, 'mode', 'template'));
    msgs = await send(tapIn(msgs, 'tpl', seeded.templateId));
    return { userId, account, acct, send, msgs };
  }

  const balanceOf = async (userId: string) =>
    (
      await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId))
    )[0]?.balance;

  it('photo → template → generate creates one charged job and records the run', async () => {
    const w = await walkToConfirm('conv');
    const { userId, account, acct, send } = w;
    let msgs = w.msgs;
    const confirm = msgs.at(-1);
    expect(confirm && 'text' in confirm ? confirm.text : '').toContain('1 image, uses 5 credits. Your balance: 100.');

    msgs = await send(tapIn(msgs, 'generate'));
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

  it('the same Generate message id never creates a second run', async () => {
    const { userId, account, acct } = await walkToConfirm('dup');
    const session = await loadSession(app.redis, acct.channel, acct.externalId);
    if (!session) throw new Error('no session');
    // Straight at createRun: after one Generate the session's nonce changes, so a
    // redelivered tap is already stale in the engine. This checks the second
    // guard — the idempotency key — that protects a crash between createJob and
    // the session save.
    const ctx = { userId, accountId: account.id, messageId: 'wamid.dup' };
    const body = buildTryonBody(session);
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

The seeding in `beforeAll` is the one step written as instructions rather than code: the catalogue-template tables (`catalogue_templates`, `catalogue_template_looks`, `catalogue_template_subcategories`, `catalogue_template_pose_workflows`) and the resolution-tier config were not read while writing this plan. Seed them by following `apps/api/test/integration/catalogue-templates-public.test.ts` (template side) and `jobs-back-garment-view.test.ts` (pose, workflow, credit plan, tier) rather than guessing column names.

- [ ] **Step 7: Run it**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts messaging-conversation`
Expected: PASS, 2 tests. Then the full unit suite, typecheck and lint as in Task 6 Step 4.

If `createJob` fails on queue capacity (`assertQueueCapacity`), read how `jobs-back-garment-view.test.ts` satisfies it (worker registry seeding or an env override) and do the same.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/messaging.ts packages/db/src/migrations apps/api/src/modules/messaging apps/api/test/integration/messaging-conversation.test.ts
git commit -m "feat(api): WhatsApp runs table, real engine deps and conversation entry point"
```

---

### Task 8: Record the decisions and progress

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md`
- Modify: `docs/progress.md`

- [ ] **Step 1: Update the spec**

Add to the section 3 table:

```
| D33 | Engine purity | Deterministic, not pure: `handle(session, event, ctx, deps)` awaits an injected `EngineDeps` for option lists and side effects but does no I/O of its own and takes randomness from `deps`. Tested with in-memory fakes. |
| D34 | Run tracking | A `messaging_runs` table (one row per create call, keyed by `catalogue_id`, with the account and job ids), not `job_inputs.params.channel`: the create request strips unknown params keys, and params feed the workflow. |
| D35 | Image shape, not platform | The bot asks only for the aspect ratio (the four values `PATCH /v1/me` accepts) and uses the user's saved resolution. No `platform` is ever sent (D23). |
| D36 | Lower and shoes | `[Use default]` instead of `[Skip]`, offered only when the garment type has a default — the create path rejects a lower/shoe slot left empty. |
```

In section 8, change step 3 to `ASK_ASPECT  [Keep <ratio>] [Change] ─▶ list of 4 shapes`, change `[Skip]` on steps 8–9 to `[Use default]`, and add `ASK_EXTRA_PHOTO` (one state, one slot at a time: back, lower, lower back, third, optional fourth). In section 12, replace `jobs.channel_delivered_at` and `job_inputs.params.channel` with the `messaging_runs` table (plan 3 adds per-job delivery tracking).

- [ ] **Step 2: Add the progress entry**

Dated entry at the top of `docs/progress.md`: what shipped (engine, extracted queries, `messaging_runs`, real deps), the test commands and pass counts from Tasks 3–7, the migration number, and that nothing is reachable by users until plan 3 (no webhook yet).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md docs/progress.md
git commit -m "docs: WhatsApp bot plan 2 decisions (D33-D36) and progress"
```

---

## Self-review notes

- **Spec section 8 coverage:** main menu + Credits + Help (Task 3); global `menu`/`restart`/`help` (Task 3); photo from main menu (Task 3); gender, garment type, shape, photo, face (Task 3); look fork, template, background, multi-pose, last poses (Task 4); back photo and extra uploads (Task 4); lower/shoes (Task 4); confirm with count/cost/balance, generate, no credits, credits added (Task 5); generating progress, delivery buttons, partial failure, retry failed, more looks (Task 5); stale buttons (Task 3); session expiry (Task 3); unexpected input (Task 3); duplicate Generate (Task 7).
- **Deferred to plan 3, by design:** STOP / START, `CONNECT <code>`, the connect prompt for an unknown number (the engine is only ever called for a connected account), per-sender serialisation, downloading the photo and calling `storeGarmentPhoto`, sending `runFinished` and `creditsAdded`, sending each finished image, the 24-hour template message, and rendering `OutboundMessage` to WhatsApp JSON.
- **Known gap left as in the studio:** a *mixed* custom selection that includes a front lower-only pose needs a separate lower upload the studio also doesn't collect (`lowerGarmentKeyForSubmit`); the create path rejects it with a clear message at CONFIRM, before charging.
