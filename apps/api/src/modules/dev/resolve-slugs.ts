import { schema } from '@aivastra/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getCatalogOptions } from '../../lib/catalog-options-cache.js';
import { AppError } from '../../lib/errors.js';
import type { CatalogOptions } from '../catalog-options/build.js';

/**
 * Translates the public slugs a developer sends into the internal UUIDs createJob
 * expects.
 *
 * Resolution reads the CACHED options payload, so /v1/dev/catalog/generate adds no
 * discovery queries of its own on top of the ~10 createJob already issues.
 *
 * SAFETY: a stale cache could map a slug to an asset that has since been deactivated
 * or unpublished. That is fine — createJob re-validates every face/background/pose/
 * catalog id against the live database before any credit moves
 * (modules/jobs/create.ts), so this is a lookup shortcut, never an authorization
 * boundary. The worst outcome is a request that resolves here and is then rejected
 * there, at no cost to the caller.
 */

export interface ResolvedCatalogSelection {
  faceId: string;
  looks: { poseId: string; backgroundId: string }[];
  garmentTypeId?: string;
  lowerCatalogId?: string;
  shoeCatalogId?: string;
}

/**
 * scopedByGarmentType: pass the request's garmentType slug for fields whose
 * eligible set narrows by it (pose, lower, shoe — see build.ts's poseGarmentConfigs
 * overlay and fetchCatalogItems). Omit for face/background/garmentType itself,
 * which are never narrowed this way. This only changes the error message: the
 * lookup itself already ran against the correctly-scoped options above.
 */
function pick(
  items: { id: string; slug: string | null }[],
  slug: string,
  field: string,
  scopedByGarmentType?: string,
): string {
  const hit = items.find((i) => i.slug === slug);
  if (!hit) {
    const hint = scopedByGarmentType
      ? `unknown ${field} "${slug}" for garmentType "${scopedByGarmentType}" — it may exist ` +
        `for a different garmentType. Call GET /v1/dev/catalog/options?garmentType=${scopedByGarmentType} ` +
        'for the current compatible list'
      : `unknown ${field} "${slug}" — call GET /v1/dev/catalog/options for the current list`;
    throw new AppError('BAD_SLUG', 400, hint);
  }
  return hit.id;
}

/**
 * A merchant's own dev-uploaded backgrounds (POST /v1/dev/backgrounds/confirm) —
 * `scope='user'` rows owned by their linked user account (req.merchantUserId; a
 * merchant IS a user, see packages/db/src/schema/merchant.ts). Deliberately a
 * separate, UNCACHED query rather than folded into getCatalogOptions: that cache's
 * key has no tenant dimension, and this set is small and per-caller, so a direct
 * indexed lookup (model_backgrounds_user_id_idx) is the right tradeoff over either
 * exploding the cache key space or adding new invalidation hooks for every upload.
 * A row's own id doubles as its slug — see DevBackgroundItem in packages/types.
 */
async function fetchMerchantOwnedBackgrounds(app: FastifyInstance, merchantUserId: string) {
  const rows = await app.db
    .select({ id: schema.modelBackgrounds.id })
    .from(schema.modelBackgrounds)
    .where(
      and(
        eq(schema.modelBackgrounds.scope, 'user'),
        eq(schema.modelBackgrounds.userId, merchantUserId),
        eq(schema.modelBackgrounds.isActive, true),
        isNull(schema.modelBackgrounds.deletedAt),
      ),
    );
  return rows.map((r) => ({ id: r.id, slug: r.id }));
}

export async function resolveCatalogSelection(
  app: FastifyInstance,
  body: {
    gender: string;
    face: string;
    looks: { pose: string; background: string }[];
    garmentType?: string;
    lower?: string;
    shoe?: string;
  },
  merchantUserId?: string,
): Promise<ResolvedCatalogSelection> {
  // Two-phase: the garment type has to be resolved against the UNFILTERED pool for
  // this gender, because the pose/lower/shoe lists in the second lookup are narrowed
  // BY that garment type.
  let garmentTypeId: string | undefined;
  if (body.garmentType) {
    const base = await getCatalogOptions(app, { gender: body.gender, publicOnly: true });
    garmentTypeId = pick(base.options.garmentTypes, body.garmentType, 'garmentType');
  }

  const { options } = await getCatalogOptions(app, {
    gender: body.gender,
    garmentTypeId,
    publicOnly: true,
  });

  const backgroundPool = merchantUserId
    ? [...options.backgrounds, ...(await fetchMerchantOwnedBackgrounds(app, merchantUserId))]
    : options.backgrounds;

  return {
    faceId: pick(options.faces, body.face, 'face'),
    looks: body.looks.map((l) => ({
      poseId: pick(options.poses, l.pose, 'pose', body.garmentType),
      backgroundId: pick(backgroundPool, l.background, 'background'),
    })),
    garmentTypeId,
    lowerCatalogId: body.lower
      ? pick(options.lowerItems, body.lower, 'lower', body.garmentType)
      : undefined,
    shoeCatalogId: body.shoe
      ? pick(options.shoeItems, body.shoe, 'shoe', body.garmentType)
      : undefined,
  };
}

/** Projects the internal builder payload down to the public surface — slugs only,
 *  never internal UUIDs. Items with a null slug cannot appear here: `publicOnly`
 *  already filtered them out at the query level, and this narrows the type. */
export function toPublicOptions(options: CatalogOptions) {
  const asset = (i: { slug: string | null; label: string; thumbnailUrl: string }) => ({
    slug: i.slug as string,
    label: i.label,
    thumbnailUrl: i.thumbnailUrl,
  });
  return {
    garmentTypes: options.garmentTypes.map((g) => ({ slug: g.slug as string, label: g.label })),
    faces: options.faces.map(asset),
    backgrounds: options.backgrounds.map(asset),
    poses: options.poses.map((p) => ({ ...asset(p), hasLower: p.hasLower, hasShoes: p.hasShoes })),
    lowerItems: options.lowerItems.map(asset),
    shoeItems: options.shoeItems.map(asset),
  };
}
