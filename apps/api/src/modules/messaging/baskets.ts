import { schema } from '@aivastra/db';
import type { WhatsAppIneligibleReason } from '@aivastra/types';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Gender } from './engine/types.js';

// WhatsApp baskets (handoff 2026-10-26). Many garment types share one ComfyUI
// workflow, so the bot confirms the group — the basket — instead of the exact
// type: the classifier splits its probability between near-identical types
// (tank top vs vest), but their sum is stable. A type in no basket, or in an
// inactive one, is a basket of its own, so it can still be recognised.

interface EligibilityFlags {
  requiresLowerUpload: boolean;
  requiresThirdUpload: boolean;
  allowsFourthUpload: boolean;
  requiresMannequinStep: boolean;
}

/**
 * Why a type cannot be offered on WhatsApp, or null when it can. The chat takes
 * exactly one garment photo, so a type that needs a second upload — or offers
 * an optional one, like the saree blouse — is left to the studio, as is the
 * two-step saree flow (D16/D31). The one rule every WhatsApp surface reads:
 * the bot's type list, the classifier's options and the admin basket picker.
 */
export function whatsappIneligibleReason(t: EligibilityFlags): WhatsAppIneligibleReason | null {
  if (t.requiresMannequinStep) return 'mannequin_step';
  if (t.requiresLowerUpload) return 'lower_upload';
  if (t.requiresThirdUpload) return 'third_upload';
  if (t.allowsFourthUpload) return 'fourth_upload';
  return null;
}

/** One gender's active, single-image type, with its effective basket. */
export interface BasketType {
  id: string;
  label: string;
  // public_api_slug: the key the classifier answers with. Null = never sent to it.
  slug: string | null;
  sortOrder: number;
  // An active basket's id; null when the type is in none, or in an inactive one.
  basketId: string | null;
}

export interface BasketDef {
  id: string;
  name: string;
  representativeSubcategoryId: string | null;
  sortOrder: number;
}

/**
 * What the bot's basket question offers. `key` is `b:<basket id>` for an admin
 * basket and `t:<type id>` for a type in none, so the two never collide in a
 * reply id.
 */
export interface BasketChoice {
  key: string;
  name: string;
}

export interface RankedBasket extends BasketChoice {
  // Summed probability of the basket's members, 0..1.
  score: number;
}

export async function loadBasketTypes(
  app: FastifyInstance,
  gender: Gender,
): Promise<{ types: BasketType[]; baskets: BasketDef[] }> {
  const gs = schema.garmentSubcategories;
  const wb = schema.whatsappBaskets;
  const [rows, baskets] = await Promise.all([
    app.db
      .select({
        id: gs.id,
        label: gs.label,
        slug: gs.publicApiSlug,
        sortOrder: gs.sortOrder,
        basketId: gs.whatsappBasketId,
        requiresLowerUpload: gs.requiresLowerUpload,
        requiresThirdUpload: gs.requiresThirdUpload,
        allowsFourthUpload: gs.allowsFourthUpload,
        requiresMannequinStep: gs.requiresMannequinStep,
      })
      .from(gs)
      .where(and(eq(gs.genderSlug, gender), eq(gs.isActive, true)))
      .orderBy(asc(gs.sortOrder), asc(gs.label)),
    app.db
      .select({
        id: wb.id,
        name: wb.name,
        representativeSubcategoryId: wb.representativeSubcategoryId,
        sortOrder: wb.sortOrder,
      })
      .from(wb)
      .where(and(eq(wb.genderSlug, gender), eq(wb.isActive, true)))
      .orderBy(asc(wb.sortOrder), asc(wb.name)),
  ]);
  const active = new Set(baskets.map((b) => b.id));
  const types = rows
    .filter((r) => whatsappIneligibleReason(r) === null)
    .map((r) => ({
      id: r.id,
      label: r.label,
      slug: r.slug,
      sortOrder: r.sortOrder,
      basketId: r.basketId && active.has(r.basketId) ? r.basketId : null,
    }));
  return { types, baskets };
}

export const basketKeyOf = (t: Pick<BasketType, 'id' | 'basketId'>) =>
  t.basketId ? `b:${t.basketId}` : `t:${t.id}`;

/**
 * Sums the classifier's per-type probabilities per basket, best first. A slug
 * that is not one of `types` is ignored; a basket none of whose members was
 * scored is left out. Ties keep the admin order so the result is stable.
 */
export function rankBaskets(
  ranked: { slug: string; p: number }[],
  types: BasketType[],
  baskets: BasketDef[],
): RankedBasket[] {
  const bySlug = new Map(types.flatMap((t) => (t.slug ? [[t.slug, t] as const] : [])));
  const names = new Map(baskets.map((b) => [b.id, b.name]));
  const order = new Map(baskets.map((b, i) => [`b:${b.id}`, i]));
  const scores = new Map<string, RankedBasket>();
  for (const { slug, p } of ranked) {
    const t = bySlug.get(slug);
    if (!t) continue;
    const key = basketKeyOf(t);
    const name = (t.basketId && names.get(t.basketId)) || t.label;
    const prev = scores.get(key);
    scores.set(key, { key, name, score: (prev?.score ?? 0) + p });
  }
  return [...scores.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * The types a basket key stands for, in the order the bot should try them: the
 * admin-marked representative first, then the rest by sort order. The engine
 * runs the first one it can offer (ready, with poses), so a representative an
 * admin left unready does not sink the whole basket.
 */
export function basketMembers(
  key: string,
  types: BasketType[],
  baskets: BasketDef[],
): { id: string; label: string }[] {
  const [kind, id] = [key.slice(0, 2), key.slice(2)];
  if (kind === 't:') {
    const t = types.find((x) => x.id === id && x.basketId === null);
    return t ? [{ id: t.id, label: t.label }] : [];
  }
  if (kind !== 'b:') return [];
  const basket = baskets.find((b) => b.id === id);
  if (!basket) return [];
  const members = types.filter((t) => t.basketId === id);
  const rep = members.find((t) => t.id === basket.representativeSubcategoryId);
  return [...(rep ? [rep] : []), ...members.filter((t) => t !== rep)].map((t) => ({
    id: t.id,
    label: t.label,
  }));
}

/**
 * The bot's pick list when the seller chooses the type themselves: the gender's
 * active baskets in admin order. A type in no basket (or only in an inactive
 * one) is not listed: an admin decides what WhatsApp offers by putting types in
 * baskets. Only baskets with at least one type the bot can offer (`offered`:
 * ready, with poses) are listed, so every row leads somewhere.
 */
export function basketChoices(
  types: BasketType[],
  baskets: BasketDef[],
  offered: Set<string>,
): BasketChoice[] {
  const live = types.filter((t) => offered.has(t.id));
  return baskets
    .filter((b) => live.some((t) => t.basketId === b.id))
    .map((b) => ({ key: `b:${b.id}`, name: b.name }));
}
