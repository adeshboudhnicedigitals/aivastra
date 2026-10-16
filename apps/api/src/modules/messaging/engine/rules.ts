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
