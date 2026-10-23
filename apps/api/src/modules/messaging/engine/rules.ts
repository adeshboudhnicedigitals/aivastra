import type {
  GarmentTypeOption,
  PhotoSlot,
  PickCard,
  Pool,
  PoseLook,
  Session,
  TryonBody,
} from './types.js';

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

const isLowerOnlyLook = (l: PoseLook) => l.hasLower && !l.hasUpper;

/** Whether a lower garment / shoes can be filled without asking the seller. */
export interface ItemSupply {
  lower: boolean;
  shoes: boolean;
}

/** The type's default item, else any item the studio offers for it, fills the slot. */
export const itemSupply = (
  gt: GarmentTypeOption,
  lowerIds: string[],
  shoeIds: string[],
): ItemSupply => ({
  lower: gt.defaultLowerCatalogId != null || lowerIds.length > 0,
  shoes: gt.defaultShoeCatalogId != null || shoeIds.length > 0,
});

/**
 * The looks the bot can generate for this garment type without asking another
 * question (D49). The create path rejects a look whose lower or shoe slot is
 * empty (jobs/create.ts per-pose checks), and the chat never asks for a lower
 * or shoe item (D43), so a look that would need one is offered only when the
 * type has a default for it or the studio has items to draw one from.
 *
 * `lowerOnly` mirrors the studio's rule: when every look dresses only the
 * lower body, the seller's one photo IS the lower garment.
 */
export function eligibleLooks(
  gt: GarmentTypeOption,
  looks: PoseLook[],
  supply: ItemSupply,
): { lowerOnly: boolean; looks: PoseLook[] } {
  const lowerOnly = !gt.requiresLowerUpload && looks.length > 0 && looks.every(isLowerOnlyLook);
  return {
    lowerOnly,
    looks: looks.filter((l) => {
      // No garment slot at all: the pose has no usable workflow.
      if (!l.hasUpper && !l.hasLower) return false;
      if (l.hasShoes && !supply.shoes) return false;
      if (lowerOnly) return true;
      // In a mixed template a lower-only pose needs its own lower photo, which
      // only a requiresLowerUpload type collects (the studio has the same gap).
      if (isLowerOnlyLook(l)) return gt.requiresLowerUpload;
      if (l.hasLower && !gt.requiresLowerUpload && !supply.lower) return false;
      return true;
    }),
  };
}

/**
 * The type's eligible poses as one pool. `pool` is what the session stores (ids
 * and flags); `cards` is what a prompt renders, read fresh.
 */
export function buildPool(
  gt: GarmentTypeOption,
  poses: PoseLook[],
  supply: ItemSupply,
): { pool: Pool; cards: PickCard[] } {
  const { lowerOnly, looks } = eligibleLooks(gt, poses, supply);
  return {
    pool: {
      lowerOnly,
      looks: looks.map((l) => ({ id: l.id, hasLower: l.hasLower, hasShoes: l.hasShoes })),
    },
    cards: looks.map((l) => ({ id: l.id, label: l.label, imageUrl: l.imageUrl })),
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

/**
 * The looks to retry once every run has finished: picked poses that failed (the
 * dispatcher already refunded them). Delivery reports failures by pose id, which
 * is the look id.
 */
export function retryLookIds(s: Session): string[] {
  const failed = new Set((s.runs ?? []).flatMap((r) => r.failedPoseIds ?? []));
  return s.picked.filter((id) => failed.has(id));
}

/**
 * The /v1/jobs/tryon body for `lookIds` of the pool: custom looks (pose +
 * background, no template mapping), with the catalogue's face and background.
 */
export function buildTryonBody(s: Session, lookIds: string[]): TryonBody {
  const gt = s.garmentType;
  const pool = s.pool;
  if (!gt || !pool || !s.garmentKey || !s.faceId || !s.backgroundId) {
    throw new Error('session incomplete');
  }
  const byId = new Map(pool.looks.map((l) => [l.id, l]));
  const looks = lookIds.flatMap((id) => {
    const l = byId.get(id);
    return l ? [l] : [];
  });
  // A combined upper+lower pose's lower slot takes the type's default item
  // unless the seller sent a lower photo (studio: effectiveLowerId).
  const needsLowerItem =
    !pool.lowerOnly && !gt.requiresLowerUpload && looks.some((l) => l.hasLower);
  const needsShoes = looks.some((l) => l.hasShoes);

  const inputs: Record<string, unknown> = {
    upperGarmentKey: s.garmentKey,
    faceId: s.faceId,
    garmentTypeId: gt.id,
    looks: looks.map((l) => ({ poseId: l.id, backgroundId: s.backgroundId })),
    // Lower-only: the schema requires upperGarmentKey, the api drops it for
    // these poses, and the same photo is the lower (studio: lowerGarmentKeyForSubmit).
    lowerGarmentKey: pool.lowerOnly ? s.garmentKey : s.photos.lowerFront,
    lowerCatalogId: needsLowerItem ? s.lowerCatalogId : undefined,
    shoeCatalogId: needsShoes ? s.shoeCatalogId : undefined,
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
