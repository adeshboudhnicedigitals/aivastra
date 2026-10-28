import { randomBytes, randomInt } from 'node:crypto';
import { schema } from '@aivastra/db';
import { whatsappGarmentUnavailableTotal } from '@aivastra/observability';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getResolutionTierConfig } from '../../lib/resolution-config.js';
import { selectCatalogItems } from '../catalog/items.js';
import { listBackgrounds, listFaces, listGarmentTypes, listPoses } from '../models/queries.js';
import { whatsappIneligibleReason } from './baskets.js';
import {
  listBaskets,
  recognizeBaskets,
  recordRecognitionCorrected,
  typesOfBasket,
} from './classify.js';
import { buildPool, itemSupply } from './engine/rules.js';
import type { AspectRatio, EngineDeps, GarmentTypeOption, Resolution } from './engine/types.js';
import { decideReadiness } from './readiness.js';
import { activeRun, createRun, quoteRun, runProgress } from './runs.js';
import { createStudioDraftToken } from './studio-draft.js';

const BOT_ASPECT_RATIO: AspectRatio = '3:4';
const BOT_RESOLUTION: Resolution = '2K';
// Cheapest first: the fallback when BOT_RESOLUTION is switched off.
const RESOLUTION_ORDER: Resolution[] = ['HD', '2K', '4K'];

type GarmentTypeRow = Awaited<ReturnType<typeof listGarmentTypes>>['items'][number];

/**
 * The types' default lower and shoe ids that the studio would still show: the
 * item active and in an active category (see selectCatalogItems). A default is
 * a plain id on the type, so without this a switched-off item would still be
 * drawn for every run of the type.
 */
async function usableDefaultIds(app: FastifyInstance, rows: GarmentTypeRow[]) {
  const ids = [
    ...new Set(
      rows
        .flatMap((r) => [r.defaultLowerCatalogId, r.defaultShoeCatalogId])
        .filter((x) => x != null),
    ),
  ] as string[];
  if (ids.length === 0) return new Set<string>();
  const ok = await app.db
    .select({ id: schema.catalogItems.id })
    .from(schema.catalogItems)
    .innerJoin(
      schema.catalogCategories,
      and(
        eq(schema.catalogCategories.id, schema.catalogItems.categoryId),
        eq(schema.catalogCategories.isActive, true),
      ),
    )
    .where(and(inArray(schema.catalogItems.id, ids), eq(schema.catalogItems.isActive, true)));
  return new Set(ok.map((r) => r.id));
}

const toGarmentTypeOption = (i: GarmentTypeRow, usable: Set<string>): GarmentTypeOption => ({
  id: i.id,
  label: i.label,
  requiresLowerUpload: i.requiresLowerUpload,
  requiresThirdUpload: i.requiresThirdUpload,
  upperUploadLabel: i.upperUploadLabel,
  lowerUploadLabel: i.lowerUploadLabel,
  thirdUploadLabel: i.thirdUploadLabel,
  defaultLowerCatalogId:
    i.defaultLowerCatalogId && usable.has(i.defaultLowerCatalogId) ? i.defaultLowerCatalogId : null,
  defaultShoeCatalogId:
    i.defaultShoeCatalogId && usable.has(i.defaultShoeCatalogId) ? i.defaultShoeCatalogId : null,
});

