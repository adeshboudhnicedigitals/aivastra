import {
  boolean,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { catalogItems } from './catalog.js';
import { kioskDevices } from './kiosk.js';
import { merchants } from './merchant.js';
import { garmentSubcategories, modelBackgrounds, modelFaces, modelPoseAssets } from './models.js';
import { shopifyStores } from './shopify.js';
import { users } from './users.js';

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  catalogueId: uuid('catalogue_id'),
  status: text('status').notNull().default('QUEUED'),
  workerId: text('worker_id'),
  priority: boolean('priority').notNull().default(false),
  queueStream: text('queue_stream').notNull().default('normal'),
  // Snapshotted from credit_plans.watermark at job creation; never re-derived from the plan.
  watermark: boolean('watermark').notNull().default(false),
  creditsCharged: integer('credits_charged').notNull().default(1),
  attempts: integer('attempts').notNull().default(0),
  errorCode: text('error_code'),
  // Which flow created this job — 'catalog' | 'tryon' | 'saree' | 'shopify'.
  // Null for kiosk jobs (attributed via merchants.userId instead, see the
  // admin credit-analysis routes) and for historical rows not yet backfilled.
  source: text('source'),
  // Nullable self-FK: set only by the regenerate endpoint for traceability.
  parentJobId: uuid('parent_job_id'),
  merchantId: uuid('merchant_id').references(() => merchants.id, {
    onDelete: 'set null',
  }),
  kioskDeviceId: uuid('kiosk_device_id').references(() => kioskDevices.id, {
    onDelete: 'set null',
  }),
  shopifyStoreId: uuid('shopify_store_id').references(() => shopifyStores.id, {
    onDelete: 'set null',
  }),
  customerPhotoKey: text('customer_photo_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const jobInputs = pgTable('job_inputs', {
  jobId: uuid('job_id')
    .primaryKey()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  upperGarmentKey: text('upper_garment_key').notNull(),
  faceId: uuid('face_id').references(() => modelFaces.id),
  backgroundId: uuid('background_id').references(() => modelBackgrounds.id),
  poseId: uuid('pose_id').references(() => modelPoseAssets.id),
  garmentTypeId: uuid('garment_type_id').references(() => garmentSubcategories.id, {
    onDelete: 'set null',
  }),
  lowerCatalogId: uuid('lower_catalog_id').references(() => catalogItems.id),
  lowerGarmentKey: text('lower_garment_key'),
  shoeCatalogId: uuid('shoe_catalog_id').references(() => catalogItems.id),
  userHint: text('user_hint'),
  params: jsonb('params'),
});

export const jobOutputs = pgTable('job_outputs', {
  jobId: uuid('job_id')
    .primaryKey()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  resultKey: text('result_key'),
  thumbnailKey: text('thumbnail_key'),
  // 'ORIGINAL' | 'WATERMARKED' recorded by finalizeOutput() from actual runtime result.
  assetKind: text('asset_kind').notNull().default('ORIGINAL'),
  // The WatermarkService version used; null when assetKind='ORIGINAL'.
  watermarkVersion: smallint('watermark_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobEvents = pgTable('job_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
