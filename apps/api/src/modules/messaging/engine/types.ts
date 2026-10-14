import type { CreateTryOnJobRequest } from '@aivastra/types';
import type { z } from 'zod';

export type Gender = 'women' | 'men' | 'boys' | 'girls';
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

export interface UnavailableReport {
  gender: Gender;
  garmentTypeId: string;
  // no_eligible_looks: the template exists, but every look needs a lower or
  // shoe the type has no default for (D49), or needs an upper it lacks.
  reason: 'no_face' | 'no_template' | 'no_eligible_looks';
  templateId?: string;
  templateLooks?: number;
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
  // Why a garment type could not be offered. The seller only sees "not
  // available"; this is the admin-facing reason (logged, never shown).
  reportUnavailable(report: UnavailableReport): void;
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
