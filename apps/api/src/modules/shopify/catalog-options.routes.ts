import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getCatalogOptions } from '../../lib/catalog-options-cache.js';
import { AppError } from '../../lib/errors.js';
import { CATALOG_OPTION_GENDERS } from '../catalog-options/build.js';

const OptionsQuery = z.object({
  gender: z.enum(CATALOG_OPTION_GENDERS),
  garmentTypeId: z.string().uuid().optional(),
});

export async function shopifyCatalogOptionsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/shopify/catalog/options',
    // preHandler (not a declarative schema.querystring): same rationale as
    // /v1/shopify/catalog/generate (catalog.routes.ts) — auth must run before
    // validation, or an unauthenticated request with a malformed querystring gets 400
    // instead of 401.
    { preHandler: app.requireShopifySession },
    async (req) => {
      let query: z.infer<typeof OptionsQuery>;
      try {
        query = OptionsQuery.parse(req.query);
      } catch (err) {
        throw new AppError(
          'VALIDATION',
          400,
          err instanceof Error ? err.message : 'invalid request querystring',
        );
      }
      const { gender, garmentTypeId } = query;

      // publicOnly: false — the embedded Shopify app is a first-party surface and
      // sees every active asset, not just the subset opted into the public dev API.
      const { options } = await getCatalogOptions(app, {
        gender,
        garmentTypeId,
        publicOnly: false,
      });

      // Project away `slug`: it is meaningless on this surface (Shopify selects by
      // id) and this route's response shape is depended on by apps/shopify.
      return {
        garmentTypes: options.garmentTypes.map((g) => ({
          id: g.id,
          label: g.label,
          sortOrder: g.sortOrder,
        })),
        faces: options.faces.map((f) => ({
          id: f.id,
          label: f.label,
          thumbnailUrl: f.thumbnailUrl,
        })),
        backgrounds: options.backgrounds.map((b) => ({
          id: b.id,
          label: b.label,
          thumbnailUrl: b.thumbnailUrl,
        })),
        poses: options.poses.map((p) => ({
          id: p.id,
          label: p.label,
          thumbnailUrl: p.thumbnailUrl,
          hasLower: p.hasLower,
          hasShoes: p.hasShoes,
        })),
        lowerItems: options.lowerItems.map((i) => ({
          id: i.id,
          label: i.label,
          thumbnailUrl: i.thumbnailUrl,
        })),
        shoeItems: options.shoeItems.map((i) => ({
          id: i.id,
          label: i.label,
          thumbnailUrl: i.thumbnailUrl,
        })),
      };
    },
  );
}
