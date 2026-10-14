import { randomBytes } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getResolutionTierConfig } from '../../lib/resolution-config.js';
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

const BOT_ASPECT_RATIO: AspectRatio = '3:4';
const BOT_RESOLUTION: Resolution = '2K';
// Cheapest first: the fallback when BOT_RESOLUTION is switched off.
const RESOLUTION_ORDER: Resolution[] = ['HD', '2K', '4K'];

/** Real EngineDeps: every option list is the studio's own query (models/queries.ts). */
export function createEngineDeps(app: FastifyInstance): EngineDeps {
  const web = app.env.WEB_URL.replace(/\/+$/, '');
  return {
    newNonce: () => randomBytes(4).toString('hex'),

    // Every bot run is 3:4 at 2K, not the seller's saved studio defaults: the chat
    // has no picker for either, so a fixed shape the templates are tuned for beats
    // whatever the seller last chose on the web.
    async getUserDefaults() {
      // The create path rejects a disabled tier, so if an admin has switched 2K
      // off, fall back to the cheapest enabled one rather than fail every run.
      let resolution = BOT_RESOLUTION;
      if (!(await getResolutionTierConfig(app, BOT_RESOLUTION)).enabled) {
        for (const r of RESOLUTION_ORDER) {
          if ((await getResolutionTierConfig(app, r)).enabled) {
            resolution = r;
            break;
          }
        }
      }
      return { aspectRatio: BOT_ASPECT_RATIO, resolution };
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
    // Info, not warn: it is admin data, not a fault, but it is the only trace
    // of why a seller was told a type "isn't available on WhatsApp yet".
    reportUnavailable: (report) => app.log.info(report, 'whatsapp: garment type not offered'),

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
