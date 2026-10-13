import { randomBytes } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { listCatalogueTemplates, listFaces, listGarmentTypes } from '../models/queries.js';
import { recognizeGarment, recordRecognitionCorrected } from './classify.js';
import type {
  AspectRatio,
  EngineDeps,
  GarmentTypeOption,
  Resolution,
  TemplateOption,
} from './engine/types.js';
import { createRun, quoteRun, runProgress } from './runs.js';

const ASPECTS = new Set(['1:1', '2:3', '3:4', '4:5']);
const RESOLUTIONS = new Set(['HD', '2K', '4K']);

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
      if (items.length === 0) return [];
      // Only types with an active template for this gender can produce a
      // catalog in the chat (D47); listing the rest would be a dead end.
      const mapped = await app.db
        .selectDistinct({ id: schema.catalogueTemplateSubcategories.subcategoryId })
        .from(schema.catalogueTemplateSubcategories)
        .innerJoin(
          schema.catalogueTemplates,
          and(
            eq(schema.catalogueTemplates.id, schema.catalogueTemplateSubcategories.templateId),
            eq(schema.catalogueTemplates.genderSlug, gender),
            eq(schema.catalogueTemplates.isActive, true),
            isNull(schema.catalogueTemplates.deletedAt),
          ),
        )
        .where(
          inArray(
            schema.catalogueTemplateSubcategories.subcategoryId,
            items.map((i) => i.id),
          ),
        );
      const hasTemplate = new Set(mapped.map((m) => m.id));
      return (
        items
          // D16/D31: the two-step saree flow is not in the bot.
          .filter((i) => !i.requiresMannequinStep && hasTemplate.has(i.id))
          .map(
            (i): GarmentTypeOption => ({
              id: i.id,
              label: i.label,
              requiresLowerUpload: i.requiresLowerUpload,
              requiresThirdUpload: i.requiresThirdUpload,
              lowerUploadLabel: i.lowerUploadLabel,
              thirdUploadLabel: i.thirdUploadLabel,
              defaultLowerCatalogId: i.defaultLowerCatalogId,
              defaultShoeCatalogId: i.defaultShoeCatalogId,
            }),
          )
      );
    },

    recognizeGarment: (garmentKey, gender) => recognizeGarment(app, garmentKey, gender),
    recordRecognitionCorrected,

    async getTemplate(gender, garmentTypeId): Promise<TemplateOption | null> {
      // Already in admin sort order, and already without looks whose pose,
      // background or workflow is inactive (the studio's query).
      const { items } = await listCatalogueTemplates(app, { gender, garmentTypeId });
      const t = items[0];
      if (!t) return null;
      return {
        id: t.id,
        mappingId: t.mappingId,
        looks: t.looks.map((l) => ({
          id: l.id,
          poseId: l.poseId,
          backgroundId: l.backgroundId,
          label: l.poseLabel,
          imageUrl: l.poseThumbnailUrl,
          hasUpper: l.hasUpper,
          hasLower: l.hasLower,
          hasShoes: l.hasShoes,
        })),
      };
    },

    async getDefaultFaceId(gender, garmentTypeId) {
      // The studio's own face list for this type, in admin order (D43).
      const { items } = await listFaces(app, { gender, garmentTypeId });
      return items[0]?.id ?? null;
    },

    quote: (userId, body) => quoteRun(app, userId, body),
    createRun: (ctx, body) => createRun(app, ctx, body),
    runProgress: (runId) => runProgress(app, runId),
    links: { pricing: `${web}/pricing`, help: `${web}/contact-us`, studio: `${web}/studio` },
  };
}