/** Real EngineDeps: every option list is the studio's own query (models/queries.ts). */
export function createEngineDeps(app: FastifyInstance): EngineDeps {
  const web = app.env.WEB_URL.replace(/\/+$/, '');
  const deps: EngineDeps = {
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
      // Only types with an assigned, active pose for this gender can produce a
      // catalog in the chat (D47); listing the rest would be a dead end.
      const assigned = await app.db
        .selectDistinct({ id: schema.poseGarmentConfigs.subcategoryId })
        .from(schema.poseGarmentConfigs)
        .innerJoin(
          schema.modelPoseAssets,
          and(
            eq(schema.modelPoseAssets.id, schema.poseGarmentConfigs.poseAssetId),
            eq(schema.modelPoseAssets.genderSlug, gender),
            eq(schema.modelPoseAssets.isActive, true),
            eq(schema.modelPoseAssets.scope, 'general'),
            isNull(schema.modelPoseAssets.deletedAt),
          ),
        )
        .where(
          and(
            inArray(
              schema.poseGarmentConfigs.subcategoryId,
              items.map((i) => i.id),
            ),
            or(
              isNull(schema.poseGarmentConfigs.isActive),
              eq(schema.poseGarmentConfigs.isActive, true),
            ),
          ),
        );
      const hasPoses = new Set(assigned.map((m) => m.id));
      const usable = await usableDefaultIds(app, items);
      return (
        items
          // One garment photo per chat: no extra uploads, no two-step saree (D16/D31).
          .filter((i) => whatsappIneligibleReason(i) === null && hasPoses.has(i.id))
          .map((i) => toGarmentTypeOption(i, usable))
      );
    },

    shuffle: (ids) => {
      const a = [...ids];
      for (let i = a.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    recognizeBaskets: (garmentKey, gender, note) =>
      recognizeBaskets(app, garmentKey, gender, { note }),
    basketTypes: (gender, key) => typesOfBasket(app, gender, key),
    async listBaskets(gender) {
      const offered = await deps.listGarmentTypes(gender);
      return listBaskets(app, gender, new Set(offered.map((t) => t.id)));
    },
    recordRecognitionCorrected,
    // Info, not warn: it is admin data, not a fault, but it is the only trace
    // of why a seller was told a type "isn't available on WhatsApp yet".
    reportUnavailable: (report) => {
      whatsappGarmentUnavailableTotal.inc({ reason: report.reason });
      app.log.info(report, 'whatsapp: garment type not offered');
    },

    async getLooks(gender, garmentTypeId) {
      // The studio's own pose list for the type, already without inactive poses
      // and poses hidden for it.
      const { items } = await listPoses(app, { gender, garmentTypeId });
      return items.map((p) => ({
        id: p.id,
        label: p.label,
        imageUrl: p.thumbnailUrl,
        hasUpper: p.hasUpper,
        hasLower: p.hasLower,
        hasShoes: p.hasShoes,
      }));
    },

    async listFaceIds(gender, garmentTypeId) {
      // The studio's own face list for this type, in admin order.
      const { items } = await listFaces(app, { gender, garmentTypeId });
      return items.map((f) => f.id);
    },

    async listBackgroundIds(gender) {
      const ids = (await listBackgrounds(app, gender)).map((b) => b.id);
      if (ids.length === 0) return ids;
      // Admin-flagged WhatsApp backgrounds win once any exist; none flagged
      // keeps the studio's whole list, so the bot never goes dark on a deploy.
      const flagged = new Set(
        (
          await app.db
            .select({ id: schema.modelBackgrounds.id })
            .from(schema.modelBackgrounds)
            .where(
              and(
                inArray(schema.modelBackgrounds.id, ids),
                eq(schema.modelBackgrounds.whatsappPool, true),
              ),
            )
        ).map((r) => r.id),
      );
      return flagged.size > 0 ? ids.filter((id) => flagged.has(id)) : ids;
    },

    async listCatalogItemIds(type, gender, garmentTypeId) {
      // The studio drops items in an inactive category, so the bot must too.
      const items = await selectCatalogItems(app, {
        type,
        gender,
        garmentTypeId,
        categorizedOnly: true,
      });
      return items.map((i) => i.id);
    },

    async getReadiness(gender, garmentTypeId) {
      // listGarmentTypes returns active types only, so a miss is "inactive".
      const { items } = await listGarmentTypes(app, gender);
      const gt = items.find((i) => i.id === garmentTypeId);
      if (!gt) {
        return decideReadiness({
          active: false,
          requiresMannequinStep: false,
          assignedPoses: 0,
          activePoses: 0,
          hasFace: false,
          hasBackground: false,
          looksTotal: 0,
          looksUsable: 0,
        });
      }
      // Assignment rows regardless of any active switch, so "assigned but off"
      // is told apart from "never assigned".
      const assigned = await app.db
        .select({ isActive: schema.poseGarmentConfigs.isActive })
        .from(schema.poseGarmentConfigs)
        .innerJoin(
          schema.modelPoseAssets,
          and(
            eq(schema.modelPoseAssets.id, schema.poseGarmentConfigs.poseAssetId),
            eq(schema.modelPoseAssets.genderSlug, gender),
            eq(schema.modelPoseAssets.scope, 'general'),
            isNull(schema.modelPoseAssets.deletedAt),
          ),
        )
        .where(eq(schema.poseGarmentConfigs.subcategoryId, garmentTypeId));
      const poses = await deps.getLooks(gender, garmentTypeId);
      const usable = await usableDefaultIds(app, [gt]);
      return decideReadiness({
        active: true,
        requiresMannequinStep: gt.requiresMannequinStep,
        assignedPoses: assigned.length,
        activePoses: poses.length,
        hasFace: (await deps.listFaceIds(gender, garmentTypeId)).length > 0,
        hasBackground: (await deps.listBackgroundIds(gender)).length > 0,
        looksTotal: poses.length,
        looksUsable: buildPool(
          toGarmentTypeOption(gt, usable),
          poses,
          itemSupply(
            toGarmentTypeOption(gt, usable),
            await deps.listCatalogItemIds('lower', gender, garmentTypeId),
            await deps.listCatalogItemIds('shoe', gender, garmentTypeId),
          ),
        ).cards.length,
      });
    },

    async createStudioDraft(d) {
      try {
        const token = await createStudioDraftToken(app.redis, d);
        return `${web}/studio?draft=${token}`;
      } catch (err) {
        // The hand-off still works without the photo; never fail the chat on it.
        app.log.warn({ err }, 'whatsapp: studio draft not stored');
        return `${web}/studio`;
      }
    },

    quote: (userId, body) => quoteRun(app, userId, body),
    createRun: (ctx, body) => createRun(app, ctx, body),
    runProgress: (runId) => runProgress(app, runId),
    activeRun: (accountId) => activeRun(app, accountId),
    links: { pricing: `${web}/pricing`, help: `${web}/contact-us`, studio: `${web}/studio` },
  };
  return deps;
}
