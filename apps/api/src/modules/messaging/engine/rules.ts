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
