import type { CreateTryOnJobRequest } from '@aivastra/types';
import type { z } from 'zod';
import type { Readiness, ReadinessReason } from '../readiness.js';

export type { Readiness, ReadinessReason };

export type Gender = 'women' | 'men' | 'boys' | 'girls';
// The four values PATCH /v1/me accepts as users.default_aspect_ratio.
export type AspectRatio = '1:1' | '2:3' | '3:4' | '4:5';
export type Resolution = 'HD' | '2K' | '4K';
export type TryonBody = z.infer<typeof CreateTryOnJobRequest>;

// Flow 3 (2026-10-26): photo → gender → (basket confirmed, or picked from the
// alternatives) → garment type → pose count (the tap generates) → generating → delivered.
// A basket resolves to its representative type; the list is the way out at every step.
export type State =
  | 'MAIN_MENU'
  | 'ASK_GARMENT_PHOTO'
  | 'ASK_GENDER'
  | 'CONFIRM_BASKET'
  | 'CHOOSE_BASKET'
  | 'ASK_GARMENT_TYPE'
  | 'ASK_EXTRA_PHOTO'
  | 'ASK_POSE_COUNT'
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

// One standard pose the bot can draw for a garment type. `id` is the pose asset
// id; the background is not part of it, because the bot picks one per catalogue.
export interface PoseLook {
  id: string;
  label: string;
  imageUrl: string;
  hasUpper: boolean;
  hasLower: boolean;
  hasShoes: boolean;
}

// A look as the session keeps it: id and flags only. Labels and image URLs are
// re-read on every render so a presigned URL never goes stale in Redis.
export interface PoolLook {
  id: string;
  hasLower: boolean;
  hasShoes: boolean;
}

// The type's eligible poses. `lowerOnly` is decided over the whole pool
// (rules.ts eligibleLooks): every pose dresses only the lower body.
export interface Pool {
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
  // Jobs that did not complete (set by the try-on flow, which has no pose ids).
  failed?: number;
}

export interface Session {
  v: 1;
  state: State;
  // Set only by the try-on engine. The two flows share state names, so this is
  // what lets a session left by the other flow reset instead of being driven
  // with the wrong reducer.
  flow?: 'tryon';
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
  // What recognition said the photo is, best first: the guess, then the
  // alternatives "No, different item" offers. Cleared once a type is chosen.
  baskets?: BasketChoice[];
  photos: Partial<Record<PhotoSlot, string>>;
  faceId?: string;
  // The type's standard poses the bot can generate (rules.ts buildPool).
  // Re-read on every prompt and on Generate.
  pool?: Pool;
  // The model face and background of the current catalogue: drawn at random once
  // when the seller picks a count, then shared by every image of that run (and
  // by its retry), so the catalogue shows one model in one setting.
  backgroundId?: string;
  // The lower garment and shoes of the run, when its poses use them: the type's
  // default, else one drawn at random. Same for every image of the run.
  lowerCatalogId?: string;
  shoeCatalogId?: string;
  // Cost per image and balance as shown with the pose cards (D45).
  perImage?: number;
  balance?: number;
  // How many poses the seller asked for (one of POSE_COUNTS), until Generate.
  count?: number;
  // The looks drawn for the last Generate (what Retry reads).
  picked: string[];
  // Looks already generated for this garment, so "More poses" shows new ones.
  seenLooks?: string[];
  // The runs of the last Generate.
  runs?: RunRef[];
}

// Normalised by plan 3 from Meta's webhook payloads.
export type InboundEvent =
  | { type: 'text'; text: string }
  // A tap on a reply button, list row or carousel card.
  | { type: 'reply'; id: string }
  // A photo already downloaded, stored and bound to the user (photos.ts).
  | { type: 'image'; garmentKey: string }
  | { type: 'unsupportedMedia' }
  | { type: 'runFinished'; runId: string; images: number; failedPoseIds: string[]; failed?: number }
  | { type: 'creditsAdded'; credits: number };

// A basket the bot can offer: `b:<basket id>`, or `t:<type id>` for a type in none.
export interface BasketChoice {
  key: string;
  name: string;
}

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
  | { kind: 'cards'; text: string; cards: { id: string; imageUrl: string }[] }
  // One labelled button that opens a URL (WhatsApp's CTA URL message).
  | { kind: 'link'; text: string; label: string; url: string; footer?: string };

export interface EngineContext {
  userId: string;
  // messaging_accounts.id — which chat a run's results go back to.
  accountId: string;
  // Meta's message id of the inbound event; the idempotency key for a run.
  messageId: string;
  // Admin debug trace: records why the bot decided something (never sent to the
  // seller). Best effort; absent where there is no trace (tests, other flows).
  note?: Note;
}

export type Note = (title: string, lines: string[]) => Promise<void>;

export interface Quote {
  images: number;
  perImage: number;
  total: number;
  balance: number;
}

export interface UnavailableReport {
  gender: Gender;
  garmentTypeId: string;
  reason: ReadinessReason;
  // For no_eligible_looks: how many poses the type has before the eligibility filter.
  poses?: number;
}

export interface EngineDeps {
  newNonce(): string;
  getUserDefaults(userId: string): Promise<{ aspectRatio: AspectRatio; resolution: Resolution }>;
  getBalance(userId: string): Promise<number>;
  // Randomises look ids (injected so the engine stays pure and tests can pin the draw).
  shuffle(ids: string[]): string[];
  // Types the bot can offer: standard try-on with at least one assigned pose.
  listGarmentTypes(gender: Gender): Promise<GarmentTypeOption[]>;
  // Awaited once the gender is tapped: the photo's baskets best first, or null —
  // for every failure and a weak guess, never an error — and the list is the way out.
  recognizeBaskets(garmentKey: string, gender: Gender, note?: Note): Promise<BasketChoice[] | null>;
  // The types a basket stands for, representative first; empty when it is gone.
  basketTypes(gender: Gender, key: string): Promise<{ id: string; label: string }[]>;
  // The pick list when there is no guess: baskets, then types in none, each with
  // at least one type the bot can offer.
  listBaskets(gender: Gender): Promise<BasketChoice[]>;
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
  // The standard poses assigned to the type for the gender, in studio order.
  getLooks(gender: Gender, garmentTypeId: string): Promise<PoseLook[]>;
  // The faces the studio offers for the gender and type, in admin order.
  listFaceIds(gender: Gender, garmentTypeId: string): Promise<string[]>;
  // The backgrounds the studio offers for the gender.
  listBackgroundIds(gender: Gender): Promise<string[]>;
  // The lower garments or shoes the studio offers for the gender and type.
  listCatalogItemIds(
    type: 'lower' | 'shoe',
    gender: Gender,
    garmentTypeId: string,
  ): Promise<string[]>;
  // Throws AppError for anything createJob would reject.
  quote(userId: string, body: TryonBody): Promise<Quote>;
  // Throws AppError('INSUFFICIENT_CREDITS', 402) when the balance is short.
  createRun(ctx: EngineContext, body: TryonBody): Promise<{ runId: string; images: number }>;
  runProgress(runId: string): Promise<{ finished: number; total: number }>;
  // This chat's runs that still have unfinished jobs, summed; null when nothing is
  // generating. Read from the database, not the session: the session forgets a run
  // as soon as the seller leaves its step. Runs older than the cutoff are not
  // counted, so a run that never finishes cannot lock a seller out.
  activeRun(accountId: string): Promise<{ finished: number; total: number } | null>;
  links: { pricing: string; help: string; studio: string };
}

export interface EngineResult {
  session: Session;
  messages: OutboundMessage[];
}
