import type { CreateTryOnJobRequest } from '@aivastra/types';
import type { z } from 'zod';
import type { Readiness, ReadinessReason } from '../readiness.js';

export type { Readiness, ReadinessReason };

export type Gender = 'women' | 'men' | 'boys' | 'girls';
// The four values PATCH /v1/me accepts as users.default_aspect_ratio.
export type AspectRatio = '1:1' | '2:3' | '3:4' | '4:5';
export type Resolution = 'HD' | '2K' | '4K';
export type TryonBody = z.infer<typeof CreateTryOnJobRequest>;

// Flow 2 (2026-10-22): photo → (kind confirmed) → gender → garment type → required extra photos → pose count → confirm → generating → delivered.
export type State =
  | 'MAIN_MENU'
  | 'ASK_GARMENT_PHOTO'
  | 'ASK_GENDER'
  | 'CONFIRM_KIND'
  | 'ASK_GARMENT_TYPE'
  | 'ASK_EXTRA_PHOTO'
  | 'ASK_POSE_COUNT'
  | 'CONFIRM_GENERATE'
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
  upperUploadLabel: string | null;
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
  // What recognition said the photo is, as a kind label ("Top"), kept from the
  // upload until the gender is known (types are per-gender rows).
  kind?: string;
  photos: Partial<Record<PhotoSlot, string>>;
  faceId?: string;
  // Every active template of the type, with only the looks the bot can generate
  // (rules.ts buildPool), de-duplicated. Re-read on every pick prompt.
  templates?: PoolTemplate[];
  // Cost per image and balance as shown with the pose cards (D45).
  perImage?: number;
  balance?: number;
  // How many poses the seller asked for (one of POSE_COUNTS), until Generate.
  count?: number;
  // The looks drawn for the last Generate (what Retry reads).
  picked: string[];
  // Looks already generated for this garment, so "More poses" shows new ones.
  seenLooks?: string[];
  // One entry per template group of the last Generate.
  runs?: RunRef[];
  // Picked looks whose run could not be created (a later group failed after an
  // earlier one was charged); [Retry] picks them up with the failed images.
  unstarted?: string[];
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
  | { kind: 'cards'; text: string; cards: { id: string; imageUrl: string }[] };

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

export interface UnavailableReport {
  gender: Gender;
  garmentTypeId: string;
  // 'no_template' is the engine's own: getTemplates returned nothing. The rest
  // are readiness reasons (readiness.ts), reported for a recognised type the
  // list does not offer.
  reason: ReadinessReason | 'no_template';
  templateId?: string;
  templateLooks?: number;
}

export interface EngineDeps {
  newNonce(): string;
  getUserDefaults(userId: string): Promise<{ aspectRatio: AspectRatio; resolution: Resolution }>;
  getBalance(userId: string): Promise<number>;
  // Randomises look ids (injected so the engine stays pure and tests can pin the draw).
  shuffle(ids: string[]): string[];
  // Types the bot can offer: standard try-on with at least one template mapping.
  listGarmentTypes(gender: Gender): Promise<GarmentTypeOption[]>;
  // Spec 8a, awaited at the image event: the photo's kind, or null — for every
  // failure, never an error — in which case the list is the way out.
  recognizeKind(garmentKey: string): Promise<{ label: string } | null>;
  // The kind as the tapped gender's own type; null when that gender has none.
  typeForKind(
    label: string,
    gender: Gender,
  ): Promise<{ garmentTypeId: string; label: string } | null>;
  recordRecognitionCorrected(): void;
  // Why a garment type could not be offered. The seller only sees "not
  // available"; this is the admin-facing reason (logged, never shown).
  reportUnavailable(report: UnavailableReport): void;
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
  // Every active template for the type, in admin order (spec 2026-10-14, P2).
  getTemplates(gender: Gender, garmentTypeId: string): Promise<TemplateOption[]>;
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
